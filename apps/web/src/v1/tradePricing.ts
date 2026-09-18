import {compactPrice} from '../ui/compact-price.ts';
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
 return compactPrice(decimal);
}

/** Exact-input v4 Hook fees are deducted from the output currency. The quoter
 * returns net output, so reversing the aggregate rate is an estimate: the
 * contract floors its 1% base fee and creator tax separately. Never use this
 * display estimate for settlement or minimum-output calculations. */
export function estimatedPoolTradingFee(netOutput:bigint,creatorTaxBps:number):bigint{
 if(netOutput<0n||!Number.isInteger(creatorTaxBps)||creatorTaxBps<0||creatorTaxBps>500)throw Error('Invalid pool fee inputs');
 const bps=100n+BigInt(creatorTaxBps);
 return netOutput*bps/(10000n-bps);
}

/** Compare the fee-adjusted execution against the pre-swap v4 spot ratio.
 * Raw currency ratios handle either direction and token decimals implicitly.
 * Hook fee reversal is estimated; this value never controls settlement. */
export function poolTradeImpactBps(input:bigint,netOutput:bigint,sqrtPriceX96:bigint,zeroForOne:boolean,creatorTaxBps:number,protocolFeePips:number,lpFeePips=0):bigint{
 if(input<=0n||netOutput<=0n||sqrtPriceX96<=0n||sqrtPriceX96>=1n<<160n||!Number.isInteger(protocolFeePips)||protocolFeePips<0||protocolFeePips>1000||![0,1000,2000,3000].includes(lpFeePips))throw Error('Invalid pool impact inputs');
 const squared=sqrtPriceX96*sqrtPriceX96,q192=1n<<192n;
 const grossOutput=netOutput+estimatedPoolTradingFee(netOutput,creatorTaxBps);
 const coreFee=BigInt(protocolFeePips+lpFeePips)-BigInt(protocolFeePips)*BigInt(lpFeePips)/1000000n;
 const ideal=input*(zeroForOne?squared:q192)*(1000000n-coreFee);
 const actual=grossOutput*(zeroForOne?q192:squared)*1000000n;
 return actual>=ideal?0n:(ideal-actual)*10000n/ideal;
}
