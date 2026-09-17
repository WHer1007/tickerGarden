import { latestPrices, preferredPrices } from '../../display-price/src/read.ts';
import type { Pool, PoolClient } from 'pg';
import type { DeploymentIdentity } from '../../chain/src/index.ts';
import {runtimeConfigs as f72BootstrapConfigs} from '../../runtime-deployment/src/index.ts';
import { f72EventCatalog } from '../../events/src/index.ts';
import { f72PriceTargets, type PriceReference } from '../../display-price/src/index.ts';
import type { Address, TradeActivity } from '../../analytics/src/index.ts';
import { PublicationUnavailableError } from '../../read-store/src/index.ts';

type Hex32 = `0x${string}`;
interface Market { readonly marketId: Hex32; readonly assetUid: Hex32; readonly memeToken: Address; readonly quoteAsset: Address;
  readonly quoteAssetConfigId: Hex32; readonly tickerGardenBaselineId: Hex32; readonly sourceVersion: number; readonly launchPhase: 0 | 1; readonly display?: {priceQuote: string | null; totalSupplyRaw: string; asOfTimestamp: string; blockNumber: string; blockHash: Hex32} }

export async function readDisplayPrices(input: { readonly pool: Pool; readonly deployment: DeploymentIdentity; readonly now?: Date; readonly schemaName?: string }) {
  const targets = f72PriceTargets(); const now = input.now ?? new Date(); const rows = await latestPrices(input.pool, input.deployment, now, input.schemaName);
  const byToken = preferredPrices(rows, now);
  const native = byToken.get('0x0000000000000000000000000000000000000000');
  const usdgConfig = input.deployment.chainId === 4663 ? f72BootstrapConfigs.find(config => config.kind === 'quote' && config.values.symbol === 'USDG') : undefined;
  const usdgTarget = usdgConfig ? { chainId: 4663 as const, token: String(usdgConfig.values.quoteAsset).toLowerCase() as `0x${string}`, assetUid: usdgConfig.id, symbol: 'USDG' } : undefined;
  const usdg = usdgTarget ? byToken.get(usdgTarget.token) ?? { ...usdgTarget, source: 'fixed_usd' as const, unit: 'USD_PER_WHOLE_TOKEN' as const,
    status: 'unavailable' as const, reason: 'not_refreshed', bidUsd: null, askUsd: null, multiplier: null, asOf: null, expiresAt: null, retrievedAt: now.toISOString() } : undefined;
  return { chainId: input.deployment.chainId, displayOnly: true as const, confidence: 'provider_reported' as const, status: 'configured' as const,
    references: [...(native ? [native] : []), ...(usdg ? [usdg] : []), ...targets.filter(target => target.token !== usdgTarget?.token && target.token !== native?.token).map((target) => byToken.get(target.token) ?? { ...target, source: 'robinhood_rest' as const, unit: 'USD_PER_WHOLE_TOKEN' as const,
      status: 'unavailable' as const, reason: 'not_refreshed', bidUsd: null, askUsd: null, multiplier: null, asOf: null, expiresAt: null, retrievedAt: now.toISOString() })] };
}

export async function readStatisticsPrices(input: { readonly pool: Pool; readonly deployment: DeploymentIdentity; readonly now?: Date; readonly schemaName?: string }) {
  const references = (await readDisplayPrices(input)).references; const prices: Record<string,string> = {}; const expiresAt: Record<string,number> = {};
  for (const item of references) if (item.status === 'available' && item.bidUsd && item.askUsd && item.expiresAt) {
    prices[item.token] = midpoint(item.bidUsd, item.askUsd); expiresAt[item.token] = Math.floor(new Date(item.expiresAt).getTime()/1_000);
  }
  return { chainId: input.deployment.chainId, displayOnly: true as const, basis: 'PROVIDER_REPORTED_USD' as const, prices, expiresAt };
}

