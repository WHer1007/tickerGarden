import test from 'node:test';
import assert from 'node:assert/strict';
import {keccak256,toHex} from 'viem';
import {stakeErrorMessage} from '../src/ui/stake-error.ts';
test('principal deficit gives a concrete reason without promising withdrawal safety',()=>{
 assert.match(stakeErrorMessage('execution reverted StockPrincipalDeficit',false),/principal shortfall.*New deposits are blocked/);
 assert.match(stakeErrorMessage(keccak256(toHex('StockPrincipalDeficit(bytes32,uint256,uint256)')).slice(0,10),false),/principal shortfall/);
});

test('maps common stake failures to concise, actionable messages',()=>{
 assert.match(stakeErrorMessage('rejected',false),/request was declined/i);
 assert.match(stakeErrorMessage({code:'user_rejected',cause:{message:'wallet denied'}},false),/declined/i);
 assert.match(stakeErrorMessage('Insufficient Stock balance',false),/Stock balance is too low/i);
 assert.match(stakeErrorMessage('Insufficient funds for gas',false),/network fee/i);
 assert.match(stakeErrorMessage('Resulting stake is below the market minimum',false),/minimum allocation/i);
 assert.match(stakeErrorMessage('AllocationLocked',false),/locked/i);
 assert.match(stakeErrorMessage({code:'pending_transaction'},false),/earlier stake transaction.*reconciled/i);
});

test('distinguishes a reverted transaction from an uncertain RPC or readback result',()=>{
 assert.match(stakeErrorMessage({code:'transaction_reverted'},false),/reverted.*No stake was added/i);
 assert.match(stakeErrorMessage({code:'receipt_timeout'},false),/could not be verified.*uncertain/i);
 assert.match(stakeErrorMessage(new Error('RPC readback timed out'),false),/Could not refresh.*try again/i);
 assert.match(stakeErrorMessage('Stake exceeds your wallet STOCK balance',false),/Stock balance is too low/i);
 assert.match(stakeErrorMessage({cause:{data:{errorName:'RageQuitRewardSettlementPending'}}},false),/cleanup for this market/i);
});

test('pending status always communicates confirmation without wallet instructions or retry advice',()=>{
 for(const error of ['StockPrincipalDeficit','rejected',{code:'pending_transaction'}]){
  const message=stakeErrorMessage(error,true);
  assert.match(message,/awaiting confirmation/i);
  assert.doesNotMatch(message,/wallet|retry|try again|submit/i);
 }
});

 test('withdrawal and cleanup notices never ask for a trading quote',async()=>{
 const {positionActionError}=await import('../src/ui/stake-error.ts');
 assert.match(positionActionError({code:'transaction_reverted'},'unstakeAndWithdraw'),/Withdrawal failed on-chain/);
 assert.match(positionActionError({code:4001},'settleRageQuitRewards'),/Reward cleanup cancelled/);
 assert.match(positionActionError({code:'wallet_response_timeout'},'rageQuit'),/checking automatically/);
 assert.doesNotMatch(positionActionError({code:'simulation_failed'},'rageQuit'),/trade|quote|history/);
 });
