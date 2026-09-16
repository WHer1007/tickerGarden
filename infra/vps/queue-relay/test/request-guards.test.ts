import assert from 'node:assert/strict';
import test from 'node:test';
import { cachedProbe, limitedText } from '../src/request-guards.ts';
test('health probes coalesce concurrency, expire and cache failures briefly', async () => {
  let time=0,calls=0;
  const probe=cachedProbe(async()=>{calls++;if(calls===2)throw Error('db unavailable');return calls;},50,()=>time);
  assert.deepEqual(await Promise.all([probe(),probe(),probe()]),[1,1,1]);
  time=51;await assert.rejects(probe());await assert.rejects(probe());assert.equal(calls,2);
  time=102;assert.equal(await probe(),3);
});
test('body limit checks actual streamed bytes, including forged content length', async () => {
  assert.equal(await limitedText(new Request('http://localhost',{method:'POST',body:'abcd'}),4),'abcd');
  let cancelled=false;
  const body=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('abc'));c.enqueue(new TextEncoder().encode('def'));},cancel(){cancelled=true;}});
  const request=new Request('http://localhost',{method:'POST',headers:{'content-length':'1'},body,duplex:'half'} as RequestInit);
  assert.equal(await limitedText(request,4),null);assert.equal(cancelled,true);
  assert.equal(await limitedText(new Request('http://localhost',{method:'POST',body:'abc',headers:{'content-length':'100'}}),4),null);
});
