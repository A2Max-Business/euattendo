import { createHash, randomBytes } from "node:crypto";
import { Redis } from "@upstash/redis";
import { env } from "@/lib/env";

/** Sem fallback em memória: uso único precisa valer entre réplicas. */
export function redisOAuth(): Redis {
  return new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
    retry: false,
  });
}
export function opaco(): string {
  return randomBytes(32).toString("base64url");
}
export function chaveOAuth(tipo: string, segredo: string): string {
  return `mcp-oauth:${tipo}:${createHash("sha256").update(segredo).digest("hex")}`;
}
export async function guardarOAuth(
  tipo: string,
  segredo: string,
  valor: unknown,
  ttl: number,
): Promise<void> {
  const result = await redisOAuth().set(chaveOAuth(tipo, segredo), valor, { ex: ttl, nx: true });
  if (result !== "OK") throw new Error("oauth_state_unavailable");
}
export async function lerOAuth<T>(tipo: string, segredo: string): Promise<T | null> {
  return redisOAuth().get<T>(chaveOAuth(tipo, segredo));
}
export async function consumirOAuth<T>(tipo: string, segredo: string): Promise<T | null> {
  // GETDEL é atômico no Redis 7 usado pela instalação e no Upstash.
  return redisOAuth().getdel<T>(chaveOAuth(tipo, segredo));
}
