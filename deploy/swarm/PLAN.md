# Supabase no Swarm existente

Escopo autorizado: gerar uma stack Portainer para o Supabase oficial self-hosted/v0.8.1, commit 8c7a4d9dbbaf8b552893822e89d7bf06f33f9220, sem alterar postgres, Traefik ou Portainer existentes. CRM/n8n serão etapas separadas.

Arquitetura: banco Supabase próprio, arquivos locais no único nó vmi3691925, rede overlay dedicada compartilhável com o CRM. Só gateway entra na network_swarm_public; Traefik publica os prefixos da API em database.euattendo.com.br. Studio e banco não são publicados. Sem Supavisor (clientes internos usam o DB direto). Segredos exclusivos gerados localmente e persistidos em diretório 700; saídas 600. Stack com referências a variáveis, arquivo de variáveis separado para carregar no Portainer. Nenhum deploy automático.

Plano: testar geração de credenciais e conversão; implementar preparador Python sem dependências adicionais; validar contra Compose oficial e parser docker stack config; publicar arquivos de suporte no fork; usuário executa preparador, que valida novamente na VPS e cria arquivos para o painel. Não afirmar funcionamento de containers antes de deploy e teste na VPS.

Verificações: JWTs HMAC válidos e distintos; não reutilizar senhas exemplo; não sobrescrever runtime; recusar fonte divergente; sem portas publicadas; placement em nó único; sem directives Compose incompatíveis; binds absolutos; apenas gateway na rede pública; secrets ausentes do template; importação consistente das variáveis e validação Docker sem imprimir segredos.
