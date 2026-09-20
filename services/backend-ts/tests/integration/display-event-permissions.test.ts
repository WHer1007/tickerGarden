import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {applyCoreMigration,createDatabasePool,displayRelayPermissionsSql} from '../../packages/db/src/index.ts';
test('relay source role can append/deduplicate inbox events but cannot read or modify display and settlement tables',{timeout:60000},async()=>{
 const suffix=`${process.pid}_${randomBytes(4).toString('hex')}`,schema=`tg_inbox_acl_${suffix}`,role=`tg_relay_acl_${suffix}`;
 const pool=createDatabasePool('postgresql:///postgres?host=/tmp',{max:1}).pool;
 let createdRole=false;
 try{
  assert.equal(await applyCoreMigration(pool,schema),true);assert.equal(await applyCoreMigration(pool,schema),false);
  await pool.query(`CREATE ROLE "${role}" NOLOGIN`);createdRole=true;
  await pool.query(displayRelayPermissionsSql(schema,role));
  await pool.query(`SET ROLE "${role}"`);
  const insert=`INSERT INTO "${schema}".display_event_inbox(environment,chain_id,deployment_digest,block_number,block_hash,transaction_hash,log_index,removed,payload) VALUES('test',46630,'fixture',1,'hash','tx',0,false,'{}') ON CONFLICT DO NOTHING`;
  await pool.query(insert);await pool.query(insert);
  for(const query of [`SELECT * FROM "${schema}".display_event_inbox`,`DELETE FROM "${schema}".display_event_inbox`,`UPDATE "${schema}".display_event_coverage SET block_number=100`,`SELECT * FROM "${schema}".holder_reward_rounds`]){await pool.query(`SET ROLE "${role}"`);await assert.rejects(pool.query(query),/permission denied/,query);}
  await pool.query('RESET ROLE');
  assert.equal((await pool.query(`SELECT count(*)::int n FROM "${schema}".display_event_inbox`)).rows[0].n,1);
 }finally{
  await pool.query('RESET ROLE');await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  if(createdRole)await pool.query(`DROP ROLE "${role}"`);await pool.end();
 }
});
