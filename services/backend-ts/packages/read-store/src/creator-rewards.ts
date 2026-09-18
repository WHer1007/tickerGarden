import type {Pool} from 'pg';
import type {DeploymentIdentity} from '../../chain/src/index.ts';
import {transaction} from '../../db/src/index.ts';
import {decodeCursor,encodeCursor,PublicationUnavailableError} from './index.ts';
import {pendingCreatorQuote,type CreatorState} from '../../history-projector/src/creator-rewards.ts';
import {createHash} from 'node:crypto';
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export async function readCreatorRewards(o:{pool:Pool;deployment:DeploymentIdentity;account:string;marketId:string;secret:string;cursor?:string;epoch?:number;schemaName?:string}) {
 const name=o.schemaName??'tickergarden_serverless';if(!/^[a-z][a-z0-9_]*$/.test(name)||!/^0x[0-9a-f]{40}$/.test(o.account)||!/^0x[0-9a-f]{64}$/.test(o.marketId))throw Error('invalid Creator query');
 if(o.epoch!==undefined&&(!Number.isInteger(o.epoch)||o.epoch<1||o.epoch>4294967295))throw Error('invalid Creator epoch');
 const s=`"${name}"`,id=[o.deployment.environment,o.deployment.chainId,o.deployment.deploymentDigest];
 return transaction(o.pool,async c=>{
  await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const row=(await c.query<{payload:CreatorState;number:string;block_hash:string}>(`SELECT a.payload,b.number::text,a.block_hash FROM ${s}.aggregate_records a JOIN ${s}.chain_blocks b ON b.environment=a.environment AND b.chain_id=a.chain_id AND b.deployment_digest=a.deployment_digest AND b.hash=a.block_hash WHERE a.environment=$1 AND a.chain_id=$2 AND a.deployment_digest=$3 AND a.scope='creator-state' AND a.identity=$4 AND a.complete AND b.canonical AND b.finalized`,[...id,o.marketId])).rows[0];
  if(!row)throw new PublicationUnavailableError('Creator rewards are being prepared');
  const filterDigest=digest({...o.deployment,activationBlock:String(o.deployment.activationBlock),marketId:o.marketId,account:o.account});
  const after=o.cursor?decodeCursor(o.cursor,{scope:'creator-epochs',revision:'creator-epochs-v1',filterDigest},o.secret):undefined;
  const before=after?Number(after.identity):4294967296;if(!Number.isSafeInteger(before)||before<1||before>4294967296)throw Error('invalid Creator cursor');
  const epochs=(await c.query<{epoch:string;beneficiary:string}>(`SELECT e.epoch::text,e.beneficiary FROM ${s}.creator_reward_epochs e JOIN ${s}.chain_blocks b ON b.environment=e.environment AND b.chain_id=e.chain_id AND b.deployment_digest=e.deployment_digest AND b.hash=e.block_hash WHERE e.environment=$1 AND e.chain_id=$2 AND e.deployment_digest=$3 AND e.market_id=$4 AND e.beneficiary=$5 AND e.epoch<$6 AND ($7::bigint IS NULL OR e.epoch=$7) AND b.canonical AND b.finalized ORDER BY e.epoch DESC LIMIT 21`,[...id,o.marketId,o.account,before,o.epoch??null])).rows;
  const visible=epochs.slice(0,20),numbers=visible.map(e=>e.epoch);
  const balances=(await c.query(`SELECT r.epoch::text,r.asset,r.credited::text,r.paid::text,r.burned::text,r.remaining::text FROM ${s}.creator_reward_balances r JOIN ${s}.chain_blocks b ON b.environment=r.environment AND b.chain_id=r.chain_id AND b.deployment_digest=r.deployment_digest AND b.hash=r.block_hash WHERE r.environment=$1 AND r.chain_id=$2 AND r.deployment_digest=$3 AND r.market_id=$4 AND r.beneficiary=$5 AND r.epoch=ANY($6::bigint[]) AND b.canonical AND b.finalized`,[...id,o.marketId,o.account,numbers])).rows;
  const empty={credited:'0',paid:'0',burned:'0',remaining:'0'};
  const amounts=(b:any)=>b?{credited:b.credited,paid:b.paid,burned:b.burned,remaining:b.remaining}:empty;
  const periods=visible.map(e=>({epoch:Number(e.epoch),beneficiary:e.beneficiary,quote:amounts(balances.find(b=>b.epoch===e.epoch&&b.asset===row.payload.market.quoteAsset)),meme:amounts(balances.find(b=>b.epoch===e.epoch&&b.asset===row.payload.market.memeToken))}));
  const last=visible.at(-1);const nextCursor=epochs.length>20&&last?encodeCursor({scope:'creator-epochs',revision:'creator-epochs-v1',filterDigest,sortKey:last.epoch,identity:last.epoch},o.secret):null;
  const current=(await c.query(`SELECT beneficiary FROM ${s}.creator_reward_epochs WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4 AND epoch=$5`,[...id,o.marketId,row.payload.currentEpoch])).rows[0];
  return {chainId:o.deployment.chainId,displayOnly:true,account:o.account,marketId:o.marketId,market:row.payload.market,currentEpoch:row.payload.currentEpoch,currentBeneficiary:current?.beneficiary??null,pendingBeneficiary:row.payload.pendingBeneficiary,pendingQuote:current?.beneficiary===o.account?pendingCreatorQuote(row.payload).toString():'0',curveFees:row.payload.curveFees,periods,nextCursor,sourceBlockNumber:row.number,sourceBlockHash:row.block_hash};
 });
}
