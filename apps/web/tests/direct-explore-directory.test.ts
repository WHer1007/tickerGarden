import assert from 'node:assert/strict';
import test from 'node:test';
import {pageDirectExplore} from '../src/v1/directExploreDirectory.ts';
import type {MarketReadModel} from '../src/v1/generated/read-api.ts';

const hex=(character:string,length:number)=>`0x${character.repeat(length)}` as `0x${string}`;
const market=(suffix:string,phase:0|1,name:string,symbol:string,deployedAt:string,asset='a'):MarketReadModel=>({
 marketId:hex(suffix,64),assetUid:hex(asset,64),memeToken:hex(suffix,40),curve:hex('1',40),gauge:hex('2',40),quoteAsset:hex('0',40),quoteAssetConfigId:hex('3',64),tickerGardenBaselineId:hex('4',64),sourceVersion:1,launchPhase:phase,
 curveProgress:{realQuoteReserve:'0',sellableTokens:'1',reservedTokens:'0',accruedCurveFees:'0',readyToGraduate:false},poolId:null,poolKey:null,
 canonicalRoute:{router:hex('5',40),quoter:hex('6',40),hook:hex('7',40),launchLocker:hex('8',40),graduationExecutor:hex('9',40),curveTradingEnabled:phase===0,poolTradingEnabled:phase===1,sourceVersion:1,launchPhase:phase},
 source:{chainId:46630,blockNumber:deployedAt,blockHash:hex('a',64),transactionHash:hex('b',64),transactionIndex:0,logIndex:0},
 identity:{name,symbol,metadataURI:'ipfs://test',deployedAt,blockNumber:deployedAt,blockHash:hex('a',64),runtimeCodeHash:hex('c',64)},
});

test('local Explore filters, searches, sorts and paginates discovered markets',()=>{
 const rows=[market('d',0,'Older','OLD','10'),market('e',0,'Newest Bloom','NEW','30'),market('f',1,'Graduated','GRAD','20')];
 const first=pageDirectExplore(rows,{launchPhase:0,sort:'createdAt_desc'},undefined,1);
 assert.deepEqual(first.items.map(item=>item.identity?.symbol),['NEW']);assert.equal(first.nextCursor,'local:1');
 const second=pageDirectExplore(rows,{launchPhase:0,sort:'createdAt_desc'},first.nextCursor??undefined,1);
 assert.deepEqual(second.items.map(item=>item.identity?.symbol),['OLD']);assert.equal(second.nextCursor,null);
 assert.deepEqual(pageDirectExplore(rows,{launchPhase:1,sort:'createdAt_desc'},undefined,10).items.map(item=>item.identity?.symbol),['GRAD']);
 assert.deepEqual(pageDirectExplore(rows,{launchPhase:0,sort:'name_asc',search:'bloom'},undefined,10).items.map(item=>item.identity?.symbol),['NEW']);
 assert.throws(()=>pageDirectExplore(rows,{launchPhase:0},'bad',10),/cursor/);
});
