import {keccak256,toHex} from 'viem';
const deficitSelector=keccak256(toHex('StockPrincipalDeficit(bytes32,uint256,uint256)')).slice(0,10);
type ErrorShape={data?:{errorName?:unknown};message?:unknown;code?:unknown;name?:unknown;cause?:unknown};
function errorInfo(error:unknown):{message:string;codes:Set<string>} {
  const messages:string[]=[];const codes=new Set<string>();let current:unknown=error;
  for(let depth=0;depth<6&&current&&typeof current==='object';depth++){
    const entry=current as ErrorShape;
    if(typeof entry.message==='string')messages.push(entry.message);
    if(typeof entry.data?.errorName==='string')messages.push(entry.data.errorName);
    if(typeof entry.code==='string'||typeof entry.code==='number')codes.add(String(entry.code).toLowerCase());
    if(typeof entry.name==='string')codes.add(entry.name.toLowerCase());
    current=entry.cause;
  }
  if(typeof error==='string')messages.push(error);
  return {message:messages.join(' '),codes};
}
export function stakeErrorMessage(error:unknown,pending:boolean):string {
  if(pending)return 'Your stake transaction is still awaiting confirmation.';
  const {message,codes}=errorInfo(error);const lower=message.toLowerCase();
  if(codes.has('user_rejected')||codes.has('4001')||codes.has('userrejectedrequesterror')||/reject|denied|cancel/i.test(message))return 'The stake request was declined.';
  if(/StockPrincipalDeficit/i.test(message)||lower.includes(deficitSelector))return 'This Stock Vault has a principal shortfall. New deposits are blocked until the shortfall is resolved.';
  if(/settlement.*pending|pending.*settlement|reward cleanup|pending cleanup|RageQuitSettlementPending/i.test(message))return 'Your principal was returned. Reward cleanup for this market must finish before staking again or claiming rewards.';
  if(codes.has('pending_transaction')||/pending transaction|already pending/i.test(message))return 'An earlier stake transaction is still being reconciled. Wait for it to finish before submitting another stake.';
  if(/minimum(?: total)?(?: allocation| stake)?|below the market minimum|resulting stake.*minimum/i.test(message))return 'Your total stake must meet this market’s minimum allocation.';
  if(/\blocked\b|AllocationLocked|PositionLocked|\bunlock(?: time)?\b|timelock/i.test(message))return 'This position is still locked. Withdrawal and reward claims become available after unlocking.';
  if(/insufficient funds for gas|gas required exceeds allowance|base fee exceeds|intrinsic transaction cost/i.test(message))return 'Your wallet balance may not cover the network fee.';
  if(/insufficient.*(balance|funds|stock)|balance.*(too low|insufficient)|exceeds your wallet.*balance/i.test(message))return 'Your available Stock balance is too low for this stake.';
  if(codes.has('transaction_reverted')||codes.has('approval_reverted')||/execution reverted|transaction reverted/i.test(message))return 'The stake transaction reverted. No stake was added.';
  if(['receipt_timeout','confirmation_failed','indexer_lagging','indexer_unavailable'].some(code=>codes.has(code)))return 'The stake result could not be verified yet. Your transaction status is uncertain.';
  if(/readback|read back|rpc|network request|timed? out|timeout|failed to fetch/i.test(message))return 'Could not refresh your stake information. Please try again.';
  return 'Unable to complete the stake. Review the amount and try again.';
}
