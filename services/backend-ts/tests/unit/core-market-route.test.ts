import assert from 'node:assert/strict';
import test from 'node:test';
import {encodeFunctionResult,type Hex} from 'viem';
import {coreMarketRouteAbi,decodeCoreMarketRoute} from '../../packages/chain/src/market-route.ts';
import {f72ReadAbis} from '../../packages/events/src/f72-abis.generated.ts';
const addr=('0x'+'1'.repeat(40)) as Hex;
const route={poolKey:{currency0:'0x0000000000000000000000000000000000000000' as Hex,currency1:addr,fee:0,tickSpacing:60,hooks:addr},poolId:('0x'+'2'.repeat(64)) as Hex,hook:addr,quoteAsset:addr,memeToken:addr,gauge:addr,curve:addr,launchLocker:addr,sourceVersion:1,launchPhase:0,curveTradingEnabled:true,poolTradingEnabled:false};
test('current and historical static route results yield only protocol pool fields',()=>{
 const raw=encodeFunctionResult({abi:coreMarketRouteAbi,functionName:'canonicalRoute',result:route});
 const legacy=encodeFunctionResult({abi:f72ReadAbis.MarketRegistryV1,functionName:'canonicalRoute',result:{...route,swapRouter:addr,quoter:addr}});
 assert.deepEqual(decodeCoreMarketRoute(raw),decodeCoreMarketRoute(legacy));
 assert.equal(Object.hasOwn(decodeCoreMarketRoute(legacy),'swapRouter'),false);
 assert.throws(()=>decodeCoreMarketRoute((raw+'00') as Hex),/Unsupported/);
 assert.throws(()=>decodeCoreMarketRoute('0x'),/Unsupported/);
});
