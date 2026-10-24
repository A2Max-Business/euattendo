import { metadadosOAuth, respostaOAuth, erroOAuth, opcoesOAuth } from "@/lib/mcp/oauth/protocolo";
export const dynamic = "force-dynamic";
export function GET() {
  try {
    return respostaOAuth(metadadosOAuth());
  } catch {
    return erroOAuth("temporarily_unavailable", 503);
  }
}
export const OPTIONS = opcoesOAuth;
