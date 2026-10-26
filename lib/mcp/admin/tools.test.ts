import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createAdminTools } from "./tools";
import { VALID_TOOL_IDS } from "../tools/catalog";
import type { McpAuthResult } from "../auth";
const auth = {
  organizationId: "org-a", apiTokenId: "token-a", role: "admin",
  actor: { type: "api_token", id: "token-a", role: "admin" },
  scopes: ["mcp:read", "mcp:write", "config:read", "config:write"],
} as McpAuthResult;
describe("catálogo administrativo só do MCP externo", () => {
  it("oferece configuração de FUP, automações e estrutura comercial sem administração da plataforma", () => {
    const names = createAdminTools(auth).map(t => t.name);
    for (const name of ["crm_admin_create_followup_flow", "crm_admin_get_followup_flow",
      "crm_admin_update_followup_flow", "crm_admin_publish_followup_flow", "crm_admin_disable_followup_flow",
      "crm_admin_create_pipeline", "crm_admin_update_pipeline", "crm_admin_create_product",
      "crm_admin_update_product", "crm_admin_create_automation", "crm_admin_update_automation",
      "crm_admin_get_knowledge", "crm_admin_update_knowledge", "crm_admin_archive_knowledge",
      "crm_admin_reindex_knowledge", "crm_admin_list_channels", "crm_admin_create_channel",
      "crm_admin_reconnect_channel", "crm_admin_get_pairing_code", "crm_admin_invite_members",
      "crm_admin_change_member_role", "crm_admin_list_invites"]) expect(names).toContain(name);
    expect(names.some(n => /tenant|platform|plan_limit/.test(n))).toBe(false);
  });
  it("não concede administração a tokens anteriores, papéis menores ou agentes", () => {
    expect(createAdminTools({ ...auth, scopes: ["mcp:read", "mcp:write"] })).toEqual([]);
    expect(createAdminTools({ ...auth, role: "manager" })).toEqual([]);
    expect(createAdminTools({ ...auth, actor: { type: "ai_agent", id: "run", role: "admin" } })).toEqual([]);
  });
  it("separa escopos de leitura e escrita sem disponibilizar ferramentas ao atendimento", () => {
    const reads = createAdminTools({ ...auth, scopes: ["config:read"] });
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every(t => t.category === "read")).toBe(true);
    for (const tool of createAdminTools(auth)) {
      expect(VALID_TOOL_IDS).not.toContain(tool.name);
      expect(tool.requiresRole).toBe("admin");
      expect(tool.redigirParaAuditoria?.({ system_prompt: "segredo", version: { system_prompt: "segredo" }, sample_message: "pessoal" })).not.toEqual(expect.objectContaining({ system_prompt: "segredo" }));
      expect(JSON.stringify(tool.redigirParaAuditoria?.({ version: { system_prompt: "segredo" } }))).not.toContain("segredo");
    }
  });
  it("valida UUIDs e a forma de versão no contrato de wire", () => {
    const tool = createAdminTools(auth).find(t => t.name === "crm_admin_get_agent")!;
    expect(z.object(tool.inputSchema).safeParse({ agent_id: "fora" }).success).toBe(false);
  });
});
