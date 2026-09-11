import type { SnapshotUpdatesResponse } from './generated/read-api.ts';

type Update = SnapshotUpdatesResponse;
const scopes = ['markets', 'configs', 'positions', 'accounts'];
const object = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x);
export function validateSnapshotUpdate(value: unknown, chainId: number, since?: string): Update {
 if (!object(value) || !object(value.sync)) throw new Error('Invalid snapshot update');
 const s=value.sync;
 if (s.chainId!==chainId || s.status!=='synced' || s.finality!=='finalized' || typeof s.blockNumber!=='string' || !/^(0|[1-9][0-9]*)$/.test(s.blockNumber) || typeof s.blockHash!=='string' || !/^0x[0-9a-f]{64}$/.test(s.blockHash) || s.revision!==`${s.blockNumber}:${s.blockHash}`) throw new Error('Untrusted snapshot update');
 if (typeof value.mode!=='string' || !['reset','changed','unchanged'].includes(value.mode) || value.pollAfterMs!==5000 || !Array.isArray(value.invalidated) || value.invalidated.length>scopes.length || new Set(value.invalidated).size!==value.invalidated.length || value.invalidated.some(x=>typeof x!=='string'||!scopes.includes(x))) throw new Error('Invalid update contract');
 if (value.mode==='unchanged' && (s.revision!==since || value.invalidated.length!==0)) throw new Error('Invalid unchanged revision');
 if (value.mode==='changed' && (!since || since===s.revision)) throw new Error('Invalid changed revision');
 if (value.mode==='reset' && value.invalidated.length!==scopes.length) throw new Error('Incomplete cache reset');
 return value as Update;
}

function abortable<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{
  const abort=()=>reject(new Error('Snapshot request cancelled'));
  signal.addEventListener('abort',abort,{once:true});
  if(signal.aborted)abort();
  promise.then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
 });
}

export class SnapshotRefreshSuperseded extends Error {}

// prepare returns a synchronous commit so superseded asynchronous reads cannot
// apply their result. The caller must stage all cache mutations until commit.
export function createSnapshotPoller(options: {
 chainId:number;
 fetchUpdate:(since:string|undefined, signal:AbortSignal)=>Promise<unknown>;
 prepare:(update:Update, signal:AbortSignal)=>Promise<()=>void>;
 unavailable:(error:unknown)=>void;
 canPoll?:()=>boolean;
 timeoutMs?:number;
}) {
 let revision:string|undefined;
 let stopped=true, generation=0, recovering=true, unchangedCount=0, failureCount=0;
 let controller:AbortController|undefined;
 let timer:ReturnType<typeof setTimeout>|undefined;
 const permitted=()=>!options.canPoll || options.canPoll();
 const cancel=()=>{generation++;controller?.abort();controller=undefined;if(timer)clearTimeout(timer);timer=undefined;};
 async function poll() {
  if(stopped)return;
  if(!permitted()){timer=setTimeout(()=>void poll(),5000);return;}
  const attempt=++generation;
  const request=new AbortController();controller=request;
  let timedOut=false;
  let nextDelay=5000;
  const deadline=setTimeout(()=>{timedOut=true;request.abort();if(attempt===generation&&!stopped){recovering=true;failureCount=Math.min(4,failureCount+1);nextDelay=Math.min(60000,5000*(2**failureCount));if(permitted())options.unavailable(new Error('Snapshot update timed out'));}},options.timeoutMs??15000);
  try {
   const update=validateSnapshotUpdate(await abortable(options.fetchUpdate(revision,request.signal),request.signal),options.chainId,revision);
   failureCount=0;unchangedCount=update.mode==='unchanged'?Math.min(4,unchangedCount+1):0;nextDelay=Math.min(60000,update.pollAfterMs*(2**unchangedCount));
   if(stopped||attempt!==generation||request.signal.aborted)return;
   if(!permitted()){recovering=true;return;}
   // A changed block with identical publication digests advances the revision
   // without reloading every cache. Recovery still rebuilds cleared views.
   if(update.mode==='reset'||update.invalidated.length>0||recovering){
    const next=recovering?{...update,mode:'reset' as const,invalidated:['markets','configs','positions','accounts'] as const}:update;
    const commit=await abortable(options.prepare(next,request.signal),request.signal);
    if(stopped||attempt!==generation||request.signal.aborted)return;
   if(!permitted()){recovering=true;return;}
    commit();
   }
   revision=update.sync.revision;recovering=false;
  } catch(error) {
   if(!stopped&&attempt===generation&&!timedOut){recovering=true;if(!(error instanceof SnapshotRefreshSuperseded))failureCount=Math.min(4,failureCount+1);nextDelay=Math.min(60000,5000*(2**failureCount));if(permitted() && !(error instanceof SnapshotRefreshSuperseded))options.unavailable(error);}
  } finally {
   clearTimeout(deadline);
   if(!stopped&&attempt===generation){controller=undefined;timer=setTimeout(()=>void poll(),nextDelay);}
  }
 }
 return {
  start(){if(!stopped)return;stopped=false;void poll();},
  adoptRevision(value:string){
   if(!/^(0|[1-9][0-9]*):0x[0-9a-f]{64}$/.test(value))throw new Error('Invalid adopted snapshot revision');
   cancel();revision=value;stopped=false;recovering=false;unchangedCount=0;failureCount=0;void poll();
  },
  reconnect(){cancel();stopped=false;recovering=true;unchangedCount=0;failureCount=0;void poll();},
  stop(){stopped=true;recovering=true;unchangedCount=0;failureCount=0;cancel();},
  get revision(){return revision;},
 };
}
