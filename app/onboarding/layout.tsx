import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { loadOnboardingState } from "@/app/actions/onboarding/_shared";
import { Stepper } from "./_components/Stepper";
import { OutrasOrganizacoes } from "./_components/OutrasOrganizacoes";
import { SkipToEnd } from "./_components/SkipToEnd";
import { branding } from "@/lib/branding";
import { marcaDaInstalacao } from "@/lib/branding/instalacao";
import { iconeDaAba } from "@/lib/branding/icone";
import { baseDoStorage } from "@/lib/branding/logo";
import { passosVisiveis } from "@/lib/onboarding/passos";
import { env } from "@/lib/env";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  // Acompanhamento observa a organização incompleta no shell com saída explícita.
  if (user.support) redirect("/app/inbox");
  // Sem organização o onboarding não tem o que mostrar — mas mandar para
  // `/login` fechava o círculo: quem entrasse de novo voltaria para cá. A saída
  // é a tela que CRIA a organização que falta.
  if (!activeOrg) redirect("/get-started");

  const { state, onboardedAt } = await loadOnboardingState(activeOrg.orgId);
  if (onboardedAt) redirect("/app/inbox");

  // Os passos que ESTA instalação oferece, com o que já foi resolvido. O
  // indicador não decide mais nada sozinho — ele desenha o que recebe.
  const passos = passosVisiveis({ lojaLigada: env.NUVEMSHOP_ENABLED }).map((p) => ({
    segmento: p.segmento,
    rotulo: p.rotulo,
    cumprido: p.cumprido(state),
  }));

  const isDev = process.env.NODE_ENV !== "production";
  const marca = branding();
  // Ícone pequeno de REFORÇO, nunca o logotipo completo: o nome já é escrito
  // como legenda ao lado (`marca.name`), então usar o logo inteiro aqui duplica
  // a marca em dois formatos ao mesmo tempo. `iconeDaAba` é a mesma resolução
  // de `app/icon.tsx` — arquivo subido em Marca › ícone da aba, com fallback
  // para o ladrilho desenhado quando não há upload.
  const linhaDaMarca = await marcaDaInstalacao();
  const iconeUrl = iconeDaAba(linhaDaMarca?.favicon_path, baseDoStorage());

  return (
    <IdiomaProvider locale={user.idioma}>
      <div className="flex min-h-screen flex-col bg-muted/40">
        <header className="border-b bg-background">
          <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              {/* O nome está escrito logo abaixo — o símbolo é reforço, não legenda.
                <img> em vez de next/image de propósito, mesmo motivo de
                `components/shell/Sidebar.tsx`: a URL vem de quem hospeda (banco),
                fora da allowlist de domínios fechada no build da imagem
                pré-buildada. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={iconeUrl}
                alt={marca.name}
                decoding="async"
                className="h-9 w-9 rounded-md object-contain"
              />
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">{marca.name}</p>
                <h1 className="text-lg font-semibold tracking-tight">{activeOrg.name}</h1>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {/*
                A SAÍDA, para quem tem outra organização. Ver o cabeçalho de
                `OutrasOrganizacoes`: sem ela, trocar de organização pelo seletor
                do topo levava a um wizard sem porta de volta — o layout de `/app`
                sai da árvore e leva o `TenantSwitcher` junto.
              */}
              <OutrasOrganizacoes
                outras={user.organizations
                  .filter((o) => o.organization_id !== activeOrg.orgId)
                  .map((o) => ({ id: o.organization_id, nome: o.organization_name }))}
              />
              {isDev ? <SkipToEnd /> : null}
            </div>
          </div>
          <div className="mx-auto w-full max-w-3xl px-4 pb-2">
            <Stepper passos={passos} />
          </div>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">{children}</main>
      </div>
    </IdiomaProvider>
  );
}
