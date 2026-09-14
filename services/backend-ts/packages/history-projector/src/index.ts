import type { Pool, PoolClient } from 'pg';
import type { DeploymentIdentity, RpcLog } from '../../chain/src/index.ts';
import { transaction } from '../../db/src/index.ts';
import { decodeF72Event, type DecodedProtocolEvent } from '../../events/src/index.ts';
import { protocolEventSignature as eventSignature } from '../../events/src/index.ts';

type Address = `0x${string}`;
type Hash = `0x${string}`;
const ZERO_ADDRESS = `0x${'0'.repeat(40)}` as Address;

interface MarketRecord {
  readonly marketId: Hash; readonly memeToken: Address; readonly quoteAsset: Address; readonly creator: Address;
  readonly creatorFeesToHolders: boolean; readonly burnMemeFees?: boolean; readonly source: { readonly blockNumber: string };
  readonly identity: { readonly name: string; readonly symbol: string };
}
interface StoredEvent { readonly event: DecodedProtocolEvent; readonly occurredAt: Date }
interface Reward { readonly kind: 'holder' | 'staker'; readonly marketId: Hash; readonly account: Address; readonly asset: Address;
  readonly amount: bigint; readonly transactionHash: Hash; readonly logIndex: bigint; readonly throughBlock: bigint }

