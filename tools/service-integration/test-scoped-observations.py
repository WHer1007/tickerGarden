"""Bounded, read-only Arbitrum Sepolia comparison. No signer or broadcast."""
import json
import os
import pathlib
import subprocess

root = pathlib.Path(__file__).resolve().parents[2]
source = root / 'outputs/reviews/continuous-service-2026-09-07'
out = root / 'outputs/reviews/scoped-observations-2026-09-07'
out.mkdir(parents=True, exist_ok=True)
env = dict(os.environ)
loaded = subprocess.run(
    ['node', '--env-file=' + str(root / '.env'), '-e',
     "process.stdout.write(process.env.ARBITRUM_SEPOLIA_RPC_URL || '')"],
    capture_output=True, text=True)
if loaded.returncode or not loaded.stdout.strip():
    raise SystemExit('Local archive RPC environment unavailable')
env.update(
    TG_RPC_URL=loaded.stdout.strip(),
    TG_DEPLOYMENT_MANIFEST=str(source / 'manifest.json'),
    TG_LIVE_DATABASE_URL=json.loads((source / 'database.json').read_text())['url'],
    TG_TEST_DATABASE_URL=json.loads((source / 'database.json').read_text())['url'],
    TG_TEST_OBSERVATION_BLOCK=hex(306141471),
    TG_TEST_OBSERVATION_LIVE='1', TG_TEST_OBSERVATION_WORK='1')
with (out / 'live-equivalence.log').open('w') as log:
    result = subprocess.run(
        ['go', 'test', '-race', './internal/observationwork', '-run',
         'TestLiveScopedEquivalence', '-v', '-count=1', '-timeout=5m'],
        cwd=root / 'services/backend-go', env=env,
        stdout=log, stderr=subprocess.STDOUT, timeout=330)
print('live_equivalence_exit', result.returncode)
raise SystemExit(result.returncode)
