import test from 'node:test';
import assert from 'node:assert/strict';
import type {Pool,PoolClient} from 'pg';
import {withPriceReadConnection} from '../../apps/read-api/src/price-read.ts';
import {createReadApiApp} from '../../apps/read-api/src/index.ts';
const transient=()=>new Error('Connection terminated due to connection timeout');
function setup(connect:(n:number)=>Promise<PoolClient>){let connects=0;return {pool:{connect:()=>connect(++connects),totalCount:0,idleCount:0,waitingCount:0} as unknown as Pool,count:()=>connects};}
const budget={budgetMs:200,connectMs:50,backoffMs:1};
test('price connection recovers once before SELECT and releases its client',async()=>{
 const releases:boolean[]=[];let queries=0;const {pool,count}=setup(async n=>{if(n===1)throw transient();return {release:(destroy:boolean)=>releases.push(destroy)} as unknown as PoolClient;});
 assert.equal(await withPriceReadConnection(pool,async()=>{queries++;return 42;},budget),42);assert.equal(count(),2);assert.equal(queries,1);assert.deepEqual(releases,[false]);
});
test('two failed acquisitions stop; auth, pool saturation and SQL errors are never retried',async()=>{
 const a=setup(async()=>{throw transient();});await assert.rejects(withPriceReadConnection(a.pool,async()=>assert.fail(),budget));assert.equal(a.count(),2);
 for(const error of [Object.assign(new Error('denied'),{code:'28P01'}),new Error('timeout exceeded when trying to connect'),Object.assign(new Error('too many clients'),{code:'53300'})]){const a=setup(async()=>{throw error;});await assert.rejects(withPriceReadConnection(a.pool,async()=>assert.fail(),budget),e=>e===error);assert.equal(a.count(),1);}
 const released:boolean[]=[];const b=setup(async()=>({release:(d:boolean)=>released.push(d)}) as unknown as PoolClient);let queries=0;
 await assert.rejects(withPriceReadConnection(b.pool,async()=>{queries++;throw transient();},budget));assert.equal(b.count(),1);assert.equal(queries,1);assert.deepEqual(released,[true]);
});
test('late acquisition is destroyed after deadline, without running SQL or retrying',async()=>{
 let finish!:(c:PoolClient)=>void;const released:boolean[]=[];const a=setup(()=>new Promise(resolve=>{finish=resolve;}));
 await assert.rejects(withPriceReadConnection(a.pool,async()=>assert.fail(),{budgetMs:30,connectMs:10,backoffMs:1}),/deadline/);
 finish({release:(d:boolean)=>released.push(d)} as unknown as PoolClient);await new Promise(r=>setImmediate(r));assert.equal(a.count(),1);assert.deepEqual(released,[true]);
});
test('total read deadline destroys client and does not replay slow SQL',async()=>{
 const released:boolean[]=[];let complete!:(v:number)=>void;const a=setup(async()=>({release:(d:boolean)=>released.push(d)}) as unknown as PoolClient);
 await assert.rejects(withPriceReadConnection(a.pool,()=>new Promise(r=>{complete=r;}),{budgetMs:20,connectMs:10,backoffMs:1}),/deadline/);assert.deepEqual(released,[true]);complete(1);assert.equal(a.count(),1);
});
test('public price views share pending SELECTs and fetch again after completion',async()=>{
 let unlock!:()=>void;let gate=new Promise<void>(r=>{unlock=r;});let queries=0;
 const a=setup(async()=>({query:async()=>{queries++;await gate;return {rows:[]};},release(){}}) as unknown as unknown as PoolClient);
 const app=createReadApiApp({pool:a.pool,env:{NODE_ENV:'test',TG_READ_DATABASE_URL:'postgres://unused',TG_CURSOR_SECRET:'x'.repeat(32)}});
 const pending=Array.from({length:12},(_,i)=>app.request(i%2?'/v1/statistics-prices':'/v1/prices/references'));
 await new Promise(r=>setImmediate(r));assert.equal(a.count(),1);assert.equal(queries,1);unlock();for(const response of await Promise.all(pending))assert.equal(response.status,200);
 gate=Promise.resolve();assert.equal((await app.request('/v1/prices/references')).status,200);assert.equal(a.count(),2);
});

test('real pg handshake timeouts make exactly two connections and execute no SQL',async()=>{
 const {createServer}=await import('node:net');const {Pool:PgPool}=await import('pg');const sockets=new Set<import('node:net').Socket>();let connections=0;
 const server=createServer(socket=>{connections++;sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('data',()=>{});});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address() as import('node:net').AddressInfo;
 const pool=new PgPool({host:'127.0.0.1',port:address.port,user:'fixture',password:'fixture',database:'fixture',max:1,connectionTimeoutMillis:40});
 try{await assert.rejects(withPriceReadConnection(pool,async()=>assert.fail('SELECT cannot run before handshake'),{budgetMs:500,connectMs:100,backoffMs:1}),/Connection terminated due to connection timeout/);assert.equal(connections,2);assert.equal(pool.totalCount,0);}
 finally{await pool.end();for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('insufficient remaining budget suppresses retry',async()=>{
 const a=setup(async()=>{throw transient();});await assert.rejects(withPriceReadConnection(a.pool,async()=>assert.fail(),{budgetMs:20,connectMs:30,backoffMs:1}));assert.equal(a.count(),1);
});
test('separate app instances never share price reads across deployments',async()=>{
 let unlock!:()=>void;const gate=new Promise<void>(r=>{unlock=r;});const a=setup(async()=>({query:async()=>{await gate;return {rows:[]};},release(){}}) as unknown as PoolClient);
 const env={NODE_ENV:'test',TG_READ_DATABASE_URL:'postgres://unused',TG_CURSOR_SECRET:'x'.repeat(32)};
 const one=createReadApiApp({pool:a.pool,env}),two=createReadApiApp({pool:a.pool,env});const pending=[one.request('/v1/prices/references'),two.request('/v1/prices/references')];await new Promise(r=>setImmediate(r));assert.equal(a.count(),2);unlock();await Promise.all(pending);
});
