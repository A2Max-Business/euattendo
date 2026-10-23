#!/usr/bin/env python3
"""Prepare (never deploy) the pinned official Supabase stack for this one-node Swarm."""
import argparse
import base64
import copy
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import time

SOURCE_SHA = '8c7a4d9dbbaf8b552893822e89d7bf06f33f9220'
NODE = 'vmi3691925'
PRIVATE_NETWORK = 'euattendo_supabase_private'
PUBLIC_NETWORK = 'network_swarm_public'


def b64(data):
    return base64.urlsafe_b64encode(data).decode().rstrip('=')


def jwt(secret, role):
    now = int(time.time())
    head = b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}, separators=(',', ':')).encode())
    body = b64(json.dumps({'role': role, 'iss': 'supabase', 'iat': now, 'exp': now + 10 * 365 * 86400}, separators=(',', ':')).encode())
    unsigned = f'{head}.{body}'
    return unsigned + '.' + b64(hmac.new(secret.encode(), unsigned.encode(), hashlib.sha256).digest())


def make_environment(template):
    env = dict(template)
    for key in ('POSTGRES_PASSWORD', 'JWT_SECRET', 'DASHBOARD_PASSWORD', 'SECRET_KEY_BASE',
                'REALTIME_DB_ENC_KEY', 'VAULT_ENC_KEY', 'PG_META_CRYPTO_KEY',
                'LOGFLARE_PUBLIC_ACCESS_TOKEN', 'LOGFLARE_PRIVATE_ACCESS_TOKEN',
                'S3_PROTOCOL_ACCESS_KEY_ID', 'S3_PROTOCOL_ACCESS_KEY_SECRET'):
        env[key] = secrets.token_hex(32)
    # These encryption keys have fixed length constraints upstream.
    env['REALTIME_DB_ENC_KEY'] = secrets.token_hex(8)
    env['VAULT_ENC_KEY'] = secrets.token_hex(16)
    env['ANON_KEY'] = jwt(env['JWT_SECRET'], 'anon')
    env['SERVICE_ROLE_KEY'] = jwt(env['JWT_SECRET'], 'service_role')
    env.update({
        'POSTGRES_HOST': 'db', 'POSTGRES_DB': 'postgres', 'POSTGRES_PORT': '5432',
        'SUPABASE_PUBLIC_URL': 'https://database.euattendo.com.br',
        'API_EXTERNAL_URL': 'https://database.euattendo.com.br/auth/v1',
        'SITE_URL': 'https://crm.euattendo.com.br',
        'ADDITIONAL_REDIRECT_URLS': 'https://crm.euattendo.com.br/auth/confirm',
        'DISABLE_SIGNUP': 'true', 'ENABLE_EMAIL_SIGNUP': 'true',
        'ENABLE_EMAIL_AUTOCONFIRM': 'false', 'ENABLE_ANONYMOUS_USERS': 'false',
        'ENABLE_PHONE_SIGNUP': 'false', 'ENABLE_PHONE_AUTOCONFIRM': 'false',
        'JWT_EXPIRY': '3600', 'DASHBOARD_USERNAME': 'euattendo-admin',
        'OPENAI_API_KEY': '', 'SMTP_HOST': '', 'SMTP_USER': '', 'SMTP_PASS': '',
        'SMTP_PORT': '587', 'SMTP_ADMIN_EMAIL': '', 'SMTP_SENDER_NAME': 'EuAttendo',
        'STUDIO_DEFAULT_ORGANIZATION': 'EuAttendo', 'STUDIO_DEFAULT_PROJECT': 'EuAttendo',
        'POOLER_TENANT_ID': 'euattendo', 'FUNCTIONS_VERIFY_JWT': 'true',
        'MINIO_ROOT_PASSWORD': secrets.token_hex(24),
        'PROXY_DOMAIN': 'database.euattendo.com.br', 'CERTBOT_EMAIL': '',
    })
    for key in ('SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY', 'JWT_KEYS', 'JWT_JWKS',
                'ANON_KEY_ASYMMETRIC', 'SERVICE_ROLE_KEY_ASYMMETRIC'):
        env[key] = ''  # Official legacy HS256 mode; don't mix signing schemes.
    return env


def write_private(path, content):
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as stream:
        stream.write(content)


