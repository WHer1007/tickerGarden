// Re-test latest read implementation over the retained daily projector fixture.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {createServer} from 'node:http';
import {createDatabasePool} from '../../services/backend-ts/packages/db/src/index.ts';
import {createReadApiApp} from '../../services/backend-ts/apps/read-api/src/index.ts';
import {CURRENT_RELEASE_ID} from '../../services/backend-ts/packages/events/src/index.ts';
const dir=new URL(process.env.TG_CAPACITY_EVIDENCE_DIR??'../../docs/reviews/evidence/capacity-optimization-2026-09-14/',import.meta.url),base=JSON.parse(readFileSync(new URL('local-api.json',dir)));
const candidate=existsSync(new URL('current-api.json',dir))?JSON.parse(readFileSync(new URL('current-api.json',dir))):base;
const meta=candidate.schemaName===base.schemaName?candidate:base;
assert.match(meta.schemaName,/^tg_daily_scale_\d+$/);const s=`"${meta.schemaName}"`;
const db='postgres://tickergarden:tickergarden_dev@127.0.0.1:54329/tickergarden';
const {pool}=createDatabasePool(db),deployment={environment:'test',chainId:46630,deploymentDigest:CURRENT_RELEASE_ID,activationBlock:1n};
const app=createReadApiApp({pool,deployment,env:{NODE_ENV:'test',TG_READ_DATABASE_URL:db,TG_CURSOR_SECRET:'local-scale-cursor-secret-32-characters',TG_DATABASE_SCHEMA:meta.schemaName,TG_ALLOWED_ORIGINS:'http://127.0.0.1:18771'}});
const now=Number((await pool.query(`SELECT extract(epoch FROM source_timestamp)::bigint t FROM ${s}.chain_blocks WHERE number=$1`,[meta.revision.split(':')[0]])).rows[0].t);
const seriesTo=Math.floor(now/3600)*3600;
const report={scope:'latest production read API over 21500 normally projected markets and separately seeded 215000 trades / 43000 balances; 5 second SQL timeout',endpoints:[],counts:(await pool.query(`SELECT (SELECT count(DISTINCT identity) FROM ${s}.market_record_versions)::int markets,(SELECT count(*) FROM ${s}.holder_reward_markets)::int holderMarkets,(SELECT count(*) FROM ${s}.market_trades)::int trades`)).rows[0]};
assert.deepEqual(report.counts,{markets:21500,holdermarkets:21500,trades:215000});
if(!process.argv.includes('--serve-only')){
for(const path of ['/v1/markets?limit=50','/v1/markets?limit=50&sort=name_asc','/v1/markets?search=Local%20Market%2000099','/v1/updates','/v1/protocol-statistics','/v1/stats/holders',`/v1/stats/series?from=${seriesTo-86400}&to=${seriesTo}&interval=1h`,`/v1/market-statistics?markets=${Array.from({length:100},(_,i)=>'0x'+BigInt(i+1).toString(16).padStart(64,'0')).join(',')}`,`/v1/market-statistics?markets=${meta.marketId}`,`/v1/markets/${meta.marketId}/detail?period=1D`]){
 const times=[],statuses={},errors=[];let bytes=0;for(let i=0;i<3;i++){const t=performance.now(),r=await app.request(path),body=await r.text();bytes=Buffer.byteLength(body);times.push(performance.now()-t);statuses[r.status]=(statuses[r.status]??0)+1;if(!r.ok)errors.push(body)}times.sort((a,b)=>a-b);report.endpoints.push({path,p50Ms:times[1],maxMs:times[2],bytes,statuses,errors});
}
report.pass=report.endpoints.every(x=>Object.keys(x.statuses).every(code=>code==='200'));
writeFileSync(new URL('daily-read-retest.json',dir),JSON.stringify(report,null,2)+'\n');
if(!report.pass)console.error('Read endpoint failures remain');
}
const port=Number(process.env.TG_CAPACITY_API_PORT??18772);assert.ok([18772,18773].includes(port));
const server=createServer(async(req,res)=>{try{const response=await app.request('http://127.0.0.1:18772'+req.url,{method:req.method,headers:req.headers});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()))}catch{res.writeHead(500).end()}});
await new Promise(r=>server.listen(port,'127.0.0.1',r));writeFileSync(new URL(port===18772?'current-api.json':'second-api.json',dir),JSON.stringify({...meta,origin:`http://127.0.0.1:${port}`}));console.log('CURRENT_API_READY');
await new Promise(r=>{process.once('SIGTERM',r);process.once('SIGINT',r)});await new Promise(r=>server.close(r));await pool.end();
