# Administração de agentes por MCP

## Intenção e autorização
Alex autorizou ampliar a integração existente para criar agentes, configurar instruções e conhecimento, definir ferramentas e vincular sua operação. A primeira versão preserva as regras e serviços usados pela tela. Código e publicação na branch de desenvolvimento autorizados; a nova permissão OAuth exige consentimento na conexão, sem ampliar tokens existentes.

## Abordagens
1. Duplicar mutações e validações do REST no MCP: rejeitada por divergência de publicação, auditoria e escopo entre portas.
2. Chamar a API por HTTP com credenciais de serviço: rejeitada; criaria credenciais adicionais e poderia contornar audiência OAuth.
3. Reutilizar os handlers canônicos no processo, com identidade autenticada vinculada à instância exata de NextRequest por WeakMap: proposta escolhida pelo implementador. Não usa cabeçalhos de confiança, organização do input, token adicional nem loopback de rede. resolveAuthDual valida papel/escopo canônicos também nesta entrada. O vínculo existe apenas durante a chamada e é apagado em finally.

## Contrato
- Ferramentas administrativas são registradas apenas pelo servidor HTTP MCP e somente para admin com config:read/config:write; não entram em allTools, TOOL_CATALOG ou VALID_TOOL_IDS do atendimento.
- O contexto vem de McpAuthResult validado em cada requisição, não dos argumentos. Uma integração actor:ai_agent é recusada mesmo se trouxer papel admin e os novos escopos.
- OAuth anuncia os escopos novos e o consentimento explica edição de instruções, conhecimento, permissões e publicação. Tokens antigos não mudam e precisam de nova autorização.
- A conexão mantém a audiência exclusiva /api/mcp. Nenhum token OAuth passa a funcionar diretamente no REST.
- Ferramentas: listar/consultar agentes e versões; criar rascunho; editar cadastro; criar/editar versão; publicar; pausar pelo contrato canônico; testar versão; listar opções (ferramentas de atendimento, canais, modelos e referências de credencial sem segredos); cadastrar conhecimento por texto/FAQ e listar fontes.
- Prompt, conteúdo de conhecimento e texto de teste são retirados dos argumentos da auditoria MCP; a auditoria de efeito das rotas permanece.
- Organização suspensa, teto por token/organização, referências de outra empresa, ferramentas inexistentes e versão publicada imutável continuam recusados pelos gates existentes.
- Conhecimento: usar a mesma ingestão e fila da tela. A criação retorna o identificador e se a indexação está habilitada; consultar a lista para conhecer o estado real. Material cadastrado não significa indexação concluída. Upload binário e edição de fluxos FUP ficam fora desta entrega.
- Teste de versão usa o sandbox existente; não envia WhatsApp. Publicar é ação separada e pode ligar atendimento; não será chamado como teste.

## Dados e prova
Sem mudança de schema. Reusar config:read/config:write já existentes. Preservar sessões/MFA e controles de suporte das rotas. Testes: identidade por instância e isolamento concorrente; recusa de papel/escopo/ator/ausência de vínculo; limpeza após erro; catálogo do atendimento sem ferramentas administrativas; chamadas com referências cruzadas; OAuth recusa escopos desconhecidos e autoriza apenas o solicitado; redaction de conteúdo. CI deve executar tipos, lint, suíte unitária, banco, navegação e imagens antes de produção. Homologação começa por leitura e rascunho; ativação exige pedido concreto.