export async function readMarketStatistics(input: { readonly pool: Pool; readonly deployment: DeploymentIdentity; readonly marketIds: readonly Hex32[]; readonly now?: Date; readonly schemaName?: string }) {
  if(!Array.isArray(input.marketIds)||input.marketIds.length<1||input.marketIds.length>100||new Set(input.marketIds).size!==input.marketIds.length||input.marketIds.some(id=>!/^0x[0-9a-f]{64}$/.test(id)))throw Error('invalid market statistics batch');
  const schema=identifier(input.schemaName??'tickergarden_serverless'); const point=await checkpoint(input.pool,schema,input.deployment);
  const priceNow=input.now??new Date();const [markets,priceRows,volumeCovered]=await Promise.all([
    currentMarkets(input.pool,schema,input.deployment,point.revision,input.marketIds),
    latestPrices(input.pool,input.deployment,priceNow,input.schemaName),
    assertCoverage(input.pool,schema,input.deployment,point.number,point.asOf-86_400,point.asOf).then(()=>true).catch(error=>{if(error instanceof PublicationUnavailableError)return false;throw error}),
  ]);const prices=preferredPrices(priceRows,priceNow);
  const now=point.asOf; const from=now-86_400; const items: Record<string,unknown>={};
  const marketIds=markets.map(market=>market.marketId);
  const [lastTrades,lastBuys,volumes,supplies]=await Promise.all([
    input.pool.query<{market_id:Hex32;payload:TradeActivity}>(`SELECT DISTINCT ON (t.market_id) t.market_id,jsonb_build_object('side',t.payload->'side','price',t.payload->'price','source',t.payload->'source','timestamp',t.payload->'timestamp') payload FROM ${schema}.market_trades t JOIN ${schema}.chain_blocks b ON b.environment=t.environment AND b.chain_id=t.chain_id AND b.deployment_digest=t.deployment_digest AND b.hash=t.block_hash WHERE t.environment=$1 AND t.chain_id=$2 AND t.deployment_digest=$3 AND t.market_id=ANY($4::text[]) AND b.canonical AND b.finalized AND t.occurred_at>=to_timestamp($5) AND t.occurred_at<to_timestamp($6) ORDER BY t.market_id,b.number DESC,(t.payload->'source'->>'transactionIndex')::bigint DESC,t.log_index DESC`,[...identity(input.deployment),marketIds,from,now]),
    input.pool.query<{market_id:Hex32;payload:TradeActivity}>(`SELECT DISTINCT ON (t.market_id) t.market_id,jsonb_build_object('side',t.payload->'side','price',t.payload->'price','source',t.payload->'source','timestamp',t.payload->'timestamp') payload FROM ${schema}.market_trades t JOIN ${schema}.chain_blocks b ON b.environment=t.environment AND b.chain_id=t.chain_id AND b.deployment_digest=t.deployment_digest AND b.hash=t.block_hash WHERE t.environment=$1 AND t.chain_id=$2 AND t.deployment_digest=$3 AND t.market_id=ANY($4::text[]) AND (t.payload->>'side')='buy' AND b.canonical AND b.finalized ORDER BY t.market_id,b.number DESC,(t.payload->'source'->>'transactionIndex')::bigint DESC,t.log_index DESC`,[...identity(input.deployment),marketIds]),
    volumeCovered?input.pool.query<{market_id:Hex32;raw:string|null}>(`SELECT t.market_id,sum(t.quote_raw)::text raw FROM ${schema}.market_trades t JOIN ${schema}.chain_blocks b ON b.environment=t.environment AND b.chain_id=t.chain_id AND b.deployment_digest=t.deployment_digest AND b.hash=t.block_hash WHERE t.environment=$1 AND t.chain_id=$2 AND t.deployment_digest=$3 AND t.market_id=ANY($4::text[]) AND t.classification='unclassified' AND b.canonical AND b.finalized AND t.occurred_at>=to_timestamp($5) AND t.occurred_at<to_timestamp($6) GROUP BY t.market_id`,[...identity(input.deployment),marketIds,from,now]):Promise.resolve(null),
    input.pool.query<{market_id:Hex32;total_supply_raw:string}>(`SELECT market_id,total_supply_raw::text FROM ${schema}.holder_snapshots_covered WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=ANY($4::text[]) AND block_number=$5 AND block_hash=$6`,[...identity(input.deployment),marketIds,point.number,point.hash]),
  ]);
  const supplyByMarket=new Map(supplies.rows.map(row=>[row.market_id,row.total_supply_raw]));
  const lastTradeByMarket=new Map(lastTrades.rows.map(row=>[row.market_id,row.payload])),lastBuyByMarket=new Map(lastBuys.rows.map(row=>[row.market_id,row.payload])),volumeByMarket=new Map(volumes?.rows.map(row=>[row.market_id,row.raw])??[]);
  for(const market of markets){
    const last=lastTradeByMarket.get(market.marketId); const buy=last?.side==='buy'?last:lastBuyByMarket.get(market.marketId);const lastBuy=buy?sourcePosition(buy):null;
    const decimals=quoteDecimals(market.quoteAssetConfigId); const volumeRaw=volumeByMarket.get(market.marketId)??(volumeCovered?'0':null);
    let metrics: Record<string,unknown> | null=null; const quoteReference=prices.get(market.quoteAsset);const quoteUsd=quoteReference?.bidUsd&&quoteReference.askUsd?midpoint(quoteReference.bidUsd,quoteReference.askUsd):null;
    if(quoteUsd&&quoteReference){
      const observed=market.display&&BigInt(market.display.blockNumber)<=BigInt(point.number)?market.display:undefined;
      const price=observed?.priceQuote??(last?decimalFromRational(last.price.numerator,last.price.denominator):null); const supply=observed?.totalSupplyRaw??supplyByMarket.get(market.marketId);
      const cap=price&&supply!==undefined?decimalProductRaw(supply,18,decimalProduct(price,quoteUsd)):null;
      metrics={status:cap?'available':'unavailable',reason:cap?'historical_usd_coverage_unavailable':supply===undefined?'total_supply_unavailable':'execution_price_unavailable',volume24hUsd:null,marketCapUsd:cap,quoteUsdMidpoint:quoteUsd,
        windowFromTimestamp:String(from),asOfTimestamp:String(now),usdPriceAsOf:quoteReference.asOf,usdPriceSource:quoteReference.source,
        volumeBasis:'EXTERNAL_EXECUTIONS_CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE',marketCapBasis:observed?.priceQuote?'TOTAL_SUPPLY_X_FINALIZED_SPOT_X_QUOTE_USD':'FINALIZED_TOTAL_SUPPLY_X_LATEST_FINALIZED_24H_EXECUTION_PRICE'};
    }
    items[market.marketId]={marketId:market.marketId,memeToken:market.memeToken,quoteAsset:market.quoteAsset,sourceVersion:market.sourceVersion,sourceBlockNumber:point.number,sourceBlockHash:point.hash,metrics,lastBuy,observedAt:point.asOf,launchPhase:String(market.launchPhase),
      volumeObservedAt:point.asOf,volume24hQuote:volumeRaw===null?null:decimalFromRaw(volumeRaw,decimals)};
  }
  return {chainId:input.deployment.chainId,registry:f72EventCatalog.MarketRegistryV1.address,displayOnly:true as const,items};
}

