---
secao: adicionado
impacto: capacidade_nova
titulo: Administração da empresa pelo MCP Geral
---
Integrações administrativas externas podem configurar fluxos de follow-up, automações, funis, produtos, conhecimento, convites e papéis da equipe, além de preparar e reconectar números de WhatsApp e configurar o alcance da IA. A empresa vem do token e não pode ser trocada nos argumentos. Exige papel admin e escopos config:read/config:write explicitamente autorizados; tokens antigos não recebem novos poderes. Algumas operações preservam também a exigência mcp:read/mcp:write. As ferramentas ficam fora do catálogo dos agentes de atendimento. Publicar fluxos, ativar automações, convidar pessoas e mudar canais são efeitos explícitos. Segredos de webhook e suas URLs não são devolvidos: referências opacas preservam a configuração ao editar a mesma regra. A atualização aplica a migration 0758 do baseline para permitir a reserva de conexões pelo backend, preservando limites, leases e verificações de sessão/MFA para o navegador. Não inclui administração da plataforma, criação de tenants, alteração de cotas ou acesso à VPS.
