import test from 'node:test';
import assert from 'node:assert/strict';
import {tradeSubmissionError} from '../src/trade/submission-error.ts';
test('pre-wallet failures tell users nothing was submitted and give a next step',()=>{
 for(const error of [Error('Trade changed. Review the current quote.'),Error('quote expired'),Error('Price changed beyond the confirmed conversion minimum.'),{code:'simulation_failed',message:'opaque revert'},{code:'wrong_account'},Error('unknown internal invariant')]){
  const message=tradeSubmissionError(error,false);assert.match(message,/not submitted/);assert.doesNotMatch(message,/transaction history|pending transaction|opaque|invariant/);
 }
 assert.match(tradeSubmissionError(Error('Price changed beyond the confirmed conversion minimum.'),false),/confirmed minimum/);
});
test('wallet writes with unknown outcomes retain duplicate submission protection',()=>{
 assert.match(tradeSubmissionError(Error('request interrupted'),true),/Do not repeat a pending transaction/);
});
test('an earlier pending purchase never encourages a duplicate submission',()=>{
 const message=tradeSubmissionError({code:'pending_transaction'},false);
 assert.match(message,/earlier purchase/);assert.doesNotMatch(message,/try again|not submitted/);
});
test('known wallet outcomes use trade-specific copy without unknown-outcome advice',()=>{
 const cases: Array<[unknown, RegExp]> = [
  [{code:'transaction_reverted'},/trade failed on-chain.*refresh the quote and try again/i],
  [{cause:{code:'approval_reverted'}},/approval failed on-chain.*try again/i],
  [{cause:{cause:{code:'replacement_cancelled'}}},/transaction was cancelled.*try again/i],
  [{cause:{code:'user_rejected'}},/wallet request was declined.*try again/i],
 ];
 for(const [error,expected] of cases){const message=tradeSubmissionError(error,false);assert.match(message,expected);assert.doesNotMatch(message,/unknown|check your wallet transaction history|pending transaction/i);}
});

test('standalone approval timeout is not falsely described as a pre-sign validation failure',()=>{
 assert.match(tradeSubmissionError({code:'wallet_response_timeout'},false),/20 seconds/);
 assert.doesNotMatch(tradeSubmissionError({code:'submission_failed'},false),/trade was not submitted/);
});
