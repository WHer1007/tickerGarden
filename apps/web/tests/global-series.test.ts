import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateGlobalSeries} from '../src/v1/globalSeries.ts';
const hash=(n:number)=>'0x'+n.toString(16).padStart(64,'0');const address=(n:number)=>'0x'+n.toString(16).padStart(40,'0');
function fixture(){return{chainId:4663,displayOnly:true,interval:3600,volumeBasis:'CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE',emptyPolicy:'ZERO_FLOW_NO_SYNTHETIC_EXECUTIONS',coverage:{from:3600,to:90000,anchorNumber:1,anchorHash:hash(1),throughNumber:2,throughHash:hash(2),projectionNumber:3,projectionHash:hash(3)},points:Array.from({length:24},(_,i)=>({timestamp:3600+i*3600,groups:[{assetUid:hash(1),binding:'registered_stock',quoteAsset:address(2),quoteDecimals:6,tradeCount:i===1?1:0,internalTradeCount:i===1?1:0,unclassifiedTradeCount:0,unknownFeeTradeCount:i===1?1:0,quoteVolumeRaw:i===1?'3000000':'0',internalQuoteVolumeRaw:i===1?'3000000':'0',fees:[] as Array<{asset:string;decimals:number;feeRaw:string;taxRaw:string}>}]}))};}
test('global series preserves empty hours and exact internal flows',()=>{
 const p=fixture();const got=validateGlobalSeries(p,4663,3600,90000);assert.equal(got.points.length,24);assert.equal(got.points[0]!.groups[0]!.quoteVolumeRaw,'0');assert.equal(got.points[1]!.groups[0]!.internalQuoteVolumeRaw,'3000000');
});
test('global series rejects missing buckets groups and mixed units',()=>{
 const mutations:Array<(p:ReturnType<typeof fixture>)=>void>=[p=>{p.points.pop()},p=>{p.points[1]!.timestamp++},p=>{p.points[1]!.groups=[]},p=>{p.points[1]!.groups[0]!.quoteDecimals=18},p=>{p.points[1]!.groups[0]!.binding='unbound'},p=>{p.points[1]!.groups.push(p.points[1]!.groups[0]!)},p=>{p.points[0]!.groups[0]!.quoteVolumeRaw='1'},p=>{p.points[1]!.groups[0]!.internalQuoteVolumeRaw='4000000'},p=>{p.points[1]!.groups[0]!.tradeCount=2},p=>{p.points[1]!.groups[0]!.fees=[{asset:address(2),decimals:18,feeRaw:'1',taxRaw:'0'}]},p=>{p.emptyPolicy='CARRY_FORWARD'},p=>{p.coverage.throughNumber=4}];
 for(const mutate of mutations){const p=fixture();mutate(p);assert.throws(()=>validateGlobalSeries(p,4663,3600,90000));}
});
test('empty directory must remain consistent in all buckets',()=>{const p=fixture();for(const point of p.points)point.groups=[];assert.equal(validateGlobalSeries(p,4663,3600,90000).points[0]!.groups.length,0);});
