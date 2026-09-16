// Coalesce snapshot notifications while an expensive refresh is running.
// cancel invalidates the scheduler; the caller aborts its own in-flight reads.
export function createCoalescedRefresh(run:()=>Promise<unknown>){
 let epoch=0,running=false,pending=false;
 const request=()=>{
  if(running){pending=true;return;}
  running=true;const own=epoch;
  void Promise.resolve().then(()=>{if(own===epoch)return run();}).catch(()=>{}).finally(()=>{
   if(own!==epoch)return;
   running=false;if(pending){pending=false;request();}
  });
 };
 return{request,cancel(){epoch++;running=false;pending=false;}};
}
