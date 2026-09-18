/** No UI, wallet payloads or request bodies. SDK loads only when a DSN is configured. */
import {cleanText} from '../../../services/backend-ts/packages/observability/src/sanitize.ts';
const telemetryEnv=import.meta.env??{};
type Fields={flow?:string;step?:string;code?:string;reference?:string;operationId?:string;requestId?:string};
let sdk:typeof import('./observability-sdk.ts')|undefined;
let starting:Promise<void>|undefined;
let retryAfter=0;
const fingerprints=new Map<string,number>();
const pending:Array<{error:unknown;fields:Fields}>=[];
const seen=new WeakSet<Error>();
function expected(error:unknown):boolean {
 let value=error;
 for(let i=0;i<4&&value&&typeof value==='object';i++){
  const e=value as {code?:unknown;name?:string;cause?:unknown};
  if(e.code===4001||e.code==='4001'||e.code==='user_rejected'||e.name==='AbortError'||e.name==='InsufficientFundsError'||e.code==='insufficient_funds')return true;
  value=e.cause;
 }
 return false;
}
export function reportClientError(error:unknown,fields:Fields={}){
 try{
  if(expected(error)||['user_rejected','insufficient_funds','details_changed'].includes(fields.code??''))return;
  const fingerprint=cleanText(error instanceof Error?error.name+':'+error.message:'unknown',300);const now=Date.now();
  if(now-(fingerprints.get(fingerprint)??0)<60000)return;
  if(fingerprints.size>=100)fingerprints.delete(fingerprints.keys().next().value!);fingerprints.set(fingerprint,now);
  if(error instanceof Error){if(seen.has(error))return;seen.add(error);}
  if(!sdk){if(telemetryEnv.VITE_SENTRY_DSN){if(pending.length>=20)pending.shift();pending.push({error,fields});void startObservability();}return;}
  capture(error,fields);
 }catch{/* Error reporting must never affect a transaction. */}
}
function capture(error:unknown,fields:Fields){
 const body=error&&typeof error==='object'?(error as {body?:{requestId?:unknown}}).body:undefined;
 if(typeof body?.requestId==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(body.requestId))fields={...fields,requestId:body.requestId};
 sdk?.captureException(error instanceof Error?error:new Error('Non-Error rejection'),{tags:Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,cleanText(v??'',160)]))});
}
export function startObservability():Promise<void>{
 if(starting)return starting;
 if(Date.now()<retryAfter)return Promise.resolve();
 if(!telemetryEnv.VITE_SENTRY_DSN)return Promise.resolve();
 starting=import('./observability-sdk.ts').then(module=>{
  module.init({dsn:telemetryEnv.VITE_SENTRY_DSN,environment:telemetryEnv.VITE_TG_ENVIRONMENT??'local',release:telemetryEnv.VITE_RELEASE_COMMIT,
   sendDefaultPii:false,defaultIntegrations:false,
   beforeSend(event){
    delete event.request;delete event.user;delete event.breadcrumbs;delete event.extra;delete event.contexts;
    if(event.message)event.message=cleanText(event.message);
    for(const item of event.exception?.values??[]){if(item.value)item.value=cleanText(item.value);for(const frame of item.stacktrace?.frames??[]){delete frame.vars;if(frame.filename){try{const u=new URL(frame.filename,location.origin);frame.filename=u.origin===location.origin&&/^\/assets\/[\w.-]+\.js$/.test(u.pathname)?u.origin+u.pathname:'[external-frame]';}catch{frame.filename='[unknown-frame]';}}}}
    return event;
   }});sdk=module;
  for(const event of pending.splice(0))capture(event.error,event.fields);
 }).catch(()=>{starting=undefined;retryAfter=Date.now()+30000;});return starting;
}
export function installClientErrorCapture(){
 window.addEventListener('error',(event:Event)=>{if(event instanceof ErrorEvent)reportClientError(event.error??new Error('Script error'),{flow:'browser',step:'uncaught'});else if(event.target instanceof HTMLScriptElement||event.target instanceof HTMLLinkElement)reportClientError(new Error('Page resource failed to load'),{flow:'browser',step:'resource_load'});},true);
 window.addEventListener('unhandledrejection',event=>reportClientError(event.reason,{flow:'browser',step:'unhandled_rejection'}));
 void startObservability();
}
