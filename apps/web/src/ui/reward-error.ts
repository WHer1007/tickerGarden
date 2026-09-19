export class RewardClaimError extends Error {
 readonly code:string;
 constructor(code:string,message:string){super(message);this.code=code;this.name='RewardClaimError';}
}
export function rewardErrorNotice(error:unknown):{message:string;tone:'warning'|'error'|'info';refresh:boolean}{
 const codes=new Set<string>(),messages:string[]=[];let current=error;
 for(let i=0;i<8&&current&&typeof current==='object';i++){
  const e=current as {code?:unknown;name?:string;message?:string;cause?:unknown;data?:{errorName?:string}};
  if(e.code!==undefined)codes.add(String(e.code));if(e.name)codes.add(e.name);
  if(e.message)messages.push(e.message);if(e.data?.errorName)messages.push(e.data.errorName);current=e.cause;
 }
 const text=messages.join(' '),has=(...values:string[])=>values.some(v=>codes.has(v));
 const result=(message:string,tone:'warning'|'error'|'info'='warning',refresh=false)=>({message,tone,refresh});
 if(has('receipt_timeout','confirmation_failed','pending_transaction','WaitForTransactionReceiptTimeoutError','TransactionReceiptNotFoundError'))return result('Your claim outcome is not yet verified. We are checking automatically. Please wait before submitting another claim.');
 if(has('user_rejected','4001','UserRejectedRequestError','replacement_cancelled'))return result('Claim cancelled.', 'info',true);
 if(has('transaction_reverted','approval_reverted'))return result('This claim failed on-chain. Your reward status is being refreshed. Review it before trying again.','error',true);
 if(has('no_rewards')||/No rewards available|No unclaimed assets|No Creator Rewards For This Wallet/i.test(text))return result('No rewards are available to claim for this selection.','info',true);
 if(has('already_claimed')||/\bAlreadyClaimed\b/.test(text))return result('These rewards have already been claimed. Your reward status is being refreshed.','info',true);
 if(has('reward_root_changed'))return result('Claim not submitted. This reward round has changed. Refresh the round before claiming.','warning',true);
 if(has('reward_funds_unavailable')||/\bBudgetExceeded\b|\bInsolvent\b/.test(text))return result('Claim not submitted. This round does not currently have enough funds. Please try again later.');
 if(has('reward_proof_invalid')||/snapshot proof|proof does not match root|Invalid snapshot commitment/i.test(text))return result('Claim not submitted. The reward proof could not be verified. Refresh the round; if the issue persists, contact support.');
 if(/\bInvalidClaim\b/.test(text))return result('Claim not submitted. This reward entitlement could not be verified. Refresh the round; if the issue persists, contact support.');
 if(has('unsupported_chain'))return result('Claim not submitted. Switch your wallet to Robinhood Chain and try again.');
 if(has('wrong_account')||/Wallet.*changed|reward selection changed/i.test(text))return result('Claim not submitted. Reconnect the correct wallet and select your rewards again.');
 if(/AllocationLocked|PositionLocked|timelock|still locked/i.test(text))return result('Claim not submitted. Rewards can be claimed after your staking lock ends.');
 if(/RageQuitSettlementPending|reward cleanup|pending cleanup/i.test(text))return result('Claim not submitted. Reward cleanup after your emergency exit must finish first. Please try again later.');
 if(has('submission_failed'))return result('The wallet could not confirm submission of your claim. Its outcome is not yet verified.');
 if(/insufficient funds|insufficient.*gas|exceeds.*balance/i.test(text))return result('Claim not submitted. Add enough ETH to cover the network fee, then try again.');
 if(has('simulation_failed'))return result('Claim not submitted. The current reward state could not be validated. Refresh your rewards before trying again.','warning',true);
 return result('Claim not submitted. Your rewards could not be verified. Refresh them and try again.');
}
