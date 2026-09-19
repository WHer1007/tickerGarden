import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForWalletSubmission} from '../src/v1/walletSubmission.ts';
import {publicError} from '../src/ui/public-error.ts';
test('wallet result before deadline continues once',async()=>{
 let late=0;assert.equal(await waitForWalletSubmission(Promise.resolve('hash'),()=>{late++;},10),'hash');assert.equal(late,0);
});
test('wallet cancellation is immediate, not an unverified transaction',async()=>{
 const cancelled=Object.assign(Error('cancelled'),{code:4001});
 await assert.rejects(waitForWalletSubmission(Promise.reject(cancelled),()=>assert.fail(),10),e=>e===cancelled);
});
test('absent wallet response times out and a late hash never resumes the expired operation',async()=>{
 let resolve!:(hash:string)=>void;let continued=0;const late:string[]=[];
 const pending=waitForWalletSubmission(new Promise<string>(r=>{resolve=r;}),h=>late.push(h),5).then(()=>{continued++;});
 await assert.rejects(pending,{code:'wallet_response_timeout'});
 resolve('late-hash');await Promise.resolve();await Promise.resolve();
 assert.equal(continued,0);assert.deepEqual(late,['late-hash']);
});
test('late rejection is handled after timeout',async()=>{
 let reject!:(e:Error)=>void;
 const pending=waitForWalletSubmission(new Promise<never>((_,r)=>{reject=r;}),()=>assert.fail(),5);
 await assert.rejects(pending,{code:'wallet_response_timeout'});reject(Error('late rejection'));await Promise.resolve();
});
test('wallet timeout notice permits retry without claiming an on-chain revert',()=>{
 const notice=publicError({code:'wallet_response_timeout'},'transaction');
 assert.match(notice,/20 seconds/);assert.match(notice,/may still complete/);assert.doesNotMatch(notice,/history|reverted/);
});
