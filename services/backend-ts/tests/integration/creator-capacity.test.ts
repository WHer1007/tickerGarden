import assert from 'node:assert/strict';import test from 'node:test';import {randomBytes} from 'node:crypto';
import {applyCoreMigration,createDatabasePool} from '../../packages/db/src/index.ts';
test('Creator wallet indexes paginate 20,001 markets with three beneficiary epochs',{timeout:30000},async t=>{
 const url=process.env.TG_MIGRATION_DATABASE_URL;if(!url){t.skip('Local PostgreSQL required');return;}
 const name=`tg_creator_capacity_${randomBytes(5).toString('hex')}`,s=`"${name}"`,{pool}=createDatabasePool(url,{max:1});
 try{
  await applyCoreMigration(pool,name);
  await pool.query(`INSERT INTO ${s}.creator_reward_epochs SELECT 'test',46630,'release','0x'||lpad(to_hex(m),64,'0'),e,'0x'||lpad(to_hex(m%1000),40,'0'),'block' FROM generate_series(1,20001) m CROSS JOIN generate_series(1,3) e`);
  await pool.query(`INSERT INTO ${s}.creator_reward_balances SELECT environment,chain_id,deployment_digest,market_id,epoch,beneficiary,'asset',100,10,5,85,block_hash FROM ${s}.creator_reward_epochs`);
  await pool.query(`ANALYZE ${s}.creator_reward_epochs`);await pool.query(`ANALYZE ${s}.creator_reward_balances`);
  const owner='0x'+(1).toString(16).padStart(40,'0');
  const query=`SELECT market_id,epoch FROM ${s}.creator_reward_epochs WHERE environment='test' AND chain_id=46630 AND deployment_digest='release' AND beneficiary=$1 AND (market_id,epoch)>($2,0) ORDER BY market_id,epoch DESC LIMIT 20`;
  const page=(await pool.query(query,[owner,''])).rows;assert.equal(page.length,20);
  const plan=JSON.stringify((await pool.query('EXPLAIN (ANALYZE,FORMAT JSON) '+query,[owner,''])).rows);assert.match(plan,/creator_epochs_wallet/);assert.doesNotMatch(plan,/Seq Scan/);
  const market=page[0].market_id;
  const balances=`SELECT * FROM ${s}.creator_reward_balances WHERE environment='test' AND chain_id=46630 AND deployment_digest='release' AND beneficiary=$1 AND market_id=$2 AND epoch=ANY($3::bigint[])`;
  assert.equal((await pool.query(balances,[owner,market,[1,2,3]])).rowCount,3);
  const bp=JSON.stringify((await pool.query('EXPLAIN (ANALYZE,FORMAT JSON) '+balances,[owner,market,[1,2,3]])).rows);assert.match(bp,/Index/);assert.doesNotMatch(bp,/Seq Scan/);
  t.diagnostic('60,003 epoch rows and 60,003 balance rows; indexed wallet/market reads verified. Synthetic local capacity, not production latency.');
 }finally{await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);await pool.end();}
});
