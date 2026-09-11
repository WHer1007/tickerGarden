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
