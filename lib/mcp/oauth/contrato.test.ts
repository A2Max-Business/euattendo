import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  conferirPkce,
  redirectSeguro,
  escoposPermitidos,
  conferirCodigo,
  conferirAudiencia,
} from "./contrato";

const verifier = "a".repeat(43);
const challenge = createHash("sha256").update(verifier).digest("base64url");
const code = {
  clientId: "client-a",
  redirectUri: "https://chatgpt.com/callback",
  resource: "https://crm.example/api/mcp",
  challenge,
  scopes: ["mcp:read"],
  userId: "user-a",
  organizationId: "org-a",
};
describe("contrato OAuth MCP", () => {
  it("exige PKCE S256 e verificador RFC7636", () => {
    expect(conferirPkce(verifier, challenge)).toBe(true);
    expect(conferirPkce("b".repeat(43), challenge)).toBe(false);
    expect(conferirPkce("a", challenge)).toBe(false);
  });
  it("recusa redirects inseguros, credenciais e fragmentos", () => {
    expect(redirectSeguro("https://chatgpt.com/callback")).toBe(true);
    for (const value of [
      "http://evil.example/cb",
      "javascript:alert(1)",
      "https://user:pass@example.com/cb",
      "https://example.com/cb#x",
      "https://example.com/cb?code=old",
      "https://example.com/cb?state=old",
    ])
      expect(redirectSeguro(value)).toBe(false);
  });
  it("não permite aumentar escopos nem papel via OAuth", () => {
    expect(escoposPermitidos("mcp:read mcp:write")).toEqual(["mcp:read", "mcp:write"]);
    expect(() => escoposPermitidos("role:admin")).toThrow();
    expect(() => escoposPermitidos("config:write")).toThrow();
  });
  it("vincula código ao cliente, redirect exato e recurso", () => {
    const request = {
      clientId: code.clientId,
      redirectUri: code.redirectUri,
      resource: code.resource,
      verifier,
    };
    expect(conferirCodigo(code, request)).toBe(true);
    expect(conferirCodigo(code, { ...request, clientId: "client-b" })).toBe(false);
    expect(conferirCodigo(code, { ...request, redirectUri: `${code.redirectUri}/` })).toBe(false);
    expect(conferirCodigo(code, { ...request, resource: "https://other/api/mcp" })).toBe(false);
  });
  it("OAuth só serve sua audiência; token legado permanece compatível", () => {
    expect(conferirAudiencia(["mcp:read"], undefined)).toBe(true);
    expect(conferirAudiencia([`oauth:resource:${code.resource}`], code.resource)).toBe(true);
    expect(conferirAudiencia([`oauth:resource:${code.resource}`], undefined)).toBe(false);
    expect(conferirAudiencia([`oauth:resource:${code.resource}`], "https://other/api/mcp")).toBe(
      false,
    );
  });
});
