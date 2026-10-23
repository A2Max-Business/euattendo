import base64
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('crm', Path(__file__).with_name('prepare_crm.py'))
crm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(crm)


class CrmTests(unittest.TestCase):
    def test_private_helper_grant_is_limited_to_trusted_wrapper_owner(self):
        self.assertIn('private.fn_oauth_key() TO postgres', crm.CRYPTO_OWNER_GRANTS)
        self.assertNotIn('TO PUBLIC', crm.CRYPTO_OWNER_GRANTS)
        self.assertNotIn('TO service_role', crm.CRYPTO_OWNER_GRANTS)
        self.assertNotIn('TO euattendo_worker', crm.CRYPTO_OWNER_GRANTS)
    def test_existing_database_keys_are_preserved(self):
        existing = {'cpf_key': 'c' * 40, 'nuvemshop_oauth_key': 'n' * 40}
        env = crm.make_environment({'ANON_KEY': 'anon', 'SERVICE_ROLE_KEY': 'service'}, existing)
        self.assertEqual(env['CPF_ENCRYPTION_KEY'], existing['cpf_key'])
        self.assertEqual(env['NUVEMSHOP_OAUTH_ENCRYPTION_KEY'], existing['nuvemshop_oauth_key'])
        self.assertEqual(env['INTERNAL_SECRET'], env['INTERNAL_CRON_SECRET'])
    def test_credentials_do_not_reuse_database_admin_password(self):
        env = crm.make_environment({'ANON_KEY': 'anon', 'SERVICE_ROLE_KEY': 'service', 'POSTGRES_PASSWORD': 'admin-password'})
        self.assertNotIn('admin-password', str(env))
        self.assertEqual(env['NEXT_PUBLIC_SUPABASE_ANON_KEY'], 'anon')
        self.assertIn('@supabase-db:5432/postgres', env['SUPABASE_DB_URL'])
        self.assertEqual(env['SUPABASE_DB_ADMIN_URL'], '')
        for key in ['CPF_ENCRYPTION_KEY', 'AI_CRED_AES_KEY', 'WAHA_BYO_ENCRYPTION_KEY']:
            self.assertEqual(len(base64.b64decode(env[key])), 32)

    def test_network_separation_and_pins(self):
        stack = crm.make_stack(crm.make_environment({'ANON_KEY': 'anon', 'SERVICE_ROLE_KEY': 'service'}))
        self.assertEqual(set(stack['services']), {'app', 'worker', 'scheduler', 'redis', 'srh', 'waha'})
        for name, service in stack['services'].items():
            self.assertNotIn('ports', service)
            self.assertEqual('proxy' in service['networks'], name == 'app')
            self.assertEqual('supabase' in service['networks'], name in ['app', 'worker'])
        for name in ['app', 'worker', 'scheduler']:
            self.assertIn('@sha256:', stack['services'][name]['image'])
        self.assertIn('euattendo-deny', str(stack['services']['app']['deploy']['labels']))
        self.assertEqual(stack['services']['waha']['environment']['WHATSAPP_HOOK_URL'], 'http://app:3000/api/v1/webhooks/waha')
        self.assertIn('${WAHA_API_KEY_SHA512}', stack['services']['waha']['environment']['WAHA_API_KEY'])


if __name__ == '__main__':
    unittest.main()
