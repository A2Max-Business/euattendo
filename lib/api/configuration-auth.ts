import { getMcpAdminIdentity } from "./mcp-admin-context";
import { fail } from "./wrappers";
import { requireRole } from "@/lib/auth/require-role";
import type { Role } from "@/lib/auth/types";
import { McpAuthError, ensureRole, ensureScope } from "@/lib/mcp/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/** Opt-in for configuration routes: browser session or a process-bound MCP request.
 * No header can select the tenant or turn a public HTTP request into delegation.
 * Token effects keep token authorship; a token id must never enter a user FK.
 */
export async function resolveConfigurationAuth(
  req: Request,
  role: Role,
  opts: { requestId?: string; resource?: string; allowPlatformAdmin?: boolean | "leitura" },
) {
  const identity = getMcpAdminIdentity(req);
  if (identity) {
    try {
      if (identity.actor.type !== "api_token" || identity.actor.id !== identity.apiTokenId)
        throw new McpAuthError(-32002, 403, "Integração administrativa inválida.");
      ensureRole(identity.role, "admin");
      ensureRole(identity.role, role);
      ensureScope([...identity.scopes], req.method === "GET" ? "config:read" : "config:write");
    } catch (error) {
      if (!(error instanceof McpAuthError)) throw error;
      return { ok: false as const, response: fail("forbidden", error.message, 403, opts) };
    }
    return { ok: true as const, organizationId: identity.organizationId,
      actor: identity.actor, actorUserId: null, apiTokenId: identity.apiTokenId,
      ownerUserId: identity.ownerUserId ?? null,
      displayName: "Integração administrativa", organizationName: "",
      idioma: "pt-BR" as const, role: identity.role, via: "token" as const,
      getClient: async () => createAdminClient() };
  }
  const session = await requireRole(role, opts);
  if (!session.ok) return session;
  return { ok: true as const, organizationId: session.org.orgId,
    actor: { type: "user" as const, id: session.user.id }, actorUserId: session.user.id,
    ownerUserId: session.user.id,
    displayName: session.user.full_name ?? session.user.email ?? "Um colega", organizationName: session.org.name,
    apiTokenId: null, idioma: session.user.idioma, role: session.org.role,
    via: "session" as const, getClient: createClient };
}
