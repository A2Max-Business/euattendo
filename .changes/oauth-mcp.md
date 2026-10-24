---
secao: adicionado
impacto: capacidade_nova
titulo: Conexão OAuth para clientes MCP externos
---
Clientes MCP podem descobrir a autenticação OAuth e solicitar acesso de leitura ou leitura/escrita. Um administrador autoriza a empresa ativa, com a mesma verificação de segurança do CRM. O acesso vence em 24 horas e pode ser revogado na tela de tokens de API; após vencer, é necessário reconectar. A primeira versão não oferece renovação automática nem novas ferramentas administrativas. Exige endereço público HTTPS e Redis compartilhado disponível. Os tokens de API existentes continuam funcionando.

A compilação também deixa de enviar estatísticas do plug-in Sentry. O monitoramento em execução continua seguindo a configuração SENTRY_DSN do operador.
