import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import test from 'node:test';
import {applyCoreMigration,createDatabasePool,migrationManifest,migrationSql} from '../../packages/db/src/index.ts';
const url=process.env.TG_TEST_DISPLAY_DATABASE_URL??'postgresql:///postgres?host=/tmp';
const parsed=new URL(url);if(!['127.0.0.1','localhost','/tmp'].includes(parsed.searchParams.get('host')??parsed.hostname))throw Error('Local DB required');
const h=(n:string)=>`0x${n.repeat(64)}`;
test('0034 repairs stored current and recent details without changing holder eligibility or charts',async()=>{
 const name=`tg_circulation_${process.pid}_${randomBytes(3).toString('hex')}`,s=`"${name}"`,pool=createDatabasePool(url,{max:1}).pool;
 const holders={totalSupplyRaw:'1000',circulatingSupplyRaw:'100',count:1,basis:'TOTAL_MINUS_KNOWN_PROTOCOL_BALANCES_V1',items:[{account:`0x${'5'.repeat(40)}`,balanceRaw:'100'}]};
 const detail={holders,statistics:{price:'1'},trades:[],fees:[],chart:{points:[{price:'1'}]}};
 try{
  for(const m of migrationManifest().filter(m=>m.version<'0034_circulating_supply')){await pool.query(migrationSql(name,m.version));await pool.query(`UPDATE ${s}.schema_migrations SET digest=$1 WHERE version=$2`,[m.digest,m.version]);}
  await pool.query(`INSERT INTO ${s}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES('test',46630,$1,$2,1,$3,$4)`,[h('1'),h('2'),h('3'),h('4')]);
  await pool.query(`INSERT INTO ${s}.confirmed_display_markets(environment,chain_id,deployment_digest,market_id,block_number,block_hash,payload) VALUES('test',46630,$1,$2,1,$3,$4)`,[h('1'),h('2'),h('3'),{market:{},supply:'1000',balances:{protocol:'900',user:'100'},detailViews:Object.fromEntries(['1H','12H','1D'].map(p=>[p,{...detail,period:p}]))}]);
  await pool.query(`INSERT INTO ${s}.recent_markets(environment,chain_id,deployment_digest,market_id,transaction_hash,block_number,block_hash,payload,initial_detail) VALUES('test',46630,$1,$2,$3,1,$4,'{}',$5)`,[h('1'),h('2'),h('3'),h('4'),detail]);
  const stateBefore=(await pool.query(`SELECT payload FROM ${s}.confirmed_display_markets`)).rows[0].payload;
  assert.equal(await applyCoreMigration(pool,name),true);
  for(const payload of [(await pool.query(`SELECT payload FROM ${s}.confirmed_display_sections WHERE section='common'`)).rows[0].payload,(await pool.query(`SELECT initial_detail FROM ${s}.recent_markets`)).rows[0].initial_detail]){
   assert.deepEqual(payload.holders,{...holders,circulatingSupplyRaw:'1000',basis:'CHAIN_TOTAL_SUPPLY_V1'});
  }
  assert.deepEqual((await pool.query(`SELECT payload FROM ${s}.confirmed_display_markets`)).rows[0].payload,stateBefore);
  assert.deepEqual((await pool.query(`SELECT payload FROM ${s}.confirmed_display_sections WHERE section='1H'`)).rows[0].payload,detail.chart);
  assert.equal(await applyCoreMigration(pool,name),false);
 }finally{await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);await pool.end();}
});
