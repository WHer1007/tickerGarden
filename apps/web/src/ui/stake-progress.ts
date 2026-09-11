import type {TransactionStage} from '../v1/transaction.ts';
export function stakeProgress(stage:TransactionStage):{label:string;message:string}{
 switch(stage){
  case 'awaiting_approval_signature':return {label:'Approve In Wallet…',message:'Approve Stock Access In Your Wallet.'};
  case 'approval_submitted':return {label:'Approving…',message:'Waiting For Approval Confirmation.'};
  case 'approval_confirmed':return {label:'Preparing Stake…',message:'Approval Confirmed. Preparing Your Stake.'};
  case 'awaiting_signature':return {label:'Confirm In Wallet…',message:'Confirm Your Stake In Your Wallet.'};
  case 'submitted':case 'pending':case 'replaced':case 'confirming':return {label:'Confirming Stake…',message:'Waiting For Network Confirmation.'};
  case 'confirmed':return {label:'Updating Balances…',message:'Stake Confirmed. Updating Your Balances.'};
  case 'unknown':return {label:'Check Transaction',message:'Confirmation Is Pending. Check Your Wallet Before Trying Again.'};
  case 'failed':return {label:'Stake',message:'Stake Was Not Completed.'};
  default:return {label:'Preparing Stake…',message:'Preparing Your Stake…'};
 }
}
export function stakeLockLabel(allocated:bigint,now:bigint,unlockAt:bigint):string {
 if(allocated===0n)return 'No Active Stake';
 if(now>=unlockAt)return 'Available To Withdraw';
 const remaining=unlockAt-now,hours=remaining/3600n,minutes=(remaining%3600n)/60n,seconds=remaining%60n;
 return `Unlocks In ${hours.toString().padStart(2,'0')}:${minutes.toString().padStart(2,'0')}:${seconds.toString().padStart(2,'0')}`;
}
