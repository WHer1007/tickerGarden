// Summarize verified local artifacts without rewriting raw failures or implying live-chain readiness.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
const dir=new URL('../../docs/reviews/evidence/capacity-optimization-2026-09-14/',import.meta.url);
const read=name=>JSON.parse(readFileSync(new URL(name,dir)));
const checks=[];
function check(name,pass,evidence){assert.equal(pass,true,name);checks.push({name,pass,evidence});}
const capacity=read('capacity.json');
check('normal 21500 market and Holder population, complete paging, phase counts and orphan rejection',capacity.checks.length===5&&capacity.checks.every(c=>c.pass),'capacity.json#checks');
const oldFailures=capacity.stages.flatMap(s=>s.endpoints.filter(e=>e.status[200]!==e.repeats));
assert.equal(oldFailures.length,1);assert.equal(oldFailures[0].path,'/v1/stats/holders');
for(const name of ['daily-incremental.json','daily-publish-retest.json','quiet-block.json','daily-cold-read.json','daily-read-retest.json','daily-stats-load.json'])check(name,read(name).pass,name);
check('mixed real HTTP 1/4/16/64 concurrency',read('http-load.json').runs.every(r=>r.status[200]===128&&Object.keys(r.errors).length===0),'http-load.json');
const browser=read('browser.json'),flows=read('browser-flows.json');
check('18 browser routes/sizes and scoped chart checks',browser.status==='passed'&&browser.routes.length===18&&browser.checks.length===6,'browser.json');
check('8 browser interactions',flows.status==='passed'&&flows.checks.length===8&&flows.checks.every(c=>c.pass),'browser-flows.json');
const relay=read('relay-load.json'),burst=read('relay-burst.json');
check('relay recovery including same-block gap and owned DB connection termination',relay.status==='passed'&&relay.checks.length===5&&relay.checks.every(c=>c.pass),'relay-load.json');
check('1000-event burst fully drains',burst.status==='passed'&&burst.finalCounts.queued===1000&&burst.finalCounts.dead===0,'relay-burst.json');
for(const [name,count]of [['backend-tests.log',79],['db-final.log',16],['web-tests.log',393],['relay-tests.log',6]]){
 const log=readFileSync(new URL(name,dir),'utf8');
 check(name,log.includes(`tests ${count}`)&&log.includes(`pass ${count}`)&&log.includes('fail 0')&&log.includes('skipped 0'),name);
}
const contracts=read('contract-source-comparison.json');check('contracts unchanged from prior local integration evidence',contracts.compared===70&&contracts.changed.length===0,'contract-source-comparison.json');
const result={createdAt:new Date().toISOString(),status:'LOCAL_SCOPED_ACCEPTANCE_PASSED',productionReadiness:'NOT_PRODUCTION_READY',scope:'Local TypeScript projectors/API/PostgreSQL/Relay/browser with synthetic ABI RPC and trade read-model fixtures; not real RH deployments, signed transactions, public RPC capacity or a soak test',checks,supersededFailures:[{file:'capacity.json',rawPass:capacity.pass,failedEndpoints:oldFailures.map(x=>({path:x.path,status:x.status})),replacement:['daily-cold-read.json','daily-read-retest.json','daily-stats-load.json'],reason:'old running module Holder SQL; targeted latest-module replacement on same fresh schema and retained population'}, {file:'daily-stats-load-before-admission.json',replacement:'daily-stats-load.json',reason:'global SQL concurrency timeout fixed with bounded admission; HTTP queue delay explicitly reported'}],remaining:['Global stats 64-concurrency P95 about 6.25 seconds including admission wait; no production SLA established','Market discovery and publication manifest still scale with full population','Real RPC quota, multi-instance concurrency, 50k/100k growth and 24/72h soak not validated','Principal/manual Holder account and replay caps are separate from market-count capacity','Local PostgreSQL PANIC root cause unresolved; application idle-connection recovery verified'],actions:{remoteMigration:false,commit:false,deployment:false,periodicHolderPublicationEnabled:false}};
writeFileSync(new URL('acceptance.json',dir),JSON.stringify(result,null,2)+'\n');console.log(result.status);