def command(args, cwd=None, env=None):
    result = subprocess.run(args, cwd=cwd, env=env, capture_output=True, text=True)
    if result.returncode:
        # Compose diagnostics can contain interpolated credentials. Never print them.
        raise RuntimeError('Falhou: ' + ' '.join(args[:3]) + '. Saida omitida para proteger credenciais.')
    return result.stdout


def make_stack(config, env, node):
    stack = {'version': '3.8', 'services': {}, 'volumes': copy.deepcopy(config.get('volumes', {})),
             'networks': {'private': {'external': True, 'name': PRIVATE_NETWORK},
                          'proxy': {'external': True, 'name': PUBLIC_NETWORK}}}
    for value in stack['volumes'].values():
        value.pop('name', None)  # Let the Portainer stack own its volume namespace.
    for name, original in config['services'].items():
        if name == 'supavisor':
            continue  # No published DB ports or unneeded pooler on this single-node setup.
        service = copy.deepcopy(original)
        service = {key: value for key, value in service.items() if value is not None}
        for field in ('container_name', 'restart', 'depends_on', 'ports', 'profiles',
                      'build', 'pull_policy', 'develop', 'env_file', 'labels', 'deploy'):
            service.pop(field, None)
        service['networks'] = {'private': {}}
        if name == 'api-gw':
            service['networks']['private'] = {'aliases': ['supabase-envoy', 'envoy', 'kong']}
            service['networks']['proxy'] = {}
        if name == 'db':
            service['networks']['private'] = {'aliases': ['supabase-db']}
        for mount in service.get('volumes', []):
            if mount['type'] == 'bind':
                path = Path(mount['source'])
                if not path.is_absolute() or not path.exists():
                    raise RuntimeError('Bind mount ausente ou relativo: ' + str(path))
                mount.pop('bind', None)  # SELinux/create_host_path are Compose-only here.
        service['deploy'] = {
            'replicas': 1, 'placement': {'constraints': [f'node.hostname == {node}']},
            'restart_policy': {'condition': 'any', 'delay': '10s'},
            'update_config': {'parallelism': 1, 'order': 'stop-first', 'failure_action': 'pause'},
        }
        service['logging'] = {'driver': 'json-file', 'options': {'max-size': '10m', 'max-file': '3'}}
        if 'healthcheck' in service:
            service['healthcheck']['start_period'] = '180s'
        if name == 'api-gw':
            prefixes = ('auth', 'rest', 'realtime', 'storage', 'functions', 'graphql')
            paths = ' || '.join(f'PathPrefix(`/{p}/v1/`) || Path(`/{p}/v1`)' for p in prefixes)
            service['deploy']['labels'] = {
                'traefik.enable': 'true',
                'traefik.swarm.network': PUBLIC_NETWORK,
                'traefik.http.routers.euattendo-supabase.rule': 'Host(`database.euattendo.com.br`) && (' + paths + ')',
                'traefik.http.routers.euattendo-supabase.entrypoints': 'websecure',
                'traefik.http.routers.euattendo-supabase.tls.certresolver': 'letsencryptresolver',
                'traefik.http.routers.euattendo-supabase.service': 'euattendo-supabase',
                'traefik.http.services.euattendo-supabase.loadbalancer.server.port': '8000',
            }
        stack['services'][name] = service
    # Use Portainer variable upload rather than putting credentials in the pasted stack.
    sensitive = ('POSTGRES_PASSWORD', 'JWT_SECRET', 'ANON_KEY', 'SERVICE_ROLE_KEY', 'DASHBOARD_PASSWORD',
                 'SECRET_KEY_BASE', 'REALTIME_DB_ENC_KEY', 'VAULT_ENC_KEY', 'PG_META_CRYPTO_KEY',
                 'S3_PROTOCOL_ACCESS_KEY_ID', 'S3_PROTOCOL_ACCESS_KEY_SECRET')
    replacements = sorted(((env[k], '${' + k + '}') for k in sensitive), key=lambda pair: -len(pair[0]))

    def replace(value):
        if isinstance(value, str):
            for secret, reference in replacements:
                value = value.replace(secret, reference)
            return value
        if isinstance(value, list):
            return [replace(v) for v in value]
        if isinstance(value, dict):
            return {k: replace(v) for k, v in value.items()}
        return value

    return replace(stack)


