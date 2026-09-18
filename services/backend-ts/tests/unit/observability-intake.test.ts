import test from 'node:test';
import assert from 'node:assert/strict';
import {deliverAlert} from '../../packages/observability/src/intake.ts';
const alert={environment:'test',service:'api',event:'failure',severity:'error' as const,summary:'synthetic'};
test('invalid intake configuration cannot throw or disclose a token',async()=>{
 let calls=0;const fetcher=(async()=>{calls++;return new Response(null,{status:202});}) as typeof fetch;
 for(const url of ['bad','http://127.0.0.1/alerts','https://user:pass@host/alerts','https://example.com/wrong'])assert.equal(await deliverAlert(url,'x'.repeat(32),alert,fetcher),false);
 assert.equal(calls,0);
});
test('intake transient failures retry; authentication failures do not',async()=>{
 let count=0;assert(await deliverAlert('https://alerts.example/alerts','x'.repeat(32),alert,(async(_url,init)=>{assert.equal(init?.redirect,'error');count++;return new Response(null,{status:count===1?503:202});}) as typeof fetch));assert.equal(count,2);
 count=0;assert.equal(await deliverAlert('https://alerts.example/alerts','x'.repeat(32),alert,(async()=>{count++;return new Response(null,{status:401});}) as typeof fetch),false);assert.equal(count,1);
});
