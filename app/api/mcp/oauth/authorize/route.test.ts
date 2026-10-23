import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "https://crm.example" } }));
vi.mock("@/lib/auth/rate-limit", () => ({ authRateLimited: vi.fn().mockResolvedValue(false) }));
vi.mock("@/lib/branding/saida", () => ({
  marcaDaSaida: vi.fn().mockResolvedValue({ nome: "CRM" }),
}));
vi.mock("@/lib/mcp/oauth/estado", () => ({
  opaco: () => "n".repeat(43),
  guardarOAuth: vi.fn(),
  lerOAuth: vi
    .fn()
    .mockResolvedValue({
      client_id: "c".repeat(43),
      redirect_uris: ["https://chatgpt.com/callback"],
    }),
}));
import { GET } from "./route";
function request(patch = {}) {
  return new Request(
    "https://crm.example/api/mcp/oauth/authorize?" +
      new URLSearchParams({
        client_id: "c".repeat(43),
        response_type: "code",
        redirect_uri: "https://chatgpt.com/callback",
        resource: "https://crm.example/api/mcp",
        state: "opaque",
        code_challenge: "v".repeat(43),
        code_challenge_method: "S256",
        ...patch,
      }),
  );
}
describe("entrada externa OAuth", () => {
  it("entrega ponte interna cujo caminho preserva o pedido ao passar pela MFA", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(`/app/settings/api-tokens/authorize/${"n".repeat(43)}`);
    expect(html).not.toContain("?request=");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(html).not.toContain("chatgpt.com/callback");
  });
  it.each([
    { redirect_uri: "https://evil.example/callback" },
    { resource: "https://other/api/mcp" },
    { code_challenge_method: "plain" },
  ])("recusa entrada inválida sem redirecionar", async (patch) => {
    const response = await GET(request(patch));
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
  });
});
