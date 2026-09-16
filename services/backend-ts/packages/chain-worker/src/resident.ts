import type { Pool } from 'pg';
import { setTimeout as pause } from 'node:timers/promises';
import { claimJobs, completeJob, failJob, recoverExpiredLeases, sha256, type Lease } from '../../jobs/src/index.ts';

export interface WorkerState {
  ready: boolean; stopping: boolean; lastPollAt: number; activeOperation: string | null;
  succeeded: number; retried: number; dead: number;
}
export function createWorkerState(): WorkerState {
  return {ready:false,stopping:false,lastPollAt:0,activeOperation:null,succeeded:0,retried:0,dead:0};
}

// One active chain consumer per schema. This control pool must use a direct or
// session-pooled connection; transaction pooling cannot retain the advisory lock.
export async function runResidentWorker(input: {
  pool:Pool; controlPool:Pool; owner:string; generation:bigint; schemaName?:string;
  signal:AbortSignal; state:WorkerState; process:(lease:Lease)=>Promise<string|Buffer>;
  fatal:(error:Error)=>void; pollMs?:number; maxJobs?:number;
}):Promise<void>{
  if(input.signal.aborted){input.state.stopping=true;input.state.ready=false;return;}
  if(input.maxJobs!==undefined&&(!Number.isSafeInteger(input.maxJobs)||input.maxJobs<1))throw Error('invalid maximum job count');
  const name=input.schemaName??'tickergarden_serverless';
  if(!/^[a-z][a-z0-9_]{0,62}$/.test(name))throw Error('invalid worker schema');
  const schema=`"${name}"`,pollMs=input.pollMs??1000;
  if(!Number.isSafeInteger(pollMs)||pollMs<10||pollMs>30000)throw Error('invalid worker poll interval');
  const control=await input.controlPool.connect();
  const key=`tickergarden:resident-chain:${name}`;
  let lost:Error|undefined, heartbeat:ReturnType<typeof setInterval>|undefined, checking=false;
  const fatal=(error:Error)=>{if(lost)return;lost=error;input.state.ready=false;input.fatal(error);};
  const onError=()=>fatal(Error('resident control connection lost'));
  control.on('error',onError);
  let locked=false;
  try{
    locked=Boolean((await control.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked',[key])).rows[0]?.locked);
    if(!locked)throw Error('another resident worker owns this chain queue');
    const active=(await control.query(`SELECT active_generation,execution_mode FROM ${schema}.queue_generations WHERE queue='chain'`)).rows[0];
    if(active?.execution_mode!=='resident'||BigInt(active.active_generation)!==input.generation)throw Error('resident mode and generation must be explicitly activated before starting');
    heartbeat=setInterval(()=>{
      if(checking||lost)return;checking=true;
      void control.query('SELECT 1').catch(()=>fatal(Error('resident control heartbeat failed'))).finally(()=>{checking=false;});
    },5000);
    input.state.ready=true;
    let processed=0;
    while(!input.signal.aborted&&!lost){
      await recoverExpiredLeases(input.pool,'chain',100,name,input.generation);
      const leases=await claimJobs(input.pool,'chain',input.owner,1,300000,name,input.generation,'resident');
      input.state.lastPollAt=Date.now();
      const lease=leases[0];
      if(!lease){
        const mode=(await control.query(`SELECT active_generation,execution_mode FROM ${schema}.queue_generations WHERE queue='chain'`)).rows[0];
        if(mode?.execution_mode!=='resident'||BigInt(mode.active_generation)!==input.generation)break;
        await pause(pollMs,undefined,{signal:input.signal}).catch(error=>{if(!input.signal.aborted)throw error;});continue;
      }
      input.state.activeOperation=lease.operationId;
      // These are wakeup envelopes, now delivered locally. Preserve their journal
      // and distinguish local delivery from a provider's delivery identifier.
      await input.pool.query(`UPDATE ${schema}.outbox_messages SET state='sent',provider_message_id=$2,lease_owner=NULL,lease_expires_at=NULL,updated_at=now() WHERE operation_id=$1 AND state IN ('pending','retry','dead')`,[lease.operationId,`resident:${lease.id}:${lease.fencing}`]);
      const deadline=setTimeout(()=>fatal(Error('resident job exceeded 240 second execution budget')),240000);
      try{
        const result=await input.process(lease);
        if(lost)throw lost;
        if(!await completeJob(input.pool,lease,input.owner,sha256(result),name))throw Error('resident job lease lost');
        input.state.succeeded++;
      }catch(error){
        if(lost)throw lost;
        const outcome=await failJob(input.pool,lease,input.owner,'resident_processor_failed',name);
        if(outcome==='retry')input.state.retried++;
        else if(outcome==='dead')input.state.dead++;
        else throw Error('resident job fencing changed');
      }finally{clearTimeout(deadline);input.state.activeOperation=null;}
      processed++;
      if(input.maxJobs!==undefined&&processed>=input.maxJobs)break;
    }
    if(lost)throw lost;
  }finally{
    input.state.ready=false;input.state.stopping=true;
    if(heartbeat)clearInterval(heartbeat);
    control.off('error',onError);
    if(locked&&!lost)await control.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]).catch(()=>{});
    control.release(Boolean(lost));
  }
}
