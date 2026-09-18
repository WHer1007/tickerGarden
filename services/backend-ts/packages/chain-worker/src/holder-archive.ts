import {canonicalSnapshotJson,proofRoot,snapshotLeaf} from '../../chain/src/holder-snapshot.ts';
import {verifySnapshotArtifact,type SnapshotArtifact,type SnapshotManifest} from '../../chain/src/holder-artifact.ts';
import {indexHolderDataset} from '../../chain/src/holder-proof-index.ts';
import {transaction} from '../../db/src/index.ts';
import {snapshotSchema,snapshotIdentity,type SnapshotOptions} from './holder-snapshots.ts';
import {advanceShardedTree} from './holder-sharded-snapshot.ts';
import {ledgerTransaction,ledgerWhere,workKey,type LedgerOptions} from './holder-snapshot-ledger.ts';
import type {Hex} from 'viem';
/** Explicit paged archive inspection. Cursor is an account, not a public API token. */
export async function inspectHolderArchive(o:SnapshotOptions,artifact:SnapshotArtifact,after=''){
 const d=verifySnapshotArtifact(artifact),i=d.input,s=snapshotSchema(o.schemaName);
 if(after!==''&&!/^0x[0-9a-f]{40}$/.test(after))throw Error('invalid archive cursor');
 if(i.chainId!==o.deployment.chainId||i.deploymentDigest!==o.deployment.deploymentDigest)throw Error('archive deployment mismatch');
 const id=[...snapshotIdentity(o.deployment),i.marketId,i.round,d.dataHash];
 const row=(await o.pool.query<{payload:unknown;verified_header:unknown;n:string}>(`SELECT d.payload,d.verified_header,(SELECT count(*)::text FROM ${s}.holder_reward_wallet_proofs w WHERE w.environment=d.environment AND w.chain_id=d.chain_id AND w.deployment_digest=d.deployment_digest AND w.market_id=d.market_id AND w.round=d.round AND w.data_hash=d.data_hash) n FROM ${s}.holder_reward_datasets d WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4 AND round=$5 AND data_hash=$6`,id)).rows[0];
 const issues:string[]=[];
 if(!row)issues.push('dataset_missing');else{
  if(!row.verified_header)issues.push('header_missing');
  else {const header=row.verified_header as {input?:Record<string,unknown>;root?:string;dataHash?:string;quoteBudget?:string;memeBudget?:string};
   const {exclusions,...input}=i;const expected=Object.fromEntries(Object.entries(input).filter(([key])=>key!=='balances'));
   if(canonicalSnapshotJson(header.input??{})!==canonicalSnapshotJson(expected)||header.root!==d.root||header.dataHash!==d.dataHash||header.quoteBudget!==d.quoteBudget||header.memeBudget!==d.memeBudget)issues.push('header_mismatch');
  }
  if(row.n!==(d.schema==='TICKERGARDEN_HOLDER_MANIFEST_V2'?d.entryCount:String(d.entries.length)))issues.push('proof_count_mismatch');
  if(d.schema==='TICKERGARDEN_HOLDER_MANIFEST_V2'&&canonicalSnapshotJson(row.payload)!==canonicalSnapshotJson(d))issues.push('manifest_mismatch');
 }
 const proofs=(await o.pool.query<{account:Hex;payload:{quoteAmount:string;memeAmount:string;proof:Hex[]}}>(`SELECT account,payload FROM ${s}.holder_reward_wallet_proofs WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4 AND round=$5 AND data_hash=$6 AND account>$7 ORDER BY account LIMIT 501`,[...id,after])).rows;
 for(const p of proofs.slice(0,500))try{if(proofRoot(snapshotLeaf(i.chainId,i.distributor,i.marketId,i.round,p.account,p.payload.quoteAmount,p.payload.memeAmount),p.payload.proof)!==d.root)issues.push(`proof_corrupt:${p.account}`);}catch{issues.push(`proof_corrupt:${p.account}`);}
 return {status:issues.length?'needs_repair':'page_verified',marketId:i.marketId,round:i.round,checked:Math.min(proofs.length,500),issues,nextAccount:proofs.length>500?proofs[499]!.account:null};
}
/** Repairs index only, never changes a round or sends a transaction. V2 needs retained ledger/tree. */
export async function repairHolderArchive(o:SnapshotOptions,artifact:SnapshotArtifact){
 const d=verifySnapshotArtifact(artifact),i=d.input,s=snapshotSchema(o.schemaName);
 if(i.chainId!==o.deployment.chainId||i.deploymentDigest!==o.deployment.deploymentDigest)throw Error('archive deployment mismatch');
 if(d.schema==='TICKERGARDEN_HOLDER_DATASET_V1'){
  await transaction(o.pool,async c=>indexHolderDataset(c,o.schemaName??'tickergarden_serverless',o.deployment.environment,d));return {status:'index_repaired',dataHash:d.dataHash};
 }
 const work=(await o.pool.query<{generation:string;context:SnapshotManifest['input'];manifest:SnapshotManifest}>(`SELECT w.generation::text,w.context,w.manifest FROM ${s}.holder_snapshot_work w JOIN ${s}.ingestion_checkpoints c ON c.environment=w.environment AND c.chain_id=w.chain_id AND c.deployment_digest=w.deployment_digest AND c.generation=w.generation AND c.stream='frontend-events' WHERE w.environment=$1 AND w.chain_id=$2 AND w.deployment_digest=$3 AND w.market_id=$4 AND w.block_hash=$5`,[...snapshotIdentity(o.deployment),i.marketId,i.snapshotBlockHash])).rows[0];
 if(!work||canonicalSnapshotJson(work.manifest)!==canonicalSnapshotJson(d)||canonicalSnapshotJson(work.context)!==canonicalSnapshotJson(i))throw Error('Verified snapshot work unavailable; restore retained archive or rerun prepare at the snapshot block');
 const options:LedgerOptions={...o,context:work.context,generation:BigInt(work.generation)},k=workKey(options),id=[...k.slice(0,4),i.round,d.dataHash];
 await ledgerTransaction(options,async c=>{
  const state=(await c.query<{phase:string}>(`SELECT phase FROM ${s}.holder_snapshot_work WHERE ${ledgerWhere}`,k)).rows[0]!;
  if(!['complete','proofs'].includes(state.phase))throw Error('Snapshot tree not ready for repair');
  if(state.phase==='complete'){
   await c.query(`INSERT INTO ${s}.holder_reward_datasets(environment,chain_id,deployment_digest,market_id,round,data_hash,snapshot_block,snapshot_block_hash,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,[...id,i.snapshotBlock,i.snapshotBlockHash,d]);
   const result=await c.query(`UPDATE ${s}.holder_reward_datasets SET verified_header=NULL WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4 AND round=$5 AND data_hash=$6 AND payload=$7`,[...id,d]);if(result.rowCount!==1)throw Error('Archive manifest conflict');
   await c.query(`UPDATE ${s}.holder_snapshot_work SET phase='proofs',proof_cursor=0 WHERE ${ledgerWhere}`,k);
  }
 });
 for(let n=0;n<20;n++)if(await advanceShardedTree(options))return {status:'index_repaired',dataHash:d.dataHash};
 return {status:'repair_pending',dataHash:d.dataHash,retry:'Repeat the same repair command'};
}
