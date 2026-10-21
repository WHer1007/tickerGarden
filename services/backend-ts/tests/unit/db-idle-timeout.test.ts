import {test} from 'node:test';
import assert from 'node:assert/strict';
import {databaseIdleTimeout} from '../../packages/db/src/pool.ts';
test('serverless idle retention is reduced without changing resident pools',()=>{
 assert.equal(databaseIdleTimeout({VERCEL:'1'}),1000);
 assert.equal(databaseIdleTimeout({}),10000);
 assert.equal(databaseIdleTimeout({VERCEL:'1',TG_DB_IDLE_TIMEOUT_MS:'10000'}),10000);
 for(const value of ['0','-1','NaN','Infinity','100.5','60001',''])assert.throws(()=>databaseIdleTimeout({TG_DB_IDLE_TIMEOUT_MS:value}));
});
