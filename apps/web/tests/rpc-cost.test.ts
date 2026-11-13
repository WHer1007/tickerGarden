import assert from 'node:assert/strict';
import test from 'node:test';
import {proxyReadRpc} from '../api/rpc.ts';
import {createRpcReadCoalescer,createPageReadTransport} from '../src/v1/rpcReads.ts';
import {createPublicClient,custom,erc20Abi} from 'viem';
import {recoveryDelay,watchPendingRecovery,watchSubmissionDeadline} from '../src/v1/pendingRecovery.ts';
const origin='https://web.example';
const env={TG_WEB_RPC_URL:'https://rh.quiknode.pro/key',TG_BSC_WEB_RPC_URL:'https://bsc.quiknode.pro/key',TG_RPC_CONTROL_ENABLED:'true',TG_RPC_BUDGET_URL:'https://rh.example',TG_RPC_BUDGET_TOKEN:'r'.repeat(40),TG_BSC_RPC_BUDGET_URL:'https://bsc.example',TG_BSC_RPC_BUDGET_TOKEN:'b'.repeat(40),TG_BSC_RPC_BUDGET_ACCESS_TOKEN:'a'.repeat(40),VITE_BSC_READ_API_URL:'https://gateway.example'};
function request(chain='bsc'){return new Request(`${origin}/api/rpc${chain?'?chain='+chain:''}`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:7,method:'eth_chainId'})});}

test('BSC budget denial blocks RPC; RH credentials never enter BSC permits',async()=>{
 let permits=0;
 const fetcher:typeof fetch=async(url,init)=>{
  assert.equal(String(url),'https://bsc.example/v1/internal/rpc-budget');permits++;
  assert.equal(new Headers(init?.headers).get('authorization'),'Bearer '+env.TG_BSC_RPC_BUDGET_TOKEN);
  assert.equal(new Headers(init?.headers).get('x-tg-candidate-token'),env.TG_BSC_RPC_BUDGET_ACCESS_TOKEN);
  return Response.json({}, {status:429});
 };
 assert.equal((await proxyReadRpc(request(),env,fetcher)).status,502);assert.equal(permits,1);
 const missing={...env,TG_BSC_RPC_BUDGET_TOKEN:undefined};
 assert.equal((await proxyReadRpc(request(),missing,async()=>assert.fail('No RH credential fallback'))).status,502);
});

test('BSC permit acquire/release is isolated and secrets never reach RPC or browser',async()=>{
 const calls:string[]=[];
 const fetcher:typeof fetch=async(url,init)=>{
  const target=String(url),body=JSON.parse(String(init?.body));calls.push(target.includes('rpc-budget')?body.action:'rpc');
  if(target.includes('rpc-budget')){assert.equal(target,'https://bsc.example/v1/internal/rpc-budget');return Response.json({id:'12345678-1234-1234-1234-123456789abc'});}
  assert.equal(target,env.TG_BSC_WEB_RPC_URL);assert.equal(new Headers(init?.headers).get('authorization'),null);assert.equal(new Headers(init?.headers).get('x-tg-candidate-token'),null);
  return Response.json({jsonrpc:'2.0',id:1,result:'0x38'});
 };
 const response=await proxyReadRpc(request(),env,fetcher);
 assert.deepEqual(await response.json(),{jsonrpc:'2.0',id:7,result:'0x38'});assert.deepEqual(calls,['acquire','rpc','release']);
});

test('read coordinator combines 20 concurrent page reads, but later/changed reads stay fresh',async()=>{
 let count=0,finish!:(v:unknown)=>void;
 const shared=createRpcReadCoalescer(async()=>{count++;return new Promise(resolve=>finish=resolve);});
 const read={method:'eth_getBalance',params:['0xabc','latest']};
 const all=Array.from({length:20},()=>shared.request(read));await Promise.resolve();assert.equal(count,1);
 finish('0x1');assert.deepEqual(await Promise.all(all),Array(20).fill('0x1'));
 const later=shared.request(read);await Promise.resolve();assert.equal(count,2);finish('0x2');assert.equal(await later,'0x2');
 const old=shared.request(read);await Promise.resolve();const oldFinish=finish;shared.clear();const next=shared.request(read);await Promise.resolve();assert.equal(count,4);
 oldFinish('0x3');finish('0x4');await Promise.all([old,next]);
});

