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
    const { error } = await db.from("api_tokens").insert({
      organization_id: organizationId, created_by: userId, name: "Prova administrativa MCP",
      prefix: bearer.slice(0, 12), token_hash: `\\x${createHash("sha256").update(bearer).digest("hex")}`,
      scopes, expires_at: new Date(Date.now() + 3600000).toISOString(),
    });
    if (error) throw error;
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
    const prompt = "Identifique a necessidade do cliente e consulte o catálogo antes de informar preços.";
    await call(admin, "crm_admin_update_agent_draft", { agent_id: id, version_id: vid,
      patch: { system_prompt: prompt, tool_ids: ["crm_list_pipelines", "crm_search_products"] } });
    const version = await call(admin, "crm_admin_get_agent_version", { agent_id: id, version_id: vid });
    expect(version.data.system_prompt).toBe(prompt);
    expect(version.data.tool_ids).toEqual(["crm_list_pipelines", "crm_search_products"]);
    expect(version.data.status).toBe("draft");
    const denied = await mcp(await token(other, scopes), "tools/call", { name: "crm_admin_get_agent", arguments: { agent_id: id } });
    expect(denied.result.isError).toBe(true);
    await page.goto("/login");
    await page.getByLabel(/e-?mail/i).fill(email);
    await page.getByLabel(/senha/i).fill(password);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page.waitForURL(/\/app(?:\/|$)/);
    await page.goto("/app/ai/agents");
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("agente-criado-por-mcp.png"), fullPage: true });
  } finally {
    for (const org of orgs) await db.from("organizations").delete().eq("id", org);
    await db.auth.admin.deleteUser(userId);
  }
});
