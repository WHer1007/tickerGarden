import test from 'node:test';
import assert from 'node:assert/strict';
import type {Pool} from 'pg';
import {createPriceBatch,SharedPriceReader,priceBatchChannel,batchPrices} from '../../packages/display-price/src/batch.ts';
const d={environment:'test' as const,chainId:46630 as const,deploymentDigest:`0x${'a'.repeat(64)}` as const,activationBlock:1n};
const row={asset:`0x${'1'.repeat(40)}`,payload:{token:`0x${'1'.repeat(40)}`,source:'robinhood_rest',status:'available',bidUsd:'2',askUsd:'4',expiresAt:'2026-09-20T12:05:00Z'}};
const db=(query:Function)=>({query}) as unknown as Pick<Pool,'query'>;
test('one task shares a lazy immutable price snapshot across consumers',async()=>{
 let reads=0;const sql=db(async()=>{reads++;return{rows:[row]};});
 const batch=createPriceBatch(d,undefined,new Date('2026-09-20T12:00:00Z'));
 assert.equal(reads,0);
 const [detail,stats,explore]=await Promise.all([batch.load(sql),batch.load(sql),batch.load(sql)]);
 assert.equal(reads,1);assert.equal(detail,stats);assert.equal(stats,explore);
 assert.throws(()=>{(detail.rows[0]!.payload as any).bidUsd='999';},TypeError);
});
test('service cache shares inflight reads, checks versions and reevaluates expiry without fetching',async()=>{
 let clock=1000,reads=0;const revisions:unknown[]=[];
 const sql=db(async(_sql:string,args:unknown[])=>{reads++;revisions.push(args[3]);return{rows:[{revision:'1',rows:args[3]==='1'?null:[row]}]};});
 const reader=new SharedPriceReader(d,undefined,{clock:()=>clock});
 await Promise.all([reader.read(sql),reader.read(sql)]);assert.equal(reads,1);
 clock=2000;await reader.read(sql);assert.equal(reads,1);
 const stale=await batchPrices(createPriceBatch(d,undefined,new Date('2026-09-20T12:05:00Z'),reader),sql);
 assert.equal([...stale.values()][0]!.status,'stale');assert.equal(reads,1);
 clock=6000;await reader.read(sql);assert.equal(reads,2);assert.deepEqual(revisions,[null,'1']);
 reader.invalidate();await reader.read(sql);assert.equal(reads,3);
});
test('invalidated inflight snapshot cannot overwrite a newer cached revision',async()=>{
 let finish!:(value:unknown)=>void,reads=0;
 const sql=db(async()=>{reads++;if(reads===1)return new Promise(resolve=>{finish=resolve;});return{rows:[{revision:'2',rows:[row]}]};});
 const reader=new SharedPriceReader(d);
 const old=reader.read(sql);reader.invalidate();const fresh=await reader.read(sql);
 finish({rows:[{revision:'1',rows:[]}]});await old;
 assert.equal((await reader.read(sql)).revision,'2');assert.equal(fresh.revision,'2');assert.equal(reads,2);
});
test('failed version check is retried and cannot silently serve cached prices',async()=>{
 let fail=false,reads=0;
 const sql=db(async()=>{reads++;if(fail)throw Error('database unavailable');return{rows:[{revision:'1',rows:[row]}]};});
 const reader=new SharedPriceReader(d);await reader.read(sql);reader.invalidate();fail=true;
 await assert.rejects(reader.read(sql),/database unavailable/);fail=false;await reader.read(sql);assert.equal(reads,3);
 assert.notEqual(priceBatchChannel(d,'a'),priceBatchChannel(d,'b'));
 assert.notEqual(priceBatchChannel(d),priceBatchChannel({...d,environment:'production'}));
});
