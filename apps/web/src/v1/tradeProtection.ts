/** The user accepts an exact quoted floor in the trade confirmation. No fixed slippage rate. */
export function quotedMinimum(output:bigint):bigint{
 if(output<=0n)throw Error('Amount too small for minimum received');
 return output;
}
/** Approval must never lower the amount the user already accepted. */
export function approvedQuoteMinimum(initial:{minimum:bigint},fresh:{output:bigint}):bigint{
 if(initial.minimum<=0n||fresh.output<initial.minimum)throw Error('Review the updated quote before trading.');
 return initial.minimum;
}
export function gasReserve(gas: bigint, price: bigint): bigint {
  if(gas<=0n||price<=0n)throw Error('Network fee could not be estimated.');
  return (gas*price*120n+99n)/100n;
}
export function spendableNative(balance:bigint,reserve:bigint):bigint{return balance>reserve?balance-reserve:0n;}
