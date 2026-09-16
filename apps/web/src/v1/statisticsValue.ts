// Display-only integer valuation. Missing inputs must not become zero amounts.
export function statisticsFresh(at:unknown,now:number):boolean {
 return typeof at==='number'&&Number.isSafeInteger(at)&&at>0&&at<=now/1000+5&&now/1000-at<1200;
}
export function statisticsUSD(raw:unknown,decimals:unknown,price:unknown,expires:unknown,now:number):string|null {
 if(typeof raw!=='string'||!/^(0|[1-9][0-9]*)$/.test(raw)||typeof decimals!=='number'||!Number.isInteger(decimals)||decimals<0||decimals>255)return null;
 if(raw==='0')return '0';
 if(typeof price!=='string'||!/^(0|[1-9][0-9]*)(\.[0-9]{1,72})?$/.test(price)||typeof expires!=='number'||!Number.isFinite(expires)||expires*1000<=now)return null;
 const [whole,fraction='']=price.split('.'),scale=10n**BigInt(fraction.length);
 const p=BigInt(whole!+fraction);if(p<=0n)return null;
 const usd=BigInt(raw)*p*10n**18n/(10n**BigInt(decimals)*scale);
 const digits=usd.toString().padStart(19,'0');
 return (digits.slice(0,-18)+'.'+digits.slice(-18)).replace(/\.?0+$/,'')||'0';
}
