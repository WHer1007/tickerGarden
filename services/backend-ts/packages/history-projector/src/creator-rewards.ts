import type {PoolClient} from 'pg';
import type {DecodedProtocolEvent} from '../../events/src/index.ts';
export const ZERO_CREATOR=`0x${'0'.repeat(40)}`;
export type CreatorBalance={marketId:string;epoch:number;beneficiary:string;asset:string;credited:string;paid:string;burned:string;remaining:string};
export type CreatorState={marketId:string;currentEpoch:number;pendingBeneficiary:string;curveFees:string;curveTax:string;market:CreatorMarket};
export interface CreatorMarket {marketId:string;memeToken:string;quoteAsset:string;creator:string;curve?:string;creatorTaxBps?:number;creatorFeesToHolders:boolean;creatorRevenueBeneficiaryAtCreation?:string;[key:string]:unknown}
const uint=(v:unknown)=>{const s=String(v);if(!/^(0|[1-9][0-9]*)$/.test(s))throw Error('Invalid Creator amount');return BigInt(s);};
const address=(v:unknown)=>{const s=String(v).toLowerCase();if(!/^0x[0-9a-f]{40}$/.test(s))throw Error('Invalid Creator address');return s;};
const epoch=(v:unknown)=>{const n=Number(uint(v));if(n<1||n>4294967295)throw Error('Invalid Creator epoch');return n;};
export function pendingCreatorQuote(state:CreatorState):bigint {
 const tax=uint(state.curveTax),total=uint(state.curveFees);if(tax>total)throw Error('Creator tax exceeds curve fees');
 const base=total-tax,creator=base-base*3000n/10000n;
 return tax+creator-(state.market.creatorFeesToHolders?creator/2n:0n);
}
export function changeCreatorBalance(row:CreatorBalance,kind:'credited'|'paid'|'burned',amount:bigint):CreatorBalance {
 if(amount<0n)throw Error('Negative Creator movement');
 const next={...row,[kind]:(uint(row[kind])+amount).toString()};
 const remaining=uint(next.credited)-uint(next.paid)-uint(next.burned);
 if(remaining<0n)throw Error('Creator reward ledger underflow');
 return {...next,remaining:remaining.toString()};
}
/** Called in the existing bounded history transaction; no new RPC scan or full-history replay. */
export async function creatorBlock(client:PoolClient,schema:string,id:readonly unknown[],block:{number:string;hash:string},events:readonly DecodedProtocolEvent[],markets:readonly CreatorMarket[],contribute:(scope:string,key:string,number:bigint,hash:any,payload:object)=>Promise<void>) {
 const byId=new Map(markets.map(m=>[m.marketId,m])),byCurve=new Map(markets.filter(m=>m.curve).map(m=>[m.curve!.toLowerCase(),m]));
 const directoryChanges=new Map<string,Set<string>>();
 const cache=new Map<string,any>();
 async function load(scope:string,key:string){const k=scope+':'+key;if(cache.has(k))return cache.get(k);
  const result=(await client.query(`SELECT h.payload FROM ${schema}.history_contributions h JOIN ${schema}.chain_blocks b ON b.environment=h.environment AND b.chain_id=h.chain_id AND b.deployment_digest=h.deployment_digest AND b.hash=h.block_hash WHERE h.environment=$1 AND h.chain_id=$2 AND h.deployment_digest=$3 AND h.scope=$4 AND h.identity=$5 AND h.block_number<$6 AND b.canonical AND b.finalized ORDER BY h.block_number DESC LIMIT 1`,[...id,scope,key,block.number])).rows[0]?.payload;cache.set(k,result);return result;
 }
 async function put(scope:string,key:string,payload:object){cache.set(scope+':'+key,payload);await contribute(scope,key,BigInt(block.number),block.hash,payload);}
 async function register(m:CreatorMarket,e:number,beneficiary:string){const key=`${m.marketId}:${e}`,prior=await load('creator-epoch',key);if(prior&&prior.beneficiary!==beneficiary)throw Error('Creator epoch beneficiary changed');await put('creator-epoch',key,{marketId:m.marketId,epoch:e,beneficiary});}
 for(const event of events){
  const a=event.args,n=event.eventName;
  const relevant=(event.module==='CreatorRevenueRegistry')||(event.module==='TickerGardenFactoryV1'&&n==='MarketCreated')||(event.module==='TickerGardenCurve'&&['CurveBuy','CurveSell'].includes(n))||(event.module==='ProtocolFeeVault'&&['CurveFeesSwept','FeeBucketsCredited','FeeClaimed','MemeFeesBurned'].includes(n));
  if(!relevant)continue;
  if(n==='FeeClaimed'&&uint(a.beneficiaryType)!==0n)continue;
  if(n==='MemeFeesBurned'&&uint(a.role)!==0n)continue;
  const market=event.module==='TickerGardenCurve'?byCurve.get(event.log.address.toLowerCase()):byId.get(String(a.marketId).toLowerCase());
  if(!market)throw Error('Creator event market is not registered');
  const previous=await load('creator-state',market.marketId) as CreatorState|undefined;
  const state:CreatorState={...(previous??{marketId:market.marketId,currentEpoch:0,pendingBeneficiary:ZERO_CREATOR,curveFees:'0',curveTax:'0'}),market};
  if(n.startsWith('CreatorRevenue')||n==='MarketCreated'){const accounts=directoryChanges.get(market.marketId)??new Set<string>();for(const value of [market.creator,previous?.pendingBeneficiary,...Object.values(a)])if(typeof value==='string'&&/^0x[0-9a-f]{40}$/i.test(value)&&value!==ZERO_CREATOR)accounts.add(value.toLowerCase());directoryChanges.set(market.marketId,accounts);}
  if(n==='CreatorRevenueEpochInitialized'){state.currentEpoch=epoch(a.epoch);await register(market,state.currentEpoch,address(a.beneficiary));}
  else if(n==='MarketCreated'&&state.currentEpoch===0){state.currentEpoch=1;await register(market,1,address(market.creatorRevenueBeneficiaryAtCreation??market.creator));}
  else if(n==='CreatorRevenueBeneficiaryProposed'){if(epoch(a.epoch)!==state.currentEpoch)throw Error('Creator proposal epoch mismatch');state.pendingBeneficiary=address(a.pendingBeneficiary);}
  else if(n==='CreatorRevenueBeneficiaryTransferCancelled'){if(epoch(a.epoch)!==state.currentEpoch)throw Error('Creator cancellation epoch mismatch');state.pendingBeneficiary=ZERO_CREATOR;}
  else if(n==='CreatorRevenueBeneficiaryUpdated'){
   if(epoch(a.oldEpoch)!==state.currentEpoch||epoch(a.newEpoch)!==state.currentEpoch+1||uint(state.curveFees)!==0n)throw Error('Creator handoff accounting mismatch');
   const old=await load('creator-epoch',`${market.marketId}:${state.currentEpoch}`);if(!old||old.beneficiary!==address(a.oldBeneficiary))throw Error('Creator old beneficiary mismatch');
   if(state.pendingBeneficiary!==address(a.newBeneficiary))throw Error('Creator acceptance recipient mismatch');
   state.currentEpoch=epoch(a.newEpoch);state.pendingBeneficiary=ZERO_CREATOR;await register(market,state.currentEpoch,address(a.newBeneficiary));
  } else if(n==='CurveBuy'||n==='CurveSell'){
   const bps=market.creatorTaxBps??(market.display as {creatorTaxBps?:number}|undefined)?.creatorTaxBps;if(!Number.isInteger(bps)||bps!<0||bps!>500)throw Error('Creator tax metadata unavailable');
   const fee=uint(a.fee),tax=uint(a.tax),creatorTax=n==='CurveSell'?tax:uint(a.quoteIn)*BigInt(bps!)/10000n;
   if(creatorTax>tax)throw Error('Creator curve tax mismatch');state.curveFees=(uint(state.curveFees)+fee+tax).toString();state.curveTax=(uint(state.curveTax)+creatorTax).toString();
  } else if(['CurveFeesSwept','FeeBucketsCredited','FeeClaimed','MemeFeesBurned'].includes(n)){
   const e=epoch(n==='FeeClaimed'?a.beneficiaryEpoch:a.creatorEpoch),owner=await load('creator-epoch',`${market.marketId}:${e}`);
   if(!owner)throw Error('Creator credit has no beneficiary epoch');
   const asset=address(n==='CurveFeesSwept'?a.quoteAsset:n==='MemeFeesBurned'?a.token:a.feeAsset);
   if(![market.quoteAsset,market.memeToken].includes(asset))throw Error('Creator reward asset mismatch');
   if(['FeeClaimed','MemeFeesBurned'].includes(n)&&address(a.beneficiary)!==owner.beneficiary)throw Error('Creator reward recipient mismatch');
   const key=`${market.marketId}:${e}:${asset}`,row:CreatorBalance=await load('creator-balance',key)??{marketId:market.marketId,epoch:e,beneficiary:owner.beneficiary,asset,credited:'0',paid:'0',burned:'0',remaining:'0'};
   await put('creator-balance',key,changeCreatorBalance(row,n==='FeeClaimed'?'paid':n==='MemeFeesBurned'?'burned':'credited',uint(n==='FeeClaimed'||n==='MemeFeesBurned'?a.amount:a.creatorAmount)));
   if(n==='CurveFeesSwept'){if(e!==state.currentEpoch||uint(a.creatorAmount)!==pendingCreatorQuote(state))throw Error('Creator sweep allocation mismatch');if(uint(a.amount)!==uint(state.curveFees))throw Error('Creator curve sweep mismatch');state.curveFees='0';state.curveTax='0';}
  }
  await put('creator-state',market.marketId,state);
 }
 return directoryChanges;
}
export async function materializeCreator(client:PoolClient,schema:string,id:readonly unknown[],scope:string,key:string,payload:any,hash:string|undefined){
 if(scope==='creator-epoch'){
  const [market,e]=key.split(':');await client.query(`DELETE FROM ${schema}.creator_reward_epochs WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4 AND epoch=$5`,[...id,market,e]);
  if(payload)await client.query(`INSERT INTO ${schema}.creator_reward_epochs VALUES($1,$2,$3,$4,$5,$6,$7)`,[...id,payload.marketId,payload.epoch,payload.beneficiary,hash]);
 }else if(scope==='creator-balance'){
  const [market,e,asset]=key.split(':');await client.query(`DELETE FROM ${schema}.creator_reward_balances WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4 AND epoch=$5 AND asset=$6`,[...id,market,e,asset]);
  if(payload)await client.query(`INSERT INTO ${schema}.creator_reward_balances VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[...id,payload.marketId,payload.epoch,payload.beneficiary,payload.asset,payload.credited,payload.paid,payload.burned,payload.remaining,hash]);
 }
}
