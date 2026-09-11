import {formatUnits,parseUnits} from 'viem';
export type MarketOverview = {supply?:string;maximum?:string;price?:string;usd?:string;volume24h?:string;holders?:{count:number;items:Array<{account:string;balanceRaw:string}>};};
const scale=10n**36n;
export function marketCapUsd(supply:string|undefined,price:string|undefined,usd:string|undefined):string|null{
 if(supply===undefined||price===undefined||usd===undefined)return null;
 try{return formatUnits(BigInt(supply)*parseUnits(price,36)*parseUnits(usd,36)/(10n**18n*scale),36);}catch{return null;}
}
export function poolSpotPrice(sqrt:bigint,memeIsCurrency0:boolean,quoteDecimals:number):string{
 if(sqrt<=0n)throw Error('Pool Not Initialized');
 const squared=sqrt*sqrt,q192=1n<<192n;
 return formatUnits((memeIsCurrency0?squared*scale/q192:q192*scale/squared)*10n**18n/10n**BigInt(quoteDecimals),36);
}
const cache=new Map<string,{until:number;value:unknown}>();
const requests=new Map<string,Promise<any>>();
export async function overviewJson(url:string):Promise<any>{
 const saved=cache.get(url);if(saved&&saved.until>Date.now())return saved.value;
 const pending=requests.get(url);if(pending)return pending;
 const request=fetch(url,{signal:AbortSignal.timeout(8000)}).then(async response=>{if(!response.ok)throw Error('Data Unavailable');const value=await response.json();cache.set(url,{until:Date.now()+600000,value});return value;}).finally(()=>requests.delete(url));
 requests.set(url,request);return request;
}
export async function explorerHolders(explorer:string,token:string){
 // Blockscout counts positive-balance addresses, including protocol contracts.
 const data=await overviewJson(`${explorer}/api/v2/tokens/${token}`);
 if(data.address_hash?.toLowerCase()!==token.toLowerCase()||data.type!=='ERC-20'||!/^\d+$/.test(data.holders_count))throw Error('Invalid Holder Identity');
 const count=Number(data.holders_count);if(!Number.isSafeInteger(count))throw Error('Invalid Holder Count');
 let items:Array<{account:string;balanceRaw:string}>=[];
 try{
  const page=await overviewJson(`${explorer}/api/v2/tokens/${token}/holders`);
  if(Array.isArray(page.items))items=page.items.filter((item:any)=>/^0x[0-9a-f]{40}$/i.test(item.address?.hash)&&/^\d+$/.test(item.value)&&BigInt(item.value)>0n).map((item:any)=>({account:item.address.hash,balanceRaw:item.value}));
 }catch{/* Count remains useful independently of the holder list. */}
 return {count,items};
}
export async function nativeUsd():Promise<string>{
 // Display-only public spot reference; never used for transaction execution.
 const result=await overviewJson('https://api.coinbase.com/v2/prices/ETH-USD/spot');
 if(result.data?.base!=='ETH'||result.data?.currency!=='USD'||!/^\d+(\.\d+)?$/.test(result.data?.amount)||Number(result.data.amount)<=0)throw Error('Invalid ETH Price');
 return result.data.amount;
}
