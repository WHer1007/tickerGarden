import test from 'node:test';
import assert from 'node:assert/strict';
import {launchErrorCode,launchFailureMessage,recordLaunchFailure} from '../src/create/launch-diagnostics.ts';
import {readLaunchState,saveLaunchState,type LaunchState} from '../src/create/launch-state.ts';
const state:LaunchState={version:1,id:'one',chainId:4663,account:`0x${'11'.repeat(20)}`,phase:'failed',failedFrom:'preparing',detail:'stopped'};
function store(){const values=new Map<string,string>();return {getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},values};}
test('retains the actual failing phase across reload and classifies quote changes',async()=>{
 const storage=store();const diagnostic=await recordLaunchFailure(storage,state,'review_purchase',Object.assign(new Error('Purchase cost changed.'),{code:'purchase_cost_changed'}),false);
 saveLaunchState(storage,{...state,diagnostic});const restored=readLaunchState(storage,4663)!;
 assert.equal(restored.failedFrom,'preparing');assert.equal(restored.diagnostic?.operation,'review_purchase');assert.equal(diagnostic.code,'purchase_cost_changed');
 assert.match(launchFailureMessage(diagnostic.code,diagnostic.phase,false),/review the updated total/);
});
test('unknown outcomes always take precedence over retry or quote-change advice',()=>{
 for(const code of ['purchase_cost_changed','stale_quote','user_rejected','unexpected_error']){
  const message=launchFailureMessage(code,'wallet',true);assert.match(message,/Do not submit another/);assert.doesNotMatch(message,/No purchase was submitted|try again|confirming again/);
 }
});
test('diagnostics exclude raw messages, signatures, URLs, wallet data and arbitrary error codes',async()=>{
 const storage=store();const secret='https://rpc.example/SECRET?signature=0xdead';
 const error=Object.assign(new Error(secret),{code:secret,cause:new TypeError(secret)});
 const result=await recordLaunchFailure(storage,{...state,data:secret,intent:secret},'publish_details',error,false);
 const serialized=JSON.stringify(result);assert.doesNotMatch(serialized,/SECRET|rpc.example|signature|0xdead/);assert.equal(result.code,'unexpected_error');assert.equal(result.fingerprint.length,16);
 assert.doesNotMatch([...storage.values.values()].join(''),/SECRET/);
});
test('diagnostic history is bounded and storage failure cannot interrupt error handling',async()=>{
 const storage=store();for(let i=0;i<23;i++)await recordLaunchFailure(storage,state,'preview_launch',new Error('oops'),false);
 assert.equal(JSON.parse(storage.getItem('tickergarden:launch-diagnostics:4663')!).length,20);
 const blocked={getItem(){throw Error('denied');},setItem(){throw Error('full');}};
 assert.equal((await recordLaunchFailure(blocked,state,'preview_launch',new Error('oops'),false)).code,'unexpected_error');
});
test('classifies nested errors and does not mistake an upload signature rejection for an onchain transaction',()=>{
 assert.equal(launchErrorCode({cause:{code:4001}}),'user_rejected');
 assert.equal(launchErrorCode(new Error('Invalid publishing response. Retry.')),'publishing_response_invalid');
 assert.match(launchFailureMessage('unexpected_error','publishing',false),/token details/);
});
