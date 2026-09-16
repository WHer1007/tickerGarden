import type { Pool, PoolClient } from 'pg';
import type { DeploymentIdentity, RpcLog } from '../../chain/src/index.ts';
import { transaction } from '../../db/src/index.ts';
import {runtimeConfigs as f72BootstrapConfigs} from '../../runtime-deployment/src/index.ts';
import { decodeF72Event, eventTopic, f72EventCatalog, type DecodedProtocolEvent } from '../../events/src/index.ts';
import { normalizeTransaction, rebuildHolderSnapshot, transferFromObservation, type Address, type EventObservation, type MarketBinding, type TradeActivity } from '../../analytics/src/index.ts';

interface MarketRecord {
  readonly marketId: `0x${string}`; readonly memeToken: Address; readonly curve: Address; readonly gauge: Address;
  readonly quoteAsset: Address; readonly quoteAssetConfigId: `0x${string}`; readonly tickerGardenBaselineId: `0x${string}`;
  readonly poolId: `0x${string}` | null; readonly poolKey: { readonly currency0: Address; readonly currency1: Address; readonly hooks: Address; readonly fee?: number } | null;
  readonly source: { readonly blockNumber: string };
}
const ZERO_ADDRESS = `0x${'0'.repeat(40)}` as Address;
type FeeRecipient = 'creator' | 'stakers' | 'platform' | 'holders';
interface FeeTotal { readonly marketId: `0x${string}`; readonly recipient: FeeRecipient; readonly asset: Address; readonly amountRaw: bigint; readonly blockHash: `0x${string}`; readonly transactionHash: `0x${string}`; readonly logIndex: bigint }