export async function readMarketDisplayStatistics(input:{readonly pool:Pool;readonly deployment:DeploymentIdentity;readonly marketId:Hex32;readonly schemaName?:string}){
  const schema=identifier(input.schemaName??'tickergarden_serverless');const point=await checkpoint(input.pool,schema,input.deployment);
  const market=(await currentMarkets(input.pool,schema,input.deployment,point.revision,[input.marketId]))[0];if(!market)throw new PublicationUnavailableError('market is unavailable');
  const fees=await input.pool.query<{recipient:string;asset:Address;amount_raw:string}>(`SELECT recipient,asset,amount_raw::text FROM ${schema}.detail_fee_totals WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4 ORDER BY recipient,asset`,[...identity(input.deployment),input.marketId]);
  const volume=await input.pool.query<{raw:string|null}>(`SELECT sum(quote_raw)::text raw FROM ${schema}.market_trades t JOIN ${schema}.chain_blocks b ON b.environment=t.environment AND b.chain_id=t.chain_id AND b.deployment_digest=t.deployment_digest AND b.hash=t.block_hash WHERE t.environment=$1 AND t.chain_id=$2 AND t.deployment_digest=$3 AND t.market_id=$4 AND t.classification='unclassified' AND b.canonical AND b.finalized AND t.occurred_at>=to_timestamp($5) AND t.occurred_at<to_timestamp($6)`,[...identity(input.deployment),input.marketId,point.asOf-86400,point.asOf]);
  return {schemaVersion:2,chainId:input.deployment.chainId,displayOnly:true as const,marketId:input.marketId,observedAt:point.asOf,feeCoverage:true,volumeRaw:volume.rows[0]?.raw??'0',volumeAt:point.asOf,
    feeDistribution:fees.rows.map(row=>({recipient:row.recipient,asset:row.asset,amountRaw:row.amount_raw}))};
}

export async function readGlobalHolders(input:{readonly pool:Pool;readonly deployment:DeploymentIdentity;readonly schemaName?:string}){
  const schema=identifier(input.schemaName??'tickergarden_serverless');const point=await checkpoint(input.pool,schema,input.deployment);
  const args=[...identity(input.deployment),point.revision,point.number,point.hash];
  const m=`SELECT identity market_id,payload->>'assetUid' asset_uid FROM ${schema}.projection_read_records WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='markets' AND revision=$4`;
  const snapshots=`SELECT market_id,excluded_accounts FROM ${schema}.holder_snapshots_covered WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND block_number=$5 AND block_hash=$6`;
  const valid=(await input.pool.query<{valid:boolean}>(`WITH m AS MATERIALIZED (${m}),s AS MATERIALIZED (${snapshots}) SELECT NOT EXISTS((SELECT market_id FROM m EXCEPT SELECT market_id FROM s) UNION ALL (SELECT market_id FROM s EXCEPT SELECT market_id FROM m)) AND NOT EXISTS(SELECT market_id FROM ${schema}.holder_market_counts WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 EXCEPT SELECT market_id FROM m) AND NOT EXISTS(SELECT 1 FROM m LEFT JOIN ${schema}.holder_market_assets a ON a.environment=$1 AND a.chain_id=$2 AND a.deployment_digest=$3 AND a.market_id=m.market_id WHERE a.asset_uid IS DISTINCT FROM m.asset_uid) valid`,args)).rows[0];
  if(!valid?.valid)throw new PublicationUnavailableError('global holder snapshot is incomplete');
  const excluded=(await input.pool.query<{account:Address}>(`SELECT account FROM ${schema}.holder_exclusion_refs WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND refs>0 ORDER BY account`,args.slice(0,3))).rows.map(row=>row.account);
  const rows=(await input.pool.query<{asset_uid:Hex32|null;market_count:string;pairs:string;positive:string;included:string}>(`WITH m AS MATERIALIZED (${m}),counts AS (SELECT asset_uid,count(*)::text market_count FROM m GROUP BY GROUPING SETS((asset_uid),())),refs AS (
 SELECT nullif(r.asset_uid,'') asset_uid,sum(r.refs)::text pairs,count(*)::text positive,count(*) FILTER(WHERE e.account IS NULL)::text included
 FROM ${schema}.holder_account_refs r LEFT JOIN ${schema}.holder_exclusion_refs e ON e.environment=r.environment AND e.chain_id=r.chain_id AND e.deployment_digest=r.deployment_digest AND e.account=r.account AND e.refs>0
 WHERE r.environment=$1 AND r.chain_id=$2 AND r.deployment_digest=$3 AND r.refs>0 GROUP BY r.asset_uid)
 SELECT c.asset_uid,c.market_count,coalesce(r.pairs,'0') pairs,coalesce(r.positive,'0') positive,coalesce(r.included,'0') included FROM counts c LEFT JOIN refs r ON r.asset_uid IS NOT DISTINCT FROM c.asset_uid ORDER BY c.asset_uid NULLS FIRST`,args.slice(0,4))).rows;
  const total=rows.find(row=>row.asset_uid===null)!;
  return{chainId:input.deployment.chainId,displayOnly:true as const,finality:'finalized' as const,sourceBlockNumber:point.number,sourceBlockHash:point.hash,marketCount:Number(total.market_count),positiveMarketAddressPairs:Number(total.pairs),positiveAddressCount:Number(total.positive),includedAddressCount:Number(total.included),exclusionPolicy:'UNION_OF_KNOWN_PROTOCOL_ADDRESSES_V1' as const,excludedAccounts:excluded,groups:rows.filter(row=>row.asset_uid!==null).map(row=>({assetUid:row.asset_uid!,binding:'registered_stock' as const,marketCount:Number(row.market_count),positiveMarketAddressPairs:Number(row.pairs),positiveAddressCount:Number(row.positive),includedAddressCount:Number(row.included)}))};

}

