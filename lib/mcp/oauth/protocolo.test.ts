import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "https://crm.example" } }));
import { metadadosOAuth, registroSchema, pedidoSchema } from "./protocolo";
import { isPublicPath } from "@/lib/auth/public-paths";
describe("descoberta e entrada OAuth", () => {
  it("anuncia apenas métodos implementados e PKCE S256", () => {
    const m = metadadosOAuth();
    expect(m.issuer).toBe("https://crm.example");
    expect(m.code_challenge_methods_supported).toEqual(["S256"]);
    expect(m.grant_types_supported).toEqual(["authorization_code"]);
    expect(m.registration_endpoint).toBe("https://crm.example/api/mcp/oauth/register");
  });
  it("registra somente clientes públicos e redirects seguros", () => {
    expect(
      registroSchema.safeParse({ redirect_uris: ["https://chatgpt.com/callback"] }).success,
    ).toBe(true);
    expect(registroSchema.safeParse({ redirect_uris: ["http://evil/callback"] }).success).toBe(
      false,
    );
    expect(
      registroSchema.safeParse({
        redirect_uris: ["https://example.com"],
        token_endpoint_auth_method: "client_secret_basic",
      }).success,
    ).toBe(false);
  });
  it("recusa plain PKCE e escopo arbitrário antes de pedir consentimento", () => {
    const valid = {
      client_id: "a".repeat(43),
      redirect_uri: "https://chatgpt.com/callback",
      response_type: "code",
      code_challenge: "b".repeat(43),
      code_challenge_method: "S256",
      resource: "https://crm.example/api/mcp",
      state: "opaque",
    };
    expect(pedidoSchema.safeParse(valid).success).toBe(true);
    expect(pedidoSchema.safeParse({ ...valid, code_challenge_method: "plain" }).success).toBe(
      false,
    );
    expect(pedidoSchema.safeParse({ ...valid, scope: "role:admin" }).success).toBe(false);
  });
  it("libera metadados exatos na borda sem liberar caminhos vizinhos", () => {
    for (const p of [
      "/.well-known/oauth-authorization-server",
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/api/mcp",
    ])
      expect(isPublicPath(p)).toBe(true);
    expect(isPublicPath("/.well-known/oauth-authorization-server/secret")).toBe(false);
    expect(isPublicPath("/app/settings/api-tokens/authorize")).toBe(false);
  });
});
