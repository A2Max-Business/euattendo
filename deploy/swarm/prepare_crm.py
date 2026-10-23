#!/usr/bin/env python3
"""Prepare the pinned EuAttendo CRM stack; never deploy or recreate Supabase."""
import base64
import copy
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
from urllib.parse import urlsplit

REVISION = '04a4a72bbe424c7c5c4701748ee2594c1f04baaa'
SOURCE = '48739b8889b59b3117ab90058cac486740cf62f0'
BASE = Path('/opt/euattendo-swarm')
IMAGES = {
    'app': 'ghcr.io/melgarafael/deskcommcrm@sha256:888635bdf68f72eb91a7b5ada1bfdb56065f0b4e089206974959a40f24478cba',
    'worker': 'ghcr.io/melgarafael/deskcomm-worker@sha256:ed32aeb87ca820d17500f4b86833005a0e330c7e8b61efb6528a6b824459250c',
    'scheduler': 'ghcr.io/melgarafael/deskcomm-scheduler@sha256:d96c6e824f7ed4726fcb0e73b77e0024b781297df3927d0e4055484802705758',
}


def read_env(path):
    values = {}
    for line in path.read_text(encoding='utf-8').splitlines():
        if line and not line.startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            values[key] = value.strip().strip('"').strip("'")
    return values


def private_file(path, text):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as stream:
        stream.write(text)


