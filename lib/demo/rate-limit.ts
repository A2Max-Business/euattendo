import { Redis } from "@upstash/redis";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { validarConfigRedisRest } from "@/lib/redis-config";

export interface ChatMessageInput {
  role: "user" | "assistant";
  content: string;
}

export const LIMITS = {
  MAX_BODY_BYTES: 16 * 1024, // 16 KB
  MAX_MESSAGE_CHARS: 500,
  MAX_HISTORY_MESSAGES: 10,
  MAX_OUTPUT_TOKENS: 500,
  TIMEOUT_MS: 15000,
  IP_LIMIT_PER_MINUTE: 10,
  GLOBAL_LIMIT_PER_MINUTE: 60,
  LOCK_TTL_SECONDS: 25,
} as const;

let _redis: Redis | null = null;
let _forceRedisUnavailableForTesting = false;

export function getDemoRedis(): Redis | null {
  if (_forceRedisUnavailableForTesting) return null;
  if (_redis) return _redis;

  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  const config = validarConfigRedisRest(url, token);

  if (!config.ok) {
    return null;
  }

  _redis = new Redis({ url, token, retry: false });
  return _redis;
}

export function setForceRedisUnavailableForTesting(val: boolean): void {
  _forceRedisUnavailableForTesting = val;
}

export function resetDemoRedisClientForTesting(): void {
  _redis = null;
  _forceRedisUnavailableForTesting = false;
  _memBuckets.clear();
  _memLocks.clear();
}

// Fallback em memória APENAS para desenvolvimento e testes
const _memBuckets = new Map<string, { count: number; expiresAt: number }>();
const _memLocks = new Map<string, { ownerId: string; expiresAt: number }>();

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

// Script Lua para liberação atômica: só apaga a chave se o valor contiver o ownerId
const LUA_RELEASE_LOCK = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

/**
 * Adquire trava atômica de concorrência vinculada a um proprietário (ownerId).
 */
export async function acquireDemoLock(
  token: string,
  ip: string,
  ownerId: string,
): Promise<{ acquired: boolean; unavailable?: boolean }> {
  const lockKey = `demo:lock:${token}:${ip}`;
  const redis = getDemoRedis();

  if (redis) {
    try {
      const res = await redis.set(lockKey, ownerId, {
        nx: true,
        ex: LIMITS.LOCK_TTL_SECONDS,
      });
      return { acquired: res === "OK" };
    } catch (err) {
      logger.warn("[demo.lock] falha no Redis", {
        detail: err instanceof Error ? err.message : String(err),
      });
      if (isProduction()) {
        return { acquired: false, unavailable: true };
      }
    }
  }

  // Em produção, se o Redis não estiver disponível, interrompe com 503
  if (isProduction()) {
    logger.error("[demo.lock] Redis indisponível em produção — recusando requisição");
    return { acquired: false, unavailable: true };
  }

  // Fallback em memória APENAS em dev/testes
  const now = Date.now();
  const existing = _memLocks.get(lockKey);
  if (existing && existing.expiresAt > now) {
    return { acquired: false };
  }

  _memLocks.set(lockKey, {
    ownerId,
    expiresAt: now + LIMITS.LOCK_TTL_SECONDS * 1000,
  });

  return { acquired: true };
}

/**
 * Liberação atômica que apaga apenas a trava se ainda pertencer à requisição atual (ownerId).
 */
