import test from 'node:test';import assert from 'node:assert/strict';
import {mappedFetch,serveFetch} from './transport.mjs';import {hasDueWork,startScheduler} from './scheduler.mjs';
test('private routing preserves signed URL identity, method, body and query',async()=>{
 let seen;const f=mappedFetch({'https://content.example.com':'http://172.18.0.1:8203'},async r=>{seen=r;return new Response('ok');});
 await f('https://content.example.com/v1/jobs/content?x=1',{method:'POST',headers:{'upstash-signature':'proof'},body:'payload'});
 assert.equal(seen.url,'http://172.18.0.1:8203/v1/jobs/content?x=1');assert.equal(seen.headers.get('host'),'content.example.com');assert.equal(seen.headers.get('x-forwarded-proto'),'https');assert.equal(seen.headers.get('upstash-signature'),'proof');assert.equal(await seen.text(),'payload');assert.equal(seen.redirect,'manual');
});
test('unmapped Vercel hosts and invalid private routes fail closed',async()=>{
 let calls=0;const f=mappedFetch({},async()=>{calls++;return new Response();});await assert.rejects(f('https://other.vercel.app/x'));assert.equal(calls,0);
 assert.throws(()=>mappedFetch({'https://good.example':'https://evil.example'}));
});
test('prefix routing sends BSC queue publication only to its isolated queue',async()=>{
 let seen;const f=mappedFetch({'https://queue.example/bsc':'http://172.18.0.4:8080','https://queue.example':'http://172.18.0.5:8080'},async r=>{seen=r.url;return new Response();});
 await f('https://queue.example/bsc/v2/publish/x');assert.equal(seen,'http://172.18.0.4:8080/v2/publish/x');
});
test('Web selectors reach the gateway while private RPC permits retain their direct route',async()=>{
 const seen=[];const shared={'https://api.example':'http://172.18.0.1:8201','https://read.example':'http://172.18.0.1:8201'};
 const web=mappedFetch({...shared,'https://api.example':'http://172.18.0.1:8300'},async r=>{seen.push(r.url);return new Response();});
 await web('https://api.example/v1/rpc-scope?addresses=0x123&chainId=56');
 await web('https://read.example/v1/internal/rpc-budget',{method:'POST',body:'permit'});
 assert.deepEqual(seen,['http://172.18.0.1:8300/v1/rpc-scope?addresses=0x123&chainId=56','http://172.18.0.1:8201/v1/internal/rpc-budget']);
});
test('HTTP adapter preserves callback URL and cancels upstream on disconnect',async(t)=>{
 let signal,seen;const server=serveFetch(async req=>{signal=req.signal;seen=req.url;return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('ready\n'));}}));},{host:'127.0.0.1',port:0});await new Promise(r=>server.once('listening',r));
 t.after(()=>{server.closeAllConnections();server.close();});
 const controller=new AbortController();const response=await fetch(`http://127.0.0.1:${server.address().port}/jobs?x=1`,{headers:{'x-forwarded-host':'content.example','x-forwarded-proto':'https'},signal:controller.signal});await response.body.getReader().read();controller.abort();await new Promise(r=>setTimeout(r,30));assert.equal(seen,'https://content.example/jobs?x=1');assert.equal(signal.aborted,true);
});
test('idle scheduler only reads durable queue state and makes no network calls',async()=>{
 let queries=0,deliveries=0;const pool={query:async(sql,args)=>{queries++;assert.match(sql,/generation=\$2/);assert.deepEqual(args,['content','1']);return{rows:[{due:false}]};}};
 const stop=startScheduler({pool,env:{TG_DATABASE_SCHEMA:'tickergarden',TG_CONTENT_GENERATION:'1'},kind:'content',app:{fetch(){throw Error('unexpected HTTP');}},jobs:{createQStashClient:()=>({}),repairQueue(){deliveries++;},dispatchDueOutbox(){deliveries++;}},intervalMs:5});
 await new Promise(r=>setTimeout(r,23));await stop();assert.ok(queries>0);assert.equal(deliveries,0);await assert.rejects(hasDueWork(pool,'x;drop','content',1n));
});
