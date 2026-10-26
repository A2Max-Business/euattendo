# MCP Geral — verificação e pendências

## Implementação local

Branch: `feat/mcp-geral`, baseada em `feat/mcp-agent-admin` (PR #9 ainda aberto).
Foram acrescentadas 37 ferramentas de configuração às 14 administrativas anteriores.
O catálogo operacional existente permanece separado. Não foi feita implantação na VPS.

As decisões aplicadas foram: preservar autenticação de sessão no REST; permitir configuração
externa somente por identidade vinculada ao Request, papel admin e escopos config; preservar
MFA do navegador na reserva de conexão e permitir o backend service_role pela mesma função;
substituir URLs de webhook por referências restauráveis apenas dentro da regra consultada e
preservar segredos omitidos na edição. A prova real de banco/HTTP continua pendente.

## Evidência concluída

| Verificação | Resultado |
|---|---|
| `tsc --noEmit -p tsconfig.typecheck.json`, heap 6144 MiB | Passou; tentativas anteriores excederam memória. |
| Unitários dos módulos alterados, `vitest run --maxWorkers=2` | 33 arquivos, 351 testes passaram. |
| ESLint dos novos módulos e testes MCP/E2E/invariantes | Sem erros e sem avisos no recorte. |
| Varredura final de privilégios no baseline | 5 testes passaram após mover a migration antes da varredura. |
| Registro de idempotência e knobs da versão publicada | 2 arquivos, 21 testes passaram após registrar o propagador MCP. |
| Colisão da migration 0758 contra origin/main | Número/timestamp livres; PRs abertos e branches de terceiros não medidos (gh indisponível). |
| `git diff --check` | Passou. |

A revisão independente identificou perda de segredo no round-trip de automação e retorno de
credenciais embutidas em URLs. Ambos receberam testes de regressão e correção; estão cobertos
pelos testes locais acima. A revisão não substitui os gates de banco/E2E.

## Suítes amplas: não estão aprovadas

A rodada estrutural terminou com 334 arquivos aprovados, 7 reprovados (3301 testes aprovados,
15 reprovados). Ela leu o baseline antes da correção da ordem da migration. Os casos da ordem
do baseline e dos knobs foram repetidos e passaram; o restante observado está abaixo:

| Arquivo | Resultado observado |
|---|---|
| `tests/unit/drain-loop-carrega-deps-sob-tsx.test.ts` | 4 falhas: CLI tsx não abre socket local, EPERM. |
| `tests/unit/import-puro-sem-env.test.ts` | 3 falhas: o processo filho tsx para em listen EPERM antes da importação. |
| `tests/unit/react-pdf-resolve-sob-tsx.test.ts` | 1 falha: mesmo listen EPERM do CLI. |
| `tests/unit/seed-de-demonstracao-recusa-destino-remoto.test.ts` | 3 falhas: CLI para antes de executar a validação de destino, listen EPERM. |
| `tests/unit/e2e-preparo-tenta-de-novo.test.ts` | 2 falhas: fixture não gerou chamadas.log; o ambiente já possui ffmpeg em /usr/bin, caso que pode pular o preparo. Revalidar em CI. |
| `tests/unit/knobs-da-versao-publicada-sao-aplicados.test.ts` | Timeout de 15 s na rodada ampla; os 3 testes passaram na repetição isolada. |
| `tests/unit/varredura-anon-e-o-ultimo-bloco.test.ts` | Ordem do novo SQL incorreta; corrigida e os 5 testes passaram. |

A rodada completa do projeto produto foi interrompida pela revisão automática ao detectar
tentativa de acesso a api.anthropic.com sem comprovação de payload sintético/autorização.
Não há resultado final para essa suíte e ela não foi retomada por outro caminho. O arquivo que
originou a tentativa não foi identificado antes da interrupção. Os resultados parciais incluíram:

- `tests/unit/identificadores-que-cruzam-fronteira.test.ts`: propagador MCP ausente no inventário;
  registrado e os 18 testes passaram na repetição.
- `tests/unit/channel-adapter-zernio.test.ts`: 27 testes passaram e o caso de URL pública falhou
  com unsafe_url:dns_failed; consulta DNS isolada retornou EAI_AGAIN.
- `tests/unit/pdf-extractor.test.ts`: caso que executa o CLI tsx reprovado; os outros casos
  não substituem a prova do processo filho neste ambiente.

Não alterar guardas de rede, testes ou implementação de produto para contornar essas restrições.
Rodar a suíte completa em ambiente de CI com dados sintéticos e chamadas externas mockadas.

## Gates ainda necessários

- Banco real: `mcp-reserva-de-canal.test.ts`, `channel-routing.test.ts` (MFA), instalação e
  atualização do baseline, limites de canais, isolamento entre duas organizações.
- HTTP/UI: `tests/e2e/mcp-admin-agents.spec.ts` ampliado, incluindo agentes, FUP, produto,
  automação pausada, URL protegida, convite com autoria de token e telas correspondentes.
- Compilação de produção, suíte geral e publicação da imagem pelo CI.
- Diagnóstico da VPS, aplicação da migration e atualização controlada da imagem; só depois
  atualizar catálogo/consentimento do plugin e comprovar as ferramentas pela conexão real.

Docker/psql não estão disponíveis neste executor; os gates de banco/E2E não foram executados.

## Publicação bloqueada

A revisão automática rejeitou `git push -u origin feat/mcp-geral` para
`https://github.com/A2Max-Business/euattendo.git`, por interpretar a autorização como restrita
à implementação e validação locais, sem autorização explícita para publicar código nesse
destino. Nenhum caminho alternativo foi usado para enviar a branch ou criar PR.

Próximo passo dependente: obter autorização explícita para enviar essa branch ao repositório
e abrir um PR de validação. Isso não autoriza merge nem afirma que a VPS foi atualizada.
