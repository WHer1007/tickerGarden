import test from 'node:test';
import assert from 'node:assert/strict';
import {DUAL_MODE,due,fundingDecision,configuredInterval,restartDelay,DEFAULT_INTERVAL_SECONDS,streamCheckpointDue,supportedMode,requireCurrentOperation} from './policy.mjs';
const item={marketId:'0x'+'a'.repeat(64),token:'0x'+'b'.repeat(40),revision:'42'};
test('candidate validation and persisted timing bound checks',()=>{
 assert.equal(due(item,{revision:'42',nextAt:1,retry:false},5),false);
 assert.equal(due({...item,revision:'43'},{revision:'42',nextAt:10},5),false);
 assert.equal(due({...item,revision:'43'},{revision:'42',nextAt:1},5),true);
 assert.equal(due(item,{revision:'42',nextAt:1,retry:true},5),true);
 assert.throws(()=>due({...item,marketId:'x'},null,1));
});
test('only current dual-asset release is supported',()=>{
 assert.ok(supportedMode(DUAL_MODE));
 for(const mode of ['0xdead','0x3e3420b678dfb6bb37902afb6881366daecf47ade19a6db2bc7ba2fe851cac44','0x4a2b62eb58c5d21a8a49ea6b8cc61212bada7b6bf612d3a606fb2f892b19db9f']){
  assert.equal(supportedMode(mode),false);
  assert.throws(()=>fundingDecision({mode,amount:10n,minimum:1n}),/Unsupported/);
 }
});
test('fund only at the configured amount threshold; admission is enforced by contract',()=>{
 assert.equal(fundingDecision({amount:4n,minimum:5n}),'dust');
 assert.equal(fundingDecision({amount:5n,minimum:5n}),'fund');
 assert.throws(()=>fundingDecision({amount:5n,minimum:0n}));
});
test('checkpoint uses actual on-chain admission time and requires idle funds and holders',()=>{
 const p={mode:DUAL_MODE,idle:1n,supply:1n,nextStart:3600n,now:3600n};
 assert.equal(streamCheckpointDue(p),true);
 for(const change of [{idle:0n},{supply:0n},{now:3599n},{nextStart:86400n,now:14400n}])assert.equal(streamCheckpointDue({...p,...change}),false);
 assert.throws(()=>streamCheckpointDue({...p,mode:'old'}));
});
test('retired signed conversion operations cannot be rebroadcast by the new worker',()=>{
 for(const op of ['sweep','fund','fund-meme','checkpoint'])assert.doesNotThrow(()=>requireCurrentOperation(op));
 for(const op of ['convert','convert-beneficiaries',undefined,'unknown'])assert.throws(()=>requireCurrentOperation(op),/reconcile/);
});
test('restart preserves the remaining four-hour interval',()=>{
 assert.equal(DEFAULT_INTERVAL_SECONDS,14400);assert.equal(configuredInterval(),14400);
 for(const value of ['0','NaN','14400s','86401'])assert.throws(()=>configuredInterval(value));
 const last='2026-09-10T00:00:00.000Z';
 assert.equal(restartDelay(last,Date.parse('2026-09-10T01:00:00Z')),3*3600000);
 assert.equal(restartDelay(last,Date.parse('2026-09-10T04:00:00Z')),0);
 assert.equal(restartDelay(undefined,Date.now()),0);
 assert.throws(()=>restartDelay('bad date',Date.now()));
});
