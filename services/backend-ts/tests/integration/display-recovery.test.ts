import test from 'node:test';import assert from 'node:assert/strict';import {randomBytes} from 'node:crypto';import pg from 'pg';
import {applyCoreMigration} from '../../packages/db/src/migrations.ts';
import {reconcileRecordedEvents} from '../../packages/confirmed-display/src/recovery.ts';
import {readDisplayCoverage} from '../../packages/confirmed-display/src/health.ts';
const h=(c:string)=>'0x'+c.repeat(64);
test('durable recovery repairs only exact finalized events, is idempotent, rejects drift, and preserves unknown coverage',async t=>{
 const url=process.env.TG_TEST_DATABASE_URL;if(!url)return t.skip('local PostgreSQL required');
 const suffix=randomBytes(5).toString('hex'),schema='recovery_'+suffix,relaySchema='relay_'+suffix,s='"'+schema+'"';
 const source=new pg.Pool({connectionString:url,max:2}),relay=new pg.Pool({connectionString:url,max:1,options:'-c search_path='+relaySchema});
 const d={environment:'test' as const,chainId:4663,deploymentDigest:h('1')},id=[d.environment,d.chainId,d.deploymentDigest];
 const log={blockNumber:'1',blockHash:h('2'),transactionHash:h('4'),transactionIndex:'0',logIndex:'3',address:'0x'+'a'.repeat(40),topics:[h('b')],data:'0x1234',removed:false};
 const payload={schema:'tickergarden.chain-log-trigger.v1',...d,releaseId:d.deploymentDigest,log};
 const input={source,relay,identity:d,schema};let fetches=0;const oldFetch=globalThis.fetch;globalThis.fetch=async()=>{fetches++;throw Error('Recovery must not use RPC');};
 try{
  await applyCoreMigration(source,schema);await source.query(`CREATE SCHEMA ${relaySchema};CREATE TABLE ${relaySchema}.chain_relay_events(event_key text PRIMARY KEY,payload text NOT NULL)`);
  await source.query(`INSERT INTO ${s}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES($1,$2,$3,$4,1,$5,$6)`,[...id,h('0'),h('2'),h('3')]);
  for(const [n,hash]of [[1,h('2')],[2,h('3')]] as const)await source.query(`INSERT INTO ${s}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized) VALUES($1,$2,$3,$4,$5,$6,true,true)`,[...id,n,hash,h('0')]);
  await source.query(`INSERT INTO ${s}.projection_checkpoints(environment,chain_id,deployment_digest,scope,algorithm_version,next_block,generation) VALUES($1,$2,$3,'analytics','fixture',3,0)`,id);
  await source.query(`INSERT INTO ${s}.chain_logs(environment,chain_id,deployment_digest,block_hash,transaction_hash,transaction_index,log_index,address,topic0,payload,canonical) VALUES($1,$2,$3,$4,$5,0,3,$6,$7,$8,true)`,[...id,h('2'),h('4'),log.address,h('b'),log]);
  await source.query(`INSERT INTO ${s}.display_health VALUES($1,$2,$3,'gap','upstream-recovery-required',now())`,id);
  await relay.query('INSERT INTO chain_relay_events VALUES($1,$2)',['event',JSON.stringify(payload)]);
  const plan=await reconcileRecordedEvents(input);assert.equal(plan.missing,1);assert.equal(plan.baselineMatched,1);
  assert.equal((await source.query(`SELECT count(*)::int n FROM ${s}.display_event_inbox`)).rows[0].n,0,'plan is read-only');
  await source.query(`UPDATE ${s}.chain_logs SET transaction_index=1`);await assert.rejects(reconcileRecordedEvents({...input,expectedPlanDigest:plan.planDigest}),/does not match/);await source.query(`UPDATE ${s}.chain_logs SET transaction_index=0`);
  const applied=await reconcileRecordedEvents({...input,expectedPlanDigest:plan.planDigest});assert.equal(applied.mode,'applied');if(applied.mode!=='applied')throw Error('expected apply');
  assert.equal(applied.restored,1);assert.equal(applied.acknowledged,1);assert.equal(applied.pending,0);assert.equal(applied.recordedEventsReconciled,true);assert.equal(applied.synchronized,false);
  const coverage=await readDisplayCoverage(source,d as any,schema);assert.equal(coverage.status,'unverified');assert.equal(coverage.synchronized,false);
  await source.query(`UPDATE ${s}.display_event_inbox SET block_number=2`);await assert.rejects(reconcileRecordedEvents(input),/columns disagree/);await source.query(`UPDATE ${s}.display_event_inbox SET block_number=1`);
  const second=await reconcileRecordedEvents(input),duplicate=await reconcileRecordedEvents({...input,expectedPlanDigest:second.planDigest});assert.equal(duplicate.mode,'applied');if(duplicate.mode==='applied'){assert.equal(duplicate.restored,0);assert.equal(duplicate.acknowledged,0);}
  await assert.rejects(reconcileRecordedEvents({...input,expectedPlanDigest:plan.planDigest}),/plan changed/);
  assert.equal((await source.query(`SELECT next_block FROM ${s}.projection_checkpoints`)).rows[0].next_block,'3','repair never advances chain cursor');
  assert.equal((await source.query(`SELECT count(*)::int n FROM ${s}.display_recovery_runs`)).rows[0].n,2);
  // A persisted removal is explicit unresolved work; never silently dismiss it.
  await relay.query('INSERT INTO chain_relay_events VALUES($1,$2)',['removed',JSON.stringify({...payload,log:{...log,removed:true}})]);
  await source.query(`UPDATE ${s}.display_health SET status='gap',reason='upstream-recovery-required',updated_at=now()`);
  const removal=await reconcileRecordedEvents(input),repaired=await reconcileRecordedEvents({...input,expectedPlanDigest:removal.planDigest});assert.equal(repaired.mode,'applied');if(repaired.mode==='applied'){assert.equal(repaired.pending,1);assert.equal(repaired.recordedEventsReconciled,false);}
  assert.equal((await readDisplayCoverage(source,d as any,schema)).status,'gap');
  await relay.query('UPDATE chain_relay_events SET payload=$1 WHERE event_key=$2',[JSON.stringify({...payload,log:{...log,data:'0xabcd'}}),'event']);
  await assert.rejects(reconcileRecordedEvents(input),/payload conflict/);assert.equal(fetches,0);
 }finally{globalThis.fetch=oldFetch;await relay.end();await source.query(`DROP SCHEMA IF EXISTS ${relaySchema} CASCADE; DROP SCHEMA IF EXISTS ${s} CASCADE`);await source.end();}
});
