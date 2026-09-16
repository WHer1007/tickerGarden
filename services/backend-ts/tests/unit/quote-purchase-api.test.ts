import test from 'node:test';
import assert from 'node:assert/strict';
import {createReadApiApp} from '../../apps/read-api/src/index.ts';
import type {RpcTransport} from '../../packages/chain/src/index.ts';
const token='0x5fc5360d0400a0fd4f2af552add042d716f1d168';
function fixture(){let calls=0;const app=createReadApiApp({env:{NODE_ENV:'test',TG_READ_DATABASE_URL:'postgres://unused',TG_CURSOR_SECRET:'x'.repeat(32)},deployment:{environment:'production',chainId:4663,deploymentDigest:'0x1234',activationBlock:1n},primary:{call:async()=>{calls++;throw Error('Private RPC error must not reach client');}} as unknown as RpcTransport});return {app,calls:()=>calls};}
test('purchase endpoint rejects malformed inputs without RPC and disables caching',async()=>{
 const f=fixture();for(const query of [`chainId=1&token=${token}&amountOut=1`,`chainId=4663&token=bad&amountOut=1`,`chainId=4663&token=${token}&amountOut=0`,`chainId=4663&token=${token}&amountOut=${2n**128n}`]){
 const r=await f.app.request('/v1/quote-purchase?'+query);assert.equal(r.status,400);assert.equal(r.headers.get('cache-control'),'no-store');}
 assert.equal(f.calls(),0);
});
test('purchase failures expose only public retry copy and paused stocks never reach RPC',async()=>{
 const f=fixture();for(const address of ['0x95052ddcd5dc25641657424a8cf04834997e1730','0x2f62fc9fabb470c690f141c28340ed832bb27020']){const r=await f.app.request(`/v1/quote-purchase?chainId=4663&token=${address}&amountOut=1`);assert.equal(r.status,503);}assert.equal(f.calls(),0);
 const r=await f.app.request(`/v1/quote-purchase?chainId=4663&token=${token}&amountOut=1`);assert.equal(r.status,503);assert.equal(r.headers.get('cache-control'),'no-store');assert.doesNotMatch(await r.text(),/Private RPC/);assert.ok(f.calls()>0);
});
