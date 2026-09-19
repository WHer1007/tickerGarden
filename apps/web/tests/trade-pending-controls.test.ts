import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
const source=readFileSync(new URL('../src/controllers/trade.ts',import.meta.url),'utf8');
test('a saved pending trade disables submission without pretending preparation is running',()=>{
 const start=source.indexOf('function updateTradeAvailability():');const end=source.indexOf('async function refreshRecentTrades',start);
 const attrs=new Map(),classes=new Map();const button:any={textContent:'',classList:{toggle:(k:string,v:boolean)=>classes.set(k,v)},setAttribute:(k:string,v:string)=>attrs.set(k,v)};
 const ctx={query:()=>button,tradeMarket:{market:{marketId:'m'}},tradeSubmitting:false,transactionScopeBusy:()=>true,setDisabled:(_:unknown,v:boolean)=>{button.disabled=v;},writeReady:()=>true,tradeSide:'buy',tradeMetadata:{symbol:'SEED'}};
 vm.runInNewContext(ts.transpileModule(source.slice(start,end)+'\nupdateTradeAvailability();',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{ctx,renderStockPurchaseHint(){},usesConversion:()=>false,recoveryStorageUnavailable:false,recovery:{state:'pending'}});
 assert.equal(button.disabled,true);assert.equal(attrs.get('aria-busy'),'false');assert.equal(classes.get('is-loading'),false);assert.equal(button.textContent,'Transaction status unresolved');
});
test('payment selection is not disabled by saved conversion records',()=>{
 const expression=source.match(/node.disabled=([^;]+);/)![1]!;
 for(const recovery of [null,{state:'pending'},{state:'funded'}])assert.equal(vm.runInNewContext(expression,{ctx:{tradeSubmitting:false},recovery,recoveryStorageUnavailable:true}),false);
 assert.equal(vm.runInNewContext(expression,{ctx:{tradeSubmitting:true}}),true);
});
