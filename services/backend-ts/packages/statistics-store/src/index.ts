import type { Pool, PoolClient } from 'pg';
import type { DeploymentIdentity } from '../../chain/src/index.ts';
import { f72BootstrapConfigs } from '../../config-projector/src/f72-bootstrap.generated.ts';
import { f72EventCatalog } from '../../events/src/index.ts';
import { f72PriceTargets, type PriceReference } from '../../display-price/src/index.ts';
import type { Address, TradeActivity } from '../../analytics/src/index.ts';
import { PublicationUnavailableError } from '../../read-store/src/index.ts';

type Hex32 = `0x${string}`;
interface Market { readonly marketId: Hex32; readonly assetUid: Hex32; readonly memeToken: Address; readonly quoteAsset: Address;
  readonly quoteAssetConfigId: Hex32; readonly tickerGardenBaselineId: Hex32; readonly launchPhase: 0 | 1 }

export async function readDisplayPrices(input: { readonly pool: Pool; readonly deployment: DeploymentIdentity; readonly now?: Date; readonly schemaName?: string }) {
  const targets = f72PriceTargets(); const now = input.now ?? new Date(); const rows = await latestPrices(input.pool, input.deployment, now, input.schemaName);
  const byToken = preferredPrices(rows, now);
  return { chainId: input.deployment.chainId, displayOnly: true as const, confidence: 'provider_reported' as const, status: 'configured' as const,
    references: targets.map((target) => byToken.get(target.token) ?? { ...target, source: 'robinhood_rest' as const, unit: 'USD_PER_WHOLE_TOKEN' as const,
      status: 'unavailable' as const, reason: 'not_refreshed', bidUsd: null, askUsd: null, multiplier: null, asOf: null, expiresAt: null, retrievedAt: now.toISOString() }) };
}

export async function readStatisticsPrices(input: { readonly pool: Pool; readonly deployment: DeploymentIdentity; readonly now?: Date; readonly schemaName?: string }) {
  const references = (await readDisplayPrices(input)).references; const prices: Record<string,string> = {}; const expiresAt: Record<string,number> = {};
  for (const item of references) if (item.status === 'available' && item.bidUsd && item.askUsd && item.expiresAt) {
    prices[item.token] = midpoint(item.bidUsd, item.askUsd); expiresAt[item.token] = Math.floor(new Date(item.expiresAt).getTime()/1_000);
  }
  return { chainId: input.deployment.chainId, displayOnly: true as const, basis: 'PROVIDER_REPORTED_USD' as const, prices, expiresAt };
}

