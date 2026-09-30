import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

export interface DemoAgentResolved {
  token: string;
  tenantId: string;
  agentId: string;
  versionId: string;
  agentName: string;
  orgName: string;
  model: string;
  systemPrompt: string;
  welcomeMessage: string;
  isProvisional: boolean;
}

export type DemoResolveResult =
  | { ok: true; agent: DemoAgentResolved }
  | { ok: false; reason: "invalid_token" | "agent_unavailable" | "misconfigured" };

/**
 * Diretrizes obrigatórias de contenção da demonstração web.
 * - Não inventar dados da NB.
 * - Ao solicitar humano, explicar que o encaminhamento real não está ativo no teste.
 * - NUNCA dizer que registrou uma solicitação ou que alguém entrará em contato.
 * - Sem agendamentos ou ações comerciais.
 */
export const PROMPT_CONTENCAO_DEMO = `
DIRETRIZES DA DEMONSTRAÇÃO WEB (OBRIGATÓRIO):
- Você está em um ambiente de DEMONSTRAÇÃO WEB de atendimento por inteligência artificial para auto center e serviços automotivos.
- ATENDIMENTO HUMANO / TRANSBORDO: Se o cliente pedir para falar com um atendente humano, explique com total transparência: "Esta é uma demonstração interativa da inteligência artificial. O encaminhamento para um atendente humano não está ativo neste teste web, mas você pode explorar todas as dúvidas e simulações com o assistente virtual!". NUNCA diga que registrou uma solicitação, que abriu um chamado ou que alguém da equipe entrará em contato posteriormente.
- AÇÕES COMERCIAIS E AGENDAMENTOS: Esta demonstração não realiza agendamentos definitivos, não emite ordens de serviço e não envia mensagens externas.
- ANTI-ALUCINAÇÃO E LIMITES OPERACIONAIS: Não invente preços, promoções, marcas em estoque ou horários de atendimento que não constem expressamente nas suas instruções aprovadas. Se o cliente perguntar dados comerciais específicos não confirmados, oriente-o a verificar diretamente com a loja.
- TOM DE VOZ: Cordial, prestativo, profissional e objetivo.
`.trim();

/**
 * Prompt provisório estritamente neutro e sem informações inventadas.
 * Não afirma horários nem inventa catálogos não homologados.
 */
const INSTRUCOES_PROVISORIAS_NEUTRAS = `
Você é o assistente virtual em ambiente de homologação e demonstração de atendimento por inteligência artificial para auto center e serviços automotivos.

ESTADO DA DEMONSTRAÇÃO:
- Os dados cadastrais específicos da empresa (tabela de serviços, marcas de pneus disponíveis, valores, orçamentos e horários de funcionamento) estão em fase de homologação técnica e ainda não foram carregados nesta demonstração.
- Ao responder, esclareça dúvidas conceituais gerais sobre manutenção preventiva e cuidados com veículos (ex: importância do alinhamento, calibragem, rodízio preventivo de pneus e revisão de freios).
- Informe ao cliente que detalhes comerciais e operacionais definitivos devem ser consultados diretamente com a equipe da loja.
`.trim();

export function isSecureDemoToken(token: string): boolean {
  if (!token || typeof token !== "string") return false;
  const clean = token.trim();
  return clean.length >= 32 && /^[a-zA-Z0-9_-]+$/.test(clean);
}

/**
 * Resolve o agente vinculado exclusivamente no servidor com verificação de integridade.
 * Se configurado para usar o agente do banco e houver falha, retorna erro explícito (sem fallback silencioso).
 */
