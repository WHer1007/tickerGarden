import test from 'node:test';import assert from 'node:assert/strict';
import {recoveryRead,recoveryWrite,recoveryRemove} from '../src/v1/recoveryStorage.ts';
import {recoverSubmissionDeadline,retireConversionJournal,paymentAssets,reconcileConversionJournal,readRecovery,recoveryKey,writeRecoveryBeforeBroadcast,TRADE_NATIVE,TRADE_USDG,fetchConversion} from '../src/trade/conversion.ts';
const account='0x1111111111111111111111111111111111111111' as const;const stock='0x2222222222222222222222222222222222222222' as const;
test('unsupported automatic exchange produces a safe paired-asset action',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify({error:'conversion_asset_unavailable',message:'private internal text'}),{status:422});
 try{await assert.rejects(fetchConversion('https://read.example',{chainId:4663,sellToken:TRADE_NATIVE,buyToken:stock,sellAmount:'100',taker:account}),/Automatic exchange is unavailable for this asset. Pay with the paired asset/);}finally{globalThis.fetch=original;}
});
test('buy assets are paired first, ETH/USDG deduplicated and mainnet only',()=>{
 assert.deepEqual(paymentAssets(4663,{address:TRADE_NATIVE,symbol:'ETH',decimals:18}).map(a=>a.symbol),['ETH']);
 assert.deepEqual(paymentAssets(4663,{address:TRADE_USDG,symbol:'USDG',decimals:6}).map(a=>a.symbol),['USDG','ETH']);
 assert.deepEqual(paymentAssets(4663,{address:stock,symbol:'STOCK',decimals:18}).map(a=>a.symbol),['STOCK','ETH']);
 assert.equal(paymentAssets(46630,{address:stock,symbol:'STOCK',decimals:18}).length,1);
});
test('conversion recovery isolates account/market and rejects malformed or incomplete entries',()=>{
 const market='market';const value={account,marketId:market,pair:TRADE_USDG,amount:'1000000',minimum:'100',state:'funded'};
 const store={getItem:(key:string)=>key===recoveryKey(account,market)?JSON.stringify(value):null};
 assert.deepEqual(readRecovery(store,account,market),value);
 assert.throws(()=>readRecovery({getItem:()=>JSON.stringify(value)},stock,market),/invalid/);assert.equal(readRecovery(store,account,'other'),null);
 for(const patch of [{amount:'-1'},{minimum:'0'},{state:'anything'},{hash:'oops'},{pair:'bad'}])assert.throws(()=>readRecovery({getItem:()=>JSON.stringify({...value,...patch})},account,market),/invalid/);
 assert.throws(()=>readRecovery({getItem:()=>'{broken'},account,market),/corrupt/);
});
test('conversion recovery surfaces storage read failures and retains writes/removals in memory',()=>{
 const key=recoveryKey(account,'market'),value={account,marketId:'market',pair:TRADE_USDG,amount:'1000000',minimum:'100',state:'pending',hash:'0x'+'a'.repeat(64)};
 const blocked={getItem:()=>{throw Error('storage denied');},setItem:()=>{throw Error('storage denied');},removeItem:()=>{throw Error('storage denied');}};
 assert.throws(()=>readRecovery(blocked,account,'market'),/storage denied/);
 recoveryWrite(blocked,key,JSON.stringify(value));
 assert.equal(readRecovery(blocked,account,'market')?.state,'pending');
 recoveryRemove(blocked,key);
 assert.equal(readRecovery(blocked,account,'market'),null);
 assert.equal(recoveryRead(blocked,key),null);
});
test('new conversion intent requires durable storage before broadcast',()=>{
 const value={account:account as `0x${string}`,marketId:'market',pair:TRADE_USDG,amount:'1000000',minimum:'100',state:'submitting' as const};
 let stored='';writeRecoveryBeforeBroadcast({setItem:(_key:string,raw:string)=>{stored=raw;}},value);assert.equal(JSON.parse(stored).state,'submitting');
 assert.throws(()=>writeRecoveryBeforeBroadcast({setItem:()=>{throw Error('quota exceeded');}},value),/quota exceeded/);
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
 const hash='0x'+'a'.repeat(64),operationKey='trade:buy:market';
 const r={account,marketId:'market',pair:TRADE_USDG,amount:'100',minimum:'90',state:'buy_submitting',buyTo:stock,buyHash:hash,operationKey};
 const receipt={from:account,to:stock,status:'success',transactionHash:hash};
 const result={pending:{businessType:'trade',marketId:'market',operationKey,hash,approval:false},receipt,cancelled:false,approval:false};
 storage.setItem(key,JSON.stringify(r));reconcileConversionJournal(storage,account,[result] as never);assert.equal(storage.getItem(key),null);
 storage.setItem(key,JSON.stringify(r));reconcileConversionJournal(storage,account,[{...result,receipt:{...receipt,status:'reverted'}}] as never);assert.equal(readRecovery(storage,account,'market')?.state,'funded');
 storage.setItem(key,JSON.stringify(r));reconcileConversionJournal(storage,account,[{...result,pending:{...result.pending,approval:true,businessType:'approval'}}] as never);assert.equal(readRecovery(storage,account,'market')?.state,'buy_submitting');
});
test('startup conversion confirmation preserves the funded second leg and isolates other wallets',()=>{
 const key=recoveryKey(account,'market'),entries=new Map<string,string>();
 const storage={getItem:(k:string)=>entries.get(k)??null,setItem:(k:string,v:string)=>{entries.set(k,v);},removeItem:(k:string)=>{entries.delete(k);}};
 const hash='0x'+'a'.repeat(64),operationKey='trade:conversion:market:1';
 const r={account,marketId:'market',pair:TRADE_USDG,amount:'100',minimum:'90',state:'submitting',hash,operationKey};
 storage.setItem(key,JSON.stringify(r));const result={pending:{businessType:'trade',marketId:'market',operationKey,hash,approval:false},receipt:{from:account,to:'0x0000000000001ff3684f28c67538d4d072c22734',status:'success',transactionHash:hash},cancelled:false,approval:false};
 reconcileConversionJournal(storage,stock,[result] as never);assert.equal(readRecovery(storage,account,'market')?.state,'submitting');
 reconcileConversionJournal(storage,account,[result] as never);assert.equal(readRecovery(storage,account,'market')?.state,'funded');
});