export async function projectF72Analytics(input: {
  readonly pool: Pool; readonly deployment: DeploymentIdentity; readonly blockNumber: bigint; readonly blockHash: `0x${string}`;
  readonly generation: bigint; readonly schemaName?: string;
}): Promise<{ readonly trades: number; readonly holders: number }> {
  const schema = identifier(input.schemaName ?? 'tickergarden_serverless');
  const revision = `${input.blockNumber}:${input.blockHash}`;
  const marketRows = await input.pool.query<{ payload: MarketRecord }>(
    `SELECT jsonb_build_object('marketId',r.payload->'marketId','memeToken',r.payload->'memeToken','curve',r.payload->'curve','gauge',r.payload->'gauge','quoteAsset',r.payload->'quoteAsset','quoteAssetConfigId',r.payload->'quoteAssetConfigId','tickerGardenBaselineId',r.payload->'tickerGardenBaselineId','poolId',r.payload->'poolId','poolKey',r.payload->'poolKey','source',jsonb_build_object('blockNumber',r.payload->'source'->'blockNumber')) payload FROM ${schema}.projection_read_records r
     JOIN ${schema}.publication_pointers pointer USING(environment,chain_id,deployment_digest,scope,revision)
     WHERE r.environment=$1 AND r.chain_id=$2 AND r.deployment_digest=$3 AND r.scope='markets' AND r.revision=$4
     ORDER BY r.identity`,
    [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, revision],
  );
  const markets = marketRows.rows.map((row) => validateMarket(row.payload, input.deployment.chainId));
  const marketByCurve = new Map(markets.map((item) => [item.binding.curve, item]));
  const marketByToken = new Map(markets.map((item) => [item.record.memeToken, item]));
  const marketById = new Map(markets.map((item) => [item.record.marketId, item]));
  const pooled=markets.filter(item=>item.binding.poolId!==null);
  const marketByPool=new Map(pooled.map(item=>[item.binding.poolId!,item]));
  if(marketByPool.size!==pooled.length)throw new Error('duplicate analytics pool identity');
  if (marketByCurve.size !== markets.length || marketByToken.size !== markets.length) throw new Error('duplicate analytics market address');

  const previous = (await input.pool.query<{ next_block: string; generation: string }>(
    `SELECT next_block,generation FROM ${schema}.projection_checkpoints WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='analytics'`,
    identity(input.deployment),
  )).rows[0];
  const reset = !previous || BigInt(previous.generation) !== input.generation;
  const fromBlock = reset ? input.deployment.activationBlock : BigInt(previous.next_block);
  if (fromBlock > input.blockNumber) return { trades: 0, holders: 0 };

  const logRows = await input.pool.query<{ module: DecodedProtocolEvent['module']; payload: Record<string, unknown>; source_timestamp: Date }>(
    `SELECT s.module,l.payload,b.source_timestamp FROM ${schema}.chain_logs l
     JOIN ${schema}.chain_blocks b ON b.environment=l.environment AND b.chain_id=l.chain_id AND b.deployment_digest=l.deployment_digest AND b.hash=l.block_hash
     JOIN ${schema}.contract_sources s ON s.environment=l.environment AND s.chain_id=l.chain_id AND s.deployment_digest=l.deployment_digest AND s.address=l.address
     WHERE l.environment=$1 AND l.chain_id=$2 AND l.deployment_digest=$3 AND l.canonical AND b.canonical AND b.finalized
       AND b.number BETWEEN $4 AND $5 AND b.source_timestamp IS NOT NULL
     ORDER BY b.number,l.transaction_index,l.log_index`,
    [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest,
      fromBlock.toString(), input.blockNumber.toString()],
  );
  if (logRows.rows.length > 1_000_000) throw new Error('analytics replay exceeds release bound');
  const transactions = new Map<string, EventObservation[]>();
  const transfers = new Map<Address, EventObservation[]>();
  const feeTotals = new Map<string, FeeTotal>();
  const feeEvents: FeeTotal[] = [];
  for (const row of logRows.rows) {
    const log = parseStoredLog(row.payload);
    // Historical dense ingestion may contain other applications' shared PoolManager logs.
    // Only protocol-owned Swap events contribute to this deployment's analytics.
    if (row.module === 'UniswapV4PoolManager' && (log.topics[0] !== eventTopic('UniswapV4PoolManager', 'Swap') || !marketByPool.has(log.topics[1]!))) continue;
    const decoded = decodeF72Event(row.module, log);
    if (!decoded) throw new Error(`stored ${row.module} log cannot be decoded with frozen f72 ABI`);
    const observation = { event: decoded, timestamp: BigInt(Math.floor(row.source_timestamp.getTime() / 1_000)) } satisfies EventObservation;
    const key = `${log.blockHash}:${log.transactionHash}`;
    const group = transactions.get(key) ?? [];
    group.push(observation); transactions.set(key, group);
    if (decoded.module === 'TickerMemeTokenV1' && decoded.eventName === 'Transfer') {
      const market = marketByToken.get(log.address);
      if (!market) throw new Error('token transfer has no market binding');
      const tokenTransfers = transfers.get(log.address) ?? [];
      tokenTransfers.push(observation); transfers.set(log.address, tokenTransfers);
    }
    for (const fee of feeCredits(decoded)) {
      if (!marketById.has(fee.marketId)) throw new Error('fee credit has no market binding');
      const key = `${fee.marketId}:${fee.recipient}:${fee.asset}`;
      const previousFee = feeTotals.get(key);
      feeTotals.set(key, { ...fee, amountRaw: (previousFee?.amountRaw ?? 0n) + fee.amountRaw });
      feeEvents.push(fee);
    }
  }
  const trades: TradeActivity[] = [];
  for (const observations of transactions.values()) {
    // Authenticate only the markets referenced by this transaction. Passing the
    // entire population both repeated O(markets) work and hit the per-tx bound.
    const relevant=new Map<string,MarketBinding>();
    for(const {event} of observations){
      const candidates=[marketByCurve.get(event.log.address),marketByToken.get(event.log.address),marketById.get(String(event.args.marketId) as `0x${string}`),marketByPool.get(String(event.args.poolId??event.args.id) as `0x${string}`)];
      for(const candidate of candidates)if(candidate)relevant.set(candidate.record.marketId,candidate.binding);
    }
    trades.push(...normalizeTransaction(observations,[...relevant.values()]));
  }
  let changedHolders = 0;
  await transaction(input.pool, async (client) => {
    const lockKey = `${input.deployment.environment}:${input.deployment.chainId}:${input.deployment.deploymentDigest}:analytics`;
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [lockKey]);
    const locked = (await client.query<{ next_block: string; generation: string }>(
      `SELECT next_block,generation FROM ${schema}.projection_checkpoints WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='analytics' FOR UPDATE`,
      identity(input.deployment),
    )).rows[0];
    if ((locked?.next_block ?? null) !== (previous?.next_block ?? null) || (locked?.generation ?? null) !== (previous?.generation ?? null)) {
      throw new Error('analytics checkpoint advanced concurrently');
    }
    const anchor = await client.query<{ canonical: boolean; finalized: boolean }>(
      `SELECT canonical,finalized FROM ${schema}.chain_blocks WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND number=$4 AND hash=$5 FOR SHARE`,
      [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, input.blockNumber.toString(), input.blockHash],
    );
    if (!anchor.rows[0]?.canonical || !anchor.rows[0]?.finalized) throw new Error('analytics anchor is not canonical and finalized');
    if (reset) {
      // Keep each statement within the SQL deadline while the outer transaction
      // preserves an atomic reset of every derived table and its trigger counters.
      for(const table of ['market_trades','holder_balances','holder_snapshots','detail_fee_totals','detail_fee_events']){
        for(;;){const removed=await client.query(`DELETE FROM ${schema}.${table} WHERE ctid IN (SELECT ctid FROM ${schema}.${table} WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 LIMIT 1000)`,identity(input.deployment));if((removed.rowCount??0)<1000)break;}
      }
    }
    await writeBatches(client,`INSERT INTO ${schema}.market_trades(environment,chain_id,deployment_digest,market_id,block_hash,transaction_hash,log_index,occurred_at,classification,base_raw,quote_raw,payload)
      SELECT $1,$2,$3,x->>'marketId',x->'source'->>'blockHash',x->'source'->>'transactionHash',(x->'source'->>'logIndex')::bigint,to_timestamp((x->>'timestamp')::bigint),x->>'classification',(x->>'memeRaw')::numeric,(x->>'quoteRaw')::numeric,x FROM jsonb_array_elements($4::jsonb) x ON CONFLICT DO NOTHING`,identity(input.deployment),trades);
    await writeBatches(client,`INSERT INTO ${schema}.detail_fee_totals(environment,chain_id,deployment_digest,market_id,recipient,asset,amount_raw,block_hash)
      SELECT $1,$2,$3,r.market_id,r.recipient,r.asset,r.amount_raw,r.block_hash FROM jsonb_to_recordset($4::jsonb) AS r(market_id text,recipient text,asset text,amount_raw numeric,block_hash text)
      ON CONFLICT(environment,chain_id,deployment_digest,market_id,recipient,asset) DO UPDATE SET amount_raw=${schema}.detail_fee_totals.amount_raw+excluded.amount_raw,block_hash=excluded.block_hash`,identity(input.deployment),[...feeTotals.values()].map(fee=>({market_id:fee.marketId,recipient:fee.recipient,asset:fee.asset,amount_raw:fee.amountRaw.toString(),block_hash:fee.blockHash})));
    await writeBatches(client,`INSERT INTO ${schema}.detail_fee_events(environment,chain_id,deployment_digest,market_id,recipient,asset,amount_raw,block_hash,transaction_hash,log_index)
      SELECT $1,$2,$3,r.market_id,r.recipient,r.asset,r.amount_raw,r.block_hash,r.transaction_hash,r.log_index FROM jsonb_to_recordset($4::jsonb) AS r(market_id text,recipient text,asset text,amount_raw numeric,block_hash text,transaction_hash text,log_index bigint) ON CONFLICT DO NOTHING`,identity(input.deployment),feeEvents.map(fee=>({market_id:fee.marketId,recipient:fee.recipient,asset:fee.asset,amount_raw:fee.amountRaw.toString(),block_hash:fee.blockHash,transaction_hash:fee.transactionHash,log_index:fee.logIndex.toString()})));
    const existingSnapshots=await client.query<HolderState&{market_id:string}>(`SELECT market_id,total_supply_raw::text,positive_address_count::text,included_address_count::text,excluded_accounts FROM ${schema}.holder_snapshots WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 FOR UPDATE`,identity(input.deployment));
    const snapshotById=new Map(existingSnapshots.rows.map(row=>[row.market_id,row]));
    const buffers:HolderWrites={balances:[],snapshots:[]};
    for (const market of markets) {
      const observations=transfers.get(market.record.memeToken)??[];
      const current=snapshotById.get(market.record.marketId);
      if(current&&!observations.length){
        if(JSON.stringify(current.excluded_accounts)!==JSON.stringify(marketExclusions(market))||BigInt(current.total_supply_raw)>BigInt(market.initialSupply))throw Error('holder snapshot identity or exclusion policy changed');
        continue;
      }
      changedHolders+=await advanceHolders(client,schema,input.deployment,market,observations,input.blockNumber,input.blockHash,current,buffers);
      if(buffers.balances.length+buffers.snapshots.length>=500)await flushHolderWrites(client,schema,input.deployment,input.blockNumber,input.blockHash,buffers);
    }
    await flushHolderWrites(client,schema,input.deployment,input.blockNumber,input.blockHash,buffers);
    // The checkpoint below advances shared coverage atomically with changed balances.
    // Unchanged snapshots retain their last mutation anchor.
    await client.query(
      `INSERT INTO ${schema}.projection_checkpoints(environment,chain_id,deployment_digest,scope,algorithm_version,next_block,generation,last_revision)
       VALUES ($1,$2,$3,'analytics','f72-analytics-v1',$4,$5,$6)
       ON CONFLICT (environment,chain_id,deployment_digest,scope) DO UPDATE SET algorithm_version=excluded.algorithm_version,
       next_block=excluded.next_block,generation=excluded.generation,last_revision=excluded.last_revision,updated_at=now()`,
      [...identity(input.deployment), (input.blockNumber + 1n).toString(), input.generation.toString(), revision],
    );
  });
  return { trades: trades.length, holders: changedHolders };
}

