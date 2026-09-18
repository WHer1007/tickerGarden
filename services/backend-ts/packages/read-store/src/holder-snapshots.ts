import type {Pool} from 'pg';
type Hex = `0x${string}`;
type Address = Hex;
import type {DeploymentIdentity} from '../../chain/src/index.ts';
import {proofRoot,snapshotLeaf,type SnapshotDataset} from '../../chain/src/holder-snapshot.ts';
import {transaction} from '../../db/src/index.ts';
import {decodeCursor,encodeCursor,PublicationUnavailableError} from './index.ts';
import {createHash} from 'node:crypto';

export async function readHolderSnapshots(o:{pool:Pool;deployment:DeploymentIdentity;distributor:Address;marketId:Hex;account:Address;secret:string;cursor?:string;schemaName?:string}) {
 const name=o.schemaName??'tickergarden_serverless';if(!/^[a-z][a-z0-9_]{0,62}$/.test(name))throw Error('invalid schema');const schema=`"${name}"`;
 for(const address of [o.distributor,o.account])if(!/^0x[0-9a-f]{40}$/.test(address))throw Error('invalid snapshot address');if(!/^0x[0-9a-f]{64}$/.test(o.marketId))throw Error('invalid snapshot market');
 const id=[o.deployment.environment,o.deployment.chainId,o.deployment.deploymentDigest];
 return transaction(o.pool,async client=>{
  await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const row=(await client.query<{generation:string;block_number:string;block_hash:Hex;payload:{token:Address;quote:Address;publisher:Address;lastRound:string;unallocatedQuote:string;unallocatedMeme:string}}>(`SELECT m.generation,m.block_number,m.block_hash,m.payload FROM ${schema}.holder_reward_markets m JOIN ${schema}.chain_blocks b ON b.environment=m.environment AND b.chain_id=m.chain_id AND b.deployment_digest=m.deployment_digest AND b.hash=m.block_hash JOIN ${schema}.ingestion_checkpoints c ON c.environment=m.environment AND c.chain_id=m.chain_id AND c.deployment_digest=m.deployment_digest AND c.generation=m.generation AND c.stream='frontend-events' WHERE m.environment=$1 AND m.chain_id=$2 AND m.deployment_digest=$3 AND m.market_id=$4 AND m.distributor=$5 AND b.canonical AND b.finalized`,[...id,o.marketId,o.distributor])).rows[0];
  if(!row)throw new PublicationUnavailableError('snapshot market state unavailable');
  // Claims and publisher observations do not change this immutable round collection.
  const latest=(await client.query<{root:string;data_hash:string;snapshot_block_hash:string}>(`SELECT root,data_hash,snapshot_block_hash FROM ${schema}.holder_reward_rounds WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4 ORDER BY round DESC LIMIT 1`,[...id,o.marketId])).rows[0];
  const revision=createHash('sha256').update(JSON.stringify([row.generation,row.payload.lastRound,latest??null])).digest('hex');
  const filterDigest=createHash('sha256').update(JSON.stringify([...id,o.distributor,o.marketId,o.account])).digest('hex');
  const after=o.cursor?decodeCursor(o.cursor,{scope:'holder-snapshots-v2',revision,filterDigest},o.secret).sortKey:(BigInt(row.payload.lastRound)+1n).toString();
  if(!/^(0|[1-9][0-9]*)$/.test(after))throw Error('invalid snapshot cursor');
  const health=(await client.query<{count:string;verified:string}>(`SELECT count(*)::text count,count(d.verified_header)::text verified FROM ${schema}.holder_reward_rounds r LEFT JOIN ${schema}.holder_reward_datasets d USING(environment,chain_id,deployment_digest,market_id,round,data_hash) WHERE r.environment=$1 AND r.chain_id=$2 AND r.deployment_digest=$3 AND r.market_id=$4`,[...id,o.marketId])).rows[0]!;
  let complete=health.count===row.payload.lastRound&&health.verified===health.count;
  const unavailableRounds:string[]=[];
  const records=await client.query<{round:string;root:Hex;data_hash:Hex;snapshot_block:string;snapshot_block_hash:Hex;quote_budget:string;meme_budget:string;payload:SnapshotDataset|null;entry:{quoteAmount:string;memeAmount:string;proof:Hex[]}|null;assets:number|null}>(`SELECT r.round,r.root,r.data_hash,r.snapshot_block,r.snapshot_block_hash,r.quote_budget::text,r.meme_budget::text,d.verified_header payload,w.payload entry,c.assets FROM ${schema}.holder_reward_rounds r LEFT JOIN ${schema}.holder_reward_datasets d USING(environment,chain_id,deployment_digest,market_id,round,data_hash) JOIN ${schema}.holder_reward_wallet_proofs w ON w.environment=r.environment AND w.chain_id=r.chain_id AND w.deployment_digest=r.deployment_digest AND w.market_id=r.market_id AND w.round=r.round AND w.data_hash=r.data_hash AND w.account=$6 LEFT JOIN ${schema}.holder_reward_claims c ON c.environment=r.environment AND c.chain_id=r.chain_id AND c.deployment_digest=r.deployment_digest AND c.market_id=r.market_id AND c.round=r.round AND c.account=$6 WHERE r.environment=$1 AND r.chain_id=$2 AND r.deployment_digest=$3 AND r.market_id=$4 AND r.round<$5 ORDER BY r.round DESC LIMIT 11`,[...id,o.marketId,after,o.account]);
  const visible=records.rows.slice(0,10),rounds=[];let bytes=0;
  for(const r of visible){
   try {
   if(!r.payload)throw new PublicationUnavailableError('published snapshot proof dataset unavailable');
   bytes+=Buffer.byteLength(JSON.stringify(r.payload));if(bytes>32*1024*1024)throw new PublicationUnavailableError('snapshot proof input bound');
   const d=r.payload;
   if(d.input.deploymentDigest!==o.deployment.deploymentDigest||d.input.chainId!==o.deployment.chainId||d.input.distributor!==o.distributor||d.input.marketId!==o.marketId||d.input.token!==row.payload.token||d.input.quote!==row.payload.quote||d.input.round!==r.round||d.root!==r.root||d.dataHash!==r.data_hash||d.input.snapshotBlock!==r.snapshot_block||d.input.snapshotBlockHash!==r.snapshot_block_hash||d.quoteBudget!==r.quote_budget||d.memeBudget!==r.meme_budget)throw new PublicationUnavailableError('snapshot publication identity mismatch');
   const entry=r.entry;if(entry){
    if(proofRoot(snapshotLeaf(o.deployment.chainId,o.distributor,o.marketId,r.round,o.account,entry.quoteAmount,entry.memeAmount),entry.proof)!==r.root)throw new PublicationUnavailableError('snapshot wallet proof corrupt');
    rounds.push({round:r.round,snapshotBlock:r.snapshot_block,root:r.root,quoteAmount:entry.quoteAmount,memeAmount:entry.memeAmount,claimedAssets:r.assets??0,proof:entry.proof});}
   } catch {complete=false;unavailableRounds.push(r.round);}
  }
  const last=visible.at(-1);const nextCursor=records.rows.length>10&&last?encodeCursor({scope:'holder-snapshots-v2',revision,filterDigest,sortKey:last.round,identity:last.round},o.secret):null;
  const status=BigInt(row.payload.lastRound)>0n?'ready':/^0x0+$/.test(row.payload.publisher)?'publisher_unconfigured':BigInt(row.payload.unallocatedQuote)+BigInt(row.payload.unallocatedMeme)>0n?'awaiting_publication':'awaiting_funding';
  return {schema:'TICKERGARDEN_HOLDER_WALLET_SNAPSHOTS_V1' as const,chainId:o.deployment.chainId,displayOnly:true as const,finality:'finalized' as const,distributor:o.distributor,marketId:o.marketId,account:o.account,quote:row.payload.quote,meme:row.payload.token,status,publicationRevision:revision,complete,unavailableRounds,sourceBlockNumber:row.block_number,sourceBlockHash:row.block_hash,rounds,nextCursor};
 });
}
