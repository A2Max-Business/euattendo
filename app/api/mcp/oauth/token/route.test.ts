import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const ctx = vi.hoisted(() => ({
  code: null as unknown,
  role: "admin",
  rows: [] as unknown[],
  scopes: ["mcp:read"],
}));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "https://crm.example" } }));
vi.mock("@/lib/auth/rate-limit", () => ({ authRateLimited: vi.fn().mockResolvedValue(false) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/mcp/oauth/estado", () => ({
  lerOAuth: vi
    .fn()
    .mockResolvedValue({
      client_id: "c".repeat(43),
      client_name: "Chat",
      redirect_uris: ["https://chatgpt.com/callback"],
    }),
  consumirOAuth: vi.fn(async () => {
    const code = ctx.code;
    ctx.code = null;
    return code;
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        not: () => chain,
        maybeSingle: async () => ({ data: { role: ctx.role }, error: null }),
        insert: (row: unknown) => {
          ctx.rows.push(row);
          return chain;
        },
        single: async () => ({ data: { id: "token-id" }, error: null }),
      };
      if (!["api_tokens", "user_organizations"].includes(table))
        throw new Error("unexpected table");
      return chain;
    },
  }),
}));
import { POST } from "./route";
const verifier = "v".repeat(43);
function request(patch = {}) {
  return new Request("https://crm.example/api/mcp/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: "a".repeat(43),
      client_id: "c".repeat(43),
      redirect_uri: "https://chatgpt.com/callback",
      resource: "https://crm.example/api/mcp",
      code_verifier: verifier,
      ...patch,
    }),
  });
}
beforeEach(() => {
  ctx.rows = [];
  ctx.role = "admin";
  ctx.code = {
    clientId: "c".repeat(43),
    redirectUri: "https://chatgpt.com/callback",
    resource: "https://crm.example/api/mcp",
    challenge: createHash("sha256").update(verifier).digest("base64url"),
    scopes: ["mcp:read"],
    organizationId: "org-trusted",
    userId: "user-trusted",
  };
});
describe("troca de código OAuth", () => {
  it("emite somente hash persistido na organização do consentimento", async () => {
    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.token_type).toBe("Bearer");
    expect(body.expires_in).toBe(86400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(ctx.rows).toHaveLength(1);
    const row = ctx.rows[0] as Record<string, unknown>;
    expect(row.organization_id).toBe("org-trusted");
    expect(row.token_hash).toBe(
      `\\x${createHash("sha256").update(body.access_token).digest("hex")}`,
    );
    expect(JSON.stringify(row)).not.toContain(body.access_token);
    expect(row.scopes).toEqual([
      "mcp:read",
      "role:admin",
      "oauth:resource:https://crm.example/api/mcp",
    ]);
    expect(body).not.toHaveProperty("refresh_token");
  });
  it("replay não emite um segundo token", async () => {
    expect((await POST(request())).status).toBe(200);
    expect((await POST(request())).status).toBe(400);
    expect(ctx.rows).toHaveLength(1);
  });
  it("PKCE errado queima o código sem criar credencial", async () => {
    expect((await POST(request({ code_verifier: "x".repeat(43) }))).status).toBe(400);
    expect((await POST(request())).status).toBe(400);
    expect(ctx.rows).toHaveLength(0);
  });
  it("revogação do papel após consentir impede emissão", async () => {
    ctx.role = "viewer";
    expect((await POST(request())).status).toBe(400);
    expect(ctx.rows).toHaveLength(0);
  });
  it.each([{ resource: "https://other/api/mcp" }, { redirect_uri: "https://evil.example" }])(
    "recusa recurso/redirect trocados",
    async (patch) => {
      expect((await POST(request(patch))).status).toBe(400);
      expect(ctx.rows).toHaveLength(0);
    },
  );
  it("código ausente ou expirado não emite", async () => {
    ctx.code = null;
    expect((await POST(request())).status).toBe(400);
    expect(ctx.rows).toHaveLength(0);
  });
});
