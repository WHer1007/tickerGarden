/** Display snapshot contract. No value here authorizes a financial action. */
export interface ProtocolStatistics {
 schemaVersion:3;chainId:number;displayOnly:true;usdBasis:'CURRENT_PRICE_ESTIMATE';
 observedAt:number;generatedAt:number;nextRefreshAt:number;
 launches24h:number|null;bloomedMarketCount:number;marketCount:number;
 volumeCoverage:boolean;volumeAmounts:Record<string,string>;
 feeCoverage:boolean;feeBasis:'TRADE_TIME';feeTotals:Record<string,string>;feeDecimals:Record<string,number>;
 feePriceQuotes:Record<string,{quoteAsset:string;priceQuote:string}>;
 allocationCoverage:boolean;feeAssets:Record<string,Record<string,string>>;
 stakingCoverage:boolean;stakingObservedAt:number|null;stakingWallets:number|null;stockAmounts:Record<string,string>|null;
}
export function parseProtocolStatistics(raw:unknown,chainId:number):ProtocolStatistics{
 const v=raw as ProtocolStatistics;
 const count=(x:unknown)=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0;
 const record=(x:unknown)=>x!==null&&typeof x==='object'&&!Array.isArray(x);
 const amounts=(x:unknown,key:RegExp)=>record(x)&&Object.entries(x as object).every(([k,n])=>key.test(k)&&typeof n==='string'&&/^(0|[1-9][0-9]*)$/.test(n));
 const address=/^0x[0-9a-f]{40}$/,id=/^0x[0-9a-f]{64}$/;
 if(!record(v)||v.schemaVersion!==3||v.chainId!==chainId||v.displayOnly!==true||v.usdBasis!=='CURRENT_PRICE_ESTIMATE'||v.feeBasis!=='TRADE_TIME'||
 ![v.observedAt,v.generatedAt,v.nextRefreshAt,v.marketCount,v.bloomedMarketCount].every(count)||v.nextRefreshAt<v.generatedAt||
 !(v.launches24h===null||count(v.launches24h))||![v.volumeCoverage,v.feeCoverage,v.allocationCoverage,v.stakingCoverage].every(x=>typeof x==='boolean')||
 !amounts(v.volumeAmounts,address)||!amounts(v.feeTotals,address)||!record(v.feeDecimals)||!Object.entries(v.feeDecimals).every(([k,n])=>address.test(k)&&count(n)&&n<=255)||
 !record(v.feePriceQuotes)||!Object.entries(v.feePriceQuotes).every(([k,p])=>address.test(k)&&record(p)&&address.test(p.quoteAsset)&&typeof p.priceQuote==='string'&&/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(p.priceQuote))||
 !record(v.feeAssets)||!Object.entries(v.feeAssets).every(([k,b])=>address.test(k)&&amounts(b,/^(creator|staker|holder|platform)$/)&&['creator','staker','holder','platform'].every(key=>typeof b[key]==='string'))||
 !(v.stakingCoverage?count(v.stakingObservedAt)&&count(v.stakingWallets)&&amounts(v.stockAmounts,id):v.stockAmounts===null&&v.stakingObservedAt===null&&v.stakingWallets===null))throw Error('Invalid statistics snapshot');
 return v;
}

export function decimalProduct(a:string,b:string):string{
 const parse=(x:string)=>{if(!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(x))throw Error('Invalid price');const [whole,fraction='']=x.split('.');return {raw:BigInt(whole!+fraction),scale:fraction.length};};
 const x=parse(a),y=parse(b),scale=x.scale+y.scale,digits=(x.raw*y.raw).toString().padStart(scale+1,'0');return scale?digits.slice(0,-scale)+'.'+digits.slice(-scale):digits;
}
