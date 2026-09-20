import test from 'node:test';
import assert from 'node:assert/strict';
import {budgetedRpcFetch} from '../server/rpc-budget.ts';

const endpoint='https://rpc.example/secret-path';
const budgetEnv={TG_RPC_CONTROL_ENABLED:'true',TG_RPC_BUDGET_URL:'https://control.example/private',TG_RPC_BUDGET_TOKEN:'x'.repeat(40)};
const permit={id:'12345678-1234-1234-1234-123456789abc'};

function mockFetch(run:(url:string,init?:RequestInit)=>Response|Promise<Response>){
 const calls:Array<{url:string;init?:RequestInit}>=[];
 const fetcher=(async(input:RequestInfo|URL,init?:RequestInit)=>{const url=String(input);calls.push({url,init});return run(url,init);}) as typeof fetch;
 return {fetcher,calls};
}
function controlResponse(body:unknown,status=200){return Response.json(body,{status});}

test('disabled budget calls only RPC directly and preserves the response',async()=>{
 const {fetcher,calls}=mockFetch(url=>{assert.equal(url,endpoint);return new Response('rpc-body',{status:207,headers:{'x-rpc':'yes'}});});
 const response=await budgetedRpcFetch(fetcher,{...budgetEnv,TG_RPC_CONTROL_ENABLED:'false'},endpoint,{method:'POST',body:'{}'});
 assert.equal(await response.text(),'rpc-body');assert.equal(response.status,207);assert.equal(response.headers.get('x-rpc'),'yes');
 assert.equal(calls.length,1);assert.equal(calls[0]?.url,endpoint);
});

test('enabled budget acquires, calls RPC, then releases; credentials and permit stay off RPC request',async()=>{
 const {fetcher,calls}=mockFetch((url,init)=>{
  if(url==='https://control.example/v1/internal/rpc-budget')return controlResponse(permit);
  assert.equal(url,endpoint);return new Response('ok');
 });
 const response=await budgetedRpcFetch(fetcher,budgetEnv,endpoint,{method:'POST',body:'{}'},'realtime');
 assert.equal(await response.text(),'ok');assert.equal(calls.length,3);
 const control=calls.filter(c=>c.url.includes('/v1/internal/rpc-budget'));
 assert.equal(control.length,2);assert.equal(control[0]?.init?.headers&&new Headers(control[0].init.headers).get('authorization'),`Bearer ${budgetEnv.TG_RPC_BUDGET_TOKEN}`);
 assert.deepEqual(JSON.parse(String(control[0]?.init?.body)),{action:'acquire',provider:'other',tier:'realtime'});
 assert.deepEqual(JSON.parse(String(control[1]?.init?.body)),{action:'release',id:permit.id});
 const rpc=calls.find(c=>c.url===endpoint)!;const serialized=JSON.stringify({url:rpc.url,headers:rpc.init?.headers,body:rpc.init?.body});
 assert.doesNotMatch(serialized,/Bearer|12345678|xxxxxxxx/);
});

test('denied budget makes no RPC request',async()=>{
 const {fetcher,calls}=mockFetch(url=>url.includes('/v1/internal/rpc-budget')?controlResponse({},429):assert.fail('RPC must not be called'));
 await assert.rejects(()=>budgetedRpcFetch(fetcher,budgetEnv,endpoint,{method:'POST',body:'{}'}),{name:'RpcBudgetBusy'});
 assert.equal(calls.length,1);
});

test('RPC failure still releases its acquired permit',async()=>{
 const {fetcher,calls}=mockFetch(url=>{
  if(url.includes('/v1/internal/rpc-budget'))return controlResponse(permit);
  throw new Error('network down');
 });
 await assert.rejects(()=>budgetedRpcFetch(fetcher,budgetEnv,endpoint,{method:'POST',body:'{}'}),/network down/);
 assert.equal(calls.length,3);assert.deepEqual(JSON.parse(String(calls[2]?.init?.body)),{action:'release',id:permit.id});
});

test('malformed permits fail closed before RPC',async()=>{
 const {fetcher,calls}=mockFetch(url=>url.includes('/v1/internal/rpc-budget')?controlResponse({id:'bad'}):assert.fail('RPC must not be called'));
 await assert.rejects(()=>budgetedRpcFetch(fetcher,budgetEnv,endpoint,{method:'POST',body:'{}'}),/Invalid RPC permit/);
 assert.equal(calls.length,1);
});

test('enabled budget requires HTTPS configuration and valid authentication',async()=>{
 for(const env of [
  {...budgetEnv,TG_RPC_BUDGET_URL:'http://control.example'},
  {...budgetEnv,TG_RPC_BUDGET_URL:'https://user:pass@control.example'},
  {...budgetEnv,TG_RPC_BUDGET_TOKEN:'short'},
 ]){
  const {fetcher,calls}=mockFetch(()=>assert.fail('invalid configuration must not fetch'));
  await assert.rejects(()=>budgetedRpcFetch(fetcher,env,endpoint,{method:'POST'}));assert.equal(calls.length,0);
 }
});
