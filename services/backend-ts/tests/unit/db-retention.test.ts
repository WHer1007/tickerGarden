import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {attachDatabasePool} from '@vercel/functions';
import {databaseIdleTimeout} from '../../packages/db/src/pool.ts';
test('actual Vercel hook reduces post-response retention while keeping cleanup attached',async t=>{
 const symbol=Symbol.for('@vercel/request-context');
 const global=globalThis as unknown as Record<symbol,unknown>;
 const previous=global[symbol],url=process.env.VERCEL_URL,region=process.env.VERCEL_REGION;
 t.after(()=>{if(previous===undefined)delete global[symbol];else global[symbol]=previous;for(const [key,value] of [['VERCEL_URL',url],['VERCEL_REGION',region]]){if(value===undefined)delete process.env[key!];else process.env[key!]=value;}});
 process.env.VERCEL_URL='test.invalid';process.env.VERCEL_REGION='sin1';
 const results:number[]=[];
 for(const idle of [10000,databaseIdleTimeout({VERCEL:'1'})]){
  let pending:Promise<unknown>|undefined;
  global[symbol]={get:()=>({waitUntil:(promise:Promise<unknown>)=>{pending=promise;}})};
  const pool=Object.assign(new EventEmitter(),{options:{idleTimeoutMillis:idle}});
  attachDatabasePool(pool);const start=performance.now();pool.emit('release');assert.ok(pending);await pending;
  const elapsed=performance.now()-start;assert.ok(elapsed>=idle,`cleanup retained for ${elapsed}ms`);results.push(elapsed);
 }
 assert.ok(results[1]!<results[0]!*0.25);t.diagnostic(JSON.stringify({baselineMs:results[0],candidateMs:results[1]}));
});
