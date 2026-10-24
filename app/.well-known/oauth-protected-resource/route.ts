import {
  origemOAuth,
  recursoOAuth,
  respostaOAuth,
  erroOAuth,
  opcoesOAuth,
} from "@/lib/mcp/oauth/protocolo";
import { ESCOPO_OAUTH } from "@/lib/mcp/oauth/contrato";
export const dynamic = "force-dynamic";
export function GET() {
  try {
    return respostaOAuth({
      resource: recursoOAuth(),
      authorization_servers: [origemOAuth()],
      scopes_supported: ESCOPO_OAUTH,
      bearer_methods_supported: ["header"],
    });
  } catch {
    return erroOAuth("temporarily_unavailable", 503);
  }
}
export const OPTIONS = opcoesOAuth;