export async function readGlobalStatistics(input:{readonly pool:Pool;readonly deployment:DeploymentIdentity;readonly from:number;readonly to:number;readonly schemaName?:string}){
  return globalFlow(input,false);
}

/** Scheduled builder: raw amounts only; USD conversion belongs to display prices. */
export async function buildProtocolStatistics(input:{readonly pool:Pool;readonly deployment:DeploymentIdentity;readonly schemaName?:string}){
 const schema=identifier(input.schemaName??'tickergarden_serverless'),point=await checkpoint(input.pool,schema,input.deployment),from=Math.max(0,point.asOf-86400),id=identity(input.deployment);
 const flow=await rollupFlow({...input,from,to:point.asOf},0);
 const [counts,allocations,position]=await Promise.all([
  input.pool.query<{total:string;bloomed:string;launches:string;invalid:string}>(`SELECT count(*)::text total,count(*) FILTER(WHERE payload->>'launchPhase'='1')::text bloomed,count(*) FILTER(WHERE CASE WHEN (payload->'identity'->>'deployedAt') ~ '^[0-9]+$' THEN (payload->'identity'->>'deployedAt')::numeric >= $5 AND (payload->'identity'->>'deployedAt')::numeric < $6 ELSE false END)::text launches,count(*) FILTER(WHERE coalesce(payload->'identity'->>'deployedAt','') !~ '^[0-9]+$')::text invalid FROM ${schema}.projection_read_records WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='markets' AND revision=$4`,[...id,point.revision,from,point.asOf]),
  input.pool.query<{recipient:string;asset:Address;amount_raw:string}>(`SELECT f.recipient,f.asset,sum(f.amount_raw)::text amount_raw FROM ${schema}.detail_fee_events f JOIN ${schema}.chain_blocks b ON b.environment=f.environment AND b.chain_id=f.chain_id AND b.deployment_digest=f.deployment_digest AND b.hash=f.block_hash WHERE f.environment=$1 AND f.chain_id=$2 AND f.deployment_digest=$3 AND b.canonical AND b.finalized AND b.source_timestamp>=to_timestamp($4) AND b.source_timestamp<to_timestamp($5) GROUP BY f.recipient,f.asset ORDER BY f.asset,f.recipient`,[...id,from,point.asOf]),
  input.pool.query<{revision:string;block_hash:Hex32;observed_at:string}>(`SELECT p.revision,p.block_hash,extract(epoch FROM b.source_timestamp)::bigint::text observed_at FROM ${schema}.publication_pointers ptr JOIN ${schema}.publications p USING(environment,chain_id,deployment_digest,scope,revision) JOIN ${schema}.chain_blocks b ON b.environment=p.environment AND b.chain_id=p.chain_id AND b.deployment_digest=p.deployment_digest AND b.hash=p.block_hash JOIN ${schema}.ingestion_checkpoints i ON i.environment=p.environment AND i.chain_id=p.chain_id AND i.deployment_digest=p.deployment_digest AND i.stream='frontend-events' AND i.generation=p.generation WHERE p.environment=$1 AND p.chain_id=$2 AND p.deployment_digest=$3 AND p.scope='positions' AND b.canonical AND b.finalized`,id),
 ]);
 const feeDecimals:Record<string,number>={},volumeAmounts:Record<string,string>={},feeTotals:Record<string,string>={},feeAssets:Record<string,Record<string,string>>={};
 const add=(map:Record<string,string>,asset:string,value:string)=>{map[asset]=(BigInt(map[asset]??'0')+BigInt(value)).toString();};
 for(const row of flow.markets)feeDecimals[row.quote_asset]=quoteDecimals(row.quote_config);
 let unknown=0;
 for(const row of flow.rows){add(volumeAmounts,row.quote_asset,(BigInt(row.quote_raw??'0')-BigInt(row.internal_quote_raw??'0')).toString());unknown+=Number(row.unknown_fee_count??0);for(const f of row.fees??[]){feeDecimals[f.asset]=f.asset===row.quote_asset?quoteDecimals(row.quote_config):18;add(feeTotals,f.asset,(BigInt(f.feeRaw)+BigInt(f.taxRaw)).toString());}}
 for(const row of allocations.rows){const bucket=row.recipient==='stakers'?'staker':row.recipient==='holders'?'holder':row.recipient;(feeAssets[row.asset]??={creator:'0',staker:'0',holder:'0',platform:'0'})[bucket]=row.amount_raw;}
 // Resolve only assets present in allocations, never transfer full market records.
 const feePriceQuotes:Record<string,{quoteAsset:string;priceQuote:string}>={};
 const missing=[...new Set([...Object.keys(feeAssets),...Object.keys(feeTotals)])].filter(asset=>feeDecimals[asset]===undefined||!flow.markets.some(m=>m.quote_asset===asset));
 if(missing.length){const tokens=await input.pool.query<{token:string;quote:string;price:string|null}>(`SELECT DISTINCT payload->>'memeToken' token,payload->>'quoteAsset' quote,payload->'display'->>'priceQuote' price FROM ${schema}.projection_read_records WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='markets' AND revision=$4 AND payload->>'memeToken'=ANY($5::text[])`,[...id,point.revision,missing]);for(const row of tokens.rows){feeDecimals[row.token]=18;if(row.price&&/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(row.price))feePriceQuotes[row.token]={quoteAsset:row.quote,priceQuote:row.price};}}
 const pos=position.rows[0];let stockAmounts:Record<string,string>|null=null,stakingWallets:number|null=null;
 if(pos){
  const totals=await input.pool.query<{asset:string|null;amount:string;wallets:string;invalid:string}>(`WITH p AS MATERIALIZED (SELECT payload->>'assetUid' asset,payload->>'user' account,payload->>'allocated' allocated FROM ${schema}.projection_read_records WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='positions' AND revision=$4),v AS (SELECT *,allocated ~ '^(0|[1-9][0-9]*)$' AND asset ~ '^0x[0-9a-f]{64}$' AND account ~ '^0x[0-9a-f]{40}$' valid FROM p) SELECT asset,coalesce(sum(CASE WHEN valid THEN allocated::numeric ELSE 0 END),0)::text amount,count(DISTINCT account) FILTER(WHERE valid AND CASE WHEN valid THEN allocated::numeric>0 ELSE false END)::text wallets,count(*) FILTER(WHERE valid IS NOT TRUE)::text invalid FROM v GROUP BY GROUPING SETS((asset),())`,[...id,pos.revision]);
  if(totals.rows.every(r=>r.invalid==='0')){stockAmounts=Object.fromEntries(totals.rows.filter(r=>r.asset!==null).map(r=>[r.asset!,r.amount]));stakingWallets=Number(totals.rows.find(r=>r.asset===null)?.wallets??0);}
 }
 const c=counts.rows[0]!;
 return {schemaVersion:3,chainId:input.deployment.chainId,displayOnly:true as const,observedAt:point.asOf,sourceBlockNumber:point.number,sourceBlockHash:point.hash,windowFrom:from,
  marketCount:Number(c.total),bloomedMarketCount:Number(c.bloomed),launches24h:c.invalid==='0'?Number(c.launches):null,
  volumeAmounts,volumeCoverage:true,volumeBasis:'EXTERNAL_EXECUTIONS_CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE',usdBasis:'CURRENT_PRICE_ESTIMATE',
  feeAssets,feePriceQuotes,allocationCoverage:true,allocationBasis:'ALLOCATION_TIME',feeTotals,feeDecimals,feeCoverage:unknown===0,feeBasis:'TRADE_TIME',unknownFeeTradeCount:unknown,
  stockAmounts,stakingWallets,stakingCoverage:stockAmounts!==null,stakingObservedAt:stockAmounts!==null&&pos?Number(pos.observed_at):null,stakingBlockHash:stockAmounts!==null&&pos?pos.block_hash:null};
}

