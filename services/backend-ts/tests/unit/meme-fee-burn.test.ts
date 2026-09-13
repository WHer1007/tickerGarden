import assert from 'node:assert/strict';
import test from 'node:test';
import {encodeFunctionResult,encodeAbiParameters,encodeEventTopics,type Hex} from 'viem';
import {legacyMarketRecordAbi,burnMarketRecordAbi,decodeMarketRecord} from '../../packages/chain/src/market-record.ts';
import {aggregateMemeFeeBurns} from '../../packages/history-projector/src/index.ts';
import {protocolEventAbi,decodeF72Event,eventTopicsForModules,eventTopic} from '../../packages/events/src/index.ts';
import {rebuildHolderSnapshot} from '../../packages/analytics/src/index.ts';
const h=(c:string)=>`0x${c.repeat(64)}` as Hex,a=(c:string)=>`0x${c.repeat(40)}` as Hex;
const config={assetUid:h('1'),tickerGardenBaselineId:h('2'),quoteAssetConfigId:h('3'),launchTemplateId:h('4'),feePolicyId:h('5'),executionSpecId:h('6'),expectedEconomics:h('7'),launchConfigId:0n,creatorRevenueBeneficiaryAtCreation:a('1'),memeToken:a('2'),curve:a('3'),gauge:a('4'),quoteAsset:a('5'),graduatedHook:a('6'),creatorTaxBps:200,creatorFeesToHolders:true,stakingEnabled:true};
const runtime={poolId:h('8'),sourceVersion:2,launchPhase:1};
test('market return decoding preserves runtime offsets for old and burn-enabled versions',()=>{
 const old=encodeFunctionResult({abi:legacyMarketRecordAbi,functionName:'market',result:{config,runtime}});
 const next=encodeFunctionResult({abi:burnMarketRecordAbi,functionName:'market',result:{config:{...config,burnMemeFees:true},runtime}});
 assert.deepEqual(decodeMarketRecord(old),{config:{...config,burnMemeFees:false},runtime});
 assert.deepEqual(decodeMarketRecord(next),{config:{...config,burnMemeFees:true},runtime});
 assert.throws(()=>decodeMarketRecord(`${next}00`));assert.throws(()=>decodeMarketRecord('0x'));
});
function burn(role:number,index=role,amount=10n) {
 const abi=protocolEventAbi('ProtocolFeeVault');
 const log={address:a('9'),blockNumber:100n,blockHash:h('a'),transactionHash:h('b'),transactionIndex:0n,logIndex:BigInt(index),removed:false,
  topics:encodeEventTopics({abi,eventName:'MemeFeesBurned',args:{marketId:h('1'),beneficiary:role===2?a('0'):a('1'),role}}) as Hex[],
  data:encodeAbiParameters([{type:'uint32'},{type:'address'},{type:'uint256'}],[role===0?1:0,a('2'),amount])};
 const event=decodeF72Event('ProtocolFeeVault',log);assert.ok(event);return {event,occurredAt:new Date(0)};
}
const market={marketId:h('1'),memeToken:a('2'),burnMemeFees:true};
test('burn events are ingested and totaled separately by ownership; no Platform bucket',()=>{
 assert.ok(eventTopicsForModules(['ProtocolFeeVault']).includes(eventTopic('ProtocolFeeVault','MemeFeesBurned')));
 const rows=aggregateMemeFeeBurns([burn(0),burn(1),burn(2)],[market]);
 assert.equal(rows[0]!.totalRaw,'30');assert.equal(rows[0]!.holderRaw,'10');
 assert.throws(()=>aggregateMemeFeeBurns([burn(3)],[market]));
 assert.throws(()=>aggregateMemeFeeBurns([burn(0),burn(0)],[market]));
 assert.throws(()=>aggregateMemeFeeBurns([burn(0)],[{...market,burnMemeFees:false}]));
 assert.equal(aggregateMemeFeeBurns([],[market])[0]!.totalRaw,'0');
});
test('canonical token burns reduce supply without creating a zero-address holder; replay reconciles',()=>{
 const transfer=(from:Hex,to:Hex,value:string,index:number)=>({from,to,value,source:{chainId:46630 as const,emitter:a('2'),blockNumber:'100',blockHash:h('a'),transactionHash:h('b'),transactionIndex:0,logIndex:index,eventKey:`${index}`}});
 const transfers=[transfer(a('0'),a('3'),'100',0),transfer(a('3'),a('1'),'40',1),transfer(a('1'),a('0'),'10',2),transfer(a('1'),a('0'),'0',3)];
 const input={chainId:46630 as const,token:a('2'),initialHolder:a('3'),burnAuthority:null,initialSupplyRaw:'100',transfers,excludedAccounts:[a('3')]};
 const result=rebuildHolderSnapshot({...input,allowSelfBurn:true});
 assert.equal(result.totalSupplyRaw,'90');assert.equal(result.balances.find(x=>x.account===a('1'))!.balanceRaw,'30');assert.ok(!result.balances.some(x=>x.account===a('0')));
 assert.throws(()=>rebuildHolderSnapshot(input));
});