test('configured-router recovery accepts its receipt and rejects an unrelated destination',()=>{
 const key=recoveryKey(account,'market'),entries=new Map<string,string>();
 const storage={getItem:(k:string)=>entries.get(k)??null,setItem:(k:string,v:string)=>{entries.set(k,v);},removeItem:(k:string)=>{entries.delete(k);}};
 const conversionTo='0x8876789976decbfcbbbe364623c63652db8c0904';
 const hash='0x'+'b'.repeat(64),operationKey='trade:conversion:market:1';
 const r={account,marketId:'market',pair:TRADE_USDG,amount:'100',minimum:'90',state:'pending',conversionTo,hash,operationKey};
 storage.setItem(key,JSON.stringify(r));
 const result={pending:{businessType:'trade',marketId:'market',operationKey,hash,approval:false},receipt:{from:account,to:conversionTo,status:'success',transactionHash:hash},cancelled:false,approval:false};
 reconcileConversionJournal(storage,account,[result] as never);assert.equal(readRecovery(storage,account,'market')?.state,'funded');
 storage.setItem(key,JSON.stringify({...r,conversionTo:stock}));assert.throws(()=>readRecovery(storage,account,'market'),/invalid/);
});

test('conversion reconciliation rejects unrelated hashes and operation keys',()=>{
 const key=recoveryKey(account,'market'),entries=new Map<string,string>();
 const storage={getItem:(k:string)=>entries.get(k)??null,setItem:(k:string,v:string)=>{entries.set(k,v);},removeItem:(k:string)=>{entries.delete(k);}};
 const hash='0x'+'c'.repeat(64),operationKey='trade:conversion:market:2',to='0x0000000000001ff3684f28c67538d4d072c22734';
 const record={account,marketId:'market',pair:TRADE_USDG,amount:'100',minimum:'90',state:'pending',hash,operationKey};
 const result={pending:{businessType:'trade',marketId:'market',operationKey,hash:'0x'+'d'.repeat(64),approval:false},receipt:{from:account,to,status:'success',transactionHash:'0x'+'d'.repeat(64)},cancelled:false,approval:false};
 storage.setItem(key,JSON.stringify(record));reconcileConversionJournal(storage,account,[result] as never);assert.equal(readRecovery(storage,account,'market')?.state,'pending');
 storage.setItem(key,JSON.stringify(record));reconcileConversionJournal(storage,account,[{...result,pending:{...result.pending,hash,operationKey:'trade:conversion:market:other'},receipt:{...result.receipt,transactionHash:hash}}] as never);assert.equal(readRecovery(storage,account,'market')?.state,'pending');
});

