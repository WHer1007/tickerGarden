import {rpcPolicy} from '../packages/chain/src/rpc-policy.ts';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {createDatabasePool} from '../packages/db/src/index.ts';
import {validateDatabasePlacement} from '../packages/db/src/connection-budget.ts';
import {createChainProcessor,settlementFinalityMode} from '../packages/chain-worker/src/index.ts';
import {RpcTransport} from '../packages/chain/src/index.ts';
import {setQueueExecutionMode} from '../packages/jobs/src/index.ts';
import {createWorkerState,runResidentWorker} from '../packages/chain-worker/src/resident.ts';

const env=process.env;
const rpc=rpcPolicy(env);
function required(key:string):string{const value=env[key];if(!value)throw Error(`${key} is required`);return value;}
const generationText=required('TG_PIPELINE_GENERATION');
if(!/^(0|[1-9][0-9]*)$/.test(generationText))throw Error('invalid generation');
const generation=BigInt(generationText), schemaName=env.TG_DATABASE_SCHEMA??'tickergarden_serverless';
const mode=process.argv[2];
if(mode!==undefined&&mode!=='--activate'&&mode!=='--rollback')throw Error('usage: resident-worker.ts [--activate|--rollback]');
// These values are deployment attestations, not inferred from IP addresses.
validateDatabasePlacement({applicationRegion:required('TG_APPLICATION_REGION'),databaseRegion:required('TG_DATABASE_REGION'),workerRegion:required('TG_WORKER_REGION')});
required('TG_DB_BUDGET_JSON');
const pool=createDatabasePool(required('TG_PIPELINE_DATABASE_URL'),{}, {role:'resident-worker',env}).pool;
if(mode){
 try{await setQueueExecutionMode(pool,mode==='--activate'?'resident':'qstash',generation,schemaName);console.log(JSON.stringify({mode:mode==='--activate'?'resident':'qstash',generation:generationText}));}
 finally{await pool.end();}
}else{
 if(env.TG_WORKER_CONTROL_POOL_MODE!=='direct'&&env.TG_WORKER_CONTROL_POOL_MODE!=='session')throw Error('control connection requires explicit direct or session mode');
 const controlPool=createDatabasePool(required('TG_WORKER_CONTROL_DATABASE_URL'),{max:1},{role:'resident-control',env}).pool;
 const environment=required('TG_ENVIRONMENT');
 if(environment!=='test'&&environment!=='production')throw Error('invalid environment');
 const processor=createChainProcessor({settlementFinality:settlementFinalityMode(env),pool,primary:new RpcTransport({url:required('TG_RPC_URL')}),secondary:new RpcTransport({url:rpc.verificationUrl ?? ''}),
  ...(rpc.logsUrl?{logsSecondary:new RpcTransport({url:rpc.logsUrl})}:{}),environment,schemaName,
  ...(env.V1_FINALITY_DELAY_BLOCKS?{finalityDelayBlocks:BigInt(env.V1_FINALITY_DELAY_BLOCKS)}:{}),
  ...(env.V1_FINALITY_DELAY_SECONDS?{finalityDelaySeconds:BigInt(env.V1_FINALITY_DELAY_SECONDS)}:{})});
 const abort=new AbortController(),state=createWorkerState();
 const stop=()=>{state.stopping=true;state.ready=false;abort.abort();};
 process.once('SIGTERM',stop);process.once('SIGINT',stop);
 const port=Number(env.TG_WORKER_HEALTH_PORT??8082);
 if(!Number.isSafeInteger(port)||port<1||port>65535)throw Error('invalid health port');
 const server=createServer((req,res)=>{
  if(req.url!=='/healthz'){res.writeHead(404).end();return;}
  const healthy=state.ready&&!state.stopping&&(state.activeOperation!==null||Date.now()-state.lastPollAt<60000);
  res.writeHead(healthy?200:503,{'content-type':'application/json'}).end(JSON.stringify(state));
 });
 server.listen(port,env.TG_WORKER_HEALTH_HOST??'127.0.0.1');
 try{await runResidentWorker({pool,controlPool,owner:`resident-${randomUUID()}`,generation,schemaName,signal:abort.signal,state,process:processor,
  fatal:error=>{console.error(JSON.stringify({event:'resident_worker_fatal',reason:error.message}));process.exit(1);}});}
 finally{server.close();await controlPool.end();await pool.end();}
}
