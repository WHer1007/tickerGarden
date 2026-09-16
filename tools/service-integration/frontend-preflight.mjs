// Local-only integration preflight. No RPC, signing, transactions or state writes.
import fs from 'node:fs/promises';
const base=new URL('../../',import.meta.url);
const output=process.argv[2];
const checks=[];
async function probe(name,url,accept){try{const r=await fetch(url,{signal:AbortSignal.timeout(5000)});const type=r.headers.get('content-type')??'';const body=type.includes('json')?await r.json():null;checks.push({name,url,httpStatus:r.status,pass:r.ok&&accept(body),...(body?{body}:{} )});}catch{checks.push({name,url,pass:false,error:'local service unavailable'});}}
await Promise.all([
 probe('frontend','http://127.0.0.1:5176/',()=>true),
 probe('metadata','http://127.0.0.1:8791/readyz',()=>true),
 probe('read-api-live','http://127.0.0.1:8792/livez',()=>true),
 probe('read-api-ready','http://127.0.0.1:8792/readyz',x=>x?.status==='ready'),
]);
const cfg=JSON.parse(await fs.readFile(new URL('outputs/reviews/frontend-integration-repair-2026-09-08/cache-config.json',base)));
checks.push({name:'rpc-budget-and-demand-only',pass:cfg.cuPerSecond===10000&&cfg.prefetch===false&&!!cfg.scopeFile});
const result={at:new Date().toISOString(),status:checks.every(c=>c.pass)?'LOCAL_SERVICES_READY':'NOT_READY',transactionSubmission:false,checks};
const text=JSON.stringify(result,null,2)+'\n';if(output)await fs.writeFile(output,text);console.log(text);if(result.status!=='LOCAL_SERVICES_READY')process.exitCode=1;
