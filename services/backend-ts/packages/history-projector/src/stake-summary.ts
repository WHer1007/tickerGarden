import type {Pool} from 'pg';
type Hex=`0x${string}`;
import type {DeploymentIdentity} from '../../chain/src/index.ts';
import {transaction} from '../../db/src/index.ts';
import {assertPublishableAnchor,ProjectionPending} from '../../projection/src/index.ts';
import {PublicationUnavailableError} from '../../read-store/src/index.ts';

type Input={pool:Pool;deployment:DeploymentIdentity;blockNumber:bigint;blockHash:Hex;generation:bigint;schemaName?:string;pageSize?:number};
export type StakeRewardSummary={chainId:number;displayOnly:true;marketId:string;account:string;throughBlock:string;revision:string;claimed:Record<string,string>;earned:Record<string,string>};
function context(input:{deployment:DeploymentIdentity;schemaName?:string}){
 const name=input.schemaName??'tickergarden_serverless';if(!/^[a-z][a-z0-9_]{0,62}$/.test(name))throw Error('invalid schema');
 return {s:`"${name}"`,id:[input.deployment.environment,input.deployment.chainId,input.deployment.deploymentDigest]};
}
/** Pure, single-anchor calculation; burned/forfeited rewards never become earnings. */
export function rewardTotals(claimed:Record<string,string>,claimable:readonly {asset:string;amount:string;kind:string}[],burnMemeFees:boolean){
 const earned={...claimed};for(const [asset,value] of Object.entries(earned))if(!/^0x[0-9a-f]{40}$/.test(asset)||!/^\d+$/.test(value))throw Error('invalid claimed amount');
 for(const row of claimable){if(!/^0x[0-9a-f]{40}$/.test(row.asset)||!/^\d+$/.test(row.amount)||!['quote','meme'].includes(row.kind))throw Error('invalid claimable amount');if(row.kind==='meme'&&burnMemeFees)continue;earned[row.asset]=(BigInt(earned[row.asset]??'0')+BigInt(row.amount)).toString();}
 return {claimed,earned};
}
/** Changed positions and claims only; each continuation publishes at most 200 wallets. */
export async function projectStakeSummaries(input:Input):Promise<void>{
 const {s,id}=context(input),revision=`${input.blockNumber}:${input.blockHash}`,size=input.pageSize??200;
 if(!Number.isInteger(size)||size<1||size>200)throw Error('invalid summary page size');
 const result=await transaction(input.pool,async client=>{
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${id.join(':')}:stake-summary`]);
  await assertPublishableAnchor(client,s,{...input,scope:'stake-summary',algorithmVersion:'stake-summary-v1',records:[]});
  const prior=(await client.query<{next_block:string;generation:string}>(`SELECT next_block,generation FROM ${s}.projection_checkpoints WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='stake-summary'`,id)).rows[0];
  if(prior&&BigInt(prior.generation)>input.generation)throw Error('summary generation advanced');
  if(prior&&BigInt(prior.generation)===input.generation&&BigInt(prior.next_block)>input.blockNumber)return {done:true,progress:0};
  const checkpoints=(await client.query<{scope:string;last_revision:string;generation:string}>(`SELECT scope,last_revision,generation FROM ${s}.projection_checkpoints WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope IN ('history','positions')`,id)).rows;
  if(checkpoints.length!==2||checkpoints.some(c=>c.last_revision!==revision||BigInt(c.generation)!==input.generation))throw Error('summary inputs must share one finalized anchor');
  const base=prior&&BigInt(prior.generation)===input.generation?BigInt(prior.next_block)-1n:input.deployment.activationBlock-1n;
  const key=[...id,input.generation.toString(),input.blockHash];
  await client.query(`INSERT INTO ${s}.stake_summary_work(environment,chain_id,deployment_digest,generation,block_hash,base_block) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,[...key,base.toString()]);
  const work=(await client.query<{base_block:string;cursor:string;progress:string}>(`SELECT base_block,cursor,progress FROM ${s}.stake_summary_work WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND generation=$4 AND block_hash=$5`,key)).rows[0]!;
  const rows=(await client.query<{identity:string}>(`WITH changed AS (
   SELECT (payload->>'user')||':'||(payload->>'marketId') identity FROM ${s}.principal_record_versions WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND generation=$4 AND scope='positions' AND ((valid_from>$5 AND valid_from<=$6) OR (valid_to>$5 AND valid_to<=$6))
   UNION SELECT account||':'||market_id FROM ${s}.reward_history WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND kind='staker' AND through_block>$5 AND through_block<=$6
   UNION SELECT identity FROM ${s}.aggregate_records WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='stake-reward-summary' AND $8::boolean
  ) SELECT identity FROM changed WHERE identity>$7 ORDER BY identity LIMIT $9`,[...id,input.generation.toString(),work.base_block,input.blockNumber.toString(),work.cursor,!prior||BigInt(prior.generation)!==input.generation,size+1])).rows;
  const page=rows.slice(0,size);
  for(const {identity} of page){
   const [account,marketId]=identity.split(':');
   const market=(await client.query<{payload:{burnMemeFees?:boolean;quoteAsset:string;memeToken:string;assetUid:string}}>(`SELECT payload FROM ${s}.projection_read_records WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='markets' AND revision=$4 AND identity=$5`,[...id,revision,marketId])).rows[0];
   if(!market){await client.query(`DELETE FROM ${s}.aggregate_records WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='stake-reward-summary' AND identity=$4`,[...id,identity]);continue;}
   const claims=(await client.query<{asset:string;amount:string}>(`SELECT asset,sum(amount_raw)::text amount FROM ${s}.reward_history WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND kind='staker' AND account=$4 AND market_id=$5 AND through_block<=$6 GROUP BY asset`,[...id,account,marketId,input.blockNumber.toString()])).rows;
   const positions=(await client.query<{payload:{claimable:{asset:string;amount:string;kind:string}[]}}>(`SELECT payload FROM ${s}.principal_record_versions WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND generation=$4 AND scope='positions' AND identity=$5 AND valid_from<=$6 AND (valid_to IS NULL OR valid_to>$6)`,[...id,input.generation.toString(),`${account}:${market.payload.assetUid}:${marketId}`,input.blockNumber.toString()])).rows;
   if(positions.length>1)throw Error('duplicate wallet market position');
   const totals=rewardTotals(Object.fromEntries(claims.map(r=>[r.asset,r.amount])),positions[0]?.payload.claimable??[],market.payload.burnMemeFees===true);
   if(Object.keys(totals.earned).some(asset=>![market.payload.quoteAsset,market.payload.memeToken].includes(asset)))throw Error('unexpected reward asset');
   const payload:StakeRewardSummary={chainId:input.deployment.chainId,displayOnly:true,marketId:marketId!,account:account!,throughBlock:String(input.blockNumber),revision,...totals};
   await client.query(`INSERT INTO ${s}.aggregate_records(environment,chain_id,deployment_digest,scope,identity,block_hash,complete,payload) VALUES($1,$2,$3,'stake-reward-summary',$4,$5,true,$6) ON CONFLICT(environment,chain_id,deployment_digest,scope,identity) DO UPDATE SET block_hash=excluded.block_hash,payload=excluded.payload,complete=true`,[...id,identity,input.blockHash,payload]);
  }
  const progress=Number(work.progress)+page.length;
  if(rows.length>size){await client.query(`UPDATE ${s}.stake_summary_work SET cursor=$6,progress=$7 WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND generation=$4 AND block_hash=$5`,[...key,page.at(-1)!.identity,progress]);return {done:false,progress};}
  await client.query(`INSERT INTO ${s}.projection_checkpoints(environment,chain_id,deployment_digest,scope,algorithm_version,next_block,generation,last_revision) VALUES($1,$2,$3,'stake-summary','stake-summary-v1',$4,$5,$6) ON CONFLICT(environment,chain_id,deployment_digest,scope) DO UPDATE SET next_block=excluded.next_block,generation=excluded.generation,last_revision=excluded.last_revision,algorithm_version=excluded.algorithm_version`,[...id,String(input.blockNumber+1n),String(input.generation),revision]);
  await client.query(`DELETE FROM ${s}.stake_summary_work WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND generation<=$4`,[...id,String(input.generation)]);
  return {done:true,progress};
 });
 if(!result.done)throw new ProjectionPending('stake-summary',input.blockNumber,result.progress);
}
export async function readStakeSummary(input:{pool:Pool;deployment:DeploymentIdentity;schemaName?:string;marketId:string;account:string}):Promise<StakeRewardSummary>{
 const {s,id}=context(input);if(!/^0x[0-9a-f]{64}$/.test(input.marketId)||!/^0x[0-9a-f]{40}$/.test(input.account))throw Error('invalid summary identity');
 const row=(await input.pool.query<{payload:StakeRewardSummary}>(`SELECT a.payload FROM ${s}.aggregate_records a JOIN ${s}.chain_blocks b ON b.environment=a.environment AND b.chain_id=a.chain_id AND b.deployment_digest=a.deployment_digest AND b.hash=a.block_hash WHERE a.environment=$1 AND a.chain_id=$2 AND a.deployment_digest=$3 AND a.scope='stake-reward-summary' AND a.identity=$4 AND a.complete AND b.canonical AND b.finalized`,[...id,`${input.account}:${input.marketId}`])).rows[0];
 if(row)return row.payload;
 // Prove an empty history at the completed summary anchor; never infer zero from a failed read.
 const empty=(await input.pool.query<{last_revision:string;number:string}>(`SELECT c.last_revision,b.number::text FROM ${s}.projection_checkpoints c JOIN ${s}.chain_blocks b ON b.environment=c.environment AND b.chain_id=c.chain_id AND b.deployment_digest=c.deployment_digest AND c.last_revision=b.number::text||':'||b.hash WHERE c.environment=$1 AND c.chain_id=$2 AND c.deployment_digest=$3 AND c.scope='stake-summary' AND b.canonical AND b.finalized
 AND EXISTS(SELECT 1 FROM ${s}.projection_read_records m WHERE m.environment=c.environment AND m.chain_id=c.chain_id AND m.deployment_digest=c.deployment_digest AND m.scope='markets' AND m.revision=c.last_revision AND m.identity=$4)
 AND NOT EXISTS(SELECT 1 FROM ${s}.reward_history h WHERE h.environment=c.environment AND h.chain_id=c.chain_id AND h.deployment_digest=c.deployment_digest AND h.kind='staker' AND h.market_id=$4 AND h.account=$5 AND h.through_block<=b.number)
 AND NOT EXISTS(SELECT 1 FROM ${s}.principal_record_versions v WHERE v.environment=c.environment AND v.chain_id=c.chain_id AND v.deployment_digest=c.deployment_digest AND v.generation=c.generation AND v.scope='positions' AND v.payload->>'marketId'=$4 AND v.payload->>'user'=$5 AND v.valid_from<=b.number AND (v.valid_to IS NULL OR v.valid_to>b.number))`,[...id,input.marketId,input.account])).rows[0];
 if(empty)return {chainId:input.deployment.chainId,displayOnly:true,marketId:input.marketId,account:input.account,throughBlock:empty.number,revision:empty.last_revision,claimed:{},earned:{}};
 throw new PublicationUnavailableError('stake summary is not published');
}
