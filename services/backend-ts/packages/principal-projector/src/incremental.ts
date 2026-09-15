import {createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import type {Address,Hex} from 'viem';
import type {DeploymentIdentity,RpcTransport} from '../../chain/src/index.ts';
import {transaction} from '../../db/src/index.ts';
import {f72BootstrapConfigs} from '../../config-projector/src/f72-bootstrap.generated.ts';
import {decodeF72Event, fixedF72Sources, type DecodedProtocolEvent} from '../../events/src/index.ts';
import {assertPublishableAnchor,ProjectionPending,type ProjectionRecord} from '../../projection/src/index.ts';
import {replayPrincipal,parseStoredLog,verifyAccount,verifyPosition,validatePrincipalMarket,type Account,type Allocation,type Market} from './index.ts';

type Input={pool:Pool;deployment:DeploymentIdentity;blockNumber:bigint;blockHash:Hex;generation:bigint;primary:Pick<RpcTransport,'callAt'>;secondary:Pick<RpcTransport,'callAt'>;schemaName?:string;maxPages?:number;pageSize?:number;budgetMs?:number;fullAuditIntervalBlocks?:bigint};
type Candidate={block_number:string;block_hash:Hex;from_block:string;base_revision:string|null;cursor_block:string;cursor_tx:string;cursor_log:string;phase:string;progress:string;full_audit:boolean;last_audit_block:string;evidence_digest:string};
type Ledger={kind:'accounts'|'positions';identity:string;user_address:string;asset_uid:string;market_id:string|null;payload:Record<string,unknown>};
const algorithm='f72-principal-v2';
const digest=(value:unknown)=>`0x${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
const accountId=(user:string,asset:string)=>`${user}:${asset}`;
const positionId=(user:string,asset:string,market:string)=>`${user}:${asset}:${market}`;
function hydrate<T>(payload:Record<string,unknown>):T {const p={...payload};for(const key of ['deposited','allocated','amount'])if(key in p)p[key]=BigInt(String(p[key]));return p as T;}
const serialize=(value:unknown)=>JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v));

/** Every invocation consumes bounded pages at one immutable anchor. No pointer moves until both scopes pass. */
export async function projectF72Principal(input:Input):Promise<{accounts:number;positions:number}>{
 const name=input.schemaName??'tickergarden_serverless';if(!/^[a-z][a-z0-9_]{0,62}$/.test(name))throw Error('invalid database schema name');
 const schema=`"${name}"`,id=[input.deployment.environment,input.deployment.chainId,input.deployment.deploymentDigest,input.generation.toString()];
 const key=[...id,input.blockHash],revision=`${input.blockNumber}:${input.blockHash}`;
 const pageSize=input.pageSize??8,maxPages=input.maxPages??20,budget=input.budgetMs??90000;
 if(!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>250||!Number.isSafeInteger(maxPages)||maxPages<1||maxPages>1000||!Number.isSafeInteger(budget)||budget<1||budget>180000)throw Error('invalid principal work budget');
 const auditInterval=input.fullAuditIntervalBlocks??10000n;if(auditInterval<1n)throw Error('invalid audit interval');
 const anchor={...input,scope:'accounts',algorithmVersion:algorithm,records:[]};
 const where='environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND generation=$4';
 const candidateWhere=where+' AND block_hash=$5';
 const vault=fixedF72Sources().find(source=>source.module==='UserStockVault')!.address;
 const assetVaults=new Map<string,Address>();for(const config of f72BootstrapConfigs)if(config.kind==='asset'){if(String(config.values.userStockVault).toLowerCase()!==vault)throw Error('f72 asset vault binding changed');assetVaults.set(config.id,vault as Address);}
 const marketCache=new Map<string,Promise<Market|undefined>>();
 const getCandidate=async(client:Pool|PoolClient)=> (await client.query<Candidate>(`SELECT * FROM ${schema}.principal_candidates WHERE ${candidateWhere}`,key)).rows[0]!;
 async function locked(client:PoolClient,expected?:Candidate){
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${id.join(':')}:principal`]);
  await assertPublishableAnchor(client,schema,anchor);
  const current=await getCandidate(client);
  if(expected&&(!current||current.phase!==expected.phase||current.progress!==expected.progress))throw Error('principal continuation superseded');
 }
 await transaction(input.pool,async client=>{
  await locked(client);
  if(await getCandidate(client))return;
  const base=(await client.query<Candidate>(`SELECT * FROM ${schema}.principal_candidates WHERE ${where} AND phase='published' ORDER BY block_number DESC LIMIT 1`,id)).rows[0];
  if(base&&BigInt(base.block_number)>=input.blockNumber)throw Error('principal anchor cannot move backwards');
  const fullAudit=!base||input.blockNumber-BigInt(base.last_audit_block)>=auditInterval;
  const from=base?BigInt(base.block_number)+1n:input.deployment.activationBlock;
  await client.query(`INSERT INTO ${schema}.principal_candidates(environment,chain_id,deployment_digest,generation,block_hash,block_number,from_block,base_revision,cursor_block,full_audit,last_audit_block,evidence_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$7,$9,$10,$11)`,[...key,input.blockNumber.toString(),from.toString(),base?`${base.block_number}:${base.block_hash}`:null,fullAudit,(fullAudit?input.blockNumber:BigInt(base!.last_audit_block)).toString(),digest({algorithm,revision,base:base?.evidence_digest??null,fullAudit})]);
 });
 const start=Date.now();let pages=0;
 while(pages++<maxPages&&Date.now()-start<budget){
  const c=await getCandidate(input.pool);
  if(c.phase==='published')return counts(input.pool);
  if(c.phase==='events'){
   const rows=(await input.pool.query<{payload:Record<string,unknown>;module:string;number:string;transaction_index:string;log_index:string}>(`SELECT l.payload,s.module,b.number,l.transaction_index,l.log_index FROM ${schema}.chain_logs l JOIN ${schema}.chain_blocks b ON b.environment=l.environment AND b.chain_id=l.chain_id AND b.deployment_digest=l.deployment_digest AND b.hash=l.block_hash JOIN ${schema}.contract_sources s ON s.environment=l.environment AND s.chain_id=l.chain_id AND s.deployment_digest=l.deployment_digest AND s.address=l.address WHERE l.environment=$1 AND l.chain_id=$2 AND l.deployment_digest=$3 AND l.canonical AND b.canonical AND b.finalized AND b.number<=$4 AND b.number>=$5 AND (b.number,l.transaction_index,l.log_index)>($5,$6,$7) AND s.module IN ('UserStockVault','MemeStockGauge','AllocationManager') ORDER BY b.number,l.transaction_index,l.log_index LIMIT $8`,[...id.slice(0,3),input.blockNumber.toString(),c.cursor_block,c.cursor_tx,c.cursor_log,pageSize])).rows;
   await transaction(input.pool,async client=>{
    await locked(client,c);
    for(const row of rows){
     const event=decodeF72Event(row.module as Parameters<typeof decodeF72Event>[0],parseStoredLog(row.payload));if(!event)throw Error('principal event cannot be decoded');
     if(event.module==='UserStockVault'&&['StockDeposited','StockWithdrawn','AllocationLocked','AllocationReleased'].includes(event.eventName))await applyEvent(client,event);
     else {
      // Gauge-wide accumulator/activation changes affect every allocation in that market.
      // Manager events with an explicit user can be narrowed, but never infer a user from topic order.
      const marketId=typeof event.args.marketId==='string'?event.args.marketId:null;
      await client.query(`INSERT INTO ${schema}.principal_work SELECT l.environment,l.chain_id,l.deployment_digest,l.generation,$5,l.kind,l.identity,false FROM ${schema}.principal_ledger l WHERE l.environment=$1 AND l.chain_id=$2 AND l.deployment_digest=$3 AND l.generation=$4 AND l.kind='positions' AND ($6::text IS NULL OR l.market_id=$6) AND ($7::text IS NULL OR l.user_address=$7) AND ($8::text<>'MemeStockGauge' OR EXISTS(SELECT 1 FROM ${schema}.projection_read_records m WHERE m.environment=l.environment AND m.chain_id=l.chain_id AND m.deployment_digest=l.deployment_digest AND m.scope='markets' AND m.revision=$9 AND m.identity=l.market_id AND m.payload->>'gauge'=$10)) ON CONFLICT DO NOTHING`,[...key,marketId,typeof event.args.user==='string'?event.args.user.toLowerCase():null,event.module,revision,event.log.address]);
     }
    }
    if(rows.length){const last=rows.at(-1)!;await client.query(`UPDATE ${schema}.principal_candidates SET cursor_block=$6,cursor_tx=$7,cursor_log=$8,progress=progress+$9 WHERE ${candidateWhere}`,[...key,last.number,last.transaction_index,last.log_index,rows.length]);}
    else{
     // Scheduled audit is independent of change detection. Pending activation and lock
     // boundaries also need observations even on blocks with no relevant events.
     await client.query(`INSERT INTO ${schema}.principal_work SELECT l.environment,l.chain_id,l.deployment_digest,l.generation,$5,l.kind,l.identity,false FROM ${schema}.principal_ledger l WHERE l.environment=$1 AND l.chain_id=$2 AND l.deployment_digest=$3 AND l.generation=$4 AND ($6 OR EXISTS(SELECT 1 FROM ${schema}.principal_record_versions v WHERE v.environment=l.environment AND v.chain_id=l.chain_id AND v.deployment_digest=l.deployment_digest AND v.generation=l.generation AND v.scope=l.kind AND v.identity=l.identity AND v.valid_to IS NULL AND ((v.payload->>'pending')::numeric>0 OR ((v.payload->>'unlockAt')::numeric>0 AND (v.payload->>'unlockAt')::numeric<=(SELECT extract(epoch FROM source_timestamp) FROM ${schema}.chain_blocks WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND hash=$5) AND (v.payload->>'unlockAt')::numeric>coalesce((SELECT extract(epoch FROM b.source_timestamp) FROM ${schema}.chain_blocks b WHERE b.environment=$1 AND b.chain_id=$2 AND b.deployment_digest=$3 AND b.hash=split_part($7::text,':',2)),0))))) ON CONFLICT DO NOTHING`,[...key,c.full_audit,c.base_revision]);
     await client.query(`UPDATE ${schema}.principal_candidates SET phase='accounts',progress=progress+1 WHERE ${candidateWhere}`,key);
    }
   });continue;
  }
  const work=(await input.pool.query<Ledger>(`SELECT l.* FROM ${schema}.principal_work w JOIN ${schema}.principal_ledger l USING(environment,chain_id,deployment_digest,generation,kind,identity) WHERE w.environment=$1 AND w.chain_id=$2 AND w.deployment_digest=$3 AND w.generation=$4 AND w.block_hash=$5 AND w.kind=$6 AND NOT w.done ORDER BY w.identity LIMIT $7`,[...key,c.phase,pageSize])).rows;
  if(!work.length){
   if(c.phase==='accounts'){await transaction(input.pool,async client=>{await locked(client,c);await client.query(`UPDATE ${schema}.principal_candidates SET phase='positions',progress=progress+1 WHERE ${candidateWhere}`,key);});continue;}
   return finish(c);
  }
  const verified: Array<{row:Ledger;record:ProjectionRecord|null}>=[];
  // Bounded parallel calls; each getter still requires exact agreement of two RPC providers.
  for(let offset=0;offset<work.length;offset+=8)verified.push(...await Promise.all(work.slice(offset,offset+8).map(async row=>({row,record:row.kind==='accounts'?await verifyAccount(input,hydrate<Account>(row.payload)):await verifyPosition(input,hydrate<Allocation>(row.payload),loadMarket,loadAccount)}))));
  await transaction(input.pool,async client=>{
   await locked(client,c);
   for(const {row,record} of verified){
    const old=(await client.query<{payload_digest:string}>(`SELECT payload_digest FROM ${schema}.principal_record_versions WHERE ${where} AND scope=$5 AND identity=$6 AND valid_to IS NULL`,[...id,row.kind,row.identity])).rows[0];
    const next=record?digest(record.payload):null;
    if(old?.payload_digest!==next){
     if(old)await client.query(`UPDATE ${schema}.principal_record_versions SET valid_to=$7 WHERE ${where} AND scope=$5 AND identity=$6 AND valid_to IS NULL`,[...id,row.kind,row.identity,input.blockNumber.toString()]);
     if(record)await client.query(`INSERT INTO ${schema}.principal_record_versions(environment,chain_id,deployment_digest,generation,scope,identity,valid_from,sort_key,payload_digest,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$6,$8,$9)`,[...id,row.kind,row.identity,input.blockNumber.toString(),next,record.payload]);
    }
    await client.query(`UPDATE ${schema}.principal_work SET done=true WHERE ${candidateWhere} AND kind=$6 AND identity=$7`,[...key,row.kind,row.identity]);
   }
   await client.query(`UPDATE ${schema}.principal_candidates SET progress=progress+$6,evidence_digest=$7 WHERE ${candidateWhere}`,[...key,work.length,digest({prior:c.evidence_digest,scope:c.phase,verified:verified.map(v=>({identity:v.row.identity,payload:v.record?.payload??null}))})]);
  });
 }
 const c=await getCandidate(input.pool);throw new ProjectionPending('principal',input.blockNumber,Number(c.progress));

 async function loadAccount(user:string,asset:string){const row=(await input.pool.query<{payload:Record<string,unknown>}>(`SELECT payload FROM ${schema}.principal_ledger WHERE ${where} AND kind='accounts' AND identity=$5`,[...id,accountId(user,asset)])).rows[0];return row?hydrate<Account>(row.payload):undefined;}
 async function loadMarket(market:string){let result=marketCache.get(market);if(!result){result=readMarket(market);marketCache.set(market,result);}return result;}
 async function readMarket(market:string){const row=(await input.pool.query<{payload:Market}>(`SELECT payload FROM ${schema}.projection_read_records WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='markets' AND revision=$4 AND identity=$5`,[...id.slice(0,3),revision,market])).rows[0];return row?validatePrincipalMarket(row.payload):undefined;}
 async function counts(client:Pool|PoolClient){const rows=(await client.query<{scope:string;n:string}>(`SELECT scope,count(*)::text n FROM ${schema}.principal_record_versions WHERE ${where} AND valid_from<=$5 AND (valid_to IS NULL OR valid_to>$5) GROUP BY scope`,[...id,input.blockNumber.toString()])).rows;return {accounts:Number(rows.find(r=>r.scope==='accounts')?.n??0),positions:Number(rows.find(r=>r.scope==='positions')?.n??0)};}
 async function applyEvent(client:PoolClient,event:DecodedProtocolEvent){
  const user=String(event.args.user).toLowerCase(),asset=String(event.args.assetUid),market=event.args.marketId?String(event.args.marketId):null;
  const keys=[accountId(user,asset),...(market?[positionId(user,asset,market)]:[])];
  const rows=(await client.query<Ledger>(`SELECT * FROM ${schema}.principal_ledger WHERE ${where} AND identity=ANY($5::text[])`,[...id,keys])).rows;
  const accounts=new Map<string,Account>(),allocations=new Map<string,Allocation>();
  for(const r of rows)if(r.kind==='accounts')accounts.set(`${asset}:${user}`,hydrate<Account>(r.payload));else allocations.set(`${asset}:${user}:${market}`,hydrate<Allocation>(r.payload));
  replayPrincipal([event],input.deployment.chainId,assetVaults,{accounts,allocations});
  for(const [kind,values] of [['accounts',[...accounts.values()]],['positions',[...allocations.values()]]] as const)for(const value of values){
   const marketId='marketId' in value?value.marketId:null;const identity=marketId?positionId(value.user,value.assetUid,marketId):accountId(value.user,value.assetUid);
   await client.query(`INSERT INTO ${schema}.principal_ledger VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(environment,chain_id,deployment_digest,generation,kind,identity) DO UPDATE SET payload=excluded.payload`,[...id,kind,identity,value.user,value.assetUid,marketId,serialize(value)]);
   await client.query(`INSERT INTO ${schema}.principal_work VALUES($1,$2,$3,$4,$5,$6,$7,false) ON CONFLICT DO NOTHING`,[...key,kind,identity]);
  }
  const total=(await client.query<{n:string}>(`SELECT coalesce(sum((payload->>'amount')::numeric),0)::text n FROM ${schema}.principal_ledger WHERE ${where} AND kind='positions' AND user_address=$5 AND asset_uid=$6`,[...id,user,asset])).rows[0]!;
  if(BigInt(total.n)!==accounts.get(`${asset}:${user}`)!.allocated)throw Error('allocation components do not equal account allocated total');
  // A deposit/withdrawal changes free balance shown on every position of this account.
  await client.query(`INSERT INTO ${schema}.principal_work SELECT environment,chain_id,deployment_digest,generation,$5,kind,identity,false FROM ${schema}.principal_ledger WHERE ${where} AND kind='positions' AND user_address=$6 AND asset_uid=$7 ON CONFLICT DO NOTHING`,[...key,user,asset]);
 }
 async function finish(c:Candidate){return transaction(input.pool,async client=>{
  await locked(client,c);
  if((await client.query(`SELECT 1 FROM ${schema}.principal_work WHERE ${candidateWhere} AND NOT done LIMIT 1`,key)).rowCount)throw Error('principal work remains');
  const market=(await client.query(`SELECT 1 FROM ${schema}.publication_pointers WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='markets' AND revision=$4`,[...id.slice(0,3),revision])).rowCount;
  if(!market)throw Error('principal market anchor unavailable');
  const result=await counts(client);
  const verifiedCounts=(await client.query<{kind:string;n:string}>(`SELECT kind,count(*)::text n FROM ${schema}.principal_work WHERE ${candidateWhere} AND done GROUP BY kind`,key)).rows;
  for(const scope of ['accounts','positions'] as const){
   const current=(await client.query<{revision:string}>(`SELECT revision FROM ${schema}.publication_pointers WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope=$4 FOR UPDATE`,[...id.slice(0,3),scope])).rows[0];
   if(current&&BigInt(current.revision.split(':')[0]!)>=input.blockNumber)throw Error('principal publication revision must advance');
   const payload={algorithmVersion:algorithm,storage:'principal-versions-v1',recordCount:result[scope],verifiedRecordCount:Number(verifiedCounts.find(r=>r.kind===scope)?.n??0),coverage:{fromBlock:input.deployment.activationBlock.toString(),toBlock:input.blockNumber.toString()},baseRevision:c.base_revision,fullAudit:c.full_audit,evidenceDigest:c.evidence_digest};
   await client.query(`INSERT INTO ${schema}.publications(environment,chain_id,deployment_digest,scope,revision,block_number,block_hash,generation,payload_digest,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[...id.slice(0,3),scope,revision,input.blockNumber.toString(),input.blockHash,input.generation.toString(),digest(payload),payload]);
   await client.query(`INSERT INTO ${schema}.publication_pointers(environment,chain_id,deployment_digest,scope,revision) VALUES($1,$2,$3,$4,$5) ON CONFLICT(environment,chain_id,deployment_digest,scope) DO UPDATE SET revision=excluded.revision,updated_at=now()`,[...id.slice(0,3),scope,revision]);
   await client.query(`INSERT INTO ${schema}.projection_checkpoints(environment,chain_id,deployment_digest,scope,algorithm_version,next_block,generation,last_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(environment,chain_id,deployment_digest,scope) DO UPDATE SET algorithm_version=excluded.algorithm_version,next_block=excluded.next_block,generation=excluded.generation,last_revision=excluded.last_revision,updated_at=now()`,[...id.slice(0,3),scope,algorithm,(input.blockNumber+1n).toString(),input.generation.toString(),revision]);
  }
  await client.query(`UPDATE ${schema}.principal_candidates SET phase='published' WHERE ${candidateWhere}`,key);
  // Work is transient; immutable versions and the publication commitment retain evidence.
  await client.query(`DELETE FROM ${schema}.principal_work WHERE ${candidateWhere}`,key);
  return result;
 });}
}
