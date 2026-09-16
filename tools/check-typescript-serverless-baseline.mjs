import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = path.join(root, 'docs/backend/typescript-serverless-baseline.json');
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));

function fail(message) {
  throw new Error(`TypeScript Serverless baseline invalid: ${message}`);
}

if (baseline.schema !== 'tickergarden.typescript-serverless-baseline.v1') fail('unknown schema');
if (baseline.executionSpecId !== 'V1-EXEC-11') fail('execution spec drift');
if (baseline.target?.chainId !== 46630) fail('target chain drift');
if (!/^0x[0-9a-f]{64}$/.test(baseline.target.releaseId)) fail('invalid release ID');
if (!/^0x[0-9a-f]{40}$/.test(baseline.target.factory)) fail('invalid Factory');
if (baseline.target.holderRewardMode?.name !== 'TICKERGARDEN_HOLDER_WALLET_SNAPSHOT_V1') fail('reward mode drift');

for (const [relative, expected] of Object.entries(baseline.sourceLocks ?? {})) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) fail(`missing locked source ${relative}`);
  const actual = createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
  if (actual !== expected) fail(`source changed: ${relative}`);
}

const bootstrapPath = baseline.target.bootstrap;
if (typeof bootstrapPath !== 'string' || !bootstrapPath.startsWith('apps/web/tests/fixtures/integration/')) fail('invalid test fixture bootstrap path');
const bootstrap = JSON.parse(fs.readFileSync(path.join(root, bootstrapPath), 'utf8'));
if (bootstrap.chainId !== baseline.target.chainId) fail('bootstrap chain differs');
if (bootstrap.releaseId !== baseline.target.releaseId) fail('bootstrap release differs');
if (bootstrap.factory !== baseline.target.factory) fail('bootstrap Factory differs');
if (bootstrap.activationBlock?.number !== baseline.target.activationBlockNumber) fail('activation block differs');
if (bootstrap.activationBlock?.hash !== baseline.target.activationBlockHash) fail('activation hash differs');

const scope = fs.readFileSync(path.join(root, 'docs/backend/frontend-api-scope.md'), 'utf8');
for (const required of [
  '/health', '/v1/config/{kind}', '/v1/markets', '/v1/market-statistics',
  '/v1/prices/references', '/v1/users/{address}/positions', '/v1/users/{address}/accounts',
  '/v1/users/{address}/activity', '/v1/updates', '/v1/stats/holders', '/v1/stats/series',
  '/v1/stats/overview', '/v1/transactions/{txHash}', '/v1/protocol-statistics',
  '/v1/statistics-prices', '/v1/launch-recovery', '/v1/creator-markets',
  '/v1/holder-markets', '/v1/wallet-holder-markets', '/v1/content/challenges',
]) if (!scope.includes(required)) fail(`scope omits ${required}`);

console.log(`TypeScript Serverless baseline verified: ${Object.keys(baseline.sourceLocks).length} source locks, chain ${baseline.target.chainId}, release ${baseline.target.releaseId}.`);