def read_template(path):
    env = {}
    for line in path.read_text(encoding='utf-8').splitlines():
        if re.match(r'^[A-Z][A-Z0-9_]*=', line):
            key, value = line.split('=', 1)
            env[key] = value.strip().strip('"').strip("'")
    return env


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default='/opt/euattendo-swarm')
    args = parser.parse_args()
    base = Path(args.base).resolve()
    source = base / 'supabase-source'
    target = base / 'runtime-supabase'
    if os.name != 'posix' or os.geteuid() != 0:
        raise RuntimeError('Executar como root na VPS Linux, nao no Windows.')
    if target.exists():
        raise RuntimeError('runtime-supabase ja existe: preservado. Nao apague nem gere novas chaves.')
    actual = command(['git', '-C', str(source), 'rev-parse', 'HEAD']).strip()
    if actual != SOURCE_SHA or command(['git', '-C', str(source), 'status', '--porcelain']).strip():
        raise RuntimeError('Fonte Supabase diferente da revisao verificada ou com alteracoes locais.')
    local = json.loads(command(['docker', 'node', 'inspect', 'self']))[0]
    if local['Description']['Hostname'] != NODE or local['Spec']['Role'] != 'manager':
        raise RuntimeError('No Swarm diferente do servidor esperado.')
    network = json.loads(command(['docker', 'network', 'inspect', PUBLIC_NETWORK]))[0]
    if network['Driver'] != 'overlay':
        raise RuntimeError('Rede do Traefik nao e overlay.')
    # Everything below is local preparation: no stack/service is created or updated.
    os.umask(0o077)
    shutil.copytree(source / 'docker', target)
    os.chmod(target, 0o700)
    env = make_environment(read_template(target / '.env.example'))
    write_private(target / '.env', ''.join(k + '=' + v + '\n' for k, v in env.items()))
    # Required bind sources must exist before Swarm scheduling (no implicit mkdir).
    for directory in ('volumes/db/data', 'volumes/storage', 'volumes/snippets', 'volumes/functions'):
        (target / directory).mkdir(parents=True, exist_ok=True)
    process_env = dict(os.environ)
    process_env.update(env)
    process_env.pop('COMPOSE_FILE', None)
    config = json.loads(command(['docker', 'compose', '--env-file', str(target / '.env'),
                                 '-f', str(target / 'docker-compose.yml'), 'config', '--format', 'json'],
                                cwd=target, env=process_env))
    stack = make_stack(config, env, NODE)
    stack_path = target / 'supabase.portainer.json'
    write_private(stack_path, json.dumps(stack, indent=2) + '\n')
    # Validate with the actual Swarm parser. Never print its resolved output.
    command(['docker', 'stack', 'config', '-c', str(stack_path)], cwd=target, env=process_env)
    variables = {k: env[k] for k in re.findall(r'\$\{([A-Z0-9_]+)\}', json.dumps(stack))}
    write_private(target / 'portainer.env', ''.join(k + '=' + variables[k] + '\n' for k in sorted(variables)))
    # Record immutable identities for diagnosis without exposing values.
    write_private(target / 'PREPARADO.txt', 'Supabase source: ' + SOURCE_SHA + '\nNode: ' + NODE +
                  '\nStack: euattendo-supabase\nValidation: docker stack config OK\n')
    networks = command(['docker', 'network', 'ls', '--format', '{{.Name}}']).splitlines()
    if PRIVATE_NETWORK not in networks:
        command(['docker', 'network', 'create', '--driver', 'overlay', '--attachable', PRIVATE_NETWORK])
    else:
        private = json.loads(command(['docker', 'network', 'inspect', PRIVATE_NETWORK]))[0]
        if private['Driver'] != 'overlay' or not private['Attachable']:
            raise RuntimeError('Rede privada existente incompativel; arquivos preservados para revisao.')
    print('PREPARACAO OK — nenhum servico iniciado.')
    print('Stack para colar no Portainer: ' + str(stack_path))
    print('Variaveis privadas para carregar no Portainer: ' + str(target / 'portainer.env'))
    print('Nao compartilhe .env nem portainer.env. Cadastro publico permanece fechado; SMTP ainda nao configurado.')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError) as error:
        print('PREPARACAO INTERROMPIDA: ' + str(error), file=sys.stderr)
        sys.exit(1)
