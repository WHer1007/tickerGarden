import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { applyCoreMigration, createDatabasePool } from '../../packages/db/src/index.ts';
import { publishExploreRanking } from '../../packages/confirmed-display/src/explore-ranking.ts';
import { validateRecentDisplay } from '../../packages/confirmed-display/src/recent-validation.ts';
import { readExploreBootstrap, readExploreCards, readExplorePage } from '../../packages/confirmed-display/src/explore.ts';

const connectionString = process.env.TG_MIGRATION_DATABASE_URL;
const h = (n: number): `0x${string}` => `0x${n.toString(16).padStart(64, '0')}`;
const a = (n: number): string => `0x${n.toString(16).padStart(40, '0')}`;
const secret = 'explore-display-integration-cursor-secret';

test('Explore reads current confirmed and recent cards with cursor-safe rankings', { timeout: 120_000 }, async t => {
  if (!connectionString) { t.skip('TG_MIGRATION_DATABASE_URL is required for isolated local PostgreSQL'); return; }
  const schemaName = `tg_explore_display_${process.pid}_${randomBytes(4).toString('hex')}`;
  const schema = `"${schemaName}"`;
  const handle = createDatabasePool(connectionString, { max: 1 });
  const pool = handle.pool;
  const deployment = { environment: 'test' as const, chainId: 46630 as const, deploymentDigest: h(999), activationBlock: 1n };
  const id = [deployment.environment, deployment.chainId, deployment.deploymentDigest];
  const market = (n: number, overrides: Record<string, unknown> = {}) => ({
    marketId: h(n), memeToken: a(n), quoteAsset: a(99), assetUid: h(n % 2 + 1), launchPhase: n % 2,
    identity: { name: `Token ${n}`, symbol: `T${n}`, deployedAt: String(n) },
    metrics: { marketCapUsd: String(n * 100), asOf: '2000-01-01T00:00:00.000Z' },
    curveProgress: { percent: String(n) },
    lastBuy: { blockNumber: String(n), transactionIndex: '0', logIndex: '0', timestamp: '1', side: 'buy' },
    ...overrides,
  });
  const saveConfirmed = async (n: number, payload = market(n), block = 100) => pool.query(
    `INSERT INTO ${schema}.confirmed_display_markets(environment,chain_id,deployment_digest,market_id,block_number,block_hash,payload) VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [...id, h(n), block, h(block), JSON.stringify({ market: payload, holders: { deliberatelyLarge: 'omitted from explore_card' } })],
  );
  const query = (q: Record<string, string> = {}) => readExplorePage({ pool, deployment, schemaName, secret, query: q });
  const publishRanking = async (now: Date) => {
    const client = await pool.connect();
    try { return await publishExploreRanking(client, deployment, schemaName, now); }
    finally { client.release(); }
  };
  try {
    await applyCoreMigration(pool, schemaName);
    await pool.query(`INSERT INTO ${schema}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES($1,$2,$3,$4,0,$4,$4)`, [...id, h(900)]);
    await pool.query(`INSERT INTO ${schema}.confirmed_display_cursor(environment,chain_id,deployment_digest,block_number,block_hash,base_number,block_timestamp) VALUES($1,$2,$3,100,$4,100,1000)`, [...id, h(100)]);
    const empty = await query();
    assert.equal(empty.items.length, 0);
    assert.equal(empty.sync.status, 'synced');
    assert.equal((await readExploreBootstrap({ pool, deployment, schemaName })).displayOnly, true);
    await saveConfirmed(1, market(1, { metrics: { marketCapUsd: '100', asOf: '1999-01-01T00:00:00.000Z' }, launchPhase: 0 }));
    await saveConfirmed(2, market(2, { metrics: { marketCapUsd: '900', asOf: '1999-01-01T00:00:00.000Z' }, launchPhase: 1 }));
    await saveConfirmed(3, market(3, { metrics: { marketCapUsd: '500', asOf: '1999-01-01T00:00:00.000Z' }, launchPhase: 1 }));

    const created = await query({ sort: 'createdAt_desc' });
    assert.deepEqual(created.items.map((x: any) => x.marketId), [h(3), h(2), h(1)]);
    assert.deepEqual((await query({ sort: 'createdAt_asc' })).items.map((x: any) => x.marketId), [h(1), h(2), h(3)], 'oldest sort remains available');
    assert.equal((created.items[0] as any).metrics.asOf, '1999-01-01T00:00:00.000Z', 'stored stale asOf is passed through as current display payload');
    assert.deepEqual((await query({ launchPhase: '1', search: 'token 3', assetUid: h(2) })).items.map((x: any) => x.marketId), [h(3)]);
    const recentBuy = await query({ sort: 'recentBuy_desc', limit: '2' });
    assert.deepEqual(recentBuy.items.map((x: any) => x.marketId), [h(3), h(2)]);
    assert.ok(recentBuy.nextCursor);
    assert.deepEqual((await query({ sort: 'recentBuy_desc', limit: '2', cursor: recentBuy.nextCursor! })).items.map((x: any) => x.marketId), [h(1)]);

    const firstRank = await publishRanking(new Date('2026-09-18T12:00:00Z'));
    assert.equal(firstRank, true);
    const capPage = await query({ sort: 'marketCapUsd_desc', limit: '2' });
    assert.deepEqual(capPage.items.map((x: any) => x.marketId), [h(2), h(3)]);
    assert.ok(capPage.nextCursor);
    await pool.query(`UPDATE ${schema}.confirmed_display_markets SET payload=jsonb_set(payload,'{market,metrics,marketCapUsd}','"1"') WHERE market_id=$1`, [h(1)]);
    await pool.query(`UPDATE ${schema}.confirmed_display_markets SET payload=jsonb_set(payload,'{market,metrics,marketCapUsd}','"99999"') WHERE market_id=$1`, [h(3)]);
    const refreshedCapPage = await query({ sort: 'marketCapUsd_desc', limit: '2' });
    assert.deepEqual(refreshedCapPage.items.map((x: any) => x.marketId), [h(2), h(3)], 'cap order stays frozen within a snapshot');
    assert.equal((refreshedCapPage.items[1] as any).metrics.marketCapUsd, '99999', 'card fields come from the current display row');
    assert.deepEqual((await query({ sort: 'marketCapUsd_desc', limit: '2', cursor: capPage.nextCursor! })).items.map((x: any) => x.marketId), [h(1)]);

    const recentPayload = market(4, { identity: { name: 'Immediate New', symbol: 'NEW', deployedAt: '101' }, launchPhase: 1 });
    await pool.query(`INSERT INTO ${schema}.recent_markets(environment,chain_id,deployment_digest,market_id,transaction_hash,block_number,block_hash,payload,canonical,expires_at) VALUES($1,$2,$3,$4,$5,101,$6,$7,true,now()+interval '1 hour')`, [...id, h(4), h(404), h(101), JSON.stringify(recentPayload)]);
    const immediate = await query({ search: 'Immediate New' });
    assert.deepEqual(immediate.items.map((x: any) => x.marketId), [h(4)]);
    assert.equal((await readExploreBootstrap({ pool, deployment, schemaName })).sync.blockNumber, '101');
    await pool.query(`INSERT INTO ${schema}.recent_markets(environment,chain_id,deployment_digest,market_id,transaction_hash,block_number,block_hash,payload,canonical,expires_at) VALUES($1,$2,$3,$4,$5,102,$6,$7,true,now()+interval '1 hour')`, [...id, h(2), h(402), h(102), JSON.stringify(market(2, { identity: { name: 'Recent Override', symbol: 'RO', deployedAt: '102' } }))]);
    assert.equal((await query({ search: 'Recent Override' })).items.length, 0, 'confirmed display card overrides a duplicate recent card');
    await pool.query(`INSERT INTO ${schema}.recent_markets(environment,chain_id,deployment_digest,market_id,transaction_hash,block_number,block_hash,payload,canonical,expires_at) VALUES($1,$2,$3,$4,$5,103,$6,$7,true,now()+interval '1 hour')`, [...id, h(5), h(405), h(103), JSON.stringify(market(5, { identity: { name: 'Orphaned Launch', symbol: 'ORPH', deployedAt: '103' } }))]);
    assert.equal((await query({ search: 'Orphaned Launch' })).items.length, 1, 'unvalidated recent row is visible before its canonicality check');
    const client = await pool.connect();
    try {
      await validateRecentDisplay(client, deployment, { block: async () => ({ hash: h(9999) }) } as never, 103n, schemaName);
    } finally { client.release(); }
    assert.equal((await query({ search: 'Orphaned Launch' })).items.length, 0, 'mismatched RPC block hash removes an orphaned recent card');

    await pool.query(`DELETE FROM ${schema}.confirmed_display_markets WHERE market_id=$1`, [h(1)]);
    assert.equal((await query({ search: 'Token 1' })).items.length, 0, 'removing a reorged confirmed row removes its card');
    await saveConfirmed(1, market(1, { identity: { name: 'Restored One', symbol: 'R1', deployedAt: '1' } }));
    assert.equal((await query({ search: 'Restored One' })).items.length, 1, 'restoring the confirmed row restores its card');
    assert.deepEqual((await readExploreCards({ pool, deployment, schemaName }, [h(1), h(2)])).items.map((x: any) => x.marketId).sort(), [h(1), h(2)].sort());
    await assert.rejects(readExploreCards({ pool, deployment, schemaName }, Array.from({ length: 101 }, (_, i) => h(i + 1))), /invalid markets/);

    // Local scale sample: exercise the three directory sorts and the card endpoint at 20,000 rows.
    for(let first=1000;first<21000;first+=2000)await pool.query(`INSERT INTO ${schema}.confirmed_display_markets(environment,chain_id,deployment_digest,market_id,block_number,block_hash,payload)
      SELECT $1,$2,$3, '0x'||lpad(to_hex(n),64,'0'),100,$4,jsonb_build_object('market',jsonb_build_object(
        'marketId','0x'||lpad(to_hex(n),64,'0'),'memeToken','0x'||lpad(to_hex(n),40,'0'),'quoteAsset',$5::text,'assetUid','0x'||lpad(to_hex(n%2+1),64,'0'),
        'launchPhase',n%2,'identity',jsonb_build_object('name','Scale token '||n,'symbol','S'||n,'deployedAt',n::text),
        'metrics',jsonb_build_object('marketCapUsd',(n*100)::text,'asOf','2000-01-01T00:00:00.000Z'),
        'lastBuy',jsonb_build_object('blockNumber',n::text,'transactionIndex','0','logIndex','0')))
    FROM generate_series($6::int,$7::int) n ON CONFLICT DO NOTHING`, [...id, h(100), a(99),first,first+1999]);
    await publishRanking(new Date('2026-09-18T12:21:00Z'));
    const elapsed: Record<string, number> = {};
    for (const sort of ['createdAt_desc', 'createdAt_asc', 'recentBuy_desc', 'marketCapUsd_desc']) {
      const started = performance.now();
      const page = await query({ sort, limit: '40' });
      assert.equal(page.items.length, 40);
      assert.deepEqual([page.items[0]?.marketId, page.items[39]?.marketId], sort === 'createdAt_asc' ? [h(1), h(1036)] : [h(20999), h(20960)], `${sort} uses numeric ordering beyond single-digit values`);
      elapsed[sort] = Math.round(performance.now() - started);
      console.log(`Explore local scale sample ${sort}: ${elapsed[sort]} ms`);
    }
    const cardIds = (await pool.query<{ market_id: string }>(`SELECT market_id FROM ${schema}.confirmed_display_markets WHERE market_id >= $1 ORDER BY market_id LIMIT 50`, [h(1000)])).rows.map(row => row.market_id);
    const cardStarted = performance.now();
    assert.equal((await readExploreCards({ pool, deployment, schemaName }, cardIds)).items.length, 50);
    elapsed.cards50 = Math.round(performance.now() - cardStarted);
    console.log(`Explore local PostgreSQL scale sample: ${JSON.stringify(elapsed)} ms; 20,003 confirmed cards`);
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
    await pool.end();
  }
});
