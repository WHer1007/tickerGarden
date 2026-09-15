import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import test from 'node:test';
import type { PoolClient } from 'pg';
import type { Client } from '@upstash/qstash';
import { applyCoreMigration, coreMigrationDigest, createDatabasePool, migrationSql, permissionsSql, transaction } from '../../packages/db/src/index.ts';
import {
  advanceQueueGeneration, claimJobByOperation, claimJobs, claimOutbox, completeJob, completeOutbox, enqueueReliableMessage, failJob, failOutbox, recoverExpiredLeases,
  recoverExpiredOutboxLeases, processSignedJob, requeueDueJobs, type Lease,
} from '../../packages/jobs/src/index.ts';
import { createPipelineApp } from '../../apps/pipeline/src/index.ts';
import { createReadApiApp } from '../../apps/read-api/src/index.ts';
import { ingestCanonicalRange, rewindCanonicalChain, RpcTransport, type ContractSource, type RpcBlock } from '../../packages/chain/src/index.ts';
import { invalidateOrphanedPublications, publishProjection } from '../../packages/projection/src/index.ts';
import { readPublishedConfigPage, readPublishedMarketPage, readPublishedPage, readPublishedUserPage } from '../../packages/read-store/src/index.ts';
import { CURRENT_ACTIVATION_BLOCK, CURRENT_RELEASE_ID } from '../../packages/events/src/index.ts';

const connectionString = process.env.TG_MIGRATION_DATABASE_URL ?? process.env.TG_DATABASE_URL;

function ident(value: string): string {
  assert.match(value, /^[a-z][a-z0-9_]{0,62}$/);
  return `"${value}"`;
}

function quoteRole(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function hash(character: string): `0x${string}` {
  return `0x${character.repeat(64)}`;
}

function address(character: string): `0x${string}` {
  return `0x${character.repeat(40)}`;
}

function qstashSignature(body: string, url: string, key: string): string {
  const encoded = (value: string | Buffer) => Buffer.from(value).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = encoded(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = encoded(JSON.stringify({
    iss: 'Upstash', sub: url, nbf: now - 5, exp: now + 60,
    body: createHash('sha256').update(body).digest('base64url'),
  }));
  return `${header}.${payload}.${createHmac('sha256', key).update(`${header}.${payload}`).digest('base64url')}`;
}

function chainFetch(alternateBlockFive = false, omitTokenLog = false): typeof fetch {
  return async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { id: number; method: string; params: Array<Record<string, unknown> | string> };
    let result: unknown;
    if (request.method === 'eth_getBlockByNumber') {
      const number = BigInt(String(request.params[0]));
      const blockHash = number === 4n ? hash('a') : alternateBlockFive ? hash('f') : hash('b');
      result = { number: `0x${number.toString(16)}`, hash: blockHash, parentHash: number === 4n ? hash('3') : hash('a'), timestamp: number === 4n ? '0x3e8' : '0x3e9' };
    } else if (request.method === 'eth_getLogs') {
      const filter = request.params[0] as { fromBlock: string; address: string[] };
      const number = BigInt(filter.fromBlock);
      const entries: Record<string, unknown>[] = [];
      if (number === 4n && filter.address.includes(address('a'))) entries.push({
        address: address('a'), blockHash: hash('a'), blockNumber: '0x4', transactionHash: hash('c'), transactionIndex: '0x0', logIndex: '0x0',
        data: '0x', topics: [hash('d')], removed: false,
      });
      if (number === 4n && filter.address.includes(address('b'))) entries.push({
        address: address('b'), blockHash: hash('a'), blockNumber: '0x4', transactionHash: hash('c'), transactionIndex: '0x0', logIndex: '0x1',
        data: '0x', topics: [hash('e')], removed: false,
      });
      if (!omitTokenLog && number === 4n && filter.address.includes(address('c'))) entries.push({
        address: address('c'), blockHash: hash('a'), blockNumber: '0x4', transactionHash: hash('c'), transactionIndex: '0x0', logIndex: '0x2',
        data: '0x', topics: [hash('f')], removed: false,
      });
      result = entries;
    } else {
      throw new Error(`unexpected RPC method ${request.method}`);
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), { headers: { 'content-type': 'application/json' } });
  };
}