export async function resolveDemoAgent(token: string): Promise<DemoResolveResult> {
  if (!isSecureDemoToken(token)) {
    return { ok: false, reason: "invalid_token" };
  }

  const configuredToken = process.env.DEMO_NB_TOKEN?.trim();
  if (!configuredToken || token !== configuredToken) {
    return { ok: false, reason: "invalid_token" };
  }

  const rawMode = process.env.DEMO_MODE?.trim().toLowerCase();
  if (rawMode !== "agent" && rawMode !== "provisional") {
    logger.error("[demo.resolver] DEMO_MODE inválido ou ausente. Deve ser 'agent' ou 'provisional'", {
      demoMode: process.env.DEMO_MODE,
    });
    return { ok: false, reason: "misconfigured" };
  }
  const demoMode = rawMode;

  const configuredAgentId = process.env.DEMO_NB_AGENT_ID?.trim();
  const configuredTenantId = process.env.DEMO_NB_TENANT_ID?.trim();
  const configuredVersionId = process.env.DEMO_NB_VERSION_ID?.trim();
  const defaultModel = process.env.DEMO_DEFAULT_MODEL?.trim() || "openai/gpt-4o-mini";

  // MODO AGENTE BANCO REAL: Não aceita falhas silenciosas
  if (demoMode === "agent") {
    // Exige tenant, agente e versão explicitamente definidos
    if (!configuredTenantId || !configuredAgentId || !configuredVersionId) {
      logger.error(
        "[demo.resolver] modo agent ativo mas DEMO_NB_TENANT_ID, DEMO_NB_AGENT_ID ou DEMO_NB_VERSION_ID não definidos",
        {
          hasTenant: Boolean(configuredTenantId),
          hasAgent: Boolean(configuredAgentId),
          hasVersion: Boolean(configuredVersionId),
        },
      );
      return { ok: false, reason: "misconfigured" };
    }

    try {
      const admin = createAdminClient();

      // 1. Busca o agente com verificação estrita de tenant e integridade
      const { data: agent, error: agentErr } = await admin
        .from("ai_agents")
        .select(`
          id,
          name,
          organization_id,
          published_version_id,
          archived_at,
          organizations!inner (
            id,
            name
          )
        `)
        .eq("id", configuredAgentId)
        .eq("organization_id", configuredTenantId)
        .is("archived_at", null)
        .maybeSingle();

      if (agentErr || !agent) {
        logger.error("[demo.resolver] agente não encontrado ou incompatível com tenant", {
          agentId: configuredAgentId,
          tenantId: configuredTenantId,
          detail: agentErr?.message,
        });
        return { ok: false, reason: "agent_unavailable" };
      }

      // 2. Busca a versão exata do agente na tabela ai_agent_versions
      const { data: version, error: versionErr } = await admin
        .from("ai_agent_versions")
        .select("id, system_prompt, model, provider, status")
        .eq("id", configuredVersionId)
        .eq("organization_id", configuredTenantId)
        .eq("agent_id", configuredAgentId)
        .maybeSingle();

      if (versionErr || !version) {
        logger.error("[demo.resolver] versão do agente não encontrada", {
          versionId: configuredVersionId,
          detail: versionErr?.message,
        });
        return { ok: false, reason: "agent_unavailable" };
      }

      // 3. Confira também o status da versão antes de utilizá-la
      if (version.status !== "published") {
        logger.error("[demo.resolver] versão do agente não está com status 'published'", {
          versionId: version.id,
          status: version.status,
        });
        return { ok: false, reason: "agent_unavailable" };
      }

      const orgName = (agent.organizations as { name?: string } | null)?.name || "NB Pneus e Auto Center";
      const systemPrompt = [version.system_prompt, PROMPT_CONTENCAO_DEMO].filter(Boolean).join("\n\n");

      return {
        ok: true,
        agent: {
          token,
          tenantId: configuredTenantId,
          agentId: agent.id,
          versionId: version.id,
          agentName: agent.name || "Assistente NB",
          orgName,
          model: version.model || defaultModel,
          systemPrompt,
          welcomeMessage: "Olá! Seja bem-vindo à demonstração de atendimento da NB Pneus e Auto Center. Como posso ajudar com seu veículo hoje?",
          isProvisional: false,
        },
      };
    } catch (err) {
      logger.error("[demo.resolver] falha inesperada ao consultar Supabase", {
        detail: err instanceof Error ? err.message : String(err),
      });
      // Falha explícita, sem fallback silencioso para provisional
      return { ok: false, reason: "agent_unavailable" };
    }
  }

  // MODO PROVISÓRIO EXPLÍCITO: sem dados inventados
  return {
    ok: true,
    agent: {
      token,
      tenantId: "provisional-tenant",
      agentId: "provisional-agent",
      versionId: "provisional-version",
      agentName: "Assistente Virtual (Demonstração)",
      orgName: "NB Pneus e Auto Center",
      model: defaultModel,
      systemPrompt: `${INSTRUCOES_PROVISORIAS_NEUTRAS}\n\n${PROMPT_CONTENCAO_DEMO}`,
      welcomeMessage: "Olá! Seja bem-vindo à demonstração do assistente virtual. Como posso ajudar com dúvidas técnicas automotivas hoje?",
      isProvisional: true,
    },
  };
}
