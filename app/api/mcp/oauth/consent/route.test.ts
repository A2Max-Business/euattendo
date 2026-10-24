import { beforeEach, describe, expect, it, vi } from "vitest";
const ctx = vi.hoisted(() => ({
  org: "org-a",
  user: "user-a",
  support: false,
  saved: [] as unknown[],
}));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "https://crm.example" } }));
vi.mock("@/lib/auth/rate-limit", () => ({ authRateLimited: vi.fn().mockResolvedValue(false) }));
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: vi.fn(async () => ({
    ok: true,
    user: { id: ctx.user, support: ctx.support ? {} : null },
    org: { orgId: ctx.org },
  })),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/mcp/oauth/estado", () => ({
  opaco: () => "code-generated",
  consumirOAuth: vi.fn(async () => ({
    userId: "user-a",
    organizationId: "org-a",
    pedido: {
      client_id: "client-a",
      redirect_uri: "https://chatgpt.com/callback",
      state: "state-original",
      resource: "https://crm.example/api/mcp",
      code_challenge: "challenge",
      scope: "mcp:read mcp:write",
    },
  })),
  guardarOAuth: vi.fn(async (...args: unknown[]) => {
    ctx.saved.push(args);
  }),
}));
import { POST } from "./route";
function request(origin = "https://crm.example", decision = "allow") {
  return new Request("https://crm.example/api/mcp/oauth/consent", {
    method: "POST",
    headers: { origin },
    body: new URLSearchParams({ nonce: "n".repeat(43), decision }),
  });
}
beforeEach(() => {
  ctx.org = "org-a";
  ctx.user = "user-a";
  ctx.support = false;
  ctx.saved = [];
});
describe("consentimento OAuth", () => {
  it("autoriza a organização vinculada e devolve state intacto", async () => {
    const response = await POST(request());
    expect(response.status).toBe(303);
    const target = new URL(response.headers.get("location")!);
    expect(target.searchParams.get("state")).toBe("state-original");
    expect(target.searchParams.get("code")).toBe("code-generated");
    expect(ctx.saved).toHaveLength(1);
  });
  it("outra aba trocando a organização não autoriza a empresa errada", async () => {
    ctx.org = "org-b";
    expect((await POST(request())).status).toBe(403);
    expect(ctx.saved).toHaveLength(0);
  });
  it("outro usuário não consome consentimento alheio", async () => {
    ctx.user = "user-b";
    expect((await POST(request())).status).toBe(403);
    expect(ctx.saved).toHaveLength(0);
  });
  it("suporte não vira credencial permanente", async () => {
    ctx.support = true;
    expect((await POST(request())).status).toBe(403);
    expect(ctx.saved).toHaveLength(0);
  });
  it("origem externa não autoriza nem cria código", async () => {
    expect((await POST(request("https://evil.example"))).status).toBe(403);
    expect(ctx.saved).toHaveLength(0);
  });
  it("recusar retorna access_denied sem emitir código", async () => {
    const response = await POST(request("https://crm.example", "deny"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("error=access_denied");
    expect(ctx.saved).toHaveLength(0);
  });
});
