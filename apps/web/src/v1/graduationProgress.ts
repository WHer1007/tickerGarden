/** Display-only collected quote progress; no floating point enters a transaction. */
export function graduationProgress(collected:bigint,target:bigint):number|null {
 if(collected<0n||target<=0n)return null;
 const capped=collected>=target?10000n:collected*10000n/target;
 return Number(capped)/100;
}
