import { TickerGardenV1Client } from './generated/read-api.ts';
export type HolderMarket={marketId:string;memeToken:string;name:string;symbol:string};
const cache=new Map<string,{at:number;items:HolderMarket[]}>();
export async function searchHolderMarkets(base:string,chainId:number,q:string,signal?:AbortSignal):Promise<HolderMarket[]>{
 const url=new URL(`${base.replace(/\/+$/,'')}/v1/holder-markets`);url.searchParams.set('q',q.trim());
 const key=`${chainId}:${url}`;const prior=cache.get(key);if(prior&&Date.now()-prior.at<60000)return prior.items;
 const page=await new TickerGardenV1Client(base,(input,init)=>fetch(input,{...init,signal})).searchHolderMarkets({q:q.trim()});
 if(page.chainId!==chainId||page.complete!==true||!Array.isArray(page.items)||page.items.length>20)throw Error('Token Directory Updating');
 const seen=new Set<string>();
 for(const item of page.items){if(!/^0x[0-9a-f]{64}$/.test(item.marketId)||!/^0x[0-9a-f]{40}$/.test(item.memeToken)||typeof item.name!=='string'||typeof item.symbol!=='string'||seen.has(item.marketId))throw Error('Invalid Token Directory');seen.add(item.marketId);}
 // Empty directories are often a transient indexing state for newly created markets.
 // Let the next search retry immediately; positive results use a short-lived cache.
 if(page.items.length){if(cache.size>=100)cache.delete(cache.keys().next().value!);cache.set(key,{at:Date.now(),items:page.items});}else cache.delete(key);
 return page.items;
}
