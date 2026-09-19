/** Poll only saved transactions; an unavailable RPC is not proof of failure. */
export function watchPendingRecovery(check:()=>Promise<void>,intervalMs=15000):()=>void {
 let stopped=false,timer:ReturnType<typeof setTimeout>|undefined;
 const tick=async()=>{try{await check();}catch{/* Retain recovery records on transient failures. */}finally{if(!stopped)timer=setTimeout(()=>{void tick();},intervalMs);}};
 void tick();return()=>{stopped=true;if(timer)clearTimeout(timer);};
}
export function pendingRecoveryText(stage:string|undefined,approval:boolean,cancelled=false):string {
 if(!stage||stage==='unknown')return 'Transaction status is not yet verified. Checking automatically…';
 if(stage==='replaced')return cancelled?'Cancellation is awaiting confirmation.':'Replacement transaction is awaiting confirmation.';
 return `Checking ${approval?'token approval':'transaction'} status…`;
}

/** Foreground deadline is independent of receipt/RPC promises and survives reload via createdAt. */
export function watchSubmissionDeadline(createdAt:number,context:{current:()=>boolean;busy:()=>boolean;observation:()=>{state:string;checkedAt:number}|undefined;expire:()=>void}):()=>void{
 let stopped=false,timer:ReturnType<typeof setTimeout>;
 const tick=()=>{
  if(stopped||!context.current())return;
  if(context.busy()){timer=setTimeout(tick,50);return;}
  const observed=context.observation();
  if(observed?.state==='pending'&&Date.now()-observed.checkedAt<15000){timer=setTimeout(tick,5000);return;}
  stopped=true;context.expire();
 };
 timer=setTimeout(tick,Math.max(0,createdAt+20000-Date.now()));
 return()=>{stopped=true;clearTimeout(timer);};
}
