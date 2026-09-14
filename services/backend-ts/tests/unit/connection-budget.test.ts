import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateConnectionBudget, validateDatabasePlacement } from '../../packages/db/src/connection-budget.ts';

test('evaluates normal and boundary budgets', () => {
  assert.deepEqual(evaluateConnectionBudget({ maxConnections: 100, reservedConnections: 10, services: [
    { name: 'api', instances: 2, poolMax: 20, extraConnections: 1 },
    { name: 'worker', instances: 1, poolMax: 5 },
  ]}), { used: 47, available: 90, headroom: 43 });
  assert.deepEqual(evaluateConnectionBudget({ maxConnections: 2, reservedConnections: 1, services: [{ name: 'x', instances: 1, poolMax: 1 }]}), { used: 1, available: 1, headroom: 0 });
});

test('rejects overflow, invalid counts, and duplicate names', () => {
  assert.throws(() => evaluateConnectionBudget({ maxConnections: 2, reservedConnections: 0, services: [{ name: 'x', instances: 3, poolMax: 1 }] }), /exceeded/);
  assert.throws(() => evaluateConnectionBudget({ maxConnections: Number.MAX_SAFE_INTEGER, reservedConnections: 0, services: [{ name: 'x', instances: Number.MAX_SAFE_INTEGER, poolMax: Number.MAX_SAFE_INTEGER }] }), /exceeded/);
  assert.throws(() => evaluateConnectionBudget({ maxConnections: 10, reservedConnections: 0, services: [{ name: 'x', instances: 1, poolMax: 1 }, { name: 'x', instances: 1, poolMax: 1 }] }), /duplicate/);
});

test('accepts only Singapore placement aliases and rejects unknown or missing regions', () => {
  assert.equal(validateDatabasePlacement({ applicationRegion: 'sin1', databaseRegion: 'ap-southeast-1', workerRegion: 'singapore' }), true);
  assert.throws(() => validateDatabasePlacement({ applicationRegion: 'iad1', databaseRegion: 'sin1', workerRegion: 'sin1' }), /unknown/);
  assert.throws(() => validateDatabasePlacement({ applicationRegion: 'sin1', databaseRegion: undefined as unknown as string, workerRegion: 'sin1' }), /explicit/);
});

import {createDatabasePool} from '../../packages/db/src/index.ts';
test('service pools respect per-service limits and fail before connecting when over budget',async()=>{
 const budget=JSON.stringify({maxConnections:20,reservedConnections:5,services:[{name:'read-api',instances:2,poolMax:2}]});
 assert.throws(()=>createDatabasePool('postgres://unused',{}, {role:'read-api',env:{TG_DB_BUDGET_JSON:budget}}),/exceeds/);
 assert.throws(()=>createDatabasePool('postgres://unused',{}, {role:'content',env:{TG_DB_BUDGET_JSON:budget}}),/exceeds/);
 const {pool}=createDatabasePool('postgres://unused',{}, {role:'read-api',env:{TG_DB_BUDGET_JSON:budget,TG_DB_POOL_MAX_READ_API:'2'}});
 assert.equal(pool.options.max,2);await pool.end();
 assert.throws(()=>createDatabasePool('postgres://unused',{}, {role:'read-api',env:{TG_DB_POOL_MAX_READ_API:'2junk'}}),/between/);
});

import {connectionRoleLimitsSql} from '../../packages/db/src/connection-budget.ts';
test('database role caps sum shared runtime roles and reject incomplete or unsafe maps',()=>{
 const budget={maxConnections:30,reservedConnections:5,services:[{name:'api',instances:2,poolMax:4},{name:'worker',instances:1,poolMax:4,extraConnections:1}]};
 assert.equal(connectionRoleLimitsSql(budget,{api:'tg_shared',worker:'tg_shared'}),'ALTER ROLE "tg_shared" CONNECTION LIMIT 13;');
 assert.throws(()=>connectionRoleLimitsSql(budget,{api:'tg_api'}),/missing/);
 assert.throws(()=>connectionRoleLimitsSql(budget,{api:'bad;sql',worker:'tg_worker'}),/invalid/);
});
