export const detailRegions=['market','statistics','chart','trades','holders','fees','staking'] as const;
export type DetailRegion=typeof detailRegions[number];
export function parseMarketChange(raw:string,market:string):DetailRegion[]{
 try{const value=JSON.parse(raw);if(value.marketId!==market||!Array.isArray(value.regions)||value.regions.length>7)return [];return [...new Set<DetailRegion>((value.regions as unknown[]).filter((v:unknown):v is DetailRegion=>typeof v==='string'&&detailRegions.includes(v as DetailRegion)))];}catch{return [];}
}
/** Invalidations carry no balances, prices or user state. Reconciliation reads the API. */
export function watchMarketChanges(base:string,market:string,read:(regions:readonly DetailRegion[])=>Promise<void>){
 let stopped=false,source:EventSource|null=null,timer:ReturnType<typeof setTimeout>|undefined,running=false,failures=0;
 const dirty=new Set<DetailRegion>();
 const flush=async()=>{if(stopped||running||document.hidden||!navigator.onLine)return;const batch=[...dirty];if(!batch.length)return;dirty.clear();running=true;try{await read(batch);failures=0;}catch{failures++;batch.forEach(r=>dirty.add(r));}finally{running=false;if(dirty.size&&!stopped)timer=setTimeout(()=>{void flush();},failures?Math.min(60000,1000*2**Math.min(failures,6)):120);}};
 const invalidate=(regions:readonly DetailRegion[])=>{regions.forEach(r=>dirty.add(r));clearTimeout(timer);timer=setTimeout(()=>{void flush();},120);};
 const connect=()=>{if(stopped||source||document.hidden||!navigator.onLine||typeof EventSource==='undefined')return;source=new EventSource(`${base.replace(/\/$/,'')}/v1/markets/${market}/events`);let interrupted=false;source.addEventListener('error',()=>{interrupted=true;});source.addEventListener('ready',()=>{if(interrupted){interrupted=false;invalidate(detailRegions);}});source.addEventListener('change',event=>invalidate(parseMarketChange((event as MessageEvent).data,market)));};
 // An unpersisted notification can be lost on disconnect: this bounded sweep
 // repairs every section without tying page entry to the stream or statistics.
 const recover=()=>{if(document.hidden||!navigator.onLine){source?.close();source=null;return;}connect();invalidate(detailRegions);};
 const fallback=setInterval(recover,60000);
 document.addEventListener('visibilitychange',recover);window.addEventListener('online',recover);window.addEventListener('offline',recover);connect();
 return {invalidate,stop(){stopped=true;source?.close();clearInterval(fallback);clearTimeout(timer);document.removeEventListener('visibilitychange',recover);window.removeEventListener('online',recover);window.removeEventListener('offline',recover);}};
}
