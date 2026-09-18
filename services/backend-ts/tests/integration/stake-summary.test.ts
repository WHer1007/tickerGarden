import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import type { Address, Hex } from 'viem';
import { createReadApiApp } from '../../apps/read-api/src/index.ts';
import { applyCoreMigration, createDatabasePool } from '../../packages/db/src/index.ts';
import { F72_RELEASE_ID } from '../../packages/events/src/index.ts';
import { ProjectionPending } from '../../packages/projection/src/index.ts';
import { PublicationUnavailableError } from '../../packages/read-store/src/index.ts';
import { projectStakeSummaries, readStakeSummary, type StakeRewardSummary } from '../../packages/history-projector/src/stake-summary.ts';

const connectionString = process.env.TG_MIGRATION_DATABASE_URL ?? process.env.TG_DATABASE_URL;
const hash = (character: string): Hex => `0x${character.repeat(64)}`;
const address = (character: string): Address => `0x${character.repeat(40)}`;
const ident = (value: string): string => { assert.match(value, /^[a-z][a-z0-9_]{0,62}$/); return `"${value}"`; };

test('stake summaries are wallet scoped, resumable, finalized, and recomputed by generation', { timeout: 60_000 }, async (context) => {
  if (!connectionString) { context.skip('TG_MIGRATION_DATABASE_URL or TG_DATABASE_URL is required'); return; }
  const schemaName = `tg_stake_summary_${process.pid}_${randomBytes(4).toString('hex')}`; const schema = ident(schemaName);
  const handle = createDatabasePool(connectionString, { max: 2 });
  const deployment = { environment: 'test' as const, chainId: 46630 as const, deploymentDigest: F72_RELEASE_ID, activationBlock: 1n };
  const marketId = hash('1'); const quote = address('2'); const meme = address('3');
  const alice = address('4'); const bob = address('5'); const charlie = address('6'); const assetUid = hash('7');
  try {
    await applyCoreMigration(handle.pool, schemaName);
    await handle.pool.query(`INSERT INTO ${schema}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES ('test',46630,$1,$2,1,$3,$4)`, [deployment.deploymentDigest, hash('a'), hash('b'), hash('c')]);
    await addBlock(1, hash('b'), hash('a'), true);
    await addBlock(2, hash('c'), hash('b'), true);
    await handle.pool.query(`INSERT INTO ${schema}.ingestion_checkpoints(environment,chain_id,deployment_digest,stream,next_block,last_block_hash,generation) VALUES ('test',46630,$1,'frontend-events',3,$2,0)`, [deployment.deploymentDigest, hash('c')]);
    await addCoverage(0);
    await addMarket(1, hash('b'), 0);
    await addMarket(2, hash('c'), 0);
    await addPosition(0, alice, 1, 2, [{ asset: quote, amount: '11', kind: 'quote' }, { asset: meme, amount: '13', kind: 'meme' }]);
    await addPosition(0, bob, 1, null, [{ asset: quote, amount: '5', kind: 'quote' }]);
    await addPosition(0, charlie, 2, null, [{ asset: quote, amount: '17', kind: 'quote' }]);
    await addClaim(alice, quote, '7', 1, '8'); await addClaim(alice, meme, '3', 1, '9');
    await addClaim(bob, quote, '100', 1, 'a'); await addClaim(alice, quote, '2', 2, 'b');
    const api = createReadApiApp({ pool: handle.pool, deployment, env: { NODE_ENV: 'test', TG_ENVIRONMENT: 'test',
      TG_READ_DATABASE_URL: connectionString, TG_CURSOR_SECRET: 'stake-summary-integration-secret-at-least-32-bytes', TG_DATABASE_SCHEMA: schemaName } });

    await addInputCheckpoints(1, hash('b'), 0);
    const unknownBeforeCompletion = await api.request(`/v1/staker-reward-summary?marketId=${marketId}&account=${charlie}`);
    assert.equal(unknownBeforeCompletion.status, 503, 'unknown history remains unavailable before a completed summary anchor');
    const first = { pool: handle.pool, deployment, blockNumber: 1n, blockHash: hash('b'), generation: 0n, schemaName, pageSize: 1 };
    await assert.rejects(() => projectStakeSummaries(first), (error: unknown) => error instanceof ProjectionPending);
    await projectStakeSummaries(first);
    const aliceAt1 = await summary(alice);
    assert.deepEqual(aliceAt1.claimed, { [quote]: '7', [meme]: '3' });
    assert.deepEqual(aliceAt1.earned, { [quote]: '18', [meme]: '3' }, 'burned meme claimable is excluded from earned');
    const bobAt1 = await summary(bob);
    assert.deepEqual(bobAt1.claimed, { [quote]: '100' });
    assert.deepEqual(bobAt1.earned, { [quote]: '105' }, 'a second wallet receives only its own totals');
    const apiAlice = await api.request(`/v1/staker-reward-summary?marketId=${marketId}&account=${alice}`);
    assert.equal(apiAlice.status, 200); assert.equal(apiAlice.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await apiAlice.json(), aliceAt1, 'the API returns the requested wallet summary');
    const completedEmpty = await api.request(`/v1/staker-reward-summary?marketId=${marketId}&account=${charlie}`);
    assert.equal(completedEmpty.status, 200); assert.equal(completedEmpty.headers.get('cache-control'), 'no-store');
    assert.deepEqual((await completedEmpty.json() as StakeRewardSummary).earned, {}, 'completed anchor may prove an unknown wallet has zero history');

    await addInputCheckpoints(2, hash('c'), 0);
    await projectStakeSummaries({ ...first, blockNumber: 2n, blockHash: hash('c'), pageSize: 200 });
    const aliceAfterExit = await summary(alice);
    assert.deepEqual(aliceAfterExit.claimed, { [quote]: '9', [meme]: '3' });
    assert.deepEqual(aliceAfterExit.earned, aliceAfterExit.claimed, 'after the position version closes, earned contains claimed only');

    await handle.pool.query(`UPDATE ${schema}.chain_blocks SET canonical=false,finalized=false WHERE environment='test' AND chain_id=46630 AND deployment_digest=$1 AND hash=$2`, [deployment.deploymentDigest, hash('c')]);
    await assert.rejects(() => summary(alice), (error: unknown) => error instanceof PublicationUnavailableError);
    await addBlock(2, hash('d'), hash('b'), true);
    await handle.pool.query(`UPDATE ${schema}.ingestion_checkpoints SET next_block=3,last_block_hash=$2,generation=1 WHERE environment='test' AND chain_id=46630 AND deployment_digest=$1 AND stream='frontend-events'`, [deployment.deploymentDigest, hash('d')]);
    await addCoverage(1);
    await addMarket(2, hash('d'), 1);
    await addPosition(1, alice, 2, null, []);
    await addPosition(1, bob, 2, null, [{ asset: quote, amount: '8', kind: 'quote' }]);
    await addInputCheckpoints(2, hash('d'), 1);
    await projectStakeSummaries({ ...first, blockNumber: 2n, blockHash: hash('d'), generation: 1n, pageSize: 200 });
    const recomputedAlice = await summary(alice);
    assert.equal(recomputedAlice.revision, `2:${hash('d')}`);
    assert.deepEqual(recomputedAlice.earned, recomputedAlice.claimed);
    const recomputedBob = await summary(bob);
    assert.deepEqual(recomputedBob.earned, { [quote]: '108' }, 'generation recomputation retains wallet-specific claimed plus current claimable');
  } finally {
    await handle.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
    await handle.pool.end();
  }

  async function addBlock(number: number, blockHash: Hex, parentHash: Hex, finalized: boolean) {
    await handle.pool.query(`INSERT INTO ${schema}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized,source_timestamp) VALUES('test',46630,$1,$2,$3,$4,true,$5,to_timestamp($6))`, [deployment.deploymentDigest, number, blockHash, parentHash, finalized, 1000 + number]);
  }
  async function addCoverage(generation: number) {
    await handle.pool.query(`INSERT INTO ${schema}.covered_ranges(environment,chain_id,deployment_digest,from_block,to_block,generation,filter_digest,complete,verified_at) VALUES('test',46630,$1,1,2,$2,$3,true,now())`, [deployment.deploymentDigest, generation, hash('e')]);
  }
  async function addMarket(number: number, blockHash: Hex, generation: number) {
    const revision = `${number}:${blockHash}`;
    await handle.pool.query(`INSERT INTO ${schema}.publications(environment,chain_id,deployment_digest,scope,revision,block_number,block_hash,generation,payload_digest,payload) VALUES('test',46630,$1,'markets',$2,$3,$4,$5,$6,$7)`, [deployment.deploymentDigest, revision, number, blockHash, generation, hash('f'), {}]);
    await handle.pool.query(`INSERT INTO ${schema}.projection_records(environment,chain_id,deployment_digest,scope,revision,identity,sort_key,payload_digest,payload) VALUES('test',46630,$1,'markets',$2,$3,$3,$4,$5)`, [deployment.deploymentDigest, revision, marketId, hash('f'), { marketId, assetUid, quoteAsset: quote, memeToken: meme, burnMemeFees: true }]);
  }
  async function addPosition(generation: number, account: Address, from: number, to: number | null, claimable: Array<{asset: Address; amount: string; kind: string}>) {
    const identity = `${account}:${assetUid}:${marketId}`; const payload = { user: account, marketId, claimable };
    await handle.pool.query(`INSERT INTO ${schema}.principal_record_versions(environment,chain_id,deployment_digest,generation,scope,identity,valid_from,valid_to,sort_key,payload_digest,payload) VALUES('test',46630,$1,$2,'positions',$3,$4,$5,$6,$7,$8)`, [deployment.deploymentDigest, generation, identity, from, to, identity, hash('f'), payload]);
  }
  async function addClaim(account: Address, asset: Address, amount: string, throughBlock: number, tx: string) {
    await handle.pool.query(`INSERT INTO ${schema}.reward_history(environment,chain_id,deployment_digest,kind,market_id,account,asset,transaction_hash,log_index,through_block,amount_raw,display_only,payload) VALUES('test',46630,$1,'staker',$2,$3,$4,$5,0,$6,$7,true,'{}')`, [deployment.deploymentDigest, marketId, account, asset, hash(tx), throughBlock, amount]);
  }
  async function addInputCheckpoints(number: number, blockHash: Hex, generation: number) {
    const revision = `${number}:${blockHash}`;
    for (const scope of ['history', 'positions'] as const) {
      await handle.pool.query(`INSERT INTO ${schema}.projection_checkpoints(environment,chain_id,deployment_digest,scope,algorithm_version,next_block,generation,last_revision) VALUES('test',46630,$1,$2,'fixture-v1',$3,$4,$5) ON CONFLICT(environment,chain_id,deployment_digest,scope) DO UPDATE SET next_block=excluded.next_block,generation=excluded.generation,last_revision=excluded.last_revision`, [deployment.deploymentDigest, scope, number + 1, generation, revision]);
    }
    await handle.pool.query(`INSERT INTO ${schema}.publications(environment,chain_id,deployment_digest,scope,revision,block_number,block_hash,generation,payload_digest,payload) VALUES('test',46630,$1,'positions',$2,$3,$4,$5,$6,$7)`, [deployment.deploymentDigest, revision, number, blockHash, generation, hash('a'), { storage: 'principal-versions-v1' }]);
  }
  async function summary(account: Address): Promise<StakeRewardSummary> {
    return readStakeSummary({ pool: handle.pool, deployment, schemaName, marketId, account });
  }
});
