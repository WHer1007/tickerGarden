import unittest
from observability_config import configure_bsc_observability

class ObservabilityConfigTests(unittest.TestCase):
    def test_updates_only_bsc_sdk_services_without_mutating_input(self):
        c = {'services': {'rh-pipeline': {'env': {'TG_SENTRY_DSN': 'https://public@o1.ingest.de.sentry.io/1'}}, 'web': {'env': {'unchanged': 'yes'}}, 'test-read': {'env': {}}}, 'productionWorkers': {'bsc-display': {'profile': {'backend': {'runtime': {'rpc': 'unchanged'}}}}, 'bsc-relay': {'profile': {'untouched': True}}}}
        for name in ['bsc-read', 'bsc-pipeline', 'bsc-content']:
            c['services'][name] = {'environment': 'production', 'env': {}, 'bscProfile': {'chainId': 56, 'backend': {'runtime': {'rpc': 'unchanged'}}}}
        updated = configure_bsc_observability(c, 'a' * 40)
        self.assertEqual(c['services']['bsc-read']['env'], {})
        for name in ['rh-pipeline', 'web', 'test-read']:
            self.assertEqual(updated['services'][name], c['services'][name])
        self.assertEqual(updated['productionWorkers']['bsc-relay'], c['productionWorkers']['bsc-relay'])
        for name in ['bsc-read', 'bsc-pipeline', 'bsc-content']:
            self.assertEqual(updated['services'][name]['bscProfile']['backend']['runtime']['TG_CHAIN_ID'], '56')
        self.assertEqual(updated['productionWorkers']['bsc-display']['profile']['backend']['runtime']['rpc'], 'unchanged')
        with self.assertRaises(AssertionError):
            configure_bsc_observability(c, 'unconfigured')

if __name__ == '__main__':
    unittest.main()
