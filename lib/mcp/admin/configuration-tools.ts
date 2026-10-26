import { z } from "zod";
import type { NextRequest } from "next/server";
import { createFollowupFlowSchema, patchFollowupFlowSchema } from "@/lib/followup/api-schemas";
import { produtoCreateSchema, produtoPatchSchema } from "@/lib/schemas/produtos";
import { createAutomationRuleSchema, updateAutomationRuleSchema } from "@/lib/schemas";
import { inviteMemberSchema, changeRoleSchema } from "@/lib/schemas";
import { createChannelSchema } from "@/lib/schemas/channels";
import { aiAccessUpdateSchema } from "@/lib/ai/elegibilidade/pre-go-live";
import type { McpAuthResult } from "../auth";
import { delegate, type AdminTool } from "./delegate";
import { configurationUrlReference } from "./url-reference";

type Handler = (req: NextRequest) => Promise<Response>;
type Input = Record<string, unknown>;
const uuid = z.string().uuid();
const byId = { id: uuid };
const faqItem = z.object({ question: z.string().min(1), answer: z.string().min(1),
  tags: z.array(z.string()).optional(), locale: z.string().optional() });

/** Return configurations, never encrypted webhook secrets or authentication headers. */
export function redactConfiguration(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactConfiguration);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) =>
    !/(secret|password|authorization|api[_-]?key)|^(token|access_token|refresh_token)$/i.test(key)
  ).map(([key, item]) => [key, key === "url" && typeof item === "string"
    ? configurationUrlReference(item) : redactConfiguration(item)]));
}

