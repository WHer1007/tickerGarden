import type {Address} from 'viem';
import {TRADE_NATIVE,TRADE_USDG,conversionRequest,type ConversionIntent,type ConversionQuote} from '../../../../services/backend-ts/packages/chain/src/quote-purchase/zeroex.ts';
export {TRADE_NATIVE,TRADE_USDG,conversionRequest};
export type {ConversionQuote};
export type PaymentAsset={address:Address;symbol:string;decimals:number};
export function paymentAssets(chainId:number,pair:PaymentAsset):PaymentAsset[]{
 return chainId!==4663?[pair]:[pair,...([{address:TRADE_USDG,symbol:'USDG',decimals:6},{address:TRADE_NATIVE,symbol:'ETH',decimals:18}] as PaymentAsset[]).filter(a=>a.address.toLowerCase()!==pair.address.toLowerCase())];
}
export async function fetchConversion(base:string,intent:ConversionIntent):Promise<ConversionQuote>{
 const u=new URL(`${base.replace(/\/$/,'')}/v1/trade-conversion`);u.search=new URLSearchParams({chainId:String(intent.chainId),sellToken:intent.sellToken,buyToken:intent.buyToken,sellAmount:intent.sellAmount,taker:intent.taker}).toString();
 const r=await fetch(u,{cache:'no-store',signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('This payment route is unavailable. Try again or use the paired asset.');
 const q=await r.json() as ConversionQuote;conversionRequest(q,intent);return q;
}
export type ConversionRecovery={account:Address;marketId:string;pair:Address;amount:string;minimum:string;state:'submitting'|'pending'|'funded'|'buy_submitting'|'buy_pending';buyTo?:Address;buyHash?:`0x${string}`;hash?:`0x${string}`};
export function recoveryKey(account:string,marketId:string){return `tickergarden:trade-conversion:4663:${account.toLowerCase()}:${marketId.toLowerCase()}`;}
export function readRecovery(storage:Pick<Storage,'getItem'>,account:Address,marketId:string):ConversionRecovery|null{
 try{const r=JSON.parse(storage.getItem(recoveryKey(account,marketId))??'null');if(!r||r.account.toLowerCase()!==account.toLowerCase()||r.marketId!==marketId||!/^0x[0-9a-fA-F]{40}$/.test(r.pair)||!['submitting','pending','funded','buy_submitting','buy_pending'].includes(r.state)||! /^[1-9]\d{0,38}$/.test(r.amount)||! /^[1-9]\d{0,38}$/.test(r.minimum)||(r.hash&&!/^0x[0-9a-fA-F]{64}$/.test(r.hash))||(r.buyHash&&!/^0x[0-9a-fA-F]{64}$/.test(r.buyHash))||(r.state.startsWith('buy_')&&!/^0x[0-9a-fA-F]{40}$/.test(r.buyTo??'')))return null;return r;}catch{return null;}
}

/** Consume startup journal receipts before a completed buy can be mistaken for a funded first leg. */
export function reconcileConversionJournal(storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>,account:Address,results:readonly import('../v1/transaction.ts').ReconciledPendingTransaction[]){
 for(const result of results){
  const p=result.pending;if(p.approval||p.businessType!=='trade'||!p.marketId)continue;
  const r=readRecovery(storage,account,p.marketId);if(!r)continue;
  const receipt=result.receipt;if(receipt.from.toLowerCase()!==account.toLowerCase())continue;
  const key=recoveryKey(account,p.marketId),ok=receipt.status==='success'&&!result.cancelled;
  if(p.operationKey.startsWith('trade:conversion:')&&['submitting','pending'].includes(r.state)){
   if(ok&&receipt.to?.toLowerCase()==='0x0000000000001ff3684f28c67538d4d072c22734')storage.setItem(key,JSON.stringify({...r,state:'funded',hash:receipt.transactionHash}));else storage.removeItem(key);
  }else if(r.state.startsWith('buy_')){
   if(ok&&receipt.to?.toLowerCase()===r.buyTo?.toLowerCase())storage.removeItem(key);
   else storage.setItem(key,JSON.stringify({...r,state:'funded',buyHash:undefined,buyTo:undefined}));
  }
 }
}
