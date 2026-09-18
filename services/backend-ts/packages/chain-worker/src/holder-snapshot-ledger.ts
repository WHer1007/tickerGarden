import type {Address,Hex,Abi} from 'viem';
import {transaction} from '../../db/src/index.ts';
import {deserializeRpcLog,consensusBlock} from '../../chain/src/index.ts';
import {decodeF72Event} from '../../events/src/index.ts';
import {snapshotAbis} from '../../events/src/f72-abis.generated.ts';
import {snapshotRead,snapshotSchema,snapshotIdentity,type SnapshotOptions} from './holder-snapshots.ts';
import {canonicalSnapshotJson,type SnapshotInput} from '../../chain/src/holder-snapshot.ts';
export class SnapshotPreparationPending extends Error {phase:string;progress:string;constructor(phase:string,progress:string){super(`Snapshot preparation pending: ${phase} ${progress}`);this.phase=phase;this.progress=progress;}}
export type SnapshotContext=Omit<SnapshotInput,'balances'>;
export type LedgerOptions=SnapshotOptions & {context:SnapshotContext;generation:bigint};
export const workKey=(o:LedgerOptions)=>[...snapshotIdentity(o.deployment),o.context.marketId,o.context.snapshotBlockHash,o.generation.toString()];
export async function assertLedgerAnchor(o:LedgerOptions,client:import('pg').PoolClient){
 const s=snapshotSchema(o.schemaName),i=o.context;
 const rows=await client.query(`SELECT 1 FROM ${s}.chain_blocks b JOIN ${s}.ingestion_checkpoints c USING(environment,chain_id,deployment_digest) WHERE b.environment=$1 AND b.chain_id=$2 AND b.deployment_digest=$3 AND b.hash=$4 AND b.number=$5 AND b.canonical AND b.finalized AND c.stream='frontend-events' AND c.generation=$6 AND c.next_block>$5 FOR SHARE`,[...snapshotIdentity(o.deployment),i.snapshotBlockHash,i.snapshotBlock,String(o.generation)]);
 if(!rows.rowCount)throw Error('snapshot generation or anchor changed');
}
export async function ledgerTransaction<T>(o:LedgerOptions,fn:(c:import('pg').PoolClient)=>Promise<T>){return transaction(o.pool,async c=>{await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`snapshot-work:${workKey(o).join(':')}`]);await assertLedgerAnchor(o,c);return fn(c);});}
const where='environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4 AND block_hash=$5 AND generation=$6';
export {where as ledgerWhere};
/** One bounded copy/replay/verification unit. A retry uses durable cursors, never a partial balance map. */
export async function advanceSnapshotLedger(o:LedgerOptions,pageSize=500):Promise<boolean>{
 if(!Number.isInteger(pageSize)||pageSize<1||pageSize>1000)throw Error('invalid snapshot page size');
 const s=snapshotSchema(o.schemaName),k=workKey(o),i=o.context;
 const state=await ledgerTransaction(o,async c=>{
  let w=(await c.query<any>(`SELECT * FROM ${s}.holder_snapshot_work WHERE ${where}`,k)).rows[0];
  if(!w){
   const base=(await c.query<any>(`SELECT w.block_hash,w.block_number FROM ${s}.holder_snapshot_work w JOIN ${s}.chain_blocks b ON b.environment=w.environment AND b.chain_id=w.chain_id AND b.deployment_digest=w.deployment_digest AND b.hash=w.block_hash WHERE w.environment=$1 AND w.chain_id=$2 AND w.deployment_digest=$3 AND w.market_id=$4 AND w.generation=$5 AND w.phase IN ('balances-ready','leaves','tree','proofs','complete') AND w.block_number<$6 AND b.canonical AND b.finalized ORDER BY w.block_number DESC LIMIT 1`,[...k.slice(0,4),String(o.generation),i.snapshotBlock])).rows[0];
   await c.query(`INSERT INTO ${s}.holder_snapshot_work(environment,chain_id,deployment_digest,market_id,block_hash,generation,block_number,context,phase,minted,after_block,after_tx,after_log,base_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13)`,[...k,i.snapshotBlock,i,base?'copy':'replay',!!base,base?.block_number??'-1',base?'9223372036854775807':'-1',base?.block_hash??null]);
   w=(await c.query<any>(`SELECT * FROM ${s}.holder_snapshot_work WHERE ${where}`,k)).rows[0];
  }
  if(canonicalSnapshotJson(w.context)!==canonicalSnapshotJson(i))throw Error('snapshot work context conflict');
  if(w.phase==='copy'){
   // A source candidate is reusable only while its original anchor is canonical.
   const base=await c.query(`SELECT 1 FROM ${s}.chain_blocks WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND hash=$4 AND canonical AND finalized`,[...k.slice(0,3),w.base_hash]);if(!base.rowCount)throw Error('snapshot base orphaned');
   const rows=(await c.query<{account:string;balance:string}>(`SELECT account,balance::text FROM ${s}.holder_snapshot_balances WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4 AND block_hash=$5 AND generation=$6 AND account>$7 ORDER BY account LIMIT $8`,[...k.slice(0,4),w.base_hash,k[5],w.copy_cursor,pageSize])).rows;
   if(rows.length)await c.query(`INSERT INTO ${s}.holder_snapshot_balances SELECT $1,$2,$3,$4,$5,$6,r.account,r.balance::numeric,true FROM jsonb_to_recordset($7) r(account text,balance text)`,[...k,JSON.stringify(rows)]);
   await c.query(`UPDATE ${s}.holder_snapshot_work SET copy_cursor=$7,phase=$8 WHERE ${where}`,[...k,rows.at(-1)?.account??w.copy_cursor,rows.length<pageSize?'replay':'copy']);return {phase:'copy',cursor:rows.at(-1)?.account??''};
  }
  if(w.phase==='replay'){
   const logs=(await c.query<any>(`SELECT l.payload,b.number::text block,l.transaction_index::text tx,l.log_index::text log FROM ${s}.chain_logs l JOIN ${s}.chain_blocks b ON b.environment=l.environment AND b.chain_id=l.chain_id AND b.deployment_digest=l.deployment_digest AND b.hash=l.block_hash WHERE l.environment=$1 AND l.chain_id=$2 AND l.deployment_digest=$3 AND l.address=$4 AND l.canonical AND b.canonical AND b.finalized AND b.number<=$5 AND (b.number,l.transaction_index,l.log_index)>($6,$7,$8) ORDER BY b.number,l.transaction_index,l.log_index LIMIT $9`,[...k.slice(0,3),i.token,i.snapshotBlock,w.after_block,w.after_tx,w.after_log,pageSize])).rows;
   const events=logs.map(row=>{const e=decodeF72Event('TickerMemeTokenV1',deserializeRpcLog(row.payload));if(!e)throw Error('unknown snapshot token event');return e;}).filter(e=>e.eventName==='Transfer');
   const accounts=[...new Set(events.flatMap(e=>[String(e.args.from).toLowerCase(),String(e.args.to).toLowerCase()]).filter(a=>!/^0x0+$/.test(a)))];
   const balances=new Map((await c.query<{account:string;balance:string}>(`SELECT account,balance::text FROM ${s}.holder_snapshot_balances WHERE ${where} AND account=ANY($7)`,[...k,accounts])).rows.map(r=>[r.account,BigInt(r.balance)]));
   let minted=w.minted;
   for(const e of events){const from=String(e.args.from).toLowerCase(),to=String(e.args.to).toLowerCase(),amount=BigInt(String(e.args.value));
    if(/^0x0+$/.test(from)){if(minted)throw Error('unexpected snapshot mint');minted=true;}else{const balance=balances.get(from)??0n;if(balance<amount)throw Error('snapshot transfer history underflow');balances.set(from,balance-amount);}
    if(!/^0x0+$/.test(to))balances.set(to,(balances.get(to)??0n)+amount);
   }
   if(balances.size)await c.query(`INSERT INTO ${s}.holder_snapshot_balances SELECT $1,$2,$3,$4,$5,$6,r.account,r.balance::numeric,false FROM jsonb_to_recordset($7) r(account text,balance text) ON CONFLICT(environment,chain_id,deployment_digest,market_id,block_hash,generation,account) DO UPDATE SET balance=excluded.balance,verified=false`,[...k,JSON.stringify([...balances].map(([account,balance])=>({account,balance:String(balance)})))]);
   const last=logs.at(-1);await c.query(`UPDATE ${s}.holder_snapshot_work SET minted=$7,after_block=$8,after_tx=$9,after_log=$10,phase=$11 WHERE ${where}`,[...k,minted,last?.block??w.after_block,last?.tx??w.after_tx,last?.log??w.after_log,logs.length<pageSize?'verify':'replay']);
   return {phase:'replay',cursor:last?.block??''};
  }
  return w;
 });
 if(['copy','replay'].includes(state.phase))return false;
 if(state.phase!=='verify')return true;
 const rows=(await o.pool.query<{account:Address;balance:string}>(`SELECT account,balance::text FROM ${s}.holder_snapshot_balances WHERE ${where} AND NOT verified ORDER BY account LIMIT $7`,[...k,pageSize])).rows;
 for(let n=0;n<rows.length;n+=8)await Promise.all(rows.slice(n,n+8).map(async r=>{if(String(await snapshotRead(o,BigInt(i.snapshotBlock),i.token,snapshotAbis.TickerMemeTokenV1 as Abi,'balanceOf',[r.account]))!==r.balance)throw Error('snapshot wallet balance disagreement');}));
 if((await consensusBlock(o.primary,o.secondary,BigInt(i.snapshotBlock))).hash!==i.snapshotBlockHash)throw Error('snapshot anchor changed');
 return ledgerTransaction(o,async c=>{
  await c.query(`UPDATE ${s}.holder_snapshot_balances SET verified=true WHERE ${where} AND account=ANY($7)`,[...k,rows.map(r=>r.account)]);
  const pending=await c.query(`SELECT 1 FROM ${s}.holder_snapshot_balances WHERE ${where} AND NOT verified LIMIT 1`,k);
  if(pending.rowCount)return false;
  const check=(await c.query<{total:string}>(`SELECT coalesce(sum(balance),0)::text total FROM ${s}.holder_snapshot_balances WHERE ${where}`,k)).rows[0]!;
  if(check.total!==i.totalSupply||!state.minted)throw Error('snapshot supply mismatch');
  await c.query(`UPDATE ${s}.holder_snapshot_work SET phase='balances-ready' WHERE ${where} AND phase='verify'`,k);return true;
 });
}
