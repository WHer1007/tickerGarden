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
