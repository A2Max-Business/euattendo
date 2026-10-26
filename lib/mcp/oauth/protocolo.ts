import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { ESCOPO_OAUTH, redirectSeguro, escoposPermitidos } from "./contrato";

export function origemOAuth(): string {
  const url = new URL(env.NEXT_PUBLIC_APP_URL);
  if (url.protocol !== "https:") throw new Error("OAuth exige NEXT_PUBLIC_APP_URL HTTPS");
  return url.origin;
}
export function recursoOAuth(): string {
  return `${origemOAuth()}/api/mcp`;
}

// OAuth exige JSON de protocolo, sem o envelope REST {data}/{error:{...}}.
export function respostaOAuth(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "X-Request-Id": randomUUID(),
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
export function erroOAuth(error: string, status = 400): Response {
  return respostaOAuth({ error }, status);
}
export function opcoesOAuth(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
export const registroSchema = z.object({
  client_name: z.string().trim().min(1).max(100).default("Cliente MCP"),
  redirect_uris: z.array(z.string().max(2048).refine(redirectSeguro)).min(1).max(5),
  token_endpoint_auth_method: z.literal("none").default("none"),
  grant_types: z.array(z.literal("authorization_code")).length(1).default(["authorization_code"]),
  response_types: z.array(z.literal("code")).length(1).default(["code"]),
});
export type ClienteOAuth = z.infer<typeof registroSchema> & { client_id: string };
export const pedidoSchema = z.object({
  response_type: z.literal("code"),
  client_id: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  redirect_uri: z.string().max(2048).refine(redirectSeguro),
  resource: z.string().max(2048),
  state: z.string().min(1).max(2048),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code_challenge_method: z.literal("S256"),
  scope: z
    .string()
    .max(200)
    .default("mcp:read")
    .refine((v) => {
      try {
        escoposPermitidos(v);
        return true;
      } catch {
        return false;
      }
    }),
});
export type PedidoOAuth = z.infer<typeof pedidoSchema>;
export interface ConsentimentoOAuth {
  pedido: PedidoOAuth;
  userId: string;
  organizationId: string;
}
export const segredoSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export function metadadosOAuth() {
  const issuer = origemOAuth();
  return {
    issuer,
    authorization_response_iss_parameter_supported: true,
    authorization_endpoint: `${issuer}/api/mcp/oauth/authorize`,
    token_endpoint: `${issuer}/api/mcp/oauth/token`,
    registration_endpoint: `${issuer}/api/mcp/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ESCOPO_OAUTH,
  };
}
