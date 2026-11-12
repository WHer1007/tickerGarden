/** Serialize only durable claims. Deliveries retain their configured concurrency. */
export function createIdleClaimer<T>(claim:()=>Promise<T|undefined>,revision:()=>number,clock:()=>number=Date.now){
 let tail:Promise<unknown>=Promise.resolve(),emptyUntil=0,emptyRevision=-1,idleMs=500;
 return ():Promise<T|undefined>=>{
  const run=tail.then(async()=>{
   const observed=revision();if(observed===emptyRevision&&clock()<emptyUntil)return undefined;
   const result=await claim();
   if(result===undefined){emptyRevision=observed;emptyUntil=clock()+idleMs;idleMs=Math.min(5000,idleMs*2);}
   else{emptyUntil=0;emptyRevision=-1;idleMs=500;}
   return result;
  });
  tail=run.catch(()=>undefined);return run;
 };
}
