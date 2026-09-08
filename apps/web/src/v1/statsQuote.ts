import {candleVolume} from './candleTable.ts';
// Optional RPC metadata must never supply an assumed precision for a failed read.
export async function statisticsQuoteLabel(address:string,raw:bigint,readMetadata:()=>Promise<readonly [unknown,unknown]>):Promise<{label:string;amount:string}>{
 const native=address==='0x'+'0'.repeat(40);
 if(native)return{label:'ETH',amount:`${candleVolume(raw.toString(),18)} (${raw} raw)`};
 let symbol:unknown,decimals:unknown;
 try{[symbol,decimals]=await readMetadata();}catch{return{label:address,amount:`${raw} raw · token decimals unavailable`};}
 const label=typeof symbol==='string'&&symbol.trim().length>0&&symbol.length<=64?`${symbol} · ${address}`:address;
 if(typeof decimals!=='number'||!Number.isInteger(decimals)||decimals<0||decimals>255)return{label,amount:`${raw} raw · token decimals unavailable`};
 return{label,amount:`${candleVolume(raw.toString(),decimals)} (${raw} raw)`};
}