export async function projectF72History(input: {
  readonly pool: Pool; readonly deployment: DeploymentIdentity; readonly blockNumber: bigint; readonly blockHash: Hash;
  readonly generation: bigint; readonly schemaName?: string;
}): Promise<{ readonly rewards: number; readonly activities: number; readonly aggregates: number }> {
  const schema = identifier(input.schemaName ?? 'tickergarden_serverless');
  const revision = `${input.blockNumber}:${input.blockHash}`;
  const markets = await loadMarkets(input.pool, schema, input.deployment, revision);
  const marketById = new Map(markets.map((market) => [market.marketId, market]));
  const marketByToken = new Map(markets.map((market) => [market.memeToken, market]));
  if (marketById.size !== markets.length || marketByToken.size !== markets.length) throw new Error('history market identity is duplicated');

  const rows = await input.pool.query<{ module: DecodedProtocolEvent['module']; payload: Record<string, unknown>; source_timestamp: Date }>(
    `SELECT s.module,l.payload,b.source_timestamp FROM ${schema}.chain_logs l
     JOIN ${schema}.chain_blocks b ON b.environment=l.environment AND b.chain_id=l.chain_id AND b.deployment_digest=l.deployment_digest AND b.hash=l.block_hash
     JOIN ${schema}.contract_sources s ON s.environment=l.environment AND s.chain_id=l.chain_id AND s.deployment_digest=l.deployment_digest AND s.address=l.address
     WHERE l.environment=$1 AND l.chain_id=$2 AND l.deployment_digest=$3 AND l.canonical AND b.canonical AND b.finalized
       AND b.number BETWEEN $4 AND $5 AND b.source_timestamp IS NOT NULL
     ORDER BY b.number,l.transaction_index,l.log_index`,
    [...identity(input.deployment), input.deployment.activationBlock.toString(), input.blockNumber.toString()],
  );
  if (rows.rows.length > 1_000_000) throw new Error('history replay exceeds release bound');
  const events: StoredEvent[] = rows.rows.map((row) => {
    const log = parseStoredLog(row.payload); const event = decodeF72Event(row.module, log);
    if (!event) throw new Error(`stored ${row.module} log cannot be decoded with frozen f72 ABI`);
    return { event, occurredAt: row.source_timestamp };
  });

  const registered = new Set<Hash>();
  for (const { event } of events) if (event.module === 'HolderRewardsDistributorV1' && ['HolderStreamMarketRegistered','HolderSnapshotMarketRegistered'].includes(event.eventName)) {
    const marketId = hash(event.args.marketId); const market = requiredMarket(marketById, marketId);
    if (!market.creatorFeesToHolders || address(event.args.token) !== market.memeToken || address(event.args.quote) !== market.quoteAsset) {
      throw new Error('holder market registration disagrees with market publication');
    }
    registered.add(marketId);
  }
  const burns = aggregateMemeFeeBurns(events, markets);
  const rewards = normalizeRewards(events, marketById);
  const walletMarkets = walletHolderMarkets(events, marketByToken, registered);
  const creatorMarkets = creatorBeneficiaries(events, markets, marketById);
  const launches = launchRecoveries(events, marketById, input.deployment.chainId);
  const aggregates = [...creatorMarkets.values()].reduce((sum, accounts) => sum + accounts.size, 0) + registered.size
    + [...walletMarkets.values()].reduce((sum, ids) => sum + ids.size, 0) + launches.size;

  await transaction(input.pool, async (client) => {
    const lockKey = `${input.deployment.environment}:${input.deployment.chainId}:${input.deployment.deploymentDigest}:history`;
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [lockKey]);
    await assertAnchor(client, schema, input);
    await client.query(`DELETE FROM ${schema}.reward_history WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3`, identity(input.deployment));
    await client.query(`DELETE FROM ${schema}.user_activity WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3`, identity(input.deployment));
    await client.query(`DELETE FROM ${schema}.aggregate_records WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope=ANY($4::text[])`,
      [...identity(input.deployment), ['creator-market', 'holder-market', 'wallet-holder-market', 'launch-recovery', 'meme-fee-burn']]);
    for (const burn of burns) await saveAggregate(client, schema, input.deployment, "meme-fee-burn", burn.marketId, input.blockHash, burn);
    for (const reward of rewards) await saveReward(client, schema, input.deployment, reward);
    let activities = 0;
    for (const stored of events) for (const reference of activityReferences(stored.event)) {
      await saveActivity(client, schema, input.deployment, reference, stored); activities++;
    }
    for (const [marketId, accounts] of creatorMarkets) { const market = requiredMarket(marketById, marketId); for (const creator of accounts)
      await saveAggregate(client, schema, input.deployment, 'creator-market', `${creator}:${market.marketId}`,
        input.blockHash, { marketId: market.marketId, memeToken: market.memeToken, creator, creationBlockNumber: market.source.blockNumber }); }
    for (const marketId of registered) {
      const market = requiredMarket(marketById, marketId);
      await saveAggregate(client, schema, input.deployment, 'holder-market', marketId, input.blockHash, directoryMarket(market));
    }
    for (const [account, ids] of walletMarkets) for (const marketId of ids) {
      const market = requiredMarket(marketById, marketId);
      await saveAggregate(client, schema, input.deployment, 'wallet-holder-market', `${account}:${marketId}`, input.blockHash,
        { account, ...directoryMarket(market) });
    }
    for (const [marketId, payload] of launches) await saveAggregate(client, schema, input.deployment, 'launch-recovery', marketId, input.blockHash, payload);
    await client.query(
      `INSERT INTO ${schema}.projection_checkpoints(environment,chain_id,deployment_digest,scope,algorithm_version,next_block,generation,last_revision)
       VALUES ($1,$2,$3,'history','f72-history-v1',$4,$5,$6)
       ON CONFLICT (environment,chain_id,deployment_digest,scope) DO UPDATE SET algorithm_version=excluded.algorithm_version,
       next_block=excluded.next_block,generation=excluded.generation,last_revision=excluded.last_revision,updated_at=now()`,
      [...identity(input.deployment), (input.blockNumber + 1n).toString(), input.generation.toString(), revision],
    );
  });
  return { rewards: rewards.length, activities: events.reduce((sum, item) => sum + activityReferences(item.event).length, 0), aggregates };
}

function launchRecoveries(events: readonly StoredEvent[], markets: ReadonlyMap<Hash, MarketRecord>, chainId: number): Map<Hash, object> {
  const result = new Map<Hash, object>();
  for (const { event } of events) if (event.module === 'TickerGardenFactoryV1' && event.eventName === 'MarketCreated') {
    const marketId = hash(event.args.marketId); requiredMarket(markets, marketId);
    if (result.has(marketId)) throw new Error('market has duplicate creation evidence');
    result.set(marketId, { chainId, displayOnly: true, marketId, transactionHash: event.log.transactionHash,
      blockNumber: event.log.blockNumber.toString(), blockHash: event.log.blockHash, finality: 'finalized' });
  }
  return result;
}

