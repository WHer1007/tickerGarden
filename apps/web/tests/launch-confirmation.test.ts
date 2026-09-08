import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encodeAbiParameters,encodeEventTopics,parseAbiParameters,type TransactionReceipt} from 'viem';
import {v1Abis} from '../src/v1/generated/abis.ts';
import {assertRecoveredLaunchReceipt} from '../src/create/launch-confirmation.ts';
import type {LaunchState} from '../src/create/launch-state.ts';
const a='0x1111111111111111111111111111111111111111',b='0x2222222222222222222222222222222222222222',c='0x3333333333333333333333333333333333333333';
const id=`0x${'1'.repeat(64)}` as const;
const state:LaunchState={version:1,id:'test',chainId:46630,account:a,phase:'pending',detail:'',intent:JSON.stringify([b,'createMarket',[],0]),expected:{factory:b,token:c,curve:a,gauge:b,marketId:id}};
function receipt(){return {status:'success',from:a,to:b,logs:[{address:b,topics:encodeEventTopics({abi:v1Abis.TickerGardenFactoryV1,eventName:'MarketCreated',args:{marketId:id,assetUid:id,memeToken:c}}) as [typeof id,...typeof id[]],blockHash:id,blockNumber:1n,transactionHash:id,logIndex:0,transactionIndex:0,removed:false,data:encodeAbiParameters(parseAbiParameters('address,address,address,bytes32,bytes32,bytes32'),[a,b,c,id,id,id])}]} as Pick<TransactionReceipt,'status'|'from'|'to'|'logs'>;}
test('recovery confirms matching factory and predicted market from receipt alone',()=>assert.doesNotThrow(()=>assertRecoveredLaunchReceipt(state,receipt())));
test('recovery rejects unrelated receipts, spoofed factories and different token identity',()=>{
 for(const change of [{status:'reverted'},{from:c},{to:c},{logs:[]}] as Partial<Pick<TransactionReceipt,'status'|'from'|'to'|'logs'>>[])assert.throws(()=>assertRecoveredLaunchReceipt(state,{...receipt(),...change}));
 const spoof=receipt();spoof.logs[0]!.address=c;assert.throws(()=>assertRecoveredLaunchReceipt(state,spoof));
 assert.throws(()=>assertRecoveredLaunchReceipt({...state,expected:{...state.expected!,token:b}},receipt()));
});
