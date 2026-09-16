import type {MarketReadModel} from './generated/read-api.ts';
const decimal=/^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
export function sumStatisticsUSD(values:readonly (string|null|undefined)[]):string|null{
 if(values.some(v=>typeof v!=='string'||!decimal.test(v)))return null;
 const scale=Math.max(0,...values.map(v=>v!.split('.')[1]?.length??0));
 const sum=values.reduce((total,v)=>{const [whole,fraction='']=v!.split('.');return total+BigInt(whole!+fraction.padEnd(scale,'0'));},0n);
 if(!scale)return String(sum);const digits=String(sum).padStart(scale+1,'0'),fraction=digits.slice(-scale).replace(/0+$/,'');return digits.slice(0,-scale)+(fraction?'.'+fraction:'');
}
export function summarizeMarkets(markets:readonly MarketReadModel[],period:'24h'|'all',now:number,complete:boolean){
 if(!complete)return{marketCap:null,volume:null,launches:null,total:null,growing:null,bloomed:null};
 const unique=[...new Map(markets.map(m=>[m.marketId,m])).values()];
 const times=unique.map(m=>m.identity?.deployedAt);
 return{
  marketCap:sumStatisticsUSD(unique.map(m=>m.metrics?.marketCapUsd)),
  volume:period==='all'?null:sumStatisticsUSD(unique.map(m=>m.metrics?.volume24hUsd)),
  launches:period==='all'?unique.length:times.every(t=>typeof t==='string'&&/^(0|[1-9][0-9]*)$/.test(t))?times.filter(t=>BigInt(t!)>=BigInt(now-86400)&&BigInt(t!)<=BigInt(now)).length:null,
  total:unique.length,growing:unique.filter(m=>m.launchPhase===0).length,bloomed:unique.filter(m=>m.launchPhase===1).length,
 };
}