function creatorBeneficiaries(events: readonly StoredEvent[], markets: readonly MarketRecord[], byId: ReadonlyMap<Hash, MarketRecord>): Map<Hash, Set<Address>> {
  const result = new Map<Hash, Set<Address>>(markets.map((market) => [market.marketId, new Set([market.creator])]));
  for (const { event } of events) {
    if (event.module !== 'CreatorRevenueRegistry') continue; let marketId: Hash; const values: unknown[] = [];
    if (event.eventName === 'CreatorRevenueEpochInitialized') { marketId = hash(event.args.marketId); values.push(event.args.beneficiary); }
    else if (event.eventName === 'CreatorRevenueBeneficiaryUpdated') { marketId = hash(event.args.marketId); values.push(event.args.oldBeneficiary, event.args.newBeneficiary); }
    else continue;
    requiredMarket(byId, marketId); const accounts = result.get(marketId)!; for (const value of values) accounts.add(address(value));
  }
  return result;
}

function normalizeRewards(events: readonly StoredEvent[], markets: ReadonlyMap<Hash, MarketRecord>): Reward[] {
  const result: Reward[] = [];
  const preferred = new Set(events.filter(({ event }) => event.module === 'ProtocolFeeVault' && event.eventName === 'UserRewardsClaimed'
    && integer(event.args.role) === 2n).map(({ event }) => event.log.transactionHash));
  for (const { event } of events) {
    if (event.module === 'ProtocolFeeVault' && event.eventName === 'FeeClaimed' && integer(event.args.beneficiaryType) === 1n) {
      const marketId = hash(event.args.marketId); requiredMarket(markets, marketId);
      result.push(reward('staker', marketId, address(event.args.beneficiary), address(event.args.feeAsset), integer(event.args.amount), event));
    } else if (event.module === 'ProtocolFeeVault' && event.eventName === 'UserRewardsClaimed' && integer(event.args.role) === 2n) {
      const marketId = hash(event.args.marketId); const market = requiredMarket(markets, marketId);
      const quote = integer(event.args.quotePaid), meme = integer(event.args.memePaid);
      if (quote > 0n) result.push(reward('holder', marketId, address(event.args.user), market.quoteAsset, quote, event));
      if (meme > 0n) result.push(reward('holder', marketId, address(event.args.user), market.memeToken, meme, event));
    } else if (event.module === 'HolderRewardsDistributorV1' && event.eventName === 'HolderSnapshotClaimed') {
      const marketId=hash(event.args.marketId),market=requiredMarket(markets,marketId);
      const quote=integer(event.args.quotePaid),meme=integer(event.args.memePaid);
      if(market.burnMemeFees && meme!==0n)throw new Error('Burn-mode holder claim paid Meme');
      if(quote>0n)result.push(reward('holder',marketId,address(event.args.account),market.quoteAsset,quote,event));
      if(meme>0n)result.push(reward('holder',marketId,address(event.args.account),market.memeToken,meme,event));
    } else if (event.module === 'HolderRewardsDistributorV1' && event.eventName === 'HolderStreamClaimed'
      && !preferred.has(event.log.transactionHash)) {
      const marketId = hash(event.args.marketId); requiredMarket(markets, marketId);
      result.push(reward('holder', marketId, address(event.args.account), address(event.args.asset), integer(event.args.amount), event));
    }
  }
  return result;
}

function walletHolderMarkets(events: readonly StoredEvent[], byToken: ReadonlyMap<Address, MarketRecord>, registered: ReadonlySet<Hash>): Map<Address, Set<Hash>> {
  const result = new Map<Address, Set<Hash>>();
  for (const { event } of events) {
    if (event.module !== 'TickerMemeTokenV1' || event.eventName !== 'Transfer') continue;
    const market = byToken.get(event.log.address); if (!market || !registered.has(market.marketId)) continue;
    for (const account of [address(event.args.from), address(event.args.to)]) if (account !== ZERO_ADDRESS) {
      const ids = result.get(account) ?? new Set<Hash>(); ids.add(market.marketId); result.set(account, ids);
    }
  }
  return result;
}

function activityReferences(event: DecodedProtocolEvent): Array<{ account: Address; roles: string[] }> {
  const names = event.module === 'TickerGardenCurve'
    ? event.eventName === 'CurveBuy' ? ['buyer', 'recipient'] : event.eventName === 'CurveSell' ? ['seller', 'recipient'] : event.eventName === 'CurveBuyRefunded' ? ['buyer'] : []
    : event.module === 'TickerMemeTokenV1' && event.eventName === 'Transfer' ? ['from', 'to']
    : event.module === 'ProtocolFeeVault' ? event.eventName === 'FeeClaimed' ? ['beneficiary'] : ['user']
    : event.module === 'HolderRewardsDistributorV1' ? ['account']
    : event.module === 'UserStockVault' || event.module === 'MemeStockGauge' || event.module === 'AllocationManager' ? ['user'] : [];
  const accounts = new Map<Address, Set<string>>();
  for (const name of names) { const value = event.args[name]; if (typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)) {
    const account = address(value); if (account !== ZERO_ADDRESS) { const roles = accounts.get(account) ?? new Set<string>(); roles.add(name); accounts.set(account, roles); }
  } }
  return [...accounts].map(([account, roles]) => ({ account, roles: [...roles].sort() }));
}

