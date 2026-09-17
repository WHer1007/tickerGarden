import test from 'node:test';
import assert from 'node:assert/strict';
import type {Pool} from 'pg';
import {createReadApiApp} from '../../apps/read-api/src/index.ts';
import {CURRENT_RELEASE_ID} from '../../packages/events/src/index.ts';
const hash=`0x${'a'.repeat(64)}`;
test('market page opens from its verified creation without health or financial publications',async()=>{
 const queries:string[]=[];
 const pool={query:async(sql:string)=>{queries.push(sql);if(sql.includes('.confirmed_display_markets'))return{rows:[]};if(sql.includes('.recent_markets'))return{rows:[{payload:{marketId:hash,identity:{name:'SEED',blockNumber:'100',blockHash:hash},confirmation:{status:'confirmed'}}}]};throw Error('Unexpected global dependency');}} as unknown as Pool;
 const app=createReadApiApp({pool,deployment:{environment:'test',chainId:46630,deploymentDigest:CURRENT_RELEASE_ID,activationBlock:1n},env:{NODE_ENV:'test',TG_READ_DATABASE_URL:'postgres://unused',TG_CURSOR_SECRET:'read-api-test-secret-that-is-at-least-32-bytes'}});
 const response=await app.request(`/v1/markets/${hash}/page`),page=await response.json();
 assert.equal(response.status,200);assert.equal(page.displayOnly,true);assert.equal(page.sync.finality,'head');assert.equal(page.market.marketId,hash);assert.ok(page.configs.length>0);assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal(queries.length,2);assert.ok(queries.every(q=>!q.includes("scope='positions'")&&!q.includes("scope='accounts'")));
});
