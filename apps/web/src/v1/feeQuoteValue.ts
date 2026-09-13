import {formatUnits} from 'viem';
import type {TokenDetailFee} from './generated/read-api.ts';

/** Display valuation only; reward balances and payout assets are unchanged. */
export function feeQuoteValue(rows:readonly TokenDetailFee[],quote:string,meme:string,quoteDecimals:number,price:string|null|undefined):string|null{
 if(!Number.isInteger(quoteDecimals)||quoteDecimals<0||quoteDecimals>18)return null;
 const needsPrice=rows.some(row=>row.asset.toLowerCase()===meme.toLowerCase()&&/^\d+$/.test(row.amountRaw)&&BigInt(row.amountRaw)>0n);
 if(needsPrice&&(!price||!/^\d+(?:\.\d{1,36})?$/.test(price)))return null;
 const [whole,fraction='']=(needsPrice?price!:'0').split('.');
 const scaledPrice=BigInt(whole!)*10n**36n+BigInt(fraction.padEnd(36,'0'));
 if(needsPrice&&scaledPrice<=0n)return null;
 let total=0n;
 for(const row of rows){
  if(!/^\d+$/.test(row.amountRaw))return null;
  const raw=BigInt(row.amountRaw),asset=row.asset.toLowerCase();
  if(raw===0n)continue;
  if(asset===quote.toLowerCase())total+=raw*10n**BigInt(54-quoteDecimals);
  else if(asset===meme.toLowerCase())total+=raw*scaledPrice;
  else return null;
 }
 return formatUnits(total,54);
}

/** Current database prices value both payout assets in USD, using integer arithmetic. */
export function feeUsdValue(rows:readonly TokenDetailFee[],quote:string,meme:string,quoteDecimals:number,price:string|null|undefined,quoteUsd:string|undefined):string|null{
 const value=feeQuoteValue(rows,quote,meme,quoteDecimals,price);
 if(value===null)return null;
 if(value==='0')return '0';
 if(!quoteUsd||!/^\d+(?:\.\d{1,36})?$/.test(quoteUsd))return null;
 const scaled=(value:string,decimals:number)=>{const[whole,fraction='']=value.split('.');return BigInt(whole!)*10n**BigInt(decimals)+BigInt(fraction.padEnd(decimals,'0'));};
 const usd=scaled(quoteUsd,36);
 if(usd<=0n)return null;
 return formatUnits(scaled(value,54)*usd,90);
}
export function formatFeeUsd(value:string|null):string{
 if(value===null)return 'Unavailable';
 const[whole,fraction='']=value.split('.');
 const base=BigInt(whole!)*100n+BigInt(fraction.padEnd(2,'0').slice(0,2));
 if(base===0n&&/[1-9]/.test(value))return '<$0.01';
 const cents=base+(Number(fraction[2]??'0')>=5?1n:0n);
 return `$${(cents/100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g,',')}.${(cents%100n).toString().padStart(2,'0')}`;
}
