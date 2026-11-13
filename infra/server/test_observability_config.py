import unittest
from observability_config import configure_bsc_observability, configure_main_observability, worker_observability_projections

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

    def test_worker_metadata_uses_a_later_environment_file(self):
        config = {'services': {'web': {'environment': 'production', 'env': {'unchanged': 'yes'}}, 'test-web': {'env': {}}}}
        updated = configure_main_observability(config, 'b' * 40)
        self.assertEqual(config['services']['web']['env'], {'unchanged': 'yes'})
        self.assertEqual(updated['services']['test-web'], config['services']['test-web'])
        self.assertEqual(updated['services']['web']['env']['TG_ENVIRONMENT'], 'production')
        self.assertEqual(updated['services']['web']['env']['TG_RELEASE_COMMIT'], 'b' * 40)
        entries = worker_observability_projections(updated, '/opt/tickergarden-hosting/releases/20261112')
        self.assertEqual(len(entries), 2)
        self.assertEqual(entries[1][1], '[Service]\nEnvironmentFile=' + entries[0][0] + '\n')
        self.assertIn('TG_RELEASE_COMMIT=' + 'b' * 40, entries[0][1])
        self.assertIn('TG_CHAIN_ID=4663', entries[0][1])
        updated['workerObservability']['tickergarden-confirmed-display-production']['TG_SECRET'] = 'forbidden'
        with self.assertRaises(AssertionError):
            worker_observability_projections(updated, '/opt/tickergarden-hosting/releases/20261112')

    def test_worker_metadata_refuses_other_units_and_unsafe_roots(self):
        with self.assertRaises(AssertionError):
            worker_observability_projections({'workerObservability': {'another-worker': {}}}, '/opt/tickergarden-hosting/releases/20261112')
        with self.assertRaises(AssertionError):
            worker_observability_projections({'workerObservability': {'tickergarden-confirmed-display-production': {}}}, '/tmp/not-a-release')
        self.assertEqual(worker_observability_projections({}, '/tmp/unaffected-test'), [])

    def test_resident_worker_release_is_projected_without_credentials(self):
        config = {'workerObservability': {'tickergarden-resident-worker-production': {'TG_RELEASE_COMMIT': 'c' * 40, 'TG_CHAIN_ID': '4663'}}}
        entries = worker_observability_projections(config, '/opt/tickergarden-hosting/releases/20261112')
        self.assertEqual(len(entries), 2)
        self.assertIn('tickergarden-resident-worker-production-observability.env', entries[0][0])
        self.assertEqual(entries[0][1], 'TG_CHAIN_ID=4663\nTG_RELEASE_COMMIT=' + 'c' * 40 + '\n')
        config['workerObservability']['tickergarden-resident-worker-production']['TG_RPC_URL'] = 'forbidden'
        with self.assertRaises(AssertionError):
            worker_observability_projections(config, '/opt/tickergarden-hosting/releases/20261112')

if __name__ == '__main__':
    unittest.main()
