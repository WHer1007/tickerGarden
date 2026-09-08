import assert from 'node:assert/strict';
import { test } from 'node:test';
import { metadataOrigin,publishLaunchMetadata } from '../src/create/metadata.ts';
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
   [{code:'content_busy'},200,'busy'],
   [{code:'content_store_unavailable'},503,'temporarily unavailable'],
   [{code:'content_quota_exhausted'},200,'quota is exhausted'],
   [{code:'content_quota_exhausted'},429,'quota is exhausted'],
   [{code:'metadata_publication_failed'},503,'publication failed'],
   [{code:'invalid_request',message:'secret internal detail'},400,'details are invalid'],
   [{message:'secret internal detail'},429,'try again shortly'],
  ] as const) {
   globalThis.fetch=async()=>new Response(JSON.stringify(body),{status});
   await assert.rejects(publishLaunchMetadata('https://metadata.example',details),error=>error instanceof Error && error.message.includes(message) && !error.message.includes('secret'));
  }
  for (const body of ['null','[]']) {
   globalThis.fetch=async()=>new Response(body,{status:503});
   await assert.rejects(publishLaunchMetadata('https://metadata.example',details),/temporarily unavailable/);
  }
 } finally { globalThis.fetch=original; }
});
test('publication reports timeout and network errors without retrying the POST',async()=>{
 const original=globalThis.fetch; let calls=0;
 const details={name:'Garden',symbol:'GDN',description:'Hello',x:'garden',website:'https://garden.example',creatorFeesToHolders:true,creatorTaxBps:0};
 try {
  globalThis.fetch=async()=>{ calls++; throw new DOMException('timed out','TimeoutError'); };
  await assert.rejects(publishLaunchMetadata('https://metadata.example',details),/timed out/);
  globalThis.fetch=async()=>{ calls++; throw new TypeError('network failed'); };
  await assert.rejects(publishLaunchMetadata('https://metadata.example',details),/Could not reach metadata service/);
  assert.equal(calls,2);
 } finally { globalThis.fetch=original; }
});
test('publication sends details and rejects service redirects in the returned metadata URI',async()=>{
 const original=globalThis.fetch;let sent='';
 try{
  globalThis.fetch=async(_url,init)=>{sent=String(init?.body);return new Response(JSON.stringify({metadataURI:`https://metadata.example/launch-metadata/${'a'.repeat(64)}.json`}),{status:201});};
  const details={name:'Garden',symbol:'GDN',description:'Hello',x:'garden',website:'https://garden.example',creatorFeesToHolders:true,creatorTaxBps:0};
  assert.match(await publishLaunchMetadata('https://metadata.example',details),/\.json$/);
  assert.deepEqual(JSON.parse(sent),details);
  globalThis.fetch=async()=>new Response(JSON.stringify({metadataURI:'https://unexpected.example/details.json'}));
  await assert.rejects(publishLaunchMetadata('https://metadata.example',details),/unexpected/);
 }finally{globalThis.fetch=original;}
});
