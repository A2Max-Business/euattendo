import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireRole } from "@/lib/auth/require-role";
import { authRateLimited } from "@/lib/auth/rate-limit";
import { audit } from "@/lib/audit";
import { consumirOAuth, guardarOAuth, opaco } from "@/lib/mcp/oauth/estado";
import {
  origemOAuth,
  segredoSchema,
  erroOAuth,
  type ConsentimentoOAuth,
} from "@/lib/mcp/oauth/protocolo";
import { PRAZO_CODIGO_SEG, escoposPermitidos } from "@/lib/mcp/oauth/contrato";
const schema = z.object({ nonce: segredoSchema, decision: z.enum(["allow", "deny"]) });
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  try {
    if (req.headers.get("origin") !== origemOAuth()) return erroOAuth("access_denied", 403);
    if (await authRateLimited("oauth_consent", null, { ip: 30, windowSec: 300 }))
      return erroOAuth("temporarily_unavailable", 429);
    const authz = await requireRole("admin", { resource: "api_tokens" });
    if (!authz.ok) return authz.response;
    // Nunca transformar acompanhamento temporário em credencial persistente.
    if (authz.user.support) return erroOAuth("access_denied", 403);
    const parsed = schema.safeParse(Object.fromEntries(await req.formData()));
    if (!parsed.success) return erroOAuth("invalid_request");
    const consent = await consumirOAuth<ConsentimentoOAuth>("consent", parsed.data.nonce);
    if (!consent || consent.userId !== authz.user.id || consent.organizationId !== authz.org.orgId)
      return erroOAuth("access_denied", 403);
    const { pedido } = consent;
    const target = new URL(pedido.redirect_uri);
    target.searchParams.set("state", pedido.state);
    target.searchParams.set("iss", origemOAuth());
    if (parsed.data.decision === "deny") target.searchParams.set("error", "access_denied");
    else {
      const code = opaco();
      await guardarOAuth(
        "code",
        code,
        {
          clientId: pedido.client_id,
          redirectUri: pedido.redirect_uri,
          resource: pedido.resource,
          challenge: pedido.code_challenge,
          scopes: escoposPermitidos(pedido.scope),
          userId: consent.userId,
          organizationId: consent.organizationId,
        },
        PRAZO_CODIGO_SEG,
      );
      await audit({
        action: "oauth.consent_granted",
        actorUserId: consent.userId,
        organizationId: consent.organizationId,
        resourceType: "api_token",
        requestId: randomUUID(),
        metadata: { client_id: pedido.client_id, scopes: escoposPermitidos(pedido.scope) },
      });
      target.searchParams.set("code", code);
    }
    return new Response(null, {
      status: 303,
      headers: {
        Location: target.toString(),
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch {
    return erroOAuth("temporarily_unavailable", 503);
  }
}
