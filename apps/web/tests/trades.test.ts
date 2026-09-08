import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateTradePage} from '../src/v1/trades.ts';
const id={marketId:`0x${'1'.repeat(64)}` as `0x${string}`,memeAsset:`0x${'2'.repeat(40)}`,quoteAsset:`0x${'3'.repeat(40)}`,quoteDecimals:18};
function fixture(){return {chainId:4663,displayOnly:true,...id,coverage:{from:60,to:120,anchorNumber:1,throughNumber:4,projectionNumber:5,anchorHash:id.marketId,throughHash:id.marketId,projectionHash:id.marketId},revision:'sha256:'+'1'.repeat(64),nextCursor:null as string|null,items:[{source:{chainId:4663,blockNumber:'3',blockHash:id.marketId,transactionHash:id.marketId,transactionIndex:0,logIndex:1,emitter:id.memeAsset,eventKey:`4663:${id.marketId}:1`},venue:'pool',marketId:id.marketId,timestamp:'100',side:'sell',classification:'internal_reward_conversion',actor:null,recipient:null,actorConfidence:'unavailable',memeAsset:id.memeAsset,quoteAsset:id.quoteAsset,quoteDecimals:18,memeRaw:'10',quoteRaw:'100',price:{numerator:'10',denominator:'1'},priceUnit:'QUOTE_PER_WHOLE_MEME',amountBasis:'POOL_CORE',feeRaw:null,feeAsset:null,taxRaw:null,feeStatus:'not_provided'}]};}
test('trade page validates identities amounts and paging continuity',()=>{
 const v=fixture();v.nextCursor='next';const first=validateTradePage(v,4663,id,60,120,1);
 const next=fixture();next.items[0]!.source.logIndex=0;next.items[0]!.source.eventKey=`4663:${id.marketId}:0`;
 assert.equal(validateTradePage(next,4663,id,60,120,1,first).nextCursor,null);
 assert.throws(()=>validateTradePage(v,4663,id,60,120,1,first));
 next.revision='sha256:'+'2'.repeat(64);assert.throws(()=>validateTradePage(next,4663,id,60,120,1,first));
});
test('trade page rejects wrong identity price provenance and fake fee',()=>{
 for(const mode of ['chain','amount','timestamp','eventkey','confidence','price','duplicate']){
 const v=fixture();switch(mode){case 'chain':v.chainId=1;break;case 'amount':v.items[0]!.quoteRaw='0';break;case 'timestamp':v.items[0]!.timestamp='120';break;case 'eventkey':v.items[0]!.source.eventKey='wrong';break;case 'confidence':v.items[0]!.actorConfidence='verified';break;case 'price':v.items[0]!.price.numerator='11';break;case 'duplicate':v.items.push(v.items[0]!);break;}
 assert.throws(()=>validateTradePage(v,4663,id,60,120,50),mode);
 }
});
test('Pool sender remains an immediate caller rather than verified wallet',()=>{
 const value=fixture();
 const page={...value,items:[{...value.items[0]!,actor:id.memeAsset,actorConfidence:'contract_caller_not_verified_wallet'}]};
 assert.equal(validateTradePage(page,4663,id,60,120,50).items[0]!.actor,id.memeAsset);
 page.items[0]!.actorConfidence='verified_wallet';assert.throws(()=>validateTradePage(page,4663,id,60,120,50));
});

test('trade enums reject non-string JSON values without coercion',()=>{
 for(const [field,values] of [
  ['side',['buy','sell']],
  ['classification',['unclassified','internal_reward_conversion','internal_holder_conversion']],
 ] as const){
  for(const label of values){
   const source=fixture();
   const malformed={...source,items:source.items.map(item=>({...item,[field]:[label]}))};
   assert.throws(()=>validateTradePage(JSON.parse(JSON.stringify(malformed)),4663,id,60,120,50),`${field} array ${label}`);
  }
 }
});
