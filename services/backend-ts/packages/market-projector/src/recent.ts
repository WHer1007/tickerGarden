import {formatUnits,parseUnits} from 'viem';
import type {MarketReadModel} from '../../../openapi/generated/v1-client.ts';
import {publicMarketContent} from '../../confirmed-display/src/content.ts';
import {displayUsd} from '../../confirmed-display/src/state.ts';
import {latestPrices,preferredPrices} from '../../display-price/src/read.ts';
import type {Pool} from 'pg';
import {consensusBlock,parseLog,type DeploymentIdentity,type RpcTransport} from '../../chain/src/index.ts';
import {decodeF72Event,eventTopic,f72EventCatalog} from '../../events/src/index.ts';
import {creationFromEvent,observeF72Market} from './index.ts';
import {creationDetail} from './recent-detail.ts';

export interface RecentLaunchInput {pool:Pool;deployment:DeploymentIdentity;primary:RpcTransport;secondary:RpcTransport;schemaName?:string}
const factory=f72EventCatalog.TickerGardenFactoryV1.address;
const topic=eventTopic('TickerGardenFactoryV1','MarketCreated');
function schemaFor(input:RecentLaunchInput){const name=input.schemaName??'tickergarden_serverless';if(!/^[a-z][a-z0-9_]{0,62}$/.test(name))throw Error('invalid schema');return `"${name}"`;}

// The caller supplies only a transaction hash. Identity, metadata and amounts
// come from independently checked backend observations, never browser fields.
export async function recordRecentLaunch(input:RecentLaunchInput,txHash:`0x${string}`){
 if(!/^0x[0-9a-f]{64}$/.test(txHash))throw Error('invalid transaction hash');
 const schema=schemaFor(input),identity=[input.deployment.environment,input.deployment.chainId,input.deployment.deploymentDigest];
 const known=await input.pool.query<{market_id:string}>(`SELECT market_id FROM ${schema}.recent_markets WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND transaction_hash=$4 AND canonical AND expires_at>now()`,[...identity,txHash]);
 if(known.rows.length)return {marketId:known.rows[0]!.market_id,status:'confirmed' as const};
 const chains=await Promise.all([input.primary,input.secondary].map(rpc=>rpc.call<string>('eth_chainId',[])));
 if(chains.some(id=>BigInt(id)!==BigInt(input.deployment.chainId)))throw Error('Launch observer chain mismatch');
 const receipts=await Promise.all([input.primary,input.secondary].map(rpc=>rpc.call<Record<string,unknown>|null>('eth_getTransactionReceipt',[txHash])));
 const events=receipts.map(receipt=>{
  if(!receipt||receipt.transactionHash!==txHash||receipt.status!=='0x1'||!Array.isArray(receipt.logs))throw Error('Successful creation receipt is not available');
  const logs=receipt.logs.map(log=>parseLog(log as Record<string,unknown>)).filter(log=>log.address===factory&&log.topics[0]===topic);
  if(logs.length!==1)throw Error('Receipt must contain one canonical Factory MarketCreated event');
  const log=logs[0]!;
  if(log.removed||log.transactionHash!==txHash||log.blockHash!==receipt.blockHash||log.blockNumber!==BigInt(String(receipt.blockNumber))||log.blockNumber<input.deployment.activationBlock)throw Error('Creation receipt binding mismatch');
  return log;
 });
 const [first,second]=events;
 const stable=(log:typeof first)=>JSON.stringify(log,(_key,value)=>typeof value==='bigint'?value.toString():value);
 if(stable(first)!==stable(second))throw Error('RPC providers disagree on creation event');
 const block=await consensusBlock(input.primary,input.secondary,first!.blockNumber);
 if(block.hash!==first!.blockHash)throw Error('Creation block is no longer canonical');
 const decoded=decodeF72Event('TickerGardenFactoryV1',first!);
 if(!decoded||decoded.eventName!=='MarketCreated')throw Error('Invalid creation event');
 const creation=creationFromEvent(decoded.args,first!,input.deployment.chainId);
 const market=await observeF72Market({creation,blockNumber:block.number,blockHash:block.hash,blockTimestamp:block.timestamp,primary:input.primary,secondary:input.secondary});
 const after=await consensusBlock(input.primary,input.secondary,block.number);
 if(after.hash!==block.hash)throw Error('Creation reorganized during observation');
 const initialDetail=creationDetail(receipts,market as unknown as Parameters<typeof creationDetail>[1],block.timestamp,input.deployment.chainId);
 const model=market as unknown as MarketReadModel,now=new Date();
 const reference=preferredPrices(await latestPrices(input.pool,input.deployment,now,input.schemaName),now).get(model.quoteAsset);
 const usd=reference?.status==='available'&&reference.bidUsd&&reference.askUsd?formatUnits((parseUnits(reference.bidUsd,36)+parseUnits(reference.askUsd,36))/2n,36):null;
 initialDetail.statistics={...initialDetail.statistics,price:model.display?.priceQuote??initialDetail.statistics.price,...displayUsd(model.display?.priceQuote??initialDetail.statistics.price,initialDetail.holders.totalSupplyRaw,usd)};
 const content=await publicMarketContent(input.pool,model,input.schemaName);
 const payload={...(market as Record<string,unknown>),content,confirmation:{status:'confirmed',blockNumber:block.number.toString(),blockHash:block.hash,observedAt:new Date().toISOString()}};
 const stored=await input.pool.query(`INSERT INTO ${schema}.recent_markets(environment,chain_id,deployment_digest,market_id,transaction_hash,block_number,block_hash,payload,initial_detail)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(environment,chain_id,deployment_digest,market_id) DO UPDATE SET
 transaction_hash=excluded.transaction_hash,block_number=excluded.block_number,block_hash=excluded.block_hash,payload=excluded.payload,initial_detail=excluded.initial_detail,canonical=true,observed_at=now(),expires_at=now()+interval '30 minutes'
 WHERE recent_markets.block_hash<>excluded.block_hash OR recent_markets.canonical RETURNING market_id`,
 [...identity,creation.marketId,txHash,block.number.toString(),block.hash,JSON.stringify(payload),JSON.stringify(initialDetail)]);
 if(!stored.rowCount)throw Error('Creation was removed while being observed');
 return {marketId:creation.marketId,status:'confirmed' as const};
}

export async function recordRecentLaunchTrigger(input:RecentLaunchInput,payload:Readonly<Record<string,unknown>>){
 const log=payload.log as Record<string,unknown>|undefined;
 if(log?.address!==factory||!Array.isArray(log.topics)||log.topics[0]!==topic)return;
 if(log.removed===true){
  if(typeof log.topics[1]!=='string'||!/^0x[0-9a-f]{64}$/.test(log.topics[1]))throw Error('Invalid removed market identity');
  await input.pool.query(`INSERT INTO ${schemaFor(input)}.recent_markets(environment,chain_id,deployment_digest,market_id,block_number,transaction_hash,block_hash,canonical,payload)
   VALUES($1,$2,$3,$4,$5,$6,$7,false,'{}') ON CONFLICT(environment,chain_id,deployment_digest,market_id) DO UPDATE SET canonical=false
   WHERE recent_markets.block_hash=excluded.block_hash`,
   [input.deployment.environment,input.deployment.chainId,input.deployment.deploymentDigest,log.topics[1],String(log.blockNumber),log.transactionHash,log.blockHash]);
 }else await recordRecentLaunch(input,log.transactionHash as `0x${string}`);
}
