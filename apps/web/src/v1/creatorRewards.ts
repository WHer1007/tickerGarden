import type {MarketReadModel} from './generated/read-api.ts';
export type CreatorAmounts={credited:string;paid:string;burned:string;remaining:string};
export type CreatorPeriod={epoch:number;beneficiary:`0x${string}`;quote:CreatorAmounts;meme:CreatorAmounts};
export type CreatorRewardsPage={chainId:number;displayOnly:true;marketId:`0x${string}`;account:`0x${string}`;market:MarketReadModel;currentEpoch:number;currentBeneficiary:`0x${string}`|null;pendingBeneficiary:`0x${string}`;pendingQuote:string;curveFees:string;periods:CreatorPeriod[];nextCursor:string|null;sourceBlockNumber:string;sourceBlockHash:`0x${string}`};
export function validateCreatorRewards(raw:unknown,chainId:number,marketId:string,account:string):CreatorRewardsPage {
 const p=raw as CreatorRewardsPage,addr=/^0x[0-9a-f]{40}$/,uint=/^(0|[1-9][0-9]*)$/;
 if(!p||p.chainId!==chainId||p.displayOnly!==true||p.marketId!==marketId||p.account!==account||p.market?.marketId!==marketId||!addr.test(p.market.quoteAsset)||!addr.test(p.market.memeToken)||!Number.isSafeInteger(p.currentEpoch)||p.currentEpoch<1||p.currentEpoch>4294967295||!addr.test(p.pendingBeneficiary)||(p.currentBeneficiary!==null&&!addr.test(p.currentBeneficiary))||!uint.test(p.pendingQuote)||!uint.test(p.curveFees)||!uint.test(p.sourceBlockNumber)||!/^0x[0-9a-f]{64}$/.test(p.sourceBlockHash)||!Array.isArray(p.periods)||p.periods.length>20||(p.nextCursor!==null&&(typeof p.nextCursor!=='string'||!p.nextCursor)))throw Error('Invalid Creator response');
 let prior=4294967296;
 for(const row of p.periods){if(!Number.isSafeInteger(row.epoch)||row.epoch<1||row.epoch>p.currentEpoch||row.epoch>=prior||row.beneficiary!==account)throw Error('Invalid Creator period');prior=row.epoch;
  for(const value of [row.quote,row.meme]){if(!value||![value.credited,value.paid,value.burned,value.remaining].every(v=>typeof v==='string'&&uint.test(v))||BigInt(value.credited)!==BigInt(value.paid)+BigInt(value.burned)+BigInt(value.remaining))throw Error('Invalid Creator balance');}}
 return p;
}
export async function loadCreatorRewards(baseUrl:string,chainId:number,marketId:string,account:string,options:{cursor?:string;epoch?:number;signal?:AbortSignal}={}) {
 const url=new URL('/v1/creator-rewards',baseUrl);url.searchParams.set('marketId',marketId);url.searchParams.set('account',account.toLowerCase());if(options.cursor)url.searchParams.set('cursor',options.cursor);if(options.epoch)url.searchParams.set('epoch',String(options.epoch));
 const response=await fetch(url,{signal:options.signal??AbortSignal.timeout(10000),cache:'no-store'});if(!response.ok)throw Error('Creator rewards could not be loaded');
 return validateCreatorRewards(await response.json(),chainId,marketId,account.toLowerCase());
}
