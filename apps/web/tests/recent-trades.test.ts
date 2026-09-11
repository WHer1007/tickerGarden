import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encodeAbiParameters,encodeEventTopics,parseAbi} from 'viem';
import {decodeRecentTrade,mergeRecentTrades,curveVolumeAmount,explorerRecentTrades} from '../src/v1/recentTrades.ts';
import {poolSwapAbi} from '../src/v1/poolTrade.ts';
import type {MarketReadModel} from '../src/v1/generated/read-api.ts';
const curve=`0x${'1'.repeat(40)}` as const,actor=`0x${'2'.repeat(40)}` as const,tx=`0x${'3'.repeat(64)}` as const;
const market={curve} as MarketReadModel;
const abi=parseAbi(['event CurveBuy(address indexed buyer,address indexed recipient,uint256 quoteIn,uint256 tokensOut,uint256 fee,uint256 tax)']);
const log={address:curve,topics:encodeEventTopics({abi,eventName:'CurveBuy',args:{buyer:actor,recipient:actor}}).filter((topic):topic is `0x${string}`=>typeof topic==='string'),data:encodeAbiParameters([{type:'uint256'},{type:'uint256'},{type:'uint256'},{type:'uint256'}],[10n**18n,1000n*10n**18n,10n**16n,0n]),transactionHash:tx,logIndex:4};
test('uses exact confirmed event amounts, correct quote decimals and emitter',()=>{
 const row=decodeRecentTrade(log,market,18,1000)!;
 assert.equal(row.side,'buy');assert.equal(row.price,'0.001');assert.equal(row.actor,actor);assert.equal(row.memeRaw,'1000000000000000000000');
 assert.equal(decodeRecentTrade({...log,address:actor},market,18,1000),null);
 assert.equal(decodeRecentTrade({...log,data:'0x'},market,18,1000),null);
});
test('receipt and explorer records deduplicate by tx and log, while distinct logs remain',()=>{
 const row=decodeRecentTrade(log,market,18,1000)!;
 const merged=mergeRecentTrades([row],[{...row,eventKey:`chain:block:${tx}:4`},{...row,eventKey:`${tx}:5`,timestamp:1001}]);
 assert.equal(merged.length,2);assert.equal(merged[0]?.timestamp,1001);
});

test('curve volume excludes buy fees and ignores unrelated logs',()=>{
 assert.equal(curveVolumeAmount(log),990000000000000000n);
 assert.equal(curveVolumeAmount({...log,topics:[tx]}),null);
});
test('recent trades sort newest first across dates regardless of source arrival order',()=>{
 const row=decodeRecentTrade(log,market,18,1000)!;
 const rows=mergeRecentTrades(
  [{...row,timestamp:1725843600,eventKey:`${tx}:1`},{...row,timestamp:1725757200,eventKey:`${tx}:2`}],
  [{...row,timestamp:1725847200,eventKey:`${tx}:3`}],
 );
 assert.deepEqual(rows.map(item=>item.timestamp),[1725847200,1725843600,1725757200]);
});

const manager=`0x${'4'.repeat(40)}` as const,hook=`0x${'5'.repeat(40)}` as const,poolId=`0x${'6'.repeat(64)}` as const;
const poolActor=`0x${'7'.repeat(40)}` as const;
const poolMarket={...market,memeToken:curve,poolId,poolKey:{currency0:curve,currency1:`0x${'9'.repeat(40)}`},canonicalRoute:{hook}} as MarketReadModel;
const swapTopics=encodeEventTopics({abi:poolSwapAbi,eventName:'Swap',args:{id:poolId,sender:poolActor}}).filter((topic):topic is `0x${string}`=>typeof topic==='string');
const swapData=encodeAbiParameters([{type:'int128'},{type:'int128'},{type:'uint160'},{type:'uint128'},{type:'int24'},{type:'uint24'}],[100n,-10n,1n,1n,0,1]);
const legacyCurvePage={items:[],next_page_params:null};
const legacyPool=(sender=poolActor)=>({result:[{address:manager,topics:encodeEventTopics({abi:poolSwapAbi,eventName:'Swap',args:{id:poolId,sender}}).filter(Boolean),data:swapData,transactionHash:tx,logIndex:'0x2',timeStamp:'0x3e8'}],status:'1'});
function mockFetch(sequence:unknown[]){const original=globalThis.fetch;let i=0;globalThis.fetch=(async()=>({ok:true,json:async()=>sequence[Math.min(i++,sequence.length-1)]})) as unknown as typeof fetch;return()=>{globalThis.fetch=original;};}
test('legacy pool logs decode hex timestamp and logIndex',async()=>{const restore=mockFetch([legacyCurvePage,legacyPool()]);try{const rows=await explorerRecentTrades('https://explorer',poolMarket,18,manager,1);assert.deepEqual(rows.length,1);assert.equal(rows[0]?.timestamp,1000);assert.equal(rows[0]?.actor,poolActor);}finally{restore();}});
test('pool logs from the graduated hook are excluded',async()=>{const restore=mockFetch([legacyCurvePage,legacyPool(hook)]);try{assert.deepEqual(await explorerRecentTrades('https://explorer',poolMarket,18,manager,1),[]);}finally{restore();}});
test('missing pool creation block does not query the pool endpoint',async()=>{let calls=0;const restore=mockFetch([legacyCurvePage]);const original=globalThis.fetch;globalThis.fetch=(async(...args)=>{calls++;return original(...args);}) as typeof fetch;try{await explorerRecentTrades('https://explorer',poolMarket,18,manager);assert.equal(calls,1);}finally{restore();}});
test('pool failure preserves curve trades',async()=>{const curveItem={transaction_hash:tx,index:1,topics:log.topics,data:log.data,address:{hash:curve},block_timestamp:'1970-01-01T00:16:40Z'};const original=globalThis.fetch;let i=0;globalThis.fetch=(async()=>{if(i++===0)return {ok:true,json:async()=>({items:[curveItem]})} as Response;return {ok:false} as Response;}) as typeof fetch;try{const rows=await explorerRecentTrades('https://explorer',poolMarket,18,manager,1);assert.equal(rows.length,1);assert.equal(rows[0]?.timestamp,1000);}finally{globalThis.fetch=original;}});
