/** Optional dedicated process. Do not start until notification delivery is explicitly enabled. */
import {createServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {drainAlerts,enqueueAlert,type Alert} from '../packages/observability/src/lark.ts';
import {logEvent,reportError,installProcessDiagnostics} from '../packages/observability/src/index.ts';
const env=process.env,dir=env.TG_ALERT_SPOOL_DIR,token=env.TG_ALERT_INGEST_TOKEN,url=env.TG_LARK_WEBHOOK_URL,secret=env.TG_LARK_SIGNING_SECRET;
if(env.TG_ALERT_DELIVERY_ENABLED!=='true'||!dir?.startsWith('/')||!token||token.length<32||!url||!secret)throw Error('Alert delivery is not configured or explicitly enabled');
// This process must not report its own failures back into its own intake/spool.
delete env.TG_ALERT_SPOOL_DIR;delete env.TG_ALERT_INGEST_URL;
installProcessDiagnostics('alert-worker');
let stopped=false,busy=false;let serialized=Promise.resolve();let accepted=0,windowAt=Date.now();
function schedule<T>(fn:()=>Promise<T>):Promise<T>{const task=serialized.then(fn);serialized=task.then(()=>{},()=>{});return task;}
function auth(value:string|undefined){const expected=Buffer.from(`Bearer ${token}`),actual=Buffer.from(value??'');return expected.length===actual.length&&timingSafeEqual(expected,actual);}
const server=createServer(async(req,res)=>{
 if(req.url==='/healthz'&&req.method==='GET'){res.writeHead(stopped?503:200).end();return;}
 if(req.method!=='POST'||req.url!=='/alerts'){res.writeHead(404).end();return;}
 if(!auth(req.headers.authorization)){res.writeHead(401).end();return;}
 if(Date.now()-windowAt>60000){accepted=0;windowAt=Date.now();}if(accepted>=120){res.writeHead(429).end();return;}accepted++;
 try{
  let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>8192){res.writeHead(413).end();return;}}
  const value=JSON.parse(raw) as Alert;
  if(!value||value.environment!==env.TG_ENVIRONMENT||!['warning','error','critical','resolved'].includes(value.severity)||['service','event','summary'].some(k=>typeof (value as unknown as Record<string,unknown>)[k]!=='string')){res.writeHead(400).end();return;}
  await schedule(()=>enqueueAlert(dir,value));res.writeHead(202).end();
 }catch(error){reportError('alert-worker','alert_intake_failed',error);res.writeHead(503).end();}
});
const port=Number(env.TG_ALERT_PORT??'8090');if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid alert listener port');
server.requestTimeout=5000;server.headersTimeout=5000;server.listen(port,'127.0.0.1');
const timer=setInterval(()=>{if(stopped||busy)return;busy=true;void schedule(()=>drainAlerts(dir,{webhookUrl:url,signingSecret:secret})).then(result=>{if(result.sent||result.retry||result.dead)logEvent('alert-worker',result.dead?'error':result.retry?'warn':'info','alert_delivery',result);}).catch(error=>reportError('alert-worker','alert_delivery_failed',error)).finally(()=>{busy=false;});},5000);
for(const signal of ['SIGTERM','SIGINT'] as const)process.once(signal,()=>{stopped=true;clearInterval(timer);server.close();});
