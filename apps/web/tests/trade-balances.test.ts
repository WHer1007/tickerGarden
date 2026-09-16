import assert from 'node:assert/strict';
import test from 'node:test';
import {createTradeBalanceLoader,type TradeBalances} from '../src/v1/tradeBalances.ts';
const context={key:'chain:market:wallet:quote:meme',account:'wallet',quote:'quote',meme:'meme'};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('snapshot replacement keeps valid balances and slow assets do not block each other',async()=>{
 let finish:((value:bigint)=>void)|undefined,last:TradeBalances|null=null;const calls:string[]=[];
 const loader=createTradeBalanceLoader({read:async asset=>{calls.push(asset);if(asset==='quote')return 0n;return new Promise(resolve=>{finish=resolve;});},changed:value=>{last=value;}});
 try{const first=loader.load(context);await flush();assert.equal((last as TradeBalances|null)?.quote,0n);assert.equal((last as TradeBalances|null)?.meme,undefined);
 const second=loader.load({...context});finish!(42n);await Promise.all([first,second]);assert.equal((last as TradeBalances|null)?.meme,42n);assert.equal(calls.filter(v=>v==='meme').length,1);
 }finally{loader.clear();}
});
test('failed asset retries automatically without rereading the successful asset',async()=>{
 let quoteCalls=0,memeCalls=0,last:TradeBalances|null=null;
 const loader=createTradeBalanceLoader({retryMs:1,read:async asset=>{if(asset==='quote'){quoteCalls++;return 7n;}if(++memeCalls<2)throw Error('temporary RPC failure');return 8n;},changed:value=>{last=value;}});
 try{await loader.load(context);await new Promise(resolve=>setTimeout(resolve,20));assert.deepEqual(last,{quote:7n,meme:8n});assert.equal(quoteCalls,1);assert.equal(memeCalls,2);}finally{loader.clear();}
});
test('switching account rejects late responses and clears former wallet balances',async()=>{
 let release:((value:bigint)=>void)|undefined,last:TradeBalances|null=null;
 const loader=createTradeBalanceLoader({read:async(asset,account)=>account==='wallet'?new Promise(resolve=>{if(asset==='meme')release=resolve;else resolve(5n);}):9n,changed:value=>{last=value;}});
 try{const old=loader.load(context);await flush();await loader.load({...context,key:'new-wallet',account:'other'});release!(100n);await old;assert.deepEqual(last,{quote:9n,meme:9n});}finally{loader.clear();}
});
test('persistent failures have bounded retries and preserve previously loaded balances',async()=>{
 let fail=false,calls=0,last:TradeBalances|null=null;
 const loader=createTradeBalanceLoader({retryMs:1,read:async()=>{calls++;if(fail)throw Error('offline');return 12n;},changed:value=>{last=value;}});
 try{await loader.load(context);fail=true;await loader.load(context);await new Promise(resolve=>setTimeout(resolve,30));assert.deepEqual(last,{quote:12n,meme:12n});assert.equal(calls,8);}finally{loader.clear();}
});

test('clearing a context settles hung balance waits and cancels retries',async()=>{
 let calls=0;
 const loader=createTradeBalanceLoader({read:()=>{calls++;return new Promise(()=>{});},changed:()=>{},timeoutMs:10000});
 const pending=loader.load(context);await flush();loader.clear();await pending;
 assert.equal(calls,2);
});

test('a receipt refresh rejects late pre-trade balances for the same wallet and market',async()=>{
 let phase:'before'|'after'='before',last:TradeBalances|null=null;
 const releases:Array<(value:bigint)=>void>=[];
 const loader=createTradeBalanceLoader({
  read:async asset=>phase==='before'?new Promise<bigint>(resolve=>releases.push(resolve)):asset==='quote'?90n:210n,
  changed:value=>{last=value;},
 });
 const before=loader.load(context);await flush();
 loader.clear();phase='after';await loader.load(context);
 assert.deepEqual(last,{quote:90n,meme:210n});
 for(const release of releases)release(1n);
 await before;
 assert.deepEqual(last,{quote:90n,meme:210n});
 loader.clear();
});
