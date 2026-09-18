import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHmac} from 'node:crypto';
import {enqueueAlert,drainAlerts,larkPayload,type Alert} from '../../packages/observability/src/lark.ts';
const alert:Alert={environment:'test',service:'worker',event:'job_failed',severity:'error',summary:'Failed at https://rpc.invalid/secret with signature=hidden'};
const config={webhookUrl:'https://open.larksuite.com/open-apis/bot/v2/hook/test-only',signingSecret:'test-only-not-a-real-secret'};
test('Lark signature and payload omit secret and raw provider URL',()=>{const body=larkPayload(alert,2,config.signingSecret,1000000);assert.equal(body.sign,createHmac('sha256',`1000\n${config.signingSecret}`).update('').digest('base64'));assert(!JSON.stringify(body).includes('rpc.invalid'));assert(!JSON.stringify(body).includes('signature=hidden'));assert(!JSON.stringify(body).includes(config.signingSecret));});
test('durable alert aggregation, retry and eventual delivery never post real messages',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tg-alert-'));let calls=0;
 try{
  assert.equal(await enqueueAlert(dir,alert,1000),'queued');assert.equal(await enqueueAlert(dir,alert,1001),'aggregated');
  const fail=(async()=>{calls++;return new Response('{}',{status:429});}) as typeof fetch;
  assert.deepEqual(await drainAlerts(dir,config,{now:1002,fetcher:fail}),{sent:0,retry:1,dead:0});
  assert.deepEqual(await drainAlerts(dir,config,{now:1003,fetcher:fail}),{sent:0,retry:0,dead:0});assert.equal(calls,1);
  const ok=(async(_url,init)=>{calls++;assert.equal(JSON.parse(String(init?.body)).content.text.includes('Occurrences: 2'),true);return new Response('{"code":0}');}) as typeof fetch;
  assert.deepEqual(await drainAlerts(dir,config,{now:20000,fetcher:ok}),{sent:1,retry:0,dead:0});
  assert.deepEqual(await drainAlerts(dir,config,{now:20001,fetcher:ok}),{sent:0,retry:0,dead:0});assert.equal(calls,2);
  await enqueueAlert(dir,alert,20002);assert.deepEqual(await drainAlerts(dir,config,{now:20003,fetcher:ok}),{sent:0,retry:0,dead:0});
  const files=(await readdir(dir)).filter(x=>x.endsWith('.json'));assert.equal(files.length,1);const saved=await readFile(join(dir,files[0]!),'utf8');assert(!saved.includes('rpc.invalid'));assert.equal(JSON.parse(saved).count,3);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('six rejected deliveries become dead; unexpected URLs fail before network',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tg-alert-'));let calls=0;
 try{await enqueueAlert(dir,alert,0);const reject=(async()=>{calls++;return new Response('{"code":19001}');}) as typeof fetch;
 for(let n=1;n<=6;n++){const result=await drainAlerts(dir,config,{now:n*400000,fetcher:reject});assert.equal(result.dead,n===6?1:0);}
 assert.equal(calls,6);await drainAlerts(dir,config,{now:9999999,fetcher:reject});assert.equal(calls,6);
 await assert.rejects(drainAlerts(dir,{...config,webhookUrl:'http://127.0.0.1/'},{fetcher:reject}),/Invalid Lark/);assert.equal(calls,6);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('new occurrence can reactivate a dead alert after cooldown without losing the incident',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tg-alert-'));
 try{await enqueueAlert(dir,alert,0);const fail=(async()=>new Response('{}',{status:503})) as typeof fetch;
 for(let n=1;n<=6;n++)await drainAlerts(dir,config,{now:n*400000,fetcher:fail});
 await enqueueAlert(dir,alert,7000000);
 const result=await drainAlerts(dir,config,{now:7000001,fetcher:(async()=>new Response('{"code":0}')) as typeof fetch});assert.equal(result.sent,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
