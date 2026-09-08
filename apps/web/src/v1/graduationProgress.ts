/** Display-only sold curve inventory; no floating point enters a transaction. */
export function graduationProgress(supply:bigint,reserved:bigint,remaining:bigint):number|null {
 const initial=supply-reserved;
 if(initial<=0n||remaining<0n||remaining>initial)return null;
 return Number((initial-remaining)*10000n/initial)/100;
}
