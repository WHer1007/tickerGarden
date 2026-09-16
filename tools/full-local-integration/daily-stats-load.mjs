import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../services/backend-ts/package.json',import.meta.url)),{Pool}=require('pg');
const dir=new URL(process.env.TG_CAPACITY_EVIDENCE_DIR??'../../docs/reviews/evidence/capacity-optimization-2026-09-14/',import.meta.url),meta=JSON.parse(readFileSync(new URL('current-api.json',dir))),samples=JSON.parse(readFileSync(new URL('daily-read-retest.json',dir)));
assert.equal(meta.origin,'http://127.0.0.1:18772');
assert.match(meta.schemaName,/^tg_daily_scale_\d+$/);const pool=new Pool({connectionString:'postgres://tickergarden:tickergarden_dev@127.0.0.1:54329/tickergarden'});
const paths=['/v1/stats/holders','/v1/protocol-statistics',samples.endpoints.find(x=>x.path.startsWith('/v1/stats/series')).path];
const report={scope:'64 concurrent real HTTP global statistics requests, cold result cache before each run, bounded in-flight sharing, 21500 markets and 215000 trades',runs:[]};
for(const concurrency of [16,64]){await pool.query(`DELETE FROM \"${meta.schemaName}\".statistics_result_cache`);const t=performance.now(),times=[],status={},errors=[];let next=0;await Promise.all(Array.from({length:concurrency},async()=>{for(;;){const i=next++;if(i>=64)break;const start=performance.now();try{const r=await fetch(meta.origin+paths[i%3],{signal:AbortSignal.timeout(30000)}),text=await r.text();status[r.status]=(status[r.status]??0)+1;if(!r.ok)errors.push(text)}catch(e){errors.push(e.message)}times.push(performance.now()-start)}}));times.sort((a,b)=>a-b);report.runs.push({concurrency,requests:64,ms:performance.now()-t,p95Ms:times[60],status,errors});}
await pool.end();
report.pass=report.runs.every(x=>x.status[200]===64&&x.errors.length===0);writeFileSync(new URL('daily-stats-load.json',dir),JSON.stringify(report,null,2)+'\n');if(!report.pass)process.exitCode=1;console.log(JSON.stringify(report));
