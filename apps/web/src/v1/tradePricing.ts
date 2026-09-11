/** Display-only arithmetic; settlement still uses a fresh contract quote. */
export function curveTradeMetrics(side:'buy'|'sell',input:bigint,output:bigint,spent:bigint,quoteReserve:bigint,tokenReserve:bigint,fee:bigint){
 if(input<=0n||output<=0n||quoteReserve<=0n||tokenReserve<=0n||fee<0n)throw Error('Invalid pricing inputs');
 const gross=side==='buy'?spent:output+fee;
 const net=side==='buy'?spent-fee:input;
 if(net<=0n)throw Error('Invalid net amount');
 // Compare execution before fees against the pre-trade reserve ratio.
 const actual=side==='buy'?output*quoteReserve:gross*tokenReserve;
 const ideal=side==='buy'?net*tokenReserve:input*quoteReserve;
 const impactBps=actual>=ideal?0n:(ideal-actual)*10000n/ideal;
 return {priceRaw:(side==='buy'?spent:output)*10n**18n/(side==='buy'?output:input),impactBps};
}
export function curveBuyFee(spent:bigint,baseBps:bigint,taxBps:bigint,snipeBps=0n):bigint{
 if(spent<0n||[baseBps,taxBps,snipeBps].some(v=>v<0n)||baseBps+taxBps+snipeBps>=10000n)throw Error('Invalid fee inputs');
 return spent*baseBps/10000n+spent*taxBps/10000n+spent*snipeBps/10000n;
}
export function antiSnipeBps(elapsed:bigint,exempt:boolean,base:bigint,tax:bigint):bigint{
 if(elapsed<0n)throw Error('Invalid launch time');
 if(exempt||elapsed>=5n)return 0n;
 const raw=[9900n,2475n,309n,19n,1n][Number(elapsed)]!;
 const cap=9900n-base-tax;if(cap<0n)throw Error('Invalid fee inputs');return raw<cap?raw:cap;
}

/** Short display only; never feed rounded prices back into transaction math. */
export function formatTradePrice(decimal:string):string{
 const fraction=decimal.split('.')[1]?.replace(/0+$/,'')??'';
 if(fraction.length<=6)return decimal;
 const [mantissa,exponent]=Number(decimal).toExponential(3).split('e');
 return `${mantissa!.replace(/\.?0+$/,'')}e${exponent}`;
}
