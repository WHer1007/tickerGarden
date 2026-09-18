import test from 'node:test';
import assert from 'node:assert/strict';
import {pipelineAlerts} from '../../apps/pipeline/src/index.ts';
import {f72PriceTargets} from '../../packages/display-price/src/index.ts';
const expected=new Set([...f72PriceTargets().map(p=>p.token),'0x0000000000000000000000000000000000000000']).size;
function fixture():Parameters<typeof pipelineAlerts>[1]{return {environment:'test' as const,chainId:46630,deploymentDigest:'0x1234',headBlockNumber:null,unresolvedSourceConflicts:0,ingestion:[],projections:[],prices:[{status:'available',count:expected,oldestAgeSeconds:300,nearestExpirySeconds:-10}]};}
const queue={oldestOutboxAgeSeconds:0,jobs:{},outbox:{}} as Parameters<typeof pipelineAlerts>[0];
test('idle connections and short price refresh overlap do not trigger pressure or expiry alarms',()=>{
 const alerts=pipelineAlerts(queue,fixture(),{total:4,idle:4,waiting:0,max:4},{});assert.deepEqual(alerts,[]);
});
test('missing prices, exhausted active pool and waiting clients remain visible',()=>{
 const p=fixture();p.prices=[];const alerts=pipelineAlerts(queue,p,{total:4,idle:0,waiting:1,max:4},{});assert(alerts.some(a=>a.code==='price_coverage_incomplete'));assert(alerts.some(a=>a.code==='database_pool_pressure'));
 const stale=fixture();stale.prices[0]!.nearestExpirySeconds=-61;assert(pipelineAlerts(queue,stale,{total:0,idle:0,waiting:0,max:4},{}).some(a=>a.code==='price_expired'));
});
