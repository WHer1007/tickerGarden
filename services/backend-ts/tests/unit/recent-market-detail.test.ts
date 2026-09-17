import assert from 'node:assert/strict';
import test from 'node:test';
import type {Pool} from 'pg';
import {readPublishedRecord} from '../../packages/read-store/src/index.ts';
const hash=`0x${'a'.repeat(64)}` as const;
const recent={marketId:hash,identity:{name:'SEED'},confirmation:{status:'confirmed'}};
async function read(published:unknown,includeRecent=true){
 let recentReads=0;
 const pool={query:async(sql:string)=>{
  if(sql.includes('SELECT p.revision'))return {rows:[{revision:`100:${hash}`,block_number:'100',block_hash:hash}]};
  if(sql.includes('SELECT r.payload'))return {rows:published?[{payload:published}]:[]};
  if(sql.includes('.recent_markets')){recentReads++;assert.match(sql,/canonical AND expires_at>now\(\)/);return {rows:[{payload:recent}]};}
  if(sql.includes('SELECT number,hash'))return {rows:[{number:'100',hash}]};
  throw Error(sql);
 }} as unknown as Pool;
 const result=await readPublishedRecord({pool,deployment:{environment:'production',chainId:4663,deploymentDigest:hash,activationBlock:1n},scope:'markets',identity:hash,includeRecent});return {result,recentReads};
}
test('hydrated recent creation replaces an identity-less published market',async()=>{const {result,recentReads}=await read({marketId:hash});assert.deepEqual(result.item,recent);assert.equal(recentReads,1);});
test('complete publication is never replaced by older creation details',async()=>{const full={marketId:hash,identity:{name:'Current'},display:{priceQuote:'2'}};const {result,recentReads}=await read(full);assert.deepEqual(result.item,full);assert.equal(recentReads,0);});
test('recent creation fallback is opt-in',async()=>{const {result,recentReads}=await read(null,false);assert.equal(result.item,null);assert.equal(recentReads,0);});
