import { randomUUID } from "node:crypto";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireRole } from "@/lib/auth/require-role";
import { guardarOAuth, lerOAuth, opaco } from "@/lib/mcp/oauth/estado";
import { segredoSchema, type PedidoOAuth, type ClienteOAuth } from "@/lib/mcp/oauth/protocolo";
import { PRAZO_PEDIDO_SEG, escoposPermitidos } from "@/lib/mcp/oauth/contrato";

export default async function AutorizarMcp({ params }: { params: Promise<{ request: string }> }) {
  const authz = await requireRole("admin", { requestId: randomUUID(), resource: "api_tokens" });
  const t = (texto: string) => traduzir(texto, authz.ok ? authz.user.idioma : "pt-BR");
  if (!authz.ok || authz.user.support)
    return (
      <p>
        {t(
          "Entre como administrador da empresa, com a verificação de segurança concluída, para autorizar esta conexão.",
        )}
      </p>
    );
  const { request } = await params;
  if (!segredoSchema.safeParse(request).success)
    return <p>{t("Pedido inválido. Reinicie a conexão no aplicativo.")}</p>;
  let prepared: { pedido: PedidoOAuth; client: ClienteOAuth; nonce: string } | null = null;
  let unavailable = false;
  try {
    const pedido = await lerOAuth<PedidoOAuth>("request", request!);
    const client = pedido ? await lerOAuth<ClienteOAuth>("client", pedido.client_id) : null;
    if (pedido && client) {
      const nonce = opaco();
      await guardarOAuth(
        "consent",
        nonce,
        { pedido, userId: authz.user.id, organizationId: authz.org.orgId },
        PRAZO_PEDIDO_SEG,
      );
      prepared = { pedido, client, nonce };
    }
  } catch {
    unavailable = true;
  }
  if (unavailable)
    return <p>{t("Não foi possível preparar a autorização. Tente novamente mais tarde.")}</p>;
  if (!prepared) return <p>{t("Pedido expirado. Reinicie a conexão no aplicativo.")}</p>;
  const { pedido, client, nonce } = prepared;
  const escopos = escoposPermitidos(pedido.scope);
  const escreve = escopos.includes("mcp:write");
  const administra = escopos.some(escopo => escopo.startsWith("config:"));
  return (
    <main className="mx-auto max-w-xl space-y-5 p-6">
      <h1 className="text-2xl font-semibold">{t("Autorizar conexão MCP")}</h1>
      <p>
        {t("Aplicativo:")}
        <strong>{client.client_name}</strong>
      </p>
      <p>
        {t("Empresa:")}
        <strong>{authz.org.name}</strong>
      </p>
      <p>
        {t("Retorno autorizado:")}
        <code className="break-all">{new URL(pedido.redirect_uri).origin}</code>
      </p>
      <p>
        {escreve
          ? t(
              "Este aplicativo poderá ler e executar ações no CRM com poder de administrador, incluindo ações que podem enviar mensagens.",
            )
          : t(
              "Este aplicativo poderá ler os dados disponíveis pelo MCP com poder de administrador.",
            )}
      </p>
      <p>
        {t(
          "O acesso vence em 24 horas. Você pode revogá-lo em Configurações → Tokens de API. Autorize somente se você iniciou esta conexão.",
        )}
      </p>
      {administra && (
        <p>{t("Esta conexão também poderá consultar a configuração dos agentes de IA.")}
          {escopos.includes("config:write") && " " + t("Poderá criar agentes, editar instruções e conhecimento, mudar permissões, testar, publicar e pausar o atendimento automático.")}
        </p>
      )}
      <form method="post" action="/api/mcp/oauth/consent" className="flex gap-4">
        <input type="hidden" name="nonce" value={nonce} />
        <button name="decision" value="allow" className="rounded-md border px-4 py-2">
          {t("Autorizar acesso")}
        </button>
        <button name="decision" value="deny" className="rounded-md border px-4 py-2">
          {t("Recusar")}
        </button>
      </form>
    </main>
  );
}
