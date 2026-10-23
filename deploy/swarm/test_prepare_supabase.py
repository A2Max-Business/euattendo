import base64
import hashlib
import hmac
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('prepare', Path(__file__).with_name('prepare_supabase.py'))
prepare = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(prepare)


class PreparationTests(unittest.TestCase):
    def test_sql_permissions_do_not_change_secrets_or_database_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sql = root / 'volumes/db/roles.sql'
            sql.parent.mkdir(parents=True)
            sql.write_text('-- public initialization code')
            data = sql.parent / 'data'
            data.mkdir()
            (data / 'internal.sql').write_text('database data')
            (root / '.env').write_text('secret')
            with patch.object(prepare.os, 'chmod') as chmod:
                prepare.normalize_sql_permissions(root)
            chmod.assert_called_once_with(sql, 0o644)

    def test_tokens_and_secrets(self):
        env = prepare.make_environment({'POSTGRES_PASSWORD': 'example', 'OPENAI_API_KEY': 'example'})
        self.assertNotEqual(env['POSTGRES_PASSWORD'], 'example')
        self.assertEqual(env['OPENAI_API_KEY'], '')
        self.assertNotEqual(env['ANON_KEY'], env['SERVICE_ROLE_KEY'])
        for key, role in [('ANON_KEY', 'anon'), ('SERVICE_ROLE_KEY', 'service_role')]:
            head, payload, signature = env[key].split('.')
            expected = prepare.b64(hmac.new(env['JWT_SECRET'].encode(), f'{head}.{payload}'.encode(), hashlib.sha256).digest())
            self.assertEqual(signature, expected)
            data = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
            self.assertEqual(data['role'], role)
        self.assertEqual(env['DISABLE_SIGNUP'], 'true')
        self.assertEqual(env['SITE_URL'], 'https://crm.euattendo.com.br')

    def test_swarm_networks_mounts_and_references(self):
        env = prepare.make_environment({})
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'roles.sql'
            source.write_text('-- init')
            config = {'services': {
                'db': {'image': 'supabase/postgres:example', 'restart': 'unless-stopped', 'container_name': 'db',
                       'environment': {'POSTGRES_PASSWORD': env['POSTGRES_PASSWORD']},
                       'volumes': [{'type': 'bind', 'source': str(source), 'target': '/init.sql', 'bind': {'selinux': 'Z', 'create_host_path': True}}]},
                'api-gw': {'image': 'envoyproxy/envoy:example', 'ports': [{'target': 8000, 'published': '8000'}],
                           'depends_on': {'db': {}}, 'environment': {'SERVICE_ROLE_KEY': env['SERVICE_ROLE_KEY']}},
                'auth': {'image': 'auth:example', 'entrypoint': None, 'command': None, 'environment': {'DATABASE_URL': 'postgres://user:' + env['POSTGRES_PASSWORD'] + '@db/postgres'}},
                'realtime': {'image': 'realtime:example'},
                'supavisor': {'image': 'unused:example', 'ports': [{'target': 5432}]}}, 'volumes': {}}
            stack = prepare.make_stack(config, env, 'vmi3691925')
            self.assertNotIn('supavisor', stack['services'])
            for name, service in stack['services'].items():
                self.assertNotIn('ports', service)
                self.assertNotIn('depends_on', service)
                self.assertNotIn('restart', service)
                self.assertNotIn(None, service.values())
                self.assertIn('node.hostname == vmi3691925', service['deploy']['placement']['constraints'])
                self.assertEqual('proxy' in service['networks'], name == 'api-gw')
            self.assertNotIn('bind', stack['services']['db']['volumes'][0])
            self.assertEqual(stack['services']['db']['environment']['POSTGRES_PASSWORD'], '${POSTGRES_PASSWORD}')
            self.assertIn('${POSTGRES_PASSWORD}', stack['services']['auth']['environment']['DATABASE_URL'])
            self.assertNotIn(env['SERVICE_ROLE_KEY'], json.dumps(stack))
            self.assertIn('realtime-dev.supabase-realtime', stack['services']['realtime']['networks']['private']['aliases'])
            rule = stack['services']['api-gw']['deploy']['labels']['traefik.http.routers.euattendo-supabase.rule']
            self.assertIn('database.euattendo.com.br', rule)
            self.assertIn('PathPrefix(`/auth/v1/`)', rule)
            self.assertNotIn('PathPrefix(`/`)', rule)

    def test_exclusive_write_preserves_previous_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / '.env'
            prepare.write_private(file, 'first')
            with self.assertRaises(FileExistsError):
                prepare.write_private(file, 'second')
            self.assertEqual(file.read_text(), 'first')


if __name__ == '__main__':
    unittest.main()