export function feeCredits(event: DecodedProtocolEvent): FeeTotal[] {
  if (event.module !== 'ProtocolFeeVault') return [];
  if (event.eventName === 'CurveFeesSwept') {
    const marketId = hex32(event.args.marketId); const asset = address(event.args.quoteAsset);
    return [['creator', event.args.creatorAmount], ['platform', event.args.platformAmount]].map(([recipient, amount]) =>
      ({ marketId, recipient: recipient as FeeRecipient, asset, amountRaw: bigint(amount), blockHash: event.log.blockHash, transactionHash:event.log.transactionHash,logIndex:event.log.logIndex }));
  }
  if (event.eventName === 'FeeBucketsCredited') {
    const marketId = hex32(event.args.marketId); const asset = address(event.args.feeAsset);
    return [['creator', event.args.creatorAmount], ['stakers', event.args.stakerAmount], ['platform', event.args.platformAmount]].map(([recipient, amount]) =>
      ({ marketId, recipient: recipient as FeeRecipient, asset, amountRaw: bigint(amount), blockHash: event.log.blockHash, transactionHash:event.log.transactionHash,logIndex:event.log.logIndex }));
  }
  if (event.eventName === 'HolderFeesAccrued') return [{ marketId: hex32(event.args.marketId), recipient: 'holders',
    asset: address(event.args.feeAsset), amountRaw: bigint(event.args.amount), blockHash: event.log.blockHash,transactionHash:event.log.transactionHash,logIndex:event.log.logIndex }];
  return [];
}