def run(args, stdin=None, env=None):
    result = subprocess.run(args, input=stdin, env=env, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError('Falhou: ' + ' '.join(args[:3]) + '. Diagnostico omitido para proteger segredos; preserve runtime-crm.')
    return result.stdout.strip()


def make_environment(supabase, db_secrets=None):
    password = secrets.token_hex(32)
    env = {
        'NODE_ENV': 'production', 'DOMAIN': 'crm.euattendo.com.br',
        'NEXT_PUBLIC_APP_URL': 'https://crm.euattendo.com.br',
        'NEXT_PUBLIC_ADMIN_URL': 'https://crm.euattendo.com.br',
        'NEXT_PUBLIC_SUPABASE_URL': 'https://database.euattendo.com.br',
        'SUPABASE_SERVER_URL': 'http://supabase-envoy:8000',
        'NEXT_PUBLIC_SUPABASE_ANON_KEY': supabase['ANON_KEY'],
        'SUPABASE_SERVICE_ROLE_KEY': supabase['SERVICE_ROLE_KEY'],
        'SUPABASE_DB_URL': f'postgresql://euattendo_worker:{password}@supabase-db:5432/postgres',
        'SUPABASE_DB_ADMIN_URL': '',
        'WAHA_API_BASE_URL': 'http://waha:3000',
        'WAHA_WEBHOOK_BASE_URL': 'http://app:3000',
        'WAHA_WEBHOOK_REQUIRE_SIGNATURE': 'true',
        'WHATSAPP_RESTART_ALL_SESSIONS': 'True',
        'UPSTASH_REDIS_REST_URL': 'http://srh:80',
        'AGENT_DISPATCH_CONSUMER': 'engine', 'INTERNAL_AGENT_RUN_STUB': 'false',
        'EVENT_LOG_WORKER_DRAINS': 'true', 'SHUTDOWN_GRACE_MS': '30000',
        'NUVEMSHOP_ENABLED': 'false', 'APP_NAME': 'EuAttendo', 'APP_LOCALE': 'pt-BR',
        'AI_GATEWAY_API_KEY': '', 'ANTHROPIC_API_KEY': '', 'OPENROUTER_API_KEY': '',
        'OPENAI_API_KEY': '', 'SMTP_HOST': '', 'SMTP_PORT': '587', 'SMTP_SECURITY': 'starttls',
        'SMTP_USERNAME': '', 'SMTP_PASSWORD': '', 'SMTP_FROM_EMAIL': '', 'SMTP_FROM_NAME': 'EuAttendo',
    }
    for name in ('INTERNAL_SECRET', 'WAHA_API_KEY', 'WAHA_HMAC_SECRET', 'IMPERSONATE_COOKIE_SECRET', 'LGPD_SIGNING_KEY', 'SRH_TOKEN'):
        env[name] = secrets.token_hex(32)
    for name in ('CPF_ENCRYPTION_KEY', 'AI_CRED_AES_KEY', 'WAHA_BYO_ENCRYPTION_KEY', 'NUVEMSHOP_OAUTH_ENCRYPTION_KEY'):
        env[name] = base64.b64encode(secrets.token_bytes(32)).decode()
    # These two keys are also read by SECURITY DEFINER database functions.
    # Preserve existing values rather than making previously encrypted data unreadable.
    for db_key, env_key in [('cpf_key', 'CPF_ENCRYPTION_KEY'), ('nuvemshop_oauth_key', 'NUVEMSHOP_OAUTH_ENCRYPTION_KEY')]:
        value = (db_secrets or {}).get(db_key)
        if value is not None:
            if len(value) < 32 or '\n' in value or '\r' in value:
                raise RuntimeError('Chave de cifra existente invalida; preservada para revisao.')
            env[env_key] = value
    # Scheduler sends INTERNAL_SECRET. Keep the cron-specific override in sync.
    env['INTERNAL_CRON_SECRET'] = env['INTERNAL_SECRET']
    env['UPSTASH_REDIS_REST_TOKEN'] = env['SRH_TOKEN']
    env['WAHA_API_KEY_SHA512'] = hashlib.sha512(env['WAHA_API_KEY'].encode()).hexdigest()
    return env


def make_stack(env):
    stack = {'version': '3.8', 'services': {},
             'networks': {
                 'internal': {'external': True, 'name': 'euattendo_crm_private'},
                 'supabase': {'external': True, 'name': 'euattendo_supabase_private'},
                 'proxy': {'external': True, 'name': 'network_swarm_public'}},
             'volumes': {'waha-data': {}, 'waha-media': {}}}
    environment = {key: '${' + key + '}' for key in env}
    # Container-only override: administrative credentials are never delivered.
    environment['SUPABASE_DB_ADMIN_URL'] = ''
    definitions = {
        'app': {'image': IMAGES['app'], 'environment': copy.deepcopy(environment),
                'networks': ['internal', 'supabase', 'proxy'],
                'healthcheck': {'test': ['CMD', 'node', '-e', "require('net').connect(3000,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"],
                                'interval': '30s', 'timeout': '5s', 'retries': 5, 'start_period': '120s'}},
        'worker': {'image': IMAGES['worker'], 'environment': copy.deepcopy(environment),
                   'networks': ['internal', 'supabase'], 'stop_grace_period': '40s',
                   'healthcheck': {'test': ['CMD', 'wget', '--quiet', '--tries=1', '--spider', 'http://127.0.0.1:8787/healthz'],
                                   'interval': '30s', 'timeout': '5s', 'retries': 3, 'start_period': '120s'}},
        'scheduler': {'image': IMAGES['scheduler'], 'environment': {'TZ': 'UTC', 'INTERNAL_SECRET': '${INTERNAL_SECRET}'},
                      'networks': ['internal']},
        'redis': {'image': 'redis:7-alpine', 'command': ['redis-server', '--save', '', '--appendonly', 'no'],
                  'networks': ['internal'], 'healthcheck': {'test': ['CMD', 'redis-cli', 'ping'], 'interval': '30s', 'timeout': '3s', 'retries': 3}},
        'srh': {'image': 'hiett/serverless-redis-http@sha256:5b0bb9239fce53abf87b2018a7a0deb9ec7bd900c5360738fe5fbeeb426f9150',
                'networks': ['internal'], 'environment': {'SRH_MODE': 'env', 'SRH_TOKEN': '${SRH_TOKEN}', 'SRH_CONNECTION_STRING': 'redis://redis:6379'}},
        'waha': {'image': 'devlikeapro/waha:latest-2026.7.2', 'networks': ['internal'],
                 'volumes': ['waha-data:/app/.sessions', 'waha-media:/app/.media'],
                 'environment': {'WAHA_API_KEY': 'sha512:${WAHA_API_KEY_SHA512}',
                                 'WHATSAPP_HOOK_URL': 'http://app:3000/api/v1/webhooks/waha',
                                 'WHATSAPP_HOOK_EVENTS': 'message.any,message.ack,message.edited,message.revoked,message.reaction,session.status,state.change',
                                 'WHATSAPP_HOOK_HMAC_KEY': '${WAHA_HMAC_SECRET}',
                                 'WHATSAPP_DEFAULT_ENGINE': 'NOWEB', 'WAHA_DASHBOARD_ENABLED': 'false',
                                 'WHATSAPP_RESTART_ALL_SESSIONS': 'True'}},
    }
    limits = {'app': '1536M', 'worker': '1024M', 'waha': '1536M', 'redis': '512M', 'srh': '256M', 'scheduler': '128M'}
    for name, service in definitions.items():
        service['deploy'] = {
            'replicas': 1, 'placement': {'constraints': ['node.hostname == vmi3691925']},
            'restart_policy': {'condition': 'any', 'delay': '10s'},
            'resources': {'limits': {'memory': limits[name]}},
            'update_config': {'parallelism': 1, 'order': 'stop-first', 'failure_action': 'pause'}}
        service['logging'] = {'driver': 'json-file', 'options': {'max-size': '10m', 'max-file': '3'}}
    definitions['app']['deploy']['labels'] = {
        'traefik.enable': 'true', 'traefik.swarm.network': 'network_swarm_public',
        'traefik.http.routers.euattendo-crm.rule': 'Host(`crm.euattendo.com.br`)',
        'traefik.http.routers.euattendo-crm.entrypoints': 'websecure',
        'traefik.http.routers.euattendo-crm.tls.certresolver': 'letsencryptresolver',
        'traefik.http.routers.euattendo-crm.service': 'euattendo-crm',
        'traefik.http.services.euattendo-crm.loadbalancer.server.port': '3000',
        'traefik.http.routers.euattendo-waha-block.rule': 'Host(`crm.euattendo.com.br`) && Path(`/api/v1/webhooks/waha`)',
        'traefik.http.routers.euattendo-waha-block.entrypoints': 'websecure',
        'traefik.http.routers.euattendo-waha-block.tls.certresolver': 'letsencryptresolver',
        'traefik.http.routers.euattendo-waha-block.priority': '1000',
        'traefik.http.routers.euattendo-waha-block.service': 'euattendo-crm',
        'traefik.http.routers.euattendo-waha-block.middlewares': 'euattendo-deny',
        'traefik.http.middlewares.euattendo-deny.ipallowlist.sourcerange': '192.0.2.1/32',
    }
    stack['services'] = definitions
    return stack


def main():
    if os.name != 'posix' or os.geteuid() != 0:
        raise RuntimeError('Executar como root na VPS Linux.')
    runtime = BASE / 'runtime-crm'
    if runtime.exists():
        raise RuntimeError('runtime-crm ja existe. Preservado: nao gere novas chaves.')
    if run(['git', '-C', str(BASE / 'crm'), 'rev-parse', 'HEAD']) != SOURCE:
        raise RuntimeError('Revisao do CRM diferente da que corresponde as imagens.')
    for image in IMAGES.values():
        data = json.loads(run(['docker', 'image', 'inspect', image]))[0]
        if data['Config'].get('Labels', {}).get('org.opencontainers.image.revision') != REVISION:
            raise RuntimeError('Imagem local ausente ou de revisao diferente.')
    node = json.loads(run(['docker', 'node', 'inspect', 'self']))[0]
    if node['Description']['Hostname'] != 'vmi3691925' or node['Spec']['Role'] != 'manager':
        raise RuntimeError('No Swarm inesperado.')
    for name in ('network_swarm_public', 'euattendo_supabase_private'):
        network = json.loads(run(['docker', 'network', 'inspect', name]))[0]
        if network['Driver'] != 'overlay':
            raise RuntimeError('Rede necessaria nao e overlay: ' + name)
    ids = run(['docker', 'ps', '-q', '--filter', 'label=com.docker.swarm.service.name=euattendo-supabase_db', '--filter', 'status=running']).splitlines()
    if len(ids) != 1:
        raise RuntimeError('Esperado exatamente um banco Supabase em execucao.')
    db = ids[0]
    check = run(['docker', 'exec', db, 'psql', '-X', '-U', 'supabase_admin', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1', '-c',
                 "SELECT to_regclass('public.organizations') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='euattendo_worker')"])
    if check != 't':
        raise RuntimeError('Baseline ausente ou role euattendo_worker ja existe; nenhuma chave criada.')
    db_secrets = json.loads(run(['docker', 'exec', db, 'psql', '-X', '-U', 'supabase_admin', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1', '-c',
                                "SELECT coalesce(json_object_agg(name,value),'{}'::json) FROM private.app_secrets WHERE name IN ('cpf_key','nuvemshop_oauth_key')"]))
    os.umask(0o077)
    runtime.mkdir(mode=0o700)
    env = make_environment(read_env(BASE / 'runtime-supabase/.env'), db_secrets)
    private_file(runtime / '.env', ''.join(k + '=' + v + '\n' for k, v in env.items()))
    stack_file = runtime / 'crm.portainer.json'
    private_file(stack_file, json.dumps(make_stack(env), indent=2) + '\n')
    process = dict(os.environ)
    process.update(env)
    run(['docker', 'stack', 'config', '-c', str(stack_file)], env=process)
    private_file(runtime / 'portainer.env', ''.join(k + '=' + v + '\n' for k, v in env.items()))
    password = urlsplit(env['SUPABASE_DB_URL']).password
    cpf_key = env['CPF_ENCRYPTION_KEY'].replace("'", "''")
    oauth_key = env['NUVEMSHOP_OAUTH_ENCRYPTION_KEY'].replace("'", "''")
    sql = f"""BEGIN;
INSERT INTO private.app_secrets (name,value) VALUES ('cpf_key','{cpf_key}'), ('nuvemshop_oauth_key','{oauth_key}') ON CONFLICT (name) DO NOTHING;
CREATE ROLE euattendo_worker LOGIN PASSWORD '{password}' BYPASSRLS;
GRANT CONNECT ON DATABASE postgres TO euattendo_worker;
GRANT USAGE ON SCHEMA public, extensions TO euattendo_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO euattendo_worker;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO euattendo_worker;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO euattendo_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO euattendo_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO euattendo_worker;
REVOKE UPDATE, DELETE, TRUNCATE ON public.api_audit_log FROM euattendo_worker;
COMMIT;
"""
    run(['docker', 'exec', '-i', db, 'psql', '-X', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], stdin=sql)
    cipher_ok = run(['docker', 'exec', db, 'psql', '-X', '-U', 'supabase_admin', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1', '-c',
                     "SELECT public.fn_decrypt_oauth(public.fn_encrypt_oauth('euattendo-preflight'))='euattendo-preflight' AND extensions.pgp_sym_decrypt(public.encrypt_cpf('euattendo-preflight'),private.fn_cpf_key())='euattendo-preflight'"])
    if cipher_ok != 't':
        raise RuntimeError('Teste de cifra falhou; chaves e arquivos foram preservados.')
    names = run(['docker', 'network', 'ls', '--format', '{{.Name}}']).splitlines()
    if 'euattendo_crm_private' not in names:
        run(['docker', 'network', 'create', '--driver', 'overlay', '--attachable', 'euattendo_crm_private'])
    else:
        network = json.loads(run(['docker', 'network', 'inspect', 'euattendo_crm_private']))[0]
        if network['Driver'] != 'overlay':
            raise RuntimeError('Rede CRM existente incompativel; arquivos preservados.')
    private_file(runtime / 'PREPARADO.txt', 'Source ' + SOURCE + '\nImages ' + REVISION + '\nStack euattendo-crm\n')
    print('CRM PREPARADO — nenhum servico iniciado.')
    print('Stack: ' + str(stack_file))
    print('Variaveis privadas: ' + str(runtime / 'portainer.env'))
    print('Role propria criada. IA e SMTP ainda nao configurados. Primeiro administrador sera criado na proxima etapa.')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError) as error:
        print('PREPARACAO INTERROMPIDA: ' + str(error), file=sys.stderr)
        sys.exit(1)
