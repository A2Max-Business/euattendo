# Administração externa de agentes

Destino: núcleo (identidade/autorização e administração dos agentes). Zero extensões mantém o atendimento existente.

## Caminho
OAuth com escopos config:read/config:write → validateBearerToken com audiência MCP → createAdminTools(auth) somente para integração api_token admin → registro no servidor HTTP externo → NextRequest nova com identidade imutável em WeakMap → resolveAuthDual valida os escopos reais e o papel → handlers existentes de agentes/conhecimento → validação de referências da empresa e auditoria canônicas.

O catálogo administrativo não é exportado em allTools/TOOL_CATALOG/VALID_TOOL_IDS: nem o agente de atendimento nem o operador podem escolher ferramentas que alteram suas próprias permissões. Não existe cabeçalho, cookie ou argumento para construir o vínculo WeakMap. A instância exata da requisição é a chave; cópias não herdam a autoridade e finally remove o vínculo. Tokens OAuth continuam recusados no REST.

## Limites
- Criação rascunha; publicação é operação explícita, com validação atômica existente.
- Ingestão de texto/FAQ retorna seu estado real; indexação pode continuar pendente.
- Prévia usa o sandbox; pode consumir créditos de IA, sem envio WhatsApp.
- Argumentos da auditoria administrativa registram somente campos/IDs, não prompt/conteúdo/teste.
- Listar/criar agentes e listar/criar versões preservam ainda os escopos mcp:* de seus handlers existentes; não fabricamos concessões.
- Conhecimento preserva a autorização de sessão anterior; somente delegação process-local recebe config:* e actor/token próprios. A pausa usa AuthDual e mantém admin de sessão.
- Sem schema novo, chave de provedor exposta, credencial intermediária ou chamada HTTP interna.

## Living System Checklist
Entrada: pedido do administrador em integração OAuth explicitamente autorizada.
Saída: rascunho, fonte, teste, publicação ou pausa retornados com estado concreto.
Dono: administrador da empresa; criação não assume ativação.
Gatilho: chamada administrativa externa, nunca turno de atendimento.
Persistência: tabelas/versionamento/filas existentes.
Tempo: TTL de OAuth existente; ingestão assíncrona mantém seu estado.
Falha: resposta canônica de permissão, referência, publicação ou ingestão.
Retomada: consultar versão/fonte antes de repetir; publicação já usa operação atômica.
Visibilidade: editor, conhecimento, resultados de teste e auditoria existentes.
Mapa: mcp-agent-admin.architecture.json.
