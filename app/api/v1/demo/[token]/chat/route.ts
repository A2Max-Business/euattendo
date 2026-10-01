import type { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { ok, fail } from "@/lib/api/wrappers";
import { resolveLanguageModel, type ModelId } from "@/lib/ai/gateway";
import { resolveDemoAgent } from "@/lib/demo/token-resolver";
import {
  acquireDemoLock,
  releaseDemoLock,
  checkDemoRateLimit,
  sanitizeDemoInput,
  LIMITS,
} from "@/lib/demo/rate-limit";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ token: string }> };

export async function POST(req: NextRequest, { params }: Context): Promise<NextResponse> {
  const { token } = await params;

  // 1. Validação do tamanho do payload ANTES de processar o corpo
  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > LIMITS.MAX_BODY_BYTES) {
    return fail(
      "payload_too_large",
      `O corpo da requisição excede o limite máximo permitido de ${LIMITS.MAX_BODY_BYTES} bytes.`,
      413,
    );
  }

  // 2. Extração segura do IP do cliente (para rate limit e trava independentes de frontend)
  const forwardedFor = req.headers.get("x-forwarded-for");
  const rawFirstIp = forwardedFor ? forwardedFor.split(",")[0] : undefined;
  const trimmedIp = rawFirstIp ? rawFirstIp.trim() : "";
  const ip = trimmedIp.length > 0 ? trimmedIp : "ip-cliente-indefinido";

  // 3. Validação do token e resolução do agente no servidor (sem fallback silencioso)
  const resolveResult = await resolveDemoAgent(token);
  if (!resolveResult.ok) {
    if (resolveResult.reason === "invalid_token") {
      return fail("not_found", "Demonstração não encontrada ou token inválido.", 404);
    }
    if (resolveResult.reason === "misconfigured") {
      return fail(
        "service_unavailable",
        "Configuração da demonstração incompleta ou inválida no servidor.",
        503,
      );
    }
    return fail(
      "service_unavailable",
      "O agente de demonstração configurado está temporariamente indisponível no banco de dados.",
      503,
    );
  }

  const agent = resolveResult.agent;

  // 4. Rate limiting compartilhado por IP e Demo (independe de sessionId do navegador)
  const rateCheck = await checkDemoRateLimit(token, ip);
  if (!rateCheck.allowed) {
    if (rateCheck.reason === "redis_unavailable") {
      return fail(
        "service_unavailable",
        "Serviço temporariamente indisponível. Conexão Redis obrigatória em produção.",
        503,
      );
    }
    const errorMsg =
      rateCheck.reason === "global_limit_exceeded"
        ? "O limite global de mensagens da demonstração foi atingido para este minuto. Por favor, aguarde alguns instantes."
        : "Limite de mensagens por minuto atingido para sua conexão. Aguarde um instante antes de enviar novamente.";
    return fail("too_many_requests", errorMsg, 429);
  }

  // 5. Identificador único de proprietário e trava atômica de concorrência com expiração
  const ownerId = crypto.randomUUID();
  const lockResult = await acquireDemoLock(token, ip, ownerId);
  if (lockResult.unavailable) {
    return fail(
      "service_unavailable",
      "Serviço temporariamente indisponível. Conexão Redis obrigatória em produção.",
      503,
    );
  }
  if (!lockResult.acquired) {
    return fail(
      "too_many_requests",
      "Existe uma resposta sendo processada para esta conexão. Aguarde a conclusão antes de enviar nova mensagem.",
      429,
    );
  }

  try {
    // 6. Leitura do corpo e sanitização
    const rawBody = await req.text();
    if (rawBody.length > LIMITS.MAX_BODY_BYTES) {
      return fail("payload_too_large", "Corpo da requisição excede o limite permitido.", 413);
    }

    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return fail("bad_request", "Corpo da requisição malformado (JSON esperado).", 400);
    }

    const sanitized = sanitizeDemoInput({
      message: parsed.message,
      history: parsed.history,
    });

    if (!sanitized.valid || !sanitized.cleanMessage) {
      return fail("bad_request", sanitized.error || "Dados de mensagem inválidos.", 400);
    }

    // 7. Resolução do modelo via integração de IA oficial
    const resolvedModel = resolveLanguageModel(agent.model as ModelId);
    if (!resolvedModel) {
      logger.error("[demo.chat] nenhum provedor de IA compatível configurado no servidor", {
        model: agent.model,
      });
      return fail(
        "service_unavailable",
        "O serviço de inteligência artificial está temporariamente indisponível.",
        503,
      );
    }

    // 8. Montagem do contexto e execução com timeout rígido
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: agent.systemPrompt },
    ];

    if (sanitized.cleanHistory) {
      for (const h of sanitized.cleanHistory) {
        messages.push({ role: h.role, content: h.content });
      }
    }

    messages.push({ role: "user", content: sanitized.cleanMessage });

    const { text } = await generateText({
      model: resolvedModel,
      messages,
      maxOutputTokens: LIMITS.MAX_OUTPUT_TOKENS,
      temperature: 0.3,
      abortSignal: AbortSignal.timeout(LIMITS.TIMEOUT_MS),
    });

    const cleanReply = text?.trim() || "Como posso ajudar com dúvidas técnicas automotivas hoje?";

    return ok({
      response: cleanReply,
      agentName: agent.agentName,
    });
  } catch (err: unknown) {
    const isTimeout =
      (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) ||
      String(err).includes("timeout");

    if (isTimeout) {
      logger.warn("[demo.chat] timeout ao aguardar provedor de IA", { timeoutMs: LIMITS.TIMEOUT_MS });
      return fail(
        "gateway_timeout",
        "O provedor de inteligência artificial excedeu o tempo limite de resposta. Tente novamente.",
        504,
      );
    }

    logger.error("[demo.chat] erro inesperado ao executar IA", {
      detail: err instanceof Error ? err.message : String(err),
    });

    return fail(
      "internal_error",
      "Não foi possível processar sua mensagem neste momento. Por favor, tente novamente.",
      500,
    );
  } finally {
    // 9. Liberação atômica garantida: só apaga a trava se ainda pertencer à requisição atual (ownerId)
    await releaseDemoLock(token, ip, ownerId);
  }
}
