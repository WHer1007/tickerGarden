import type {PoolClient} from 'pg';
import {displayWakeChannel,DisplayWake,displayCatchup} from '../packages/confirmed-display/src/wake.ts';
import {setTimeout as pause} from 'node:timers/promises';
import {createServer} from 'node:http';
import {createDatabasePool} from '../packages/db/src/index.ts';
import {RpcTransport,verifyChainIdentity} from '../packages/chain/src/index.ts';
import {advanceConfirmedDisplay} from '../packages/confirmed-display/src/worker.ts';
import {CURRENT_CHAIN_ID,runtimeReleaseId,runtimeActivationBlock,runtimeGenesisHash,assertRuntimeEnvironment} from '../packages/runtime-deployment/src/index.ts';
const env=process.env;assertRuntimeEnvironment(env);
function required(key:string){const value=env[key];if(!value)throw Error(`${key} is required`);return value;}
const pool=createDatabasePool(required('TG_PIPELINE_DATABASE_URL'),{max:2},{role:'display-worker',env}).pool;
const rpc=new RpcTransport({url:required('TG_RPC_URL')});
await verifyChainIdentity(rpc,BigInt(CURRENT_CHAIN_ID),runtimeGenesisHash);
const deployment={environment:env.TG_ENVIRONMENT as 'test'|'production',chainId:CURRENT_CHAIN_ID,deploymentDigest:runtimeReleaseId,activationBlock:runtimeActivationBlock};
let stopped=false,lastSuccess=0,lastResult='starting';
const wake=new DisplayWake();
let listener:PoolClient|undefined;
async function listen(){
 if(listener)return;
 const client=await pool.connect();listener=client;
 client.on('notification',wake.wake);
 client.once('error',()=>{if(listener===client)listener=undefined;client.release(true);wake.wake();});
 try{await client.query(`LISTEN ${displayWakeChannel(deployment,env.TG_DATABASE_SCHEMA)}`);}
 catch(e){if(listener===client){listener=undefined;client.release(true);}throw e;}
}
const abort=new AbortController();process.once('SIGTERM',()=>{stopped=true;abort.abort();});process.once('SIGINT',()=>{stopped=true;abort.abort();});
const server=createServer((req,res)=>{if(req.url!=='/healthz'){res.writeHead(404).end();return;}res.writeHead(!stopped&&Date.now()-lastSuccess<60000?200:503,{'content-type':'application/json'}).end(JSON.stringify({lastSuccess,lastResult,displayOnly:true}));});
server.listen(Number(env.TG_DISPLAY_HEALTH_PORT??8084),'127.0.0.1');
try{while(!stopped){
 const started=Date.now();
 try{
  await listen();
  lastResult=await advanceConfirmedDisplay({pool,deployment,rpc,...(env.TG_DATABASE_SCHEMA?{schemaName:env.TG_DATABASE_SCHEMA}:{})});
  if(lastResult==='current'||lastResult.startsWith('confirmed:')||displayCatchup(lastResult))lastSuccess=Date.now();
 }catch{lastResult='retrying';console.error(JSON.stringify({event:'confirmed_display_retry'}));}
 if(displayCatchup(lastResult)){await pause(100,undefined,{signal:abort.signal}).catch(()=>{});continue;}
 // Real-time work is event driven, coalesced to at most one pass per second.
 // A 30-second scan also recovers missed notifications, disconnects and reorgs.
 await pause(Math.max(0,1000-(Date.now()-started)),undefined,{signal:abort.signal}).catch(()=>{});
 await wake.wait(lastResult==='retrying'?5000:30000,abort.signal);
}}
finally{server.close();if(listener){await listener.query('UNLISTEN *').catch(()=>{});listener.release();listener=undefined;}await pool.end();}
