# Preparação Supabase / Portainer Swarm — EuAttendo

Preparador específico da VPS `vmi3691925`, rede Traefik `network_swarm_public`, resolver `letsencryptresolver` e API `https://database.euattendo.com.br`. Fonte oficial Supabase self-hosted/v0.8.1, commit `8c7a4d9dbbaf8b552893822e89d7bf06f33f9220`. Python 3 e Docker Compose são necessários. Não instala dependências nem executa deploy.

## Preparar

Com o clone oficial em `/opt/euattendo-swarm/supabase-source`, executar como root:

```sh
python3 prepare_supabase.py
```

O script confere a fonte, o nó e a rede existente; copia os arquivos oficiais para `runtime-supabase`; gera credenciais únicas, JWTs e arquivos privados; adapta a configuração oficial ao Swarm e valida com `docker stack config`; cria apenas a rede overlay privada compartilhável. Não altera stacks ou serviços existentes. Se o runtime já existir, para para preservar credenciais/dados. Em falha parcial, não apague o diretório: revisar a causa e reparar conservando as chaves.

São gerados:

- `supabase.portainer.json`: definição JSON, também válida como YAML para o editor do Portainer; segredos referenciados por `${VAR}`.
- `portainer.env`: variáveis secretas para importar no Portainer. NÃO compartilhar em chat, Git ou capturas de tela.
- `.env`: configuração completa, credenciais e fonte para recuperação. NÃO compartilhar.
- `PREPARADO.txt`: confirmação sem credenciais.

JWTs legados HS256 expiram em 10 anos; registrar revisão/rotação antes do vencimento. Asymmetric/new API keys não são ativadas parcialmente. A mesma senha DB é usada nos papéis internos conforme a distribuição oficial, isolados na rede privada.

## Portainer

1. Criar stack `euattendo-supabase` no endpoint Swarm correto.
2. Colar `supabase.portainer.json` no Web editor. Não usar o Compose original.
3. Baixar `portainer.env` por SFTP para uma pasta privada no computador e usar **Load variables from .env file** no painel. Não é `env_file` no YAML; são variáveis de interpolação do Portainer.
4. Fazer Deploy e aguardar download das imagens/inicialização. Manter o nome da stack fixo: volumes nomeados pertencem a ele.
5. Conferir `docker stack services euattendo-supabase` e `docker stack ps euattendo-supabase --no-trunc`. Não enviar inspeção de ambientes, .env ou logs do setup com credenciais.
6. Validar `curl --fail --silent --show-error https://database.euattendo.com.br/auth/v1/health`. A raiz do domínio deve ficar sem rota pública para Studio. O banco não publica 5432 no host.

O JSON é aceito por `docker stack config`. Containers não foram iniciados nos testes locais: parser válido não comprova boot, SMTP, RLS, persistência nem conexão do CRM. Swarm inicia serviços em paralelo, com reinício e janela inicial de healthcheck; conferir convergência antes do schema CRM.

## Escopo e operação

Mantém dez serviços oficiais; omite somente Supavisor porque o CRM se conecta diretamente ao banco interno. Studio/meta continuam na rede privada, mas o Traefik publica apenas prefixos da API e não o dashboard. Arquivos são persistidos localmente; MinIO não é necessário nesta configuração. Todos os serviços são fixados ao único nó para não perder acesso aos bind mounts.

Cadastro público nasce desativado; SMTP fica vazio até configuração com dados verificados da ENhost. Criar primeiro dono com API administrativa (email confirmado) e aplicar baseline/bootstrap do CRM são passos posteriores obrigatórios. Convites, confirmação e recuperação precisam de SMTP funcional antes da entrada dos clientes.

Antes de abrir produção: configurar SMTP; aplicar baseline do CRM da revisão correspondente e bucket/políticas; validar Auth, Realtime, Storage e isolamento dos tenants; implantar CRM/worker/WAHA; testar mensagem e reinício; configurar backup externo consistente de banco, arquivos e chaves. Somente então considerar instalação concluída.

Os segredos são armazenados em arquivos root-only e variáveis de serviços, visíveis a administradores Docker/Portainer. Não são Docker Secrets, pois os serviços oficiais não aceitam uniformemente entradas por arquivo. Restringir administradores e backups. Não ativar atualização automática concorrente do kit Compose nesta stack Swarm. As imagens seguem tags da revisão oficial; o deploy deve registrar os digests efetivamente resolvidos.

Nunca executar `docker stack rm`, `down -v`, reset de banco, limpeza de volumes ou regeneração de chaves como tentativa automática de consertar uma falha.
