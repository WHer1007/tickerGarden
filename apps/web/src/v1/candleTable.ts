import type {MarketCandlesResponse} from './generated/read-api.ts';
import {candlePriceLabel} from './candles.ts';

export function candleVolume(raw:string,decimals:number):string {
 const n=BigInt(raw),scale=10n**BigInt(decimals);
 const fraction=(n%scale).toString().padStart(decimals,'0').replace(/0+$/,'');
 return `${n/scale}${fraction?'.'+fraction:''}`;
}
export function candleTable(data:MarketCandlesResponse):HTMLDetailsElement {
 const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='View hourly prices and volumes';details.append(summary);
 const scroll=document.createElement('div');scroll.style.overflowX='auto';scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-label','Hourly candle data, scroll horizontally for all columns');details.append(scroll);
 const table=document.createElement('table');table.style.width='100%';table.style.fontSize='0.85rem';table.style.borderCollapse='collapse';
 const caption=document.createElement('caption');caption.textContent='UTC · Prices in paired asset per created token (up to 8 decimal places; rounded down). Volumes use whole tokens. Internal conversions are included in totals.';table.append(caption);
 const head=table.createTHead().insertRow();
 for(const label of ['Hour (UTC)','Open','High','Low','Close','Token volume','Paired-asset volume','Internal paired-asset volume','Executions','Internal executions']){const th=document.createElement('th');th.scope='col';th.textContent=label;head.append(th);}
 const body=table.createTBody();
 for(const c of data.series.candles){const row=body.insertRow();const time=document.createElement('th');time.scope='row';time.textContent=new Date(c.timestamp*1000).toISOString().slice(0,16).replace('T',' ');row.append(time);
 for(const p of [c.open,c.high,c.low,c.close]){const cell=row.insertCell();cell.textContent=p?candlePriceLabel(p):'No trades';}
 for(const value of [candleVolume(c.memeVolumeRaw,18),candleVolume(c.quoteVolumeRaw,data.quoteDecimals),candleVolume(c.internalQuoteVolumeRaw,data.quoteDecimals),String(c.tradeCount),String(c.internalTradeCount)])row.insertCell().textContent=value;
 }
 for(const cell of table.querySelectorAll('th,td')){(cell as HTMLElement).style.padding='8px';(cell as HTMLElement).style.whiteSpace='nowrap';(cell as HTMLElement).style.textAlign='left';}
 scroll.append(table);return details;
}
