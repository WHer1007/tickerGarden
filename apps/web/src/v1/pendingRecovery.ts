/** Poll only saved transactions; an unavailable RPC is not proof of failure. */
export function watchPendingRecovery(check:()=>Promise<void>,intervalMs=15000):()=>void {
 let stopped=false,timer:ReturnType<typeof setTimeout>|undefined;
 const tick=async()=>{try{await check();}catch{/* Retain recovery records on transient failures. */}finally{if(!stopped)timer=setTimeout(()=>{void tick();},intervalMs);}};
 void tick();return()=>{stopped=true;if(timer)clearTimeout(timer);};
}
export function pendingRecoveryText(stage:string|undefined,approval:boolean,cancelled=false):string {
 if(!stage||stage==='unknown')return 'Transaction status is not yet verified. Checking automatically…';
 if(stage==='replaced')return cancelled?'Cancellation is awaiting confirmation.':'Replacement transaction is awaiting confirmation.';
 return `${approval?'Token approval':'Transaction'} submitted. Checking confirmation…`;
}
