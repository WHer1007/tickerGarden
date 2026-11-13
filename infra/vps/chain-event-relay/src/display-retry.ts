import {parseSubscriptionLog, type EventFilter, type SubscriptionLog} from './core.ts';
/** Restore a sealed durable batch before callback delivery. Never queries a chain. */
export async function replayDisplayBatch(rows: readonly {payload:string}[], filter: EventFilter, persist: (log:SubscriptionLog)=>Promise<void>) {
 if(rows.length===0||rows.length>256)throw Error('Invalid durable display batch size');
 // Validate the entire batch before performing the first write.
 const logs=rows.map(row=>{
  const p=JSON.parse(row.payload);
  if(p.schema!=='tickergarden.chain-log-trigger.v1'||p.chainId!==filter.chainId||p.environment!==filter.environment||p.releaseId!==filter.releaseId)throw Error('Durable display batch identity mismatch');
  const log=p.log;
  const quantity=(v:unknown)=>{if(typeof v!=='string'||! /^(0|[1-9][0-9]*)$/.test(v))throw Error('Invalid durable display quantity');return '0x'+BigInt(v).toString(16);};
  return parseSubscriptionLog({...log,blockNumber:quantity(log.blockNumber),transactionIndex:quantity(log.transactionIndex),logIndex:quantity(log.logIndex)});
 });
 for(const log of logs)await persist(log);
}
