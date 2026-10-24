import { authRateLimited } from "@/lib/auth/rate-limit";
import { guardarOAuth, opaco } from "@/lib/mcp/oauth/estado";
import { registroSchema, respostaOAuth, erroOAuth, opcoesOAuth } from "@/lib/mcp/oauth/protocolo";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  try {
    if (await authRateLimited("oauth_register", null, { ip: 10, windowSec: 3600 }))
      return erroOAuth("temporarily_unavailable", 429);
    const body = await req.text();
    if (body.length > 16384) return erroOAuth("invalid_client_metadata");
    let raw: unknown;
    try { raw = JSON.parse(body); } catch { return erroOAuth("invalid_client_metadata"); }
    const parsed = registroSchema.safeParse(raw);
    if (!parsed.success) return erroOAuth("invalid_client_metadata");
    const client = { ...parsed.data, client_id: opaco() };
    await guardarOAuth("client", client.client_id, client, 365 * 24 * 60 * 60);
    return respostaOAuth({ ...client, client_id_issued_at: Math.floor(Date.now() / 1000) }, 201);
  } catch {
    return erroOAuth("temporarily_unavailable", 503);
  }
}
export const OPTIONS = opcoesOAuth;
