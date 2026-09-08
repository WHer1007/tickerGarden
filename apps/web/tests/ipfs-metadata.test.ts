import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isIPFSFileURI,ipfsGatewayURL} from '../src/create/ipfs.ts';
import {publishLaunchDetails} from '../src/create/metadata.ts';
import {readDetailMetadata} from '../src/v1/tokenMetadata.ts';
const uri='ipfs://Qm'+'a'.repeat(44);
test('IPFS only resolves bare CIDs using an explicit HTTPS gateway',()=>{
 assert.equal(isIPFSFileURI(uri),true);
 assert.equal(ipfsGatewayURL(uri,'https://gateway.example'),`https://gateway.example/ipfs/${uri.slice(7)}`);
 for(const invalid of [uri+'/../secret',uri+'?x=1','ipfs://pending-launch-preview','ipfs://evil.example'])assert.equal(isIPFSFileURI(invalid),false);
 for(const gateway of [undefined,'http://gateway.example','https://user:secret@gateway.example','https://gateway.example/path'])assert.equal(ipfsGatewayURL(uri,gateway),null);
});
test('publisher returns canonical metadata and detail reader handles IPFS without any RPC',async()=>{
 const fetchBefore=globalThis.fetch;const metadata={name:'Token',image:uri,properties:{x:'https://x.com/token',website:'https://token.example'},description:'Test'};
 try{
 globalThis.fetch=async()=>new Response(JSON.stringify({metadataURI:uri,metadata}));
 const published=await publishLaunchDetails('https://metadata.example',{name:'Token',symbol:'TOK',description:'Test',x:'token',website:'https://token.example',creatorFeesToHolders:false,creatorTaxBps:0});
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
