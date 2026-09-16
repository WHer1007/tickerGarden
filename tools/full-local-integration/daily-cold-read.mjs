// Run while daily-capacity retains its own cold fixture. No ANALYZE or mutation.
import assert from 'node:assert/strict';import{writeFileSync}from'node:fs';import{performance}from'node:perf_hooks';
import{createDatabasePool}from'../../services/backend-ts/packages/db/src/index.ts';import{createReadApiApp}from'../../services/backend-ts/apps/read-api/src/index.ts';import{CURRENT_RELEASE_ID}from'../../services/backend-ts/packages/events/src/index.ts';
const schemaName=process.argv[2];assert.match(schemaName??'',/^tg_daily_scale_\d+$/);
const db='postgres://tickergarden:tickergarden_dev@127.0.0.1:54329/tickergarden',{pool}=createDatabasePool(db),deployment={environment:'test',chainId:46630,deploymentDigest:CURRENT_RELEASE_ID,activationBlock:1n};
const app=createReadApiApp({pool,deployment,env:{NODE_ENV:'test',TG_READ_DATABASE_URL:db,TG_DATABASE_SCHEMA:schemaName,TG_CURSOR_SECRET:'local-scale-cursor-secret-32-characters'}}),report={scope:'latest API against fresh daily fixture before manual statistics refresh; default 5s SQL timeout',checks:[]};
try{
 const now=Number((await pool.query(`SELECT extract(epoch FROM source_timestamp)::bigint t FROM "${schemaName}".chain_blocks WHERE number=4`)).rows[0].t);
 for(const path of ['/v1/stats/holders','/v1/protocol-statistics',`/v1/stats/series?from=${now-86400}&to=${now}&interval=1h`,'/v1/markets?limit=50&sort=createdAt_desc']){
  const times=[];for(let i=0;i<3;i++){const t=performance.now(),r=await app.request(path),body=await r.json();assert.equal(r.status,200,JSON.stringify(body));if(path==='/v1/stats/holders'){assert.equal(body.marketCount,21500);assert.equal(body.positiveMarketAddressPairs,43000);assert.equal(body.includedAddressCount,100);}times.push(performance.now()-t)}report.checks.push({path,pass:true,times});
 }
 report.pass=true;
}catch(e){report.pass=false;report.error=e.stack;process.exitCode=1}finally{writeFileSync(new URL('../../docs/reviews/evidence/capacity-optimization-2026-09-14/daily-cold-read.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report));await pool.end();}
