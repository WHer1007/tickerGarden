import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const source=readFileSync(new URL('../src/controllers/trade.ts',import.meta.url),'utf8');
const start=source.indexOf('async function loadPaymentBalance(){');
const end=source.indexOf('\nasync function restoreConversion()',start);
const functionSource=ts.transpile(source.slice(start,end),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext});
const native='0x0000000000000000000000000000000000000001';
const tokenA='0x0000000000000000000000000000000000000002';
const tokenB='0x0000000000000000000000000000000000000003';
const account='0x0000000000000000000000000000000000000004';

function harness(publicClient:any){
 let currentPayment=tokenA;
 const calls={render:0,availability:0,status:[] as string[],reported:[] as unknown[]};
 const ctx:any={wallet:{account},publicClient,text:(_selector:string,message:string)=>calls.status.push(message)};
 const run=new Function('ctx','payment','usesConversion','TRADE_NATIVE','erc20Abi','reportClientError','renderDetailBalances','updateTradeAvailability',`let paymentBalance=null;const paymentBalanceRequests=new Map();${functionSource};return {loadPaymentBalance,getPaymentBalance:()=>paymentBalance,setPaymentBalance:value=>paymentBalance=value};`)(
  ctx,()=>({address:currentPayment}),()=>true,native,[],(error:unknown)=>calls.reported.push(error),()=>calls.render++,()=>calls.availability++
 );
 return {ctx,calls,run:run.loadPaymentBalance,getPaymentBalance:run.getPaymentBalance,setPayment:(address:string)=>{currentPayment=address;},setBalance:(value:unknown)=>{(run as any).setPaymentBalance(value);}};
}

test('payment balance refresh coalesces requests for the same account and token',async()=>{
 let finish!:(value:bigint)=>void;let reads=0;
 const h=harness({readContract:()=>{reads++;return new Promise<bigint>(resolve=>{finish=resolve;});}});
 const first=h.run(),second=h.run();
 assert.equal(reads,1);
 finish(25n);await Promise.all([first,second]);
 assert.deepEqual(h.getPaymentBalance(),{account,token:tokenA,value:25n});
 assert.equal(h.calls.render,1);assert.equal(h.calls.availability,1);
});

test('current payment balance failure clears display state, reports error, and disables availability',async()=>{
 const failure=Error('rpc unavailable');
 const h=harness({readContract:async()=>{throw failure;}});
 // Seed a previously displayed balance to verify a failed refresh clears it.
 h.setBalance({account,token:tokenA,value:50n});
 await h.run();
 assert.equal(h.getPaymentBalance(),null);
 assert.deepEqual(h.calls.status,['Could Not Load Payment Balance. Retry shortly.']);
 assert.deepEqual(h.calls.reported,[failure]);
 assert.equal(h.calls.render,1);assert.equal(h.calls.availability,1);
});

test('stale balance success and failure are ignored after account or token changes',async()=>{
 let finish!:(value:bigint)=>void;let reject!:(error:Error)=>void;
 const h=harness({readContract:()=>new Promise<bigint>((resolve,rejectPromise)=>{finish=resolve;reject=rejectPromise;})});
 const staleSuccess=h.run();h.setPayment(tokenB);finish(30n);await staleSuccess;
 assert.equal(h.getPaymentBalance(),null);
 assert.equal(h.calls.render,0);assert.equal(h.calls.availability,0);

 h.setPayment(tokenA);const staleFailure=h.run();h.ctx.wallet={account:'0x0000000000000000000000000000000000000005'};reject(Error('old account rpc failure'));await staleFailure;
 assert.equal(h.getPaymentBalance(),null);
 assert.deepEqual(h.calls.status,[]);assert.deepEqual(h.calls.reported,[]);
 assert.equal(h.calls.render,0);assert.equal(h.calls.availability,0);
});

test('same request remains coalesced after switching away and back to its token',async()=>{
 const finishes:Array<(value:bigint)=>void>=[];let reads=0;
 const h=harness({readContract:()=>{reads++;return new Promise<bigint>(resolve=>{finishes.push(resolve);});}});
 const first=h.run();h.setPayment(tokenB);const other=h.run();h.setPayment(tokenA);const again=h.run();
 assert.equal(reads,2);
 finishes[0]!(10n);await Promise.all([first,again]);
 assert.deepEqual(h.getPaymentBalance(),{account,token:tokenA,value:10n});
 finishes[1]!(20n);await other;
});
