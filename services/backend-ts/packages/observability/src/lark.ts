import {createHash,createHmac,randomUUID} from 'node:crypto';
import {mkdir,readFile,readdir,rename,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {cleanText} from './sanitize.ts';
export type Alert={environment:string;service:string;event:string;severity:'warning'|'error'|'critical'|'resolved';summary:string;releaseCommit?:string;requestId?:string};
type Stored={alert:Alert;count:number;attempts:number;firstAt:number;lastAt:number;dueAt:number;sentAt?:number;deadAt?:number;state:'pending'|'sent'|'dead'};
export type LarkConfig={webhookUrl:string;signingSecret:string};
export function larkPayload(alert:Alert,count:number,secret:string,now=Date.now()){
 const timestamp=String(Math.floor(now/1000));
 return {timestamp,sign:createHmac('sha256',`${timestamp}\n${secret}`).update('').digest('base64'),msg_type:'text',content:{text:[`TickerGarden · ${cleanText(alert.severity,20)} · ${cleanText(alert.environment,30)}`,`${cleanText(alert.service,60)} / ${cleanText(alert.event,100)}`,cleanText(alert.summary,1000),`Occurrences: ${count}`,`Release: ${cleanText(alert.releaseCommit??'unknown',80)}`,`Request: ${cleanText(alert.requestId??'-',128)}`].join('\n')}};
}
function validate(config:LarkConfig){const u=new URL(config.webhookUrl);if(u.protocol!=='https:'||!['open.larksuite.com','open.feishu.cn'].includes(u.hostname)||u.port||u.username||u.password||u.search||u.hash||!/^\/open-apis\/bot\/v2\/hook\/[a-zA-Z0-9-]+$/.test(u.pathname)||config.signingSecret.length<16)throw Error('Invalid Lark configuration');}
async function save(file:string,data:Stored){const tmp=file+'.'+randomUUID()+'.tmp';try{await writeFile(tmp,JSON.stringify(data),{mode:0o600});await rename(tmp,file);}finally{await rm(tmp,{force:true}).catch(()=>{});}}
async function exclusive<T>(dir:string,fn:()=>Promise<T>):Promise<T>{await mkdir(dir,{recursive:true,mode:0o700});const lock=join(dir,'.lock');for(let attempt=0;;attempt++){try{await mkdir(lock);break;}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST'||attempt>=4)throw error;await new Promise(r=>setTimeout(r,50));}}try{return await fn();}finally{await rm(lock,{recursive:true,force:true});}}
/** Dedicated private spool, separate from the financial database. One sender; stale locks require operator review. */
export async function enqueueAlert(dir:string,alert:Alert,now=Date.now()):Promise<'queued'|'aggregated'>{
 return exclusive(dir,async()=>{
  const safe:Alert={environment:cleanText(alert.environment,30),service:cleanText(alert.service,60),event:cleanText(alert.event,100),severity:alert.severity,summary:cleanText(alert.summary,1000),...(alert.releaseCommit?{releaseCommit:cleanText(alert.releaseCommit,80)}:{}),...(alert.requestId?{requestId:cleanText(alert.requestId,128)}:{})};
  const id=createHash('sha256').update(JSON.stringify([safe.environment,safe.service,safe.event,safe.severity,safe.summary])).digest('hex');const file=join(dir,id+'.json');let prior:Stored|undefined;
  try{prior=JSON.parse(await readFile(file,'utf8')) as Stored;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  if(!prior&&(await readdir(dir)).filter(n=>n.endsWith('.json')).length>=1000)throw Error('Alert spool capacity reached');
  const repeat=!!prior&&(prior.state!=='sent'||now-prior.lastAt<300000);
  const record:Stored=repeat&&prior?{...prior,count:prior.count+1,lastAt:now,alert:safe,state:prior.state==='sent'||prior.state==='dead'&&now-(prior.deadAt??prior.lastAt)>=3600000?'pending':prior.state,attempts:prior.state==='dead'&&now-(prior.deadAt??prior.lastAt)>=3600000?0:prior.attempts,dueAt:prior.state==='sent'?(prior.sentAt??now)+300000:prior.dueAt}:{alert:safe,count:1,attempts:0,firstAt:now,lastAt:now,dueAt:now,state:'pending'};
  await save(file,record);return repeat?'aggregated':'queued';
 });
}
export async function drainAlerts(dir:string,config:LarkConfig,options:{fetcher?:typeof fetch;now?:number}={}):Promise<{sent:number;retry:number;dead:number}>{
 validate(config);const now=options.now??Date.now(),fetcher=options.fetcher??fetch;
 return exclusive(dir,async()=>{
  const result={sent:0,retry:0,dead:0};let processed=0;
  for(const name of (await readdir(dir)).filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).sort()){
   const file=join(dir,name),row=JSON.parse(await readFile(file,'utf8')) as Stored;
   if(row.state==='sent'&&now-row.lastAt>86400000){await rm(file);continue;}
   if(row.state!=='pending'||row.dueAt>now||processed>=5)continue;processed++;row.attempts++;
   try{
    const response=await fetcher(config.webhookUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(larkPayload(row.alert,row.count,config.signingSecret,now)),signal:AbortSignal.timeout(5000),redirect:'error'});
    if(!response.ok)throw Error('Lark delivery rejected');
    const body=await response.json() as {code?:number;StatusCode?:number};if((body.code??body.StatusCode)!==0)throw Error('Lark delivery rejected');
    row.state='sent';row.sentAt=now;result.sent++;
   }catch{row.state=row.attempts>=6?'dead':'pending';if(row.state==='dead')row.deadAt=now;row.dueAt=now+Math.min(300000,5000*2**row.attempts);result[row.state==='dead'?'dead':'retry']++;}
   await save(file,row);
  }
  return result;
 });
}
