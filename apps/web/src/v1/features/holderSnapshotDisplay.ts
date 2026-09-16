import type {HolderRound,HolderSnapshotPage} from './holderSnapshots.ts';
export function claimableSnapshotAssets(r:HolderRound):number {return (r.quoteAmount>0n?1:0) | (r.memeAmount>0n?2:0);}
export function remainingSnapshotAssets(r:HolderRound):number {return claimableSnapshotAssets(r)&~r.claimedAssets;}
export function holderSnapshotStatus(status:HolderSnapshotPage['status'],round:HolderRound|undefined,writesAvailable:boolean):Readonly<{message:string;tone:'neutral'|'error'}>{
 if(round){
  if(remainingSnapshotAssets(round)===0)return {message:'Rewards from this distribution have already been claimed.',tone:'neutral'};
  return writesAvailable?{message:'',tone:'neutral'}:{message:'Claiming is temporarily unavailable.',tone:'error'};
 }
 const messages:Record<HolderSnapshotPage['status'],string>={
  ready:'No rewards available for this wallet.',
  awaiting_funding:'Your rewards are being prepared.',
  awaiting_publication:'The next reward distribution is being prepared.',
  publisher_unconfigured:'New reward distributions are temporarily unavailable.',
 };
 return {message:messages[status],tone:'neutral'};
}
