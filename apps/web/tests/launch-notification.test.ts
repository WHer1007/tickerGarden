import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {launchNotificationTarget,notifyLaunchDatabase} from '../src/v1/pendingMarket.ts';
import {EVM_GATEWAY_ORIGIN} from '../src/v1/evmTransport.ts';

const hash='0x'+'a'.repeat(64),marketId='0x'+'b'.repeat(64);
const env={VITE_V1_PIPELINE_URL:'https://pipeline.rh.example',VITE_BSC_PIPELINE_URL:EVM_GATEWAY_ORIGIN};
const confirmed=(chainId?:number)=>Response.json({status:'confirmed',marketId},{headers:chainId?{'x-chain-id':String(chainId)}:{}});

test('BSC completion and saved launch recovery notify only the selected gateway Pipeline',async()=>{
 const calls:{url:string;body:unknown}[]=[];
 const fetcher:typeof fetch=async(url,init)=>{calls.push({url:String(url),body:JSON.parse(String(init?.body))});return confirmed(56);};
 for(let i=0;i<2;i++)assert.equal(await notifyLaunchDatabase(hash,launchNotificationTarget(env,56),fetcher),true);
 assert.deepEqual(calls,[0,1].map(()=>({url:EVM_GATEWAY_ORIGIN+'/v1/launches?chainId=56',body:{transactionHash:hash}})));
 const source=readFileSync(new URL('../src/controllers/create.ts',import.meta.url),'utf8');
 assert.match(source,/notifyLaunchDatabase\(receipt.transactionHash,launchNotificationTarget\(import.meta.env,state.chainId\)\)/);
 assert.match(source,/notifyLaunchDatabase\(receipt.transactionHash,launchNotificationTarget\(import.meta.env,robinhoodChain.id\),fetch,'prepare'\)/);
 assert.doesNotMatch(source,/notifyLaunchDatabase\([^\n]*import.meta.env.VITE_V1_PIPELINE_URL/);
});

test('pre-confirmation notification is one bounded attempt; background recovery can still retry',async()=>{
 let calls=0;
 assert.equal(await notifyLaunchDatabase(hash,launchNotificationTarget(env,56),async(_url,init)=>{calls++;assert.ok(init?.signal);return Response.json({error:'unavailable'},{status:503});},'prepare'),false);
 assert.equal(calls,1);
 assert.equal(await notifyLaunchDatabase(hash,launchNotificationTarget(env,56),async()=>confirmed(56)),true);
});

test('RH mainnet and existing testnet notification URLs and payload remain unchanged',async()=>{
 for(const chainId of [4663,46630,421614]){
  const calls:string[]=[];
  assert.equal(await notifyLaunchDatabase(hash,launchNotificationTarget(env,chainId),async(url)=>{calls.push(String(url));return confirmed();}),true);
  assert.deepEqual(calls,['https://pipeline.rh.example/v1/launches']);
 }
});

test('missing BSC Pipeline never falls back to RH; invalid targets never make a request',async()=>{
 let calls=0;const fetcher:typeof fetch=async()=>{calls++;return confirmed(56);};
 assert.equal(launchNotificationTarget({VITE_V1_PIPELINE_URL:env.VITE_V1_PIPELINE_URL},56),undefined);
 for(const pipelineUrl of [env.VITE_V1_PIPELINE_URL,'http://gateway.example',EVM_GATEWAY_ORIGIN+'?chainId=4663',EVM_GATEWAY_ORIGIN+'?chainId=56&chainId=56',EVM_GATEWAY_ORIGIN+'?redirect=evil','https://user:pass@tickergarden-evm-api.vercel.app',EVM_GATEWAY_ORIGIN+'#chain']){
  assert.equal(await notifyLaunchDatabase(hash,{chainId:56,pipelineUrl},fetcher),false);
 }
 assert.equal(await notifyLaunchDatabase('invalid',{chainId:56,pipelineUrl:EVM_GATEWAY_ORIGIN},fetcher),false);
 assert.equal(await notifyLaunchDatabase(hash,{chainId:1,pipelineUrl:EVM_GATEWAY_ORIGIN},fetcher),false);
 assert.equal(await notifyLaunchDatabase(hash,undefined,fetcher),false);assert.equal(calls,0);
});

test('gateway selector survives URL construction; a conflicting response cannot confirm',async()=>{
 const target={chainId:56,pipelineUrl:EVM_GATEWAY_ORIGIN+'?chainId=56'};let url='';
 assert.equal(await notifyLaunchDatabase(hash,target,async(u)=>{url=String(u);return confirmed(56);}),true);
 assert.equal(url,EVM_GATEWAY_ORIGIN+'/v1/launches?chainId=56');
 for(const response of [confirmed(),confirmed(4663),Response.json({status:'confirmed',marketId,chainId:4663},{headers:{'x-chain-id':'56'}}),Response.json({status:'confirmed',marketId,transactionHash:'0x'+'c'.repeat(64)},{headers:{'x-chain-id':'56'}})]){
  assert.equal(await notifyLaunchDatabase(hash,target,async()=>response),false);
 }
});

test('same hash is deduplicated only within the same chain and destination, and retry after completion remains possible',async()=>{
 const release:((r:Response)=>void)[]=[];const calls:string[]=[];
 const fetcher:typeof fetch=async(url)=>{calls.push(String(url));return new Promise<Response>(resolve=>release.push(resolve));};
 const bsc=launchNotificationTarget(env,56),rh={chainId:4663,pipelineUrl:EVM_GATEWAY_ORIGIN};
 const a=notifyLaunchDatabase(hash,bsc,fetcher),duplicate=notifyLaunchDatabase(hash,bsc,fetcher),b=notifyLaunchDatabase(hash,rh,fetcher);
 assert.equal(a,duplicate);assert.notEqual(a,b);assert.equal(calls.length,2);
 release[0]!(confirmed(56));release[1]!(confirmed(4663));assert.deepEqual(await Promise.all([a,b]),[true,true]);
 assert.equal(await notifyLaunchDatabase(hash,bsc,async()=>confirmed(56)),true);
});

test('gateway validation errors stop immediately; a transient error retries the same BSC request',async t=>{
 const target=launchNotificationTarget(env,56);let calls=0;
 assert.equal(await notifyLaunchDatabase(hash,target,async()=>{calls++;return Response.json({error:'invalid_request'},{status:400});}),false);assert.equal(calls,1);
 t.mock.timers.enable({apis:['setTimeout']});calls=0;const urls:string[]=[];
 const work=notifyLaunchDatabase(hash,target,async(url)=>{urls.push(String(url));calls++;return calls===1?Response.json({error:'unavailable'},{status:503}):confirmed(56);});
 await new Promise(resolve=>setImmediate(resolve));t.mock.timers.tick(5000);
 assert.equal(await work,true);assert.equal(calls,2);assert.ok(urls.every(x=>x===EVM_GATEWAY_ORIGIN+'/v1/launches?chainId=56'));
});
