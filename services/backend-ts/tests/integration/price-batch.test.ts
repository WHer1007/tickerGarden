import type {PoolClient} from 'pg';
import test from 'node:test';import assert from 'node:assert/strict';import {randomBytes} from 'node:crypto';
import {createDatabasePool,applyCoreMigration} from '../../packages/db/src/index.ts';
import {storePriceReferences,type PriceReference} from '../../packages/display-price/src/index.ts';
import {SharedPriceReader,createPriceBatch,priceBatchChannel} from '../../packages/display-price/src/batch.ts';
import {refreshDisplayPreparation} from '../../packages/confirmed-display/src/maintenance.ts';
const connectionString=process.env.TG_MIGRATION_DATABASE_URL;
test('committed price versions share snapshots, isolate environments, and recover missed notifications',async t=>{
 if(!connectionString){t.skip('local PostgreSQL required');return;}
 const schema='tg_batch_'+randomBytes(5).toString('hex'),pool=createDatabasePool(connectionString,{max:2}).pool;
 const hash=`0x${'a'.repeat(64)}` as const,token=`0x${'1'.repeat(40)}` as const;
 const d={environment:'test' as const,chainId:46630 as const,deploymentDigest:hash,activationBlock:1n};
 const at=new Date();let time=1000;
 const price=(offset:number):PriceReference=>({chainId:46630,token,assetUid:hash,symbol:'TEST',source:'robinhood_rest',unit:'USD_PER_WHOLE_TOKEN',status:'available',bidUsd:String(2+offset),askUsd:String(2+offset),multiplier:'1',asOf:new Date(+at+offset).toISOString(),retrievedAt:new Date(+at+offset).toISOString(),expiresAt:new Date(+at+300000).toISOString()});
 t.mock.method(console,'info',()=>{});
 let listener:PoolClient|undefined;
 try{
  await applyCoreMigration(pool,schema);
  for(const environment of ['test','production'])await pool.query(`INSERT INTO ${schema}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES($1,46630,$2,$2,1,$2,$2)`,[environment,hash]);
  listener=await pool.connect();await listener.query(`LISTEN ${priceBatchChannel(d,schema)}`);
  const notices:string[]=[];listener.on('notification',m=>notices.push(m.payload!));
  await storePriceReferences(pool,d,[price(0)],schema);
  const reader=new SharedPriceReader(d,schema,{clock:()=>time});
  let reads=0;const countDb={query:(...args:any[])=>{reads++;return Reflect.apply(pool.query,pool,args);}} as typeof pool;
  const shared=createPriceBatch(d,schema,at,reader);
  const [detail,explore,stats]=await Promise.all([shared.load(countDb),shared.load(countDb),shared.load(countDb)]);
  assert.equal(detail,explore);assert.equal(detail,stats);assert.equal(reads,1);assert.equal(detail.revision,'1');
  await storePriceReferences(pool,d,[price(1)],schema);
  assert.equal((await shared.load(countDb)).revision,'1'); // in-flight task stays consistent
  time+=5001;const recovered=await createPriceBatch(d,schema,at,reader).load(countDb);
  assert.equal(recovered.revision,'2');assert.equal(recovered.rows[0]!.payload.bidUsd,'3');assert.equal(reads,2);
  time+=5001;assert.equal((await reader.read(countDb)).rows,recovered.rows);assert.equal(reads,3);
  await storePriceReferences(pool,d,[price(0)],schema); // older result does not advance the batch
  reader.invalidate();assert.equal((await reader.read(countDb)).revision,'2');
  await assert.rejects(storePriceReferences(pool,d,[{...price(2),expiresAt:new Date(+at-1).toISOString()}],schema));
  reader.invalidate();assert.equal((await reader.read(countDb)).revision,'2');
  await storePriceReferences(pool,{...d,environment:'production'},[price(10)],schema);
  const other=await new SharedPriceReader({...d,environment:'production'},schema).read(pool);
  assert.equal(other.rows[0]!.payload.bidUsd,'12');reader.invalidate();assert.equal((await reader.read(pool)).rows[0]!.payload.bidUsd,'3');
  // Drain a driver query before reading notifications; only committed changes publish.
  await listener.query('SELECT 1');assert.deepEqual(notices,['1','2']);
  let loads=0;
  const idle=await refreshDisplayPreparation({pool,deployment:d,schemaName:schema,priceBatch:{now:at,load:async()=>{loads++;throw Error('idle worker must not read prices');}}});
  assert.equal(loads,0);assert.deepEqual(idle,{processed:0,failed:0,more:false});
 }finally{if(listener){await listener.query('UNLISTEN *');listener.release();}await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await pool.end();}
});
