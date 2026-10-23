# Evidência de implementação OAuth MCP

Branch: feat/mcp-oauth. Base: 3361a54607a31168715d273ec49c20a09ac93efc.
VPS diagnosticada: 48739b8889b59b3117ab90058cac486740cf62f0; a base da branch
inclui esse commit e os ajustes posteriores de infraestrutura já presentes no GitHub.

## Medido
- 361 testes relevantes passaram em 12 arquivos: OAuth, Bearer existente, navegação,
  mapas de arquitetura, i18n espanhol e tokens Tailwind.
- TypeScript completo passou após ajustar o evento no catálogo de auditoria; a
  primeira execução estourou o heap padrão de 2 GiB e foi repetida com 8 GiB.
- ESLint dos arquivos afetados passou após remover JSX de dentro do try/catch.
- lint-channels e lint-role-rank passaram usando node --import tsx.
- Conferência dos fragmentos de release passou sem escrever versão.
- Revisão independente identificou perda do pedido na MFA; corrigida pelo segmento
  dinâmico [request] e teste de entrada que conserva o pedido no caminho.

## Não medido / bloqueado
- Fluxo real navegador → login/MFA → consentimento → ChatGPT, expiração de TTL no
  Redis real entre réplicas e revogação em banco real ainda precisam de homologação.
- O teste de estado usa adaptador Redis simulado; prova uma única saída pela chamada
  GETDEL, mas não substitui ensaio da atomicidade/TTL no Redis de produção.
- A suíte unitária completa foi iniciada; os problemas observados incluem
  namespace-das-imagens (deploy/swarm/prepare_crm.py, já na base), subprocessos tsx
  recusados pelo ambiente (listen EPERM em Unix socket), testes de FFmpeg, seed de
  demonstração e URL pública Zernio. Também falhou pdf-extractor.test.ts.
  Arquivos com falhas observadas: namespace-das-imagens.test.ts,
  import-puro-sem-env.test.ts, e2e-preparo-tenta-de-novo.test.ts,
  react-pdf-resolve-sob-tsx.test.ts, seed-de-demonstracao-recusa-destino-remoto.test.ts,
  drain-loop-carrega-deps-sob-tsx.test.ts, channel-adapter-zernio.test.ts e
  pdf-extractor.test.ts. A rodada ampla não teve conclusão confirmada neste ambiente. O teste de i18n e o de Tailwind inicialmente
  apontaram defeitos da tela nova; ambos foram corrigidos e passaram na rodada final.
- Build: compilação Turbopack chegou a “Compiled successfully”; a revisão automática
  bloqueou a continuidade porque o build tentou contatar Sentry. Não se afirma
  build completo, imagem publicada ou prontidão para produção.

## Entrega operacional
Nenhuma alteração foi aplicada à VPS. Não abrir PR que dispare builds externos nem
publicar imagem antes de resolver o envio ao Sentry de forma autorizada.
A primeira versão conecta o catálogo já existente; não dá acesso ao Docker, SSH,
nem transforma endpoints de configuração de agentes em ferramentas MCP.
