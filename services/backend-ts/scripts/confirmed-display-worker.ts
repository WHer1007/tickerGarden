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
const abort=new AbortController();process.once('SIGTERM',()=>{stopped=true;abort.abort();});process.once('SIGINT',()=>{stopped=true;abort.abort();});
const server=createServer((req,res)=>{if(req.url!=='/healthz'){res.writeHead(404).end();return;}res.writeHead(!stopped&&Date.now()-lastSuccess<60000?200:503,{'content-type':'application/json'}).end(JSON.stringify({lastSuccess,lastResult,displayOnly:true}));});
server.listen(Number(env.TG_DISPLAY_HEALTH_PORT??8084),'127.0.0.1');
try{while(!stopped){try{lastResult=await advanceConfirmedDisplay({pool,deployment,rpc,...(env.TG_DATABASE_SCHEMA?{schemaName:env.TG_DATABASE_SCHEMA}:{})});if(lastResult==='current'||lastResult.startsWith('confirmed:'))lastSuccess=Date.now();}catch{lastResult='retrying';console.error(JSON.stringify({event:'confirmed_display_retry'}));}await pause(lastResult.startsWith('confirmed:')?100:2000,undefined,{signal:abort.signal}).catch(()=>{});}}
finally{server.close();await pool.end();}
