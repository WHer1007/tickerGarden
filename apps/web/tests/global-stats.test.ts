import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateGlobalStatistics} from '../src/v1/globalStats.ts';
const hash=(n:number)=>'0x'+n.toString(16).padStart(64,'0');const address=(n:number)=>'0x'+n.toString(16).padStart(40,'0');
function fixture(){return{chainId:4663,displayOnly:true,coverage:{from:60,to:120,anchorNumber:1,anchorHash:hash(1),throughNumber:2,throughHash:hash(2),projectionNumber:3,projectionHash:hash(3)},marketCount:1,registeredStockCount:1,boundMarketCount:1,unboundMarketCount:0,stocks:[{assetUid:hash(1),stockToken:address(1),stockDecimals:8}],groups:[{assetUid:hash(1),binding:'registered_stock',quoteAsset:address(2),quoteDecimals:6,marketCount:1,tradingMarketCount:1,tradeCount:2,internalTradeCount:1,unclassifiedTradeCount:1,unknownFeeTradeCount:1,quoteVolumeRaw:'3000000',internalQuoteVolumeRaw:'1000000',volumeBasis:'CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE',fees:[{asset:address(2),decimals:6,feeRaw:'5',taxRaw:'2'}]}]};}
test('global statistics keep bound and unbound flow groups distinct',()=>{
 const p=fixture();assert.equal(validateGlobalStatistics(p,4663,60,120).groups[0]!.quoteVolumeRaw,'3000000');
 p.groups[0]!.assetUid=hash(0);p.groups[0]!.binding='unbound';p.boundMarketCount=0;p.unboundMarketCount=1;assert.equal(validateGlobalStatistics(p,4663,60,120).groups[0]!.binding,'unbound');
});
test('global statistics reject mismatched counts bindings and amounts',()=>{
 const mutations:Array<(p:ReturnType<typeof fixture>)=>void>=[p=>{p.chainId=1},p=>{p.marketCount=2},p=>{p.stocks=[]},p=>{p.groups.push(p.groups[0]!)},p=>{p.groups[0]!.binding='unbound'},p=>{p.groups[0]!.assetUid=hash(9)},p=>{p.groups[0]!.quoteDecimals=19},p=>{p.groups[0]!.fees[0]!.decimals=18},p=>{p.groups[0]!.internalQuoteVolumeRaw='4000000'},p=>{p.groups[0]!.internalTradeCount=3},p=>{p.groups[0]!.quoteVolumeRaw='01'},p=>{p.coverage.to=121},p=>{p.coverage.projectionNumber=1}];
 for(const mutate of mutations){const p=fixture();mutate(p);assert.throws(()=>validateGlobalStatistics(p,4663,60,120));}
});
test('verified empty global directory differs from unavailable data',()=>{
 const p=fixture();p.groups=[];p.marketCount=0;p.boundMarketCount=0;assert.equal(validateGlobalStatistics(p,4663,60,120).marketCount,0);assert.throws(()=>validateGlobalStatistics(null,4663,60,120));
});
