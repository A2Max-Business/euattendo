/** External administrative capabilities. Never export through tools/index or the agent catalog. */
import { z } from "zod";
import {
  agentMcpCreateSchema, agentMcpPatchSchema, versionCreateSchema, versionPatchSchema,
  publishSchema, testRunSchema,
} from "@/lib/ai/agents/validation";
import { TOOL_CATALOG } from "@/lib/mcp/tools/catalog";
import { McpAuthError, type McpAuthResult } from "../auth";
import type { McpToolDefinition } from "../types";

import { delegate, type AdminTool } from "./delegate";
import { createConfigurationTools } from "./configuration-tools";
const uuid = z.string().uuid();

/** Called only by server.ts, with identity already validated for this HTTP MCP request. */
export function createAdminTools(auth: McpAuthResult): AdminTool[] {
  if (auth.actor.type !== "api_token" || auth.role !== "admin" || auth.orgSuspensa) return [];
  function tool(name: string, description: string, inputSchema: z.ZodRawShape,
    category: "read" | "write", handler: McpToolDefinition["handler"]): AdminTool {
    return {
      name, description, inputSchema, category, requiresRole: "admin",
      requiresScope: category === "read" ? "config:read" : "config:write",
      redigirParaAuditoria: args => ({
        fields: Object.keys(args),
        ...(typeof args.agent_id === "string" ? { agent_id: args.agent_id } : {}),
        ...(typeof args.version_id === "string" ? { version_id: args.version_id } : {}),
      }),
      handler,
    };
  }
  const definitions: AdminTool[] = [
    ...createConfigurationTools(auth),
    tool("crm_admin_list_agents", "Lista os agentes da empresa para configuração administrativa; não ativa atendimento.",
      { include_archived: z.boolean().optional() }, "read", async (input, ctx) => {
        const { GET } = await import("@/app/api/v1/ai/agents/route");
        return delegate(auth, ctx, "GET", `/api/v1/ai/agents?include_archived=${input.include_archived === true}`, GET);
      }),
    tool("crm_admin_get_agent", "Consulta o cadastro de um agente e sua configuração; use o UUID retornado pela listagem.",
      { agent_id: uuid }, "read", async (input, ctx) => {
        const { GET } = await import("@/app/api/v1/ai/agents/[id]/route");
        const id = input.agent_id as string;
        return delegate(auth, ctx, "GET", `/api/v1/ai/agents/${id}`, req => GET(req, { params: Promise.resolve({ id }) }));
      }),
    tool("crm_admin_create_agent", "Cria agente com primeira versão RASCUNHO. Instruções, ferramentas, canal, funis e fontes são validados; não publica nem começa a atender. Consulte as opções e os materiais antes. Exige também mcp:write pelo contrato de criação existente.",
      agentMcpCreateSchema.shape, "write", async (input, ctx) => {
        const { POST } = await import("@/app/api/v1/ai/agents/route");
        return delegate(auth, ctx, "POST", "/api/v1/ai/agents", POST, agentMcpCreateSchema.parse(input));
      }),
    tool("crm_admin_update_agent", "Edita nome, descrição e prioridade do agente. Para treinar, alterar permissões ou vincular canal/conhecimento, edite uma versão em rascunho.",
      { agent_id: uuid, patch: agentMcpPatchSchema }, "write", async (input, ctx) => {
        const { PATCH } = await import("@/app/api/v1/ai/agents/[id]/route");
        const id = input.agent_id as string;
        return delegate(auth, ctx, "PATCH", `/api/v1/ai/agents/${id}`, req => PATCH(req, { params: Promise.resolve({ id }) }), input.patch);
      }),
    tool("crm_admin_list_agent_versions", "Lista versões do agente, distinguindo rascunho, publicada e substituída.",
      { agent_id: uuid }, "read", async (input, ctx) => {
        const { GET } = await import("@/app/api/v1/ai/agents/[id]/versions/route");
        const id = input.agent_id as string;
        return delegate(auth, ctx, "GET", `/api/v1/ai/agents/${id}/versions`, req => GET(req, { params: Promise.resolve({ id }) }));
      }),
    tool("crm_admin_get_agent_version", "Lê a configuração completa de uma versão antes de preparar alterações: instruções, permissões, canal, conhecimento e limites.",
      { agent_id: uuid, version_id: uuid }, "read", async (input, ctx) => {
        const { GET } = await import("@/app/api/v1/ai/agents/[id]/versions/[vid]/route");
        const id = input.agent_id as string, vid = input.version_id as string;
        return delegate(auth, ctx, "GET", `/api/v1/ai/agents/${id}/versions/${vid}`, req => GET(req, { params: Promise.resolve({ id, vid }) }));
      }),
    tool("crm_admin_create_agent_version", "Cria nova versão em RASCUNHO, sem substituir a publicada. Consulte a versão atual e preserve os campos que não devem mudar. tool_ids são as permissões do agente; knowledge_source_ids seleciona os materiais que ele pode usar.",
      { agent_id: uuid, version: versionCreateSchema }, "write", async (input, ctx) => {
        const { POST } = await import("@/app/api/v1/ai/agents/[id]/versions/route");
        const id = input.agent_id as string;
        return delegate(auth, ctx, "POST", `/api/v1/ai/agents/${id}/versions`, req => POST(req, { params: Promise.resolve({ id }) }), input.version);
      }),
    tool("crm_admin_update_agent_draft", "Edita somente uma versão em RASCUNHO: instruções, ferramentas permitidas, materiais, canal, funis e limites. Uma versão já publicada não é alterada. Salvar não publica.",
      { agent_id: uuid, version_id: uuid, patch: versionPatchSchema }, "write", async (input, ctx) => {
        const { PATCH } = await import("@/app/api/v1/ai/agents/[id]/versions/[vid]/route");
        const id = input.agent_id as string, vid = input.version_id as string;
        return delegate(auth, ctx, "PATCH", `/api/v1/ai/agents/${id}/versions/${vid}`, req => PATCH(req, { params: Promise.resolve({ id, vid }) }), input.patch);
      }),
    tool("crm_admin_publish_agent", "PUBLICA uma versão e pode colocar o agente em atendimento real no canal/roteador vinculado. Só execute por pedido explícito para ativar/publicar, após revisar configuração e teste; nunca use como teste de conexão. A publicação valida referências e é atômica.",
      { agent_id: uuid, ...publishSchema.shape }, "write", async (input, ctx) => {
        const { POST } = await import("@/app/api/v1/ai/agents/[id]/publish/route");
        const id = input.agent_id as string;
        return delegate(auth, ctx, "POST", `/api/v1/ai/agents/${id}/publish`, req => POST(req, { params: Promise.resolve({ id }) }), { version_id: input.version_id });
      }),
    tool("crm_admin_test_agent_version", "Executa a prévia da versão no sandbox canônico, sem enviar WhatsApp. Pode consumir créditos de IA e registra o teste. Não publica nem ativa o agente.",
      { agent_id: uuid, version_id: uuid, ...testRunSchema.shape }, "write", async (input, ctx) => {
        const { POST } = await import("@/app/api/v1/ai/agents/[id]/versions/[vid]/test/route");
        const id = input.agent_id as string, vid = input.version_id as string;
        return delegate(auth, ctx, "POST", `/api/v1/ai/agents/${id}/versions/${vid}/test`, req => POST(req, { params: Promise.resolve({ id, vid }) }), { sample_message: input.sample_message, sample_contact: input.sample_contact });
      }),
    tool("crm_admin_pause_agent", "Pausa um agente e interrompe seu atendimento automático. Só execute quando o administrador pedir para pausar. Mantém o histórico e a referência da versão publicada.",
      { agent_id: uuid }, "write", async (input, ctx) => {
        const { POST } = await import("@/app/api/v1/ai/agents/[id]/pause/route");
        const id = input.agent_id as string;
        return delegate(auth, ctx, "POST", `/api/v1/ai/agents/${id}/pause`, req => POST(req, { params: Promise.resolve({ id }) }), {});
      }),
    tool("crm_admin_list_knowledge", "Lista fontes de conhecimento e o estado real da indexação. Cadastrar material não significa que já foi indexado.",
      {}, "read", async (_input, ctx) => {
        const { GET } = await import("@/app/api/v1/ai/knowledge/sources/route");
        return delegate(auth, ctx, "GET", "/api/v1/ai/knowledge/sources", GET);
      }),
    tool("crm_admin_add_knowledge", "Cadastra texto de treinamento ou FAQ na ingestão canônica. O material pertence à empresa; vincule seu ID à versão do agente. Retorna id, quantidade de itens e se a indexação está habilitada; consulte crm_admin_list_knowledge para verificar o estado real, last_index_status e chunks_count antes de afirmar que foi indexado. Para FAQ, use pares ## Pergunta: e ## Resposta:. Não recebe senhas ou chaves.",
      { name: z.string().trim().min(2).max(120), source_type: z.enum(["documento", "faq"]),
        markdown_blob: z.string().trim().min(1).max(100000) }, "write", async (input, ctx) => {
        const { POST } = await import("@/app/api/v1/ai/knowledge/sources/route");
        return delegate(auth, ctx, "POST", "/api/v1/ai/knowledge/sources", POST, input);
      }),
    tool("crm_admin_get_agent_options", "Consulta o catálogo local de modelos, ferramentas permitidas ao atendimento, canais e referências de credencial para configurar agentes. Não revela chaves nem concede ferramentas administrativas aos agentes. A publicação confirma disponibilidade e compatibilidade do modelo.",
      {}, "read", async (_input, ctx) => {
        if (ctx.organizationId !== auth.organizationId || ctx.contatoDoTurno)
          throw new McpAuthError(-32002, 403, "Contexto administrativo inválido.");
        const [channels, credentials, models] = await Promise.all([
          ctx.supabase.from("channel_sessions").select("id, display_name, status").eq("organization_id", ctx.organizationId).is("archived_at", null),
          ctx.supabase.from("ai_provider_credentials_safe").select("id, provider, label, validated_at").eq("organization_id", ctx.organizationId),
          ctx.supabase.from("ai_models").select("id, provider, model_id, display_name, supports_tools").is("deprecated_at", null).limit(2000),
        ]);
        if (channels.error || credentials.error || models.error) throw new Error("Não foi possível consultar as opções de configuração.");
        return { channels: channels.data, credentials: credentials.data, models: models.data,
          tools: TOOL_CATALOG.map(t => ({ id: t.name, description: t.explicacao, risk: t.risco })) };
      }),
  ];
  const legacyRead = new Set(["crm_admin_list_agents", "crm_admin_list_agent_versions", "crm_admin_list_followup_flows"]);
  const legacyWrite = new Set(["crm_admin_create_agent", "crm_admin_create_agent_version", "crm_admin_create_followup_flow"]);
  return definitions.filter(definition => auth.scopes.includes(definition.requiresScope)
    && (!legacyRead.has(definition.name) || auth.scopes.includes("mcp:read"))
    && (!legacyWrite.has(definition.name) || auth.scopes.includes("mcp:write")));

}
