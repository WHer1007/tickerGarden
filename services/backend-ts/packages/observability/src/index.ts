import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
import pino from 'pino';
import * as Sentry from '@sentry/node';
import {waitUntil} from '@vercel/functions';
import {deliverAlert} from './intake.ts';
import {enqueueAlert,type Alert} from './lark.ts';
import {cleanText,safeContext,safeError} from './sanitize.ts';
export {cleanText,safeContext,safeError} from './sanitize.ts';
type Context=Record<string,unknown>;
const context=new AsyncLocalStorage<Context>();
const seen=new WeakSet<Error>();
let sentryStarted=false;
const windows=new Map<string,{at:number;count:number}>();
const deliveries=new Set<Promise<unknown>>();
let localDelivery=Promise.resolve();
function track(promise:Promise<unknown>){deliveries.add(promise);void promise.finally(()=>deliveries.delete(promise)).catch(()=>{});if(process.env.VERCEL)try{waitUntil(promise);}catch{}}
function alertDelivery(alert:Alert){
 const env=process.env;if(deliveries.size>=20)return;
 let task:Promise<unknown>|undefined;
 if(env.TG_ALERT_SPOOL_DIR&&!env.VERCEL){const dir=env.TG_ALERT_SPOOL_DIR;localDelivery=localDelivery.then(async()=>{await enqueueAlert(dir,alert);}).catch(()=>{logEvent('observability','error','alert_enqueue_failed');});task=localDelivery;}
 else if(env.TG_ALERT_INGEST_URL&&env.TG_ALERT_INGEST_TOKEN){task=deliverAlert(env.TG_ALERT_INGEST_URL,env.TG_ALERT_INGEST_TOKEN,alert).then(ok=>{if(!ok)logEvent('observability','error','alert_enqueue_failed');});}
 if(task)track(task);
}
const loggers=new Map<string,pino.Logger>();
function logger(service:string){
 let log=loggers.get(service);if(log)return log;
 const env=process.env;
 log=pino({level:['debug','info','warn','error','fatal','silent'].includes(env.TG_LOG_LEVEL??'')?env.TG_LOG_LEVEL!:'info',
  base:{service,environment:env.TG_ENVIRONMENT??'local',releaseCommit:env.TG_RELEASE_COMMIT??env.VERCEL_GIT_COMMIT_SHA??'unconfigured'},
  timestamp:pino.stdTimeFunctions.isoTime,redact:{paths:['authorization','cookie','signature','privateKey','password','secret','dsn'],remove:true}});
 loggers.set(service,log);return log;
}
export function withLogContext<T>(fields:Context,fn:()=>T):T{return context.run({...context.getStore(),...safeContext(fields)},fn);}
export function logEvent(service:string,level:'info'|'warn'|'error',event:string,fields:Context={}){
 try{logger(service)[level]({...context.getStore(),...safeContext(fields),event:cleanText(event,100)});}catch{/* Logging never changes a business result. */}
}
function startSentry(){
 if(sentryStarted||!process.env.TG_SENTRY_DSN)return;
 Sentry.init({dsn:process.env.TG_SENTRY_DSN,environment:process.env.TG_ENVIRONMENT??'local',release:process.env.TG_RELEASE_COMMIT??process.env.VERCEL_GIT_COMMIT_SHA,
  sendDefaultPii:false,defaultIntegrations:false,skipOpenTelemetrySetup:true,
  beforeSend(event){
   delete event.request;delete event.user;delete event.breadcrumbs;delete event.contexts;delete event.extra;
   if(event.message)event.message=cleanText(event.message);
   for(const value of event.exception?.values??[]){if(value.value)value.value=cleanText(value.value);for(const frame of value.stacktrace?.frames??[]){delete frame.vars;if(frame.filename)frame.filename=cleanText(frame.filename);}}
   return event;
  }});sentryStarted=true;
}
export function reportError(service:string,event:string,error:unknown,fields:Context={},level:'warn'|'error'='error'){
 try{
  if(error instanceof Error){if(seen.has(error))return;seen.add(error);}
  const safe=safeError(error),metadata={...context.getStore(),...safeContext(fields)},fingerprint=createHash('sha256').update(JSON.stringify([service,event,safe.type,safe.message])).digest('hex').slice(0,20);
  const now=Date.now(),previous=windows.get(fingerprint);
  if(previous&&now-previous.at<60000){previous.count++;return;}
  if(windows.size>=1000)windows.delete(windows.keys().next().value!);
  windows.set(fingerprint,{at:now,count:1});
  logger(service)[level]({...metadata,event:cleanText(event,100),fingerprint,count:previous?.count??1,error:safe});
  alertDelivery({environment:process.env.TG_ENVIRONMENT??'local',service,event,severity:level==='warn'?'warning':'error',summary:String(safe.message??'Unknown error'),...(metadata.requestId?{requestId:String(metadata.requestId)}:{}),releaseCommit:process.env.TG_RELEASE_COMMIT??process.env.VERCEL_GIT_COMMIT_SHA??'unconfigured'});
  startSentry();if(!sentryStarted)return;
  const diagnostic=new Error(String(safe.message??'Unknown error'));diagnostic.name=String(safe.type??'Error');if(safe.stack)diagnostic.stack=String(safe.stack);
  Sentry.captureException(diagnostic,{level:level==='warn'?'warning':'error',tags:{service,event:cleanText(event,100),...Object.fromEntries(Object.entries(metadata).map(([k,v])=>[k,String(v)]))},fingerprint:[service,event,fingerprint]});
  if(process.env.VERCEL){const flush=Sentry.flush(1500).catch(()=>false);try{waitUntil(flush);}catch{void flush;}}
 }catch{/* Avoid recursive failures and preserve the original outcome. */}
}
export async function flushErrors(timeout=1500):Promise<void>{const deadline=Date.now()+timeout;let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([Promise.allSettled([...deliveries]),new Promise(r=>{timer=setTimeout(r,timeout);timer.unref();})]);const remaining=deadline-Date.now();if(sentryStarted&&remaining>0)await Sentry.flush(remaining);}catch{}finally{if(timer)clearTimeout(timer);}}

const observedProcesses=new Set<string>();
export function installProcessDiagnostics(service:string){
 if(observedProcesses.has(service))return;observedProcesses.add(service);
 // Preserve fatal exit after a bounded flush; never resume after an uncaught error.
 process.once('uncaughtException',error=>{reportError(service,'process_uncaught_exception',error);void flushErrors(1000).finally(()=>process.exit(1));});
 process.on('warning',warning=>reportError(service,'process_warning',warning,{},'warn'));
}
