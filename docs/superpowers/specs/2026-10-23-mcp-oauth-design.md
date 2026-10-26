# OAuth para clientes MCP externos

## Objetivo
Conectar o MCP já instalado ao ChatGPT pela opção OAuth, sem expor uma chave na conversa. A autorização é dada por administrador na organização ativa; tokens existentes continuam válidos. Destino: núcleo (identidade e autorização), sem dependência de extensão.

## Abordagens
OAuth nativo reutiliza login, MFA, organização, auditoria e revogação existentes; foi a abordagem apresentada e autorizada nesta conversa. Uma ponte exigiria outra identidade e manutenção; desabilitar autenticação não atende ao objetivo.

## Contrato da primeira versão
Authorization Code com PKCE S256 obrigatório, registro dinâmico de clientes públicos, redirects HTTPS exatos sem fragmento/credencial (sem exceção para HTTP), metadados RFC 8414/9728 e parâmetro resource obrigatório vinculado ao MCP canônico. Nada de buscar URLs de cliente no servidor. Redis compartilhado guarda clientes, consentimentos e códigos com TTL; códigos são consumidos atomicamente. Falha de Redis recusa autorização, sem fallback por processo.

A entrada OAuth entrega documento de navegação interna antes do consentimento, pois cookies existentes são SameSite=Strict. Consentimento explícito por POST, nonce de uso único, origem validada, usuário e organização vinculados ao pedido e revalidados na emissão. Sessão de suporte não emite credenciais persistentes. Acesso de leitura ou leitura/escrita é escolhido na autorização e nunca aumentado pelo cliente.

O access token é registrado em api_tokens (somente hash), prazo de 24 horas, papel admin explicitamente concedido, audiência MCP e revogação pela tela existente. Primeira versão não anuncia refresh_token: após expirar, reconectar. OAuth não converte novas rotas administrativas nem promete configurar recursos ausentes do catálogo MCP. Essas ferramentas serão uma entrega posterior com permissões config próprias.

## Aceite e limites
Provar PKCE, correspondência exata de redirect/client/resource, expiração, uso único, CSRF, isolamento entre organizações, recusas antes do efeito, metadados e preservação do Bearer legado. Rodar typecheck, lint e testes; provar fluxo real antes de instalar em produção. Build e publicação pelo CI; nenhuma edição em contêiner ativo.