async function advanceHolders(client: PoolClient, schema: string, deployment: DeploymentIdentity,
  market: ReturnType<typeof validateMarket>, observations: readonly EventObservation[], blockNumber: bigint, blockHash: `0x${string}`,current:HolderState|undefined,buffers:HolderWrites): Promise<number> {
  const transfers = observations.map((item) => transferFromObservation(item, deployment.chainId));
  const exclusions = marketExclusions(market);
  if (!current) {
    if (!transfers.length) throw new Error('new market token history has no initial mint');
    const snapshot = rebuildHolderSnapshot({ chainId: deployment.chainId, token: market.record.memeToken, initialHolder: market.record.curve,
      burnAuthority: null, allowSelfBurn: true, initialSupplyRaw: market.initialSupply, transfers, excludedAccounts: exclusions });
    for (const balance of snapshot.balances) await saveBalance(client, schema, deployment, market.record.marketId, balance.account,
      balance.balanceRaw, balance.excluded, blockHash,buffers);
    await saveSnapshot(client, schema, deployment, market.record.marketId, market.record.source.blockNumber, snapshot.totalSupplyRaw,
      snapshot.positiveAddressCount, snapshot.includedAddressCount, exclusions, blockNumber, blockHash,buffers);
    return snapshot.balances.length;
  }
  if (JSON.stringify(current.excluded_accounts) !== JSON.stringify(exclusions) || BigInt(current.total_supply_raw) > BigInt(market.initialSupply)) {
    throw new Error('holder snapshot identity or exclusion policy changed');
  }
  const touched = uniqueAddresses(transfers.flatMap((item) => [item.from, item.to]).filter((item) => item !== ZERO_ADDRESS));
  const loaded = touched.length ? await client.query<{ account: Address; balance_raw: string }>(
    `SELECT account,balance_raw::text FROM ${schema}.holder_balances WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4 AND account=ANY($5::text[]) FOR UPDATE`,
    [...identity(deployment), market.record.marketId, touched],
  ) : { rows: [] };
  const before = new Map<Address, bigint>(touched.map((account) => [account, 0n]));
  for (const row of loaded.rows) before.set(row.account, BigInt(row.balance_raw));
  const after = new Map(before);
  let supply = BigInt(current.total_supply_raw);
  for (const transfer of transfers) {
    if (transfer.from === ZERO_ADDRESS) throw new Error('unexpected mint in incremental holder history');
    const balance = after.get(transfer.from) ?? 0n; const amount = BigInt(transfer.value);
    if (balance < amount) throw new Error('incremental holder balance underflow');
    if (transfer.from !== transfer.to) {
      after.set(transfer.from, balance - amount);
      if (transfer.to === ZERO_ADDRESS) { if (amount > supply) throw new Error("burn exceeds supply"); supply -= amount; }
      else after.set(transfer.to, (after.get(transfer.to) ?? 0n) + amount);
    }
  }
  let positive = BigInt(current.positive_address_count); let included = BigInt(current.included_address_count);
  for (const account of touched) {
    const was = (before.get(account) ?? 0n) > 0n; const now = (after.get(account) ?? 0n) > 0n; const excluded = exclusions.includes(account);
    if (was !== now) { positive += now ? 1n : -1n; if (!excluded) included += now ? 1n : -1n; }
    if (now) await saveBalance(client, schema, deployment, market.record.marketId, account, (after.get(account) ?? 0n).toString(), excluded, blockHash,buffers);
    else await client.query(`DELETE FROM ${schema}.holder_balances WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4 AND account=$5`, [...identity(deployment), market.record.marketId, account]);
  }
  await saveSnapshot(client, schema, deployment, market.record.marketId, market.record.source.blockNumber, supply.toString(),
    Number(positive), Number(included), exclusions, blockNumber, blockHash,buffers);
  return touched.length;
}