export async function readGlobalSeries(input:{readonly pool:Pool;readonly deployment:DeploymentIdentity;readonly from:number;readonly to:number;readonly interval:60|300|900|3600|14400|86400;readonly schemaName?:string}){
  if(input.from%input.interval||input.to%input.interval||(input.to-input.from)/input.interval>2000)throw new Error('invalid series interval');
  const data=await rollupFlow(input,input.interval);
  const byBucket=new Map<number,Map<string,any>>();
  for(const row of data.rows){const bucket=Number(row.bucket);const groups=byBucket.get(bucket)??new Map();groups.set(`${row.asset_uid}:${row.quote_asset}`,flowGroup(row,true));byBucket.set(bucket,groups);}
  const points=[];
  for(let at=input.from;at<input.to;at+=input.interval)points.push({timestamp:at,groups:data.markets.map(row=>byBucket.get(at)?.get(`${row.asset_uid}:${row.quote_asset}`)??flowGroup({...row},true))});
  return{chainId:input.deployment.chainId,displayOnly:true as const,coverage:data.coverage,interval:input.interval,volumeBasis:'CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE' as const,emptyPolicy:'ZERO_FLOW_NO_SYNTHETIC_EXECUTIONS' as const,points};
}
async function globalFlow(input:{readonly pool:Pool;readonly deployment:DeploymentIdentity;readonly from:number;readonly to:number;readonly schemaName?:string},series:boolean){
 const data=await rollupFlow(input,0);const values=new Map(data.rows.map(row=>[`${row.asset_uid}:${row.quote_asset}`,row]));
 const output=data.markets.map(row=>flowGroup({...row,...values.get(`${row.asset_uid}:${row.quote_asset}`)},series));
 if(series)return{coverage:data.coverage,groups:output};
 const stocks=f72BootstrapConfigs.filter(x=>x.kind==='asset').map(x=>({assetUid:x.id as Hex32,stockToken:String(x.values.stockToken).toLowerCase() as Address,stockDecimals:Number(x.values.tokenDecimals)})).sort((a,b)=>a.assetUid.localeCompare(b.assetUid));
 const count=data.markets.reduce((sum,row)=>sum+Number(row.market_count),0);
 return{chainId:input.deployment.chainId,displayOnly:true as const,coverage:data.coverage,marketCount:count,registeredStockCount:stocks.length,boundMarketCount:count,unboundMarketCount:0,stocks,groups:output};
}
interface FlowRow {asset_uid:Hex32;quote_asset:Address;quote_config:Hex32;market_count?:string;bucket?:string;trade_count?:string;trading_count?:string;internal_count?:string;unclassified_count?:string;quote_raw?:string;internal_quote_raw?:string;unknown_fee_count?:string;fees?:Array<{asset:Address;feeRaw:string;taxRaw:string}>}
function flowGroup(row:FlowRow,series:boolean){
 const decimals=quoteDecimals(row.quote_config);
 return {assetUid:row.asset_uid,quoteAsset:row.quote_asset,quoteDecimals:decimals,...(!series?{marketCount:Number(row.market_count??0),tradingMarketCount:Number(row.trading_count??0)}:{}),tradeCount:Number(row.trade_count??0),internalTradeCount:Number(row.internal_count??0),unclassifiedTradeCount:Number(row.unclassified_count??0),quoteVolumeRaw:row.quote_raw??'0',internalQuoteVolumeRaw:row.internal_quote_raw??'0',fees:(row.fees??[]).map(f=>({...f,decimals:f.asset===row.quote_asset?decimals:18})),unknownFeeTradeCount:Number(row.unknown_fee_count??0),...(!series?{volumeBasis:'CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE' as const}:{}),binding:'registered_stock' as const};
}
async function rollupFlow(input:{pool:Pool;deployment:DeploymentIdentity;from:number;to:number;schemaName?:string},interval:number){
 if(!Number.isSafeInteger(input.from)||!Number.isSafeInteger(input.to)||input.from<0||input.to<=input.from)throw Error('invalid statistics window');
 const schema=identifier(input.schemaName??'tickergarden_serverless'),point=await checkpoint(input.pool,schema,input.deployment);
 const coverage=await coverageFor(input.pool,schema,input.deployment,point,input.from,input.to);
 const args=[...identity(input.deployment),point.revision,input.from,input.to,interval];
 const marketSql=`SELECT identity market_id,payload->>'assetUid' asset_uid,payload->>'quoteAsset' quote_asset,payload->>'quoteAssetConfigId' quote_config FROM ${schema}.projection_read_records WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='markets' AND revision=$4`;
 const markets=(await input.pool.query<FlowRow>(`WITH m AS (${marketSql}) SELECT asset_uid,quote_asset,quote_config,count(*)::text market_count FROM m GROUP BY asset_uid,quote_asset,quote_config ORDER BY asset_uid,quote_asset`,args.slice(0,4))).rows;
 // Full UTC buckets are precomputed; exact edge intervals retain raw block provenance.
 const width=interval>=86400?86400:interval===0||interval>=3600?3600:60;
 const fullFrom=Math.ceil(input.from/width)*width,fullTo=Math.max(fullFrom,Math.floor(input.to/width)*width);
 const rows=(await input.pool.query<FlowRow>(`WITH m AS MATERIALIZED (${marketSql}), source AS (
 SELECT market_id,occurred_at,fee_asset,trade_count,internal_count,unclassified_count,quote_raw,internal_quote_raw,unknown_fee_count,fee_raw,tax_raw FROM ${schema}.trade_time_buckets WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND bucket_seconds=$8 AND occurred_at>=to_timestamp($9) AND occurred_at<to_timestamp($10)
 UNION ALL
 SELECT r.market_id,r.occurred_at,r.fee_asset,r.trade_count,r.internal_count,r.unclassified_count,r.quote_raw,r.internal_quote_raw,r.unknown_fee_count,r.fee_raw,r.tax_raw FROM ${schema}.trade_flow_rollups r JOIN ${schema}.chain_blocks b ON b.environment=r.environment AND b.chain_id=r.chain_id AND b.deployment_digest=r.deployment_digest AND b.hash=r.block_hash
 WHERE r.environment=$1 AND r.chain_id=$2 AND r.deployment_digest=$3 AND b.canonical AND b.finalized AND r.occurred_at>=to_timestamp($5) AND r.occurred_at<to_timestamp($6) AND (r.occurred_at<to_timestamp($9) OR r.occurred_at>=to_timestamp($10))
 ), r AS MATERIALIZED (
 SELECT m.*,CASE WHEN $7::int=0 THEN 0 ELSE floor(extract(epoch FROM r.occurred_at)/$7)*$7 END bucket,r.fee_asset,r.trade_count,r.internal_count,r.unclassified_count,r.quote_raw,r.internal_quote_raw,r.unknown_fee_count,r.fee_raw,r.tax_raw
 FROM source r JOIN m USING(market_id)
 ), totals AS (SELECT asset_uid,quote_asset,quote_config,bucket,count(DISTINCT market_id)::text trading_count,sum(trade_count)::text trade_count,sum(internal_count)::text internal_count,sum(unclassified_count)::text unclassified_count,sum(quote_raw)::text quote_raw,sum(internal_quote_raw)::text internal_quote_raw,sum(unknown_fee_count)::text unknown_fee_count FROM r GROUP BY asset_uid,quote_asset,quote_config,bucket), fees AS (
 SELECT asset_uid,quote_asset,quote_config,bucket,jsonb_agg(jsonb_build_object('asset',fee_asset,'feeRaw',fee_raw,'taxRaw',tax_raw) ORDER BY fee_asset) fees FROM (SELECT asset_uid,quote_asset,quote_config,bucket,fee_asset,sum(fee_raw)::text fee_raw,sum(tax_raw)::text tax_raw FROM r WHERE fee_asset<>'' GROUP BY asset_uid,quote_asset,quote_config,bucket,fee_asset) f GROUP BY asset_uid,quote_asset,quote_config,bucket)
 SELECT totals.*,coalesce(fees.fees,'[]'::jsonb) fees FROM totals LEFT JOIN fees USING(asset_uid,quote_asset,quote_config,bucket) ORDER BY asset_uid,quote_asset,bucket`,[...args,width,fullFrom,fullTo])).rows;
 return{coverage,markets,rows};
}


