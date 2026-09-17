import test from 'node:test';import assert from 'node:assert/strict';
import {paymentAssets,reconcileConversionJournal,readRecovery,recoveryKey,TRADE_NATIVE,TRADE_USDG,fetchConversion} from '../src/trade/conversion.ts';
const account='0x1111111111111111111111111111111111111111';const stock='0x2222222222222222222222222222222222222222';
test('buy assets are paired first, ETH/USDG deduplicated and mainnet only',()=>{
 assert.deepEqual(paymentAssets(4663,{address:TRADE_NATIVE,symbol:'ETH',decimals:18}).map(a=>a.symbol),['ETH','USDG']);
 assert.deepEqual(paymentAssets(4663,{address:TRADE_USDG,symbol:'USDG',decimals:6}).map(a=>a.symbol),['USDG','ETH']);
 assert.deepEqual(paymentAssets(4663,{address:stock,symbol:'STOCK',decimals:18}).map(a=>a.symbol),['STOCK','USDG','ETH']);
 assert.equal(paymentAssets(46630,{address:stock,symbol:'STOCK',decimals:18}).length,1);
});
test('conversion recovery isolates account/market and rejects malformed or incomplete entries',()=>{
 const market='market';const value={account,marketId:market,pair:TRADE_USDG,amount:'1000000',minimum:'100',state:'funded'};
 const store={getItem:(key:string)=>key===recoveryKey(account,market)?JSON.stringify(value):null};
 assert.deepEqual(readRecovery(store,account,market),value);
 assert.equal(readRecovery(store,stock,market),null);assert.equal(readRecovery(store,account,'other'),null);
 for(const patch of [{amount:'-1'},{minimum:'0'},{state:'anything'},{hash:'oops'},{pair:'bad'}])assert.equal(readRecovery({getItem:()=>JSON.stringify({...value,...patch})},account,market),null);
 assert.equal(readRecovery({getItem:()=>'{broken'},account,market),null);
});
test('frontend forwards only intent fields and never provider calldata/keys in URL',async()=>{
 const original=globalThis.fetch;let requested='';
 globalThis.fetch=async(input,init)=>{requested=String(input);assert.equal(init?.cache,'no-store');return new Response('{}',{status:503});};
 try{await assert.rejects(fetchConversion('https://read.example',{chainId:4663,sellToken:TRADE_NATIVE,buyToken:TRADE_USDG,sellAmount:'100',taker:account,transaction:{data:'secret'},buyAmount:'20'} as never),/route is unavailable/);
 const u=new URL(requested);assert.deepEqual([...u.searchParams.keys()].sort(),['buyToken','chainId','sellAmount','sellToken','taker']);assert.ok(!requested.includes('secret'));}finally{globalThis.fetch=original;}
});

test('startup receipts clear completed project buys instead of offering a duplicate purchase',()=>{
 const key=recoveryKey(account,'market'),entries=new Map<string,string>();
 const storage={getItem:(k:string)=>entries.get(k)??null,setItem:(k:string,v:string)=>{entries.set(k,v);},removeItem:(k:string)=>{entries.delete(k);}};
 const r={account,marketId:'market',pair:TRADE_USDG,amount:'100',minimum:'90',state:'buy_submitting',buyTo:stock};
 const receipt={from:account,to:stock,status:'success',transactionHash:'0x'+'a'.repeat(64)};
 const result={pending:{businessType:'trade',marketId:'market',operationKey:'trade:buy:market',approval:false},receipt,cancelled:false,approval:false};
 storage.setItem(key,JSON.stringify(r));reconcileConversionJournal(storage,account,[result] as never);assert.equal(storage.getItem(key),null);
 storage.setItem(key,JSON.stringify(r));reconcileConversionJournal(storage,account,[{...result,receipt:{...receipt,status:'reverted'}}] as never);assert.equal(readRecovery(storage,account,'market')?.state,'funded');
 storage.setItem(key,JSON.stringify(r));reconcileConversionJournal(storage,account,[{...result,pending:{...result.pending,approval:true,businessType:'approval'}}] as never);assert.equal(readRecovery(storage,account,'market')?.state,'buy_submitting');
});
test('startup conversion confirmation preserves the funded second leg and isolates other wallets',()=>{
 const key=recoveryKey(account,'market'),entries=new Map<string,string>();
 const storage={getItem:(k:string)=>entries.get(k)??null,setItem:(k:string,v:string)=>{entries.set(k,v);},removeItem:(k:string)=>{entries.delete(k);}};
 const r={account,marketId:'market',pair:TRADE_USDG,amount:'100',minimum:'90',state:'submitting'};
 storage.setItem(key,JSON.stringify(r));const result={pending:{businessType:'trade',marketId:'market',operationKey:'trade:conversion:market:1',approval:false},receipt:{from:account,to:'0x0000000000001ff3684f28c67538d4d072c22734',status:'success',transactionHash:'0x'+'a'.repeat(64)},cancelled:false,approval:false};
 reconcileConversionJournal(storage,stock,[result] as never);assert.equal(readRecovery(storage,account,'market')?.state,'submitting');
 reconcileConversionJournal(storage,account,[result] as never);assert.equal(readRecovery(storage,account,'market')?.state,'funded');
});
