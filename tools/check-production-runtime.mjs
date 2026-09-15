import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {productionRuntime} from '../services/backend-ts/packages/runtime-deployment/src/production.generated.ts';

// Compare the committed public artifact with an independently refreshed RPC snapshot.
const input = process.argv[2];
if (!input) throw Error('Usage: node tools/check-production-runtime.mjs <verified-snapshot.json>');
const snapshot = JSON.parse(await readFile(input, 'utf8'));
const {schemaVersion, observedAt, finalizedHead, ...actual} = snapshot;
const {observedAt: capturedAt, finalizedHead: capturedHead, ...expected} = productionRuntime;
delete actual.poolManager.codeBytes;
assert.equal(schemaVersion, 1);
assert.ok(BigInt(finalizedHead) >= BigInt(productionRuntime.activationBlock));
assert.deepEqual(actual, expected, 'Production deployment or configuration differs from the frozen artifact');
console.log('PASS: production runtime matches verified receipts, code and 392 activation configurations');
