import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import type * as AiModule from "ai";

const envMock: Record<string, string | undefined> = {};
vi.mock("@/lib/env", () => ({
  get env() {
    return envMock;
  },
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof AiModule>();
  return {
    ...actual,
    generateText: vi.fn(),
  };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { generateText } from "ai";
import {
  isSecureDemoToken,
  resolveDemoAgent,
} from "@/lib/demo/token-resolver";
import { isPublicPath } from "@/lib/auth/public-paths";
import {
  checkDemoRateLimit,
  acquireDemoLock,
  releaseDemoLock,
  sanitizeDemoInput,
  resetDemoRedisClientForTesting,
  setForceRedisUnavailableForTesting,
  LIMITS,
} from "@/lib/demo/rate-limit";
import { resolveLanguageModel } from "@/lib/ai/gateway";
import { POST } from "@/app/api/v1/demo/[token]/chat/route";

const TEST_TOKEN = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const TEST_TENANT_ID = "00000000-0000-0000-0000-000000000001";
const TEST_AGENT_ID = "00000000-0000-0000-0000-000000000002";
const TEST_VERSION_ID = "00000000-0000-0000-0000-000000000003";

describe("Suíte de Demonstração Web NB Pneus e Auto Center", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    for (const k of Object.keys(envMock)) delete envMock[k];
    resetDemoRedisClientForTesting();
  });

  describe("1. Validação de Tokens Seguros", () => {
    it("rejeita tokens curtos, triviais ou strings vazias", () => {
      expect(isSecureDemoToken("nb-autocenter")).toBe(false);
      expect(isSecureDemoToken("demo")).toBe(false);
      expect(isSecureDemoToken("")).toBe(false);
      expect(isSecureDemoToken("a".repeat(31))).toBe(false);
    });

    it("aceita tokens longos (>= 32 chars) e com caracteres válidos", () => {
      expect(isSecureDemoToken(TEST_TOKEN)).toBe(true);
      expect(isSecureDemoToken("a".repeat(32))).toBe(true);
    });
  });

  describe("2. Middleware e Rotas Públicas (isPublicPath)", () => {
    it("permite acesso público ao chat e metadados apenas com token", () => {
      expect(isPublicPath(`/demo/${TEST_TOKEN}`)).toBe(true);
      expect(isPublicPath(`/api/v1/demo/${TEST_TOKEN}/chat`)).toBe(true);
      expect(isPublicPath(`/api/v1/demo/${TEST_TOKEN}/info`)).toBe(true);
    });

    it("bloqueia caminhos arbitrários ou sem token", () => {
      expect(isPublicPath("/demo")).toBe(false);
      expect(isPublicPath("/demo/")).toBe(false);
      expect(isPublicPath(`/demo/${TEST_TOKEN}/admin`)).toBe(false);
    });
  });

  describe("3. Rate Limiting por IP (Troca de sessionId não burla limites)", () => {
    it("bloqueia quando o IP atinge o limite, mesmo mudando de sessionId", async () => {
      const ip = "192.168.1.100";

      for (let i = 0; i < LIMITS.IP_LIMIT_PER_MINUTE; i++) {
        const check = await checkDemoRateLimit(TEST_TOKEN, ip);
        expect(check.allowed).toBe(true);
      }

      const blocked = await checkDemoRateLimit(TEST_TOKEN, ip);
      expect(blocked.allowed).toBe(false);
      if (!blocked.allowed) {
        expect(blocked.reason).toBe("ip_limit_exceeded");
      }
    });

    it("aplica limite global independente de IPs diferentes", async () => {
      for (let i = 0; i < LIMITS.GLOBAL_LIMIT_PER_MINUTE; i++) {
        const ip = `10.0.0.${i + 1}`;
        const check = await checkDemoRateLimit(TEST_TOKEN, ip);
        expect(check.allowed).toBe(true);
      }

      const globalBlocked = await checkDemoRateLimit(TEST_TOKEN, "10.0.1.99");
      expect(globalBlocked.allowed).toBe(false);
      if (!globalBlocked.allowed) {
        expect(globalBlocked.reason).toBe("global_limit_exceeded");
      }
    });
  });

  describe("4. Trava Atômica de Concorrência e Identificador de Proprietário (ownerId)", () => {
    it("impede duas requisições simultâneas para o mesmo IP e libera apenas com o ownerId correto", async () => {
      const ip = "10.0.0.50";
      const owner1 = "owner-req-1";
      const owner2 = "owner-req-2";

      const lock1 = await acquireDemoLock(TEST_TOKEN, ip, owner1);
      expect(lock1.acquired).toBe(true);

      // Segunda tentativa para o mesmo IP enquanto a primeira está ativa é recusada
      const lock2 = await acquireDemoLock(TEST_TOKEN, ip, owner2);
      expect(lock2.acquired).toBe(false);

      // Tentativa de liberação com owner incorreto NÃO apaga a trava
      await releaseDemoLock(TEST_TOKEN, ip, "wrong-owner");
      const lock3 = await acquireDemoLock(TEST_TOKEN, ip, owner2);
      expect(lock3.acquired).toBe(false);

      // Liberação com o owner correto apaga a trava com sucesso
      await releaseDemoLock(TEST_TOKEN, ip, owner1);
      const lock4 = await acquireDemoLock(TEST_TOKEN, ip, owner2);
      expect(lock4.acquired).toBe(true);

      await releaseDemoLock(TEST_TOKEN, ip, owner2);
    });
  });

  describe("5. Sanitização de Entrada e Limites de Mensagem", () => {
    it("rejeita mensagens que ultrapassam o teto de 500 caracteres", () => {
      const oversized = "a".repeat(LIMITS.MAX_MESSAGE_CHARS + 1);
      const res = sanitizeDemoInput({ message: oversized });
      expect(res.valid).toBe(false);
      expect(res.error).toContain("500 caracteres");
    });

    it("trunca histórico para o máximo de 10 mensagens anteriores", () => {
      const largeHistory = Array.from({ length: 30 }, (_, i) => ({
        role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        content: `Msg ${i}`,
      }));

      const res = sanitizeDemoInput({ message: "Dúvida", history: largeHistory });
      expect(res.valid).toBe(true);
      expect(res.cleanHistory?.length).toBe(LIMITS.MAX_HISTORY_MESSAGES);
      expect(res.cleanHistory?.[LIMITS.MAX_HISTORY_MESSAGES - 1]?.content).toBe("Msg 29");
    });
  });

  describe("6. Resolução Estrita de DEMO_MODE, Tenant, Agente e Versão", () => {
    it("rejeita se DEMO_MODE for ausente ou inválido", async () => {
      vi.stubEnv("DEMO_NB_TOKEN", TEST_TOKEN);
      vi.stubEnv("DEMO_MODE", "modo-invalido");

      const result = await resolveDemoAgent(TEST_TOKEN);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("misconfigured");
      }
    });

    it("no modo agent: exige tenant, agente e versão definidos", async () => {
      vi.stubEnv("DEMO_NB_TOKEN", TEST_TOKEN);
      vi.stubEnv("DEMO_MODE", "agent");
      vi.stubEnv("DEMO_NB_TENANT_ID", TEST_TENANT_ID);
      // Sem DEMO_NB_AGENT_ID ou DEMO_NB_VERSION_ID
      const result = await resolveDemoAgent(TEST_TOKEN);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("misconfigured");
      }
    });

    it("no modo agent: confere o status da versão e recusa se não for 'published'", async () => {
      vi.stubEnv("DEMO_NB_TOKEN", TEST_TOKEN);
      vi.stubEnv("DEMO_MODE", "agent");
      vi.stubEnv("DEMO_NB_TENANT_ID", TEST_TENANT_ID);
      vi.stubEnv("DEMO_NB_AGENT_ID", TEST_AGENT_ID);
      vi.stubEnv("DEMO_NB_VERSION_ID", TEST_VERSION_ID);

      const { createAdminClient } = await import("@/lib/supabase/admin");
      vi.mocked(createAdminClient).mockReturnValue({
        from: (table: string) => {
          if (table === "ai_agents") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    is: () => ({
                      maybeSingle: async () => ({
                        data: {
                          id: TEST_AGENT_ID,
                          name: "Agente NB",
                          organization_id: TEST_TENANT_ID,
                          published_version_id: TEST_VERSION_ID,
                          organizations: { name: "NB Pneus" },
                        },
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "ai_agent_versions") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      // Versão em draft (não publicada)
                      maybeSingle: async () => ({
                        data: {
                          id: TEST_VERSION_ID,
                          system_prompt: "Prompt",
                          model: "openai/gpt-4o-mini",
                          status: "draft",
                        },
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          };
        },
      } as unknown as ReturnType<typeof createAdminClient>);

      const result = await resolveDemoAgent(TEST_TOKEN);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("agent_unavailable");
      }
    });

    it("no modo provisional explícito: não inventa horários ou serviços fictícios", async () => {
      vi.stubEnv("DEMO_NB_TOKEN", TEST_TOKEN);
      vi.stubEnv("DEMO_MODE", "provisional");

      const result = await resolveDemoAgent(TEST_TOKEN);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.agent.isProvisional).toBe(true);
        expect(result.agent.systemPrompt).not.toContain("08:00");
        expect(result.agent.systemPrompt).not.toContain("18:00");
        expect(result.agent.systemPrompt).toContain("em fase de homologação");
        expect(result.agent.systemPrompt).toContain("NUNCA diga que registrou uma solicitação");
      }
    });
  });

  describe("7. Integração Real de resolveLanguageModel e Parâmetros do SDK", () => {
    it("com AI_GATEWAY_API_KEY configurada, devolve a string do modelo para o gateway", () => {
      envMock.AI_GATEWAY_API_KEY = "gw-secret-key";
      const model = resolveLanguageModel("openai/gpt-4o-mini");
      expect(model).toBe("openai/gpt-4o-mini");
    });

    it("com OPENROUTER_API_KEY configurada, devolve provider compatível OpenAI", () => {
      envMock.OPENROUTER_API_KEY = "sk-or-v1-test";
      const model = resolveLanguageModel("openai/gpt-4o-mini");
      expect(model).not.toBeNull();
      expect(typeof model).not.toBe("string");
    });

    it("sem chave alguma configurada, devolve null para pular com motivo explícito", () => {
      const model = resolveLanguageModel("openai/gpt-4o-mini");
      expect(model).toBeNull();
    });
  });

  describe("8. Testes de Execução do POST da Rota (app/api/v1/demo/[token]/chat)", () => {
    const paramsPromise = Promise.resolve({ token: TEST_TOKEN });

    beforeEach(() => {
      vi.stubEnv("DEMO_NB_TOKEN", TEST_TOKEN);
      vi.stubEnv("DEMO_MODE", "provisional");
      envMock.OPENAI_API_KEY = "sk-test-mock-key";
    });

    it("Cenário de Sucesso: executa POST, valida parâmetros do SDK e retorna 200", async () => {
      vi.mocked(generateText).mockResolvedValueOnce({
        text: "O alinhamento e balanceamento devem ser feitos a cada 10.000 km.",
      } as unknown as Awaited<ReturnType<typeof generateText>>);

      const req = new NextRequest(`http://localhost/api/v1/demo/${TEST_TOKEN}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "203.0.113.10",
        },
        body: JSON.stringify({
          message: "Qual a frequência recomendada de alinhamento?",
        }),
      });

      const response = await POST(req, { params: paramsPromise });
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.data.response).toContain("alinhamento");
      expect(json.data.agentName).toBeDefined();

      // Validação dos parâmetros passados ao SDK de IA instalado
      expect(generateText).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(generateText).mock.calls[0]![0];
      expect(callArgs.maxTokens).toBe(LIMITS.MAX_OUTPUT_TOKENS);
      expect(callArgs.temperature).toBe(0.3);
      expect(callArgs.abortSignal).toBeDefined();
      expect(callArgs.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ role: "system" }),
          expect.objectContaining({
            role: "user",
            content: "Qual a frequência recomendada de alinhamento?",
          }),
        ]),
      );
    });

    it("Cenário de Timeout: captura TimeoutError do provedor e retorna 504 Gateway Timeout", async () => {
      const timeoutErr = new Error("The operation was aborted due to timeout");
      timeoutErr.name = "TimeoutError";
      vi.mocked(generateText).mockRejectedValueOnce(timeoutErr);

      const ip = "203.0.113.11";
      const req = new NextRequest(`http://localhost/api/v1/demo/${TEST_TOKEN}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": ip,
        },
        body: JSON.stringify({ message: "Simulação de timeout" }),
      });

      const response = await POST(req, { params: paramsPromise });
      expect(response.status).toBe(504);

      const json = await response.json();
      expect(json.error.code).toBe("gateway_timeout");

      // Confirma que a trava foi liberada mesmo após timeout
      const lockCheck = await acquireDemoLock(TEST_TOKEN, ip, "owner-check-after-timeout");
      expect(lockCheck.acquired).toBe(true);
      await releaseDemoLock(TEST_TOKEN, ip, "owner-check-after-timeout");
    });

    it("Cenário de Falha do Provedor: captura erro genérico, sanitiza saída e retorna 500", async () => {
      vi.mocked(generateText).mockRejectedValueOnce(new Error("Provider API 500 Internal Error"));

      const ip = "203.0.113.12";
      const req = new NextRequest(`http://localhost/api/v1/demo/${TEST_TOKEN}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": ip,
        },
        body: JSON.stringify({ message: "Simulação de falha do provedor" }),
      });

      const response = await POST(req, { params: paramsPromise });
      expect(response.status).toBe(500);

      const json = await response.json();
      expect(json.error.code).toBe("internal_error");
      // Não expõe mensagem interna ou prompt de sistema no erro do cliente
      expect(json.error.message).not.toContain("Provider API 500");

      // Confirma que a trava foi liberada no bloco finally
      const lockCheck = await acquireDemoLock(TEST_TOKEN, ip, "owner-check-after-fail");
      expect(lockCheck.acquired).toBe(true);
      await releaseDemoLock(TEST_TOKEN, ip, "owner-check-after-fail");
    });

    it("Cenário de Redis Indisponível em Produção: recusa requisição com 503", async () => {
      vi.stubEnv("NODE_ENV", "production");
      setForceRedisUnavailableForTesting(true);

      const req = new NextRequest(`http://localhost/api/v1/demo/${TEST_TOKEN}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "203.0.113.13",
        },
        body: JSON.stringify({ message: "Teste em produção sem Redis" }),
      });

      const response = await POST(req, { params: paramsPromise });
      expect(response.status).toBe(503);

      const json = await response.json();
      expect(json.error.code).toBe("service_unavailable");
      expect(json.error.message).toContain("Redis");
    });

    it("Cenário de Concorrência: bloqueia segunda requisição do mesmo IP durante o processamento", async () => {
      let resolveFirstCall: ((val: unknown) => void) | undefined;
      const firstCallPromise = new Promise((resolve) => {
        resolveFirstCall = resolve;
      });

      vi.mocked(generateText).mockImplementationOnce(() => firstCallPromise as unknown as ReturnType<typeof generateText>);

      const ip = "203.0.113.14";

      const req1 = new NextRequest(`http://localhost/api/v1/demo/${TEST_TOKEN}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({ message: "Primeira chamada demorada" }),
      });

      const req2 = new NextRequest(`http://localhost/api/v1/demo/${TEST_TOKEN}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({ message: "Segunda chamada concorrente" }),
      });

      // Dispara a primeira chamada que fica retida
      const p1 = POST(req1, { params: paramsPromise });

      // Dá um microtick para a primeira chamada adquirir a trava
      await new Promise((r) => setTimeout(r, 10));

      // Dispara a segunda chamada com o mesmo IP
      const resp2 = await POST(req2, { params: paramsPromise });
      expect(resp2.status).toBe(429);
      const json2 = await resp2.json();
      expect(json2.error.code).toBe("too_many_requests");

      // Conclui a primeira chamada
      resolveFirstCall?.({ text: "Primeira resposta pronta." });
      const resp1 = await p1;
      expect(resp1.status).toBe(200);

      // Agora que a primeira terminou e liberou a trava, uma terceira chamada tem sucesso
      vi.mocked(generateText).mockResolvedValueOnce({ text: "Terceira resposta." } as unknown as Awaited<ReturnType<typeof generateText>>);
      const req3 = new NextRequest(`http://localhost/api/v1/demo/${TEST_TOKEN}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({ message: "Terceira chamada após liberação" }),
      });

      const resp3 = await POST(req3, { params: paramsPromise });
      expect(resp3.status).toBe(200);
    });

    it("Cenário de Payload Excessivo (> 16 KB): rejeita antes de processar com 413", async () => {
      const hugeString = "x".repeat(17 * 1024);
      const req = new NextRequest(`http://localhost/api/v1/demo/${TEST_TOKEN}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "content-length": String(hugeString.length),
        },
        body: hugeString,
      });

      const response = await POST(req, { params: paramsPromise });
      expect(response.status).toBe(413);

      const json = await response.json();
      expect(json.error.code).toBe("payload_too_large");
    });
  });
});
