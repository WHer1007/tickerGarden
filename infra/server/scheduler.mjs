import {randomUUID} from 'node:crypto';

export async function hasDueWork(pool,schema,queue,generation){
  if(!/^[a-z][a-z0-9_]{0,62}$/.test(schema))throw Error('Invalid schema');
  const s=`"${schema}"`;
  const {rows}=await pool.query(`SELECT EXISTS(SELECT 1 FROM ${s}.outbox_messages o JOIN ${s}.jobs j ON j.operation_id=o.operation_id WHERE o.queue=$1 AND j.generation=$2 AND ((o.state IN ('pending','retry') AND o.next_attempt_at<=now()) OR (o.state='leased' AND o.lease_expires_at<=now()))) OR EXISTS(SELECT 1 FROM ${s}.jobs WHERE queue=$1 AND generation=$2 AND ((state='retry' AND next_attempt_at<=now()) OR (state='leased' AND lease_expires_at<=now()))) AS due`,[queue,generation.toString()]);
  return rows[0]?.due===true;
}

export function startScheduler({pool,env,kind,app,jobs,retention,intervalMs=15000}){
  const queue=kind==='content'?'content':'chain',schema=env.TG_DATABASE_SCHEMA??'tickergarden';
  const generation=BigInt(env[kind==='content'?'TG_CONTENT_GENERATION':'TG_PIPELINE_GENERATION']??'0');
  const callback=env[kind==='content'?'TG_CONTENT_JOB_CALLBACK_URL':'TG_CHAIN_JOB_CALLBACK_URL'];
  const token=env[kind==='content'?'QSTASH_CONTENT_TOKEN':'QSTASH_CHAIN_TOKEN'];
  const client=jobs.createQStashClient(token,env.QSTASH_URL);
  let stopped=false,timer,active=Promise.resolve(),lastPrice=Date.now(),lastRetention=Date.now();
  const tick=async()=>{
    if(stopped)return;
    try{
      if(await hasDueWork(pool,schema,queue,generation)){
        await jobs.repairQueue(pool,queue,schema,generation);
        const result=await jobs.dispatchDueOutbox({pool,queue,owner:`resident-dispatch-${randomUUID()}`,client,destinations:{[kind==='content'?'content-worker':'chain-worker']:callback},expectedGeneration:generation,schemaName:schema,limit:kind==='content'?1:4});
        if(Object.values(result).some(Boolean))console.info(JSON.stringify({event:'resident_dispatch',queue,...result}));
      }
      if(retention&&Date.now()-lastRetention>=1200000){lastRetention=Date.now();await retention(pool,schema);}
      if(kind==='pipeline'&&env.TG_SERVER_PRICE_SCHEDULE==='1'&&Date.now()-lastPrice>=300000){
        lastPrice=Date.now();
        const response=await app.fetch(new Request('https://pipeline.tickergarden.com/internal/prices/refresh',{method:'POST',headers:{authorization:`Bearer ${env.CRON_SECRET??env.TG_PRICE_REFRESH_TOKEN}`,'x-tg-candidate-token':env.TG_CANDIDATE_ACCESS_TOKEN??''}}));
        await response.body?.cancel();if(!response.ok)throw Error(`Price refresh ${response.status}`);
      }
    }catch(error){console.error(JSON.stringify({event:'resident_dispatch_failed',queue,error:error.name,message:String(error.message).slice(0,180)}));}
    finally{if(!stopped)timer=setTimeout(()=>{active=tick();},intervalMs);}
  };
  timer=setTimeout(()=>{active=tick();},intervalMs);
  return async()=>{stopped=true;clearTimeout(timer);await active;};
}
