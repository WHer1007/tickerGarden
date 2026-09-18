import test from 'node:test';
import assert from 'node:assert/strict';
import {rpcPolicy} from '../../packages/chain/src/rpc-policy.ts';
import {RpcTransport, consensusBlock, verifyChainIdentity} from '../../packages/chain/src/index.ts';
const env={TG_ENVIRONMENT:'production',TG_CHAIN_ID:'4663',TG_RPC_VERIFICATION_MODE:'single',TG_RPC_URL:'https://primary.example'};
test('single production mode selects only primary and rejects ambiguous secondary configuration',()=>{
 const p=rpcPolicy(env);assert.equal(p.verificationUrl,env.TG_RPC_URL);assert.equal(p.logsUrl,undefined);assert.equal(p.independentProviders,1);
 for(const change of [{TG_SECONDARY_RPC_URL:'https://other.example'},{TG_LOGS_SECONDARY_RPC_URL:'https://other.example'},{TG_ENVIRONMENT:'test'},{TG_CHAIN_ID:'46630'},{TG_RPC_VERIFICATION_MODE:'typo'}])assert.throws(()=>rpcPolicy({...env,...change}));
 const dual=rpcPolicy({TG_RPC_URL:'https://one.example',TG_SECONDARY_RPC_URL:'https://two.example'});assert.equal(dual.mode,'dual');assert.equal(dual.verificationUrl,'https://two.example');
});
const blockResult=(number:unknown,hash='1')=>({number,hash:`0x${hash.repeat(64)}`,parentHash:`0x${'0'.repeat(64)}`,timestamp:'0x64'});
test('same-source concurrent block reads share one pending upstream call but later reads are fresh',async()=>{
 let calls=0;let release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;});
 const fetcher:typeof fetch=async(_input,init)=>{
  calls++;const req=JSON.parse(String(init?.body));
  await gate;
  return Response.json({jsonrpc:'2.0',id:req.id,result:blockResult(req.params[0],String(calls))});
 };
 const primary=new RpcTransport({url:env.TG_RPC_URL,fetch:fetcher});
 const equivalent=new RpcTransport({url:env.TG_RPC_URL,fetch:fetcher});
 const first=primary.block(7n);const concurrent=equivalent.block(7n);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls,1,'equivalent transports should share the in-flight request');
 release();
 const [a,b]=await Promise.all([first,concurrent]);
 assert.equal(a.hash,b.hash);
 const later=await primary.block(7n);
 assert.equal(calls,2,'a settled response must not be cached');
 assert.notEqual(later.hash,a.hash);
});
test('different RPC URLs remain independent and consensus detects disagreement',async()=>{
 const urls:string[]=[];
 const fetcher:typeof fetch=async(input,init)=>{
  urls.push(String(input));const req=JSON.parse(String(init?.body));
  return Response.json({jsonrpc:'2.0',id:req.id,result:blockResult(req.params[0],urls.length===1?'1':'2')});
 };
 const primary=new RpcTransport({url:'https://primary.example',fetch:fetcher});
 const secondary=new RpcTransport({url:'https://secondary.example',fetch:fetcher});
 await assert.rejects(consensusBlock(primary,secondary,9n),/disagree on block identity/);
 assert.deepEqual(urls,['https://primary.example/','https://secondary.example/']);
});
test('failed in-flight reads are shared while pending and evicted after rejection',async()=>{
 let calls=0;let release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;});
 const fetcher:typeof fetch=async(_input,init)=>{
  calls++;const req=JSON.parse(String(init?.body));
  if(calls===1){await gate;return Response.json({jsonrpc:'2.0',id:req.id,error:{code:-32000,message:'unavailable'}});}
  return Response.json({jsonrpc:'2.0',id:req.id,result:blockResult(req.params[0])});
 };
 const a=new RpcTransport({url:env.TG_RPC_URL,fetch:fetcher});
 const b=new RpcTransport({url:env.TG_RPC_URL,fetch:fetcher});
 const failedA=a.block(11n);const failedB=b.block(11n);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls,1,'concurrent callers should share the pending failure');
 release();
 await Promise.all([assert.rejects(failedA),assert.rejects(failedB)]);
 assert.equal(calls,1,'both callers should receive the same rejected upstream call');
 await a.block(11n);
 assert.equal(calls,2,'a rejected request must be removed so a later read retries');
});
