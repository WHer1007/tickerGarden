import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('HTTP unknown error has root cause and request correlation without exposing secrets',()=>{
 const module=new URL('../../packages/http/src/index.ts',import.meta.url).href;
 const code=`import {createServiceApp} from ${JSON.stringify(module)};
 const app=createServiceApp({kind:'read-api',env:{NODE_ENV:'test'}});
 app.get('/failure',()=>{throw new TypeError('DB failed postgres://user:password@host/db signature=secret',{cause:new Error('upstream https://rpc.invalid/api-key')});});
 const response=await app.request('/failure',{headers:{'x-request-id':'diagnostic-test'}});
 if(response.status!==500)process.exit(2);
 const body=await response.json();if(body.message!=='Internal server error')process.exit(3);`;
 const result=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',code],{encoding:'utf8',env:{...process.env,TG_SENTRY_DSN:'',TG_LOG_LEVEL:'info'}});
 assert.equal(result.status,0,result.stderr);
 const records=result.stdout.trim().split('\n').map(l=>JSON.parse(l));
 const failure=records.find(r=>r.event==='http_unhandled_error');assert(failure);assert.equal(failure.requestId,'diagnostic-test');assert.equal(failure.error.type,'TypeError');assert.match(failure.error.stack,/TypeError/);assert.equal(failure.error.cause.type,'Error');
 assert(!result.stdout.includes('password@'));assert(!result.stdout.includes('signature=secret'));assert(!result.stdout.includes('rpc.invalid'));assert(records.some(r=>r.event==='http_request'&&r.status===500&&r.level===50));
});
test('async request contexts stay isolated and duplicate captures emit once',()=>{
 const module=new URL('../../packages/observability/src/index.ts',import.meta.url).href;
 const code=`import {withLogContext,reportError} from ${JSON.stringify(module)};
 await Promise.all(['one','two'].map(requestId=>withLogContext({requestId},async()=>{await new Promise(r=>setTimeout(r,requestId==='one'?10:1));const error=new Error('test failure '+requestId);reportError('test','failed',error);reportError('test','failed',error);})));
 `;
 const r=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',code],{encoding:'utf8',env:{...process.env,TG_SENTRY_DSN:'',TG_LOG_LEVEL:'info'}});assert.equal(r.status,0,r.stderr);
 const rows=r.stdout.trim().split('\n').map(l=>JSON.parse(l));assert.equal(rows.length,2);assert.deepEqual(rows.map(r=>r.requestId).sort(),['one','two']);
});
