import assert from 'node:assert/strict';
import {test} from 'node:test';
import {loadWalletAccounts} from '../src/v1/accounts.ts';
import type {AccountPage,ConfigReadModel} from '../src/v1/generated/read-api.ts';
const wallet=`0x${'1'.repeat(40)}` as const,vault=`0x${'2'.repeat(40)}` as const,hash=`0x${'3'.repeat(64)}` as const;
const id=(n:number)=>`0x${String(n).padStart(64,'0')}` as const;
const sync={chainId:4663,status:'synced',finality:'finalized',blockNumber:'1',blockHash:hash,revision:`1:${hash}`,headBlockNumber:'1',headBlockHash:hash,lagBlocks:'0'} as const;
const row=(n:number)=>({user:wallet,assetUid:id(n),vault,deposited:'9007199254740993',allocated:'1',free:'9007199254740992',source:{chainId:4663,blockNumber:'1',blockHash:hash,transactionHash:hash,transactionIndex:0,logIndex:0}} as const);
const assets=[1,2].map(n=>({kind:'asset',id:id(n),values:{userStockVault:vault}})) as unknown as ConfigReadModel[];
const options=()=>({wallet,sync,assets,signal:new AbortController().signal});
test('loads complete pinned account pages without rounding',async()=>{
 const requested:(string|undefined)[]=[];
 const rows=await loadWalletAccounts({...options(),fetchPage:async cursor=>{requested.push(cursor);return {sync,items:[row(cursor?2:1)],nextCursor:cursor?null:'next'}}});
 assert.deepEqual(requested,[undefined,'next']);assert.equal(rows[0]?.deposited,'9007199254740993');assert.equal(rows.length,2);
});
test('rejects inconsistent principal, scope and pagination',async()=>{
 for(const mode of ['revision','wallet','vault','amount','source','duplicate','cursor']){
  let calls=0;
  await assert.rejects(loadWalletAccounts({...options(),fetchPage:async()=>{
   calls++;const a=row(1);const p:AccountPage={sync,items:[a],nextCursor:mode==='cursor'?'same':null};
   if(mode==='revision')return {...p,sync:{...sync,revision:`2:${hash}`}};
   if(mode==='wallet')return {...p,items:[{...a,user:vault}]};
   if(mode==='vault')return {...p,items:[{...a,vault:wallet}]};
   if(mode==='amount')return {...p,items:[{...a,free:'0'}]};
   if(mode==='source')return {...p,items:[{...a,source:{...a.source,blockHash:id(8)}}]};
   if(mode==='duplicate')return {...p,items:[a,a]};
   return {...p,items:[row(calls)]};
  }}),mode);
 }
});
test('empty is valid; later failure and cancellation return no partial data',async()=>{
 assert.deepEqual(await loadWalletAccounts({...options(),fetchPage:async()=>({sync,items:[],nextCursor:null})}),[]);
 await assert.rejects(loadWalletAccounts({...options(),fetchPage:async cursor=>{if(cursor)throw Error('offline');return {sync,items:[row(1)],nextCursor:'next'}}}));
 const controller=new AbortController();
 await assert.rejects(loadWalletAccounts({...options(),signal:controller.signal,fetchPage:async()=>{controller.abort();return {sync,items:[row(1)],nextCursor:null}}}));
});
