import { authRateLimited } from "@/lib/auth/rate-limit";
import { respostaDePonte } from "@/lib/auth/ponte-de-volta";
import { marcaDaSaida } from "@/lib/branding/saida";
import { guardarOAuth, lerOAuth, opaco } from "@/lib/mcp/oauth/estado";
import {
  pedidoSchema,
  recursoOAuth,
  erroOAuth,
  type ClienteOAuth,
} from "@/lib/mcp/oauth/protocolo";
import { PRAZO_PEDIDO_SEG } from "@/lib/mcp/oauth/contrato";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    if (await authRateLimited("oauth_authorize", null, { ip: 60, windowSec: 300 }))
      return erroOAuth("temporarily_unavailable", 429);
    const params = new URL(req.url).searchParams;
    if ([...new Set(params.keys())].some((key) => params.getAll(key).length !== 1))
      return erroOAuth("invalid_request");
    const parsed = pedidoSchema.safeParse(Object.fromEntries(params));
    if (!parsed.success) return erroOAuth("invalid_request");
    const pedido = parsed.data;
    if (pedido.resource !== recursoOAuth()) return erroOAuth("invalid_target");
    const client = await lerOAuth<ClienteOAuth>("client", pedido.client_id);
    if (!client || !client.redirect_uris.includes(pedido.redirect_uri))
      return erroOAuth("invalid_request");
    const id = opaco();
    await guardarOAuth("request", id, pedido, PRAZO_PEDIDO_SEG);
    const marca = await marcaDaSaida(null);
    return respostaDePonte(
      `/app/settings/api-tokens/authorize/${id}`,
      marca.nome,
      "Continuar para autorizar a conexão…",
    );
  } catch {
    return erroOAuth("temporarily_unavailable", 503);
  }
}
