# Administração externa da empresa — MCP Geral

Destino: núcleo (identidade/autorização e administração da empresa). Zero extensões mantém o atendimento existente.

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
- A migration 0758 permite a reserva canônica de conexão pelo backend service_role. Mantém a autorização/MFA do navegador e o mesmo corpo de reserva, leases e gatilhos de limites; não concede execução a anon.
- Sem chave de provedor exposta, credencial intermediária ou chamada HTTP interna.

## Configuração da operação

`configuration-tools.ts` delega apenas para rotas fixas; não recebe destino HTTP ou tenant arbitrário. `resolveConfigurationAuth` aceita a sessão existente ou a identidade local ligada à instância Request. Não habilita novos Bearers no REST. O cliente de banco é obtido somente quando o handler precisa dele.

As operações abrangem agentes/versões, fontes e conteúdo de conhecimento, FUP (rascunho/publicação/pausa/rollback), automações, funis, catálogo, equipe e conexões de WhatsApp. O inventário executável fica em `lib/mcp/admin/tools.ts` e `lib/mcp/admin/configuration-tools.ts`. Operações de plataforma, planos/cotas e infraestrutura não fazem parte do MCP Geral.

O criador do token é propagado como `ownerUserId` exclusivamente para vínculos humanos que o contrato existente exige (como invited_by) e a proteção de revogação do próprio acesso. A autoria do efeito continua api_token na auditoria; o ID do token nunca é gravado em uma FK de usuário.

Automações retornam URLs de webhook como referências opacas no domínio reservado `mcp-config.invalid`, sem caminho, query ou credenciais originais. Ao salvar ações, o backend restaura a referência somente a partir das ações daquela regra, já consultada dentro da empresa autenticada. Referência desconhecida é recusada; não é destino HTTP. Segredos cifrados não são aceitos como entrada externa: omitir preserva o segredo da mesma URL, informar novo secret troca e secret vazio remove. URLs novas não herdam segredos de outros destinos.

O pareamento do celular continua sendo uma ação humana; criar conexão ou obter código de pareamento não prova status WORKING. A criação exige chave UUID de idempotência, reutilizada no retry do mesmo pedido.

## Verificação e distribuição

Testes unitários exercitam a identidade, recusa de papel/escopo, edição de FUP contra duas empresas simuladas, preservação de segredos e redação das saídas. `tests/invariants/mcp-reserva-de-canal.test.ts` cobre reserva, lease, privilégio anônimo e limite contratado no banco real; o teste de MFA do navegador permanece em `channel-routing.test.ts`. O E2E de `mcp-admin-agents.spec.ts` cria rascunho, FUP, produto e convite sintéticos, recusa alterações de outro tenant e confere as telas.

A disponibilização comercial aos clientes e o MCP Master são etapas posteriores. Antes de atualizar o plugin instalado, validar imagem e baseline na VPS; não considerar a presença no catálogo prova de autorização ou de efeito persistido.

## Living System Checklist
Entrada: pedido do administrador em integração OAuth explicitamente autorizada.
Saída: rascunho, fonte, teste, publicação ou pausa retornados com estado concreto.
Dono: administrador da empresa; criação não assume ativação.
Gatilho: chamada administrativa externa, nunca turno de atendimento.
Persistência: tabelas/versionamento/filas existentes e recibos de `channel_connection_requests`.
Tempo: TTL de OAuth existente; ingestão assíncrona mantém seu estado.
Falha: resposta canônica de permissão, referência, publicação ou ingestão.
Retomada: consultar versão/fonte antes de repetir; publicação já usa operação atômica.
Visibilidade: `/app/ai/agents`, `/app/ai/followups`, `/app/products`, `/app/settings/automacoes`, equipe e conexões, nas portas já presentes em `lib/navigation/catalogo.ts`; auditoria canônica e auditoria MCP.
Mapa: mcp-agent-admin.architecture.json.
