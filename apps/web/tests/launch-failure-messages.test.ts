import test from 'node:test';
import assert from 'node:assert/strict';
import {launchErrorCode,launchFailureMessage,recordLaunchFailure,type LaunchOperation} from '../src/create/launch-diagnostics.ts';
import {type LaunchState} from '../src/create/launch-state.ts';

const base:LaunchState={version:1,id:'audit',chainId:4663,account:`0x${'11'.repeat(20)}`,phase:'failed',failedFrom:'preparing',detail:'stopped'};
function storage(){const values=new Map<string,string>();return {values,getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};}

const copyCases:Array<{name:string;code:string;phase:LaunchState['phase'];pending?:boolean;includes:string;excludes?:string}>= [
 {name:'unknown pending outcome says the app checks automatically',code:'unexpected_error',phase:'pending',pending:true,includes:'checking the transaction automatically',excludes:'wallet history'},
 {name:'pending outcome takes precedence over a retry-specific error',code:'purchase_cost_changed',phase:'pending',pending:true,includes:'Wait for the result',excludes:'10% allowance'},
 {name:'changed network or account gives a corrective next step',code:'wrong_account',phase:'wallet',includes:'account or network changed'},
 {name:'approval revert says launch was not submitted',code:'approval_reverted',phase:'approval',includes:'launch was not submitted'},
 {name:'launch revert distinguishes onchain failure and keeps earlier assets',code:'transaction_reverted',phase:'failed',includes:'Earlier purchases or approvals remain'},
 {name:'cancelled launch distinguishes cancellation',code:'replacement_cancelled',phase:'failed',includes:'transaction was cancelled'},
 {name:'confirmed paired purchase resumes from the updated wallet balance',code:'purchase_checked',phase:'preparing',includes:'continue with your updated wallet balance'},
 {name:'simulation failure says no transaction was submitted',code:'simulation_failed',phase:'preparing',includes:'it was not submitted'},
 {name:'funding route failure offers add-asset or later retry',code:'purchase_route_unavailable',phase:'preparing',includes:'add that asset to your wallet'},
 {name:'upload authorization identifies publishing signature',code:'upload_authorization_failed',phase:'publishing',includes:'publishing request'},
 {name:'upload session tells user to retry publishing',code:'upload_session_invalid',phase:'publishing',includes:'session expired'},
 {name:'upload limit suggests waiting before retry',code:'upload_limit',phase:'publishing',includes:'Wait a little'},
 {name:'upload network failure points to connection',code:'publishing_failed',phase:'publishing',includes:'Check your connection'},
 {name:'raw network error during publishing points to retry publishing',code:'connection_failed',phase:'publishing',includes:'retry publishing'},
 {name:'purchase cost change preserves the existing ten percent cap',code:'purchase_cost_changed',phase:'preparing',includes:'10% allowance'},
 {name:'expired quote requests refresh before retry',code:'stale_quote',phase:'preparing',includes:'refresh the quote'},
 {name:'wallet rejection accounts for completed earlier steps',code:'user_rejected',phase:'wallet',includes:'earlier completed purchase or approval'},
 {name:'insufficient funds points to balance and total',code:'insufficient_funds',phase:'preparing',includes:'updated total'},
 {name:'indexer unavailable before submission does not imply a token was created',code:'indexer_unavailable',phase:'preparing',includes:'launch preparation could not finish',excludes:'created'},
 {name:'connection failure points to network and retry',code:'connection_failed',phase:'preparing',includes:'network connection'},
];
for(const c of copyCases)test(`launch failure copy: ${c.name}`,()=>{
 const message=launchFailureMessage(c.code,c.phase,c.pending??false);
 assert.ok(message.includes(c.includes),`expected ${JSON.stringify(message)} to include ${JSON.stringify(c.includes)}`);
 if(c.excludes)assert.ok(!message.includes(c.excludes),`did not expect ${JSON.stringify(message)} to include ${JSON.stringify(c.excludes)}`);
});

test('classifies representative nested wallet, funding and network failures',()=>{
 assert.equal(launchErrorCode({cause:{cause:{code:4001}}}),'user_rejected');
 assert.equal(launchErrorCode({cause:{message:'Insufficient funds for gas'}}),'insufficient_funds');
 assert.equal(launchErrorCode({message:'HTTP request failed',cause:new Error('secret endpoint')}),'connection_failed');
 assert.equal(launchErrorCode(new Error('unclassified extreme failure')),'unexpected_error');
});

test('diagnostic history caps at twenty entries and storage failures do not replace the original outcome',async()=>{
 const s=storage();
 for(let i=0;i<25;i++)await recordLaunchFailure(s,base,'preview_launch',new Error(`case ${i}`),false);
 const saved=JSON.parse(s.getItem('tickergarden:launch-diagnostics:4663')!) as unknown[];
 assert.equal(saved.length,20);
 assert.deepEqual({first:(saved[0] as {fingerprint:string}).fingerprint,last:(saved[19] as {fingerprint:string}).fingerprint}, {
  first:(await recordLaunchFailure(storage(),base,'preview_launch',new Error('case 5'),false)).fingerprint,
  last:(await recordLaunchFailure(storage(),base,'preview_launch',new Error('case 24'),false)).fingerprint,
 });
 const blocked={getItem(){throw Error('quota/read failure');},setItem(){throw Error('quota/write failure');}};
 const result=await recordLaunchFailure(blocked,base,'submit_launch',new Error('safe error'),false);
 assert.equal(result.code,'unexpected_error');
});

test('nested error classification stops at the supported cause depth',()=>{
 let root:Record<string,unknown>={code:'stale_quote'};
 for(let i=0;i<5;i++)root={cause:root};
 assert.equal(launchErrorCode(root),'unexpected_error');
});

test('pending guidance is automatic and avoids manual tracking instructions',()=>{
 const shown=launchFailureMessage('unexpected_error','pending',true);
 assert.match(shown,/checking the transaction automatically/);
 assert.doesNotMatch(shown,/wallet history|explorer|keep tracking/i);
});
