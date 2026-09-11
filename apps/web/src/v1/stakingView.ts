import type {TokenDetailFee,UserPositionReadModel,UserActivityRecord} from './generated/read-api.ts';
export function allocatedFeeTotals(fees:readonly TokenDetailFee[]|null):Map<string,bigint>|null {
  if(fees===null)return null;
  const totals=new Map<string,bigint>();
  for(const row of fees){if(!/^(0|[1-9][0-9]*)$/.test(row.amountRaw))throw Error('Invalid fee amount');totals.set(row.asset,(totals.get(row.asset)??0n)+BigInt(row.amountRaw));}
  return totals;
}
export function validateStakePositions(rows:readonly UserPositionReadModel[],account:string,chain:number,previousMarketIds:ReadonlySet<string>=new Set(),snapshot?:Readonly<{blockNumber:string;blockHash:string}>):readonly UserPositionReadModel[]{
  if(!Array.isArray(rows)||rows.length>100)throw Error('Position list unavailable');
  const seen=new Set<string>(previousMarketIds);
  for(const p of rows){if(p.user!==account||p.source.chainId!==chain||!/^0x[0-9a-f]{64}$/.test(p.marketId)||!/^0x[0-9a-f]{64}$/.test(p.assetUid)||seen.has(p.marketId))throw Error('Position identity mismatch');
    for(const v of [p.free,p.allocated,p.active,p.pending])if(!/^(0|[1-9][0-9]{0,77})$/.test(v))throw Error('Position amount invalid');
    if(BigInt(p.allocated)!==BigInt(p.active)+BigInt(p.pending))throw Error('Position amount mismatch');seen.add(p.marketId);
    for(const value of [p.activationAt,p.unlockAt])if(value!==null&&!/^(0|[1-9][0-9]{0,77})$/.test(value))throw Error('Position timestamp invalid');
    if(!Array.isArray(p.claimable)||p.claimable.length!==2||p.claimable[0]?.kind!=='quote'||p.claimable[1]?.kind!=='meme')throw Error('Position claimable unavailable');
    for(const claim of p.claimable)if(!/^0x[0-9a-f]{40}$/.test(claim.asset)||!/^(0|[1-9][0-9]{0,77})$/.test(claim.amount))throw Error('Position claimable invalid');
    const source=p.source;if(!/^(0|[1-9][0-9]{0,77})$/.test(source.blockNumber)||!/^0x[0-9a-f]{64}$/.test(source.blockHash)||!/^0x[0-9a-f]{64}$/.test(source.transactionHash)||!Number.isSafeInteger(source.transactionIndex)||source.transactionIndex<0||!Number.isSafeInteger(source.logIndex)||source.logIndex<0)throw Error('Position source invalid');
    if(snapshot&&(BigInt(source.blockNumber)>BigInt(snapshot.blockNumber)||(source.blockNumber===snapshot.blockNumber&&source.blockHash!==snapshot.blockHash)))throw Error('Position source exceeds snapshot');
  }return rows;
}
/** Display history only: require the actual position owner, not a tx initiator inference. */
export function stakeHistoryEvent(event:UserActivityRecord,account:string):{marketId:string;assetUid:string;exited:boolean}|null{
  if(event.arguments.user!==account)return null;
  const signatures=['AllocationLocked(bytes32,address,bytes32,uint256,uint256,uint256)','AllocationReleased(bytes32,address,bytes32,uint256,uint256,uint256)','AllocationRageQuit(bytes32,address,bytes32,uint256)'];
  if(!signatures.includes(event.signature))return null;
  const marketId=event.arguments.marketId,assetUid=event.arguments.assetUid;
  if(typeof marketId!=='string'||typeof assetUid!=='string'||!/^0x[0-9a-f]{64}$/.test(marketId)||!/^0x[0-9a-f]{64}$/.test(assetUid))return null;
  return {marketId,assetUid,exited:event.signature.startsWith('AllocationRageQuit(')||(event.signature.startsWith('AllocationReleased(')&&event.arguments.userMarketAllocation==='0')};
}
export function stakeAfter(current:bigint,amount:bigint|null):bigint|null{return amount===null?null:current+amount;}

export function stakeShare(allocated:bigint,total:bigint|null):string {
  if(total===null||allocated<0n||total<0n||allocated>total)return '-';
  if(allocated===0n)return '0%';
  const hundredths=allocated*10000n/total;
  if(hundredths===0n)return '<0.01%';
  return `${hundredths/100n}.${(hundredths%100n).toString().padStart(2,'0')}%`;
}
