/** Bounded, explicitly operated Curve sweep. One durable signed intent at a time. */
import {createPublicClient,custom,encodeFunctionData,keccak256,parseAbi,parseTransaction,recoverTransactionAddress,type Address,type Hex,type LocalAccount,type TransactionSerialized} from 'viem';
import type {PublicationRpcTransport} from './holder-publication-rpc.ts';
import {decodeMarketRecord,legacyMarketRecordAbi} from '../../chain/src/market-record.ts';
import {fixedF72Sources} from '../../events/src/index.ts';
export const sweepAbi=parseAbi(['function sweepCurveFees()','function accruedCurveFees() view returns(uint256)']);
export type SweepPolicy={chainId:number;releaseId:string;maxTxGasWei:bigint;dailyGasWei:bigint;minByAsset:Readonly<Record<string,string>>;finality:'finalized'|'delay';delaySeconds:number};
export type SweepJournal={chainId:number;releaseId:string;signer:string;day:string;reserved:string;cursor:string;pending:null|{raw:Hex;hash:Hex;market:Hex;curve:Address;quote:Address;nonce:number};last?:{market:string;hash:string;status:string}};
export function sweepBudget(policy:SweepPolicy,reserved:bigint,cost:bigint){if(reserved<0n||cost<=0n||cost>policy.maxTxGasWei||reserved+cost>policy.dailyGasWei)throw Error('Creator sweep gas budget exceeded');}
export async function sweepOnce(o:{rpc:PublicationRpcTransport;policy:SweepPolicy;journal:SweepJournal;save:()=>Promise<void>;account?:LocalAccount;retrySigned?:boolean;candidate?:{marketId:Hex;quoteAsset:Address}}){
 const {rpc,policy:p,journal:j}=o;
 if(!/^(0|[1-9][0-9]*)$/.test(j.reserved)||!p.minByAsset||Array.isArray(p.minByAsset)||typeof p.minByAsset!=='object'||j.chainId!==p.chainId||j.releaseId!==p.releaseId||!/^0x[0-9a-f]{40}$/i.test(j.signer)||p.maxTxGasWei<=0n||p.dailyGasWei<=0n||!['finalized','delay'].includes(p.finality)||!Number.isInteger(p.delaySeconds)||p.delaySeconds<60)throw Error('Invalid Creator sweep policy');
 const client=createPublicClient({transport:custom({request:({method,params})=>rpc.call(method,params as unknown[]??[])})});
 if(await client.getChainId()!==p.chainId)throw Error('Creator sweep chain mismatch');
 const registry=fixedF72Sources().find(s=>s.module==='MarketRegistryV1')!;
 const head=await client.getBlock();
 if(!registry.runtimeCodeHash||keccak256(await client.getCode({address:registry.address,blockNumber:head.number})??'0x')!==registry.runtimeCodeHash)throw Error('Creator registry code mismatch');
 async function market(id:Hex){const data=await client.call({to:registry.address,data:encodeFunctionData({abi:legacyMarketRecordAbi,functionName:'market',args:[id]}),blockNumber:head.number});if(!data.data)throw Error('Creator market missing');return decodeMarketRecord(data.data);}
 if(j.pending){
  const pending=j.pending,record=await market(pending.market);
  await verifySweepIntent(p,j,record);
  const receipt=await rpc.call<any>('eth_getTransactionReceipt',[pending.hash]);
  if(!receipt){
   if(o.retrySigned){
    // Rebroadcast only the journal's validated bytes, never a replacement nonce or a new fee.
    if(await client.getTransactionCount({address:j.signer as Address,blockTag:'latest'})>pending.nonce)throw Error('Creator nonce consumed without matching receipt');
    const sent=await rpc.call<string>('eth_sendRawTransaction',[pending.raw]);if(sent.toLowerCase()!==pending.hash)throw Error('Creator sweep submission mismatch');
   }
   return {status:'pending'};
  }
  const b=await client.getBlock({blockNumber:BigInt(receipt.blockNumber)});
  if(b.hash!==receipt.blockHash||receipt.transactionHash!==pending.hash||receipt.to?.toLowerCase()!==pending.curve.toLowerCase()||receipt.from?.toLowerCase()!==j.signer.toLowerCase())throw Error('Creator sweep receipt mismatch');
  if(!['0x0','0x1'].includes(receipt.status))throw Error('Creator sweep receipt status invalid');
  if(p.finality==='finalized'){
   const final=await rpc.finalizedBlock();if((await client.getBlock({blockNumber:final.number})).hash!==final.hash)throw Error('Creator finality anchor changed');
   if(b.number>final.number)return {status:'confirming'};
  }else if(head.timestamp<b.timestamp+BigInt(p.delaySeconds))return {status:'confirming'};
  if((await client.getBlock({blockNumber:b.number})).hash!==b.hash)throw Error('Creator sweep receipt reorganized');
  j.last={market:pending.market,hash:pending.hash,status:receipt.status==='0x1'?'confirmed':'reverted'};j.pending=null;await o.save();return j.last;
 }
 if(!o.candidate||!o.account)return {status:'idle'};
 if(o.account.address.toLowerCase()!==j.signer.toLowerCase())throw Error('Creator sweep signer mismatch');
 const c=o.candidate,record=await market(c.marketId),curve=record.config.curve;
 if(record.config.quoteAsset.toLowerCase()!==c.quoteAsset.toLowerCase()||Number(record.runtime.launchPhase)!==0)return {status:'skipped'};
 const min=p.minByAsset[c.quoteAsset.toLowerCase()];if(!min||!/^[1-9][0-9]*$/.test(min))return {status:'skipped'};
 const amount=await client.readContract({address:curve,abi:sweepAbi,functionName:'accruedCurveFees',blockNumber:head.number});if(amount<BigInt(min))return {status:'below_threshold'};
 const day=new Date().toISOString().slice(0,10);if(j.day!==day){j.day=day;j.reserved='0';}
 const data=encodeFunctionData({abi:sweepAbi,functionName:'sweepCurveFees'}),to=curve;
 await client.call({account:o.account.address,to,data,blockNumber:head.number});
 const nonce=await client.getTransactionCount({address:o.account.address,blockTag:'pending'});
 if(nonce!==await client.getTransactionCount({address:o.account.address,blockTag:'latest'}))throw Error('Creator signer has pending transactions');
 const gas=(await client.estimateGas({account:o.account.address,to,data}))*120n/100n,gasPrice=await client.getGasPrice(),cost=gas*gasPrice;
 sweepBudget(p,BigInt(j.reserved),cost);if(await client.getBalance({address:o.account.address})<cost)throw Error('Creator signer balance insufficient');
 if((await client.getBlock({blockNumber:head.number})).hash!==head.hash||await client.getTransactionCount({address:o.account.address,blockTag:'pending'})!==nonce)throw Error('Creator sweep preflight changed');
 const raw=await o.account.signTransaction({chainId:p.chainId,type:'legacy',to,data,value:0n,gas,gasPrice,nonce}),hash=keccak256(raw);
 j.reserved=(BigInt(j.reserved)+cost).toString();j.pending={raw,hash,market:c.marketId,curve,quote:c.quoteAsset,nonce};await o.save();
 // A send timeout is uncertain: the journal retains the exact intent and blocks further signing.
 const returned=await rpc.call<string>('eth_sendRawTransaction',[raw]);if(returned.toLowerCase()!==hash)throw Error('Creator sweep submission mismatch');
 return {status:'submitted',hash};
}

export async function verifySweepIntent(p:SweepPolicy,j:SweepJournal,record:ReturnType<typeof decodeMarketRecord>){
 const pending=j.pending;if(!pending)throw Error('Creator sweep intent missing');const tx=parseTransaction(pending.raw);
  if(keccak256(pending.raw)!==pending.hash||(await recoverTransactionAddress({serializedTransaction:pending.raw as TransactionSerialized})).toLowerCase()!==j.signer.toLowerCase()||tx.chainId!==p.chainId||tx.to?.toLowerCase()!==pending.curve.toLowerCase()||record.config.curve.toLowerCase()!==pending.curve.toLowerCase()||record.config.quoteAsset.toLowerCase()!==pending.quote.toLowerCase()||tx.data!==encodeFunctionData({abi:sweepAbi,functionName:'sweepCurveFees'})||(tx.value??0n)!==0n||tx.nonce!==pending.nonce)throw Error('Creator sweep intent mismatch');
 if(!tx.gas||!tx.gasPrice||tx.gas*tx.gasPrice>p.maxTxGasWei)throw Error('Creator sweep intent gas exceeds budget');
}