async function saveBalance(client: PoolClient, schema: string, deployment: DeploymentIdentity, marketId: `0x${string}`,
  account: Address, balanceRaw: string, excluded: boolean, blockHash: `0x${string}`,buffers:HolderWrites): Promise<void> {
  buffers.balances.push({market_id:marketId,account,balance_raw:balanceRaw,excluded,payload:{account,balanceRaw,excluded}});return;

}
async function saveSnapshot(client: PoolClient, schema: string, deployment: DeploymentIdentity, marketId: `0x${string}`, creationBlock: string,
  supply: string, positive: number, included: number, exclusions: readonly Address[], blockNumber: bigint, blockHash: `0x${string}`,buffers:HolderWrites): Promise<void> {
  if (!Number.isSafeInteger(positive) || !Number.isSafeInteger(included) || positive < 0 || included < 0 || included > positive) throw new Error('holder count exceeds safe range');
  buffers.snapshots.push({market_id:marketId,creation_block:creationBlock,total_supply_raw:supply,positive_address_count:positive,included_address_count:included,excluded_accounts:exclusions});

}

export function validateMarket(record: MarketRecord, chainId: 4663 | 46630): { record: MarketRecord; binding: MarketBinding; initialSupply: string } {
  const quote = f72BootstrapConfigs.find((item) => item.kind === 'quote' && item.id === record.quoteAssetConfigId) as
    | { readonly values: { readonly quoteAsset: string; readonly quoteDecimals: number } } | undefined;
  const baseline = f72BootstrapConfigs.find((item) => item.kind === 'baseline' && item.id === record.tickerGardenBaselineId) as
    | { readonly values: { readonly supply: string } } | undefined;
  if (!quote || !baseline || quote.values.quoteAsset !== record.quoteAsset || typeof quote.values.quoteDecimals !== 'number'
    || typeof baseline.values.supply !== 'string') throw new Error('market analytics config binding is unavailable');
  const hook = record.poolKey?.hooks ?? f72EventCatalog.TickerGardenMemeHook.address;
  return { record, initialSupply: baseline.values.supply, binding: { chainId, marketId: record.marketId, memeAsset: record.memeToken,
    quoteAsset: record.quoteAsset, quoteDecimals: quote.values.quoteDecimals, curve: record.curve, hook,
    poolId: record.poolId, lpFeePips: record.poolKey?.fee ?? 0, currency0: record.poolKey?.currency0 ?? null, currency1: record.poolKey?.currency1 ?? null } };
}
function parseStoredLog(value: Record<string, unknown>): RpcLog { return { address: address(value.address), blockHash: hex32(value.blockHash),
  blockNumber: bigint(value.blockNumber), transactionHash: hex32(value.transactionHash), transactionIndex: bigint(value.transactionIndex),
  logIndex: bigint(value.logIndex), data: hex(value.data), topics: array(value.topics).map(hex32), removed: value.removed === true } }
