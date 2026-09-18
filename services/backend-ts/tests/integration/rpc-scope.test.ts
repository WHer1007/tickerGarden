import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createDatabasePool,applyCoreMigration} from '../../packages/db/src/index.ts';
import {rpcScope} from '../../apps/read-api/src/rpc-scope.ts';
import {displayWakeChannel} from '../../packages/confirmed-display/src/wake.ts';
import type {DeploymentIdentity} from '../../packages/chain/src/index.ts';
const h=`0x${'1'.repeat(64)}` as const,token=`0x${'2'.repeat(40)}`;
test('newly confirmed tokens enter database RPC scope immediately and disappear after rollback; wake signals cross connections',async()=>{
 const name='tg_rpc_scope_'+randomBytes(6).toString('hex'),schema=`"${name}"`;
 // Isolated local database only: this test never loads deployment credentials.
 const pool=createDatabasePool('postgresql:///postgres?host=/tmp',{max:2,connectionTimeoutMillis:2000}).pool;
 const d:DeploymentIdentity={environment:'test',chainId:46630,deploymentDigest:h,activationBlock:0n};const id=[d.environment,d.chainId,d.deploymentDigest];
 try{
  await applyCoreMigration(pool,name);
  await pool.query(`INSERT INTO ${schema}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES($1,$2,$3,$3,0,$3,$3)`,id);
  assert.deepEqual(await rpcScope(pool,d,[token],name),[]);
  await pool.query(`INSERT INTO ${schema}.confirmed_display_markets VALUES($1,$2,$3,$3,1,$3,$4)`,[...id,JSON.stringify({market:{memeToken:token,curve:null,gauge:null}})]);
  assert.equal((await rpcScope(pool,d,[token],name))[0]?.address,token);
  assert.deepEqual(await rpcScope(pool,{...d,environment:'production'},[token],name),[]);
  await pool.query(`DELETE FROM ${schema}.confirmed_display_markets`);
  assert.deepEqual(await rpcScope(pool,d,[token],name),[]);
  const client=await pool.connect();
  try{
   const channel=displayWakeChannel(d,name);await client.query(`LISTEN ${channel}`);
   const notification=new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('wake not received')),2000);client.once('notification',n=>{clearTimeout(timer);assert.equal(n.channel,channel);resolve();});});
   await pool.query('SELECT pg_notify($1,$2)',[channel,'recover']);await notification;
   await client.query('UNLISTEN *');
  }finally{client.release();}
 }finally{await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(()=>{});await pool.end();}
});
