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
