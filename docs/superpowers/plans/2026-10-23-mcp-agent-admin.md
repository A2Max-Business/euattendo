# MCP Agent Administration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Administrar agentes e conhecimento pelo MCP externo com autorização administrativa explícita.
**Architecture:** Adaptadores de ferramentas delegam aos handlers REST canônicos. Identidade autenticada fica vinculada por WeakMap à instância de requisição, sem credenciais intermediárias. Catálogo administrativo separado do catálogo de atendimento.
**Tech Stack:** Next.js, TypeScript, Zod, Supabase, MCP SDK e OAuth PKCE existentes.
**Spec:** docs/superpowers/specs/2026-10-23-mcp-agent-admin-design.md

## Global Constraints
- Sem mudança de schema ou dependência nova; mesma audiência OAuth.
- Somente admin externo com config:read/config:write; actor:ai_agent recusado.
- Reutilizar validação, auditoria, isolamento e publicação existentes.
- Conteúdo de treinamento/teste fora do audit de argumentos.

## Review Focus
- Request copiada ou cabeçalho forjado nunca herda identidade.
- Duas chamadas paralelas não trocam organização nem escopos.
- Agente de atendimento não recebe ferramenta para se reconfigurar.
- Token antigo não ganha configuração por ter mcp:write.
- Material pendente não é relatado como indexado nem rascunho como publicado.

### Task 1: Identidade interna estreita
- [ ] Testar vínculo por objeto, isolamento paralelo, limpeza em erro e recusa de ator/escopo.
- [ ] Criar lib/api/mcp-admin-context.ts; integrar leitura em resolveAuthDual sem alterar Bearer/sessão.
- [ ] Verificar testes locais possíveis e CI; commit.

### Task 2: Ferramentas administrativas
- [ ] Testar nomes, validação Zod, delegação e redaction; garantir exclusão do catálogo de atendimento.
- [ ] Criar lib/mcp/admin/tools.ts e adaptador canônico; registrar apenas no servidor externo.
- [ ] Adaptar fontes de conhecimento para AuthDual preservando sessão e ingestão.
- [ ] Verificar referências e efeitos existentes; commit.

### Task 3: Consentimento e entrega
- [ ] Testar escopos administrativos novos e tokens legados sem ampliação.
- [ ] Atualizar OAuth, aviso de consentimento traduzido, mapa e fragmento de release.
- [ ] Rodar verificações disponíveis, revisão independente, CI e imagens.
- [ ] Publicar imagem por CI; homologar leitura/rascunho com nova autorização antes de ativar agente.
