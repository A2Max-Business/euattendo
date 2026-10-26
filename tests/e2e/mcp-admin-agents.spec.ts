import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { test, expect } from "./helpers/test";
import { credenciaisSupabaseDeTeste } from "../../scripts/lib/env-de-teste";

const credentials = credenciaisSupabaseDeTeste();
const db = createClient(credentials.url, credentials.serviceRole, { auth: { persistSession: false } });

test("admin externo cria e treina rascunho sem oferecer auto-administração ao atendimento", async ({ page, request }, info) => {
  test.setTimeout(180000);
  expect(["localhost", "127.0.0.1"]).toContain(new URL(credentials.dbUrl).hostname);
  const email = `admin-mcp-${randomUUID()}@invariant.test`;
  const password = `Local-${randomUUID()}!`;
  const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw created.error;
  const userId = created.data.user.id;
  const orgs: string[] = [];
  const tokenIds = new Map<string, string>();
  async function organization() {
    const { data, error } = await db.from("organizations").insert({
      slug: `admin-mcp-${randomUUID()}`, display_name: "MCP Administração", legal_name: "MCP Administração", onboarded_at: new Date().toISOString(),
    }).select("id").single();
    if (error) throw error;
    orgs.push(data.id);
    return data.id as string;
  }
  async function token(organizationId: string, scopes: string[]) {
    const bearer = `dsk_${randomBytes(32).toString("base64url")}`;
    const { data, error } = await db.from("api_tokens").insert({
      organization_id: organizationId, created_by: userId, name: "Prova administrativa MCP",
      prefix: bearer.slice(0, 12), token_hash: `\\x${createHash("sha256").update(bearer).digest("hex")}`,
      scopes, expires_at: new Date(Date.now() + 3600000).toISOString(),
    }).select("id").single();
    if (error || !data) throw error ?? new Error("Token sem ID");
    tokenIds.set(bearer, data.id);
    return bearer;
  }
  async function mcp(bearer: string, method: string, params?: Record<string, unknown>) {
    const response = await request.post("/api/mcp", {
      headers: { Authorization: `Bearer ${bearer}`, Accept: "application/json, text/event-stream" },
      data: { jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) },
    });
    expect(response.status()).toBe(200);
    const text = await response.text();
    const line = text.split("\n").find(value => value.startsWith("data:"));
    return JSON.parse(line ? line.slice(5).trim() : text);
  }
  async function call(bearer: string, name: string, args: Record<string, unknown>) {
    const result = await mcp(bearer, "tools/call", { name, arguments: args });
    expect(result.error).toBeUndefined();
    expect(result.result?.isError, result.result?.content?.[0]?.text).not.toBe(true);
    return JSON.parse(result.result.content[0].text);
  }
  try {
    const org = await organization(), other = await organization();
    const { error: membershipError } = await db.from("user_organizations").insert({ organization_id: org, user_id: userId, role: "admin", accepted_at: new Date().toISOString() });
    if (membershipError) throw membershipError;
    const scopes = ["mcp:read", "mcp:write", "config:read", "config:write", "role:admin"];
    const admin = await token(org, scopes);
    const ordinary = await token(org, ["mcp:read", "mcp:write", "role:admin"]);
    const agent = await token(org, [...scopes, "actor:ai_agent"]);
    for (const bearer of [ordinary, agent]) {
      const list = await mcp(bearer, "tools/list");
      expect(list.result.tools.some((tool: { name: string }) => tool.name.startsWith("crm_admin_"))).toBe(false);
      const refused = await mcp(bearer, "tools/call", { name: "crm_admin_get_agent_options", arguments: {} });
      expect(Boolean(refused.error || refused.result?.isError)).toBe(true);
    }
    const { data: model, error: modelError } = await db.from("ai_models")
      .select("provider, model_id").eq("supports_tools", true).is("deprecated_at", null).limit(1).single();
    if (modelError || !model) throw modelError ?? new Error("Catálogo sem modelo para testar rascunho");
    const name = `Assistente MCP ${randomUUID().slice(0, 8)}`;
    const saved = await call(admin, "crm_admin_create_agent", {
      name, version: { system_prompt: "Responda apenas com informações confirmadas da empresa.",
        provider: model.provider, model: model.model_id, credential_id: null, channel_session_id: null,
        pipeline_ids: [], knowledge_source_ids: [], tool_ids: ["crm_list_pipelines"] },
    });
    const id = saved.data.agent.id, vid = saved.data.version.id;
    expect(saved.data.agent.published_version_id).toBeNull();
    expect(saved.data.version.status).toBe("draft");
    const source = await call(admin, "crm_admin_add_knowledge", {
      name: "Política de atendimento MCP", source_type: "faq",
      markdown_blob: "## Pergunta: Como atender?\n## Resposta: Consulte informações confirmadas e não invente preços.",
    });
    expect(typeof source.data.indexacao_habilitada).toBe("boolean");
    const materials = await call(admin, "crm_admin_list_knowledge", {});
    expect(materials.data).toEqual(expect.arrayContaining([expect.objectContaining({ id: source.data.id })]));
    const prompt = "Identifique a necessidade do cliente e consulte o catálogo antes de informar preços.";
    await call(admin, "crm_admin_update_agent_draft", { agent_id: id, version_id: vid,
      patch: { system_prompt: prompt, tool_ids: ["crm_list_pipelines", "crm_search_products"], knowledge_source_ids: [source.data.id], operator_enabled: true, operator_model: `${model.provider}/${model.model_id}`, operator_tool_ids: ["crm_list_pipelines"] } });
    const version = await call(admin, "crm_admin_get_agent_version", { agent_id: id, version_id: vid });
    expect(version.data.system_prompt).toBe(prompt);
    expect(version.data.tool_ids).toEqual(["crm_list_pipelines", "crm_search_products"]);
    expect(version.data.status).toBe("draft");
    expect(version.data.knowledge_source_ids).toEqual([source.data.id]);
    expect(version.data.operator_tool_ids).toEqual(["crm_list_pipelines"]);
    expect(version.data.operator_enabled).toBe(true);
    const denied = await mcp(await token(other, scopes), "tools/call", { name: "crm_admin_get_agent", arguments: { agent_id: id } });
    expect(denied.result.isError).toBe(true);
    const otherToken = await token(other, scopes);
    const deniedPause = await mcp(otherToken, "tools/call", { name: "crm_admin_pause_agent", arguments: { agent_id: id } });
    expect(deniedPause.result.isError).toBe(true);
    const beforePause = await db.from("ai_agents").select("published_version_id, paused_at").eq("id", id).single();
    expect(beforePause.data?.published_version_id).toBeNull();
    expect(beforePause.data?.paused_at).toBeNull();
    await call(admin, "crm_admin_pause_agent", { agent_id: id });
    await expect.poll(async () => {
      const audit = await db.from("api_audit_log").select("id").eq("organization_id", org)
        .eq("action", "ai_agent.paused").eq("actor_api_token_id", tokenIds.get(admin)!);
      if (audit.error) throw audit.error;
      return audit.data.length;
    }).toBeGreaterThan(0);
    const forged = await request.post(`/api/v1/ai/agents/${id}/pause`, { headers: { "x-mcp-admin": "true", "x-organization-id": org }, data: {} });
    expect([401, 403]).toContain(forged.status());
    const flowName = `Retorno MCP ${randomUUID().slice(0, 8)}`;
    const flow = await call(admin, "crm_admin_create_followup_flow", { name: flowName });
    expect(flow.data.organization_id).toBe(org);
    await call(admin, "crm_admin_update_followup_flow", { id: flow.data.id,
      patch: { handoff_policy: "pause", trigger_config: { kind: "manual", cancel_on_reply: true } } });
    const flowSaved = await call(admin, "crm_admin_get_followup_flow", { id: flow.data.id });
    expect(flowSaved.data.trigger_config.cancel_on_reply).toBe(true);
    const deniedFlow = await mcp(otherToken, "tools/call", {
      name: "crm_admin_update_followup_flow", arguments: { id: flow.data.id, patch: { name: "Outra empresa" } },
    });
    expect(deniedFlow.result.isError).toBe(true);
    const productName = `Produto MCP ${randomUUID().slice(0, 8)}`;
    const product = await call(admin, "crm_admin_create_product", {
      codigo: `MCP-${randomUUID().slice(0, 8)}`, nome: productName, preco_cents: 12500,
    });
    await call(admin, "crm_admin_update_product", { id: product.data.id, patch: { preco_cents: 15000 } });
    const deniedProduct = await mcp(otherToken, "tools/call", {
      name: "crm_admin_update_product", arguments: { id: product.data.id, patch: { preco_cents: 1 } },
    });
    expect(deniedProduct.result.isError).toBe(true);
    const productRow = await db.from("catalog_products").select("preco_cents, organization_id").eq("id", product.data.id).single();
    expect(productRow.data).toMatchObject({ preco_cents: 15000, organization_id: org });
    const webhookUrl = "https://hooks.invariant.test/private-path?token=synthetic-credential";
    const rule = await call(admin, "crm_admin_create_automation", {
      name: `Regra MCP ${randomUUID().slice(0, 8)}`, trigger_event: "message.received",
      actions: [{ type: "call_webhook", config: { url: webhookUrl } }],
    });
    expect(rule.data.is_active).toBe(false);
    expect(JSON.stringify(rule)).not.toContain("synthetic-credential");
    await call(admin, "crm_admin_update_automation", { id: rule.data.id,
      patch: { actions: rule.data.actions, name: "Regra MCP editada" } });
    const ruleRow = await db.from("automation_rules").select("actions, is_active").eq("id", rule.data.id).single();
    expect(ruleRow.data?.actions[0].config.url).toBe(webhookUrl);
    expect(ruleRow.data?.is_active).toBe(false);
    const deniedRule = await mcp(otherToken, "tools/call", {
      name: "crm_admin_update_automation", arguments: { id: rule.data.id, patch: { name: "Outra empresa" } },
    });
    expect(deniedRule.result.isError).toBe(true);
    const pipelineName = `Funil MCP ${randomUUID().slice(0, 8)}`;
    const pipelines = await call(admin, "crm_admin_create_pipeline", { name: pipelineName });
    const pipeline = pipelines.data.pipelines.find((row: { name: string }) => row.name === pipelineName);
    expect(pipeline?.id).toBeTruthy();
    const deniedPipeline = await mcp(otherToken, "tools/call", {
      name: "crm_admin_update_pipeline", arguments: { id: pipeline.id, patch: { name: "Outra empresa" } },
    });
    expect(deniedPipeline.result.isError).toBe(true);
    const invitedEmail = `equipe-mcp-${randomUUID()}@invariant.test`;
    const invite = await call(admin, "crm_admin_invite_members", { invitations: [{ email: invitedEmail, role: "agent" }] });
    expect(invite.data.failed).toEqual([]);
    const inviteId = invite.data.sent[0].invite_id;
    const inviteRow = await db.from("team_invites").select("organization_id, invited_by, role").eq("id", inviteId).single();
    expect(inviteRow.data).toMatchObject({ organization_id: org, invited_by: userId, role: "agent" });
    await expect.poll(async () => {
      const audit = await db.from("api_audit_log").select("actor_user_id, actor_api_token_id")
        .eq("organization_id", org).eq("resource_id", inviteId).eq("action", "member.invited");
      return audit.data;
    }).toEqual(expect.arrayContaining([expect.objectContaining({ actor_user_id: null, actor_api_token_id: tokenIds.get(admin) })]));
    await page.goto("/login");
    await page.getByLabel(/e-?mail/i).fill(email);
    await page.getByLabel(/senha/i).fill(password);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page.waitForURL(/\/app(?:\/|$)/);
    await page.goto("/app/ai/agents");
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("agente-criado-por-mcp.png"), fullPage: true });
    await page.goto("/app/ai/followups");
    await expect(page.getByText(flowName, { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: info.outputPath("fluxo-criado-por-mcp.png"), fullPage: true });
    await page.goto("/app/products");
    await expect(page.getByText(productName, { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: info.outputPath("produto-criado-por-mcp.png"), fullPage: true });
  } finally {
    for (const org of orgs) await db.from("organizations").delete().eq("id", org);
    await db.auth.admin.deleteUser(userId);
  }
});
