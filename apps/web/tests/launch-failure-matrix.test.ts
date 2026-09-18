import assert from 'node:assert/strict';
import test from 'node:test';
import {V1TransactionExecutor,type V1TransactionClients,type ExecuteV1Transaction} from '../src/v1/transaction.ts';
import {V1_EXECUTION_SPEC_ID} from '../src/v1/generated/abi-identity.ts';
import {waitForLaunchData} from '../src/create/launch-readiness.ts';
const account=`0x${'1'.repeat(40)}` as const,hash=`0x${'a'.repeat(64)}` as const;
type Mutable<T> = {-readonly [K in keyof T]: T[K]};
type TestClients = {publicClient: Mutable<V1TransactionClients["publicClient"]>; walletClient: Mutable<V1TransactionClients["walletClient"]>};
function harness(){
 let writes=0;const values=new Map<string,string>(),stages:string[]=[];
 const storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);}};
 const api:TestClients={publicClient:{simulateContract:async request=>({request}),waitForTransactionReceipt:async()=>({status:'success',logs:[],transactionHash:hash,blockNumber:10n} as never)},walletClient:{account,chain:{id:4663} as never,writeContract:async()=>{writes++;return hash;}}};
 const input:Mutable<ExecuteV1Transaction<string>>={operationKey:'launch:audit',expectedAccount:account,snapshot:{executionSpecId:V1_EXECUTION_SPEC_ID,revision:'same',syncStatus:'synced'},request:{abi:[],address:account,functionName:'createMarket'},verifyWalletContext:async()=>{},currentRevision:async()=> 'same',confirm:async()=> 'created',onUpdate:u=>stages.push(u.stage)};
 return {api,input,storage,stages,get writes(){return writes;},executor:()=>new V1TransactionExecutor(api,storage)};
}
const cases:Array<[string,string,(h:ReturnType<typeof harness>)=>void]>=[
 ['wrong network','unsupported_chain',h=>{h.api.walletClient.chain={id:1} as never;}],
 ['changed account','wrong_account',h=>{h.api.walletClient.account=`0x${'2'.repeat(40)}`;}],
 ['outdated ABI identity','stale_snapshot',h=>{h.input.snapshot={...h.input.snapshot,executionSpecId:'bad'};}],
 ['expired purchase quote','stale_quote',h=>{h.input.quoteExpiresAtMs=Date.now()-1;}],
 ['changed canonical revision','stale_snapshot',h=>{h.input.currentRevision=async()=> 'changed';}],
 ['wallet disconnect during preflight','wrong_account',h=>{h.input.verifyWalletContext=async()=>{throw Error('disconnected');};}],
 ['contract paused / insufficient funds / invalid settings detected by simulation','simulation_failed',h=>{h.api.publicClient.simulateContract=async()=>{throw Error('execution reverted');};}],
 ['approval simulation reverted','simulation_failed',h=>{h.input.approval={...h.input.request,functionName:'approve'};h.api.publicClient.simulateContract=async()=>{throw Error('approval reverted');};}],
 ['browser storage full before broadcast','submission_failed',h=>{h.storage.setItem=()=>{throw Error('QuotaExceededError');};}],
];
for(const [name,code,configure]of cases)test(`launch fault matrix: ${name} sends no transaction`,async()=>{
 const h=harness();configure(h);await assert.rejects(h.executor().execute(h.input),{code});assert.equal(h.writes,0);
});
test('launch fault matrix: wallet rejection sends no follow-up or pending transaction',async()=>{
 const h=harness();h.api.walletClient.writeContract=async()=>{throw {code:4001};};const executor=h.executor();await assert.rejects(executor.execute(h.input),{code:'user_rejected'});assert.deepEqual(executor.pending(account),[]);
});
for(const approval of [false,true])test(`launch fault matrix: ${approval?'approval':'launch'} mined revert is terminal and clears its pending record`,async()=>{
 const h=harness();if(approval)h.input.approval={...h.input.request,functionName:'approve'};
 h.api.publicClient.waitForTransactionReceipt=async()=>({status:'reverted',transactionHash:hash,logs:[],blockNumber:10n} as never);
 const executor=h.executor();await assert.rejects(executor.execute(h.input),{code:approval?'approval_reverted':'transaction_reverted'});assert.equal(h.writes,1);assert.deepEqual(executor.pending(account),[]);
});
test('launch fault matrix: successful approval followed by failed buy simulation does not submit launch',async()=>{
 const h=harness();h.input.approval={...h.input.request,functionName:'approve'};let simulations=0;
 h.api.publicClient.simulateContract=async request=>{if(++simulations===2)throw Error('balance changed');return {request};};
 await assert.rejects(h.executor().execute(h.input),{code:'simulation_failed'});assert.equal(h.writes,1);
});
test('launch fault matrix: data verification failure after chain success retries only verification',async()=>{
 const h=harness(),executor=h.executor();h.input.confirm=async()=>{throw Error('RPC unavailable');};
 await assert.rejects(executor.execute(h.input),{code:'confirmation_failed'});assert.equal(h.writes,1);assert.equal(executor.pending(account).length,1);
 h.input.confirm=async()=> 'created';assert.equal(await executor.execute(h.input),'created');assert.equal(h.writes,1);
});
test('journal failure after broadcast retains the hash and retries verification without resending',async()=>{
 const h=harness(),original=h.storage.setItem;h.storage.setItem=(k,v)=>{if(h.writes>0)throw Error('quota changed');original(k,v);};
 const executor=h.executor();h.input.confirm=async()=>{throw Error('RPC unavailable');};
 await assert.rejects(executor.execute(h.input),{code:'confirmation_failed'});
 assert.equal(h.writes,1);assert.equal(executor.pending(account).length,1);assert.ok(h.stages.includes('submitted'));
 h.input.confirm=async()=> 'created';assert.equal(await executor.execute(h.input),'created');assert.equal(h.writes,1);assert.equal(executor.pending(account).length,0);
});
test('audit characterization: confirmed launch with unavailable data keeps polling until cancelled',async()=>{
 const original=globalThis.fetch;let reads=0;globalThis.fetch=async()=>{reads++;return new Response('{}',{status:503});};
 const controller=new AbortController();let settled=false;
 try{const pending=waitForLaunchData('https://audit.invalid',hash,account,controller.signal).finally(()=>{settled=true;});await new Promise(r=>setTimeout(r,60));assert.equal(settled,false);assert.equal(reads,2);controller.abort();await assert.rejects(pending,{name:'AbortError'});}finally{globalThis.fetch=original;controller.abort();}
});

test('unavailable launch data has a bounded attempt without declaring transaction failure',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response('{}',{status:503});
 try{await assert.rejects(waitForLaunchData('https://audit.invalid',hash,account,new AbortController().signal,{timeoutMs:30,retryMs:5}),{name:'LaunchDataPendingError'});}finally{globalThis.fetch=original;}
});
