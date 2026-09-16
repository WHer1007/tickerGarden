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
test('same-provider consistency reads fail closed on changed blocks, wrong chain and provider errors',async()=>{
 let calls=0;let state='changed';
 const fetcher:typeof fetch=async(input,init)=>{
  assert.equal(String(input),env.TG_RPC_URL);calls++;
  const req=JSON.parse(String(init?.body));
  if(state==='failure')return Response.json({jsonrpc:'2.0',id:req.id,error:{code:-32000,message:'unavailable'}});
  const result=req.method==='eth_chainId'?'0xb626':{number:req.params[0],hash:'0x'+(calls%2?'1':'2').repeat(64),parentHash:'0x'+'0'.repeat(64),timestamp:'0x64'};
  return Response.json({jsonrpc:'2.0',id:req.id,result});
 };
 const primary=new RpcTransport({url:env.TG_RPC_URL,fetch:fetcher});
 const repeat=new RpcTransport({url:rpcPolicy(env).verificationUrl!,fetch:fetcher});
 await assert.rejects(consensusBlock(primary,repeat,1n));
 await assert.rejects(verifyChainIdentity(primary,4663n,'0x'+'0'.repeat(64)));
 state='failure';await assert.rejects(consensusBlock(primary,repeat,1n));
});
