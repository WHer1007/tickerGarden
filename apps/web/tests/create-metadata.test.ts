import assert from 'node:assert/strict';
import { test } from 'node:test';
import { metadataOrigin,publishLaunchMetadata,publishLaunchDetails } from '../src/create/metadata.ts';
const authorization={nonce:'a'.repeat(64),signature:'0x'+'b'.repeat(130)} as const;
test('metadata service origin boundaries',()=>{
 assert.equal(metadataOrigin(undefined),null);
 assert.equal(metadataOrigin('https://metadata.example'),'https://metadata.example');
 assert.equal(metadataOrigin('http://localhost:8788'),'http://localhost:8788');
 for(const uri of ['http://metadata.example','https://metadata.example/path','https://user:pass@metadata.example'])assert.throws(()=>metadataOrigin(uri));
});
test('publication maps safe retryable and validation errors without exposing server text',async()=>{
 const original=globalThis.fetch;
 const details={name:'Garden',symbol:'GDN',description:'Hello',x:'garden',website:'https://garden.example',creatorFeesToHolders:true,creatorTaxBps:0};
 try {
  for (const [body,status,message] of [
   [{error:'content_busy'},503,'Storage unavailable'],
   [{error:'content_store_unavailable'},503,'Storage unavailable'],
   [{error:'content_quota_exhausted'},429,'limit reached'],
   [{error:'invalid_request',message:'secret internal detail'},400,'Check your token details'],
   [{message:'secret internal detail'},429,'limit reached'],
  ] as const) {
   globalThis.fetch=async()=>new Response(JSON.stringify(body),{status});
   await assert.rejects(publishLaunchMetadata('https://metadata.example',details,authorization),error=>error instanceof Error && error.message.includes(message) && !error.message.includes('secret'));
  }
  for (const body of ['null','[]']) {
   globalThis.fetch=async()=>new Response(body,{status:503});
   await assert.rejects(publishLaunchMetadata('https://metadata.example',details,authorization),/Storage unavailable/);
  }
 } finally { globalThis.fetch=original; }
});
test('publication reports timeout and network errors without retrying the POST',async()=>{
 const original=globalThis.fetch; let calls=0;
 const details={name:'Garden',symbol:'GDN',description:'Hello',x:'garden',website:'https://garden.example',creatorFeesToHolders:true,creatorTaxBps:0};
 try {
  globalThis.fetch=async()=>{ calls++; throw new DOMException('timed out','TimeoutError'); };
  await assert.rejects(publishLaunchMetadata('https://metadata.example',details,authorization),/timed out/);
  globalThis.fetch=async()=>{ calls++; throw new TypeError('network failed'); };
  await assert.rejects(publishLaunchMetadata('https://metadata.example',details,authorization),/Cannot connect to publishing service/);
  assert.equal(calls,2);
 } finally { globalThis.fetch=original; }
});
test('publication sends details and accepts only a ready IPFS result',async()=>{
 const original=globalThis.fetch;let sent='';
 try{
  let calls=0;const uri='ipfs://Qm'+'a'.repeat(44);const metadata={name:'Garden'};
  globalThis.fetch=async(_url,init)=>{calls++;if(calls===1){sent=String(init?.body);return new Response(JSON.stringify({uploadId:'11111111-1111-4111-8111-111111111111',accessToken:'a'.repeat(43),imageUpload:null}),{status:201});}
   if(calls===2)return new Response(JSON.stringify({status:'uploaded'}),{status:202});return new Response(JSON.stringify({status:'ready',metadataURI:uri,metadata}));};
  const details={name:'Garden',symbol:'GDN',description:'Hello',x:'garden',website:'https://garden.example',creatorFeesToHolders:true,creatorTaxBps:0};
  assert.equal(await publishLaunchMetadata('https://metadata.example',details,authorization),uri);
  assert.deepEqual(JSON.parse(sent),details);
  calls=0;globalThis.fetch=async()=>++calls===1
   ?new Response(JSON.stringify({uploadId:'11111111-1111-4111-8111-111111111111',accessToken:'a'.repeat(43),imageUpload:null}),{status:201})
   :calls===2?new Response(JSON.stringify({status:'uploaded'}),{status:202})
   :new Response(JSON.stringify({status:'ready',metadataURI:'https://unexpected.example/details.json',metadata}));
  await assert.rejects(publishLaunchMetadata('https://metadata.example',{...details,symbol:'GDN2'},authorization),/Invalid publishing response/);
 }finally{globalThis.fetch=original;}
});

test('resumes after transient status failure and reuses completed phases for the same owner',async()=>{
 const original=globalThis.fetch; const details={name:'Resume',symbol:'RSM',description:'Hello',x:'resume',website:'https://garden.example',creatorFeesToHolders:true,creatorTaxBps:0};
 const auth2={nonce:'c'.repeat(64),signature:'0x'+'d'.repeat(130)}; const uri='ipfs://Qm'+'b'.repeat(44); let calls:string[]=[]; let firstStatus=true;
 try { globalThis.fetch=async(url,init)=>{calls.push(`${init?.method??'GET'} ${url}`); if(calls.length===1)return new Response(JSON.stringify({uploadId:'22222222-2222-4222-8222-222222222222',accessToken:'z'.repeat(43),imageUpload:null}),{status:201}); if(calls.length===2)return new Response(JSON.stringify({status:'uploaded'}),{status:202}); if(firstStatus){firstStatus=false;throw new TypeError('temporary');} return new Response(JSON.stringify({status:'ready',metadataURI:uri,metadata:{name:'Resume'}}));};
  await assert.rejects(publishLaunchDetails('https://metadata.example',details,authorization,'4663:0xowner'),/Cannot connect|temporary/);
  assert.equal(await publishLaunchMetadata('https://metadata.example',details,auth2,'4663:0xowner'),uri); assert.deepEqual(calls.map(x=>x.split(' ')[0]),['POST','POST','GET','GET']);
 } finally {globalThis.fetch=original;}
});

test('owner separation and terminal status expiry discard resumable sessions',async()=>{
 const original=globalThis.fetch; const details={name:'Owner',symbol:'OWN',description:'Hello',x:'owner',website:'https://garden.example',creatorFeesToHolders:true,creatorTaxBps:0}; let calls=0; const auth2={nonce:'e'.repeat(64),signature:'0x'+'f'.repeat(130)};
 try { globalThis.fetch=async(url,init)=>{calls++; if(calls===1||calls===4)return new Response(JSON.stringify({uploadId:'33333333-3333-4333-8333-333333333333',accessToken:'q'.repeat(43),imageUpload:null}),{status:201}); if(calls===2||calls===5)return new Response(JSON.stringify({status:'uploaded'}),{status:202}); if(calls===3)return new Response('',{status:401}); return new Response(JSON.stringify({status:'ready',metadataURI:'ipfs://Qm'+'c'.repeat(44),metadata:{}}));};
  await assert.rejects(publishLaunchDetails('https://metadata.example',details,authorization,'owner-a'));
  assert.equal(await publishLaunchMetadata('https://metadata.example',details,auth2,'owner-a'),'ipfs://Qm'+'c'.repeat(44));
  assert.equal(calls,6); // terminal expiry causes a fresh POST
 } finally {globalThis.fetch=original;}
});
