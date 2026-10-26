import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { withMcpAdminIdentity } from "./mcp-admin-context";
import { resolveConfigurationAuth } from "./configuration-auth";

const mocks = vi.hoisted(() => ({ session: vi.fn(), admin: { from: vi.fn() }, browser: {} }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: mocks.session }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mocks.admin }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mocks.browser }));
const identity = { organizationId: "org-a", role: "admin" as const,
  actor: { type: "api_token" as const, id: "token-a" }, apiTokenId: "token-a",
  scopes: ["config:read", "config:write"] };
beforeEach(() => vi.clearAllMocks());
describe("configuration auth", () => {
  it("uses only process-bound tenant identity and preserves token authorship", async () => {
    const req = new NextRequest("https://local/path?organization_id=org-b", {
      method: "PATCH", body: JSON.stringify({ organization_id: "org-b" }),
      headers: { "x-organization-id": "org-b" },
    });
    const result = await withMcpAdminIdentity(req, identity,
      () => resolveConfigurationAuth(req, "manager", { requestId: "request", resource: "flows" }));
    expect(result).toMatchObject({ ok: true, organizationId: "org-a", actorUserId: null,
      apiTokenId: "token-a", actor: identity.actor });
    expect(mocks.session).not.toHaveBeenCalled();
    if (result.ok) expect(await result.getClient()).toBe(mocks.admin);
  });
  it.each([
    { ...identity, role: "manager" as const },
    { ...identity, scopes: ["config:read"] },
    { ...identity, actor: { type: "ai_agent" as const, id: "run", role: "admin" } },
  ])("rejects insufficient authority before accessing data", async (invalid) => {
    const req = new NextRequest("https://local/path", { method: "PATCH" });
    const result = await withMcpAdminIdentity(req, invalid,
      () => resolveConfigurationAuth(req, "manager", { resource: "flows" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
    expect(mocks.session).not.toHaveBeenCalled();
  });
  it("does not trust serialized identity headers", async () => {
    mocks.session.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    const req = new NextRequest("https://local/path", { headers: { "x-mcp-role": "admin" } });
    const result = await resolveConfigurationAuth(req, "manager", { resource: "flows" });
    expect(result.ok).toBe(false);
    expect(mocks.session).toHaveBeenCalledWith("manager", { resource: "flows" });
  });
});
