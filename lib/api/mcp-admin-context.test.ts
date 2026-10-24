import { describe, expect, it } from "vitest";
import { getMcpAdminIdentity, withMcpAdminIdentity, type McpAdminIdentity } from "./mcp-admin-context";
const identity: McpAdminIdentity = {
  organizationId: "org-a", role: "admin", apiTokenId: "token-a",
  actor: { type: "api_token", id: "token-a", role: "admin" }, scopes: ["config:read"],
};
describe("identidade delegada do MCP administrativo", () => {
  it("só vale para o objeto exato e termina com a operação", async () => {
    const request = new Request("https://example.invalid");
    await withMcpAdminIdentity(request, identity, async () => {
      expect(getMcpAdminIdentity(request)?.organizationId).toBe("org-a");
      expect(getMcpAdminIdentity(new Request(request))).toBeUndefined();
      expect(() => (getMcpAdminIdentity(request)!.scopes as string[]).push("config:write")).toThrow();
      await expect(withMcpAdminIdentity(request, identity, async () => null)).rejects.toThrow();
    });
    expect(getMcpAdminIdentity(request)).toBeUndefined();
  });
  it("limpa o vínculo quando o handler falha", async () => {
    const request = new Request("https://example.invalid");
    await expect(withMcpAdminIdentity(request, identity, async () => { throw new Error("failure"); })).rejects.toThrow("failure");
    expect(getMcpAdminIdentity(request)).toBeUndefined();
  });
  it("não troca organização entre operações simultâneas", async () => {
    await Promise.all(["org-a", "org-b"].map(async organizationId => {
      const request = new Request("https://example.invalid");
      await withMcpAdminIdentity(request, { ...identity, organizationId }, async () => {
        await Promise.resolve();
        expect(getMcpAdminIdentity(request)?.organizationId).toBe(organizationId);
      });
    }));
  });
  it("cabeçalhos não criam identidade", () => {
    const request = new Request("https://example.invalid", { headers: { "x-mcp-admin": "true", "x-organization-id": "org-a" } });
    expect(getMcpAdminIdentity(request)).toBeUndefined();
  });
});
