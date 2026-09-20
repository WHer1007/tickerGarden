import test from 'node:test';
import assert from 'node:assert/strict';
import {RpcTransport} from '../../packages/chain/src/index.ts';
import {rpcFailoverOptions,rpcPolicy} from '../../packages/chain/src/rpc-policy.ts';
const url='https://primary.example/secret',fallbackUrl='https://backup.example/secret';
function harness(primary:(method:string)=>Response,backup?:(method:string)=>Response){
 const calls:{url:string;method:string}[]=[];
 const fetcher:typeof fetch=async(input,init)=>{const b=JSON.parse(String(init?.body));calls.push({url:String(input),method:b.method});
 if(b.method==='eth_chainId')return Response.json({jsonrpc:'2.0',id:b.id,result:'0x1237'});
 const response=String(input)===url?primary(b.method):backup?.(b.method)??Response.json({result:'0x42'});
 if(!response.ok)return response;const v=await response.json();return Response.json({jsonrpc:'2.0',id:b.id,...v});};
 return {calls,rpc:new RpcTransport({url,fallbackUrl,expectedChainId:4663,fetch:fetcher})};
}
test('healthy primary never queries fallback; chain check shared across subsequent calls',async()=>{
 const {rpc,calls}=harness(()=>Response.json({result:'0x42'}));await rpc.call('eth_call',[]);await rpc.call('eth_call',[]);
 assert.equal(calls.length,3);assert.ok(calls.every(c=>c.url===url));assert.equal(calls.filter(c=>c.method==='eth_chainId').length,1);
});
test('provider outage retries standby once and preserves identical block params',async()=>{
 const {rpc,calls}=harness(()=>new Response('',{status:503}));assert.equal(await rpc.call('eth_call',[{to:'0x'},'0x99']),'0x42');
 assert.deepEqual(calls.map(c=>c.url),[url,url,fallbackUrl,fallbackUrl]);
});
test('contract reverts and invalid params do not use fallback',async()=>{
 for(const code of [3,-32602,-32000]){const {rpc,calls}=harness(()=>Response.json({error:{code,message:'private endpoint detail'}}));await assert.rejects(rpc.call('eth_call',[]),new RegExp(String(code)));assert.ok(calls.every(c=>c.url===url));}
});
test('both providers down give sanitized bounded failure',async()=>{
 const {rpc,calls}=harness(()=>new Response('',{status:429}),()=>new Response('',{status:503}));await assert.rejects(rpc.call('eth_call',[]),/RPC HTTP 503/);assert.equal(calls.length,4);
});
test('wrong chain fallback is rejected before business reads',async()=>{
 const calls:string[]=[];const fetcher:typeof fetch=async(input,init)=>{const b=JSON.parse(String(init?.body));calls.push(String(input)+':'+b.method);if(String(input)===url)return new Response('',{status:503});return Response.json({jsonrpc:'2.0',id:b.id,result:'0x1'});};
 await assert.rejects(new RpcTransport({url,fallbackUrl,expectedChainId:4663,fetch:fetcher}).call('eth_call',[]),/chain identity mismatch/);assert.ok(!calls.includes(fallbackUrl+':eth_call'));
});
test('unsupported log range skips primary instead of multiplying requests',async()=>{
 const calls:string[]=[];const fetcher:typeof fetch=async(input,init)=>{const b=JSON.parse(String(init?.body));calls.push(String(input));return Response.json({jsonrpc:'2.0',id:b.id,result:b.method==='eth_chainId'?'0x1237':[]});};
 const rpc=new RpcTransport({url,fallbackUrl,expectedChainId:4663,primaryLogMaxBlocks:5,fetch:fetcher});
 await rpc.call('eth_getLogs',[{fromBlock:'0x1',toBlock:'0x64'}]);assert.deepEqual(calls,[fallbackUrl,fallbackUrl]);
});
test('single-source mode allows availability fallback without enabling dual verification',()=>{
 const env={TG_RPC_VERIFICATION_MODE:'single',TG_ENVIRONMENT:'production',TG_CHAIN_ID:'4663',TG_RPC_URL:url,TG_RPC_FALLBACK_URL:fallbackUrl,TG_RPC_LOG_MAX_BLOCKS:'5'};
 assert.equal(rpcPolicy(env).independentProviders,1);assert.deepEqual(rpcFailoverOptions(env),{fallbackUrl,expectedChainId:4663,primaryLogMaxBlocks:5});
 assert.throws(()=>rpcFailoverOptions({...env,TG_RPC_LOG_MAX_BLOCKS:'NaN'}));
});

test('primary outage cooldown avoids retrying the failed endpoint on every request',async()=>{
 const {rpc,calls}=harness(()=>new Response('',{status:503}));await rpc.call('eth_call',[]);await rpc.call('eth_call',[]);
 assert.equal(calls.filter(c=>c.url===url&&c.method==='eth_call').length,1);
 assert.equal(calls.filter(c=>c.url===fallbackUrl&&c.method==='eth_call').length,2);
});
