import {createPriceBatch,SharedPriceReader,priceBatchChannel} from '../packages/display-price/src/batch.ts';
import {databaseTimingSnapshot} from '../packages/db/src/telemetry.ts';
import {rpcRuntimeOptions,withRpcTier} from '../packages/rpc-control/src/runtime.ts';
import {rpcFailoverOptions} from '../packages/chain/src/rpc-policy.ts';
import {reportError,installProcessDiagnostics,logEvent,flushErrors} from '../packages/observability/src/index.ts';
import {changeChannel} from '../packages/confirmed-display/src/changes.ts';
import {refreshDisplayPreparation} from '../packages/confirmed-display/src/maintenance.ts';
import type {PoolClient} from 'pg';
import {displayWakeChannel,DisplayWake,displayCatchup} from '../packages/confirmed-display/src/wake.ts';
import {setTimeout as pause} from 'node:timers/promises';
import {createServer} from 'node:http';
import {createDatabasePool} from '../packages/db/src/index.ts';
import {RpcTransport,verifyChainIdentity} from '../packages/chain/src/index.ts';
import {advanceConfirmedDisplay} from '../packages/confirmed-display/src/worker.ts';
import {CURRENT_CHAIN_ID,runtimeReleaseId,runtimeActivationBlock,runtimeGenesisHash,assertRuntimeEnvironment} from '../packages/runtime-deployment/src/index.ts';
installProcessDiagnostics('confirmed-display-worker');
const env=process.env;assertRuntimeEnvironment(env);
function required(key:string){const value=env[key];if(!value)throw Error(`${key} is required`);return value;}
const pool=createDatabasePool(required('TG_PIPELINE_DATABASE_URL'),{max:2},{role:'display-worker',env}).pool;
const rpcRuntime=rpcRuntimeOptions(env,'confirmed-display-worker','realtime');
const rpc=new RpcTransport({...rpcRuntime,...rpcFailoverOptions(env),url:required('TG_RPC_URL'),observe:metric=>logEvent('confirmed-display-worker','info','rpc_call',metric as unknown as Record<string,unknown>)});
await verifyChainIdentity(rpc,BigInt(CURRENT_CHAIN_ID),runtimeGenesisHash);
const deployment={environment:env.TG_ENVIRONMENT as 'test'|'production',chainId:CURRENT_CHAIN_ID,deploymentDigest:runtimeReleaseId,activationBlock:runtimeActivationBlock};
const priceReader=new SharedPriceReader(deployment,env.TG_DATABASE_SCHEMA);
const priceChannel=priceBatchChannel(deployment,env.TG_DATABASE_SCHEMA);
let pricesChanged=false;
let stopped=false,lastSuccess=0,lastResult='starting',forceRecovery=true;
const wake=new DisplayWake();
const preparationWake=new DisplayWake();
const changesChannel=changeChannel(deployment,env.TG_DATABASE_SCHEMA);
let listener:PoolClient|undefined;
async function listen(){
 if(listener)return;
 const client=await pool.connect();listener=client;
 client.on('notification',message=>{preparationWake.wake();if(message.channel===changesChannel)return;if(message.channel===priceChannel){priceReader.invalidate();pricesChanged=true;}else if(message.payload==='recover')forceRecovery=true;wake.wake();});
 client.once('error',()=>{if(listener===client)listener=undefined;client.release(true);wake.wake();preparationWake.wake();});
 try{await client.query(`LISTEN ${displayWakeChannel(deployment,env.TG_DATABASE_SCHEMA)}`);await client.query(`LISTEN ${priceChannel}`);await client.query(`LISTEN ${changesChannel}`);priceReader.invalidate();preparationWake.wake();}
 catch(e){if(listener===client){listener=undefined;client.release(true);}throw e;}
}
const abort=new AbortController();process.once('SIGTERM',()=>{stopped=true;abort.abort();});process.once('SIGINT',()=>{stopped=true;abort.abort();});
const server=createServer((req,res)=>{if(req.url!=='/healthz'){res.writeHead(404).end();return;}res.writeHead(!stopped&&Date.now()-lastSuccess<60000?200:503,{'content-type':'application/json'}).end(JSON.stringify({lastSuccess,lastResult,displayOnly:true,database:databaseTimingSnapshot()}));});
server.listen(Number(env.TG_DISPLAY_HEALTH_PORT??8084),'127.0.0.1');
// Maintenance uses the LISTEN connection for short SQL reads/writes, keeping
// its work independent of the scanner without increasing the two-connection budget.
const maintenance=(async()=>{while(!stopped){
 let more=false;
 try{
  if(listener){
   const result=await refreshDisplayPreparation({pool:listener,deployment,priceBatch:createPriceBatch(deployment,env.TG_DATABASE_SCHEMA,new Date(),priceReader),...(env.TG_DATABASE_SCHEMA?{schemaName:env.TG_DATABASE_SCHEMA}:{})});
   more=result.more;
   if(result.failed)console.error(JSON.stringify({event:'display_preparation_retry',failed:result.failed}));
  }
 }catch(error){reportError('display-worker','display_preparation_unavailable',error,{},'warn');}
 // New launch/event/price notifications wake maintenance immediately. A five-second
 // fallback also covers missed notifications and scheduled retry deadlines.
 await pause(more?100:1000,undefined,{signal:abort.signal}).catch(()=>{});
 if(!more)await preparationWake.wait(4000,abort.signal);
}})();
try{while(!stopped){
 const started=Date.now();
 try{
  await listen();
  const recover=forceRecovery;forceRecovery=false;const priceChanged=pricesChanged;pricesChanged=false;
  lastResult=await advanceConfirmedDisplay({pool,deployment,rpc,priceChanged,priceBatch:createPriceBatch(deployment,env.TG_DATABASE_SCHEMA,new Date(),priceReader),eventDriven:env.TG_DISPLAY_EVENT_DRIVEN==='true',forceRecovery:recover,...(env.TG_DATABASE_SCHEMA?{schemaName:env.TG_DATABASE_SCHEMA}:{})});
  if(lastResult==='current'||lastResult.startsWith('confirmed:')||displayCatchup(lastResult))lastSuccess=Date.now();
 }catch(error){forceRecovery=true;pricesChanged=true;lastResult='retrying';reportError('display-worker','confirmed_display_retry',error,{},'warn');}
 if(displayCatchup(lastResult)){await pause(100,undefined,{signal:abort.signal}).catch(()=>{});continue;}
 // Real-time work is event driven, coalesced to at most one pass per second.
 // A 30-second scan also recovers missed notifications, disconnects and reorgs.
 await pause(Math.max(0,1000-(Date.now()-started)),undefined,{signal:abort.signal}).catch(()=>{});
 await wake.wait(lastResult==='retrying'?5000:30000,abort.signal);
}}
finally{stopped=true;abort.abort();await maintenance;server.close();await flushErrors(1000);if(listener){await listener.query('UNLISTEN *').catch(()=>{});listener.release();listener=undefined;}await pool.end();}