export async function readMarketStatistics(input: { readonly pool: Pool; readonly deployment: DeploymentIdentity; readonly marketIds?: readonly Hex32[]; readonly now?: Date; readonly schemaName?: string }) {
  const schema=identifier(input.schemaName??'tickergarden_serverless'); const point=await checkpoint(input.pool,schema,input.deployment);
  const markets=await currentMarkets(input.pool,schema,input.deployment,point.revision,input.marketIds);
  const priceNow=input.now??new Date();const prices=preferredPrices(await latestPrices(input.pool,input.deployment,priceNow,input.schemaName),priceNow);
  const now=point.asOf; const from=now-86_400; const items: Record<string,unknown>={};
  let volumeCovered=true;try{await assertCoverage(input.pool,schema,input.deployment,point.number,from,now)}catch(error){if(!(error instanceof PublicationUnavailableError))throw error;volumeCovered=false}
  for(const market of markets){
    const trades=await input.pool.query<{payload:TradeActivity}>(`SELECT t.payload FROM ${schema}.market_trades t JOIN ${schema}.chain_blocks b ON b.environment=t.environment AND b.chain_id=t.chain_id AND b.deployment_digest=t.deployment_digest AND b.hash=t.block_hash WHERE t.environment=$1 AND t.chain_id=$2 AND t.deployment_digest=$3 AND t.market_id=$4 AND b.canonical AND b.finalized AND t.occurred_at>=to_timestamp($5) AND t.occurred_at<to_timestamp($6) ORDER BY b.number DESC,(t.payload->'source'->>'transactionIndex')::bigint DESC,t.log_index DESC LIMIT 1`,[...identity(input.deployment),market.marketId,from,now]);
    const last=trades.rows[0]?.payload; const lastBuy=last?.side==='buy'?sourcePosition(last):await lastBuyFor(input.pool,schema,input.deployment,market.marketId);
    const volume=volumeCovered?await input.pool.query<{raw:string|null}>(`SELECT sum(quote_raw)::text raw FROM ${schema}.market_trades t JOIN ${schema}.chain_blocks b ON b.environment=t.environment AND b.chain_id=t.chain_id AND b.deployment_digest=t.deployment_digest AND b.hash=t.block_hash WHERE t.environment=$1 AND t.chain_id=$2 AND t.deployment_digest=$3 AND t.market_id=$4 AND t.classification='unclassified' AND b.canonical AND b.finalized AND t.occurred_at>=to_timestamp($5) AND t.occurred_at<to_timestamp($6)`,[...identity(input.deployment),market.marketId,from,now]):null;
    const decimals=quoteDecimals(market.quoteAssetConfigId); const volumeRaw=volume?.rows[0]?.raw??(volumeCovered?'0':null);
    let metrics: Record<string,unknown> | null=null; const quoteReference=prices.get(market.quoteAsset);const quoteUsd=quoteReference?.bidUsd&&quoteReference.askUsd?midpoint(quoteReference.bidUsd,quoteReference.askUsd):null;
    if(quoteUsd&&quoteReference){
      const price=last?decimalFromRational(last.price.numerator,last.price.denominator):null; const supply=baselineSupply(market.tickerGardenBaselineId);
      const cap=price?decimalProductRaw(supply,18,decimalProduct(price,quoteUsd)):null;
      metrics={status:cap?'available':'unavailable',reason:cap?'historical_usd_coverage_unavailable':'execution_price_unavailable',volume24hUsd:null,marketCapUsd:cap,quoteUsdMidpoint:quoteUsd,
        windowFromTimestamp:String(from),asOfTimestamp:String(now),usdPriceAsOf:quoteReference.asOf,usdPriceSource:quoteReference.source,
        volumeBasis:'EXTERNAL_EXECUTIONS_CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE',marketCapBasis:'BASELINE_TOTAL_SUPPLY_X_LATEST_FINALIZED_24H_EXECUTION_PRICE'};
    }
    items[market.marketId]={marketId:market.marketId,metrics,lastBuy,observedAt:point.asOf,launchPhase:String(market.launchPhase),
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
  const markets=await currentMarkets(input.pool,schema,input.deployment,point.revision);const byMarket=new Map(markets.map(m=>[m.marketId,m]));
  const snapshots=await input.pool.query<{market_id:Hex32;excluded_accounts:Address[]}>(`SELECT market_id,excluded_accounts FROM ${schema}.holder_snapshots WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND block_number=$4 AND block_hash=$5`,[...identity(input.deployment),point.number,point.hash]);
  if(snapshots.rows.length!==markets.length)throw new PublicationUnavailableError('global holder snapshot is incomplete');
  const excluded=[...new Set(snapshots.rows.flatMap(row=>row.excluded_accounts))].sort();
  const balances=await input.pool.query<{market_id:Hex32;account:Address}>(`SELECT market_id,account FROM ${schema}.holder_balances WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND balance_raw>0 ORDER BY market_id,account LIMIT 1000001`,identity(input.deployment));
  if(balances.rows.length>1_000_000)throw new PublicationUnavailableError('global holder bound exceeded');
  const excludedSet=new Set(excluded),allPositive=new Set<Address>(),allIncluded=new Set<Address>();
  const grouped=new Map<Hex32,{markets:Set<Hex32>;pairs:number;positive:Set<Address>;included:Set<Address>}>();
  for(const market of markets)grouped.set(market.assetUid,{markets:new Set(),pairs:0,positive:new Set(),included:new Set()});
  for(const market of markets)grouped.get(market.assetUid)!.markets.add(market.marketId);
  for(const row of balances.rows){const market=byMarket.get(row.market_id);if(!market)throw new PublicationUnavailableError('holder market identity is unavailable');const group=grouped.get(market.assetUid)!;group.pairs++;group.positive.add(row.account);allPositive.add(row.account);if(!excludedSet.has(row.account)){group.included.add(row.account);allIncluded.add(row.account)}}
  return{chainId:input.deployment.chainId,displayOnly:true as const,finality:'finalized' as const,sourceBlockNumber:point.number,sourceBlockHash:point.hash,
    marketCount:markets.length,positiveMarketAddressPairs:balances.rows.length,positiveAddressCount:allPositive.size,includedAddressCount:allIncluded.size,
    exclusionPolicy:'UNION_OF_KNOWN_PROTOCOL_ADDRESSES_V1' as const,excludedAccounts:excluded,groups:[...grouped].sort(([a],[b])=>a.localeCompare(b)).map(([assetUid,g])=>({assetUid,binding:'registered_stock' as const,marketCount:g.markets.size,positiveMarketAddressPairs:g.pairs,positiveAddressCount:g.positive.size,includedAddressCount:g.included.size}))};
}

export async function readGlobalStatistics(input:{readonly pool:Pool;readonly deployment:DeploymentIdentity;readonly from:number;readonly to:number;readonly schemaName?:string}){
  return globalFlow(input,false);
}

export async function readProtocolStatistics(input:{readonly pool:Pool;readonly deployment:DeploymentIdentity;readonly schemaName?:string}){
  const schema=identifier(input.schemaName??'tickergarden_serverless'),projection=await checkpoint(input.pool,schema,input.deployment),point=await ingestionPoint(input.pool,schema,input.deployment),from=Math.max(0,point.asOf-86400);
  await coverageFor(input.pool,schema,input.deployment,point,from,point.asOf);
  const rows=await input.pool.query<{recipient:'creator'|'stakers'|'platform'|'holders';asset:Address;amount_raw:string}>(`SELECT f.recipient,f.asset,sum(f.amount_raw)::text amount_raw FROM ${schema}.detail_fee_events f JOIN ${schema}.chain_blocks b ON b.environment=f.environment AND b.chain_id=f.chain_id AND b.deployment_digest=f.deployment_digest AND b.hash=f.block_hash WHERE f.environment=$1 AND f.chain_id=$2 AND f.deployment_digest=$3 AND b.canonical AND b.finalized AND b.source_timestamp>=to_timestamp($4) AND b.source_timestamp<to_timestamp($5) GROUP BY f.recipient,f.asset ORDER BY f.asset,f.recipient`,[...identity(input.deployment),from,point.asOf]);
  const markets=await currentMarkets(input.pool,schema,input.deployment,projection.revision);const decimals:Record<string,number>={};for(const market of markets){decimals[market.quoteAsset]=quoteDecimals(market.quoteAssetConfigId);decimals[market.memeToken]=18}
  const feeAssets:Record<string,Record<string,string>>={};for(const row of rows.rows){const bucket=row.recipient==='stakers'?'staker':row.recipient==='holders'?'holder':row.recipient;(feeAssets[row.asset]??={creator:'0',staker:'0',holder:'0',platform:'0'})[bucket]=row.amount_raw}
  const feeTotals:Record<string,string>={};for(const[asset,buckets]of Object.entries(feeAssets))feeTotals[asset]=Object.values(buckets).reduce((sum,value)=>sum+BigInt(value),0n).toString();
  const positions=await currentPositions(input.pool,schema,input.deployment);const stockAmounts:Record<string,string>={};const stakingUsers=new Set<Address>();
  for(const position of positions){const allocated=canonicalAmount(position.allocated,'position allocation');if(allocated===0n)continue;stockAmounts[position.assetUid]=((stockAmounts[position.assetUid]?BigInt(stockAmounts[position.assetUid]!):0n)+allocated).toString();stakingUsers.add(position.user)}
  const launches24h=markets.filter(m=>{const row=m as Market&{identity?:{deployedAt?:string}};const at=Number(row.identity?.deployedAt);return Number.isSafeInteger(at)&&at>=from&&at<point.asOf}).length;
  return{schemaVersion:2,chainId:input.deployment.chainId,displayOnly:true as const,observedAt:point.asOf,marketCount:markets.length,bloomedMarketCount:markets.filter(m=>m.launchPhase===1).length,launches24h,
    marketCapUsd:null,volume24hUsd:null,valuationCoverage:false,historicalUsdCoverage:false,stockAmounts,stakingObservedAt:point.asOf,feeDecimals:decimals,stakingWallets:stakingUsers.size,feeCoverage:true,feeAssets,feeTotals,feeBasis:'ALLOCATION_TIME',windowFrom:from,reason:'statistics_partially_unavailable'};
}
export async function readGlobalSeries(input:{readonly pool:Pool;readonly deployment:DeploymentIdentity;readonly from:number;readonly to:number;readonly interval:60|300|900|3600|14400|86400;readonly schemaName?:string}){
  if(input.from%input.interval||input.to%input.interval||(input.to-input.from)/input.interval>2000)throw new Error('invalid series interval');
  const base=await globalFlow(input,true);const identities=base.groups.map(g=>({assetUid:g.assetUid,quoteAsset:g.quoteAsset,quoteDecimals:g.quoteDecimals,binding:g.binding}));
  const points=[];for(let at=input.from;at<input.to;at+=input.interval){const bucket=await globalFlow({...input,from:at,to:at+input.interval},true);
    const found=new Map(bucket.groups.map(g=>[`${g.assetUid}:${g.quoteAsset}`,g]));points.push({timestamp:at,groups:identities.map(id=>found.get(`${id.assetUid}:${id.quoteAsset}`)??{...id,tradeCount:0,internalTradeCount:0,unclassifiedTradeCount:0,quoteVolumeRaw:'0',internalQuoteVolumeRaw:'0',fees:[],unknownFeeTradeCount:0})})}
  return{chainId:input.deployment.chainId,displayOnly:true as const,coverage:base.coverage,interval:input.interval,volumeBasis:'CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE' as const,emptyPolicy:'ZERO_FLOW_NO_SYNTHETIC_EXECUTIONS' as const,points};
}

async function globalFlow(input:{readonly pool:Pool;readonly deployment:DeploymentIdentity;readonly from:number;readonly to:number;readonly schemaName?:string},series:boolean){
  if(!Number.isSafeInteger(input.from)||!Number.isSafeInteger(input.to)||input.from<0||input.to<=input.from)throw new Error('invalid statistics window');
  const schema=identifier(input.schemaName??'tickergarden_serverless'),point=await checkpoint(input.pool,schema,input.deployment);const coverage=await coverageFor(input.pool,schema,input.deployment,point,input.from,input.to);
  const markets=await currentMarkets(input.pool,schema,input.deployment,point.revision),byMarket=new Map(markets.map(m=>[m.marketId,m]));
  const trades=(await input.pool.query<{payload:TradeActivity}>(`SELECT t.payload FROM ${schema}.market_trades t JOIN ${schema}.chain_blocks b ON b.environment=t.environment AND b.chain_id=t.chain_id AND b.deployment_digest=t.deployment_digest AND b.hash=t.block_hash WHERE t.environment=$1 AND t.chain_id=$2 AND t.deployment_digest=$3 AND b.canonical AND b.finalized AND t.occurred_at>=to_timestamp($4) AND t.occurred_at<to_timestamp($5) ORDER BY b.number,(t.payload->'source'->>'transactionIndex')::bigint,t.log_index LIMIT 100001`,[...identity(input.deployment),input.from,input.to])).rows;
  if(trades.length>100000)throw new PublicationUnavailableError('global execution bound exceeded');
  type Mutable={assetUid:Hex32;quoteAsset:Address;quoteDecimals:number;binding:'registered_stock';markets:Set<Hex32>;trading:Set<Hex32>;tradeCount:number;internalTradeCount:number;unclassifiedTradeCount:number;quote:bigint;internalQuote:bigint;unknown:number;fees:Map<Address,{decimals:number;fee:bigint;tax:bigint}>};
  const groups=new Map<string,Mutable>();for(const market of markets){const key=`${market.assetUid}:${market.quoteAsset}`;let g=groups.get(key);if(!g){g={assetUid:market.assetUid,quoteAsset:market.quoteAsset,quoteDecimals:quoteDecimals(market.quoteAssetConfigId),binding:'registered_stock',markets:new Set(),trading:new Set(),tradeCount:0,internalTradeCount:0,unclassifiedTradeCount:0,quote:0n,internalQuote:0n,unknown:0,fees:new Map()};groups.set(key,g)}g.markets.add(market.marketId)}
  for(const row of trades){const trade=row.payload,market=byMarket.get(trade.marketId);if(!market)throw new PublicationUnavailableError('trade market identity is unavailable');const g=groups.get(`${market.assetUid}:${market.quoteAsset}`)!;g.trading.add(market.marketId);g.tradeCount++;g.quote+=BigInt(trade.quoteRaw);if(trade.classification==='unclassified')g.unclassifiedTradeCount++;else{g.internalTradeCount++;g.internalQuote+=BigInt(trade.quoteRaw)}if(trade.feeStatus==='not_provided')g.unknown++;if(trade.feeAsset&&trade.feeRaw!==null){const old=g.fees.get(trade.feeAsset)??{decimals:trade.feeAsset===market.quoteAsset?g.quoteDecimals:18,fee:0n,tax:0n};old.fee+=BigInt(trade.feeRaw);old.tax+=BigInt(trade.taxRaw??'0');g.fees.set(trade.feeAsset,old)}}
  const output=[...groups.values()].sort((a,b)=>`${a.assetUid}:${a.quoteAsset}`.localeCompare(`${b.assetUid}:${b.quoteAsset}`)).map(g=>({assetUid:g.assetUid,quoteAsset:g.quoteAsset,quoteDecimals:g.quoteDecimals,...(!series?{marketCount:g.markets.size,tradingMarketCount:g.trading.size}:{}),tradeCount:g.tradeCount,internalTradeCount:g.internalTradeCount,unclassifiedTradeCount:g.unclassifiedTradeCount,quoteVolumeRaw:g.quote.toString(),internalQuoteVolumeRaw:g.internalQuote.toString(),fees:[...g.fees].sort(([a],[b])=>a.localeCompare(b)).map(([asset,v])=>({asset,decimals:v.decimals,feeRaw:v.fee.toString(),taxRaw:v.tax.toString()})),unknownFeeTradeCount:g.unknown, ...(!series?{volumeBasis:'CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE' as const}:{}),binding:g.binding}));
  if(series)return{coverage,groups:output};
  const stocks=f72BootstrapConfigs.filter(x=>x.kind==='asset').map(x=>({assetUid:x.id as Hex32,stockToken:String(x.values.stockToken).toLowerCase() as Address,stockDecimals:Number(x.values.tokenDecimals)})).sort((a,b)=>a.assetUid.localeCompare(b.assetUid));
  return{chainId:input.deployment.chainId,displayOnly:true as const,coverage,marketCount:markets.length,registeredStockCount:stocks.length,boundMarketCount:markets.length,unboundMarketCount:0,stocks,groups:output};
}

async function latestPrices(pool:Pool,deployment:DeploymentIdentity,now:Date,schemaName?:string){const schema=identifier(schemaName??'tickergarden_serverless');return (await pool.query<{asset:Address;payload:PriceReference}>(`SELECT DISTINCT ON (asset,source) asset,payload FROM ${schema}.price_references WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 ORDER BY asset,source,(status='available' AND expires_at>$4) DESC,as_of DESC`,[...identity(deployment),now])).rows}
function preferredPrices(rows:readonly {asset:Address;payload:PriceReference}[],now:Date){const output=new Map<Address,PriceReference>();for(const row of rows){const candidate=publicPrice(viewPrice(row.payload,now));const current=output.get(row.asset);if(!current||priceRank(candidate)>priceRank(current))output.set(row.asset,candidate)}return output}
function priceRank(value:PriceReference){return value.status==='available'&&value.bidUsd&&value.askUsd?2:value.status==='stale'?1:0}
function viewPrice(value:PriceReference,now:Date):PriceReference{if(value.status==='available'&&value.expiresAt&&new Date(value.expiresAt)<=now)return{...value,status:'stale',reason:'price_expired',bidUsd:null,askUsd:null};return value}
function publicPrice(value:PriceReference):PriceReference{const{rawBidUsd:_rawBid,rawAskUsd:_rawAsk,...visible}=value;return visible}
async function checkpoint(pool:Pool,schema:string,deployment:DeploymentIdentity){const row=(await pool.query<{last_revision:string;number:string;hash:Hex32;as_of:string}>(`SELECT c.last_revision,b.number::text,b.hash,extract(epoch from b.source_timestamp)::bigint::text as as_of FROM ${schema}.projection_checkpoints c JOIN ${schema}.chain_blocks b ON b.environment=c.environment AND b.chain_id=c.chain_id AND b.deployment_digest=c.deployment_digest AND b.number=c.next_block-1 WHERE c.environment=$1 AND c.chain_id=$2 AND c.deployment_digest=$3 AND c.scope='analytics' AND b.canonical AND b.finalized AND c.last_revision=b.number::text||':'||b.hash`,identity(deployment))).rows[0];if(!row)throw new PublicationUnavailableError('statistics projection is unavailable');return{revision:row.last_revision,number:row.number,hash:row.hash,asOf:Number(row.as_of)}}
async function ingestionPoint(pool:Pool,schema:string,deployment:DeploymentIdentity){const row=(await pool.query<{number:string;hash:Hex32;as_of:string;generation:string}>(`SELECT b.number::text,b.hash,extract(epoch from b.source_timestamp)::bigint::text as as_of,i.generation::text FROM ${schema}.ingestion_checkpoints i JOIN ${schema}.chain_blocks b ON b.environment=i.environment AND b.chain_id=i.chain_id AND b.deployment_digest=i.deployment_digest AND b.number=i.next_block-1 AND b.hash=i.last_block_hash WHERE i.environment=$1 AND i.chain_id=$2 AND i.deployment_digest=$3 AND i.stream='frontend-events' AND b.canonical AND b.finalized`,identity(deployment))).rows[0];if(!row)throw new PublicationUnavailableError('statistics ingestion coverage is unavailable');return{number:row.number,hash:row.hash,asOf:Number(row.as_of),generation:row.generation}}
async function currentMarkets(pool:Pool,schema:string,deployment:DeploymentIdentity,revision:string,ids?:readonly Hex32[]):Promise<Market[]>{const rows=await pool.query<{payload:Market}>(`SELECT payload FROM ${schema}.projection_records WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='markets' AND revision=$4 AND ($5::text[] IS NULL OR identity=ANY($5)) ORDER BY identity LIMIT 1001`,[...identity(deployment),revision,ids??null]);if(rows.rows.length>1000)throw new PublicationUnavailableError('statistics market bound exceeded');return rows.rows.map(row=>row.payload)}
async function currentPositions(pool:Pool,schema:string,deployment:DeploymentIdentity):Promise<Array<{user:Address;assetUid:Hex32;allocated:string}>>{const rows=await pool.query<{payload:{user:Address;assetUid:Hex32;allocated:string}}>(`SELECT r.payload FROM ${schema}.projection_records r JOIN ${schema}.publication_pointers p USING(environment,chain_id,deployment_digest,scope,revision) WHERE r.environment=$1 AND r.chain_id=$2 AND r.deployment_digest=$3 AND r.scope='positions' ORDER BY r.identity LIMIT 10001`,identity(deployment));if(rows.rows.length>10000)throw new PublicationUnavailableError('statistics position bound exceeded');return rows.rows.map(row=>{const value=row.payload;if(!value||typeof value!=='object'||typeof value.user!=='string'||!/^0x[0-9a-f]{40}$/.test(value.user)||typeof value.assetUid!=='string'||!/^0x[0-9a-f]{64}$/.test(value.assetUid)||typeof value.allocated!=='string')throw new PublicationUnavailableError('statistics position is invalid');return value})}
async function assertCoverage(pool:Pool,schema:string,deployment:DeploymentIdentity,throughBlock:string,from:number,to:number){const point=(await pool.query<{number:string;hash:Hex32;as_of:string}>(`SELECT number::text,hash,extract(epoch from source_timestamp)::bigint::text as as_of FROM ${schema}.chain_blocks WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND number=$4 AND canonical AND finalized ORDER BY hash LIMIT 1`,[...identity(deployment),throughBlock])).rows[0];if(!point)throw new PublicationUnavailableError('statistics interval is not completely covered');await coverageFor(pool,schema,deployment,{number:point.number,hash:point.hash,asOf:Number(point.as_of)},from,to)}
async function coverageFor(pool:Pool,schema:string,deployment:DeploymentIdentity,point:{number:string;hash:Hex32;asOf?:number;generation?:string},from:number,to:number){
  const activation=(await pool.query<{number:string;hash:Hex32;timestamp:string}>(`SELECT number::text,hash,extract(epoch from source_timestamp)::bigint::text timestamp FROM ${schema}.chain_blocks WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND number=$4 AND canonical AND finalized ORDER BY hash LIMIT 1`,[...identity(deployment),deployment.activationBlock.toString()])).rows[0];
  const pointTime=point.asOf??Number((await pool.query<{timestamp:string}>(`SELECT extract(epoch from source_timestamp)::bigint::text timestamp FROM ${schema}.chain_blocks WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND number=$4 AND hash=$5 AND canonical AND finalized`,[...identity(deployment),point.number,point.hash])).rows[0]?.timestamp);
  if(!activation||!Number.isSafeInteger(pointTime)||to>pointTime)throw new PublicationUnavailableError('statistics interval is not completely covered');
  const activationTime=Number(activation.timestamp);let anchor:{number:string;hash:Hex32}|undefined;
  if(from<=activationTime)anchor={number:activation.number,hash:activation.hash};
  else anchor=(await pool.query<{number:string;hash:Hex32}>(`SELECT number::text,hash FROM ${schema}.chain_blocks WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND canonical AND finalized AND number<=$4 AND source_timestamp<=to_timestamp($5) ORDER BY number DESC LIMIT 1`,[...identity(deployment),point.number,from])).rows[0];
  const through=(await pool.query<{number:string;hash:Hex32}>(`SELECT number::text,hash FROM ${schema}.chain_blocks WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND canonical AND finalized AND number<=$4 AND source_timestamp>=to_timestamp($5) ORDER BY number LIMIT 1`,[...identity(deployment),point.number,to])).rows[0];
  if(!anchor||!through)throw new PublicationUnavailableError('statistics interval is not completely covered');
  const state=(await pool.query<{next_block:string;generation:string}>(`SELECT next_block::text,generation::text FROM ${schema}.ingestion_checkpoints WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND stream='frontend-events'`,identity(deployment))).rows[0];
  const generation=point.generation??state?.generation;if(!state||!generation||BigInt(state.next_block)<=BigInt(through.number))throw new PublicationUnavailableError('statistics interval is not completely covered');
  const ranges=await pool.query<{from_block:string;to_block:string}>(`SELECT from_block::text,to_block::text FROM ${schema}.covered_ranges WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND generation=$4 AND complete AND to_block>=$5 AND from_block<=$6 ORDER BY from_block,to_block`,[...identity(deployment),generation,anchor.number,through.number]);
  let cursor=BigInt(anchor.number);for(const range of ranges.rows){const start=BigInt(range.from_block),end=BigInt(range.to_block);if(start>cursor)break;if(end>=cursor)cursor=end+1n;if(cursor>BigInt(through.number))break}
  if(cursor<=BigInt(through.number))throw new PublicationUnavailableError('statistics interval has a chain coverage gap');
  return{from,to,anchorNumber:Number(anchor.number),anchorHash:anchor.hash,throughNumber:Number(through.number),throughHash:through.hash,projectionNumber:Number(point.number),projectionHash:point.hash};
}
async function lastBuyFor(pool:Pool,schema:string,deployment:DeploymentIdentity,marketId:Hex32){const row=(await pool.query<{payload:TradeActivity}>(`SELECT t.payload FROM ${schema}.market_trades t JOIN ${schema}.chain_blocks b ON b.environment=t.environment AND b.chain_id=t.chain_id AND b.deployment_digest=t.deployment_digest AND b.hash=t.block_hash WHERE t.environment=$1 AND t.chain_id=$2 AND t.deployment_digest=$3 AND t.market_id=$4 AND (t.payload->>'side')='buy' AND b.canonical AND b.finalized ORDER BY b.number DESC,(t.payload->'source'->>'transactionIndex')::bigint DESC,t.log_index DESC LIMIT 1`,[...identity(deployment),marketId])).rows[0]?.payload;return row?sourcePosition(row):null}
function sourcePosition(value:TradeActivity){return{blockNumber:value.source.blockNumber,transactionIndex:String(value.source.transactionIndex),logIndex:String(value.source.logIndex),timestamp:value.timestamp}}
function quoteDecimals(id:Hex32):number{const row=f72BootstrapConfigs.find(item=>item.kind==='quote'&&item.id===id);if(!row||!('quoteDecimals'in row.values))throw new Error('quote decimals unavailable');return Number(row.values.quoteDecimals)}
function baselineSupply(id:Hex32):string{const row=f72BootstrapConfigs.find(item=>item.kind==='baseline'&&item.id===id);if(!row||!('supply'in row.values))throw new Error('baseline unavailable');return String(row.values.supply)}
function canonicalAmount(value:unknown,label:string):bigint{if(typeof value!=='string'||!/^(0|[1-9][0-9]*)$/.test(value))throw new PublicationUnavailableError(`${label} is unavailable`);return BigInt(value)}
function decimalProductRaw(raw:string,decimals:number,price:string){return decimalProduct(decimalFromRaw(raw,decimals),price)}
function decimalFromRaw(raw:string,decimals:number){const value=BigInt(raw);const scale=10n**BigInt(decimals);return `${value/scale}.${(value%scale).toString().padStart(decimals,'0')}`}
function decimalFromRational(n:string,d:string){const scale=10n**36n;const value=BigInt(n)*scale/BigInt(d);return `${value/scale}.${(value%scale).toString().padStart(36,'0')}`}
function decimalProduct(a:string,b:string){const parse=(v:string)=>{const[i,f='']=v.split('.');return{x:BigInt(i!+f),s:f.length}};const x=parse(a),y=parse(b),s=x.s+y.s;let raw=(x.x*y.x).toString().padStart(s+1,'0');const out=s?`${raw.slice(0,-s)}.${raw.slice(-s)}`:raw;return out.replace(/0+$/,'').replace(/\.$/,'')||'0'}
function midpoint(a:string,b:string){const scale=18;const read=(v:string)=>{const[i,f='']=v.split('.');return BigInt(i!+f.padEnd(scale,'0').slice(0,scale))};const n=(read(a)+read(b))/2n;return `${n/10n**18n}.${(n%10n**18n).toString().padStart(18,'0')}`}
function identity(d:DeploymentIdentity):[string,number,string]{return[d.environment,d.chainId,d.deploymentDigest]}
function identifier(v:string){if(!/^[a-z][a-z0-9_]{0,62}$/.test(v))throw new Error('invalid database schema name');return`"${v}"`}
