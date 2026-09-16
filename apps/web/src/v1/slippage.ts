/** Convert a user-entered percentage to exact integer basis points. */
export function slippagePercentToBps(value:string):number{
 const normalized=value.trim();
 if(!/^(0|[1-9][0-9]?)(\.[0-9]{1,2})?$/.test(normalized))throw new Error('Enter 0–50%, With Up To 2 Decimal Places.');
 const [whole,fraction='']=normalized.split('.');
 const bps=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 if(bps>5000)throw new Error('Slippage Must Be 0–50%.');
 return bps;
}
