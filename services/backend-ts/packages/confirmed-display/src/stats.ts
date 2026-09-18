import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {formatUnits,parseUnits,toEventSelector} from 'viem';
import {deserializeRpcLog,type DeploymentIdentity,type RpcBlock} from '../../chain/src/index.ts';
import {decodeF72Event,fixedF72Sources} from '../../events/src/index.ts';
import {normalizeTransaction,type EventObservation,type TradeActivity} from '../../analytics/src/index.ts';
import {feeCredits,validateMarket} from '../../analytics-projector/src/index.ts';
import {latestPrices,preferredPrices} from '../../display-price/src/read.ts';
import {runtimeConfigs} from '../../runtime-deployment/src/index.ts';
import {PublicationUnavailableError} from '../../read-store/src/index.ts';
import {changeChannel} from './changes.ts';
import type {DisplayState} from './state.ts';

type DB=Pool|PoolClient;
export type StatsRegion='overview'|'allocations'|'stocks';
export const statsRegions:StatsRegion[]=['overview','allocations','stocks'];
type Config={kind:string;id:string;values:Record<string,unknown>};
type Flow={key:string;block:string;at:number;kind:string;asset:string;recipient:string;amount:string};
export type StatsUndo=Record<string,string|null>;
export interface StatsDisplay {
 schemaVersion:4;chainId:number;displayOnly:true;revision:string;
 sections:{overview:{volumeUsd:string|null;feeRevenueUsd:string|null;launches24h:number|null;bloomedMarkets:number;stakingValueUsd:string|null;stakingWallets:number};allocations:Record<'creator'|'staker'|'holder'|'platform',string|null>;stocks:Array<{id:string;token:string;label:string;name?:string;decimals:number;amountRaw:string;valueUsd:string|null}>};
}
const id=(d:DeploymentIdentity)=>[d.environment,d.chainId,d.deploymentDigest];
const schema=(name='tickergarden_serverless')=>{if(!/^[a-z][a-z0-9_]{0,62}$/.test(name))throw Error('Invalid schema');return `"${name}"`;};
const vault=()=>fixedF72Sources().find(s=>s.module==='UserStockVault')!.address;
const allocationTopics=['AllocationLocked(bytes32,address,bytes32,uint256,uint256,uint256)','AllocationReleased(bytes32,address,bytes32,uint256,uint256,uint256)'].map(toEventSelector);
export function tradeFlows(t:TradeActivity):Flow[]{
 const common={key:t.source.eventKey,block:t.source.blockNumber,at:Number(t.timestamp),recipient:''};
 return [...(t.classification==='unclassified'?[{...common,kind:'volume',asset:t.quoteAsset,amount:t.quoteRaw}]:[]),
  t.feeRaw===null||t.feeAsset===null?{...common,kind:'unknown',asset:t.quoteAsset,amount:'1'}:{...common,kind:'fee',asset:t.feeAsset,amount:(BigInt(t.feeRaw)+BigInt(t.taxRaw??'0')).toString()}];
}
async function insertFlows(db:DB,s:string,d:DeploymentIdentity,rows:Flow[]){
 if(!rows.length)return;
 await db.query(`INSERT INTO ${s}.stats_display_flows SELECT $1,$2,$3,x.key,x.block::bigint,x.at,x.kind,x.asset,x.recipient,x.amount::numeric FROM jsonb_to_recordset($4::jsonb) AS x(key text,block text,at bigint,kind text,asset text,recipient text,amount text) ON CONFLICT DO NOTHING`,[...id(d),JSON.stringify(rows)]);
}
async function position(db:DB,s:string,d:DeploymentIdentity,asset:string,account:string,amount:string){
 await db.query(`INSERT INTO ${s}.stats_display_positions VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(environment,chain_id,deployment_digest,asset_uid,account) DO UPDATE SET amount=excluded.amount`,[...id(d),asset,account,amount]);
}
/** Same receipt- and block-verified batch as the market display; no additional RPC. */
export async function applyStatsEvents(db:DB,d:DeploymentIdentity,observations:readonly EventObservation[],states:DisplayState[],schemaName?:string):Promise<StatsUndo>{
 const s=schema(schemaName),flows:Flow[]=[],undo:StatsUndo={};
 const groups=new Map<string,EventObservation[]>();
 for(const o of observations){const key=o.event.log.transactionHash;const list=groups.get(key)??[];list.push(o);groups.set(key,list);}
 const bindings=states.map(state=>validateMarket(state.market,d.chainId).binding);
 for(const group of groups.values())for(const t of normalizeTransaction(group,bindings))flows.push(...tradeFlows(t));
 for(const o of observations){
  for(const f of feeCredits(o.event))flows.push({key:`${f.blockHash}:${f.transactionHash}:${f.logIndex}`,block:o.event.log.blockNumber.toString(),at:Number(o.timestamp),kind:'allocation',asset:f.asset,recipient:f.recipient==='stakers'?'staker':f.recipient==='holders'?'holder':f.recipient,amount:f.amountRaw.toString()});
  if(o.event.module==='UserStockVault'&&o.event.log.address===vault()&&allocationTopics.includes(o.event.log.topics[0]!)){
   const asset=String(o.event.args.assetUid).toLowerCase(),account=String(o.event.args.user).toLowerCase(),key=`${asset}:${account}`;
   if(!(key in undo))undo[key]=(await db.query<{amount:string}>(`SELECT amount::text FROM ${s}.stats_display_positions WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND asset_uid=$4 AND account=$5`,[...id(d),asset,account])).rows[0]?.amount??null;
   await position(db,s,d,asset,account,String(o.event.args.userTotalAllocated));
  }
 }
 await insertFlows(db,s,d,flows);return undo;
}
export async function undoStatsEvents(db:DB,d:DeploymentIdentity,previousBlock:string,undo:StatsUndo,schemaName?:string){
 const s=schema(schemaName);
 await db.query(`DELETE FROM ${s}.stats_display_flows WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND block_number>$4`,[...id(d),previousBlock]);
 for(const [key,amount]of Object.entries(undo)){const [asset,account]=key.split(':') as [string,string];if(amount===null)await db.query(`DELETE FROM ${s}.stats_display_positions WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND asset_uid=$4 AND account=$5`,[...id(d),asset,account]);else await position(db,s,d,asset,account,amount);}
}
/** One-time/rebase seed from canonical stored history, never an HTTP side effect. */
export async function seedStats(db:DB,d:DeploymentIdentity,block:RpcBlock,schemaName?:string){
 const s=schema(schemaName),args=id(d),from=Number(block.timestamp)-2*86400;
 await db.query(`DELETE FROM ${s}.stats_display_markets WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3`,args);
 await db.query(`INSERT INTO ${s}.stats_display_markets(environment,chain_id,deployment_digest,market_id,payload) SELECT environment,chain_id,deployment_digest,market_id,jsonb_build_object('createdAt',payload->'market'->'identity'->'deployedAt','phase',payload->'market'->'launchPhase','token',payload->'market'->'memeToken','quote',payload->'market'->'quoteAsset','price',payload->'market'->'display'->'priceQuote') FROM ${s}.confirmed_display_markets WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3`,args);
 for(const table of ['stats_display_flows','stats_display_buckets','stats_display_positions'])await db.query(`DELETE FROM ${s}.${table} WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3`,args);
 // Cursor pagination bounds memory even for a very busy launch day.
 let cursor='';
 while(true){
  const rows=(await db.query<{key:string;payload:TradeActivity}>(`SELECT t.block_hash||':'||t.transaction_hash||':'||lpad(t.log_index::text,20,'0') key,t.payload FROM ${s}.market_trades t JOIN ${s}.chain_blocks b ON b.environment=t.environment AND b.chain_id=t.chain_id AND b.deployment_digest=t.deployment_digest AND b.hash=t.block_hash WHERE t.environment=$1 AND t.chain_id=$2 AND t.deployment_digest=$3 AND b.canonical AND b.finalized AND b.number<=$4 AND t.occurred_at>=to_timestamp($5) AND t.block_hash||':'||t.transaction_hash||':'||lpad(t.log_index::text,20,'0')>$6 ORDER BY key LIMIT 1000`,[...args,block.number.toString(),from,cursor])).rows;
  await insertFlows(db,s,d,rows.flatMap(r=>tradeFlows(r.payload)));if(rows.length<1000)break;cursor=rows.at(-1)!.key;
 }
 await db.query(`INSERT INTO ${s}.stats_display_flows SELECT f.environment,f.chain_id,f.deployment_digest,f.block_hash||':'||f.transaction_hash||':'||f.log_index,b.number,extract(epoch FROM b.source_timestamp)::bigint,'allocation',f.asset,CASE f.recipient WHEN 'stakers' THEN 'staker' WHEN 'holders' THEN 'holder' ELSE f.recipient END,f.amount_raw FROM ${s}.detail_fee_events f JOIN ${s}.chain_blocks b ON b.environment=f.environment AND b.chain_id=f.chain_id AND b.deployment_digest=f.deployment_digest AND b.hash=f.block_hash WHERE f.environment=$1 AND f.chain_id=$2 AND f.deployment_digest=$3 AND b.canonical AND b.finalized AND b.number<=$4 AND b.source_timestamp>=to_timestamp($5) ON CONFLICT DO NOTHING`,[...args,block.number.toString(),from]);
 // Last per-asset/account absolute checkpoint, not a replay of every allocation.
 cursor='';
 while(true){
  const rows=(await db.query<{key:string;payload:Record<string,unknown>}>(`SELECT DISTINCT ON (l.payload->'topics'->>1,l.payload->'topics'->>2) (l.payload->'topics'->>1)||':'||(l.payload->'topics'->>2) key,l.payload FROM ${s}.chain_logs l JOIN ${s}.chain_blocks b ON b.environment=l.environment AND b.chain_id=l.chain_id AND b.deployment_digest=l.deployment_digest AND b.hash=l.block_hash WHERE l.environment=$1 AND l.chain_id=$2 AND l.deployment_digest=$3 AND l.address=$4 AND l.topic0=ANY($5::text[]) AND l.canonical AND b.canonical AND b.finalized AND b.number<=$6 AND (l.payload->'topics'->>1)||':'||(l.payload->'topics'->>2)>$7 ORDER BY l.payload->'topics'->>1,l.payload->'topics'->>2,b.number DESC,l.transaction_index DESC,l.log_index DESC LIMIT 1000`,[...args,vault(),allocationTopics,block.number.toString(),cursor])).rows;
  for(const row of rows){const event=decodeF72Event('UserStockVault',deserializeRpcLog(row.payload));if(!event)throw Error('Stats allocation decode failed');await position(db,s,d,String(event.args.assetUid).toLowerCase(),String(event.args.user).toLowerCase(),String(event.args.userTotalAllocated));}
  if(rows.length<1000)break;cursor=rows.at(-1)!.key;
 }
}

