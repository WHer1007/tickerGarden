import test from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';import {readFileSync} from 'node:fs';
import {readRecovery,recoverSubmissionDeadline,recoveryKey,TRADE_USDG} from '../src/trade/conversion.ts';
const tree=ts.createSourceFile('trade.ts',readFileSync(new URL('../src/controllers/trade.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
function body(){let text='';function walk(n:ts.Node){if(ts.isFunctionDeclaration(n)&&n.name?.text==='restoreConversion')text=n.getText(tree);else ts.forEachChild(n,walk);}walk(tree);return ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;}
const account='0x1111111111111111111111111111111111111111' as const,marketId='market';
function harness(state='submitting'){
 const data=new Map<string,string>(),key=recoveryKey(account,marketId);const storage={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);},removeItem:(k:string)=>{data.delete(k);}};
 storage.setItem(key,JSON.stringify({account,marketId,pair:TRADE_USDG,amount:'100',minimum:'90',state,attemptId:'attempt-1',createdAt:1000,deadlineAt:21000}));
 let quotes=0;const field={value:''};
 const notices:string[]=[],ctx={wallet:{account,executor:{pending:()=>[]}},tradeMarket:{market:{marketId,quoteAsset:TRADE_USDG}},tradeSubmitting:false,tradeMetadata:{quoteDecimals:18},query:()=>field,notify:(s:string)=>notices.push(s)};
 const vars={ctx,formatUnits:(v:bigint)=>String(v),scheduleTradeQuote:()=>{quotes++;},localStorage:storage,readRecovery,recoverSubmissionDeadline,recoveryKey,renderPayments:()=>{},updateTradeAvailability:()=>{}};
 const api=new Function(...Object.keys(vars),`let selectedPayment=null,recovery=null,recoveryIdentity='',recoveryStorageUnavailable=false,recoveryDeadlineTimer;function saveRecovery(value,old){if(!value)localStorage.removeItem(recoveryKey(old.account,old.marketId));recovery=value;}`+body()+'return {restoreConversion,state:()=>recovery};')(...Object.values(vars));
 return {api,storage,key,notices,ctx,quotes:()=>quotes};
}
test('refresh preserves the original hashless deadline rather than starting another 20 seconds',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:20000});const h=harness();await h.api.restoreConversion();
 assert.ok(h.api.state());t.mock.timers.tick(1000);assert.equal(h.api.state(),null);assert.equal(h.storage.getItem(h.key),null);assert.equal(h.notices.length,1);
});
test('an expired hashless record clears immediately on reload',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:22000});const h=harness();await h.api.restoreConversion();assert.equal(h.api.state(),null);assert.equal(h.storage.getItem(h.key),null);assert.equal(h.notices.length,1);
});
test('an old deadline callback never clears a newer attempt',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:20000});const h=harness();await h.api.restoreConversion();
 const r=JSON.parse(h.storage.getItem(h.key)!);h.storage.setItem(h.key,JSON.stringify({...r,attemptId:'attempt-2',deadlineAt:40000}));
 t.mock.timers.tick(1000);assert.equal(JSON.parse(h.storage.getItem(h.key)!).attemptId,'attempt-2');assert.equal(h.notices.length,0);
});

test('re-rendering the same pending record does not cancel its original deadline',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:20000});const h=harness();await h.api.restoreConversion();await h.api.restoreConversion();
 t.mock.timers.tick(1000);assert.equal(h.storage.getItem(h.key),null);
});
test('funded recovery schedules one quote without a recursive render/requote loop',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:20000});const h=harness('funded');await h.api.restoreConversion();await h.api.restoreConversion();
 assert.equal(h.quotes(),1);t.mock.timers.tick(30000);assert.ok(h.storage.getItem(h.key));assert.equal(h.notices.length,0);
});
