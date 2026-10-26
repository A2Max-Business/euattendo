import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "./gov-helpers";
import { criarOrg, criarPlano, assinar, chaveDeCobranca, erroDe } from "./cobranca-helpers";

const org = "ac900001-0000-4000-8000-000000000001";
const key = "ac900001-0000-4000-8000-000000000002";
const plan = "ac900001-0000-4000-8000-000000000003";
const fn = "public.fn_reserve_channel_connection(uuid,uuid,text,text,boolean)";
const service = `set role service_role; select set_config('request.jwt.claims', '{"role":"service_role"}', false);`;
const reserve = (k: string) => `select public.fn_reserve_channel_connection('${org}', '${k}', repeat('a',64), 'MCP', false);`;

beforeAll(() => {
  criarPlano({ id: plan, nome: "MCP um canal", maxCanais: 1 });
  criarOrg(org, "mcp-reserva-canal");
  chaveDeCobranca("ligado");
  assinar(org, plan);
});
describe("reserva de canal pelo backend do MCP", () => {
  it("não concede execução anônima e mantém a recusa de sessão sem membro", () => {
    expect(sql(`select has_function_privilege('anon','${fn}','EXECUTE');`)).toBe("f");
    expect(erroDe(`set role authenticated; select set_config('request.jwt.claims','{"role":"authenticated"}',false); ${reserve(key)}`)).toContain("connection_forbidden");
  });
  it("backend reserva pela mesma porta, preservando lease e limite contratado", () => {
    const result = sql(`${service} ${reserve(key)}`);
    expect(result).toContain('"replay": false');
    expect(result).toContain('"lease_token"');
    expect(erroDe(`${service} ${reserve(key)}`)).toContain("connection_in_progress");
    const next = "ac900001-0000-4000-8000-000000000004";
    expect(erroDe(`${service} ${reserve(next)}`)).toContain("limite_do_plano:canais:1");
    expect(sql(`select count(*) from public.channel_sessions where organization_id='${org}';`)).toBe("1");
  });
});
