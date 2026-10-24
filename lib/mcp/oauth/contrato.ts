import { createHash, timingSafeEqual } from "node:crypto";

export const ESCOPO_OAUTH_PADRAO = "mcp:read";
export const ESCOPO_OAUTH = ["mcp:read", "mcp:write", "config:read", "config:write"] as const;
export const PRAZO_CODIGO_SEG = 300;
export const PRAZO_PEDIDO_SEG = 600;
export const PRAZO_TOKEN_SEG = 24 * 60 * 60;

export interface CodigoOAuth {
  clientId: string;
  redirectUri: string;
  resource: string;
  challenge: string;
  scopes: string[];
  userId: string;
  organizationId: string;
}

export function redirectSeguro(valor: string): boolean {
  try {
    const url = new URL(valor);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      !url.searchParams.has("code") &&
      !url.searchParams.has("state") &&
      !url.searchParams.has("error") &&
      !url.searchParams.has("iss")
    );
  } catch {
    return false;
  }
}

export function escoposPermitidos(valor: string): string[] {
  const scopes = [...new Set(valor.split(" ").filter(Boolean))];
  if (scopes.length === 0 || scopes.some((s) => !(ESCOPO_OAUTH as readonly string[]).includes(s))) {
    throw new Error("invalid_scope");
  }
  return scopes;
}

export function conferirPkce(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !/^[A-Za-z0-9_-]{43}$/.test(challenge))
    return false;
  const expected = createHash("sha256").update(verifier).digest("base64url");
  return timingSafeEqual(Buffer.from(expected), Buffer.from(challenge));
}

export function conferirCodigo(
  codigo: CodigoOAuth,
  pedido: { clientId: string; redirectUri: string; resource: string; verifier: string },
): boolean {
  return (
    codigo.clientId === pedido.clientId &&
    codigo.redirectUri === pedido.redirectUri &&
    codigo.resource === pedido.resource &&
    conferirPkce(pedido.verifier, codigo.challenge)
  );
}

/** Tokens OAuth são restritos ao recurso MCP; Bearers legados não mudam. */
export function conferirAudiencia(scopes: string[], resource: string | undefined): boolean {
  const audiencias = scopes.filter((s) => s.startsWith("oauth:resource:"));
  return (
    audiencias.length === 0 ||
    (typeof resource === "string" && audiencias.length === 1 && audiencias[0] === `oauth:resource:${resource}`)
  );
}