/** Fixed route adapters: the caller cannot choose a URL, method or tenant. */
export function createConfigurationTools(auth: McpAuthResult): AdminTool[] {
  function route(name: string, description: string, inputSchema: Record<string, unknown>,
    method: "GET" | "POST" | "PATCH" | "DELETE", path: (input: Input) => string,
    load: (input: Input) => Promise<Handler>, body: (input: Input) => unknown = input => input,
  ): AdminTool {
    // Erase the schemas' inferred output types at this SDK boundary; canonical
    // handlers validate them again. Comparing the entire flow graph union to
    // ZodRawShape here makes TypeScript expand every nested node/action type.
    return { name, description, inputSchema: inputSchema as z.ZodRawShape, category: method === "GET" ? "read" : "write",
      requiresRole: "admin", requiresScope: method === "GET" ? "config:read" : "config:write",
      redigirParaAuditoria: input => ({ fields: Object.keys(input),
        ...(typeof input.id === "string" ? { id: input.id } : {}) }),
      handler: async (input, ctx) => redactConfiguration(await delegate(auth,
        typeof input.idempotency_key === "string" ? { ...ctx, idempotencyKey: input.idempotency_key } : ctx, method,
        path(input), await load(input), method === "GET" ? undefined : body(input))),
    };
  }
  const flow = (i: Input) => `/api/v1/ai/followup-flows/${i.id}`;
  const source = (i: Input) => `/api/v1/ai/knowledge/sources/${i.id}`;
  return [
    route("crm_admin_archive_agent", "Arquiva o agente da empresa pela mesma regra do painel; agentes padrão podem exigir substituto. Só por pedido explícito.", byId, "DELETE", i => `/api/v1/ai/agents/${i.id}`,
      async i => { const { DELETE } = await import("@/app/api/v1/ai/agents/[id]/route");
        return req => DELETE(req, { params: Promise.resolve({ id: i.id as string }) }); }, () => ({})),
    route("crm_admin_archive_pipeline", "Arquiva um funil, preservando as verificações de dependências e o histórico. Não pede exclusão definitiva.", byId, "DELETE", i => `/api/v1/pipelines/${i.id}`,
      async i => { const { DELETE } = await import("@/app/api/v1/pipelines/[id]/route");
        return req => DELETE(req, { params: Promise.resolve({ id: i.id as string }) }); }, () => ({})),
    route("crm_admin_delete_product", "Remove produto do catálogo por pedido explícito, incluindo o tratamento canônico das fotos. Para só tirar de venda, prefira ativo=false.", byId, "DELETE", i => `/api/v1/products/${i.id}`,
      async i => { const { DELETE } = await import("@/app/api/v1/products/[id]/route");
        return req => DELETE(req, { params: Promise.resolve({ id: i.id as string }) }); }, () => ({})),
    route("crm_admin_rollback_followup_flow", "Restaura versão anterior do fluxo. Altera a versão em operação; só execute por pedido explícito após consultar a versão atual.",
      { ...byId, version_id: uuid }, "POST", i => `/api/v1/ai/followup-flows/${i.id}/rollback`,
      async i => { const { POST } = await import("@/app/api/v1/ai/followup-flows/[id]/rollback/route");
        return req => POST(req, { params: Promise.resolve({ id: i.id as string }) }); }, i => ({ version_id: i.version_id })),
    route("crm_admin_list_channels", "Lista conexões da empresa e seus estados reais. STARTING ou SCAN_QR_CODE não significa conectado.", {}, "GET", () => "/api/v1/channel-sessions",
      async () => (await import("@/app/api/v1/channel-sessions/route")).GET),
    route("crm_admin_create_channel", "Prepara uma conexão de WhatsApp, respeitando limites. O usuário ainda precisa parear o celular. Reutilize a mesma idempotency_key UUID em tentativas do mesmo pedido.",
      { ...createChannelSchema.shape, idempotency_key: uuid }, "POST", () => "/api/v1/channel-sessions",
      async () => (await import("@/app/api/v1/channel-sessions/route")).POST, i => ({ display_name: i.display_name })),
    route("crm_admin_reconnect_channel", "Reconecta um canal da empresa. force=true descarta o pareamento anterior e exige parear novamente; só use por pedido explícito.",
      { ...byId, force: z.boolean().optional() }, "POST", i => `/api/v1/channel-sessions/${i.id}/reconnect`,
      async i => { const { POST } = await import("@/app/api/v1/channel-sessions/[id]/reconnect/route");
        return req => POST(req, { params: Promise.resolve({ id: i.id as string }) }); }, i => ({ force: i.force })),
    route("crm_admin_get_pairing_code", "Solicita código de pareamento para o telefone informado. É temporário e sensível; apresente somente ao dono que está conectando. Não comprova conexão concluída.",
      { ...byId, phone_number: z.string().min(8).max(32) }, "POST", i => `/api/v1/channel-sessions/${i.id}/pairing-code`,
      async i => { const { POST } = await import("@/app/api/v1/channel-sessions/[id]/pairing-code/route");
        return req => POST(req, { params: Promise.resolve({ id: i.id as string }) }); }, i => ({ phone_number: i.phone_number })),
    route("crm_admin_rename_channel", "Altera apenas o nome interno da conexão da empresa.", { ...byId, display_name: z.string().min(1).max(80) }, "PATCH", i => `/api/v1/channel-sessions/${i.id}/name`,
      async i => { const { PATCH } = await import("@/app/api/v1/channel-sessions/[id]/name/route");
        return req => PATCH(req, { params: Promise.resolve({ id: i.id as string }) }); }, i => ({ display_name: i.display_name })),
    route("crm_admin_set_channel_disabled", "Pausa ou retoma um canal da empresa. Pausar interrompe a operação; exige pedido explícito.", { ...byId, disabled: z.boolean() }, "PATCH", i => `/api/v1/channel-sessions/${i.id}/disabled`,
      async i => { const { PATCH } = await import("@/app/api/v1/channel-sessions/[id]/disabled/route");
        return req => PATCH(req, { params: Promise.resolve({ id: i.id as string }) }); }, i => ({ disabled: i.disabled })),
    route("crm_admin_get_channel_ai_access", "Consulta se a IA atende só números de teste ou o público do canal.", byId, "GET", i => `/api/v1/channel-sessions/${i.id}/ai-access`,
      async i => { const { GET } = await import("@/app/api/v1/channel-sessions/[id]/ai-access/route");
        return req => GET(req, { params: Promise.resolve({ id: i.id as string }) }); }),
    route("crm_admin_set_channel_ai_access", "Configura números de teste e modo da IA. Liberar público real pode iniciar atendimento; exige pedido explícito.", { ...byId, ...aiAccessUpdateSchema.in.shape }, "PATCH", i => `/api/v1/channel-sessions/${i.id}/ai-access`,
      async i => { const { PATCH } = await import("@/app/api/v1/channel-sessions/[id]/ai-access/route");
        return req => PATCH(req, { params: Promise.resolve({ id: i.id as string }) }); }, i => ({ mode: i.mode, test_phone_numbers: i.test_phone_numbers })),
    route("crm_admin_list_invites", "Consulta convites da equipe e seus estados na empresa.", {}, "GET", () => "/api/v1/team/invites",
      async () => (await import("@/app/api/v1/team/invites/route")).GET),
    route("crm_admin_invite_members", "ENVIA convites para a equipe da empresa, respeitando limites. Só execute com destinatários e papéis explicitamente pedidos pelo administrador; não cria pessoas fictícias.",
      inviteMemberSchema.shape, "POST", () => "/api/v1/team/invite", async () => (await import("@/app/api/v1/team/invite/route")).POST),
    route("crm_admin_change_member_role", "Altera papel de um membro da própria empresa. Não concede administração da plataforma e não permite rebaixar o último admin.",
      { user_id: uuid, ...changeRoleSchema.shape }, "PATCH", i => `/api/v1/team/${i.user_id}/role`,
      async i => { const { PATCH } = await import("@/app/api/v1/team/[user_id]/role/route");
        return req => PATCH(req, { params: Promise.resolve({ user_id: i.user_id as string }) }); }, i => ({ role: i.role })),
    route("crm_admin_revoke_member", "Revoga acesso de membro da empresa por pedido explícito; preserva proteção do último admin.", { user_id: uuid }, "POST", i => `/api/v1/team/${i.user_id}/revoke`,
      async i => { const { POST } = await import("@/app/api/v1/team/[user_id]/revoke/route");
        return req => POST(req, { params: Promise.resolve({ user_id: i.user_id as string }) }); }, () => ({})),
    route("crm_admin_reactivate_member", "Reativa membro revogado, respeitando o limite de atendentes da empresa.", { user_id: uuid }, "POST", i => `/api/v1/team/${i.user_id}/reactivate`,
      async i => { const { POST } = await import("@/app/api/v1/team/[user_id]/reactivate/route");
        return req => POST(req, { params: Promise.resolve({ user_id: i.user_id as string }) }); }, () => ({})),
    route("crm_admin_list_followup_flows", "Lista fluxos de acompanhamento da empresa.", {}, "GET",
      () => "/api/v1/ai/followup-flows", async () => (await import("@/app/api/v1/ai/followup-flows/route")).GET),
    route("crm_admin_create_followup_flow", "Cria fluxo em rascunho; não inicia acompanhamentos. Configure o grafo e revise antes de publicar.",
      createFollowupFlowSchema.shape, "POST", () => "/api/v1/ai/followup-flows",
      async () => (await import("@/app/api/v1/ai/followup-flows/route")).POST),
    route("crm_admin_get_followup_flow", "Lê grafo, gatilho, política de handoff e versões do fluxo antes de editar.", byId, "GET", flow,
      async i => { const { GET } = await import("@/app/api/v1/ai/followup-flows/[id]/route");
        return req => GET(req, { params: Promise.resolve({ id: i.id as string }) }); }),
    route("crm_admin_update_followup_flow", "Edita rascunho, mensagens, intervalos, gatilho e condições do fluxo; não publica.",
      { ...byId, patch: patchFollowupFlowSchema }, "PATCH", flow,
      async i => { const { PATCH } = await import("@/app/api/v1/ai/followup-flows/[id]/route");
        return req => PATCH(req, { params: Promise.resolve({ id: i.id as string }) }); }, i => i.patch),
    route("crm_admin_publish_followup_flow", "PUBLICA e ATIVA o fluxo validado. Pode iniciar mensagens automáticas pelo gatilho. Somente por pedido explícito, após revisar o grafo e o público.", byId, "POST", i => `${flow(i)}/publish`,
      async i => { const { POST } = await import("@/app/api/v1/ai/followup-flows/[id]/publish/route");
        return req => POST(req, { params: Promise.resolve({ id: i.id as string }) }); }, () => ({})),
    route("crm_admin_disable_followup_flow", "Desativa o fluxo por pedido explícito. Consulte inscrições em andamento separadamente; não presume cancelamento delas.", byId, "POST", i => `${flow(i)}/disable`,
      async i => { const { POST } = await import("@/app/api/v1/ai/followup-flows/[id]/disable/route");
        return req => POST(req, { params: Promise.resolve({ id: i.id as string }) }); }, () => ({})),
    route("crm_admin_get_knowledge", "Lê conteúdo editável e metadados do material da empresa, incluindo itens FAQ.", byId, "GET", source,
      async i => { const { GET } = await import("@/app/api/v1/ai/knowledge/sources/[id]/route");
        return req => GET(req, { params: Promise.resolve({ id: i.id as string }) }); }),
    route("crm_admin_read_knowledge_content", "Lê o conteúdo legível de um material existente; não faz pesquisa semântica.", byId, "GET", i => `${source(i)}/conteudo`,
      async i => { const { GET } = await import("@/app/api/v1/ai/knowledge/sources/[id]/conteudo/route");
        return req => GET(req, { params: Promise.resolve({ id: i.id as string }) }); }),
    route("crm_admin_update_knowledge", "Renomeia material ou substitui todos os pares de FAQ. Leia antes; items vazio remove os pares. Para documento, cadastre o novo conteúdo e vincule a nova fonte. Confira indexação depois.",
      { ...byId, patch: z.object({ name: z.string().min(2).max(120).optional(), items: z.array(faqItem).optional() }) }, "PATCH", source,
      async i => { const { PATCH } = await import("@/app/api/v1/ai/knowledge/sources/[id]/route");
        return req => PATCH(req, { params: Promise.resolve({ id: i.id as string }) }); }, i => i.patch),
    route("crm_admin_archive_knowledge", "Arquiva e desativa material da empresa. Pode remover conhecimento usado no atendimento; execute por pedido explícito.", byId, "DELETE", source,
      async i => { const { DELETE } = await import("@/app/api/v1/ai/knowledge/sources/[id]/route");
        return req => DELETE(req, { params: Promise.resolve({ id: i.id as string }) }); }, () => ({})),
    route("crm_admin_reindex_knowledge", "Solicita reindexação; não significa que terminou. Consulte o estado e quantidade de trechos depois.", byId, "POST", i => `${source(i)}/reindex`,
      async i => { const { POST } = await import("@/app/api/v1/ai/knowledge/sources/[id]/reindex/route");
        return req => POST(req, { params: Promise.resolve({ id: i.id as string }) }); }, () => ({})),
    route("crm_admin_create_pipeline", "Cria funil com etapas iniciais do sistema. Consulte os funis existentes antes para evitar duplicatas.",
      { name: z.string().min(1).max(80), description: z.string().max(280).nullable().optional() }, "POST", () => "/api/v1/pipelines",
      async () => (await import("@/app/api/v1/pipelines/route")).POST),
    route("crm_admin_update_pipeline", "Edita nome, descrição, ordem ou indicação de funil padrão/clientes, preservando regras da tela.",
      { ...byId, patch: z.object({ name: z.string().min(1).max(80).optional(), description: z.string().max(280).nullable().optional(),
        is_default: z.boolean().optional(), is_client_pipeline: z.boolean().optional(), depois_de: uuid.nullable().optional() }) }, "PATCH", i => `/api/v1/pipelines/${i.id}`,
      async i => { const { PATCH } = await import("@/app/api/v1/pipelines/[id]/route");
        return req => PATCH(req, { params: Promise.resolve({ id: i.id as string }) }); }, i => i.patch),
    route("crm_admin_list_products", "Lista produtos paginados da empresa, com filtro opcional. Consulte antes de criar ou alterar preços.",
      { busca: z.string().optional(), pagina: z.number().int().min(1).default(1) }, "GET",
      i => `/api/v1/products?${new URLSearchParams({ pagina: String(i.pagina ?? 1), ...(i.busca ? { busca: String(i.busca) } : {}) })}`,
      async () => (await import("@/app/api/v1/products/route")).GET),
    route("crm_admin_create_product", "Cadastra produto no catálogo da empresa; moeda é definida pela organização. preco_cents segue o contrato do catálogo.",
      produtoCreateSchema.shape, "POST", () => "/api/v1/products", async () => (await import("@/app/api/v1/products/route")).POST),
    route("crm_admin_update_product", "Edita produto, preço, estoque e disponibilidade pelo mesmo contrato da tela.",
      { ...byId, patch: produtoPatchSchema }, "PATCH", i => `/api/v1/products/${i.id}`,
      async i => { const { PATCH } = await import("@/app/api/v1/products/[id]/route");
        return req => PATCH(req, { params: Promise.resolve({ id: i.id as string }) }); }, i => i.patch),
    route("crm_admin_list_automations", "Lê condições e ações das regras da empresa, omitindo segredos. URLs retornam referências opacas mcp-config.invalid: preserve-as ao editar a mesma regra; nunca são destinos para navegar ou chamar.", {}, "GET", () => "/api/v1/automation-rules",
      async () => (await import("@/app/api/v1/automation-rules/route")).GET),
    route("crm_admin_create_automation", "Cria regra PAUSADA, com gatilho, condições e ações. Nunca ativa no cadastro; revise antes de ligar.",
      createAutomationRuleSchema.shape, "POST", () => "/api/v1/automation-rules", async () => (await import("@/app/api/v1/automation-rules/route")).POST),
    route("crm_admin_update_automation", "Edita regra existente. Alterar regra ativa muda a operação real; revise antes. is_active=true exige pedido explícito para ativar.",
      { ...byId, patch: updateAutomationRuleSchema }, "PATCH", i => `/api/v1/automation-rules/${i.id}`,
      async i => { const { PATCH } = await import("@/app/api/v1/automation-rules/[id]/route");
        return req => PATCH(req, { params: Promise.resolve({ id: i.id as string }) }); }, i => i.patch),
    route("crm_admin_delete_automation", "Exclui permanentemente uma regra da empresa, somente por pedido explícito. Prefira desativar se precisar preservar a configuração.", byId, "DELETE", i => `/api/v1/automation-rules/${i.id}`,
      async i => { const { DELETE } = await import("@/app/api/v1/automation-rules/[id]/route");
        return req => DELETE(req, { params: Promise.resolve({ id: i.id as string }) }); }, () => ({})),
  ];
}