test('conversion reconciliation accepts a receipt hash in explicit replacement lineage',()=>{
 const key=recoveryKey(account,'market'),entries=new Map<string,string>();
 const storage={getItem:(k:string)=>entries.get(k)??null,setItem:(k:string,v:string)=>{entries.set(k,v);},removeItem:(k:string)=>{entries.delete(k);}};
 const originalHash='0x'+'e'.repeat(64),replacementHash='0x'+'f'.repeat(64),operationKey='trade:conversion:market:replacement',to='0x0000000000001ff3684f28c67538d4d072c22734';
 storage.setItem(key,JSON.stringify({account,marketId:'market',pair:TRADE_USDG,amount:'100',minimum:'90',state:'pending',hash:originalHash,operationKey}));
 reconcileConversionJournal(storage,account,[{pending:{businessType:'trade',marketId:'market',operationKey,hash:replacementHash,previousHashes:[originalHash],approval:false},receipt:{from:account,to,status:'success',transactionHash:replacementHash},cancelled:false,approval:false} as never]);
 assert.equal(readRecovery(storage,account,'market')?.state,'funded');assert.equal(readRecovery(storage,account,'market')?.hash,replacementHash);
});

test('submission deadline persists across reload and archives expired hashless attempts',()=>{
 const key=recoveryKey(account,'market'),entries=new Map<string,string>();
 const storage={getItem:(k:string)=>entries.get(k)??null,setItem:(k:string,v:string)=>{entries.set(k,v);},removeItem:(k:string)=>{entries.delete(k);}};
 const initial={account,marketId:'market',pair:TRADE_USDG,amount:'100',minimum:'90',state:'submitting' as const,attemptId:'attempt-one',createdAt:1000};
 const first=recoverSubmissionDeadline(storage,initial,5000);assert.ok(first);assert.equal(first.deadlineAt,21000);assert.equal(JSON.parse(entries.get(key)!).deadlineAt,21000);
 const reloaded=readRecovery(storage,account,'market')!;assert.equal(recoverSubmissionDeadline(storage,reloaded,20000)?.deadlineAt,21000);
 assert.equal(recoverSubmissionDeadline(storage,reloaded,21000),null);assert.equal(storage.getItem(key),null);
 const archived=JSON.parse(entries.get(`${key}:archive:attempt-one`)!);assert.equal(archived.reason,'submission_unobserved');assert.equal(archived.retiredAt,21000);
});

test('legacy hashless submissions get one stored grace period and funded records stay untouched',()=>{
 const key=recoveryKey(account,'market'),entries=new Map<string,string>();
 const storage={getItem:(k:string)=>entries.get(k)??null,setItem:(k:string,v:string)=>{entries.set(k,v);},removeItem:(k:string)=>{entries.delete(k);}};
 const legacy={account,marketId:'market',pair:TRADE_USDG,amount:'100',minimum:'90',state:'submitting' as const};
 const first=recoverSubmissionDeadline(storage,legacy,10000);assert.ok(first);assert.equal(first.createdAt,10000);assert.equal(first.deadlineAt,30000);assert.match(first.attemptId!,/^legacy:/);
 const second=recoverSubmissionDeadline(storage,readRecovery(storage,account,'market')!,25000);assert.equal(second?.deadlineAt,30000);
 assert.equal(recoverSubmissionDeadline(storage,second!,30000),null);
 const funded={...legacy,state:'funded' as const};assert.deepEqual(recoverSubmissionDeadline(storage,funded,90000),funded);
});

test('malformed conversion recovery deadlines and operation metadata are rejected',()=>{
 const value={account,marketId:'market',pair:TRADE_USDG,amount:'100',minimum:'90',state:'pending'};
 for(const patch of [{deadlineAt:-1},{deadlineAt:Number.NaN},{createdAt:Infinity},{attemptId:4},{operationKey:'x'.repeat(513)}])
  assert.throws(()=>readRecovery({getItem:()=>JSON.stringify({...value,...patch})},account,'market'),/deadline is invalid/);
});

test('retiring an unverified buy does not offer a duplicate funded resume or touch other hashes',()=>{
 const entries=new Map<string,string>(),key=recoveryKey(account,'market');
 const storage={getItem:(k:string)=>entries.get(k)??null,setItem:(k:string,v:string)=>{entries.set(k,v);},removeItem:(k:string)=>{entries.delete(k);}};
 const hash='0x'+'a'.repeat(64);
 const record={account,marketId:'market',pair:TRADE_USDG,amount:'100',minimum:'90',state:'buy_pending',buyTo:stock,buyHash:hash};
 storage.setItem(key,JSON.stringify(record));
 retireConversionJournal(storage,account,{marketId:'market',hash:'0x'+'b'.repeat(64)} as never);assert.ok(storage.getItem(key));
 retireConversionJournal(storage,account,{marketId:'market',hash} as never);assert.equal(storage.getItem(key),null);
});
