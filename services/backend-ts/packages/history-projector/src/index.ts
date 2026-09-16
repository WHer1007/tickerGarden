import {ProjectionPending} from '../../projection/src/index.ts';
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
 readonly pool:Pool;readonly deployment:DeploymentIdentity;readonly blockNumber:bigint;readonly blockHash:Hash;readonly generation:bigint;readonly schemaName?:string;
}):Promise<{rewards:number;activities:number;aggregates:number}>{
 const schema=identifier(input.schemaName??'tickergarden_serverless'),id=identity(input.deployment),revision=`${input.blockNumber}:${input.blockHash}`;
 const markets=await loadMarkets(input.pool,schema,input.deployment,revision),byId=new Map(markets.map(m=>[m.marketId,m])),byToken=new Map(markets.map(m=>[m.memeToken,m]));
 if(byId.size!==markets.length||byToken.size!==markets.length)throw Error('history market identity is duplicated');
 const result=await transaction(input.pool,async client=>{
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${id.join(':')}:history`]);
  await assertAnchor(client,schema,input);
  const prior=(await client.query<{next_block:string;generation:string;algorithm_version:string;last_revision:string|null}>(`SELECT next_block,generation,algorithm_version,last_revision FROM ${schema}.projection_checkpoints WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='history' FOR UPDATE`,id)).rows[0];
  if(prior&&BigInt(prior.generation)>input.generation)throw Error('history generation advanced');
  if(prior?.algorithm_version==='history-incremental-v2'&&BigInt(prior.next_block)>input.blockNumber){
   if(prior.last_revision!==revision)throw Error('history projection advanced');return {rewards:0,activities:0,aggregates:0};
  }
  const reset=prior?.algorithm_version!=='history-incremental-v2';
  const from=reset?input.deployment.activationBlock:BigInt(prior.next_block);
  if(reset){
   for(const table of ['history_contributions','reward_history','user_activity'])await client.query(`DELETE FROM ${schema}.${table} WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3`,id);
   await client.query(`DELETE FROM ${schema}.aggregate_records WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope=ANY($4::text[])`,[...id,['creator-market','holder-market','wallet-holder-market','launch-recovery','meme-fee-burn']]);
  }
  const affected=new Map<string,{scope:string;identity:string}>();
  const contributions=new Map<string,{scope:string;identity:string;block_number:string;block_hash:Hash;payload:object}>();
  const removed=await client.query<{scope:string;identity:string}>(`DELETE FROM ${schema}.history_contributions WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND block_number>=$4 RETURNING scope,identity`,[...id,from.toString()]);
  for(const row of removed.rows)affected.set(`${row.scope}:${row.identity}`,row);
  await client.query(`DELETE FROM ${schema}.reward_history WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND through_block>=$4`,[...id,from.toString()]);
  await client.query(`DELETE FROM ${schema}.user_activity a USING ${schema}.chain_blocks b WHERE a.environment=$1 AND a.chain_id=$2 AND a.deployment_digest=$3 AND b.environment=a.environment AND b.chain_id=a.chain_id AND b.deployment_digest=a.deployment_digest AND b.hash=a.block_hash AND b.number>=$4`,[...id,from.toString()]);
  // Bound each continuation by event-bearing blocks, keeping all events of a transaction together.
  const blocks=await client.query<{number:string;hash:Hash}>(`SELECT b.number,b.hash FROM ${schema}.chain_blocks b WHERE b.environment=$1 AND b.chain_id=$2 AND b.deployment_digest=$3 AND b.canonical AND b.finalized AND b.number BETWEEN $4 AND $5 AND EXISTS(SELECT 1 FROM ${schema}.chain_logs l WHERE l.environment=b.environment AND l.chain_id=b.chain_id AND l.deployment_digest=b.deployment_digest AND l.block_hash=b.hash AND l.canonical) ORDER BY b.number LIMIT 257`,[...id,from.toString(),input.blockNumber.toString()]);
  const through=blocks.rows.length>256?BigInt(blocks.rows[255]!.number):input.blockNumber;
  const anchorHash=through===input.blockNumber?input.blockHash:blocks.rows[255]!.hash;
  let rewards=0,activities=0,aggregates=0;
  const contribute=async(scope:string,identityValue:string,blockNumber:bigint,blockHash:Hash,payload:object)=>{
   contributions.set(`${scope}:${identityValue}:${blockHash}`,{scope,identity:identityValue,block_number:blockNumber.toString(),block_hash:blockHash,payload});
   affected.set(`${scope}:${identityValue}`,{scope,identity:identityValue});
  };
  const registered=new Set((await client.query<{identity:Hash}>(`SELECT a.identity FROM ${schema}.aggregate_records a JOIN ${schema}.chain_blocks b ON b.environment=a.environment AND b.chain_id=a.chain_id AND b.deployment_digest=a.deployment_digest AND b.hash=a.block_hash WHERE a.environment=$1 AND a.chain_id=$2 AND a.deployment_digest=$3 AND a.scope='holder-market' AND b.canonical AND b.finalized`,id)).rows.map(r=>r.identity));
  for(const block of blocks.rows.filter(b=>BigInt(b.number)<=through)){
   const rows=await client.query<{module:DecodedProtocolEvent['module'];payload:Record<string,unknown>;source_timestamp:Date}>(`SELECT s.module,l.payload,b.source_timestamp FROM ${schema}.chain_logs l JOIN ${schema}.chain_blocks b ON b.environment=l.environment AND b.chain_id=l.chain_id AND b.deployment_digest=l.deployment_digest AND b.hash=l.block_hash JOIN ${schema}.contract_sources s ON s.environment=l.environment AND s.chain_id=l.chain_id AND s.deployment_digest=l.deployment_digest AND s.address=l.address WHERE l.environment=$1 AND l.chain_id=$2 AND l.deployment_digest=$3 AND l.block_hash=$4 AND s.module<>'UniswapV4PoolManager' AND l.canonical AND b.canonical AND b.finalized ORDER BY l.transaction_index,l.log_index`,[...id,block.hash]);
   const events:StoredEvent[]=rows.rows.map(row=>{const event=decodeF72Event(row.module,parseStoredLog(row.payload));if(!event||!row.source_timestamp)throw Error('history event cannot be decoded');return {event,occurredAt:row.source_timestamp};});
   const created=new Set(events.filter(e=>e.event.module==='TickerGardenFactoryV1'&&e.event.eventName==='MarketCreated').map(e=>hash(e.event.args.marketId)));

   const accounts=creatorBeneficiaries(events,markets.filter(m=>created.has(m.marketId)),byId);
   for(const [marketId,owners]of accounts)for(const creator of owners){const m=requiredMarket(byId,marketId);await contribute('creator-market',`${creator}:${marketId}`,BigInt(block.number),block.hash,{marketId,memeToken:m.memeToken,creator,creationBlockNumber:m.source.blockNumber});aggregates++;}
   for(const e of events)if(e.event.module==='HolderRewardsDistributorV1'&&['HolderStreamMarketRegistered','HolderSnapshotMarketRegistered'].includes(e.event.eventName)){
    const m=requiredMarket(byId,hash(e.event.args.marketId));if(!m.creatorFeesToHolders||address(e.event.args.token)!==m.memeToken||address(e.event.args.quote)!==m.quoteAsset)throw Error('holder registration mismatch');
    registered.add(m.marketId);await contribute('holder-market',m.marketId,BigInt(block.number),block.hash,directoryMarket(m));aggregates++;
   }
   for(const [account,ids]of walletHolderMarkets(events,byToken,registered))for(const marketId of ids){await contribute('wallet-holder-market',`${account}:${marketId}`,BigInt(block.number),block.hash,{account,...directoryMarket(requiredMarket(byId,marketId))});aggregates++;}
   for(const [marketId,payload]of launchRecoveries(events,byId,input.deployment.chainId)){await contribute('launch-recovery',marketId,BigInt(block.number),block.hash,payload);aggregates++;}
   const burnIds=new Set([...created,...events.filter(e=>e.event.eventName==='MemeFeesBurned').map(e=>hash(e.event.args.marketId))]);
   for(const burn of aggregateMemeFeeBurns(events,markets.filter(m=>burnIds.has(m.marketId))))await contribute('meme-fee-burn',burn.marketId,BigInt(block.number),block.hash,burn);
   const rewardRows=normalizeRewards(events,byId);rewards+=rewardRows.length;
   const activityRows=events.flatMap(e=>activityReferences(e.event).map(ref=>({account:ref.account,block_hash:e.event.log.blockHash,transaction_hash:e.event.log.transactionHash,log_index:String(e.event.log.logIndex),occurred_at:e.occurredAt,payload:{account:ref.account,roles:ref.roles,module:e.event.module,signature:eventSignature(e.event),emitter:e.event.log.address,arguments:jsonValue(e.event.args),blockNumber:String(e.event.log.blockNumber),blockHash:e.event.log.blockHash,transactionHash:e.event.log.transactionHash,transactionIndex:String(e.event.log.transactionIndex),logIndex:String(e.event.log.logIndex)}})));activities+=activityRows.length;
   for(let n=0;n<rewardRows.length;n+=500)await client.query(`INSERT INTO ${schema}.reward_history SELECT $1,$2,$3,r.kind,r.market_id,r.account,r.asset,r.transaction_hash,r.log_index,r.through_block,r.amount_raw,true,r.payload FROM jsonb_to_recordset($4::jsonb) r(kind text,market_id ${schema}.hash32,account ${schema}.address,asset ${schema}.address,transaction_hash ${schema}.hash32,log_index bigint,through_block bigint,amount_raw ${schema}.uint256,payload jsonb)`,[...id,JSON.stringify(rewardRows.slice(n,n+500).map(r=>({kind:r.kind,market_id:r.marketId,account:r.account,asset:r.asset,transaction_hash:r.transactionHash,log_index:String(r.logIndex),through_block:String(r.throughBlock),amount_raw:String(r.amount),payload:jsonValue(r)})))]);
   for(let n=0;n<activityRows.length;n+=500)await client.query(`INSERT INTO ${schema}.user_activity SELECT $1,$2,$3,r.account,r.block_hash,r.transaction_hash,r.log_index,r.occurred_at,true,r.payload FROM jsonb_to_recordset($4::jsonb) r(account ${schema}.address,block_hash ${schema}.hash32,transaction_hash ${schema}.hash32,log_index bigint,occurred_at timestamptz,payload jsonb)`,[...id,JSON.stringify(activityRows.slice(n,n+500))]);
   const facts=[...contributions.values()];for(let n=0;n<facts.length;n+=500)await client.query(`INSERT INTO ${schema}.history_contributions SELECT $1,$2,$3,r.scope,r.identity,r.block_number,r.block_hash,r.payload FROM jsonb_to_recordset($4::jsonb) r(scope text,identity text,block_number bigint,block_hash text,payload jsonb) ON CONFLICT(environment,chain_id,deployment_digest,scope,identity,block_hash) DO UPDATE SET payload=excluded.payload`,[...id,JSON.stringify(facts.slice(n,n+500))]);contributions.clear();
  }
  for(const row of affected.values()){
   await client.query(`DELETE FROM ${schema}.aggregate_records WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope=$4 AND identity=$5`,[...id,row.scope,row.identity]);
   const facts=await client.query<{payload:Record<string,unknown>;block_hash:Hash}>(`SELECT payload,block_hash FROM ${schema}.history_contributions WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope=$4 AND identity=$5 ORDER BY block_number DESC ${row.scope==='meme-fee-burn'?'':'LIMIT 1'}`,[...id,row.scope,row.identity]);
   if(!facts.rows.length){if(row.scope==='meme-fee-burn'&&byId.has(row.identity as Hash)){const m=byId.get(row.identity as Hash)!;await saveAggregate(client,schema,input.deployment,row.scope,row.identity,anchorHash,{marketId:m.marketId,token:m.memeToken,enabled:m.burnMemeFees===true,creatorRaw:'0',stakerRaw:'0',holderRaw:'0',totalRaw:'0'});}continue;}
   const payload={...facts.rows[0]!.payload};
   if(row.scope==='meme-fee-burn')for(const name of ['creatorRaw','stakerRaw','holderRaw','totalRaw'])payload[name]=facts.rows.reduce((sum,f)=>sum+BigInt(String(f.payload[name])),0n).toString();
   await saveAggregate(client,schema,input.deployment,row.scope,row.identity,facts.rows[0]!.block_hash,payload);
  }
  await client.query(`INSERT INTO ${schema}.projection_checkpoints(environment,chain_id,deployment_digest,scope,algorithm_version,next_block,generation,last_revision) VALUES($1,$2,$3,'history','history-incremental-v2',$4,$5,$6) ON CONFLICT(environment,chain_id,deployment_digest,scope) DO UPDATE SET algorithm_version=excluded.algorithm_version,next_block=excluded.next_block,generation=excluded.generation,last_revision=excluded.last_revision,updated_at=now()`,[...id,(through+1n).toString(),input.generation.toString(),`${through}:${anchorHash}`]);
  return {rewards,activities,aggregates,through};
 });
 if('through' in result&&result.through!<input.blockNumber)throw new ProjectionPending('history',input.blockNumber,Number(result.through!-input.deployment.activationBlock+1n));
 return {rewards:result.rewards,activities:result.activities,aggregates:result.aggregates};
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
    requiredMarket(byId, marketId); const accounts = result.get(marketId)??new Set<Address>();result.set(marketId,accounts);for (const value of values) accounts.add(address(value));
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
