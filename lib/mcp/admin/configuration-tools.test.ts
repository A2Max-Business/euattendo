import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminTools } from "./tools";
import { redactConfiguration } from "./configuration-tools";
import type { McpAuthResult } from "../auth";
import type { McpContext } from "../types";
import { z } from "zod";

const state = vi.hoisted(() => ({ from: vi.fn(), session: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: state.from }) }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: state.session }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => null }));
vi.mock("@/lib/audit", () => ({ audit: state.audit }));

const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const auth: McpAuthResult = { organizationId: "org-a", apiTokenId: "token-a", role: "admin",
  actor: { type: "api_token", id: "token-a" }, scopes: ["mcp:read", "mcp:write", "config:read", "config:write"] };
const ctx = { organizationId: "org-a", apiTokenId: "token-a", role: "admin", actor: auth.actor,
  requestId: "request" } as McpContext;

beforeEach(() => vi.clearAllMocks());
describe("MCP Geral through canonical configuration handlers", () => {
  it("updates only the authenticated tenant, including token audit authorship", async () => {
    const rows = [{ id, organization_id: "org-a", name: "Antes" }, { id: other, organization_id: "org-b", name: "Outra" }];
    state.from.mockImplementation(() => {
      const filters: Record<string, unknown> = {};
      let patch: Record<string, unknown> = {};
      const match = () => rows.find(row => Object.entries(filters).every(([k, v]) => row[k as keyof typeof row] === v));
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters[key] = value; return query; },
        update: (value: Record<string, unknown>) => { patch = value; return query; },
        maybeSingle: async () => ({ data: match() ?? null, error: null }),
        single: async () => { const row = match(); if (row) Object.assign(row, patch); return { data: row, error: null }; },
      };
      return query;
    });
    const tool = createAdminTools(auth).find(t => t.name === "crm_admin_update_followup_flow")!;
    const result = await tool.handler({ id, patch: { name: "Novo" } }, ctx);
    expect(result).toMatchObject({ data: { id, name: "Novo" } });
    await expect(tool.handler({ id: other, patch: { name: "Invadido" } }, ctx)).rejects.toThrow(/not_found/);
    expect(rows[1]?.name).toBe("Outra");
    expect(state.session).not.toHaveBeenCalled();
    expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: null, actorApiTokenId: "token-a", organizationId: "org-a",
    }));
  });
  it("rejects a changed tenant context before any database query", async () => {
    const tool = createAdminTools(auth).find(t => t.name === "crm_admin_update_product")!;
    await expect(tool.handler({ id, patch: { nome: "Produto" } }, { ...ctx, organizationId: "org-b" })).rejects.toThrow(/externa/);
    expect(state.from).not.toHaveBeenCalled();
  });
  it("keeps secrets out of nested configuration responses and audit arguments", () => {
    const result = redactConfiguration({ actions: [{ type: "call_webhook", config: {
      url: "https://example.test", secret_enc: "ciphertext", webhook_secret_encrypted: "ciphertext",
      headers: { Authorization: "Bearer value", "X-Api-Key": "key" },
    } }] });
    expect(JSON.stringify(result)).not.toMatch(/ciphertext|Bearer value|"key"/);
    expect(result).toMatchObject({ actions: [{ config: { url: expect.stringContaining("https://mcp-config.invalid/url/") } }] });
    const tool = createAdminTools(auth).find(t => t.name === "crm_admin_create_automation")!;
    expect(JSON.stringify(tool.redigirParaAuditoria?.({ actions: [{ secret: "sensitive" }] }))).not.toContain("sensitive");
  });
  it("validates idempotency before requesting a channel connection", () => {
    const tool = createAdminTools(auth).find(t => t.name === "crm_admin_create_channel")!;
    expect(z.object(tool.inputSchema).safeParse({ display_name: "Vendas" }).success).toBe(false);
    expect(z.object(tool.inputSchema).safeParse({ display_name: "Vendas", idempotency_key: id }).success).toBe(true);
  });
  it("requires an explicit audience mode before opening AI access", () => {
    const tool = createAdminTools(auth).find(t => t.name === "crm_admin_set_channel_ai_access")!;
    const schema = z.object(tool.inputSchema);
    expect(schema.safeParse({ id }).success).toBe(false);
    expect(schema.safeParse({ id, mode: "pre_go_live", test_phone_numbers: [] }).success).toBe(true);
  });
});