async function loadMarkets(pool: Pool, schema: string, deployment: DeploymentIdentity, revision: string): Promise<MarketRecord[]> {
  const rows = await pool.query<{ payload: MarketRecord }>(
    `SELECT r.payload FROM ${schema}.projection_read_records r JOIN ${schema}.publication_pointers p USING(environment,chain_id,deployment_digest,scope,revision)
     WHERE r.environment=$1 AND r.chain_id=$2 AND r.deployment_digest=$3 AND r.scope='markets' AND r.revision=$4 ORDER BY r.identity`,
    [...identity(deployment), revision],
  );
  return rows.rows.map(({ payload }) => validateMarket(payload));
}
function validateMarket(value: MarketRecord): MarketRecord {
  if (!value || hash(value.marketId) !== value.marketId || address(value.memeToken) !== value.memeToken || address(value.quoteAsset) !== value.quoteAsset
    || address(value.creator) !== value.creator || typeof value.creatorFeesToHolders !== 'boolean' || !/^(0|[1-9][0-9]*)$/.test(value.source?.blockNumber)
    || typeof value.identity?.name !== 'string' || typeof value.identity?.symbol !== 'string') throw new Error('invalid history market publication');
  return value;
}
function requiredMarket(markets: ReadonlyMap<Hash, MarketRecord>, marketId: Hash): MarketRecord { const value = markets.get(marketId); if (!value) throw new Error('history event has no market binding'); return value }
function directoryMarket(market: MarketRecord) { return { marketId: market.marketId, memeToken: market.memeToken, name: market.identity.name, symbol: market.identity.symbol } }
function reward(kind: Reward['kind'], marketId: Hash, account: Address, asset: Address, amount: bigint, event: DecodedProtocolEvent): Reward {
  return { kind, marketId, account, asset, amount, transactionHash: event.log.transactionHash, logIndex: event.log.logIndex, throughBlock: event.log.blockNumber };
}
async function saveReward(client: PoolClient, schema: string, deployment: DeploymentIdentity, item: Reward): Promise<void> {
  await client.query(`INSERT INTO ${schema}.reward_history(environment,chain_id,deployment_digest,kind,market_id,account,asset,transaction_hash,log_index,through_block,amount_raw,display_only,payload)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,$12)`, [...identity(deployment), item.kind, item.marketId, item.account, item.asset,
    item.transactionHash, item.logIndex.toString(), item.throughBlock.toString(), item.amount.toString(), { ...item, amount: item.amount.toString(), logIndex: item.logIndex.toString(), throughBlock: item.throughBlock.toString() }]);
}
async function saveActivity(client: PoolClient, schema: string, deployment: DeploymentIdentity, reference: { account: Address; roles: string[] }, stored: StoredEvent): Promise<void> {
  const { event } = stored;
  await client.query(`INSERT INTO ${schema}.user_activity(environment,chain_id,deployment_digest,account,block_hash,transaction_hash,log_index,occurred_at,display_only,payload)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,$9)`, [...identity(deployment), reference.account, event.log.blockHash, event.log.transactionHash,
    event.log.logIndex.toString(), stored.occurredAt, { account: reference.account, roles: reference.roles, module: event.module,
      signature: eventSignature(event), emitter: event.log.address, arguments: jsonValue(event.args), blockNumber: event.log.blockNumber.toString(),
      blockHash: event.log.blockHash, transactionHash: event.log.transactionHash, transactionIndex: event.log.transactionIndex.toString(), logIndex: event.log.logIndex.toString() }]);
}
async function saveAggregate(client: PoolClient, schema: string, deployment: DeploymentIdentity, scope: string, identityValue: string, blockHash: Hash, payload: object): Promise<void> {
  await client.query(`INSERT INTO ${schema}.aggregate_records(environment,chain_id,deployment_digest,scope,identity,block_hash,complete,payload)
    VALUES($1,$2,$3,$4,$5,$6,true,$7)`, [...identity(deployment), scope, identityValue, blockHash, payload]);
}
async function assertAnchor(client: PoolClient, schema: string, input: { deployment: DeploymentIdentity; blockNumber: bigint; blockHash: Hash; generation: bigint }) {
  const row = (await client.query<{ canonical: boolean; finalized: boolean }>(`SELECT canonical,finalized FROM ${schema}.chain_blocks
    WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND number=$4 AND hash=$5 FOR SHARE`,
    [...identity(input.deployment), input.blockNumber.toString(), input.blockHash])).rows[0];
  if (!row?.canonical || !row.finalized) throw new Error('history anchor is not canonical and finalized');
  const checkpoint = (await client.query<{ next_block: string; generation: string }>(`SELECT next_block,generation FROM ${schema}.ingestion_checkpoints
    WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND stream='frontend-events' FOR SHARE`, identity(input.deployment))).rows[0];
  if (!checkpoint || BigInt(checkpoint.next_block) <= input.blockNumber || BigInt(checkpoint.generation) !== input.generation) throw new Error('history anchor is not covered by ingestion');
}
function parseStoredLog(value: Record<string, unknown>): RpcLog { return { address: address(value.address), blockHash: hash(value.blockHash), blockNumber: integer(value.blockNumber),
  transactionHash: hash(value.transactionHash), transactionIndex: integer(value.transactionIndex), logIndex: integer(value.logIndex), data: bytes(value.data),
  topics: list(value.topics).map(hash), removed: value.removed === true } }
