import type {TokenDetailFee,UserPositionReadModel,UserActivityRecord} from './generated/read-api.ts';
export function allocatedFeeTotals(fees:readonly TokenDetailFee[]|null):Map<string,bigint>|null {
  if(fees===null)return null;
  const totals=new Map<string,bigint>();
  for(const row of fees){if(!/^(0|[1-9][0-9]*)$/.test(row.amountRaw))throw Error('Invalid fee amount');totals.set(row.asset,(totals.get(row.asset)??0n)+BigInt(row.amountRaw));}
  return totals;
}
export function validateStakePositions(rows:readonly UserPositionReadModel[],account:string,chain:number):readonly UserPositionReadModel[]{
  if(!Array.isArray(rows)||rows.length>100)throw Error('Position list unavailable');
  const seen=new Set<string>();
  for(const p of rows){if(p.user!==account||p.source.chainId!==chain||!/^0x[0-9a-f]{64}$/.test(p.marketId)||!/^0x[0-9a-f]{64}$/.test(p.assetUid)||seen.has(p.marketId))throw Error('Position identity mismatch');
    for(const v of [p.allocated,p.active,p.pending])if(!/^(0|[1-9][0-9]{0,77})$/.test(v))throw Error('Position amount invalid');
    if(BigInt(p.allocated)!==BigInt(p.active)+BigInt(p.pending))throw Error('Position amount mismatch');seen.add(p.marketId);
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
