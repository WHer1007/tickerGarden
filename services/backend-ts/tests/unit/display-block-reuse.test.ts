import assert from 'node:assert/strict';
import test from 'node:test';
import {readDisplayScan} from '../../packages/confirmed-display/src/scan.ts';
import {readDisplayEvents} from '../../packages/confirmed-display/src/inbox.ts';
import type {RpcTransport} from '../../packages/chain/src/index.ts';
const h=(c:string)=>`0x${c.repeat(64)}` as `0x${string}`;
const d={environment:'test' as const,chainId:46630 as const,deploymentDigest:h('a'),activationBlock:1n};
test('scans return the freshly verified ending block, while every later scan checks canonicality again',async()=>{
 let saved:any,reads=0,changed=false,flipDuringScan=false;
 const db={query:async(sql:string,args?:any[])=>{
  if(sql.startsWith('SELECT from_block'))return {rows:saved?[saved]:[]};
  if(sql.startsWith('INSERT INTO'))saved={from_block:args![3],to_block:args![4],block_hash:args![5],payload:JSON.parse(args![6])};
  return {rows:[]};
 }} as any;
 const rpc={block:async(n:bigint)=>{reads++;return {number:n,hash:changed?h('2'):h('1'),parentHash:h('0'),timestamp:100n};},logs:async()=>[],call:async()=>{if(flipDuringScan)changed=true;return [];}} as unknown as RpcTransport;
 const first=await readDisplayScan(db,d,rpc,1n,10n,10n);
 assert.equal(reads,2,'before/after scan canonical checks remain');
 assert.equal(first.blocks.get(10n)?.hash,h('1'),'caller can reuse the verified block for receipt/anchor work');
 await readDisplayScan(db,d,rpc,1n,10n,10n);assert.equal(reads,3,'no cross-pass block cache');
 saved=undefined;flipDuringScan=true;
 await assert.rejects(readDisplayScan(db,d,rpc,1n,10n,10n),/reorganized/);
 assert.equal(saved,undefined,'reorganized scan is not persisted');
});
test('multiple inbox logs in one block share one fresh observation and expose it for receipt validation',async()=>{
 let reads=0;
 const raw={address:`0x${'1'.repeat(40)}`,blockHash:h('2'),blockNumber:'0xa',transactionHash:h('3'),transactionIndex:'0x0',logIndex:'0x0',topics:[h('4')],data:'0x',removed:false};
 const db={query:async(sql:string)=>({rows:sql.includes('display_event_inbox')?[{payload:raw},{payload:{...raw,logIndex:'0x1'}}]:[]})} as any;
 const rpc={block:async(n:bigint)=>{reads++;return {number:n,hash:h('2'),parentHash:h('1'),timestamp:100n};}} as RpcTransport;
 const batch=await readDisplayEvents(db,d,rpc,1n,10n);
 assert.equal(reads,1);assert.equal(batch?.logs.length,2);assert.equal(batch?.blocks.get(10n)?.timestamp,100n);
 await readDisplayEvents(db,d,rpc,1n,10n);assert.equal(reads,2,'next pass re-verifies the block');
});
