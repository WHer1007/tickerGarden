import test from 'node:test';
import assert from 'node:assert/strict';
import type {Pool} from 'pg';
import {readTokenDetail} from '../../packages/analytics-store/src/index.ts';
const hash=`0x${'1'.repeat(64)}` as const;
test('creation receipt serves a requested open chart without querying settlement history',async()=>{
 const asOf=1800000041,queries:string[]=[];
 const client={release(){},async query(sql:string){queries.push(sql);if(sql.includes('.recent_markets'))return{rows:[{initial_detail:{version:1,confirmation:'confirmed',period:'1H',chart:null,statistics:null,holders:null,fees:[],trades:[{timestamp:asOf,price:'2'}],sources:{trades:{provider:'indexer',asOf,blockNumber:'1',blockHash:hash}},reasons:{}}}]};if(sql.includes('.confirmed_display_markets')||['BEGIN','COMMIT'].includes(sql)||sql.startsWith('SET '))return{rows:[]};throw Error('Unexpected settlement dependency');}};
 const pool={connect:async()=>client} as unknown as Pool;
 const detail=await readTokenDetail({pool,deployment:{chainId:46630,environment:'test',deploymentDigest:hash,activationBlock:1n},marketId:hash,period:'12H',section:'chart'});
 assert.equal(detail.chart?.interval,300);assert.ok(detail.chart!.to>asOf);assert.equal(detail.chart?.points.at(-1)?.price,'2');
 assert.equal(detail.trades,null);assert.equal(detail.holders,null);assert.deepEqual(Object.keys(detail.sources),['chart']);
 assert.ok(!queries.some(q=>q.includes('FROM "tickergarden_serverless".market_trades')));
});
