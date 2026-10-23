# CRM no Swarm — aplicação do baseline já concluída

Preparar com `python3 prepare_crm.py` no servidor `vmi3691925`, como root. Pré-requisitos: clone CRM em `/opt/euattendo-swarm/crm` no commit `48739b8889b59b3117ab90058cac486740cf62f0`; Supabase instalado, saudável e baseline aplicado; `.env` Supabase privado em runtime-supabase; as três imagens por digest já baixadas.

As imagens app/worker/scheduler são da revisão upstream `04a4a72bbe424c7c5c4701748ee2594c1f04baaa`, correspondente à árvore do fork nessa revisão. Digests foram recuperados do job de publicação 39997770301, job juntar-manifestos 120571689753, e confirmados no registry pelas labels OCI linux/amd64. Sem stable/latest móveis para essas três imagens.

O preparador cria `runtime-crm` (700), `.env` e `portainer.env` (600), `crm.portainer.json`, uma role dedicada `euattendo_worker` com senha própria e rede overlay privada do CRM. Nunca altera o banco/serviços Supabase, exceto criação transacional dessa role e concessão de acesso aos objetos public existentes. Não recebe nem repassa a senha administrativa do PostgreSQL. Atualização/DELETE/TRUNCATE na auditoria são revogados para a nova role. A role possui BYPASSRLS, necessário ao worker: não entregar sua senha a clientes; é uma credencial confiável do backend.

Não cria usuários de login nem executa deploy. Se runtime ou role já existir, para para preservar credenciais. Não apagar arquivos nem regenerar chaves para tentar novamente. Em falha parcial, reparar usando os valores preservados. Antes de produção, os backups externos devem incluir ambas as pastas runtime, banco e volumes WAHA.

Semeia as duas chaves de cifra usadas pelas funções SQL em `private.app_secrets` (CPF e OAuth/webhooks). Se já existirem, reusa seus valores sem rotação. Não concede acesso ao schema private ao worker. Confere round-trip de criptografia antes de concluir a preparação.

## Portainer

Criar stack `euattendo-crm` no endpoint Swarm existente. Colar `crm.portainer.json` e carregar `runtime-crm/portainer.env` por **Load variables from .env file**, após download privado por SFTP. Manter nome da stack e todas as variáveis. Deploy cria app, worker, scheduler, WAHA, Redis e SRH. Imagens WAHA e Redis seguem as tags previstas no Compose upstream; registrar os digests resolvidos pelo Swarm. Memória máxima planejada: app1536M, worker1024M, WAHA1536M, Redis512M, SRH256M, scheduler128M; reavaliar após medir.

Somente app usa network_swarm_public. Só app/worker entram na rede privada do Supabase. WAHA/Redis/SRH não publicam portas e não entram na rede pública nem na do banco. A rota global WAHA é negada no Traefik; o WAHA local envia pelo caminho interno. HMAC configurado. Módulos SIP/voz permanecem fora da primeira instalação.

O scheduler usa INTERNAL_SECRET; INTERNAL_CRON_SECRET possui o mesmo valor para que o override da autenticação não invalide o cron. Redis é efêmero conforme Compose upstream. IA fica sem chave até configuração pela interface; SMTP não foi configurado e convites/recuperação dependem dele. O WAHA padrão é Core: capacidade de sessões/edição deve ser conferida antes de conectar os números das duas empresas (Plus ou instâncias externas por tenant podem ser necessárias).

## Verificação e primeiro dono

Conferir `docker stack services euattendo-crm`, estado de saúde dos containers e `https://crm.euattendo.com.br/api/v1/health`. Validar acesso a REST/Storage/Realtime. Criar primeiro dono pelo script oficial `scripts/bootstrap-owner.ts` contido na imagem worker, com dados fornecidos pelo operador e segredo privado, e confirmar roles/tenant antes de testar login. Não colocar OWNER_PASSWORD no ambiente de serviços permanentes.

Não considerar instalação concluída apenas pelo probe TCP: testar login, separação entre tenants, mídia, WhatsApp, cron/worker, persistência após reinício e backup/restauração. Não executar o instalador Compose nem ativar seu auto-update para gerenciar esta stack Swarm.

Os testes locais cobrem formato Swarm, separação das redes, versões fixas e geração de credenciais. Nenhum container do CRM foi executado localmente; boot/fluxo funcional serão conferidos na VPS.
