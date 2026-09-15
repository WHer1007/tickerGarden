import directAbis_TickerGardenFactoryV1 from './generated/contracts/current/TickerGardenFactoryV1.ts';
import directAbis_MarketRegistryV1 from './generated/contracts/current/MarketRegistryV1.ts';
import directAbis_TickerGardenCurve from './generated/contracts/current/TickerGardenCurve.ts';
import directAbis_TickerMemeTokenV1 from './generated/contracts/current/TickerMemeTokenV1.ts';
import directAbis_MemeStockGauge from './generated/contracts/current/MemeStockGauge.ts';
import { externalTradingService } from '../../../../services/backend-ts/packages/chain/src/external-trading.ts';
import {decodeEventLog,type Abi,type Address,type Hex,type TransactionReceipt} from 'viem';

import type {MarketDetailResponse,MarketReadModel,SourceBlock} from './generated/read-api.ts';
import type {IntegrationBootstrap} from './integrationBootstrap.ts';
export type ReadState=(address:Address,abi:Abi,name:string,args:readonly unknown[],block:bigint)=>Promise<unknown>;
export type DirectFeeConfig=Readonly<{creatorTaxBps:number;activeStakeRaw:string}>;
export type DirectMarket=Omit<MarketDetailResponse,'market'> & {observation:'direct-chain';market:MarketReadModel&{directFeeConfig:DirectFeeConfig}};
const zero='0x0000000000000000000000000000000000000000',hexzero=`0x${'0'.repeat(64)}`;
const addr=(v:unknown):Address=>{if(typeof v!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(v))throw Error('Invalid market address');return v.toLowerCase() as Address;};
const uint=(v:unknown)=>{if(typeof v!=='bigint'||v<0n)throw Error('Invalid market state');return v.toString();};
const text=(v:unknown,label:string,max:number)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw Error(`Invalid ${label}`);return v;};
/** Market addresses come from this release's Factory logs, then current Registry state. */
export class DirectMarkets {
 readonly sources=new Map<Hex,SourceBlock>();
 readonly cache=new Map<Hex,{at:number,value:DirectMarket}>();
 readonly deployment:IntegrationBootstrap;
 readonly read:ReadState;
 readonly head:()=>Promise<{number:bigint;hash:Hex}>;
 readonly storage?:Pick<Storage,'getItem'|'setItem'>;
  readonly discover?: (id:Hex,head:bigint)=>Promise<void>;
  readonly pending=new Map<Hex,Promise<DirectMarket>>();
  private headCache?: {at:number,value:{number:bigint;hash:Hex}};
  private headPending?: Promise<{number:bigint;hash:Hex}>;
 constructor(deployment:IntegrationBootstrap,read:ReadState,head:()=>Promise<{number:bigint;hash:Hex}>,storage?:Pick<Storage,'getItem'|'setItem'>,discover?:(id:Hex,head:bigint)=>Promise<void>){
  this.deployment=deployment;this.read=read;this.head=head;this.storage=storage;this.discover=discover;
  try{const rows=JSON.parse(storage?.getItem(this.key())??'[]') as [Hex,SourceBlock][];for(const [id,source] of rows){if(/^0x[0-9a-f]{64}$/.test(id)&&source.chainId===deployment.chainId&&/^0x[0-9a-f]{64}$/.test(source.transactionHash))this.sources.set(id,source);}}catch{/* local display cache is optional */}
 }
 key(){return `tickergarden:direct:${this.deployment.releaseId}`;}
 observe(log:{address:string;topics:readonly Hex[];data:Hex;blockNumber:bigint;blockHash:Hex;transactionHash:Hex;transactionIndex:number;logIndex:number}){
  if(log.address.toLowerCase()!==this.deployment.factory)return;
  try{const decoded=decodeEventLog({abi:directAbis_TickerGardenFactoryV1,topics:log.topics as [Hex,...Hex[]],data:log.data});if(decoded.eventName!=='MarketCreated')return;
   const id=decoded.args.marketId.toLowerCase() as Hex;
   this.sources.set(id,{chainId:this.deployment.chainId,blockNumber:log.blockNumber.toString(),blockHash:log.blockHash,transactionHash:log.transactionHash,transactionIndex:log.transactionIndex,logIndex:log.logIndex});
   try{this.storage?.setItem(this.key(),JSON.stringify([...this.sources]));}catch{}
  }catch{/* unrelated Factory events */}
 }
 receipt(receipt:TransactionReceipt){for(const log of receipt.logs)if(log.blockNumber!==null&&log.blockHash&&log.transactionHash&&log.transactionIndex!==null&&log.logIndex!==null)this.observe({...log,blockNumber:log.blockNumber,blockHash:log.blockHash,transactionHash:log.transactionHash,transactionIndex:log.transactionIndex,logIndex:log.logIndex});this.cache.clear();this.headCache=undefined;this.headPending=undefined;}
 private async currentHead(){
  const cached=this.headCache;if(cached&&Date.now()-cached.at<1_000)return cached.value;
  if(!this.headPending){
   const request=this.head();
   this.headPending=request;
   request.then(value=>{if(this.headPending===request)this.headCache={at:Date.now(),value};},()=>{}).finally(()=>{if(this.headPending===request)this.headPending=undefined;});
  }
  return this.headPending;
 }
 async market(id:Hex):Promise<DirectMarket>{
  const old=this.cache.get(id);if(old&&Date.now()-old.at<15_000)return old.value;
  const pending=this.pending.get(id);if(pending)return pending;
  const request=this.load(id);this.pending.set(id,request);
  try{return await request;}finally{this.pending.delete(id);}
 }
 private async load(id:Hex):Promise<DirectMarket>{
  const head=await this.currentHead(),registry=this.deployment.bindings.marketRegistry;
  if(!this.sources.has(id))await this.discover?.(id,head.number);
  const source=this.sources.get(id);if(!source)throw Error('Market creation has not been observed for this deployment');
  const [record,route]=await Promise.all([this.read(registry,directAbis_MarketRegistryV1,'market',[id],head.number),this.read(registry,directAbis_MarketRegistryV1,'canonicalRoute',[id],head.number)]) as [any,any];
  const c=record.config,r=record.runtime;if(!c||!r||addr(c.curve)===zero||addr(c.memeToken)===zero)throw Error('Market is not currently registered');
  const curve=addr(c.curve);
  const token=addr(c.memeToken);
  const [reserve,sellable,reserved,fees,ready,executor,name,symbol,metadataURI,deployedAt,creator,activeStake]=await Promise.all([
   ...['realQuoteReserve','sellableTokens','reservedTokens','accruedCurveFees','readyToGraduate'].map(functionName=>this.read(curve,directAbis_TickerGardenCurve,functionName,[],head.number)),
   this.read(registry,directAbis_MarketRegistryV1,'graduationExecutor',[],head.number),
   ...['name','symbol','metadataURI','deployedAt','creator'].map(functionName=>this.read(token,directAbis_TickerMemeTokenV1,functionName,[],head.number)),
   c.stakingEnabled?this.read(addr(c.gauge),directAbis_MemeStockGauge,'effectiveTotalActiveStock',[],head.number):Promise.resolve(0n),
  ]);
  const phase=Number(r.launchPhase);if((phase!==0&&phase!==1)||typeof ready!=='boolean')throw Error('Invalid market phase');
  const tokenName=text(name,'token name',64),tokenSymbol=text(symbol,'token symbol',16),uri=text(metadataURI,'metadata URI',2048);
  if(!/^[A-Za-z0-9]{1,16}$/.test(tokenSymbol))throw Error('Invalid token symbol');
  const template=this.deployment.configs.find(config=>config.kind==='template'&&config.id===c.launchTemplateId);
  const runtimeCodeHash=typeof template?.values.memeTokenCodeHash==='string'&&/^0x[0-9a-fA-F]{64}$/.test(template.values.memeTokenCodeHash)?template.values.memeTokenCodeHash.toLowerCase() as Hex:hexzero as Hex;
  const lpFeePips=Number(c.lpFeePips);if(![0,1000,2000,3000].includes(lpFeePips))throw Error('Invalid LP fee');
  const creatorTaxBps=Number(c.creatorTaxBps);if(!Number.isInteger(creatorTaxBps)||creatorTaxBps<0||creatorTaxBps>500)throw Error('Invalid Creator Tax');
  const value:DirectMarket={observation:'direct-chain',sync:{chainId:this.deployment.chainId,status:'synced',finality:'head',blockNumber:head.number.toString(),blockHash:head.hash,headBlockNumber:head.number.toString(),headBlockHash:head.hash,lagBlocks:'0',revision:`${head.number}:${head.hash}`},market:{marketId:id,assetUid:c.assetUid,memeToken:token,curve,gauge:addr(c.gauge),quoteAsset:addr(c.quoteAsset),quoteAssetConfigId:c.quoteAssetConfigId,tickerGardenBaselineId:c.tickerGardenBaselineId,sourceVersion:Number(r.sourceVersion),launchPhase:phase,curveProgress:{realQuoteReserve:uint(reserve),sellableTokens:uint(sellable),reservedTokens:uint(reserved),accruedCurveFees:uint(fees),readyToGraduate:ready},poolId:r.poolId===hexzero?null:r.poolId,poolKey:r.poolId===hexzero?null:route.poolKey,canonicalRoute:{router:externalTradingService(this.deployment.chainId)?.router??zero,quoter:externalTradingService(this.deployment.chainId)?.quoter??zero,hook:addr(route.hook),launchLocker:addr(route.launchLocker),graduationExecutor:addr(executor),curveTradingEnabled:route.curveTradingEnabled,poolTradingEnabled:route.poolTradingEnabled,sourceVersion:Number(route.sourceVersion),launchPhase:phase},source,creator:addr(creator),creatorFeesToHolders:Boolean(c.creatorFeesToHolders),burnMemeFees:Boolean(c.burnMemeFees),lpFeePips:lpFeePips as 0|1000|2000|3000,stakingEnabled:Boolean(c.stakingEnabled),directFeeConfig:{creatorTaxBps,activeStakeRaw:uint(activeStake)},identity:{name:tokenName,symbol:tokenSymbol,metadataURI:uri,deployedAt:uint(deployedAt),blockNumber:head.number.toString(),blockHash:head.hash,runtimeCodeHash}}};
  this.cache.set(id,{at:Date.now(),value});return value;
 }
}
