/**
 * AS TELAS DO NEGÓCIO E DO CONTATO PARAM DE ESCREVER BRASIL EM DURO.
 *
 * Medido numa instalação real, em EUR e com o funil em euro: o diálogo do
 * negócio anunciava "Valor (R$)" e o do contato pedia "CPF (opcional)" com o
 * exemplo `+5511999998888`. O valor ERA gravado em euro (a moeda vem da
 * organização desde o #1435) e a API já valida o documento pelo perfil do país
 * (`contactCreateSchemaDoPais`, issue #1033) — quem estava fora do acordo era a
 * tela, que cravava os dois literais.
 *
 * O país sintético é o mesmo recurso que `pais-da-organizacao-governa-documento-
 * e-lei.test.ts` usa: o registro é mutável de propósito, para provar o mecanismo
 * sem publicar citação de lei que ninguém revisou.
 */
import { readFileSync } from "node:fs";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render as renderRTL, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { PERFIS_DO_PAIS, type PerfilDoPais } from "@/lib/legal/perfil-do-pais";

const orgAtiva = vi.hoisted(() => ({ atual: null as { currency?: string | null; country?: string | null } | null }));
vi.mock("@/hooks/auth/AuthProvider", () => ({ useActiveOrg: () => orgAtiva.atual }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
vi.mock("@/lib/api/client", () => ({ apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));

import { NewContactDialog } from "@/components/contacts/NewContactDialog";
import { LeadFieldsForm } from "@/components/kanban/LeadFieldsForm";

const XISTAO: PerfilDoPais = {
  codigo: "XI",
  nome: "Xistão",
  telefoneExemplo: "+999123456789",
  documento: {
    rotulo: "Bilhete",
    exemplo: "003862011LA042",
    regra: "confere a forma, não o dígito",
    mensagemInvalido: "Bilhete inválido",
    confereDigito: false,
    apelidosDoCabecalho: ["bilhete"],
    valida: () => true,
    normaliza: (v) => v,
  },
  lei: null,
  calendario: { feriados: [], rotulo: "feriados do Xistão" },
  padroesDePii: [],
};

const NEGOCIO = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Negócio",
  description: null,
  value_cents: 24990,
  currency: "EUR",
  stage_id: "22222222-2222-4222-8222-222222222222",
  expected_close_date: null,
  tags: [],
  custom_fields: {},
} as never;

/** O provedor de consultas que os dois diálogos exigem para montar. */
function render(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderRTL(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeAll(() => {
  PERFIS_DO_PAIS.XI = XISTAO;
});

afterEach(() => {
  cleanup();
  orgAtiva.atual = null;
});

describe("o valor do negócio usa a moeda da organização", () => {
  it("organização em euro lê 'Valor (€)'", () => {
    orgAtiva.atual = { currency: "EUR", country: null };
    render(<LeadFieldsForm lead={NEGOCIO} pipelineId="33333333-3333-4333-8333-333333333333" />);
    expect(screen.getByText(/Valor \(€\)/)).toBeTruthy();
  });

  it("e quem está em real continua lendo 'Valor (R$)'", () => {
    orgAtiva.atual = { currency: "BRL", country: null };
    render(<LeadFieldsForm lead={NEGOCIO} pipelineId="33333333-3333-4333-8333-333333333333" />);
    expect(screen.getByText(/Valor \(R\$\)/)).toBeTruthy();
  });
});

describe("o documento e o exemplo de telefone seguem o país da organização", () => {
  it("país com documento próprio: o rótulo e os dois exemplos são dele", () => {
    orgAtiva.atual = { currency: "EUR", country: "XI" };
    render(<NewContactDialog open onOpenChange={() => {}} />);
    expect(screen.getByText(/Bilhete \(opcional\)/)).toBeTruthy();
    expect(screen.getByPlaceholderText("+999123456789")).toBeTruthy();
    expect(screen.getByPlaceholderText("003862011LA042")).toBeTruthy();
  });

  it("sem país declarado, vale o Brasil — nada muda para quem já usa", () => {
    orgAtiva.atual = { currency: "BRL", country: null };
    render(<NewContactDialog open onOpenChange={() => {}} />);
    expect(screen.getByText(/CPF \(opcional\)/)).toBeTruthy();
    expect(screen.getByPlaceholderText("+5511999998888")).toBeTruthy();
  });
});

/**
 * Os casos acima simulam `useActiveOrg`, então nenhum deles nota se a moeda e o
 * país deixarem de VIAJAR até o cliente. Este aqui prende o fio: sem as duas
 * colunas no embed da membership, as telas voltam a cair no padrão sem nada
 * ficar vermelho.
 */
describe("a organização ativa leva moeda e país ao cliente", () => {
  it("o embed da membership pede as duas colunas", () => {
    const fonte = readFileSync("lib/auth/server.ts", "utf8");
    expect(fonte).toMatch(/organizations\(display_name, locale, timezone, currency, country\)/);
    expect(fonte).toContain("currency: org?.currency ?? null");
    expect(fonte).toContain("country: org?.country ?? null");
  });
});
