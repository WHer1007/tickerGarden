// Two independently instantiated HTTP APIs and connection pools sharing local PostgreSQL.
import {readFileSync,writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
const dir=new URL(process.env.TG_CAPACITY_EVIDENCE_DIR??'../../docs/reviews/evidence/capacity-phase2-2026-09-14/',import.meta.url);
const a=JSON.parse(readFileSync(new URL('current-api.json',dir))),b=JSON.parse(readFileSync(new URL('second-api.json',dir)));
assert.equal(a.origin,'http://127.0.0.1:18772');assert.equal(b.origin,'http://127.0.0.1:18773');assert.equal(a.schemaName,b.schemaName);
const paths=['/v1/stats/holders','/v1/protocol-statistics','/v1/markets?limit=50&sort=name_asc',`/v1/market-statistics?markets=${a.marketId}`];
const duration=Number(process.env.TG_LOCAL_SOAK_MS??120000);assert.ok(duration>=1000&&duration<=86400000);
const start=performance.now(),samples=[],statuses={},errors=[];let sequence=0;
await Promise.all(Array.from({length:8},async()=>{while(performance.now()-start<duration){const n=sequence++,t=performance.now();try{const res=await fetch([a.origin,b.origin][n%2]+paths[Math.floor(n/2)%paths.length],{signal:AbortSignal.timeout(15000)});const text=await res.text();statuses[res.status]=(statuses[res.status]??0)+1;if(!res.ok&&errors.length<20)errors.push({status:res.status,body:text});}catch(e){if(errors.length<20)errors.push({error:e.message});}samples.push(performance.now()-t);await new Promise(r=>setTimeout(r,20));}}));
samples.sort((a,b)=>a-b);const report={scope:'two HTTP API instances, separate pools, same local SQL data; read-only bounded soak',durationMs:performance.now()-start,requests:sequence,statuses,errors,p50Ms:samples[Math.floor(samples.length*.5)],p95Ms:samples[Math.floor(samples.length*.95)],p99Ms:samples[Math.floor(samples.length*.99)],pass:statuses[200]===sequence&&errors.length===0};
writeFileSync(new URL('multi-instance-soak.json',dir),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(!report.pass)process.exitCode=1;
