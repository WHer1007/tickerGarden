import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {mappedFetch,serveFetch} from './transport.mjs';
import {startScheduler} from './scheduler.mjs';
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(!config.name||!path.isAbsolute(config.source)||!Number.isInteger(config.port))throw Error('Invalid generated service configuration');
for(const key of Object.keys(process.env))if(key.startsWith('VERCEL'))delete process.env[key];
Object.assign(process.env,config.env,{NODE_ENV:config.environment==='test'?'test':'production'});
globalThis.fetch=mappedFetch({...config.transport,...config.transportOverrides});
const load=relative=>import(pathToFileURL(path.join(config.source,relative)).href);
let handler,pool,stopScheduler;
if(config.kind==='gateway'){
  if(config.routerOnly){const {createGateway}=await load('services/evm-gateway/src/router.mjs');handler=createGateway(JSON.parse(process.env.EVM_GATEWAY_CONFIG_JSON));}
  else{const module=await load('services/evm-gateway/src/vercel.mjs');handler=module.default;}
}else if(config.kind==='web'){
  const {createWebHandler}=await import('./web.mjs');handler=await createWebHandler(config,load);
}else{
  const backend='services/backend-ts/';
  const env=config.bsc?(await load(backend+'packages/bsc/src/runtime.ts')).serviceEnvironment():process.env;
  // SDKs such as QStash read process.env rather than the app's injected env.
  // Keep them on the same service-scoped configuration, including private URLs.
  Object.assign(process.env,env);
  const {createDatabasePool}=await load(backend+'packages/db/src/index.ts');
  pool=createDatabasePool(env[config.kind==='read-api'?'TG_READ_DATABASE_URL':config.kind==='pipeline'?'TG_PIPELINE_DATABASE_URL':'TG_CONTENT_DATABASE_URL'],{}, {role:config.kind,env}).pool;
  const factories={'read-api':'createReadApiApp',pipeline:'createPipelineApp',content:'createContentApp'};
  const module=await load(backend+`apps/${config.kind}/src/index.ts`);
  const app=module[factories[config.kind]]({env,pool});handler=request=>app.fetch(request);
  if(config.scheduler){
    const jobs=await load(backend+'packages/jobs/src/index.ts');
    const retention=config.kind==='pipeline'?(await load(backend+'packages/jobs/src/retention.ts')).runScheduledQueueRetention:undefined;
    stopScheduler=startScheduler({pool,env:{...env,TG_SERVER_PRICE_SCHEDULE:config.priceSchedule?'1':'0'},kind:config.kind,app,jobs,retention});
  }
}
const server=serveFetch(handler,{host:config.host,port:config.port});
console.info(JSON.stringify({event:'server_started',name:config.name,port:config.port}));
// Release temporary TypeScript/module initialization objects on small resident hosts.
setTimeout(()=>globalThis.gc?.(),1000).unref();
let closing=false;
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{
  if(closing)return;closing=true;const timeout=setTimeout(()=>process.exit(1),15000);timeout.unref();
  await stopScheduler?.();server.close(async()=>{await pool?.end();process.exit(0);});server.closeIdleConnections();
});
