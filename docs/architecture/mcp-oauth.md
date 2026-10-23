# Conexão MCP por OAuth

Cliente externo → descoberta RFC 9728/8414 → registro público com redirects HTTPS exatos → pedido PKCE S256 vinculado ao recurso /api/mcp → ponte same-origin → tela de consentimento sob sessão, MFA e admin da empresa ativa → código Redis de uso único → token em api_tokens → MCP existente → auditoria existente.

Revogação: Configurações → Tokens de API → Revogar. API REST recusa os tokens vinculados exclusivamente ao MCP. Redis indisponível fecha registro, consentimento e troca de código; não há estado local substituto. Pedidos/consentimentos vencem em 10 minutos, códigos em 5 minutos; registro de cliente vence em um ano, acesso em 24 horas. Não há refresh_token nesta primeira versão. O cadastro do cliente não concede acesso: o administrador precisa consentir por conexão.

## Instalação e prova
Preparar imagem própria por CI; não editar o contêiner ativo. NEXT_PUBLIC_APP_URL deve ser a origem HTTPS pública exata. Cadastrar o MCP nessa origem em /api/mcp com OAuth. Provar no navegador: login/MFA, empresa indicada, recusa sem credencial, autorização, descoberta tools/list e revogação bloqueando chamada posterior. Provar troca da organização em outra aba recusando o consentimento antigo. Validar por duas réplicas que um código só emite uma vez.

Esta entrega mantém o catálogo existente. Editar/publicar agentes pela API REST não se torna ferramenta MCP automaticamente. A conexão não concede acesso SSH, Docker ou banco.

## Living System Checklist
1. Entrada: pedido do cliente externo com redirect previamente registrado e PKCE.
2. Saída: api_tokens alimenta validateBearerToken e o catálogo MCP existente.
3. Registro: oauth.consent_granted e token.created; chamadas em mcp.tool_called.
4. Tela: credencial OAuth aparece em ApiTokensClient; consentimento em settings/api-tokens/authorize/[request].
5. Porta: pedido validado → respostaDePonte → página de consentimento; rota dinâmica contextual, fora da navegação de telas estáticas.
6. Anti-morte: pedido/código com TTL e recusa indicando reiniciar; credencial revogável e com vencimento.
7. Configuração: autorização por conexão; revogação na tela existente, endereço HTTPS pelo ambiente existente.
8. Continuidade: operador autoriza, cliente age pelo catálogo com auditoria; retomada continua pela operação nativa.
9. Retorno: recusa impede emissão/efeito; revogação altera a validação seguinte. Sem decisão de negócio automatizada nova.
10. Mapa: mcp-oauth.architecture.json conecta entrada, consentimento, estado, tokens, MCP e auditoria.
