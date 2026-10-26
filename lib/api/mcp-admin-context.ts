import type { Actor } from "@/lib/api/handlers/types";
import type { Role } from "@/lib/auth/types";

/** Process-local delegation, never a header or serialized credential. */
export interface McpAdminIdentity {
  ownerUserId?: string;
  organizationId: string;
  role: Role;
  actor: Actor;
  scopes: readonly string[];
  apiTokenId: string;
}

const identities = new WeakMap<Request, Readonly<McpAdminIdentity>>();

export function getMcpAdminIdentity(request: Request): Readonly<McpAdminIdentity> | undefined {
  return identities.get(request);
}

export async function withMcpAdminIdentity<T>(
  request: Request,
  identity: McpAdminIdentity,
  operation: () => Promise<T>,
): Promise<T> {
  if (identities.has(request)) throw new Error("mcp_admin_request_already_bound");
  identities.set(request, Object.freeze({
    ...identity,
    actor: Object.freeze({ ...identity.actor }),
    scopes: Object.freeze([...identity.scopes]),
  }));
  try {
    return await operation();
  } finally {
    identities.delete(request);
  }
}
