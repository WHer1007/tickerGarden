import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import test from 'node:test';
import {Hono} from 'hono';
import type {Notification,Pool,PoolClient} from 'pg';
import {changeChannel} from '../../packages/confirmed-display/src/changes.ts';
import {createMarketEvents} from '../../apps/read-api/src/market-events.ts';

const identity={environment:'test',chainId:46630,deploymentDigest:`0x${'a'.repeat(64)}`,activationBlock:1n} as const;
const marketA=`0x${'1'.repeat(64)}`,marketB=`0x${'2'.repeat(64)}`;
const wait=()=>new Promise(resolve=>setTimeout(resolve,0));
async function until(predicate:()=>boolean){for(let i=0;i<30&&!predicate();i++)await wait();assert.ok(predicate(),'condition did not become true');}
async function readEvent(reader:ReadableStreamDefaultReader<Uint8Array>,event:string){
 const decoder=new TextDecoder();
 for(let i=0;i<10;i++){
  const result=await reader.read();assert.equal(result.done,false);
  const text=decoder.decode(result.value);
  if(text.includes(`event: ${event}`))return text;
 }
 assert.fail(`event ${event} was not received`);
}

test('market event subscribers share LISTEN connection and release it after final disconnect',async()=>{
 class Client extends EventEmitter {
  queries:string[]=[];releases=0;
  async query(sql:string){this.queries.push(sql);return {rows:[]};}
  release(destroy?:boolean){this.releases++;void destroy;}
 }
 const client=new Client();let connects=0;
 const pool={connect:async()=>{connects++;return client;}} as unknown as Pool;
 const app=new Hono();
 const handle=createMarketEvents(()=>pool,identity);
 app.get('/events/:market',c=>handle(c,c.req.param('market')));
 const controllerA=new AbortController(),controllerB=new AbortController();
 let readerA:ReadableStreamDefaultReader<Uint8Array>|undefined,readerB:ReadableStreamDefaultReader<Uint8Array>|undefined;
 try{
  const [responseA,responseB]=await Promise.all([
   app.request(`/events/${marketA}`,{signal:controllerA.signal}),
   app.request(`/events/${marketB}`,{signal:controllerB.signal}),
  ]);
  assert.equal(responseA.status,200);assert.equal(responseB.status,200);
  readerA=responseA.body!.getReader();readerB=responseB.body!.getReader();
  await Promise.all([readEvent(readerA,'ready'),readEvent(readerB,'ready')]);
  assert.equal(connects,1);assert.deepEqual(client.queries,[`LISTEN ${changeChannel(identity)}`]);
  assert.equal(client.listenerCount('notification'),1);

  const channel=changeChannel(identity);
  client.emit('notification',{processId:1,channel,payload:JSON.stringify({marketId:marketA,regions:['chart']})} satisfies Notification);
  assert.match(await readEvent(readerA,'change'),new RegExp(marketA));
  const pendingB=readerB.read();
  const bRace=await Promise.race([pendingB.then(()=>true),wait().then(()=>false)]);
  assert.equal(bRace,false,'market A notification must not reach market B subscriber');

  client.emit('notification',{processId:1,channel,payload:JSON.stringify({marketId:marketB,regions:['trades']})} satisfies Notification);
  const marketBEvent=await pendingB;assert.equal(marketBEvent.done,false);assert.match(new TextDecoder().decode(marketBEvent.value),new RegExp(`event: change[\\s\\S]*${marketB}`));

  controllerA.abort();
  await readerA.cancel().catch(()=>{});
  await wait();
  assert.equal(client.releases,0,'one remaining subscriber must retain shared LISTEN client');
  controllerB.abort();
  await readerB.cancel().catch(()=>{});
  await until(()=>client.releases===1);
  assert.equal(client.listenerCount('notification'),0);
 }finally{
  controllerA.abort();controllerB.abort();
  await readerA?.cancel().catch(()=>{});await readerB?.cancel().catch(()=>{});
 }
});
