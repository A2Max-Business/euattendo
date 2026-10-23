import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { authRateLimited } from "@/lib/auth/rate-limit";
import { audit } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { consumirOAuth, lerOAuth } from "@/lib/mcp/oauth/estado";
import {
  recursoOAuth,
  segredoSchema,
  respostaOAuth,
  erroOAuth,
  opcoesOAuth,
  type ClienteOAuth,
} from "@/lib/mcp/oauth/protocolo";
import { conferirCodigo, PRAZO_TOKEN_SEG, type CodigoOAuth } from "@/lib/mcp/oauth/contrato";
const schema = z.object({
  grant_type: z.literal("authorization_code"),
  code: segredoSchema,
  client_id: segredoSchema,
  redirect_uri: z.string().max(2048),
  resource: z.string().max(2048),
  code_verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
});
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  try {
    if (await authRateLimited("oauth_token", null, { ip: 60, windowSec: 300 }))
      return erroOAuth("temporarily_unavailable", 429);
    if (!req.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded"))
      return erroOAuth("invalid_request");
    const body = await req.text();
    if (body.length > 8192) return erroOAuth("invalid_request");
    const params = new URLSearchParams(body);
    if ([...new Set(params.keys())].some((key) => params.getAll(key).length !== 1))
      return erroOAuth("invalid_request");
    const parsed = schema.safeParse(Object.fromEntries(params));
    if (!parsed.success) return erroOAuth("invalid_request");
    const input = parsed.data;
    if (input.resource !== recursoOAuth()) return erroOAuth("invalid_target");
    const client = await lerOAuth<ClienteOAuth>("client", input.client_id);
    if (!client || !client.redirect_uris.includes(input.redirect_uri))
      return erroOAuth("invalid_client");
    // Consome antes do efeito: duas réplicas nunca emitem pelo mesmo código.
    const code = await consumirOAuth<CodigoOAuth>("code", input.code);
    if (
      !code ||
      !conferirCodigo(code, {
        clientId: input.client_id,
        redirectUri: input.redirect_uri,
        resource: input.resource,
        verifier: input.code_verifier,
      })
    )
      return erroOAuth("invalid_grant");
    const db = createAdminClient();
    // Papel é revalidado após o consentimento, sem confiar no snapshot.
    const { data: membership, error: memberError } = await db
      .from("user_organizations")
      .select("role")
      .eq("organization_id", code.organizationId)
      .eq("user_id", code.userId)
      .is("revoked_at", null)
      .not("accepted_at", "is", null)
      .maybeSingle();
    if (memberError) return erroOAuth("temporarily_unavailable", 503);
    if (membership?.role !== "admin") return erroOAuth("invalid_grant");
    const prefix = `dsk_${randomBytes(4).toString("hex")}`;
    const plaintext = `${prefix}_${randomBytes(32).toString("base64url")}`;
    const expiresAt = new Date(Date.now() + PRAZO_TOKEN_SEG * 1000).toISOString();
    const scopes = [...code.scopes, "role:admin", `oauth:resource:${code.resource}`];
    const { data: created, error } = await db
      .from("api_tokens")
      .insert({
        organization_id: code.organizationId,
        created_by: code.userId,
        name: `OAuth: ${client.client_name}`.slice(0, 100),
        prefix,
        token_hash: `\\x${createHash("sha256").update(plaintext).digest("hex")}`,
        scopes,
        expires_at: expiresAt,
      })
      .select("id")
      .single();
    if (error || !created) return erroOAuth("temporarily_unavailable", 503);
    await audit({
      action: "token.created",
      actorUserId: code.userId,
      organizationId: code.organizationId,
      resourceType: "api_token",
      resourceId: created.id,
      requestId: randomUUID(),
      metadata: { via: "oauth", client_id: input.client_id, scopes, expires_at: expiresAt },
    });
    return respostaOAuth({
      access_token: plaintext,
      token_type: "Bearer",
      expires_in: PRAZO_TOKEN_SEG,
      scope: code.scopes.join(" "),
    });
  } catch {
    return erroOAuth("temporarily_unavailable", 503);
  }
}
export const OPTIONS = opcoesOAuth;