async function configs(db:DB,s:string,d:DeploymentIdentity):Promise<Config[]>{
 const stored=(await db.query<{payload:Config}>(`SELECT r.payload FROM ${s}.projection_read_records r JOIN ${s}.publication_pointers p USING(environment,chain_id,deployment_digest,scope,revision) WHERE r.environment=$1 AND r.chain_id=$2 AND r.deployment_digest=$3 AND r.scope='configs'`,id(d))).rows.map(r=>r.payload);
 return [...new Map([...runtimeConfigs,...stored].map(c=>[`${c.kind}:${c.id}`,c as Config])).values()];
}
const scale=10n**36n;
export function usdAmount(raw:string,decimals:number|undefined,price:string|undefined):bigint|null{
 if(raw==='0')return 0n;
 if(decimals===undefined||!Number.isSafeInteger(decimals)||decimals<0||decimals>255||price===undefined)return null;
 return BigInt(raw)*parseUnits(price,36)/10n**BigInt(decimals);
}
/** Builds only from narrow contribution/bucket tables and the shared price table. */
export async function publishStatsDisplay(db:DB,d:DeploymentIdentity,block:RpcBlock,schemaName?:string,now=new Date()):Promise<StatsRegion[]>{
 const s=schema(schemaName),args=id(d),to=Number(block.timestamp),from=Math.max(0,to-86400),low=Math.ceil(from/60)*60,high=Math.floor(to/60)*60;
 const catalog=await configs(db,s,d),priceRows=await latestPrices(db,d,now,schemaName);
 const counts=await db.query<{bloomed:string;invalid_dates:string;launches:string}>(`SELECT coalesce(c.bloomed,0)::text bloomed,coalesce(c.invalid_dates,0)::text invalid_dates,(SELECT count(*) FROM ${s}.stats_display_markets WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND created_at>=$4 AND created_at<=$5)::text launches FROM (SELECT 1) x LEFT JOIN ${s}.stats_display_counts c ON c.environment=$1 AND c.chain_id=$2 AND c.deployment_digest=$3`,[...args,from,to]);
 // Whole minute buckets + two boundary fragments retain exact [from,to] semantics.
 const flowRows=await db.query<{kind:string;asset:string;recipient:string;amount:string}>(`SELECT kind,asset,recipient,sum(amount)::text amount FROM (
    SELECT kind,asset,recipient,amount FROM ${s}.stats_display_buckets WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND minute>=$4 AND minute<$5
    UNION ALL SELECT kind,asset,recipient,amount FROM ${s}.stats_display_flows WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND occurred_at>=$6 AND occurred_at<=$7 AND (occurred_at<$4 OR occurred_at>=$5)
   ) f GROUP BY kind,asset,recipient`,[...args,low,high,from,to]);
 const positions=await db.query<{asset_uid:string|null;amount:string;wallets:string}>(`SELECT asset_uid,amount::text,'0' wallets FROM ${s}.stats_display_stock_totals WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 UNION ALL SELECT NULL,'0',count(*)::text FROM ${s}.stats_display_wallet_refs WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND refs>0`,args);
 const prices=new Map<string,string>();for(const [asset,p]of preferredPrices(priceRows,now))if(p.status==='available'&&p.bidUsd&&p.askUsd)prices.set(asset,formatUnits((parseUnits(p.bidUsd,36)+parseUnits(p.askUsd,36))/2n,36));
 const decimals=new Map<string,number>();
 for(const c of catalog){const v=c.values;if(c.kind==='quote'){const token=String(v.quoteAsset).toLowerCase();decimals.set(token,Number(v.quoteDecimals));if(v.symbol==='USDG')prices.set(token,'1');}if(c.kind==='asset')decimals.set(String(v.stockToken).toLowerCase(),Number(v.tokenDecimals));}
 const markets=await db.query<{payload:{token:string;quote:string;price:string|null}}>(`SELECT payload FROM ${s}.stats_display_markets WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND token=ANY($4::text[])`,[...args,[...new Set(flowRows.rows.map(r=>r.asset))]]);
 for(const {payload:m}of markets.rows){decimals.set(m.token,18);const q=prices.get(m.quote);if(q&&m.price)prices.set(m.token,formatUnits(parseUnits(q,36)*parseUnits(m.price,36)/scale,36));}
 const total=(kind:string,recipient=''):string|null=>{
  let sum=0n;for(const row of flowRows.rows.filter(r=>r.kind===kind&&r.recipient===recipient)){const v=usdAmount(row.amount,decimals.get(row.asset),prices.get(row.asset));if(v===null)return null;sum+=v;}return formatUnits(sum,36);
 };
 const amounts=new Map(positions.rows.filter(p=>p.asset_uid!==null).map(p=>[p.asset_uid!,p.amount]));
 const stocks:StatsDisplay['sections']['stocks']=catalog.filter(c=>c.kind==='asset').map(c=>{const token=String(c.values.stockToken).toLowerCase(),amountRaw=amounts.get(c.id)??'0',decimals=Number(c.values.tokenDecimals),value=usdAmount(amountRaw,decimals,prices.get(token));amounts.delete(c.id);return {id:c.id,token,label:String(c.values.tokenSymbol??token),decimals,amountRaw,valueUsd:value===null?null:formatUnits(value,36)};});
 // Do not silently omit allocated assets missing from the published catalog.
 for(const [asset,amount]of amounts)if(BigInt(amount)>0n)stocks.push({id:asset,token:'0x'+'0'.repeat(40),label:asset,decimals:0,amountRaw:amount,valueUsd:null});
 stocks.sort((a,b)=>a.id.localeCompare(b.id));
 const stockTotal=stocks.some(s=>s.valueUsd===null)?null:formatUnits(stocks.reduce((n,s)=>n+parseUnits(s.valueUsd!,36),0n),36);
 const sections:StatsDisplay['sections']={overview:{volumeUsd:total('volume'),feeRevenueUsd:flowRows.rows.some(r=>r.kind==='unknown'&&BigInt(r.amount)>0n)?null:total('fee'),launches24h:counts.rows[0]?.invalid_dates==='0'?Number(counts.rows[0].launches):null,bloomedMarkets:Number(counts.rows[0]?.bloomed??0),stakingValueUsd:stockTotal,stakingWallets:Number(positions.rows.find(p=>p.asset_uid===null)?.wallets??0)},allocations:{creator:total('allocation','creator'),staker:total('allocation','staker'),holder:total('allocation','holder'),platform:total('allocation','platform')},stocks};
 const revision=createHash('sha256').update(JSON.stringify(sections)).digest('hex');
 const old=(await db.query<{payload:StatsDisplay}>(`SELECT payload FROM ${s}.stats_display_snapshots WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3`,args)).rows[0]?.payload;
 const changed=statsRegions.filter(r=>!isDeepStrictEqual(old?.sections[r],sections[r]));
 const payload:StatsDisplay={schemaVersion:4,chainId:d.chainId,displayOnly:true,revision,sections};
 await db.query(`INSERT INTO ${s}.stats_display_snapshots VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(environment,chain_id,deployment_digest) DO UPDATE SET block_number=excluded.block_number,block_hash=excluded.block_hash,generated_at=excluded.generated_at,payload=excluded.payload`,[...args,block.number.toString(),block.hash,now,JSON.stringify(payload)]);
 if(changed.length)await db.query('SELECT pg_notify($1,$2)',[changeChannel(d,schemaName),JSON.stringify({statsRegions:changed,revision})]);
 return changed;
}
/** One primary-key database read. No freshness rejection, RPC or on-demand calculation. */
export async function readStatsDisplay(input:{pool:DB;deployment:DeploymentIdentity;schemaName?:string},section?:string){
 if(section!==undefined&&!statsRegions.includes(section as StatsRegion))throw Error('invalid stats section');
 const s=schema(input.schemaName);
 const row=(await input.pool.query<{payload:StatsDisplay}>(`SELECT CASE WHEN $4::text IS NULL THEN payload ELSE jsonb_set(payload,'{sections}',jsonb_build_object($4::text,payload->'sections'->$4::text)) END payload FROM ${s}.stats_display_snapshots WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3`,[...id(input.deployment),section??null])).rows[0];
 if(!row)throw new PublicationUnavailableError('Stats display pending');return row.payload;
}
