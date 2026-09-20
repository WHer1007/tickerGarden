import assert from 'node:assert/strict';
import test from 'node:test';
import {randomBytes} from 'node:crypto';
import {applyCoreMigration,createDatabasePool} from '../../packages/db/src/index.ts';
import {readDisplayScan} from '../../packages/confirmed-display/src/scan.ts';
import type {RpcTransport} from '../../packages/chain/src/index.ts';
const h=(n:number)=>`0x${n.toString(16).padStart(64,'0')}` as `0x${string}`;
test('20,000 scoped markets reuse durable scan coverage across batches/restart and discard it on reorg',{timeout:120000},async t=>{
 const name=`tg_scan_${process.pid}_${randomBytes(4).toString('hex')}`,s=`"${name}"`,pool=createDatabasePool('postgresql:///postgres?host=/tmp',{max:1}).pool;
 const d={environment:'test' as const,chainId:46630 as const,deploymentDigest:h(1),activationBlock:1n},id=[d.environment,d.chainId,d.deploymentDigest];
 let logCalls=0,factoryCalls=0,orphan=false;
 const rpc={block:async(n:bigint)=>({number:n,hash:h(Number(n)+(orphan?10000:0)),parentHash:h(Number(n)-1),timestamp:n}),logs:async()=>{factoryCalls++;return [];},call:async(method:string,[filter]:any[])=>{assert.equal(method,'eth_getLogs');assert.ok(filter.address.length>0&&filter.address.length<=256);assert.ok(filter.topics[0].length>0);logCalls++;return [];}} as unknown as RpcTransport;
 try{
  await applyCoreMigration(pool,name);
  for(let start=1;start<=20000;start+=2000)await pool.query(`INSERT INTO ${s}.confirmed_display_markets(environment,chain_id,deployment_digest,market_id,block_number,block_hash,payload)
  SELECT $1,$2,$3,'0x'||lpad(to_hex(n),64,'0'),1,$4,jsonb_build_object('creation',jsonb_build_object('marketId','0x'||lpad(to_hex(n),64,'0'),'memeToken','0x'||lpad(to_hex(n),40,'0'),'curve','0x'||lpad(to_hex(n+30000),40,'0'),'gauge','0x'||repeat('0',40),'source',jsonb_build_object('blockNumber','1')),'market',jsonb_build_object('marketId','0x'||lpad(to_hex(n),64,'0'),'launchPhase',0,'identity',jsonb_build_object('deployedAt','1'))) FROM generate_series($5::int,$6::int)n`,[...id,h(1),start,start+1999]);
  const client=await pool.connect();
  try{
   const scan=await readDisplayScan(client,d,rpc,2n,201n,2001n,name);assert.equal(scan.creations.size,20000);const first=logCalls;assert.equal(first,157);assert.equal(factoryCalls,1);
   // The cache lives in PostgreSQL rather than an in-memory cursor.
   for(let i=1;i<10;i++)await readDisplayScan(client,d,{...rpc} as RpcTransport,2n+BigInt(i*200),201n+BigInt(i*200),2001n,name);
   assert.equal(logCalls,first);assert.equal(factoryCalls,1);
   orphan=true;await readDisplayScan(client,d,rpc,202n,401n,2001n,name);assert.ok(logCalls>first);assert.equal(factoryCalls,2);
   t.diagnostic(`20,000-market catch-up: ${first} scoped logs calls shared by ten reducer batches instead of ${first*10}; provider calls mocked, not live throughput.`);
  }finally{client.release();}
 }finally{await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);await pool.end();}
});