async function checkpoint(pool:Pool,schema:string,deployment:DeploymentIdentity){const row=(await pool.query<{last_revision:string;number:string;hash:Hex32;as_of:string}>(`SELECT c.last_revision,b.number::text,b.hash,extract(epoch from b.source_timestamp)::bigint::text as as_of FROM ${schema}.projection_checkpoints c JOIN ${schema}.chain_blocks b ON b.environment=c.environment AND b.chain_id=c.chain_id AND b.deployment_digest=c.deployment_digest AND b.number=c.next_block-1 WHERE c.environment=$1 AND c.chain_id=$2 AND c.deployment_digest=$3 AND c.scope='analytics' AND b.canonical AND b.finalized AND c.last_revision=b.number::text||':'||b.hash`,identity(deployment))).rows[0];if(!row)throw new PublicationUnavailableError('statistics projection is unavailable');return{revision:row.last_revision,number:row.number,hash:row.hash,asOf:Number(row.as_of)}}
async function currentMarkets(pool:Pool,schema:string,deployment:DeploymentIdentity,revision:string,ids?:readonly Hex32[]):Promise<Market[]>{const rows=await pool.query<{payload:Market}>(`SELECT jsonb_build_object('marketId',payload->'marketId','assetUid',payload->'assetUid','memeToken',payload->'memeToken','quoteAsset',payload->'quoteAsset','quoteAssetConfigId',payload->'quoteAssetConfigId','tickerGardenBaselineId',payload->'tickerGardenBaselineId','sourceVersion',payload->'sourceVersion','launchPhase',payload->'launchPhase','display',payload->'display','identity',jsonb_build_object('deployedAt',payload->'identity'->'deployedAt')) payload FROM ${schema}.projection_read_records WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='markets' AND revision=$4 AND ($5::text[] IS NULL OR identity=ANY($5)) ORDER BY identity`,[...identity(deployment),revision,ids??null]);return rows.rows.map(row=>row.payload)}
async function assertCoverage(pool:Pool,schema:string,deployment:DeploymentIdentity,throughBlock:string,from:number,to:number){const point=(await pool.query<{number:string;hash:Hex32;as_of:string}>(`SELECT number::text,hash,extract(epoch from source_timestamp)::bigint::text as as_of FROM ${schema}.chain_blocks WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND number=$4 AND canonical AND finalized ORDER BY hash LIMIT 1`,[...identity(deployment),throughBlock])).rows[0];if(!point)throw new PublicationUnavailableError('statistics interval is not completely covered');await coverageFor(pool,schema,deployment,{number:point.number,hash:point.hash,asOf:Number(point.as_of)},from,to)}
export async function coverageFor(pool:Pool | PoolClient,schema:string,deployment:DeploymentIdentity,point:{number:string;hash:Hex32;asOf?:number;generation?:string},from:number,to:number){
  const activation=(await pool.query<{number:string;hash:Hex32;timestamp:string}>(`SELECT number::text,hash,extract(epoch from source_timestamp)::bigint::text timestamp FROM ${schema}.chain_blocks WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND number=$4 AND canonical AND finalized ORDER BY hash LIMIT 1`,[...identity(deployment),deployment.activationBlock.toString()])).rows[0];
  const pointTime=point.asOf??Number((await pool.query<{timestamp:string}>(`SELECT extract(epoch from source_timestamp)::bigint::text timestamp FROM ${schema}.chain_blocks WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND number=$4 AND hash=$5 AND canonical AND finalized`,[...identity(deployment),point.number,point.hash])).rows[0]?.timestamp);
  if(!activation||!Number.isSafeInteger(pointTime)||to>pointTime)throw new PublicationUnavailableError('statistics interval is not completely covered');
  const activationTime=Number(activation.timestamp);
  const [anchorResult,throughResult,stateResult]=await Promise.all([
    from<=activationTime?Promise.resolve({rows:[{number:activation.number,hash:activation.hash}]}):pool.query<{number:string;hash:Hex32}>(`SELECT number::text,hash FROM ${schema}.chain_blocks WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND canonical AND finalized AND number<=$4 AND source_timestamp<=to_timestamp($5) ORDER BY number DESC LIMIT 1`,[...identity(deployment),point.number,from]),
    pool.query<{number:string;hash:Hex32}>(`SELECT number::text,hash FROM ${schema}.chain_blocks WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND canonical AND finalized AND number<=$4 AND source_timestamp>=to_timestamp($5) ORDER BY number LIMIT 1`,[...identity(deployment),point.number,to]),
    pool.query<{next_block:string;generation:string}>(`SELECT next_block::text,generation::text FROM ${schema}.ingestion_checkpoints WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND stream='frontend-events'`,identity(deployment)),
  ]);
  const anchor=anchorResult.rows[0],through=throughResult.rows[0],state=stateResult.rows[0];
  if(!anchor||!through)throw new PublicationUnavailableError('statistics interval is not completely covered');
  const generation=point.generation??state?.generation;if(!state||!generation||BigInt(state.next_block)<=BigInt(through.number))throw new PublicationUnavailableError('statistics interval is not completely covered');
  const ranges=await pool.query<{from_block:string;to_block:string}>(`SELECT from_block::text,to_block::text FROM ${schema}.covered_ranges WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND generation=$4 AND complete AND to_block>=$5 AND from_block<=$6 ORDER BY from_block,to_block`,[...identity(deployment),generation,anchor.number,through.number]);
  let cursor=BigInt(anchor.number);for(const range of ranges.rows){const start=BigInt(range.from_block),end=BigInt(range.to_block);if(start>cursor)break;if(end>=cursor)cursor=end+1n;if(cursor>BigInt(through.number))break}
  if(cursor<=BigInt(through.number))throw new PublicationUnavailableError('statistics interval has a chain coverage gap');
  return{from,to,anchorNumber:Number(anchor.number),anchorHash:anchor.hash,throughNumber:Number(through.number),throughHash:through.hash,projectionNumber:Number(point.number),projectionHash:point.hash};
}
function sourcePosition(value:TradeActivity){return{blockNumber:value.source.blockNumber,transactionIndex:String(value.source.transactionIndex),logIndex:String(value.source.logIndex),timestamp:value.timestamp}}
function quoteDecimals(id:Hex32):number{const row=f72BootstrapConfigs.find(item=>item.kind==='quote'&&item.id===id);if(!row||!('quoteDecimals'in row.values))throw new Error('quote decimals unavailable');return Number(row.values.quoteDecimals)}
function decimalProductRaw(raw:string,decimals:number,price:string){return decimalProduct(decimalFromRaw(raw,decimals),price)}
function decimalFromRaw(raw:string,decimals:number){const value=BigInt(raw);const scale=10n**BigInt(decimals);return `${value/scale}.${(value%scale).toString().padStart(decimals,'0')}`}
function decimalFromRational(n:string,d:string){const scale=10n**36n;const value=BigInt(n)*scale/BigInt(d);return `${value/scale}.${(value%scale).toString().padStart(36,'0')}`}
function decimalProduct(a:string,b:string){const parse=(v:string)=>{const[i,f='']=v.split('.');return{x:BigInt(i!+f),s:f.length}};const x=parse(a),y=parse(b),s=x.s+y.s;let raw=(x.x*y.x).toString().padStart(s+1,'0');const out=s?`${raw.slice(0,-s)}.${raw.slice(-s)}`:raw;return out.replace(/0+$/,'').replace(/\.$/,'')||'0'}
function midpoint(a:string,b:string){const scale=18;const read=(v:string)=>{const[i,f='']=v.split('.');return BigInt(i!+f.padEnd(scale,'0').slice(0,scale))};const n=(read(a)+read(b))/2n;return `${n/10n**18n}.${(n%10n**18n).toString().padStart(18,'0')}`}
function identity(d:DeploymentIdentity):[string,number,string]{return[d.environment,d.chainId,d.deploymentDigest]}
function identifier(v:string){if(!/^[a-z][a-z0-9_]{0,62}$/.test(v))throw new Error('invalid database schema name');return`"${v}"`}
