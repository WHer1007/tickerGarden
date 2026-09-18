import test from 'node:test';
import assert from 'node:assert/strict';
import {savedLaunchTransaction,clearVerifiedLaunchTransaction,recoveryRead,recoveryWrite,recoveryRemove} from '../src/v1/recoveryStorage.ts';
import {failedLaunchState,type LaunchState} from '../src/create/launch-state.ts';
const account=`0x${'1'.repeat(40)}`,hash=`0x${'a'.repeat(64)}`,other=`0x${'b'.repeat(64)}`;
function storage(){const values=new Map<string,string>();return {getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);}};}
test('v2 launch recovery preserves unrelated trades and approvals',()=>{
 const s=storage(),key=`tickergarden:pending:v2:4663:${account}`;
 const keep=[{intent:'trade',hash:other,approval:false},{intent:'launch',hash:other,approval:true}];
 s.setItem(key,JSON.stringify({version:2,records:[...keep,{intent:'launch',hash,approval:false}]}));
 assert.equal(savedLaunchTransaction(s,4663,account,'launch')?.hash,hash);
 clearVerifiedLaunchTransaction(s,4663,account,'launch',other);assert.equal(JSON.parse(s.getItem(key)!).records.length,3);
 clearVerifiedLaunchTransaction(s,4663,account,'launch',hash);assert.deepEqual(JSON.parse(s.getItem(key)!).records,keep);
});
test('legacy records remain recoverable and only verified matching hash is cleared',()=>{
 const s=storage(),key=`tickergarden:pending:4663:${account}`;s.setItem(key,JSON.stringify({intent:'launch',hash,approval:false}));
 assert.equal(savedLaunchTransaction(s,4663,account,'launch')?.hash,hash);
 clearVerifiedLaunchTransaction(s,4663,account,'launch',hash);assert.equal(s.getItem(key),null);
});
test('failed writes and deletes retain the latest state for the active page',()=>{
 const s=storage();s.setItem('key','old');s.setItem=()=>{throw Error('quota');};s.removeItem=()=>{throw Error('denied');};
 recoveryWrite(s,'key','submitted');assert.equal(recoveryRead(s,'key'),'submitted');recoveryRemove(s,'key');assert.equal(recoveryRead(s,'key'),null);
});
test('verified terminal receipt replaces stale pending diagnostic',()=>{
 const state={version:1,id:'a',chainId:4663,account,phase:'paused',detail:'pending',diagnostic:{code:'receipt_timeout',transactionMayBePending:true}} as LaunchState;
 for(const code of ['transaction_reverted','replacement_cancelled'] as const){const next=failedLaunchState(state,code);assert.equal(next.phase,'failed');assert.equal(next.diagnostic?.code,code);assert.equal(next.diagnostic?.transactionMayBePending,false);assert.match(next.detail,/No token was created/);}
});
