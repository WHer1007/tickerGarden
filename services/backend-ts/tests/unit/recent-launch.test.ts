import assert from 'node:assert/strict';
import test from 'node:test';
import {encodeAbiParameters,encodeEventTopics,type AbiEvent} from 'viem';
import {RpcTransport} from '../../packages/chain/src/index.ts';
import {f72EventCatalog,CURRENT_RELEASE_ID} from '../../packages/events/src/index.ts';
import {f72BootstrapConfigs} from '../../packages/config-projector/src/f72-bootstrap.generated.ts';
import {recordRecentLaunch,recordRecentLaunchTrigger} from '../../packages/market-projector/src/recent.ts';
import {creationDetail} from '../../packages/market-projector/src/recent-detail.ts';
const hash=(c:string):`0x${string}`=>`0x${c.repeat(64)}`;
const address=(c:string):`0x${string}`=>`0x${c.repeat(40)}`;
const tx=hash('1'),block=hash('2'),token=address('3'),curve=address('4');
const deployment={environment:'test' as const,chainId:46630 as const,deploymentDigest:CURRENT_RELEASE_ID,activationBlock:1n};
function rpc(result:unknown){return new RpcTransport({url:'https://rpc.example',fetch:async(_url,init)=>{const request=JSON.parse(String(init?.body));return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result:request.method==='eth_chainId'?'0xb626':result}));}});}
function log(module:keyof typeof f72EventCatalog,eventName:string,emitter:`0x${string}`,args:Record<string,unknown>,index:number){
 const event=f72EventCatalog[module].abi.find(e=>e.type==='event'&&e.name===eventName) as AbiEvent;
 return {address:emitter,blockHash:block,blockNumber:'0xa',transactionHash:tx,transactionIndex:'0x0',logIndex:`0x${index.toString(16)}`,removed:false,
  topics:encodeEventTopics({abi:[event],eventName,args}),data:encodeAbiParameters(event.inputs.filter(i=>!i.indexed),event.inputs.filter(i=>!i.indexed).map(i=>args[i.name!]))};
}
test('launch notification deduplicates stored records and rejects non-creation receipts',async()=>{
 const noRpc={call:async()=>assert.fail('duplicate must not use RPC')} as unknown as RpcTransport;
 const pool={query:async()=>({rows:[{market_id:hash('a')}]})} as any;
 assert.equal((await recordRecentLaunch({pool,deployment,primary:noRpc,secondary:noRpc},tx)).marketId,hash('a'));
 for(const receipt of [null,{transactionHash:tx,status:'0x0',logs:[]},{transactionHash:hash('9'),status:'0x1',logs:[]},{transactionHash:tx,status:'0x1',logs:[]}]){
  let writes=0;const db={query:async(sql:string)=>{if(sql.startsWith('INSERT'))writes++;return{rows:[]};}} as any;
  await assert.rejects(()=>recordRecentLaunch({pool:db,deployment,primary:rpc(receipt),secondary:rpc(receipt)},tx));assert.equal(writes,0);
 }
});
test('removed creation invalidates only its transaction and block',async()=>{
 const calls:any[]=[];const pool={query:async(...args:any[])=>{calls.push(args);return{rows:[]};}} as any;
 const noRpc={call:async()=>assert.fail('removed trigger is a database invalidation')} as unknown as RpcTransport;
 const event=f72EventCatalog.TickerGardenFactoryV1.abi.find(e=>e.type==='event'&&e.name==='MarketCreated') as AbiEvent;
 const topics=encodeEventTopics({abi:[event],eventName:'MarketCreated'});
 await recordRecentLaunchTrigger({pool,deployment,primary:noRpc,secondary:noRpc},{log:{address:f72EventCatalog.TickerGardenFactoryV1.address,topics:[topics[0],hash('a')],blockNumber:'10',removed:true,transactionHash:tx,blockHash:block}});
 assert.equal(calls.length,1);assert.deepEqual(calls[0][1].slice(-2),[tx,block]);assert.match(calls[0][0],/canonical=false/);
});
test('creation analytics includes initial mint and buy without any finalized journal',()=>{
 const baseline=f72BootstrapConfigs.find(c=>c.kind==='baseline')!;
 const quote=f72BootstrapConfigs.find(c=>c.kind==='quote'&&c.values.quoteAsset===address('0'))!;
 const supply=String(baseline.values.supply),buyer=address('5'),amount=10n**18n;
 const market={marketId:hash('a'),memeToken:token,curve,gauge:address('0'),quoteAsset:address('0'),quoteAssetConfigId:quote.id as `0x${string}`,tickerGardenBaselineId:baseline.id as `0x${string}`,poolId:null,poolKey:null,source:{blockNumber:'10'}};
 const logs=[log('TickerMemeTokenV1','Transfer',token,{from:address('0'),to:curve,value:BigInt(supply)},0),
  log('TickerMemeTokenV1','Transfer',token,{from:curve,to:buyer,value:amount},1),
  log('TickerGardenCurve','CurveBuy',curve,{buyer,recipient:buyer,quoteIn:10n**16n,tokensOut:amount,fee:0n,tax:0n},2)];
 const receipt={logs};const result=creationDetail([receipt,receipt],market,1000n,46630);
 assert.equal(result.confirmation,'confirmed');assert.equal(result.holders.count,1);assert.equal(result.holders.circulatingSupplyRaw,amount.toString());assert.equal(result.trades.length,1);assert.equal(result.trades[0]?.price,'0.01');assert.equal(result.statistics.price,'0.01');assert.equal(result.statistics.volume24h,'0.01');assert.equal(result.statistics.volumeTo,1000);
 assert.throws(()=>creationDetail([receipt,{logs:logs.slice(0,1)}],market,1000n,46630),/complete launch receipt/);
 const altered=[...logs];altered[0]=log('TickerMemeTokenV1','Transfer',token,{from:address('0'),to:buyer,value:BigInt(supply)},0);
 assert.throws(()=>creationDetail([{logs:altered},{logs:altered}],market,1000n,46630),/initial mint/);
});