test('no completed null/error receipts, sender simulations, gas, nonce or custom cancellation are cached',async()=>{
 let count=0;const shared=createRpcReadCoalescer(async()=>{count++;return null;});
 const receipt={method:'eth_getTransactionReceipt',params:['hash']};
 await Promise.all([shared.request(receipt),shared.request(receipt)]);assert.equal(count,1);
 await shared.request(receipt);assert.equal(count,2);
 for(const method of ['eth_getTransactionCount','eth_estimateGas','eth_sendTransaction'])await Promise.all([shared.request({method}),shared.request({method})]);
 await Promise.all([shared.request({method:'eth_call',params:[{to:'x',from:'y'}]}),shared.request({method:'eth_call',params:[{to:'x',from:'y'}]})]);
 await Promise.all([shared.request(receipt,{}),shared.request(receipt,{})]);assert.equal(count,12);
 const broken=createRpcReadCoalescer(async()=>{throw Error('offline');});
 await assert.rejects(broken.request(receipt));await assert.rejects(broken.request(receipt));
});

test('actual viem public client uses the coordinator for overlapping contract reads',async()=>{
 let calls=0;const transport=createPageReadTransport(custom({request:async()=>{calls++;await new Promise(r=>setTimeout(r,5));return '0x'+ '0'.repeat(63)+'7';}}));
 const client=createPublicClient({transport:transport.transport});
 const query={address:'0x0000000000000000000000000000000000000001',abi:erc20Abi,functionName:'balanceOf',args:['0x0000000000000000000000000000000000000002']} as const;
 assert.deepEqual(await Promise.all([client.readContract(query),client.readContract(query)]),[7n,7n]);assert.equal(calls,1);
 await client.readContract(query);assert.equal(calls,2);
});

test('saved transaction backoff remains bounded and stop prevents rescheduling',async t=>{
 assert.deepEqual([0,1,2,3,4,5].map(i=>recoveryDelay(5000,i)),[5000,10000,20000,40000,60000,60000]);
 t.mock.timers.enable({apis:['setTimeout','Date'],now:0});let count=0;
 const stop=watchPendingRecovery(async()=>{count++;},5000);await Promise.resolve();assert.equal(count,1);
 t.mock.timers.tick(5000);await Promise.resolve();assert.equal(count,2);
 t.mock.timers.tick(9999);await Promise.resolve();assert.equal(count,2);
 t.mock.timers.tick(1);await Promise.resolve();assert.equal(count,3);
 stop();t.mock.timers.tick(60000);await Promise.resolve();assert.equal(count,3);
});

test('raw recovery and viem receipt observation share one request and never cache a missing receipt',async()=>{
 let calls=0;const transport=createPageReadTransport(custom({request:async()=>{calls++;await new Promise(r=>setTimeout(r,5));return null;}}));
 const client=createPublicClient({transport:transport.transport}),hash=`0x${'1'.repeat(64)}` as const;
 const result=await Promise.allSettled([client.request({method:'eth_getTransactionReceipt',params:[hash]}),client.getTransactionReceipt({hash})]);
 assert.equal(calls,1);assert.equal(result[0]!.status,'fulfilled');assert.equal(result[1]!.status,'rejected');
 await assert.rejects(client.getTransactionReceipt({hash}));assert.equal(calls,2);
});

test('known pending submission is not retired between backed-off recovery checks',t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:30000});let expired=0;
 const stop=watchSubmissionDeadline(0,{current:()=>true,busy:()=>false,observation:()=>({state:'pending',checkedAt:10000}),expire:()=>expired++});
 t.mock.timers.tick(1);assert.equal(expired,0);t.mock.timers.tick(5000);assert.equal(expired,0);stop();
});

test('five minutes of unresolved saved-trade recovery needs eight probes rather than 61',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:0});let probes=0;
 const stop=watchPendingRecovery(async()=>{probes++;},5000);await Promise.resolve();
 for(let second=5;second<=300;second+=5){t.mock.timers.tick(5000);await Promise.resolve();}
 assert.equal(probes,8);stop();
});
