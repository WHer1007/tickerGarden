import assert from 'node:assert/strict';import test from 'node:test';
import {RpcTransport} from '../../packages/chain/src/index.ts';
import {rpcRuntimeOptions} from '../../packages/rpc-control/src/runtime.ts';
import {summarizeRpcUsage} from '../../packages/rpc-control/src/meter.ts';
test('runtime metering counts internal chain probes, failed attempts and standby once without secrets',async context=>{
 const records:Record<string,unknown>[]=[];let requests=0;
 context.mock.method(console,'info',(line:string)=>records.push(JSON.parse(line)));
 context.mock.method(globalThis,'fetch',async(url:unknown,init?:RequestInit)=>{
  requests++;const b=JSON.parse(String(init?.body));
  if(b.method!=='eth_chainId'&&String(url).includes('quiknode'))return new Response('busy',{status:503});
  return Response.json({jsonrpc:'2.0',id:b.id,result:b.method==='eth_chainId'?'0x1237':'0x1234'});
 });
 const rpc=new RpcTransport({...rpcRuntimeOptions({},'meter-test','interactive'),url:'https://main.quiknode.pro/SECRET-PRIMARY',fallbackUrl:'https://backup.alchemy.com/SECRET-BACKUP',expectedChainId:4663});
 assert.equal(await rpc.call('eth_call',[{to:'0x'+'a'.repeat(40),data:'0x1234'},'latest']),'0x1234');
 assert.equal(requests,4,'both identity probes and both business attempts are real requests');
 const rows=summarizeRpcUsage(records);assert.equal(rows.reduce((n,r)=>n+r.httpRequests,0),4);assert.equal(rows.reduce((n,r)=>n+r.retries,0),1);
 assert.ok(!JSON.stringify(records).includes('SECRET-'));assert.ok(!JSON.stringify(records).includes('0x'+'a'.repeat(40)));
});
