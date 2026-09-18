import type {TransactionStage} from '../v1/transaction.ts';
export function stakeProgress(stage:TransactionStage):{label:string;message:string}{
 switch(stage){
  case 'awaiting_approval_signature':return {label:'Approve in wallet…',message:'Approve Stock access in your wallet.'};
  case 'approval_submitted':return {label:'Approving…',message:'Waiting for approval confirmation.'};
  case 'approval_confirmed':return {label:'Preparing stake…',message:'Approval confirmed. Preparing your stake.'};
  case 'awaiting_signature':return {label:'Confirm in wallet…',message:'Confirm your stake in your wallet.'};
  case 'submitted':case 'pending':case 'replaced':case 'confirming':return {label:'Confirming stake…',message:'Waiting for network confirmation.'};
  case 'confirmed':return {label:'Updating balances…',message:'Stake confirmed. Updating your balances.'};
  case 'unknown':return {label:'Confirming…',message:'Confirmation is pending. Waiting for the transaction result.'};
  case 'failed':return {label:'Stake',message:'Stake was not completed.'};
  default:return {label:'Preparing stake…',message:'Preparing your stake…'};
 }
}
export function stakeLockLabel(allocated:bigint,now:bigint,unlockAt:bigint):string {
 if(allocated===0n)return 'No stake';
 if(now>=unlockAt)return 'Ready to unstake';
 const remaining=unlockAt-now,hours=remaining/3600n,minutes=(remaining%3600n)/60n,seconds=remaining%60n;
 return `Locked · ${hours.toString().padStart(2,'0')}:${minutes.toString().padStart(2,'0')}:${seconds.toString().padStart(2,'0')} remaining`;
}

/** The browser clock schedules a read; only an observed chain timestamp enables an exit. */
export function stakeUnlockDisplay(allocated:bigint,chainNow:bigint,unlockAt:bigint,elapsed:bigint){
 const needsVerification=allocated>0n&&chainNow<unlockAt&&chainNow+(elapsed>0n?elapsed:0n)>=unlockAt;
 return {needsVerification,label:needsVerification?'Checking unlock…':stakeLockLabel(allocated,chainNow+(elapsed>0n?elapsed:0n),unlockAt)};
}
