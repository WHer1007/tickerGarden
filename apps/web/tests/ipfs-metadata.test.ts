import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isIPFSFileURI,ipfsGatewayURL} from '../src/create/ipfs.ts';
import {publishLaunchDetails} from '../src/create/metadata.ts';
import {readDetailMetadata,rememberDetailMetadata} from '../src/v1/tokenMetadata.ts';
const uri='ipfs://Qm'+'a'.repeat(44);
test('IPFS only resolves bare CIDs using an explicit HTTPS gateway',()=>{
 assert.equal(isIPFSFileURI(uri),true);
 assert.equal(ipfsGatewayURL(uri,'https://gateway.example'),`https://gateway.example/ipfs/${uri.slice(7)}`);
 for(const invalid of [uri+'/../secret',uri+'?x=1','ipfs://pending-launch-preview','ipfs://evil.example'])assert.equal(isIPFSFileURI(invalid),false);
 assert.equal(ipfsGatewayURL(uri,'http://127.0.0.1:8797'),`http://127.0.0.1:8797/ipfs/${uri.slice(7)}`);
 for(const gateway of [undefined,'http://gateway.example','https://user:secret@gateway.example','https://gateway.example/path'])assert.equal(ipfsGatewayURL(uri,gateway),null);
});
test('publisher response primes detail content before an IPFS gateway has indexed it',async()=>{
 const cid='ipfs://Qm'+'e'.repeat(44);let requests=0;const prior=globalThis.fetch;
 try{
  globalThis.fetch=async()=>{requests++;throw new Error('gateway should not be called');};
  rememberDetailMetadata(cid,{description:'Published description',properties:{website:'https://token.example'}},'https://metadata.example','https://gateway.example');
  const detail=await readDetailMetadata(cid,'https://metadata.example',new AbortController().signal,'https://gateway.example');
  assert.equal(detail?.description,'Published description');assert.equal(detail?.website,'https://token.example/');assert.equal(requests,0);
 }finally{globalThis.fetch=prior;}
});
test('publisher returns canonical metadata and detail reader handles IPFS without any RPC',async()=>{
 const fetchBefore=globalThis.fetch;const metadata={name:'Token',image:uri,properties:{x:'https://x.com/token',website:'https://token.example'},description:'Test'};
 try{
 let publicationRequests=0;globalThis.fetch=async()=>{publicationRequests++;return publicationRequests===1
  ?new Response(JSON.stringify({uploadId:'11111111-1111-4111-8111-111111111111',accessToken:'a'.repeat(43),imageUpload:null}),{status:201})
  :publicationRequests===2?new Response(JSON.stringify({status:'uploaded'}),{status:202})
  :new Response(JSON.stringify({status:'ready',metadataURI:uri,metadata}));};
 const published=await publishLaunchDetails('https://metadata.example',{name:'Token',symbol:'TOK',description:'Test',x:'token',website:'https://token.example',creatorFeesToHolders:false,creatorTaxBps:0},{nonce:'a'.repeat(64),signature:'0x'+'b'.repeat(130)});
 assert.deepEqual(published,{metadataURI:uri,metadata});
 let requests=0;globalThis.fetch=async(input)=>{requests++;assert.match(String(input),/^https:\/\/gateway.example\/ipfs\//);return new Response(JSON.stringify(metadata));};
 assert.equal(await readDetailMetadata(uri,null,new AbortController().signal),null);assert.equal(requests,0);
 const detail=await readDetailMetadata(uri,null,new AbortController().signal,'https://gateway.example');
 assert.equal(detail?.image,ipfsGatewayURL(uri,'https://gateway.example'));assert.equal(detail?.x,'https://x.com/token');assert.equal(requests,1);
 }finally{globalThis.fetch=fetchBefore;}
});

test('immutable metadata reuses successful reads; aborted reads do not return cached data',async()=>{
 const prior=globalThis.fetch;let requests=0;const cid='ipfs://Qm'+'b'.repeat(44);
 try{
  globalThis.fetch=async()=>{requests++;return new Response(JSON.stringify({description:'Cached',properties:{}}));};
  const a=await readDetailMetadata(cid,null,new AbortController().signal,'https://cache.example');
  const b=await readDetailMetadata(cid,null,new AbortController().signal,'https://cache.example');
  assert.equal(requests,1);assert.deepEqual(a,b);
  const aborted=new AbortController();aborted.abort();assert.equal(await readDetailMetadata(cid,null,aborted.signal,'https://cache.example'),null);
 }finally{globalThis.fetch=prior;}
});

test('concurrent reads share one request while aborting only that consumer',async()=>{
 const original=globalThis.fetch;let requests=0;let release!:()=>void;
 const cid='ipfs://Qm'+'c'.repeat(44);
 try{
  globalThis.fetch=async()=>{requests++;await new Promise<void>(resolve=>{release=resolve;});return new Response(JSON.stringify({description:'Shared',properties:{}}));};
  const aborted=new AbortController();
  const first=readDetailMetadata(cid,null,aborted.signal,'https://shared.example');
  const second=readDetailMetadata(cid,null,new AbortController().signal,'https://shared.example');
  await new Promise(resolve=>setTimeout(resolve,0));
  aborted.abort();release();
  assert.equal(await first,null);
  assert.equal((await second)?.description,'Shared');
  assert.equal(requests,1);
 }finally{globalThis.fetch=original;}
});

test('hung shared reads time out, retry, and ignore a late response',async(t)=>{
 t.mock.timers.enable();
 const original=globalThis.fetch;let requests=0;let release!:()=>void;
 const cid='ipfs://Qm'+'d'.repeat(44);
 try{
  globalThis.fetch=async()=>{requests++;if(requests===1)return new Promise<Response>(resolve=>{release=()=>resolve(new Response(JSON.stringify({description:'Late',properties:{}})));});return new Response(JSON.stringify({description:'Retry',properties:{}}));};
  const controller=new AbortController();
  const first=readDetailMetadata(cid,null,controller.signal,'https://timeout.example');
  controller.abort();
  t.mock.timers.tick(8000);
  assert.equal(await first,null);
  const retry=readDetailMetadata(cid,null,new AbortController().signal,'https://timeout.example');
  assert.equal((await retry)?.description,'Retry');
  release();
  await Promise.resolve();
  assert.equal((await readDetailMetadata(cid,null,new AbortController().signal,'https://timeout.example'))?.description,'Retry');
  assert.equal(requests,2);
 }finally{globalThis.fetch=original;t.mock.timers.reset();}
});
