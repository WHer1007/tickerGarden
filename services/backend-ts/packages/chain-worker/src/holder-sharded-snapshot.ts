import {createHash} from 'node:crypto';
import {concat,keccak256,type Hex} from 'viem';
import {canonicalSnapshotJson,SNAPSHOT_POLICY,snapshotLeaf,proofRoot} from '../../chain/src/holder-snapshot.ts';
import {manifestHash,type SnapshotManifest} from '../../chain/src/holder-artifact.ts';
import {snapshotSchema,snapshotPreparationContext,type SnapshotOptions} from './holder-snapshots.ts';
import {advanceSnapshotLedger,ledgerTransaction,ledgerWhere,workKey,SnapshotPreparationPending,type LedgerOptions} from './holder-snapshot-ledger.ts';
const pair=(a:Hex,b:Hex)=>keccak256(concat(a<b?[a,b]:[b,a]));
/** Merkle levels and proof pages are persisted. Memory is bounded by pageSize, never Holder count. */
export async function advanceShardedTree(o:LedgerOptions,pageSize=500):Promise<SnapshotManifest|null>{
 if(!Number.isInteger(pageSize)||pageSize<1||pageSize>1000)throw Error('invalid snapshot page size');
 const s=snapshotSchema(o.schemaName),k=workKey(o),i=o.context;
 return ledgerTransaction(o,async c=>{
  const w=(await c.query<any>(`SELECT * FROM ${s}.holder_snapshot_work WHERE ${ledgerWhere}`,k)).rows[0];if(!w)throw Error('snapshot work missing');
  if(w.phase==='complete')return w.manifest as SnapshotManifest;
  if(w.phase==='balances-ready'){
   const supply=(await c.query<{supply:string}>(`SELECT coalesce(sum(balance),0)::text supply FROM ${s}.holder_snapshot_balances WHERE ${ledgerWhere} AND NOT account=ANY($7)`,[...k,i.exclusions])).rows[0]!.supply;
   if(BigInt(supply)===0n)throw Error('no eligible holders');
   if(i.burnMemeFees&&BigInt(i.memeAvailable))throw Error('burn-mode Meme funding');
   await c.query(`UPDATE ${s}.holder_snapshot_work SET phase='leaves',manifest=$7 WHERE ${ledgerWhere}`,[...k,{eligibleSupply:supply,entryCount:'0',quoteBudget:'0',memeBudget:'0',balancesDigest:'0'.repeat(64)}]);return null;
  }
  if(w.phase==='leaves'){
   const rows=(await c.query<{account:Hex;balance:string}>(`SELECT account,balance::text FROM ${s}.holder_snapshot_balances WHERE ${ledgerWhere} AND account>$7 AND balance>0 ORDER BY account LIMIT $8`,[...k,w.verify_cursor,pageSize])).rows;
   const meta={...w.manifest},entries=[];let ordinal=BigInt(meta.entryCount),quote=BigInt(meta.quoteBudget),meme=BigInt(meta.memeBudget);
   for(const row of rows){meta.balancesDigest=createHash('sha256').update(meta.balancesDigest+'\n'+row.account+':'+row.balance).digest('hex');if(i.exclusions.includes(row.account))continue;
    const q=BigInt(i.quoteAvailable)*BigInt(row.balance)/BigInt(meta.eligibleSupply),m=BigInt(i.memeAvailable)*BigInt(row.balance)/BigInt(meta.eligibleSupply);if(q+m===0n)continue;
    const payload={...row,quoteAmount:String(q),memeAmount:String(m)};entries.push({ordinal:String(ordinal++),hash:snapshotLeaf(i.chainId,i.distributor,i.marketId,i.round,row.account,String(q),String(m)),payload});quote+=q;meme+=m;
   }
   if(entries.length)await c.query(`INSERT INTO ${s}.holder_snapshot_nodes SELECT $1,$2,$3,$4,$5,$6,0,r.ordinal::bigint,r.hash,r.payload FROM jsonb_to_recordset($7) r(ordinal text,hash text,payload jsonb)`,[...k,JSON.stringify(entries)]);
   Object.assign(meta,{entryCount:String(ordinal),quoteBudget:String(quote),memeBudget:String(meme)});
   if(rows.length<pageSize&&ordinal===0n)throw Error('no distributable budget');
   await c.query(`UPDATE ${s}.holder_snapshot_work SET phase=$7,verify_cursor=$8,manifest=$9,tree_level=1,tree_cursor=0 WHERE ${ledgerWhere}`,[...k,rows.length<pageSize?'tree':'leaves',rows.at(-1)?.account??w.verify_cursor,meta]);return null;
  }
  if(w.phase==='tree'){
   const divisor=2n**BigInt(w.tree_level-1),count=String((BigInt(w.manifest.entryCount)+divisor-1n)/divisor);
   if(count==='1'){
    const root=(await c.query<{hash:Hex}>(`SELECT hash FROM ${s}.holder_snapshot_nodes WHERE ${ledgerWhere} AND level=$7 AND ordinal=0`,[...k,w.tree_level-1])).rows[0]!.hash;
    const meta=w.manifest,body={schema:'TICKERGARDEN_HOLDER_MANIFEST_V2' as const,policy:SNAPSHOT_POLICY as typeof SNAPSHOT_POLICY,input:i,root,quoteBudget:meta.quoteBudget,memeBudget:meta.memeBudget,eligibleSupply:meta.eligibleSupply,entryCount:meta.entryCount,balancesDigest:meta.balancesDigest};
    const manifest={...body,dataHash:manifestHash(body)};
    await c.query(`INSERT INTO ${s}.holder_reward_datasets(environment,chain_id,deployment_digest,market_id,round,data_hash,snapshot_block,snapshot_block_hash,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,[...k.slice(0,4),i.round,manifest.dataHash,i.snapshotBlock,i.snapshotBlockHash,manifest]);
    await c.query(`UPDATE ${s}.holder_snapshot_work SET phase='proofs',manifest=$7 WHERE ${ledgerWhere}`,[...k,manifest]);return null;
   }
   const rows=(await c.query<{ordinal:string;hash:Hex}>(`SELECT ordinal::text,hash FROM ${s}.holder_snapshot_nodes WHERE ${ledgerWhere} AND level=$7 AND ordinal>=$8 ORDER BY ordinal::bigint LIMIT $9`,[...k,w.tree_level-1,String(BigInt(w.tree_cursor)*2n),pageSize*2])).rows;
   const output=[];for(let n=0;n<rows.length;n+=2)output.push({ordinal:String(BigInt(rows[n]!.ordinal)/2n),hash:rows[n+1]?pair(rows[n]!.hash,rows[n+1]!.hash):rows[n]!.hash});
   if(output.length)await c.query(`INSERT INTO ${s}.holder_snapshot_nodes SELECT $1,$2,$3,$4,$5,$6,$7,r.ordinal::bigint,r.hash,NULL FROM jsonb_to_recordset($8) r(ordinal text,hash text)`,[...k,w.tree_level,JSON.stringify(output)]);
   const end=BigInt(w.tree_cursor)+BigInt(output.length),done=end*2n>=BigInt(count);
   await c.query(`UPDATE ${s}.holder_snapshot_work SET tree_level=$7,tree_cursor=$8 WHERE ${ledgerWhere}`,[...k,done?w.tree_level+1:w.tree_level,done?'0':String(end)]);return null;
  }
  if(w.phase!=='proofs')throw Error('snapshot balances not ready');
  const manifest=w.manifest as SnapshotManifest;
  const leaves=(await c.query<{ordinal:string;hash:Hex;payload:{account:string;quoteAmount:string;memeAmount:string}}>(`SELECT ordinal::text,hash,payload FROM ${s}.holder_snapshot_nodes WHERE ${ledgerWhere} AND level=0 AND ordinal>=$7 ORDER BY ordinal::bigint LIMIT $8`,[...k,w.proof_cursor,pageSize])).rows;
  const requests=new Map<string,{level:number;ordinal:string}>();
  for(const leaf of leaves){let index=BigInt(leaf.ordinal),count=BigInt(manifest.entryCount),level=0;while(count>1n){const sibling=index%2n===0n?index+1n:index-1n;if(sibling<count)requests.set(`${level}:${sibling}`,{level,ordinal:String(sibling)});index/=2n;count=(count+1n)/2n;level++;}}
  const nodes=(await c.query<{level:number;ordinal:string;hash:Hex}>(`SELECT n.level,n.ordinal::text,n.hash FROM ${s}.holder_snapshot_nodes n JOIN jsonb_to_recordset($7) r(level integer,ordinal text) ON n.level=r.level AND n.ordinal=r.ordinal::bigint WHERE ${ledgerWhere.split(' AND ').map(v=>'n.'+v).join(' AND ')}`,[...k,JSON.stringify([...requests.values()])])).rows;
  const byKey=new Map(nodes.map(n=>[`${n.level}:${n.ordinal}`,n.hash]));
  const entries=leaves.map(leaf=>{let index=BigInt(leaf.ordinal),count=BigInt(manifest.entryCount),level=0;const proof:Hex[]=[];while(count>1n){const sibling=index%2n===0n?index+1n:index-1n;if(sibling<count){const hash=byKey.get(`${level}:${sibling}`);if(!hash)throw Error('snapshot tree incomplete');proof.push(hash);}index/=2n;count=(count+1n)/2n;level++;}if(proofRoot(leaf.hash,proof)!==manifest.root)throw Error('snapshot proof mismatch');return {account:leaf.payload.account,payload:{quoteAmount:leaf.payload.quoteAmount,memeAmount:leaf.payload.memeAmount,proof}};});
  const identity=[...k.slice(0,4),i.round,manifest.dataHash];
  if(entries.length)await c.query(`INSERT INTO ${s}.holder_reward_wallet_proofs SELECT $1,$2,$3,$4,$5,$6,r.account,r.payload FROM jsonb_to_recordset($7) r(account text,payload jsonb) ON CONFLICT(environment,chain_id,deployment_digest,market_id,round,data_hash,account) DO UPDATE SET payload=excluded.payload`,[...identity,JSON.stringify(entries)]);
  const cursor=BigInt(w.proof_cursor)+BigInt(leaves.length);
  if(cursor<BigInt(manifest.entryCount)){await c.query(`UPDATE ${s}.holder_snapshot_work SET proof_cursor=$7 WHERE ${ledgerWhere}`,[...k,String(cursor)]);return null;}
  const indexed=(await c.query<{n:string}>(`SELECT count(*)::text n FROM ${s}.holder_reward_wallet_proofs WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4 AND round=$5 AND data_hash=$6`,identity)).rows[0]!.n;if(indexed!==manifest.entryCount)throw Error('snapshot proof index incomplete');
  const {exclusions,...headerInput}=i;
  const header=await c.query(`UPDATE ${s}.holder_reward_datasets SET verified_header=$7 WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4 AND round=$5 AND data_hash=$6 AND payload=$8`,[...identity,{input:headerInput,root:manifest.root,dataHash:manifest.dataHash,quoteBudget:manifest.quoteBudget,memeBudget:manifest.memeBudget,entryCount:manifest.entryCount},manifest]);
  if(header.rowCount!==1)throw Error('snapshot dataset changed before publication');
  await c.query(`INSERT INTO ${s}.holder_snapshot_evidence(environment,chain_id,deployment_digest,market_id,round,data_hash,generation,block_hash,artifact_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,[...identity,String(o.generation),i.snapshotBlockHash,createHash('sha256').update(canonicalSnapshotJson(manifest)).digest('hex')]);
  await c.query(`UPDATE ${s}.holder_snapshot_work SET phase='complete',proof_cursor=$7 WHERE ${ledgerWhere}`,[...k,String(cursor)]);return manifest;
 });
}
export async function prepareShardedSnapshot(o:SnapshotOptions&{marketId:Hex;blockNumber:bigint},maxSteps=20):Promise<SnapshotManifest>{
 if(!Number.isInteger(maxSteps)||maxSteps<1||maxSteps>1000)throw Error('invalid snapshot work budget');
 const work=await snapshotPreparationContext(o);
 for(let n=0;n<maxSteps;n++){if(!await advanceSnapshotLedger(work))continue;const result=await advanceShardedTree(work);if(result)return result;}
 throw new SnapshotPreparationPending('durable-work',work.context.snapshotBlock);
}
