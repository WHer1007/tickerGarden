import {publishProtocolStatistics,readProtocolStatistics} from '../../packages/statistics-store/src/snapshot.ts';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { applyCoreMigration, createDatabasePool } from '../../packages/db/src/index.ts';
import { createReadApiApp } from '../../apps/read-api/src/index.ts';
import type { TradeActivity } from '../../packages/analytics/src/index.ts';
import { f72BootstrapConfigs } from '../../packages/config-projector/src/f72-bootstrap.generated.ts';

const connectionString = process.env.TG_MIGRATION_DATABASE_URL ?? process.env.TG_DATABASE_URL;
const hash = (character: string): `0x${string}` => `0x${character.repeat(64)}`;
const address = (character: string): `0x${string}` => `0x${character.repeat(40)}`;
const ident = (value: string): string => { assert.match(value, /^[a-z][a-z0-9_]{0,62}$/); return `"${value}"`; };

test('TS-07 database-only trades, candles, holders and detail paths preserve coverage semantics', { timeout: 30_000 }, async (context) => {
  if (!connectionString) { context.skip('TG_MIGRATION_DATABASE_URL or TG_DATABASE_URL is required'); return; }
  const schemaName = `tg_ts07_${process.pid}_${randomBytes(4).toString('hex')}`; const schema = ident(schemaName);
  const handle = createDatabasePool(connectionString, { max: 3 });
  const bootstrap = f72BootstrapConfigs as unknown as Array<any>; const bootstrapLength = bootstrap.length;
  const fixtureQuote = { id: hash('a'), kind: 'quote', status: 1, values: { quoteAsset: address('5'), quoteDecimals: 18, symbol: 'TST' } };
  const fixtureAsset = { id: hash('b'), kind: 'asset', status: 1, values: { stockToken: address('5'), tokenSymbol: 'TST', userStockVault: address('6') } };
  const fixtureBaseline = { id: hash('c'), kind: 'baseline', status: 1, values: { supply: '1000000000000000000000' } };
  bootstrap.push(fixtureQuote, fixtureAsset, fixtureBaseline);
  const deployment = { environment: 'test' as const, chainId: 46630 as const, deploymentDigest: hash('1'), activationBlock: 1n };
  const quote=fixtureQuote;
  const quoteAssetRecord=fixtureAsset;
  const asset=fixtureAsset;
  const baseline={id:hash('b')};
  const marketId = hash('2'); const memeToken = address('3'); const quoteAsset = quote.values.quoteAsset; const configId = quote.id;
  const now = Math.floor(Date.now() / 1_000); const detailTo = Math.floor((now - 10) / 900) * 900; const detailFrom = detailTo - 86_400;
  const candleTo = Math.floor(detailTo / 3_600) * 3_600;
  try {
    await applyCoreMigration(handle.pool, schemaName);
    await handle.pool.query(`INSERT INTO ${schema}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES ('test',46630,$1,$2,1,$3,$4)`, [deployment.deploymentDigest, hash('a'), hash('b'), hash('c')]);
    const blocks = [[1, hash('b'), hash('a'), candleTo - 86_401], [2, hash('c'), hash('b'), candleTo - 1_800], [3, hash('d'), hash('c'), candleTo - 600], [4, hash('e'), hash('d'), detailTo]] as const;
    for (const [number, blockHash, parentHash, timestamp] of blocks) await handle.pool.query(
      `INSERT INTO ${schema}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized,source_timestamp) VALUES ('test',46630,$1,$2,$3,$4,true,true,to_timestamp($5))`,
      [deployment.deploymentDigest, number, blockHash, parentHash, timestamp]);
    await handle.pool.query(`INSERT INTO ${schema}.covered_ranges(environment,chain_id,deployment_digest,from_block,to_block,generation,filter_digest,complete,verified_at) VALUES ('test',46630,$1,1,4,0,$2,true,now())`,[deployment.deploymentDigest,hash('5')]);
    await handle.pool.query(`INSERT INTO ${schema}.ingestion_checkpoints(environment,chain_id,deployment_digest,stream,next_block,last_block_hash,generation) VALUES ('test',46630,$1,'frontend-events',5,$2,0)`,[deployment.deploymentDigest,hash('e')]);
    const revision = `4:${hash('e')}`;
    for (const scope of ['markets', 'configs', 'positions'] as const) {
      await handle.pool.query(`INSERT INTO ${schema}.publications(environment,chain_id,deployment_digest,scope,revision,block_number,block_hash,generation,payload_digest,payload) VALUES ('test',46630,$1,$2,$3,4,$4,0,$5,'{}')`, [deployment.deploymentDigest, scope, revision, hash('e'), hash(scope === 'markets' ? '6' : '7')]);
      await handle.pool.query(`INSERT INTO ${schema}.publication_pointers(environment,chain_id,deployment_digest,scope,revision) VALUES ('test',46630,$1,$2,$3)`, [deployment.deploymentDigest, scope, revision]);
    }
    const market = { marketId, assetUid:asset.id, memeToken, quoteAsset, quoteAssetConfigId: configId,tickerGardenBaselineId:baseline.id,launchPhase:0, source: { blockNumber: '1' } };
    await handle.pool.query(`INSERT INTO ${schema}.projection_records(environment,chain_id,deployment_digest,scope,revision,identity,sort_key,payload_digest,payload) VALUES ('test',46630,$1,'markets',$2,$3,$3,$4,$5)`, [deployment.deploymentDigest, revision, marketId, hash('8'), market]);
    await handle.pool.query(`INSERT INTO ${schema}.projection_records(environment,chain_id,deployment_digest,scope,revision,identity,sort_key,payload_digest,payload) VALUES ('test',46630,$1,'configs',$2,$3,$3,$4,$5)`, [deployment.deploymentDigest, revision, `quote:${configId}`, hash('9'), { kind: 'quote', id: configId, values: { quoteDecimals: quote.values.quoteDecimals } }]);
    const staker=address('9');
    await handle.pool.query(`INSERT INTO ${schema}.projection_records(environment,chain_id,deployment_digest,scope,revision,identity,sort_key,payload_digest,payload) VALUES ('test',46630,$1,'positions',$2,$3,$3,$4,$5)`,[deployment.deploymentDigest,revision,`${staker}:${asset.id}:${marketId}`,hash('4'),{user:staker,assetUid:asset.id,marketId,allocated:'1000000000000000000',active:'1000000000000000000',pending:'0'}]);
    await handle.pool.query(`INSERT INTO ${schema}.projection_checkpoints(environment,chain_id,deployment_digest,scope,algorithm_version,next_block,generation,last_revision) VALUES ('test',46630,$1,'analytics','f72-analytics-v1',5,0,$2)`, [deployment.deploymentDigest, revision]);
    const makeTrade = (block: 2 | 3, logIndex: number, side: 'buy' | 'sell', timestamp: number): TradeActivity => ({
      source: { chainId: 46630, blockNumber: String(block), blockHash: block === 2 ? hash('c') : hash('d'), transactionHash: block === 2 ? hash('f') : hash('0'), transactionIndex: 0, logIndex,
        emitter: address('6'), eventKey: `46630:${block === 2 ? hash('f') : hash('0')}:${logIndex}` }, venue: 'curve', marketId, timestamp: String(timestamp), side,
      classification: 'unclassified', actor: address('7'), actorConfidence: 'contract_caller_not_verified_wallet', recipient: address('8'), memeAsset: memeToken,
      quoteAsset, quoteDecimals: 18, memeRaw: '2000000000000000000', quoteRaw: '1000000000000000000', amountBasis: 'CURVE_EXCLUDING_FEE_TAX',
      price: { numerator: '1', denominator: '2' }, priceUnit: 'QUOTE_PER_WHOLE_MEME', feeRaw: '1', feeAsset: quoteAsset, taxRaw: '0', feeStatus: 'event_reported' });
    for (const trade of [makeTrade(2, 1, 'buy', candleTo - 1_800), makeTrade(3, 2, 'sell', candleTo - 600)]) await handle.pool.query(
      `INSERT INTO ${schema}.market_trades(environment,chain_id,deployment_digest,market_id,block_hash,transaction_hash,log_index,occurred_at,classification,base_raw,quote_raw,payload) VALUES ('test',46630,$1,$2,$3,$4,$5,to_timestamp($6),$7,$8,$9,$10)`,
      [deployment.deploymentDigest, marketId, trade.source.blockHash, trade.source.transactionHash, trade.source.logIndex, trade.timestamp, trade.classification, trade.memeRaw, trade.quoteRaw, trade]);
    const excludedAccounts = [address('6')];
    for (const [account, balance, excluded] of [[address('6'), '700', true], [address('7'), '300', false]] as const) await handle.pool.query(
      `INSERT INTO ${schema}.holder_balances(environment,chain_id,deployment_digest,market_id,account,balance_raw,excluded,block_hash,payload) VALUES ('test',46630,$1,$2,$3,$4,$5,$6,$7)`,
      [deployment.deploymentDigest, marketId, account, balance, excluded, hash('e'), { account, balanceRaw: balance, excluded, totalSupplyRaw: '1000', positiveAddressCount: 2, includedAddressCount: 1, excludedAccounts, creationBlockNumber: '1' }]);
    await handle.pool.query(`INSERT INTO ${schema}.holder_snapshots(environment,chain_id,deployment_digest,market_id,creation_block,total_supply_raw,positive_address_count,included_address_count,excluded_accounts,block_number,block_hash) VALUES ('test',46630,$1,$2,1,1000,2,1,$3,4,$4)`,
      [deployment.deploymentDigest, marketId, JSON.stringify(excludedAccounts), hash('e')]);
    for (const [recipient, asset, amount] of [['creator', quoteAsset, '7'], ['holders', memeToken, '3']] as const) await handle.pool.query(
      `INSERT INTO ${schema}.detail_fee_totals(environment,chain_id,deployment_digest,market_id,recipient,asset,amount_raw,block_hash) VALUES ('test',46630,$1,$2,$3,$4,$5,$6)`,
      [deployment.deploymentDigest, marketId, recipient, asset, amount, hash('e')]);
    for (const [index, recipient, asset, amount] of [[1,'creator',quoteAsset,'7'],[2,'holders',memeToken,'3']] as const) await handle.pool.query(
      `INSERT INTO ${schema}.detail_fee_events(environment,chain_id,deployment_digest,market_id,recipient,asset,amount_raw,block_hash,transaction_hash,log_index) VALUES ('test',46630,$1,$2,$3,$4,$5,$6,$7,$8)`,
      [deployment.deploymentDigest,marketId,recipient,asset,amount,hash('d'),hash('0'),index]);
    const priceTarget=quoteAssetRecord;
    const priceNow=Date.now(),priceAsOf=new Date(priceNow-10_000),priceExpiry=new Date(priceNow+50_000),retrieved=new Date(priceNow-5_000);
    const pricePayload={chainId:46630,token:priceTarget.values.stockToken,assetUid:priceTarget.id,symbol:priceTarget.values.tokenSymbol,source:'robinhood_rest',unit:'USD_PER_WHOLE_TOKEN',status:'available',bidUsd:'10',askUsd:'12',multiplier:'1',asOf:priceAsOf.toISOString(),expiresAt:priceExpiry.toISOString(),retrievedAt:retrieved.toISOString()};
    await handle.pool.query(`INSERT INTO ${schema}.price_references(environment,chain_id,deployment_digest,asset,source,status,value,as_of,expires_at,payload) VALUES('test',46630,$1,$2,'robinhood_rest','available',11,$3,$4,$5)`,[deployment.deploymentDigest,quoteAsset,priceAsOf,priceExpiry,pricePayload]);
    const failedAsOf=new Date(priceNow-2_000),failedExpiry=new Date(priceNow-1_000),failedPayload={...pricePayload,status:'unavailable',reason:'transient_upstream_failure',bidUsd:null,askUsd:null,multiplier:null,asOf:null,expiresAt:null,retrievedAt:failedAsOf.toISOString()};
    await handle.pool.query(`INSERT INTO ${schema}.price_references(environment,chain_id,deployment_digest,asset,source,status,value,as_of,expires_at,payload) VALUES('test',46630,$1,$2,'robinhood_rest','unavailable',null,$3,$4,$5)`,[deployment.deploymentDigest,quoteAsset,failedAsOf,failedExpiry,failedPayload]);
    const app = createReadApiApp({ pool: handle.pool, deployment, env: { NODE_ENV: 'test', TG_READ_DATABASE_URL: connectionString,
      TG_CURSOR_SECRET: 'ts07-integration-cursor-secret-at-least-32-bytes', TG_DATABASE_SCHEMA: schemaName } });
    const trades = await app.request(`/v1/markets/${marketId}/trades?from=${candleTo - 3_600}&to=${candleTo}&limit=1`); assert.equal(trades.status, 200);
    const tradePage = await trades.json() as { items: TradeActivity[]; nextCursor: string | null }; assert.equal(tradePage.items[0]?.side, 'sell'); assert.ok(tradePage.nextCursor);
    const candles = await app.request(`/v1/markets/${marketId}/candles?interval=1h&from=${candleTo - 7_200}&to=${candleTo}`); assert.equal(candles.status, 200);
    const candleBody = await candles.json() as { series: { candles: Array<{ open: unknown; tradeCount: number }> } }; assert.equal(candleBody.series.candles.length, 2); assert.equal(candleBody.series.candles[0]?.open, null); assert.equal(candleBody.series.candles[1]?.tradeCount, 2);
    const holders = await app.request(`/v1/markets/${marketId}/holders?limit=1`); assert.equal(holders.status, 200);
    const holderPage = await holders.json() as { balances: unknown[]; nextCursor: string | null; totalSupplyRaw: string }; assert.equal(holderPage.totalSupplyRaw, '1000'); assert.ok(holderPage.nextCursor);
    const detail = await app.request(`/v1/markets/${marketId}/detail?period=1D`); assert.equal(detail.status, 200);
    const detailBody = await detail.json() as { chart: { points: unknown[] } | null; holders: { circulatingSupplyRaw: string } | null;
      statistics: { price: string | null; volume24h: string | null } | null; trades: Array<{ side: string; price: string }> | null;
      fees: Array<{ recipient: string; asset: string; amountRaw: string }>; sources: Record<string, unknown>; reasons: Record<string, string> };
    assert.equal(detailBody.chart?.points.length, 96); assert.equal(detailBody.holders?.circulatingSupplyRaw, '300');
    assert.equal(detailBody.statistics?.price, '0.500000000000000000000000000000000000');
    assert.equal(Number(detailBody.statistics?.volume24h), 2);
    assert.ok((detailBody.statistics?.volume24h?.split('.')[1]?.length ?? 0) <= 36);
    assert.equal(detailBody.trades?.length, 2);
    assert.deepEqual(detailBody.fees, [{ recipient: 'creator', asset: quoteAsset, amountRaw: '7' }, { recipient: 'holders', asset: memeToken, amountRaw: '3' }]);
    assert.ok(detailBody.sources.fees); assert.equal(detailBody.reasons.fees, undefined);
    const activityResponse=await app.request(`/v1/markets/${marketId}/detail?period=1H&section=activity`);
    assert.equal(activityResponse.status,200);assert.equal(activityResponse.headers.get('cache-control'),'no-store');
    const activity=await activityResponse.json() as typeof detailBody;
    assert.equal(activity.statistics,null);assert.equal(activity.chart,null);assert.equal(activity.holders,null);
    assert.deepEqual(activity.trades,detailBody.trades);assert.deepEqual(activity.fees,detailBody.fees);
    assert.deepEqual(Object.keys(activity.sources).sort(),['fees','trades']);
    assert.equal((await app.request(`/v1/markets/${marketId}/detail?section=bogus`)).status,400);

    // Move both executions outside the 1H chart window while retaining them
    // in finalized DB history. The detail feed and latest price must survive.
    await handle.pool.query(`UPDATE ${schema}.market_trades SET occurred_at=to_timestamp($1), payload=jsonb_set(payload,'{timestamp}',to_jsonb($1::text))`, [candleTo - 7_200]);
    const quietDetail = await app.request(`/v1/markets/${marketId}/detail?period=1H`); assert.equal(quietDetail.status, 200);
    const quietBody = await quietDetail.json() as { chart: { points: Array<{ price: string | null }> } | null;
      statistics: { price: string | null } | null; trades: Array<{ side: string }> | null };
    assert.ok(quietBody.chart?.points.every(point => point.price === null));
    assert.equal(quietBody.statistics?.price, '0.500000000000000000000000000000000000');
    assert.equal(quietBody.trades?.length, 2);
    const globalHolders=await app.request('/v1/stats/holders');assert.equal(globalHolders.status,200);const globalHolderBody=await globalHolders.json() as {marketCount:number;positiveAddressCount:number;includedAddressCount:number;groups:unknown[]};
    assert.deepEqual({marketCount:globalHolderBody.marketCount,positive:globalHolderBody.positiveAddressCount,included:globalHolderBody.includedAddressCount,groups:globalHolderBody.groups.length},{marketCount:1,positive:2,included:1,groups:1});
    const overview=await app.request(`/v1/stats/overview?from=${detailFrom}&to=${detailTo}`);assert.equal(overview.status,200);const overviewBody=await overview.json() as {marketCount:number;groups:Array<{tradeCount:number;quoteVolumeRaw:string}>};assert.equal(overviewBody.marketCount,1);assert.deepEqual(overviewBody.groups.map(g=>[g.tradeCount,g.quoteVolumeRaw]),[[2,'2000000000000000000']]);
    const series=await app.request(`/v1/stats/series?interval=1h&from=${candleTo-86400}&to=${candleTo}`);assert.equal(series.status,200);assert.equal(((await series.json()) as {points:unknown[]}).points.length,24);
    const marketStats=await app.request(`/v1/market-statistics?markets=${marketId}`);assert.equal(marketStats.status,200);const marketStatsBody=await marketStats.json() as {items:Record<string,{volume24hQuote:string;metrics:{status:string;quoteUsdMidpoint:string;volume24hUsd:null;reason:string}|null}>};assert.equal(marketStatsBody.items[marketId]?.volume24hQuote,'2.000000000000000000');assert.equal(marketStatsBody.items[marketId]?.metrics?.status,'available');assert.equal(marketStatsBody.items[marketId]?.metrics?.quoteUsdMidpoint,'11.000000000000000000');assert.equal(marketStatsBody.items[marketId]?.metrics?.volume24hUsd,null);assert.equal(marketStatsBody.items[marketId]?.metrics?.reason,'historical_usd_coverage_unavailable');
    assert.equal((await app.request(`/v1/stats/overview?from=${candleTo-3_600}&to=${candleTo+3_600}`)).status,503);
    // Display statistics read the worker's stored view, independently of finalized analytics.
    await handle.pool.query(`INSERT INTO ${schema}.confirmed_display_cursor(environment,chain_id,deployment_digest,block_number,block_hash,base_number,block_timestamp) VALUES('test',46630,$1,4,$2,1,$3)`,[deployment.deploymentDigest,hash('e'),candleTo]);
    await handle.pool.query(`INSERT INTO ${schema}.confirmed_display_markets(environment,chain_id,deployment_digest,market_id,block_number,block_hash,payload) VALUES('test',46630,$1,$2,4,$3,$4)`,[deployment.deploymentDigest,marketId,hash('e'),{market:{display:{totalStakedRaw:'1000000000000000000'}},detailViews:{'1H':detailBody}}]);
    const display=await app.request(`/v1/market-display-statistics?marketId=${marketId}`);assert.equal(display.status,200);assert.equal(((await display.json()) as {feeDistribution:unknown[]}).feeDistribution.length,2);
    await handle.pool.query(`DELETE FROM ${schema}.confirmed_display_markets`);
    await handle.pool.query(`DELETE FROM ${schema}.confirmed_display_cursor`);
    const prices=await app.request('/v1/prices/references');assert.equal(prices.status,200);const priceBody=await prices.json() as {status:string;references:Array<{status:string;token:string}>};assert.equal(priceBody.status,'configured');assert.equal(priceBody.references.find(row=>row.token===quoteAsset)?.status,'available');
    assert.equal((await app.request('/v1/protocol-statistics')).status,503);
    assert.equal((await publishProtocolStatistics(handle.pool,deployment,schemaName)).published,true);
    assert.equal((await publishProtocolStatistics(handle.pool,deployment,schemaName)).published,false);
    const protocol=await app.request('/v1/protocol-statistics');assert.equal(protocol.status,200);assert.equal(protocol.headers.get('cache-control'),'no-store');const protocolBody=await protocol.json() as {feeCoverage:boolean;feeTotals:Record<string,string>;feeBasis:string;stockAmounts:Record<string,string>;stakingWallets:number;stakingObservedAt:number};assert.equal(protocolBody.feeCoverage,true);assert.equal(protocolBody.feeTotals[quoteAsset],'2');assert.equal(protocolBody.feeTotals[memeToken],undefined);assert.equal(protocolBody.feeBasis,'TRADE_TIME');assert.equal(protocolBody.stockAmounts[asset.id],'1000000000000000000');assert.equal(protocolBody.stakingWallets,1);assert.equal(protocolBody.stakingObservedAt,detailTo);
    const snapshot=await readProtocolStatistics({pool:handle.pool,deployment,schemaName});
    assert.equal(snapshot.volumeAmounts[quoteAsset],'2000000000000000000');
    assert.equal(snapshot.feeAssets[quoteAsset]?.creator,'7');
    // Rebuilding retains the real older position timestamp, not the analytics timestamp.
    const olderRevision=`3:${hash('d')}`;
    await handle.pool.query(`INSERT INTO ${schema}.publications(environment,chain_id,deployment_digest,scope,revision,block_number,block_hash,generation,payload_digest,payload) VALUES('test',46630,$1,'positions',$2,3,$3,0,$4,'{}')`,[deployment.deploymentDigest,olderRevision,hash('d'),hash('7')]);
    await handle.pool.query(`INSERT INTO ${schema}.projection_records(environment,chain_id,deployment_digest,scope,revision,identity,sort_key,payload_digest,payload) SELECT environment,chain_id,deployment_digest,scope,$1,identity,sort_key,payload_digest,payload FROM ${schema}.projection_records WHERE scope='positions' AND revision=$2`,[olderRevision,revision]);
    await handle.pool.query(`UPDATE ${schema}.publication_pointers SET revision=$1 WHERE scope='positions'`,[olderRevision]);
    await handle.pool.query(`DELETE FROM ${schema}.protocol_statistics_snapshots`);
    await publishProtocolStatistics(handle.pool,deployment,schemaName);
    assert.equal((await readProtocolStatistics({pool:handle.pool,deployment,schemaName})).stakingObservedAt,candleTo-600);
    // Reorg of that older position anchor invalidates the otherwise canonical snapshot.
    await handle.pool.query(`UPDATE ${schema}.chain_blocks SET canonical=false WHERE hash=$1`,[hash('d')]);
    await assert.rejects(readProtocolStatistics({pool:handle.pool,deployment,schemaName}));
    await handle.pool.query(`UPDATE ${schema}.chain_blocks SET canonical=true WHERE hash=$1`,[hash('d')]);
    // Incremental holder references must match full positive-balance truth across zero crossings.
    for(const balance of ['0','300','301']){
      await handle.pool.query(`UPDATE ${schema}.holder_balances SET balance_raw=$1 WHERE account=$2`,[balance,address('7')]);
      const full=(await handle.pool.query(`SELECT count(DISTINCT account)::int n FROM ${schema}.holder_balances WHERE balance_raw>0`)).rows[0].n;
      const response=await app.request('/v1/stats/holders');assert.equal(response.status,200);
      assert.equal((await response.json() as {positiveAddressCount:number}).positiveAddressCount,full);
    }
    await handle.pool.query(`UPDATE ${schema}.holder_snapshots SET excluded_accounts='[]'`);
    assert.equal((await (await app.request('/v1/stats/holders')).json() as {includedAddressCount:number}).includedAddressCount,2);
    await handle.pool.query(`UPDATE ${schema}.holder_snapshots SET excluded_accounts=$1`,[JSON.stringify(excludedAccounts)]);
    await handle.pool.query(`UPDATE ${schema}.market_trades SET classification='reward_conversion',payload=jsonb_set(payload,'{feeStatus}','"not_provided"') WHERE log_index=1`);
    await handle.pool.query(`DELETE FROM ${schema}.protocol_statistics_snapshots`);
    await publishProtocolStatistics(handle.pool,deployment,schemaName);
    const incomplete=await readProtocolStatistics({pool:handle.pool,deployment,schemaName});
    assert.equal(incomplete.feeCoverage,false);assert.equal(incomplete.allocationCoverage,true);
    assert.equal(incomplete.volumeAmounts[quoteAsset],'1000000000000000000');
    await handle.pool.query(`UPDATE ${schema}.market_trades SET classification='unclassified',payload=jsonb_set(payload,'{feeStatus}','"event_reported"') WHERE log_index=1`);
    // 20k markets and 20k wallets stay inside the scheduled builder; GET stays small.
    for(let offset=0;offset<20000;offset+=1000){
      const rows=Array.from({length:1000},(_,n)=>{const key='0x'+(offset+n+100).toString(16).padStart(64,'0');return {identity:key,payload:{...market,marketId:key,identity:{deployedAt:String(detailTo-10)}}};});
      await handle.pool.query(`INSERT INTO ${schema}.projection_records(environment,chain_id,deployment_digest,scope,revision,identity,sort_key,payload_digest,payload) SELECT 'test',46630,$1,'markets',$2,r.identity,r.identity,$3,r.payload FROM jsonb_to_recordset($4::jsonb) r(identity text,payload jsonb)`,[deployment.deploymentDigest,revision,hash('8'),JSON.stringify(rows)]);
      const positions=rows.map((r,n)=>({identity:r.identity,payload:{user:'0x'+(offset+n+100).toString(16).padStart(40,'0'),assetUid:asset.id,allocated:'1'}}));
      await handle.pool.query(`INSERT INTO ${schema}.projection_records(environment,chain_id,deployment_digest,scope,revision,identity,sort_key,payload_digest,payload) SELECT 'test',46630,$1,'positions',$2,r.identity,r.identity,$3,r.payload FROM jsonb_to_recordset($4::jsonb) r(identity text,payload jsonb)`,[deployment.deploymentDigest,olderRevision,hash('8'),JSON.stringify(positions)]);
    }
    await handle.pool.query(`DELETE FROM ${schema}.protocol_statistics_snapshots`);
    const started=performance.now();await publishProtocolStatistics(handle.pool,deployment,schemaName);const built=performance.now();
    const large=await readProtocolStatistics({pool:handle.pool,deployment,schemaName});
    assert.equal(large.marketCount,20001);assert.equal(large.stakingWallets,20001);assert.ok(Buffer.byteLength(JSON.stringify(large))<16000);
    console.log(JSON.stringify({scope:'local stats 20001 markets/wallets',buildMs:Math.round(built-started),readMs:Math.round(performance.now()-built),responseBytes:Buffer.byteLength(JSON.stringify(large))}));
    assert.equal((await publishProtocolStatistics(handle.pool,deployment,schemaName)).published,false);
    // Stored event blocks can be sparse; verified covered ranges establish
    // completeness. A missing range must still make display data unavailable.
    await handle.pool.query(`UPDATE ${schema}.covered_ranges SET complete=false`);
    const gap=await app.request(`/v1/markets/${marketId}/detail?period=1D`);
    assert.equal(gap.status,200);
    const missing=await gap.json() as {chart:unknown;statistics:unknown;trades:unknown};
    assert.equal(missing.chart,null);assert.equal(missing.statistics,null);assert.equal(missing.trades,null);
  } finally {
    bootstrap.length = bootstrapLength;
    await handle.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined); await handle.pool.end();
  }
});