function address(value: unknown): Address { if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error('invalid stored address'); return value.toLowerCase() as Address }
function hex32(value: unknown): `0x${string}` { if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error('invalid stored hash'); return value.toLowerCase() as `0x${string}` }
function hex(value: unknown): `0x${string}` { if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) throw new Error('invalid stored bytes'); return value.toLowerCase() as `0x${string}` }
function bigint(value: unknown): bigint { if ((typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') || !/^(0|[1-9][0-9]*)$/.test(String(value))) throw new Error('invalid stored integer'); return BigInt(value) }
function array(value: unknown): unknown[] { if (!Array.isArray(value)) throw new Error('invalid stored array'); return value }
function uniqueAddresses(values: readonly Address[]): Address[] { return [...new Set(values)].sort() }
function identity(deployment: DeploymentIdentity): [string, number, string] { return [deployment.environment, deployment.chainId, deployment.deploymentDigest] }
function identifier(value: string): string { if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error('invalid database schema name'); return `"${value}"` }

interface HolderState{total_supply_raw:string;positive_address_count:string;included_address_count:string;excluded_accounts:Address[]}
interface HolderWrites{balances:Array<Record<string,unknown>>;snapshots:Array<Record<string,unknown>>}
function marketExclusions(market:ReturnType<typeof validateMarket>){return uniqueAddresses([market.record.curve,market.record.gauge,market.record.memeToken,f72EventCatalog.HolderRewardsDistributorV1.address,f72EventCatalog.ProtocolFeeVault.address,f72EventCatalog.UniswapV4PoolManager.address,f72EventCatalog.TickerGardenFactoryV1.address,market.binding.hook].filter(account=>account!==ZERO_ADDRESS));}
async function flushHolderWrites(client:PoolClient,schema:string,deployment:DeploymentIdentity,block:bigint,hash:string,buffers:HolderWrites){
 for(let offset=0;offset<buffers.balances.length;offset+=250)await client.query(`INSERT INTO ${schema}.holder_balances(environment,chain_id,deployment_digest,market_id,account,balance_raw,excluded,block_hash,payload)
 SELECT $1,$2,$3,r.market_id,r.account,r.balance_raw,r.excluded,$4,r.payload FROM jsonb_to_recordset($5::jsonb) AS r(market_id text,account text,balance_raw numeric,excluded boolean,payload jsonb)
 ON CONFLICT(environment,chain_id,deployment_digest,market_id,account) DO UPDATE SET balance_raw=EXCLUDED.balance_raw,excluded=EXCLUDED.excluded,block_hash=EXCLUDED.block_hash,payload=EXCLUDED.payload`,[...identity(deployment),hash,JSON.stringify(buffers.balances.slice(offset,offset+250))]);
 for(let offset=0;offset<buffers.snapshots.length;offset+=250)await client.query(`INSERT INTO ${schema}.holder_snapshots(environment,chain_id,deployment_digest,market_id,creation_block,total_supply_raw,positive_address_count,included_address_count,excluded_accounts,block_number,block_hash)
 SELECT $1,$2,$3,r.market_id,r.creation_block,r.total_supply_raw,r.positive_address_count,r.included_address_count,r.excluded_accounts,$4,$5 FROM jsonb_to_recordset($6::jsonb) AS r(market_id text,creation_block bigint,total_supply_raw numeric,positive_address_count bigint,included_address_count bigint,excluded_accounts jsonb)
 ON CONFLICT(environment,chain_id,deployment_digest,market_id) DO UPDATE SET total_supply_raw=EXCLUDED.total_supply_raw,positive_address_count=EXCLUDED.positive_address_count,included_address_count=EXCLUDED.included_address_count,excluded_accounts=EXCLUDED.excluded_accounts,block_number=EXCLUDED.block_number,block_hash=EXCLUDED.block_hash`,[...identity(deployment),block.toString(),hash,JSON.stringify(buffers.snapshots.slice(offset,offset+250))]);
 buffers.balances.length=0;buffers.snapshots.length=0;
}

async function writeBatches(client:PoolClient,sql:string,id:readonly unknown[],rows:readonly unknown[]){for(let offset=0;offset<rows.length;offset+=250)await client.query(sql,[...id,JSON.stringify(rows.slice(offset,offset+250))]);}
