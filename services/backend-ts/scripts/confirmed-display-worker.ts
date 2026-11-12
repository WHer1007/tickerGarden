import {readDisplayCoverage,recordDisplayGap} from '../packages/confirmed-display/src/health.ts';
import {createPriceBatch,SharedPriceReader,priceBatchChannel} from '../packages/display-price/src/batch.ts';
import {databaseTimingSnapshot} from '../packages/db/src/telemetry.ts';
import {rpcRuntimeOptions} from '../packages/rpc-control/src/runtime.ts';
import {reportError,installProcessDiagnostics,logEvent,flushErrors} from '../packages/observability/src/index.ts';
import {changeChannel} from '../packages/confirmed-display/src/changes.ts';
import {refreshDisplayPreparation,refreshDisplayPrices} from '../packages/confirmed-display/src/maintenance.ts';
import {displayWakeChannel,DisplayWake} from '../packages/confirmed-display/src/wake.ts';
import {displayRpcFetch,type DisplayTrigger} from '../packages/confirmed-display/src/rpc-boundary.ts';
import {displaySchema,advanceConfirmedDisplay} from '../packages/confirmed-display/src/worker.ts';
import type {PoolClient} from 'pg';
import {createServer} from 'node:http';
import {createDatabasePool} from '../packages/db/src/index.ts';
import {RpcTransport} from '../packages/chain/src/index.ts';
import {CURRENT_CHAIN_ID,runtimeReleaseId,runtimeActivationBlock,assertRuntimeEnvironment} from '../packages/runtime-deployment/src/index.ts';
installProcessDiagnostics('confirmed-display-worker');
const env=process.env;assertRuntimeEnvironment(env);
function required(key:string){const value=env[key];if(!value)throw Error(`${key} is required`);return value;}
const pool=createDatabasePool(required('TG_PIPELINE_DATABASE_URL'),{max:2},{role:'display-worker',env}).pool;
const runtime=rpcRuntimeOptions(env,'confirmed-display-worker','realtime');
// No fallback and no startup RPC. Chain checks run only within an event/request.
const rpc=new RpcTransport({...runtime,url:required('TG_RPC_URL'),fetch:displayRpcFetch(runtime.fetch??fetch),observe:metric=>logEvent('confirmed-display-worker','info','rpc_call',metric as unknown as Record<string,unknown>)});
const deployment={environment:env.TG_ENVIRONMENT as 'test'|'production',chainId:CURRENT_CHAIN_ID,deploymentDigest:runtimeReleaseId,activationBlock:runtimeActivationBlock};
const schema=displaySchema(env.TG_DATABASE_SCHEMA),id=[deployment.environment,deployment.chainId,deployment.deploymentDigest];
const reader=new SharedPriceReader(deployment,env.TG_DATABASE_SCHEMA),priceChannel=priceBatchChannel(deployment,env.TG_DATABASE_SCHEMA),changesChannel=changeChannel(deployment,env.TG_DATABASE_SCHEMA),eventChannel=displayWakeChannel(deployment,env.TG_DATABASE_SCHEMA);
let stopped=false,lastSuccess=0,lastResult='idle',gapObserved=false,eventPending=false,pricePending=false,preparePending=false;
let gapToPersist:string|undefined;
let requested:DisplayTrigger|undefined,listener:PoolClient|undefined;
let listenerReady=false;
let lastFailure:{kind:'listen'|'price'|'event';at:string}|null=null;
let operation:'listen'|'price'|'event'='listen';
const wake=new DisplayWake(),abort=new AbortController();
const stop=()=>{stopped=true;abort.abort();};process.once('SIGTERM',stop);process.once('SIGINT',stop);
async function listen(){
 if(listener)return;
 const client=await pool.connect();listener=client;
 client.on('notification',message=>{
  if(message.channel===priceChannel){reader.invalidate();pricePending=true;}
  else if(message.channel===changesChannel)preparePending=true;
  else if(message.channel===eventChannel){
   if(message.payload==='recover'){gapObserved=true;gapToPersist='upstream-recovery-required';lastResult='gap:upstream-recovery-required';}
   else if(/^\d+$/.test(message.payload??''))eventPending=true;
   else {try{const p=JSON.parse(message.payload??'');if(p.type==='request'&&typeof p.id==='string'&&p.id.trim())requested={kind:'request',id:p.id,...(typeof p.transactionHash==='string'?{transactionHash:p.transactionHash}:{})};}catch{}}
  }
  wake.wake();
 });
 client.once('error',()=>{listenerReady=false;if(listener===client)listener=undefined;client.release(true);wake.wake();});
 try{
  for(const channel of [eventChannel,priceChannel,changesChannel])await client.query(`LISTEN ${channel}`);
  // A persisted unprocessed event is authority; a process restart alone is not.
  gapObserved=(await readDisplayCoverage(pool,deployment,env.TG_DATABASE_SCHEMA??'tickergarden_serverless')).status==='gap'||gapObserved;
  listenerReady=true;eventPending=true;if(lastFailure?.kind==='listen'){lastFailure=null;lastResult='idle';}wake.wake();
 }catch(e){listenerReady=false;if(listener===client){listener=undefined;client.release(true);}throw e;}
}
async function pendingEvent():Promise<DisplayTrigger|undefined>{
 const row=(await pool.query<{transaction_hash:string}>(`SELECT e.transaction_hash FROM ${schema}.display_event_inbox e WHERE e.environment=$1 AND e.chain_id=$2 AND e.deployment_digest=$3 AND ((NOT e.removed AND e.block_number>=coalesce((SELECT next_block FROM ${schema}.projection_checkpoints WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='analytics'),0) AND NOT EXISTS(SELECT 1 FROM ${schema}.display_event_applied a WHERE a.environment=e.environment AND a.chain_id=e.chain_id AND a.deployment_digest=e.deployment_digest AND a.block_hash=e.block_hash AND a.transaction_hash=e.transaction_hash AND a.log_index=e.log_index)) OR (e.removed AND EXISTS(SELECT 1 FROM ${schema}.display_event_applied a WHERE a.environment=e.environment AND a.chain_id=e.chain_id AND a.deployment_digest=e.deployment_digest AND a.block_hash=e.block_hash AND a.transaction_hash=e.transaction_hash AND a.log_index=e.log_index))) ORDER BY e.block_number,e.log_index LIMIT 1`,id)).rows[0];
 return row?{kind:'event',id:row.transaction_hash}:undefined;
}
const server=createServer((req,res)=>{if(req.url!=='/healthz'){res.writeHead(404).end();return;}res.writeHead(!stopped&&listenerReady&&!lastFailure?200:503,{'content-type':'application/json'}).end(JSON.stringify({lastSuccess,lastResult,lastFailure,displayOnly:true,mode:'push-only',coverage:gapObserved?'gap':'unverified',synchronized:false,idleIsHealthy:true,database:databaseTimingSnapshot()}));});
server.listen(Number(env.TG_DISPLAY_HEALTH_PORT??8084),'127.0.0.1');
try{while(!stopped){
 try{
  operation='listen';await listen();
  if(gapToPersist){await recordDisplayGap(pool,deployment,env.TG_DATABASE_SCHEMA??'tickergarden_serverless',gapToPersist);gapToPersist=undefined;}
  if(pricePending||preparePending){
   operation='price';const price=pricePending;pricePending=false;preparePending=false;
   const input={pool,deployment,priceBatch:createPriceBatch(deployment,env.TG_DATABASE_SCHEMA,new Date(),reader),...(env.TG_DATABASE_SCHEMA?{schemaName:env.TG_DATABASE_SCHEMA}:{})};
   let result=price?await refreshDisplayPrices(input):await refreshDisplayPreparation(input);
   while(result.more&&!stopped)result=await refreshDisplayPreparation(input);
   if(result.failed)throw Error('Display price preparation incomplete');
   if(lastFailure?.kind==='price'){lastFailure=null;lastResult='idle';}
  }
  if(eventPending||requested){
   operation='event';eventPending=false;const trigger=requested??await pendingEvent();requested=undefined;
   if(trigger){
    lastResult=await advanceConfirmedDisplay({pool,deployment,rpc,trigger,priceBatch:createPriceBatch(deployment,env.TG_DATABASE_SCHEMA,new Date(),reader),...(env.TG_DATABASE_SCHEMA?{schemaName:env.TG_DATABASE_SCHEMA}:{})});lastSuccess=Date.now();if(lastFailure?.kind==='event')lastFailure=null;
    // Continue only after progress, and reselect a concrete durable event each pass.
    if(lastResult.startsWith('gap:')){gapObserved=true;await recordDisplayGap(pool,deployment,env.TG_DATABASE_SCHEMA??'tickergarden_serverless',lastResult);}
    if(lastResult.startsWith('confirmed:')||lastResult.startsWith('initialized:')){eventPending=true;continue;}
    if(trigger.kind==='event'&&await pendingEvent()){gapObserved=true;lastResult='blocked:event-repair-required';await recordDisplayGap(pool,deployment,env.TG_DATABASE_SCHEMA??'tickergarden_serverless','event-repair-required');lastFailure={kind:'event',at:new Date().toISOString()};}
   }
  }
 }catch(error){lastFailure={kind:operation,at:new Date().toISOString()};if(operation==='event'){gapObserved=true;gapToPersist='event-processing-failed';}lastResult='retrying';reportError('display-worker','confirmed_display_blocked',error,{},'warn');}
 // Timeout only repairs the database listener. It never authorizes chain work.
 await wake.wait(30000,abort.signal);
}}
finally{stop();server.close();await flushErrors(1000);if(listener){await listener.query('UNLISTEN *').catch(()=>{});listener.release();}await pool.end();}
