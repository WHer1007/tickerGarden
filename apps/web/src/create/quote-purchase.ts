import type {Address} from 'viem';
import {purchaseRequest} from '../../../../services/backend-ts/packages/chain/src/quote-purchase/transaction.ts';
import type {PurchaseQuote} from '../../../../services/backend-ts/packages/chain/src/quote-purchase/quote.ts';
export {purchaseRequest};
export type {PurchaseQuote};
export async function fetchPurchaseQuote(base:string,chainId:number,token:Address,amount:bigint,account:Address):Promise<PurchaseQuote>{
 const url=new URL(`${base.replace(/\/$/,'')}/v1/quote-purchase`);url.search=new URLSearchParams({chainId:String(chainId),token,amountOut:String(amount)}).toString();
 const response=await fetch(url,{signal:AbortSignal.timeout(15000),cache:'no-store'});
 if(!response.ok)throw Error('The paired asset purchase could not be quoted. Try again.');
 const q=await response.json() as PurchaseQuote;
 if(q.chainId!==chainId||q.token.toLowerCase()!==token.toLowerCase()||q.amountOut!==String(amount)||!Number.isSafeInteger(q.priceImpactBps)||q.priceImpactBps<0||q.priceImpactBps>10000)throw Error('Purchase quote changed. Try again.');
 purchaseRequest(q,account);return q;
}

export function assertPurchaseWithinApproval(fresh:PurchaseQuote,reviewed:PurchaseQuote|undefined):void {
 if(!reviewed||fresh.chainId!==reviewed.chainId||fresh.token!==reviewed.token||BigInt(fresh.amountOut)>BigInt(reviewed.amountOut)||BigInt(fresh.amountIn)>BigInt(reviewed.amountIn))throw Error('Purchase cost changed. Review the updated launch cost and try again.');
}
