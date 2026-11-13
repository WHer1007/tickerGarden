import {createHash, randomUUID} from 'node:crypto';
import type {Pool, PoolClient} from 'pg';

export type RecoveryIdentity = {environment: 'production'|'test'; chainId: number; deploymentDigest: string};
type SourceRecord = {event_key: string; payload: string};
type Event = {blockNumber: string; blockHash: string; transactionHash: string; transactionIndex: string; logIndex: string; address: string; data: string; topics: string[]; removed: boolean};
const MAX_EVENTS = 1000;
const hash = (value: unknown) => '0x'+createHash('sha256').update(JSON.stringify(value)).digest('hex');
const identifier = (name: string) => {if(!/^[a-z][a-z0-9_]{0,62}$/.test(name))throw Error('Invalid recovery schema');return '"'+name+'"';};
const quantity = (value: unknown): string => {
 if(typeof value!=='string'||! /^(?:0|[1-9][0-9]*|0x[0-9a-f]+)$/i.test(value))throw Error('Invalid recorded event quantity');
 const n=BigInt(value);if(n<0n||n>9223372036854775807n)throw Error('Recorded event quantity exceeds database bound');return '0x'+n.toString(16);
};
const hex = (value: unknown, bytes?: number): string => {
 if(typeof value!=='string'||!/^0x(?:[0-9a-f]{2})*$/i.test(value)||(bytes!==undefined&&value.length!==2+bytes*2))throw Error('Invalid recorded event bytes');
 return value.toLowerCase();
};
export function normalizeRecordedEvent(raw: unknown): Event {
 if(!raw||typeof raw!=='object')throw Error('Missing recorded event');const r=raw as Record<string,unknown>;
 if(typeof r.removed!=='boolean'||!Array.isArray(r.topics)||r.topics.length>4)throw Error('Invalid recorded event shape');
 return {blockNumber:quantity(r.blockNumber),blockHash:hex(r.blockHash,32),transactionHash:hex(r.transactionHash,32),transactionIndex:quantity(r.transactionIndex),logIndex:quantity(r.logIndex),address:hex(r.address,20),data:hex(r.data),topics:r.topics.map(t=>hex(t,32)),removed:r.removed};
}
export function parseRecoveryRecord(record: SourceRecord, identity: RecoveryIdentity): Event {
 if(!record.event_key||record.event_key.length>512||Buffer.byteLength(record.payload)>262144)throw Error('Invalid durable relay record');
 const p=JSON.parse(record.payload);
 if(p.schema!=='tickergarden.chain-log-trigger.v1'||p.environment!==identity.environment||p.chainId!==identity.chainId||p.releaseId!==identity.deploymentDigest)throw Error('Durable relay identity mismatch');
 return normalizeRecordedEvent(p.log);
}
const key = (e: Event) => [e.blockHash,e.transactionHash,e.logIndex,e.removed].join(':');
function validateIdentity(d: RecoveryIdentity) {
 if(!['production','test'].includes(d.environment)||![56,4663].includes(d.chainId)||!/^0x[0-9a-f]{64}$/.test(d.deploymentDigest))throw Error('Invalid recovery deployment');
}
async function sourceRecords(relay: Pool|PoolClient,d: RecoveryIdentity): Promise<SourceRecord[]> {
 const rows=(await relay.query<SourceRecord>(`SELECT event_key,payload FROM chain_relay_events WHERE payload::jsonb->>'environment'=$1 AND (payload::jsonb->>'chainId')::integer=$2 AND payload::jsonb->>'releaseId'=$3 ORDER BY event_key LIMIT 1001`,[d.environment,d.chainId,d.deploymentDigest])).rows;
 if(rows.length>MAX_EVENTS)throw Error('Recovery exceeds reviewed event bound; use an explicitly partitioned repair');
 return rows;
}
async function inspect(client: PoolClient, records: SourceRecord[], d: RecoveryIdentity, name: string, lock=false) {
 validateIdentity(d);const s=identifier(name),id=[d.environment,d.chainId,d.deploymentDigest];
 const events=records.map(r=>parseRecoveryRecord(r,d));
 if(new Set(events.map(key)).size!==events.length)throw Error('Duplicate durable event identities require review');
 const baseline=(await client.query<{block_number:string;block_hash:string}>(`SELECT b.number::text block_number,b.hash block_hash FROM ${s}.projection_checkpoints c JOIN ${s}.chain_blocks b ON b.environment=c.environment AND b.chain_id=c.chain_id AND b.deployment_digest=c.deployment_digest AND b.number=c.next_block-1 WHERE c.environment=$1 AND c.chain_id=$2 AND c.deployment_digest=$3 AND c.scope='analytics' AND b.canonical AND b.finalized${lock?' FOR SHARE OF b,c':''}`,id)).rows[0];
 if(!baseline)throw Error('Verified persisted baseline required');
 const health=(await client.query(`SELECT status,reason,updated_at FROM ${s}.display_health WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3`,id)).rows[0]??null;
 const inbox=(await client.query<{payload:unknown;removed:boolean;applied:boolean;block_number:string;block_hash:string;transaction_hash:string;log_index:string}>(`SELECT e.payload,e.removed,e.block_number::text,e.block_hash,e.transaction_hash,e.log_index::text,a.transaction_hash IS NOT NULL applied FROM ${s}.display_event_inbox e LEFT JOIN ${s}.display_event_applied a USING(environment,chain_id,deployment_digest,block_hash,transaction_hash,log_index) WHERE e.environment=$1 AND e.chain_id=$2 AND e.deployment_digest=$3 ORDER BY e.block_number,e.log_index,e.block_hash,e.transaction_hash,e.removed LIMIT 1001`,id)).rows;
 if(inbox.length>MAX_EVENTS)throw Error('Recovery inbox exceeds reviewed event bound');
 const normalized=inbox.map(r=>{
  const event=normalizeRecordedEvent(r.payload);
  if(event.removed!==r.removed||BigInt(event.blockNumber).toString()!==r.block_number||event.blockHash!==r.block_hash||event.transactionHash!==r.transaction_hash||BigInt(event.logIndex).toString()!==r.log_index)throw Error('Inbox columns disagree with its durable payload');
  return {...r,event};
 });
 let missing=0,baselineMatched=0,alreadyApplied=0;
 for(const event of events){
  const existing=normalized.find(r=>key(r.event)===key(event));
  if(existing&&JSON.stringify(existing.event)!==JSON.stringify(event))throw Error('Durable relay/inbox payload conflict');
  if(!existing)missing++;if(existing?.applied&&!event.removed)alreadyApplied++;
  if(event.removed||BigInt(event.blockNumber)>BigInt(baseline.block_number))continue;
  const match=(await client.query(`SELECT 1 FROM ${s}.chain_logs l JOIN ${s}.chain_blocks b ON b.environment=l.environment AND b.chain_id=l.chain_id AND b.deployment_digest=l.deployment_digest AND b.hash=l.block_hash WHERE l.environment=$1 AND l.chain_id=$2 AND l.deployment_digest=$3 AND l.block_hash=$4 AND l.transaction_hash=$5 AND l.log_index=$6 AND l.transaction_index=$7 AND b.number=$8 AND l.canonical AND b.canonical AND b.finalized AND l.address=$9 AND l.payload->>'data'=$10 AND l.payload->'topics'=$11::jsonb${lock?' FOR SHARE OF b,l':''}`,[...id,event.blockHash,event.transactionHash,BigInt(event.logIndex).toString(),BigInt(event.transactionIndex).toString(),BigInt(event.blockNumber).toString(),event.address,event.data,JSON.stringify(event.topics)])).rowCount;
  if(!match)throw Error('Recorded historical event does not match the finalized database evidence');
  baselineMatched++;
 }
 const sourceDigest=hash(records);
 const plan={identity:d,schema:name,sourceDigest,sourceRecords:records.length,baseline,health,missing,baselineMatched,alreadyApplied,inboxRecords:inbox.length};
 return {plan:{...plan,planDigest:hash({...plan,inbox:normalized.map(r=>({event:r.event,applied:r.applied}))})},events,id,s,baseline};
}
/** Operator-only repair. There is deliberately no RPC client, fetch, timer or chain-head input. */
export async function reconcileRecordedEvents(input: {relay:Pool;source:Pool;identity:RecoveryIdentity;schema:string;expectedPlanDigest?:string}) {
 const {relay,source,identity:d,schema:name}=input;validateIdentity(d);identifier(name);
 const records=await sourceRecords(relay,d),client=await source.connect();
 const apply=input.expectedPlanDigest!==undefined;
 try{
  await client.query(apply?'BEGIN ISOLATION LEVEL REPEATABLE READ':'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query("SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='15s'");
  if(apply){
   const lock='confirmed-display:'+ [d.environment,d.chainId,d.deploymentDigest].join(':');
   if(!(await client.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) locked',[lock])).rows[0]?.locked)throw Error('Display event processing is active; retry the reviewed repair');
   await client.query(`LOCK TABLE ${identifier(name)}.display_event_inbox IN SHARE ROW EXCLUSIVE MODE`);
   await client.query(`SELECT 1 FROM ${identifier(name)}.display_health WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 FOR UPDATE`,[d.environment,d.chainId,d.deploymentDigest]);
  }
  const {plan,events,id,s,baseline}=await inspect(client,records,d,name,apply);
  if(!apply){await client.query('COMMIT');return {mode:'plan' as const,...plan};}
  if(input.expectedPlanDigest!==plan.planDigest)throw Error('Recovery plan changed; inspect the new durable evidence');
  // Recheck the independent database before any write. New records require a new reviewed plan.
  if(hash(await sourceRecords(relay,d))!==plan.sourceDigest)throw Error('Durable source changed during recovery');
  let restored=0,acknowledged=0;
  for(const event of events){
   const n=BigInt(event.blockNumber).toString(),index=BigInt(event.logIndex).toString();
   restored+=(await client.query(`INSERT INTO ${s}.display_event_inbox(environment,chain_id,deployment_digest,block_number,block_hash,transaction_hash,log_index,removed,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,[...id,n,event.blockHash,event.transactionHash,index,event.removed,event])).rowCount??0;
   if(!event.removed&&BigInt(n)<=BigInt(baseline.block_number)){
    acknowledged+=(await client.query(`INSERT INTO ${s}.display_event_applied(environment,chain_id,deployment_digest,block_number,block_hash,transaction_hash,log_index) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,[...id,n,event.blockHash,event.transactionHash,index])).rowCount??0;
   }
  }
  const pending=Number((await client.query(`SELECT count(*)::integer n FROM ${s}.display_event_inbox e LEFT JOIN ${s}.display_event_applied a USING(environment,chain_id,deployment_digest,block_hash,transaction_hash,log_index) WHERE e.environment=$1 AND e.chain_id=$2 AND e.deployment_digest=$3 AND (e.removed OR a.transaction_hash IS NULL)`,id)).rows[0].n);
  const eligible=plan.health?.reason==='upstream-recovery-required'||plan.health?.reason==='recorded-events-reconciled-upstream-unverified';
  const reconciled=pending===0&&eligible;
  if(reconciled)await client.query(`UPDATE ${s}.display_health SET status='unverified',reason='recorded-events-reconciled-upstream-unverified',updated_at=now() WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3`,id);
  const result={mode:'applied' as const,...plan,runId:randomUUID(),restored,acknowledged,pending,recordedEventsReconciled:reconciled,upstreamCoverage:'unverified',synchronized:false};
  await client.query(`INSERT INTO ${s}.display_recovery_runs(run_id,environment,chain_id,deployment_digest,source_digest,result) VALUES($1,$2,$3,$4,$5,$6)`,[result.runId,...id,plan.sourceDigest,result]);
  await client.query('COMMIT');return result;
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
