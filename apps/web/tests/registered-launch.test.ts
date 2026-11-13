import assert from 'node:assert/strict';
import test from 'node:test';
import {verifyRegisteredLaunch} from '../src/create/registered-launch.ts';
import {proxyReadRpc} from '../api/rpc.ts';
const curve='0x6785d81de48849c3b9084a57d09cb38af28f8806';
for(const chainId of [56,4663])test(`chain ${chainId}: confirmation waits for registration before reading a new Curve`,async()=>{
 let registered=false,release!:()=>void,reads=0;
 const env=chainId===56?{TG_BSC_WEB_RPC_URL:'https://rpc.example/',VITE_BSC_READ_API_URL:'https://read.example/'}:{TG_WEB_RPC_URL:'https://rpc.example/',VITE_V1_READ_API_URL:'https://read.example/',VITE_V1_CHAIN_ID:'4663'};
 const fetcher:typeof fetch=async(input,init)=>{
  if(String(input).startsWith('https://read.example/'))return Response.json({chainId,targets:registered?[{address:curve,topics:[]}]:[]});
  assert.equal(String(input),'https://rpc.example/');reads++;const call=JSON.parse(String(init?.body));return Response.json({jsonrpc:'2.0',id:call.id,result:'0x6000'});
 };
 const result=verifyRegisteredLaunch({verifyReceipt:()=>({curve}),register:()=>new Promise<boolean>(resolve=>{release=()=>{registered=true;resolve(true);};}),verifyDeployment:async created=>{
  const request=new Request('https://web.example/api/rpc'+(chainId===56?'?chain=bsc':''),{method:'POST',headers:{origin:'https://web.example','content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_getCode',params:[created.curve,'latest']})});
  assert.equal((await proxyReadRpc(request,env,fetcher)).status,200);
 }});
 await Promise.resolve();assert.equal(reads,0);release();assert.deepEqual(await result,{curve});assert.equal(reads,1);
});
test('invalid Factory or predicted identity cannot request registration or authorize new targets',async()=>{
 let calls=0;await assert.rejects(verifyRegisteredLaunch({verifyReceipt:()=>{throw Error('Factory mismatch');},register:async()=>{calls++;return true;},verifyDeployment:async()=>{calls++;}}),error=>(error as Error).cause instanceof Error&&((error as Error).cause as Error).message==='Factory mismatch');assert.equal(calls,0);
});
test('failed notification can use an independently published market; fresh verification cannot be skipped',async()=>{
 let verified=0;
 assert.equal(await verifyRegisteredLaunch({verifyReceipt:()=>curve,register:async()=>false,verifyDeployment:async()=>{verified++;}}),curve);assert.equal(verified,1);
 const cause=Error('wrong quote');await assert.rejects(verifyRegisteredLaunch({verifyReceipt:()=>curve,register:async()=>true,verifyDeployment:async()=>{throw cause;}}),error=>(error as Error).cause===cause);
});
