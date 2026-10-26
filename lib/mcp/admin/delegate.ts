import { NextRequest } from "next/server";
import { withMcpAdminIdentity } from "@/lib/api/mcp-admin-context";
import { McpAuthError, ensureRole, ensureScope, type McpAuthResult } from "../auth";
import type { McpContext, McpToolDefinition } from "../types";
export type AdminTool = Omit<McpToolDefinition, "requiresScope"> & {
  requiresScope: "config:read" | "config:write";
};
type Handler = (request: NextRequest) => Promise<Response>;

export async function delegate(
  auth: McpAuthResult, ctx: McpContext, method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string, handler: Handler, body?: unknown,
): Promise<unknown> {
  if (auth.actor.type !== "api_token" || ctx.contatoDoTurno ||
      ctx.organizationId !== auth.organizationId || ctx.apiTokenId !== auth.apiTokenId)
    throw new McpAuthError(-32002, 403, "Administração disponível apenas à integração externa.");
  ensureRole(auth.role, "admin");
  ensureScope(auth.scopes, method === "GET" ? "config:read" : "config:write");
  // No network, cookies, Authorization or caller-selected destination. Only this
  // freshly constructed Request receives the process-local identity.
  const request = new NextRequest(`https://mcp.internal.invalid${path}`, {
    method, ...(body === undefined ? {} : {
      headers: { "Content-Type": "application/json", "X-Request-Id": ctx.requestId, ...(ctx.idempotencyKey ? { "Idempotency-Key": ctx.idempotencyKey } : {}) }, body: JSON.stringify(body),
    }),
  });
  return withMcpAdminIdentity(request, {
    ownerUserId: auth.ownerUserId,
    organizationId: auth.organizationId, actor: auth.actor, role: auth.role,
    apiTokenId: auth.apiTokenId, scopes: auth.scopes,
  }, async () => {
    const response = await handler(request);
    const payload = response.status === 204 ? { data: { deleted: true } } : await response.json();
    if (!response.ok) {
      const error = payload as { error?: { code?: string; message?: string } };
      throw new McpAuthError(-32002, response.status,
        `${error.error?.code ?? "config_error"}: ${error.error?.message ?? "Operação recusada."}`);
    }
    return payload;
  });
}