async function withRole(client: PoolClient, role: string, operation: () => Promise<void>): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL ROLE ${ident(role)}`);
    await operation();
  } finally {
    await client.query('ROLLBACK');
  }
}

async function rejectsQuery(operation: () => Promise<unknown>, pattern: RegExp): Promise<void> {
  await assert.rejects(operation, pattern);
}

test('TS-02/03/04/05/06 PostgreSQL, ingestion, publications and Hono read paths', { timeout: 60_000 }, async (context) => {
  if (!connectionString) {
    context.skip('TG_MIGRATION_DATABASE_URL or TG_DATABASE_URL is required');
    return;
  }

  const suffix = `${process.pid}_${randomBytes(4).toString('hex')}`;
  const schemaName = `tg_ts02_${suffix}`;
  const schema = ident(schemaName);
  const roles = {
    readApi: `tg_read_${suffix}`,
    content: `tg_content_${suffix}`,
    pipeline: `tg_pipeline_${suffix}`,
  } as const;
  const handle = createDatabasePool(connectionString, { max: 4, connectionTimeoutMillis: 15_000 });
  const createdRoles: string[] = [];

  try {
    assert.equal(await applyCoreMigration(handle.pool, schemaName), true);
    assert.equal(await applyCoreMigration(handle.pool, schemaName), false);

    const who = await handle.pool.query<{ current_user: string }>('SELECT current_user');
    const currentUser = who.rows[0]?.current_user;
    assert.ok(currentUser);
    for (const role of Object.values(roles)) {
      await handle.pool.query(`CREATE ROLE ${ident(role)} NOLOGIN`);
      createdRoles.push(role);
      await handle.pool.query(`GRANT ${ident(role)} TO ${quoteRole(currentUser)}`);
    }
    await handle.pool.query(permissionsSql(schemaName, roles));
    for(const table of ['market_latest_buys','market_cap_snapshots','market_cap_ranks','holder_reward_wallet_proofs']){
      const grants=(await handle.pool.query<{can_read:boolean;can_write:boolean;pipeline_write:boolean}>(`SELECT has_table_privilege($1,$3,'SELECT') can_read,has_table_privilege($1,$3,'INSERT') can_write,has_table_privilege($2,$3,'INSERT') pipeline_write`,[roles.readApi,roles.pipeline,`${schemaName}.${table}`])).rows[0]!;
      assert.deepEqual(grants,{can_read:true,can_write:false,pipeline_write:true});
    }
    assert.equal((await handle.pool.query(`SELECT has_column_privilege($1,$2,'verified_header','UPDATE') permitted,has_column_privilege($1,$2,'payload','UPDATE') raw_update`,[roles.pipeline,`${schemaName}.holder_reward_datasets`])).rows[0].permitted,true);
    assert.equal((await handle.pool.query(`SELECT has_column_privilege($1,$2,'payload','UPDATE') raw_update`,[roles.pipeline,`${schemaName}.holder_reward_datasets`])).rows[0].raw_update,false);


    const deployment = ['test', 46630, hash('1'), hash('2'), 115580290n, hash('3'), hash('4')] as const;
    await handle.pool.query(
      `INSERT INTO ${schema}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [...deployment],
    );
    for (const [number, blockHash, parentHash] of [[1n, hash('5'), hash('2')], [2n, hash('6'), hash('5')], [3n, hash('7'), hash('6')]] as const) {
      await handle.pool.query(
        `INSERT INTO ${schema}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized)
         VALUES ('test',46630,$1,$2,$3,$4,true,true)`,
        [deployment[2], number, blockHash, parentHash],
      );
    }
    await handle.pool.query(
      `INSERT INTO ${schema}.markets(environment,chain_id,deployment_digest,market_id,asset_uid,meme_token,quote_asset,curve,gauge,creator,creation_block,metadata_uri,payload)
       VALUES ('test',46630,$1,$2,$3,$4,$5,$6,$7,$8,1,'ipfs://market','{}')`,
      [deployment[2], hash('8'), hash('9'), address('a'), address('0'), address('b'), address('c'), address('d')],
    );

    const maxUint256 = ((1n << 256n) - 1n).toString();
    await handle.pool.query(
      `INSERT INTO ${schema}.account_facts(environment,chain_id,deployment_digest,account,market_id,asset_uid,free_raw,allocated_raw,pending_raw,payload)
       VALUES ('test',46630,$1,$2,$3,$4,$5,'0','0','{}')`,
      [deployment[2], address('e'), hash('8'), hash('9'), maxUint256],
    );
    await rejectsQuery(
      () => handle.pool.query(
        `INSERT INTO ${schema}.account_facts(environment,chain_id,deployment_digest,account,market_id,asset_uid,free_raw,allocated_raw,pending_raw,payload)
         VALUES ('test',46630,$1,$2,$3,$4,$5,'0','0','{}')`,
        [deployment[2], address('f'), hash('8'), hash('9'), (1n << 256n).toString()],
      ),
      /uint256_check|violates check constraint/,
    );

    await rejectsQuery(
      () => handle.pool.query(
        `INSERT INTO ${schema}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash)
         VALUES ('test',46630,$1,1,$2,$3)`,
        [deployment[2], hash('a'), hash('2')],
      ),
      /chain_blocks_canonical_height|duplicate key/,
    );

    const revisions = [[1, hash('5')], [2, hash('6')], [3, hash('7')]] as const;
    for (const [blockNumber, blockHash] of revisions) {
      await handle.pool.query(
        `INSERT INTO ${schema}.publications(environment,chain_id,deployment_digest,scope,revision,block_number,block_hash,generation,payload_digest,payload)
         VALUES ('test',46630,$1,'markets',$2,$3,$4,1,$5,'{}')`,
        [deployment[2], `${blockNumber}:${blockHash}`, blockNumber, blockHash, hash(String(blockNumber))],
      );
    }
    await handle.pool.query(
      `INSERT INTO ${schema}.publication_pointers(environment,chain_id,deployment_digest,scope,revision)
       VALUES ('test',46630,$1,'markets',$2)`,
      [deployment[2], `1:${hash('5')}`],
    );
    const updates = await Promise.all([
      handle.pool.query(
        `UPDATE ${schema}.publication_pointers SET revision=$1 WHERE environment='test' AND chain_id=46630 AND deployment_digest=$2 AND scope='markets' AND revision=$3`,
        [`2:${hash('6')}`, deployment[2], `1:${hash('5')}`],
      ),
      handle.pool.query(
        `UPDATE ${schema}.publication_pointers SET revision=$1 WHERE environment='test' AND chain_id=46630 AND deployment_digest=$2 AND scope='markets' AND revision=$3`,
        [`3:${hash('7')}`, deployment[2], `1:${hash('5')}`],
      ),
    ]);
    assert.deepEqual(updates.map((result) => result.rowCount).sort(), [0, 1]);
    await rejectsQuery(
      () => handle.pool.query(`UPDATE ${schema}.publications SET payload='{"changed":true}' WHERE scope='markets'`),
      /publications are immutable/,
    );

    await assert.rejects(
      transaction(handle.pool, async (client) => {
        await client.query(
          `INSERT INTO ${schema}.covered_ranges(environment,chain_id,deployment_digest,from_block,to_block,filter_digest,complete,verified_at)
           VALUES ('test',46630,$1,10,20,$2,true,now())`,
          [deployment[2], hash('a')],
        );
        throw new Error('force rollback');
      }),
      /force rollback/,
    );
    const rolledBack = await handle.pool.query(`SELECT count(*)::int AS count FROM ${schema}.covered_ranges WHERE from_block=10`);
    assert.equal(rolledBack.rows[0]?.count, 0);

    const ingestionDigest = hash('d');
    await handle.pool.query(
      `INSERT INTO ${schema}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest)
       VALUES ('test',46630,$1,$2,4,$3,$4)`,
      [ingestionDigest, hash('2'), hash('a'), hash('4')],
    );
    const factorySource: ContractSource = { module: 'Factory', address: address('a'), birthBlock: 4n, runtimeCodeHash: hash('1') };
    const childSource: ContractSource = { module: 'Curve', address: address('b'), birthBlock: 4n, runtimeCodeHash: hash('2') };
    const tokenSource: ContractSource = { module: 'TickerMemeTokenV1', address: address('c'), birthBlock: 4n, runtimeCodeHash: hash('3') };
    const primary = new RpcTransport({ url: 'https://primary.example', fetch: chainFetch() });
    const secondary = new RpcTransport({ url: 'https://secondary.example', fetch: chainFetch() });
    const observedHead: RpcBlock = { number: 10n, hash: hash('9'), parentHash: hash('8'), timestamp: 2_000n };
    await assert.rejects(ingestCanonicalRange({
      pool: handle.pool, deployment: { environment: 'test', chainId: 46630, deploymentDigest: ingestionDigest, activationBlock: 4n },
      stream: 'events', fromBlock: 4n, toBlock: 5n, observedHead, finalityDelayBlocks: 2n, finalityDelaySeconds: 600n,
      primary, secondary: new RpcTransport({ url: 'https://secondary.example', fetch: chainFetch(false, true) }), sources: [factorySource], schemaName,
      discover: (logs, block) => block.number === 4n && logs.some((log) => log.address === factorySource.address && log.topics[0] === hash('d')) ? [childSource, tokenSource] : [],
    }), /providers disagree on range logs/);
    const ingestion = await ingestCanonicalRange({
      pool: handle.pool, deployment: { environment: 'test', chainId: 46630, deploymentDigest: ingestionDigest, activationBlock: 4n },
      stream: 'events', fromBlock: 4n, toBlock: 5n, observedHead, finalityDelayBlocks: 2n, finalityDelaySeconds: 600n,
      primary, secondary, sources: [factorySource], schemaName,
      // The Factory creation hint discovers both contracts and forces their mint/buy logs to be fetched again from the same birth block.
      discover: (logs, block) => block.number === 4n && logs.some((log) => log.address === factorySource.address && log.topics[0] === hash('d')) ? [childSource, tokenSource] : [],
    });
    assert.deepEqual({ blocks: ingestion.blocks, logs: ingestion.logs, sources: ingestion.sources, generation: ingestion.generation }, { blocks: 2, logs: 3, sources: 3, generation: '0' });
    assert.equal((await handle.pool.query(`SELECT count(*)::int count FROM ${schema}.chain_logs l JOIN ${schema}.chain_blocks b ON b.environment=l.environment AND b.chain_id=l.chain_id AND b.deployment_digest=l.deployment_digest AND b.hash=l.block_hash WHERE l.deployment_digest=$1 AND b.number=5`, [ingestionDigest])).rows[0]?.count, 0);
    const checkpointAfterIngest = await handle.pool.query<{ next_block: string }>(
      `SELECT next_block FROM ${schema}.ingestion_checkpoints WHERE deployment_digest=$1 AND stream='events'`, [ingestionDigest],
    );
    assert.equal(checkpointAfterIngest.rows[0]?.next_block, '6');
    await assert.rejects(ingestCanonicalRange({
      pool: handle.pool, deployment: { environment: 'test', chainId: 46630, deploymentDigest: ingestionDigest, activationBlock: 4n },
      stream: 'events', fromBlock: 4n, toBlock: 4n, observedHead, finalityDelayBlocks: 2n, finalityDelaySeconds: 600n,
      primary, sources: [factorySource], schemaName,
    }), /checkpoint does not match/);
    await assert.rejects(rewindCanonicalChain({
      pool: handle.pool, deployment: { environment: 'test', chainId: 46630, deploymentDigest: ingestionDigest, activationBlock: 4n },
      stream: 'events', ancestor: { number: 3n, hash: hash('3'), parentHash: hash('2'), timestamp: 999n }, expectedNextBlock: 6n, schemaName,
    }), /before deployment activation/);
    assert.equal(await rewindCanonicalChain({
      pool: handle.pool, deployment: { environment: 'test', chainId: 46630, deploymentDigest: ingestionDigest, activationBlock: 4n },
      stream: 'events', ancestor: { number: 4n, hash: hash('a'), parentHash: hash('3'), timestamp: 1_000n }, expectedNextBlock: 6n, schemaName,
    }), '1');
    const reingested = await ingestCanonicalRange({
      pool: handle.pool, deployment: { environment: 'test', chainId: 46630, deploymentDigest: ingestionDigest, activationBlock: 4n },
      stream: 'events', fromBlock: 5n, toBlock: 5n, observedHead, finalityDelayBlocks: 2n, finalityDelaySeconds: 600n,
      primary: new RpcTransport({ url: 'https://primary.example', fetch: chainFetch(true) }), sources: [factorySource, childSource, tokenSource], schemaName,
    });
    assert.equal(reingested.generation, '1');
    const oldFork = await handle.pool.query<{ canonical: boolean }>(
      `SELECT canonical FROM ${schema}.chain_blocks WHERE deployment_digest=$1 AND number=5 AND hash=$2`, [ingestionDigest, hash('b')],
    );
    assert.equal(oldFork.rows[0]?.canonical, false);

    const projectionInput = {
      pool: handle.pool,
      deployment: { environment: 'test' as const, chainId: 46630 as const, deploymentDigest: ingestionDigest, activationBlock: 4n },
      scope: 'markets', algorithmVersion: 'markets-v1', blockNumber: 5n, blockHash: hash('f'), generation: 1n, stream: 'events',
      records: [
        { identity: hash('b'), sortKey: '0002', payload: { marketId: hash('b'), value: '2' } },
        { identity: hash('a'), sortKey: '0001', payload: { marketId: hash('a'), value: '1' } },
      ], schemaName,
    };
    assert.deepEqual(await publishProjection(projectionInput), { revision: `5:${hash('f')}`, duplicate: false, records: 2 });
    assert.deepEqual(await publishProjection(projectionInput), { revision: `5:${hash('f')}`, duplicate: true, records: 2 });
    assert.equal((await handle.pool.query(`SELECT revision FROM ${schema}.publication_pointers WHERE scope='markets' AND deployment_digest=$1`, [ingestionDigest])).rows[0]?.revision, `5:${hash('f')}`);
    const firstPage = await readPublishedPage({
      pool: handle.pool, deployment: projectionInput.deployment, scope: 'markets', filter: {},
      secret: 'integration-cursor-secret-with-32-bytes', limit: 1, schemaName,
    });
    const firstMarketPage = await readPublishedMarketPage({
      pool: handle.pool, deployment: projectionInput.deployment, filter: { sort: 'marketId_asc' },
      secret: 'integration-cursor-secret-at-least-32-bytes', limit: 1, schemaName,
    });
    assert.equal((firstMarketPage.items[0] as { marketId: string }).marketId, hash('a'));
    assert.ok(firstMarketPage.nextCursor);
    const secondMarketPage = await readPublishedMarketPage({
      pool: handle.pool, deployment: projectionInput.deployment, filter: { sort: 'marketId_asc' },
      secret: 'integration-cursor-secret-at-least-32-bytes', limit: 1, cursor: firstMarketPage.nextCursor!, schemaName,
    });
    assert.equal((secondMarketPage.items[0] as { marketId: string }).marketId, hash('b'));
    await assert.rejects(readPublishedMarketPage({
      pool: handle.pool, deployment: projectionInput.deployment, filter: { sort: 'marketId_desc' },
      secret: 'integration-cursor-secret-at-least-32-bytes', limit: 1, cursor: firstMarketPage.nextCursor!, schemaName,
    }), /cursor does not belong/);
    await publishProjection({ ...projectionInput, scope: 'configs', algorithmVersion: 'configs-v1', records: [
      { identity: `asset:${hash('a')}`, sortKey: `asset:${hash('a')}`, payload: { kind: 'asset', id: hash('a'), status: 1 } },
      { identity: `quote:${hash('b')}`, sortKey: `quote:${hash('b')}`, payload: { kind: 'quote', id: hash('b'), status: 1 } },
    ] });
    const assets = await readPublishedConfigPage({
      pool: handle.pool, deployment: projectionInput.deployment, kind: 'asset', secret: 'integration-cursor-secret-at-least-32-bytes', schemaName,
    });
    assert.deepEqual(assets.items, [{ kind: 'asset', id: hash('a'), status: 1 }]);
    const wallet = address('e');
    await publishProjection({ ...projectionInput, scope: 'accounts', algorithmVersion: 'accounts-v1', records: [
      { identity: `${wallet}:${hash('1')}`, sortKey: `${wallet}:${hash('1')}`, payload: { user: wallet, assetUid: hash('1'), deposited: '9', allocated: '4', free: '5' } },
      { identity: `${wallet}:${hash('2')}`, sortKey: `${wallet}:${hash('2')}`, payload: { user: wallet, assetUid: hash('2'), deposited: '2', allocated: '0', free: '2' } },
      { identity: `${address('d')}:${hash('1')}`, sortKey: `${address('d')}:${hash('1')}`, payload: { user: address('d'), assetUid: hash('1'), deposited: '1', allocated: '0', free: '1' } },
    ] });
    await publishProjection({ ...projectionInput, scope: 'positions', algorithmVersion: 'positions-v1', records: [
      { identity: `${wallet}:${hash('1')}:${hash('b')}`, sortKey: `${wallet}:${hash('1')}:${hash('b')}`,
        payload: { user: wallet, assetUid: hash('1'), marketId: hash('b'), allocated: '4', active: '3', pending: '1' } },
    ] });
    const accountPage = await readPublishedUserPage({ pool: handle.pool, deployment: projectionInput.deployment, kind: 'accounts', user: wallet,
      secret: 'integration-cursor-secret-at-least-32-bytes', limit: 1, schemaName });
    assert.equal(accountPage.items.length, 1); assert.ok(accountPage.nextCursor);
    const accountPage2 = await readPublishedUserPage({ pool: handle.pool, deployment: projectionInput.deployment, kind: 'accounts', user: wallet,
      revision: accountPage.sync.revision, cursor: accountPage.nextCursor!, secret: 'integration-cursor-secret-at-least-32-bytes', limit: 1, schemaName });
    assert.equal(accountPage2.items.length, 1); assert.equal(accountPage2.nextCursor, null);
    await assert.rejects(readPublishedUserPage({ pool: handle.pool, deployment: projectionInput.deployment, kind: 'accounts', user: address('d'),
      revision: accountPage.sync.revision, cursor: accountPage.nextCursor!, secret: 'integration-cursor-secret-at-least-32-bytes', limit: 1, schemaName }), /cursor does not belong/);
    const readApi = createReadApiApp({ pool: handle.pool, deployment: projectionInput.deployment, env: {
      NODE_ENV: 'test', TG_ENVIRONMENT: 'test', TG_READ_DATABASE_URL: connectionString,
      TG_CURSOR_SECRET: 'integration-cursor-secret-at-least-32-bytes', TG_DATABASE_SCHEMA: schemaName,
    } });
    const marketResponse = await readApi.request(`/v1/markets?sort=marketId_asc&limit=1&search=${hash('a').slice(0, 12)}`);
    assert.equal(marketResponse.status, 200);
    assert.equal(((await marketResponse.json()) as { items: Array<{ marketId: string }> }).items[0]?.marketId, hash('a'));
    const detailResponse = await readApi.request(`/v1/markets/${hash('b')}`);
    assert.equal(detailResponse.status, 200);
    assert.equal(((await detailResponse.json()) as { market: { marketId: string } }).market.marketId, hash('b'));
    const configResponse = await readApi.request('/v1/config/asset');
    assert.equal(configResponse.status, 200);
    assert.equal(((await configResponse.json()) as { items: unknown[] }).items.length, 1);
    const accountsResponse = await readApi.request(`/v1/users/${wallet}/accounts?revision=${encodeURIComponent(accountPage.sync.revision)}&limit=1`);
    assert.equal(accountsResponse.status, 200);
    assert.equal(((await accountsResponse.json()) as { items: Array<{ user: string }> }).items[0]?.user, wallet);
    const positionsResponse = await readApi.request(`/v1/users/${wallet}/positions?revision=${encodeURIComponent(accountPage.sync.revision)}`);
    assert.equal(positionsResponse.status, 200);
    assert.equal(((await positionsResponse.json()) as { items: Array<{ allocated: string }> }).items[0]?.allocated, '4');
    const updatesResponse = await readApi.request('/v1/updates'); assert.equal(updatesResponse.status, 200);
    const snapshotUpdate = await updatesResponse.json() as { mode: string; invalidated: string[]; sync: { revision: string } };
    assert.equal(snapshotUpdate.mode, 'reset'); assert.deepEqual(snapshotUpdate.invalidated, ['markets', 'configs', 'positions', 'accounts']);
    const unchangedResponse = await readApi.request(`/v1/updates?since=${encodeURIComponent(snapshotUpdate.sync.revision)}`);
    assert.equal(unchangedResponse.status, 200); assert.equal((await unchangedResponse.json() as { mode: string }).mode, 'unchanged');
    assert.match(marketResponse.headers.get('cache-control') ?? '', /s-maxage=15/);
    assert.equal(accountsResponse.headers.get('cache-control'), 'no-store');

    const largeDigest = hash('e');
    await handle.pool.query(
      `INSERT INTO ${schema}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest)
       VALUES ('test',46630,$1,$2,4,$3,$4)`, [largeDigest, hash('2'), hash('a'), hash('4')],
    );
    for (const [number, blockHash, parentHash] of [[4n, hash('a'), hash('3')], [5n, hash('f'), hash('a')]] as const) {
      await handle.pool.query(
        `INSERT INTO ${schema}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized)
         VALUES ('test',46630,$1,$2,$3,$4,true,true)`, [largeDigest, number, blockHash, parentHash],
      );
    }
    await handle.pool.query(
      `INSERT INTO ${schema}.ingestion_checkpoints(environment,chain_id,deployment_digest,stream,next_block,last_block_hash,generation)
       VALUES ('test',46630,$1,'frontend-events',6,$2,0)`, [largeDigest, hash('f')],
    );
    await handle.pool.query(
      `INSERT INTO ${schema}.covered_ranges(environment,chain_id,deployment_digest,from_block,to_block,generation,filter_digest,complete,verified_at)
       VALUES ('test',46630,$1,4,5,0,$2,true,now())`, [largeDigest, hash('d')],
    );
    const largeDeployment = { ...projectionInput.deployment, deploymentDigest: largeDigest };
    const largeRecords = Array.from({ length: 205 }, (_, index) => {
      const marketId = `0x${index.toString(16).padStart(64, '0')}` as `0x${string}`;
      return { identity: marketId, sortKey: marketId, payload: { marketId, memeToken: address('a'), launchPhase: index % 2,
        identity: { name: `Garden ${index.toString().padStart(3, '0')}`, symbol: `G${index}`, deployedAt: String(1_000 + index) } } } as const;
    });
    await publishProjection({ pool: handle.pool, deployment: largeDeployment, scope: 'markets', algorithmVersion: 'large-v1',
      blockNumber: 5n, blockHash: hash('f'), generation: 0n, records: largeRecords, schemaName });
    const seen = new Set<string>();
    let largeCursor: string | undefined;
    do {
      const page = await readPublishedMarketPage({ pool: handle.pool, deployment: largeDeployment, filter: { launchPhase: 1, sort: 'createdAt_desc' },
        secret: 'integration-cursor-secret-at-least-32-bytes', limit: 37, ...(largeCursor ? { cursor: largeCursor } : {}), schemaName });
      for (const item of page.items as Array<{ marketId: string }>) {
        assert.equal(seen.has(item.marketId), false);
        seen.add(item.marketId);
      }
      largeCursor = page.nextCursor ?? undefined;
    } while (largeCursor);
    assert.equal(seen.size, 102);
    assert.equal((firstPage.items[0] as { marketId: string }).marketId, hash('a'));
    assert.ok(firstPage.nextCursor);
    const secondPage = await readPublishedPage({
      pool: handle.pool, deployment: projectionInput.deployment, scope: 'markets', filter: {}, revision: firstPage.sync.revision,
      cursor: firstPage.nextCursor!, secret: 'integration-cursor-secret-with-32-bytes', limit: 1, schemaName,
    });
    assert.equal((secondPage.items[0] as { marketId: string }).marketId, hash('b'));
    assert.equal(secondPage.nextCursor, null);
    await rejectsQuery(
      () => handle.pool.query(`UPDATE ${schema}.projection_records SET payload='{}' WHERE scope='markets'`),
      /projection records are immutable/,
    );
    await handle.pool.query(`UPDATE ${schema}.chain_blocks SET canonical=false,finalized=false WHERE number=5 AND hash=$1`, [hash('f')]);
    assert.equal(await invalidateOrphanedPublications({ pool: handle.pool, deployment: projectionInput.deployment, generation: 2n, schemaName }), 4);
    assert.equal((await handle.pool.query(`SELECT count(*)::int AS count FROM ${schema}.publication_pointers WHERE scope='markets' AND deployment_digest=$1`, [ingestionDigest])).rows[0]?.count, 0);
    assert.equal((await handle.pool.query(`SELECT count(*)::int AS count FROM ${schema}.publication_pointers WHERE scope='configs' AND deployment_digest=$1`, [ingestionDigest])).rows[0]?.count, 0);
    assert.equal((await handle.pool.query(`SELECT reason FROM ${schema}.invalidations WHERE scope='markets' AND deployment_digest=$1 ORDER BY id DESC LIMIT 1`, [ingestionDigest])).rows[0]?.reason, 'anchor_orphaned');

    const rawBody = '{"block":{"number":"4"}}';
    const enqueued = await enqueueReliableMessage(handle.pool, {
      queue: 'chain', externalId: 'alchemy-webhook-1', operationId: 'chain-operation-1', kind: 'chain-webhook',
      rawBody, payload: { block: { number: '4' } }, destinationKey: 'chain-worker',
    }, schemaName);
    assert.equal(enqueued.duplicate, false);
    assert.equal((await enqueueReliableMessage(handle.pool, {
      queue: 'chain', externalId: 'alchemy-webhook-1', operationId: 'chain-operation-1', kind: 'chain-webhook',
      rawBody, payload: { block: { number: '4' } }, destinationKey: 'chain-worker',
    }, schemaName)).duplicate, true);
    await assert.rejects(
      enqueueReliableMessage(handle.pool, {
        queue: 'chain', externalId: 'alchemy-webhook-1', operationId: 'chain-operation-1', kind: 'chain-webhook',
        rawBody: '{"block":{"number":"5"}}', payload: { block: { number: '5' } }, destinationKey: 'chain-worker',
      }, schemaName),
      /reused with different content/,
    );

    const competingClaims = await Promise.all([
      claimJobs(handle.pool, 'chain', 'worker-a', 1, 20_000, schemaName),
      claimJobs(handle.pool, 'chain', 'worker-b', 1, 20_000, schemaName),
    ]);
    assert.equal(competingClaims.flat().length, 1);
    const firstLease = competingClaims.flat()[0]!;
    const leaseOwner = competingClaims[0]!.length ? 'worker-a' : 'worker-b';
    const staleLease: Lease = { ...firstLease, fencing: (BigInt(firstLease.fencing) + 1n).toString() };
    assert.equal(await completeJob(handle.pool, staleLease, leaseOwner, hash('a'), schemaName), false);
    assert.equal(await completeJob(handle.pool, firstLease, leaseOwner, hash('a'), schemaName), true);
    assert.equal(await completeJob(handle.pool, firstLease, leaseOwner, hash('a'), schemaName), false);

    const firstOutbox = (await claimOutbox(handle.pool, 'chain', 'dispatcher-a', 1, 20_000, schemaName))[0]!;
    assert.equal(await completeOutbox(handle.pool, firstOutbox, 'dispatcher-a', 'msg-integration-1', schemaName), true);

    await enqueueReliableMessage(handle.pool, {
      queue: 'chain', externalId: 'alchemy-webhook-dead', operationId: 'chain-operation-dead', kind: 'chain-webhook',
      rawBody: '{"dead":true}', payload: { dead: true }, destinationKey: 'chain-worker', maxAttempts: 1,
    }, schemaName);
    const deadLease = (await claimJobs(handle.pool, 'chain', 'worker-a', 1, 20_000, schemaName))[0]!;
    assert.equal(await failJob(handle.pool, deadLease, 'worker-a', 'fixture_failure', schemaName), 'dead');
    const deadOutbox = (await claimOutbox(handle.pool, 'chain', 'dispatcher-a', 1, 20_000, schemaName))[0]!;
    assert.equal(await failOutbox(handle.pool, deadOutbox, 'dispatcher-a', 'fixture_failure', schemaName), 'dead');

    await enqueueReliableMessage(handle.pool, {
      queue: 'chain', externalId: 'alchemy-webhook-expire', operationId: 'chain-operation-expire', kind: 'chain-webhook',
      rawBody: '{"expire":true}', payload: { expire: true }, destinationKey: 'chain-worker',
    }, schemaName);
    const expiringLease = (await claimJobs(handle.pool, 'chain', 'worker-a', 1, 1_000, schemaName))[0]!;
    await handle.pool.query(`UPDATE ${schema}.jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1`, [expiringLease.id]);
    assert.equal(await recoverExpiredLeases(handle.pool, 'chain', 10, schemaName), 1);
    const reclaimedLease = (await claimJobs(handle.pool, 'chain', 'worker-b', 1, 20_000, schemaName))[0]!;
    assert.ok(BigInt(reclaimedLease.fencing) > BigInt(expiringLease.fencing));
    assert.equal(await completeJob(handle.pool, expiringLease, 'worker-a', hash('b'), schemaName), false);
    assert.equal(await completeJob(handle.pool, reclaimedLease, 'worker-b', hash('b'), schemaName), true);

    const expiringOutbox = (await claimOutbox(handle.pool, 'chain', 'dispatcher-a', 1, 1_000, schemaName))[0]!;
    await handle.pool.query(`UPDATE ${schema}.outbox_messages SET lease_expires_at=now()-interval '1 second' WHERE id=$1`, [expiringOutbox.id]);
    assert.equal(await recoverExpiredOutboxLeases(handle.pool, 'chain', 10, schemaName), 1);
    const reclaimedOutbox = (await claimOutbox(handle.pool, 'chain', 'dispatcher-b', 20, 20_000, schemaName))
      .find((lease) => lease.id === expiringOutbox.id)!;
    assert.ok(reclaimedOutbox);
    assert.ok(BigInt(reclaimedOutbox.fencing) > BigInt(expiringOutbox.fencing));
    assert.equal(await completeOutbox(handle.pool, expiringOutbox, 'dispatcher-a', 'msg-stale', schemaName), false);
    assert.equal(await completeOutbox(handle.pool, reclaimedOutbox, 'dispatcher-b', 'msg-integration-2', schemaName), true);

    await enqueueReliableMessage(handle.pool, {
      queue: 'chain', externalId: 'alchemy-webhook-signed', operationId: 'chain-operation-signed', kind: 'chain-webhook',
      rawBody: '{"signed":true}', payload: { signed: true }, destinationKey: 'chain-worker',
    }, schemaName);
    const envelopeResult = await handle.pool.query<{ payload: Readonly<Record<string, unknown>> }>(
      `SELECT payload FROM ${schema}.outbox_messages WHERE operation_id='chain-operation-signed'`,
    );
    const signedBody = JSON.stringify(envelopeResult.rows[0]!.payload);
    const signedUrl = 'https://pipeline.example/v1/jobs/chain';
    const signingKey = 'integration-current-signing-key';
    const signedInput = {
      pool: handle.pool, queue: 'chain' as const, owner: 'signed-worker', body: signedBody,
      signature: qstashSignature(signedBody, signedUrl, signingKey), url: signedUrl,
      currentSigningKey: signingKey, nextSigningKey: 'integration-next-signing-key', schemaName,
      process: async (lease: Lease) => {
        assert.deepEqual(lease.payload, { signed: true });
        return 'signed-result';
      },
    };
    assert.equal(await processSignedJob(signedInput), 'succeeded');
    assert.equal(await processSignedJob(signedInput), 'duplicate_or_not_due');

    await enqueueReliableMessage(handle.pool, {
      queue: 'chain', externalId: 'retry-requeue', operationId: 'retry-requeue', kind: 'chain-backfill',
      rawBody: '{"retry":true}', payload: { retry: true }, destinationKey: 'chain-worker',
    }, schemaName);
    const retryLease = await claimJobByOperation(handle.pool, 'chain', 'retry-requeue', 'retry-worker', 20_000, schemaName);
    assert.ok(retryLease);
    assert.equal(await failJob(handle.pool, retryLease, 'retry-worker', 'fixture_failure', schemaName), 'retry');
    await handle.pool.query(`UPDATE ${schema}.jobs SET next_attempt_at=now() WHERE operation_id='retry-requeue'`);
    await handle.pool.query(`UPDATE ${schema}.outbox_messages SET state='sent' WHERE operation_id='retry-requeue'`);
    assert.equal(await requeueDueJobs(handle.pool, 'chain', 10, schemaName), 1);
    assert.equal((await handle.pool.query(`SELECT count(*)::int AS count FROM ${schema}.outbox_messages WHERE operation_id='retry-requeue' AND state='pending'`)).rows[0]?.count, 1);

    await handle.pool.query(`UPDATE ${schema}.outbox_messages SET state='sent',lease_owner=NULL,lease_expires_at=NULL WHERE state IN ('pending','retry')`);
    const chainRelayBody = JSON.stringify({
      schema: 'tickergarden.chain-log-trigger.v1', environment: 'test', chainId: 46630, releaseId: CURRENT_RELEASE_ID,
      head: { number: CURRENT_ACTIVATION_BLOCK.toString(), hash: hash('e') },
      log: {
        address: address('a'), blockHash: hash('e'), blockNumber: CURRENT_ACTIVATION_BLOCK.toString(), transactionHash: hash('d'),
        transactionIndex: '0', logIndex: '1', data: '0x', topics: [hash('c')], removed: false,
      },
    });
    const published: unknown[] = [];
    const qstashClient = {
      publishJSON: async (request: unknown) => {
        published.push(request);
        return { messageId: 'msg-alchemy-integration' };
      },
    } as unknown as Pick<Client, 'publishJSON'>;
    const pipeline = createPipelineApp({
      pool: handle.pool,
      qstashClient,
      chainProcessor: async (lease) => {
        assert.equal(lease.kind, 'chain-log-trigger');
        return 'chain-processed';
      },
      env: {
        NODE_ENV: 'test', TG_PIPELINE_DATABASE_URL: 'configured', TG_DATABASE_SCHEMA: schemaName,
        TG_PIPELINE_GENERATION: '0',
        QSTASH_CURRENT_SIGNING_KEY: signingKey, QSTASH_NEXT_SIGNING_KEY: 'integration-next-signing-key', QSTASH_CHAIN_TOKEN: 'configured',
        TG_CHAIN_JOB_CALLBACK_URL: 'https://pipeline.example/v1/jobs/chain', TG_REPAIR_TOKEN: 'repair', CRON_SECRET: 'cron',
        TG_RPC_URL: 'https://primary.example', TG_SECONDARY_RPC_URL: 'https://secondary.example',
      },
    });
    const chainRelayUrl = 'https://pipeline.example/v1/webhooks/chain-relay';
    const acceptedWebhook = await pipeline.request(chainRelayUrl, {
      method: 'POST', body: chainRelayBody,
      headers: { 'content-type': 'application/json', 'upstash-signature': qstashSignature(chainRelayBody, chainRelayUrl, signingKey) },
    });
    assert.equal(acceptedWebhook.status, 200);
    assert.deepEqual(await acceptedWebhook.json(), { accepted: true, duplicate: false });
    assert.equal(published.length, 1);
    const duplicateWebhook = await pipeline.request(chainRelayUrl, {
      method: 'POST', body: chainRelayBody,
      headers: { 'content-type': 'application/json', 'upstash-signature': qstashSignature(chainRelayBody, chainRelayUrl, signingKey) },
    });
    assert.equal(duplicateWebhook.status, 200);
    assert.equal((await duplicateWebhook.json()).duplicate, true);
    assert.equal(published.length, 1);
    const forgedWebhook = await pipeline.request(chainRelayUrl, {
      method: 'POST', body: `${chainRelayBody} `,
      headers: { 'content-type': 'application/json', 'upstash-signature': qstashSignature(chainRelayBody, chainRelayUrl, signingKey) },
    });
    assert.equal(forgedWebhook.status, 401);

    const dispatchedBody = JSON.stringify((published[0] as { body: unknown }).body);
    const chainJobUrl = 'https://pipeline.example/v1/jobs/chain';
    const processedJob = await pipeline.request(chainJobUrl, {
      method: 'POST', body: dispatchedBody,
      headers: { 'content-type': 'application/json', 'upstash-signature': qstashSignature(dispatchedBody, chainJobUrl, signingKey) },
    });
    assert.equal(processedJob.status, 200);
    assert.deepEqual(await processedJob.json(), { outcome: 'succeeded' });
    const metricsResponse = await pipeline.request('https://pipeline.example/internal/metrics', {
      headers: { authorization: 'Bearer repair' },
    });
    assert.equal(metricsResponse.status, 200);
    const metrics = await metricsResponse.json() as { queue: { queue: string }; pipeline: { chainId: number; unresolvedSourceConflicts: number; ingestion: unknown[] }; database: { total: number } };
    assert.equal(metrics.queue.queue, 'chain');
    assert.equal(metrics.pipeline.chainId, 46630);
    assert.equal(metrics.pipeline.unresolvedSourceConflicts, 0);
    assert.ok(Array.isArray(metrics.pipeline.ingestion));
    assert.ok(metrics.database.total >= 1);

    const client = await handle.pool.connect();
    try {
      await withRole(client, roles.readApi, async () => {
        assert.equal((await client.query(`SELECT count(*) FROM ${schema}.markets`)).rowCount, 1);
        await rejectsQuery(
          () => client.query(`INSERT INTO ${schema}.covered_ranges(environment,chain_id,deployment_digest,from_block,to_block,filter_digest,complete,verified_at) VALUES ('test',46630,$1,1,1,$2,true,now())`, [deployment[2], hash('a')]),
          /permission denied/,
        );
      });
      await withRole(client, roles.content, async () => {
        await client.query(
          `INSERT INTO ${schema}.content_objects(digest,owner,media_type,byte_length,object_version,status,payload)
           VALUES ($1,$2,'image/png',128,'v1','uploaded','{}')`,
          [hash('f'), address('f')],
        );
        await client.query(
          `INSERT INTO ${schema}.jobs(operation_id,queue,kind,payload_digest,payload) VALUES ('content-operation','content','publish',$1,'{}')`,
          [hash('c')],
        );
        assert.deepEqual((await client.query(`SELECT queue FROM ${schema}.queue_generations ORDER BY queue`)).rows, [{ queue: 'content' }]);
        assert.equal((await client.query(`UPDATE ${schema}.queue_generations SET active_generation=1 WHERE queue='chain'`)).rowCount, 0);
        await rejectsQuery(() => client.query(`SELECT * FROM ${schema}.markets`), /permission denied/);
      });
      await withRole(client, roles.content, async () => {
        await rejectsQuery(
          () => client.query(`INSERT INTO ${schema}.jobs(operation_id,queue,kind,payload_digest,payload) VALUES ('forbidden-chain','chain','scan',$1,'{}')`, [hash('d')]),
          /row-level security policy/,
        );
      });
      await withRole(client, roles.pipeline, async () => {
        await client.query(
          `INSERT INTO ${schema}.covered_ranges(environment,chain_id,deployment_digest,from_block,to_block,filter_digest,complete,verified_at)
           VALUES ('test',46630,$1,1,3,$2,true,now())`,
          [deployment[2], hash('a')],
        );
        const hiddenContent = await client.query(`SELECT * FROM ${schema}.jobs WHERE operation_id='content-operation'`);
        assert.equal(hiddenContent.rowCount, 0);
        assert.deepEqual((await client.query(`SELECT queue FROM ${schema}.queue_generations ORDER BY queue`)).rows, [{ queue: 'chain' }]);
        await rejectsQuery(() => client.query(`SELECT * FROM ${schema}.content_objects`), /permission denied/);
      });

      await client.query('BEGIN');
      await client.query('SET LOCAL enable_seqscan = off');
      const plan = await client.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN SELECT * FROM ${schema}.markets WHERE environment='test' AND chain_id=46630 AND deployment_digest=$1 AND creator=$2 ORDER BY market_id LIMIT 20`,
        [deployment[2], address('d')],
      );
      await client.query('ROLLBACK');
      assert.match(plan.rows.map((row) => row['QUERY PLAN']).join('\n'), /markets_creator/);
    } finally {
      client.release();
    }
  } finally {
    await handle.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
    const who = await handle.pool.query<{ current_user: string }>('SELECT current_user').catch(() => ({ rows: [] }));
    const currentUser = who.rows[0]?.current_user;
    for (const role of createdRoles.reverse()) {
      if (currentUser) await handle.pool.query(`REVOKE ${ident(role)} FROM ${quoteRole(currentUser)}`).catch(() => undefined);
      await handle.pool.query(`DROP ROLE IF EXISTS ${ident(role)}`).catch(() => undefined);
    }
    await handle.pool.end();
  }
});

test('TS-17 queue generation advances only after drain and fences stale workers', { timeout: 20_000 }, async (context) => {
  if (!connectionString) { context.skip('TG_MIGRATION_DATABASE_URL or TG_DATABASE_URL is required'); return; }
  const schemaName = `tg_ts17_${process.pid}_${randomBytes(4).toString('hex')}`;
  const legacySchemaName = `${schemaName}_legacy`; const schema = ident(schemaName); const legacySchema = ident(legacySchemaName);
  const handle = createDatabasePool(connectionString, { max: 2 });
  try {
    await handle.pool.query(migrationSql(legacySchemaName, '0001_core'));
    await handle.pool.query(`UPDATE ${legacySchema}.schema_migrations SET digest=$1 WHERE version='0001_core'`, [coreMigrationDigest('0001_core')]);
    assert.equal(await applyCoreMigration(handle.pool, legacySchemaName), true);
    assert.equal((await handle.pool.query(`SELECT count(*)::int count FROM ${legacySchema}.queue_generations`)).rows[0]?.count, 2);
    await applyCoreMigration(handle.pool, schemaName);
    await enqueueReliableMessage(handle.pool, {
      queue: 'chain', externalId: 'g0-event', operationId: 'g0:operation', kind: 'chain-backfill',
      rawBody: '{"generation":0}', payload: { generation: 0 }, destinationKey: 'chain-worker', generation: 0n,
    }, schemaName);
    const generationApp = createPipelineApp({ pool: handle.pool, chainProcessor: async () => 'unused', env: {
      NODE_ENV: 'test', TG_DATABASE_SCHEMA: schemaName, TG_PIPELINE_DATABASE_URL: 'configured', TG_PIPELINE_GENERATION: '0',
      TG_REPAIR_TOKEN: 'generation-repair-token', CRON_SECRET: 'generation-cron-token',
    } });
    const advanceBody = JSON.stringify({ expectedGeneration: '0', nextGeneration: '1' });
    assert.equal((await generationApp.request('https://pipeline.example/internal/generation/advance', {
      method: 'POST', body: advanceBody, headers: { authorization: 'Bearer generation-cron-token', 'content-type': 'application/json' },
    })).status, 401);
    assert.equal((await generationApp.request('https://pipeline.example/internal/generation/advance', {
      method: 'POST', body: advanceBody, headers: { authorization: 'Bearer generation-repair-token', 'content-type': 'application/json' },
    })).status, 409);
    await handle.pool.query(`UPDATE ${schema}.jobs SET state='dead' WHERE operation_id='g0:operation'`);
    await handle.pool.query(`UPDATE ${schema}.outbox_messages SET state='dead' WHERE operation_id='g0:operation'`);
    assert.equal((await generationApp.request('https://pipeline.example/internal/generation/advance', {
      method: 'POST', body: advanceBody, headers: { authorization: 'Bearer generation-repair-token', 'content-type': 'application/json' },
    })).status, 409);
    await handle.pool.query(`UPDATE ${schema}.jobs SET state='pending' WHERE operation_id='g0:operation'`);
    await handle.pool.query(`UPDATE ${schema}.outbox_messages SET state='pending' WHERE operation_id='g0:operation'`);
    await assert.rejects(handle.pool.query(`UPDATE ${schema}.queue_generations SET active_generation=1 WHERE queue='chain'`), /before successful drain/);
    await assert.rejects(advanceQueueGeneration(handle.pool, 'chain', 0n, 1n, schemaName), /before successful drain/);
    const job = (await claimJobs(handle.pool, 'chain', 'generation-zero-worker', 1, 20_000, schemaName, 0n))[0]!;
    assert.equal(await completeJob(handle.pool, job, 'generation-zero-worker', hash('1'), schemaName), true);
    const outbox = (await claimOutbox(handle.pool, 'chain', 'generation-zero-dispatcher', 1, 20_000, schemaName, 0n))[0]!;
    assert.equal(await completeOutbox(handle.pool, outbox, 'generation-zero-dispatcher', 'generation-zero-message', schemaName), true);
    const advanced = await generationApp.request('https://pipeline.example/internal/generation/advance', {
      method: 'POST', body: advanceBody, headers: { authorization: 'Bearer generation-repair-token', 'content-type': 'application/json' },
    });
    assert.equal(advanced.status, 200); assert.deepEqual(await advanced.json(), { queue: 'chain', previousGeneration: '0', activeGeneration: '1' });
    await assert.rejects(handle.pool.query(`UPDATE ${schema}.queue_generations SET active_generation=3 WHERE queue='chain'`), /exactly one/);
    await assert.rejects(enqueueReliableMessage(handle.pool, {
      queue: 'chain', externalId: 'stale-event', operationId: 'stale-operation', kind: 'chain-backfill',
      rawBody: '{"generation":0,"stale":true}', payload: { generation: 0 }, destinationKey: 'chain-worker', generation: 0n,
    }, schemaName), /generation is stale/);
    await enqueueReliableMessage(handle.pool, {
      queue: 'chain', externalId: 'g1-event', operationId: 'g1:operation', kind: 'chain-backfill',
      rawBody: '{"generation":1}', payload: { generation: 1 }, destinationKey: 'chain-worker', generation: 1n,
    }, schemaName);
    await assert.rejects(claimJobs(handle.pool, 'chain', 'stale-worker', 1, 20_000, schemaName, 0n), /generation is stale/);
    const current = await claimJobs(handle.pool, 'chain', 'generation-one-worker', 1, 20_000, schemaName, 1n);
    assert.equal(current.length, 1); assert.equal(current[0]?.generation, '1');
    assert.equal((await handle.pool.query(`SELECT active_generation::text active_generation FROM ${schema}.queue_generations WHERE queue='chain'`)).rows[0]?.active_generation, '1');
  } finally {
    await handle.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
    await handle.pool.query(`DROP SCHEMA IF EXISTS ${legacySchema} CASCADE`).catch(() => undefined);
    await handle.pool.end();
  }
});
