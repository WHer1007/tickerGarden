import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createMarketDirectory} from '../src/v1/marketDirectory.ts';
import type {MarketPage,MarketReadModel,ListMarketsParams} from '../src/v1/generated/read-api.ts';
const hash=(n:number)=>`0x${n.toString(16).padStart(64,'0')}` as const;
const revision=`1:${hash(1)}`;
const sync={chainId:4663,status:'synced',finality:'finalized',blockNumber:'1',blockHash:hash(1),revision,headBlockNumber:null,headBlockHash:null,lagBlocks:null} as const;
const page=(start:number,count:number,nextCursor:string|null=null):MarketPage=>({sync,nextCursor,items:Array.from({length:count},(_,i)=>({marketId:hash(start+i)}) as MarketReadModel)});
test('directory query forwards full filters and retains all matching pages',async()=>{
 const seen:ListMarketsParams[]=[];const d=createMarketDirectory(async p=>{seen.push(p);return p.cursor?page(101,30):page(1,100,'next');});
 const q={revision,search:'MiXeD',launchPhase:1 as const,assetUid:hash(9),sort:'name_asc' as const};
 assert.equal((await d.load(q))?.items.length,100);assert.equal((await d.load(q,true))?.items.length,130);
 assert.equal(seen[0]?.search,'MiXeD');assert.equal(seen[0]?.sort,'name_asc');assert.equal(seen[1]?.cursor,'next');assert.equal(seen[1]?.revision,revision);
 assert.equal((await d.load(q))?.items.length,130);assert.equal(seen.length,2);d.reset();
});
test('late query cannot overwrite a newer query or cached selection',async()=>{
 const pending:Array<{resolve:(p:MarketPage)=>void;signal:AbortSignal}>=[];
 const d=createMarketDirectory((_p,signal)=>new Promise(resolve=>pending.push({resolve,signal})));
 const a=d.load({revision,search:'A'});pending[0]!.resolve(page(1,1));await a;
 const b=d.load({revision,search:'B'});assert.equal((await d.load({revision,search:'A'}))?.items[0]?.marketId,hash(1));assert.equal(pending[1]!.signal.aborted,true);
 pending[1]!.resolve(page(2,1));assert.equal(await b,null);
 const c=d.load({revision,search:'C'});d.reset();pending[2]!.resolve(page(3,1));assert.equal(await c,null);
});
test('directory rejects mixed revisions duplicate rows and non-advancing cursors',async()=>{
 for(const bad of [page(1,1,'next'),page(1,1,'new'),{...page(101,1),sync:{...sync,revision:`2:${hash(2)}`}}]){
  let calls=0;const d=createMarketDirectory(async()=>++calls===1?page(1,100,'next'):bad);
  await d.load({revision});await assert.rejects(()=>d.load({revision},true));await assert.rejects(()=>d.load({revision},true),/No matching/);d.reset();
 }
});
test('changing query starts without previous cursor and failures do not cache partial results',async()=>{
 let calls=0;const seen:ListMarketsParams[]=[];const d=createMarketDirectory(async p=>{seen.push(p);calls++;if(calls===2)throw new Error('503');return page(calls,1,'next');});
 await d.load({revision,sort:'name_asc'});await assert.rejects(()=>d.load({revision,sort:'launchPhase_asc'}));await d.load({revision,sort:'launchPhase_asc'});
 assert.equal(seen[1]?.cursor,undefined);assert.equal(seen[2]?.cursor,undefined);d.reset();
});
test('directory forwards Bloomed/Growing phases and USD ranking sorts',async()=>{
 const seen:ListMarketsParams[]=[];const d=createMarketDirectory(async p=>{seen.push(p);return page(1,1);});
 await d.load({revision,launchPhase:1,sort:'volume24hUsd_desc'});
 await d.load({revision,launchPhase:0,sort:'marketCapUsd_desc'});
 assert.deepEqual(seen.map(({launchPhase,sort})=>({launchPhase,sort})),[
  {launchPhase:1,sort:'volume24hUsd_desc'},
  {launchPhase:0,sort:'marketCapUsd_desc'},
 ]);
});
test('directory uses configured page size and forwards staking filter',async()=>{
 const seen:ListMarketsParams[]=[];const d=createMarketDirectory(async p=>{seen.push(p);return page(p.cursor?31:1,30,p.cursor?null:'next');},30);
 const query={revision,search:'remote',stakingEnabled:true};
 const result=await d.load(query);
 assert.equal(result?.items.length,30);
 assert.equal(seen[0]?.limit,30);assert.equal(seen[0]?.search,'remote');assert.equal(seen[0]?.stakingEnabled,true);
 const next=await d.load(query,true);assert.equal(next?.items.length,60);assert.equal(seen[1]?.limit,30);assert.equal(seen[1]?.cursor,'next');
});
test('configured display-chain directory accepts head data and still validates its chain id',async()=>{
 const headSync={...sync,status:'unavailable',finality:'head',headBlockNumber:'2',headBlockHash:hash(2),lagBlocks:'1'} as unknown as MarketPage['sync'];
 const headPage={...page(1,1),sync:headSync};
 const configured=createMarketDirectory(async()=>headPage,100,{displayChainId:4663});
 assert.equal((await configured.load({revision}))?.items.length,1);

 const wrongChain=createMarketDirectory(async()=>({...headPage,sync:{...headSync,chainId:1}} as unknown as MarketPage),100,{displayChainId:4663});
 await assert.rejects(()=>wrongChain.load({revision}),/Invalid directory chain/);

 const defaultMode=createMarketDirectory(async()=>headPage);
 await assert.rejects(()=>defaultMode.load({revision}),/finalized/);
});