function address(value: unknown): Address { if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error('invalid address'); return value.toLowerCase() as Address }
function hash(value: unknown): Hash { if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error('invalid hash'); return value.toLowerCase() as Hash }
function bytes(value: unknown): Hash { if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) throw new Error('invalid bytes'); return value.toLowerCase() as Hash }
function integer(value: unknown): bigint { if ((typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') || !/^(0|[1-9][0-9]*)$/.test(String(value))) throw new Error('invalid integer'); return BigInt(value) }
function list(value: unknown): unknown[] { if (!Array.isArray(value)) throw new Error('invalid array'); return value }
function jsonValue(value: unknown): unknown { if (typeof value === 'bigint') return value.toString(); if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item)])); return value }

function identity(deployment: DeploymentIdentity): [string, number, string] { return [deployment.environment, deployment.chainId, deployment.deploymentDigest] }
function identifier(value: string): string { if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error('invalid database schema name'); return `"${value}"` }

/** Full canonical replay; a reorg replaces the aggregate instead of double-counting. */
export function aggregateMemeFeeBurns(events: readonly StoredEvent[], markets: readonly Pick<MarketRecord, 'marketId'|'memeToken'|'burnMemeFees'>[]) {
  const rows = new Map(markets.map(m => [m.marketId, {marketId:m.marketId,token:m.memeToken,enabled:m.burnMemeFees===true,creatorRaw:0n,stakerRaw:0n,holderRaw:0n}]));
  const seen=new Set<string>();
  for(const {event} of events) {
    if(event.module!=='ProtocolFeeVault'||event.eventName!=='MemeFeesBurned')continue;
    const id=hash(event.args.marketId),row=rows.get(id),role=Number(event.args.role),amount=BigInt(String(event.args.amount));
    const key=`${event.log.blockHash}:${event.log.transactionHash}:${event.log.logIndex}`;
    if(!row?.enabled||address(event.args.token)!==row.token||![0,1,2].includes(role)||amount<=0n||seen.has(key))throw new Error('Invalid Meme fee burn event');
    const beneficiary=address(event.args.beneficiary),epoch=BigInt(String(event.args.creatorEpoch));
    if((role===2)!==(beneficiary===ZERO_ADDRESS)||(role===0?epoch<=0n:epoch!==0n))throw new Error('Invalid Meme fee burn beneficiary');
    seen.add(key);
    if(role===0)row.creatorRaw+=amount;else if(role===1)row.stakerRaw+=amount;else row.holderRaw+=amount;
  }
  return [...rows.values()].map(r=>({...r,creatorRaw:String(r.creatorRaw),stakerRaw:String(r.stakerRaw),holderRaw:String(r.holderRaw),totalRaw:String(r.creatorRaw+r.stakerRaw+r.holderRaw)}));
}
