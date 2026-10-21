// Keep a bounded reconciliation even when SSE is quiet; notifications are hints.
export function createStreamHealth(now:()=>number=Date.now) {
 let lastSignal:number|undefined, ticks=0;
 return {
  signal(){lastSignal=now();},
  reset(){lastSignal=undefined;ticks=0;},
  shouldReconcile(){
   ticks++;
   const healthy=lastSignal!==undefined&&now()-lastSignal<45000;
   if(!healthy||ticks>=5){ticks=0;return true;}
   return false;
  },
 };
}