export async function releaseDemoLock(token: string, ip: string, ownerId: string): Promise<void> {
  const lockKey = `demo:lock:${token}:${ip}`;
  const redis = getDemoRedis();

  if (redis) {
    try {
      await redis.eval(LUA_RELEASE_LOCK, [lockKey], [ownerId]);
      return;
    } catch (err) {
      logger.warn("[demo.lock] falha ao liberar lock com Lua script", {
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Fallback em memória para dev/testes
  const existing = _memLocks.get(lockKey);
  if (existing && existing.ownerId === ownerId) {
    _memLocks.delete(lockKey);
  }
}

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; reason: "ip_limit_exceeded" | "global_limit_exceeded" | "redis_unavailable" };

/**
 * Rate limit compartilhado com Upstash Redis.
 * Em produção, se o Redis estiver indisponível, retorna redis_unavailable para interromper com 503.
 */
export async function checkDemoRateLimit(token: string, ip: string): Promise<RateLimitResult> {
  const windowSec = 60;
  const now = Date.now();
  const windowStart = Math.floor(now / (windowSec * 1000)) * windowSec;

  const ipKey = `demo:rate:ip:${token}:${ip}:${windowStart}`;
  const globalKey = `demo:rate:global:${token}:${windowStart}`;

  const redis = getDemoRedis();

  if (redis) {
    try {
      // 1. Limite global da demo
      const globalCount = await redis.incr(globalKey);
      if (globalCount === 1) {
        await redis.expire(globalKey, windowSec + 5);
      }
      if (globalCount > LIMITS.GLOBAL_LIMIT_PER_MINUTE) {
        return { allowed: false, reason: "global_limit_exceeded" };
      }

      // 2. Limite por IP
      const ipCount = await redis.incr(ipKey);
      if (ipCount === 1) {
        await redis.expire(ipKey, windowSec + 5);
      }
      if (ipCount > LIMITS.IP_LIMIT_PER_MINUTE) {
        return { allowed: false, reason: "ip_limit_exceeded" };
      }

      return { allowed: true };
    } catch (err) {
      logger.warn("[demo.rate-limit] falha no Redis", {
        detail: err instanceof Error ? err.message : String(err),
      });
      if (isProduction()) {
        return { allowed: false, reason: "redis_unavailable" };
      }
    }
  }

  // Em produção, a ausência de Redis interrompe imediatamente com 503
  if (isProduction()) {
    logger.error("[demo.rate-limit] Redis ausente ou inalcançável em produção");
    return { allowed: false, reason: "redis_unavailable" };
  }

  // Fallback em memória APENAS para ambiente não-produção
  const checkBucket = (key: string, limit: number): boolean => {
    const bucket = _memBuckets.get(key);
    if (!bucket || bucket.expiresAt <= now) {
      _memBuckets.set(key, { count: 1, expiresAt: now + windowSec * 1000 });
      return true;
    }
    if (bucket.count >= limit) {
      return false;
    }
    bucket.count += 1;
    return true;
  };

  if (!checkBucket(globalKey, LIMITS.GLOBAL_LIMIT_PER_MINUTE)) {
    return { allowed: false, reason: "global_limit_exceeded" };
  }

  if (!checkBucket(ipKey, LIMITS.IP_LIMIT_PER_MINUTE)) {
    return { allowed: false, reason: "ip_limit_exceeded" };
  }

  return { allowed: true };
}

export function sanitizeDemoInput(input: {
  message?: unknown;
  history?: unknown;
}): {
  valid: boolean;
  cleanMessage?: string;
  cleanHistory?: ChatMessageInput[];
  error?: string;
} {
  if (!input.message || typeof input.message !== "string") {
    return { valid: false, error: "A mensagem deve ser um texto válido." };
  }

  const cleanMessage = input.message.trim();
  if (cleanMessage.length === 0) {
    return { valid: false, error: "A mensagem não pode ser vazia." };
  }

  if (cleanMessage.length > LIMITS.MAX_MESSAGE_CHARS) {
    return {
      valid: false,
      error: `A mensagem excede o limite de ${LIMITS.MAX_MESSAGE_CHARS} caracteres.`,
    };
  }

  const cleanHistory: ChatMessageInput[] = [];

  if (Array.isArray(input.history)) {
    const rawSlice = input.history.slice(-LIMITS.MAX_HISTORY_MESSAGES);
    for (const item of rawSlice) {
      if (
        item &&
        typeof item === "object" &&
        (item.role === "user" || item.role === "assistant") &&
        typeof item.content === "string"
      ) {
        cleanHistory.push({
          role: item.role,
          content: item.content.slice(0, LIMITS.MAX_MESSAGE_CHARS),
        });
      }
    }
  }

  return { valid: true, cleanMessage, cleanHistory };
}