import {StatsDisplayStore,type StatsSection} from './statsDisplay.ts';

type StatsEventSource = {addEventListener:(type:string,listener:(event:MessageEvent<string>)=>void)=>void;close:()=>void};
export type StatsReadStatus = Readonly<{state:'idle'|'loading'|'ready'|'error';readAt:number|null}>;
type Options = {
  chainId:number;
  fetcher:(section:StatsSection,signal:AbortSignal)=>Promise<unknown>;
  onSection:(section:StatsSection)=>void;
  onStatus?:(section:StatsSection)=>void;
  getSections:()=>readonly StatsSection[];
  eventSource?:()=>StatsEventSource;
  debounceMs?:number;
  refreshMs?:number;
  requestTimeoutMs?:number;
  now?:()=>number;
};

/** Scoped, retained Stats reads with event coalescing and lifecycle fencing. */
export function createStatsDisplayUpdater(options:Options){
 const store=new StatsDisplayStore(options.chainId),flights=new Map<StatsSection,Promise<void>>(),controllers=new Map<StatsSection,AbortController>();
 const statuses=new Map<StatsSection,StatsReadStatus>();
 const status=(section:StatsSection):StatsReadStatus=>statuses.get(section)??{state:'idle',readAt:null};
 function setStatus(section:StatsSection,state:StatsReadStatus['state']){statuses.set(section,{state,readAt:state==='ready'?now():status(section).readAt});options.onStatus?.(section);}
 const dirty=new Set<StatsSection>(),updatedAt=new Map<StatsSection,number>(),pending=new Set<StatsSection>();
 const now=options.now??Date.now,debounceMs=options.debounceMs??150,refreshMs=options.refreshMs??60_000,requestTimeoutMs=options.requestTimeoutMs??15_000;
 let source:StatsEventSource|undefined,timer:ReturnType<typeof setInterval>|undefined,debounce:ReturnType<typeof setTimeout>|undefined;
 let epoch=0,started=false;
 function apply(section:StatsSection,raw:unknown,requestEpoch:number,signal:AbortSignal){if(requestEpoch!==epoch||signal.aborted)return;store.apply(raw,section);updatedAt.set(section,now());setStatus(section,'ready');options.onSection(section);}
 async function read(section:StatsSection,controller:AbortController,requestEpoch:number){
  const failed=()=>{if(requestEpoch===epoch)setStatus(section,'error');};
  setStatus(section,'loading');controller.signal.addEventListener('abort',failed,{once:true});
  const timeout=setTimeout(()=>controller.abort(),requestTimeoutMs);
  try{const raw=await options.fetcher(section,controller.signal);apply(section,raw,requestEpoch,controller.signal);}
  catch{/* Retain the last valid section on errors and aborts. */failed();}
  finally{clearTimeout(timeout);controller.signal.removeEventListener('abort',failed);}
 }
 function refresh(section:StatsSection,force=false):Promise<void>{
  const active=flights.get(section);
  if(active){if(force)dirty.add(section);return active;}
  if(!force&&updatedAt.has(section)&&now()-updatedAt.get(section)!<refreshMs)return Promise.resolve();
  const controller=new AbortController(),requestEpoch=epoch;controllers.set(section,controller);
  const task=(async()=>{
   await read(section,controller,requestEpoch);
   while(requestEpoch===epoch&&dirty.delete(section)&&!controller.signal.aborted){
    const next=new AbortController();controllers.set(section,next);
    await read(section,next,requestEpoch);
    if(next.signal.aborted)break;
   }
  })().finally(()=>{if(requestEpoch===epoch){flights.delete(section);controllers.delete(section);}});
  flights.set(section,task);return task;
 }
 function refreshMany(sections:readonly StatsSection[],force=false){return Promise.all([...new Set(sections)].map(section=>refresh(section,force))).then(()=>{});}
 function receiveChange(event:MessageEvent<string>){
  try{
   const message=JSON.parse(event.data) as {statsRegions?:unknown};
   if(!Array.isArray(message.statsRegions))return;
   const active=new Set(options.getSections());
   for(const section of message.statsRegions)if((section==='overview'||section==='allocations'||section==='stocks')&&active.has(section))pending.add(section);
   if(!pending.size)return;
   if(debounce)clearTimeout(debounce);
   debounce=setTimeout(()=>{debounce=undefined;const sections=[...pending];pending.clear();void refreshMany(sections,true);},debounceMs);
  }catch{/* Malformed notifications are recovered by ready and periodic refreshes. */}
 }
 function receiveReady(){void refreshMany(options.getSections(),true);}
 function start(){
  if(started)return;started=true;
  if(options.eventSource)try{source=options.eventSource();source.addEventListener('ready',receiveReady);source.addEventListener('change',receiveChange);}catch{source=undefined;}
  timer=setInterval(()=>{void refreshMany(options.getSections(),false);},refreshMs);
 }
 function stop(){
  started=false;epoch++;dirty.clear();pending.clear();
  if(debounce)clearTimeout(debounce);debounce=undefined;
  if(timer)clearInterval(timer);timer=undefined;
  source?.close();source=undefined;
  for(const controller of controllers.values())controller.abort();
  controllers.clear();flights.clear();
  for(const [section,value] of statuses)if(value.state==='loading')statuses.set(section,{...value,state:value.readAt===null?'idle':'ready'});
 }
 return {status,get snapshot(){return store.snapshot;},start,stop,refresh:(sections:readonly StatsSection[],force=false)=>refreshMany(sections,force)};
}
