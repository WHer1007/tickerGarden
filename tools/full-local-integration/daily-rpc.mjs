// Deterministic, no-network contract read provider for normal projector capacity.
// Real ABI decoding/encoding is retained. This is not an EVM execution claim.
import {decodeFunctionData,encodeFunctionResult,parseAbi,keccak256,toFunctionSelector} from '../../apps/web/node_modules/viem/_esm/index.js';
import {f72ReadAbis,f72EventCatalog} from '../../services/backend-ts/packages/events/src/index.ts';
import {snapshotAbis} from '../../services/backend-ts/packages/events/src/f72-abis.generated.ts';
import {lpMarketRecordAbi} from '../../services/backend-ts/packages/chain/src/market-record.ts';
import {coreMarketRouteAbi} from '../../services/backend-ts/packages/chain/src/market-route.ts';
import {SNAPSHOT_MODE} from '../../services/backend-ts/packages/chain/src/holder-snapshot.ts';
const h=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),a=n=>'0x'+BigInt(n).toString(16).padStart(40,'0');
const extra=parseAbi(['function totalSupply() view returns(uint256)','function decimals() view returns(uint8)','function getReserves() view returns(uint256,uint256)','function effectiveTotalActiveStock() view returns(uint256)','function marketAllocated(bytes32,bytes32) view returns(uint256)','function extsload(bytes32) view returns(bytes32)']);
const allAbi=[...lpMarketRecordAbi,...coreMarketRouteAbi,...Object.values(f72ReadAbis).flat(),...snapshotAbis.HolderRewardsDistributorV1,...extra];
const bySelector=new Map();for(const item of allAbi)if(item.type==='function'){const selector=toFunctionSelector(item);if(!bySelector.has(selector))bySelector.set(selector,item);}
export function dailyRpc(markets,now){
 const byId=new Map(markets.map(m=>[m.marketId,m])),byAddress=new Map(markets.flatMap(m=>[[m.memeToken,m],[m.curve,m],[m.gauge,m]]));
 const cache=new Map();
 return{calls:0,
 async block(number){return{number,hash:h(899996+Number(number)),parentHash:h(899995+Number(number)),timestamp:BigInt(now)}},
 async codeHash(){this.calls++;return h(77)},
 async call(method){throw Error('Unexpected non-local fixture RPC '+method)},
 async callAt(target,data,block){
  this.calls++;const key=target+':'+data; if(cache.has(key))return cache.get(key);
  const selected=[bySelector.get(data.slice(0,10))];const call=decodeFunctionData({abi:selected,data}),fn=call.functionName,args=call.args??[];
  const m=byId.get(String(args[0]).toLowerCase())??byAddress.get(String(args[0]).toLowerCase())??byAddress.get(target.toLowerCase());
  let value,abi=selected;
  if(fn==='market') {abi=lpMarketRecordAbi;value={config:{assetUid:m.assetUid,tickerGardenBaselineId:m.tickerGardenBaselineId,quoteAssetConfigId:m.quoteAssetConfigId,launchTemplateId:h(44),feePolicyId:h(45),executionSpecId:keccak256(new TextEncoder().encode('V1-EXEC-11')),expectedEconomics:h(87),launchConfigId:1n,creatorRevenueBeneficiaryAtCreation:m.creator,memeToken:m.memeToken,curve:m.curve,gauge:m.gauge,quoteAsset:m.quoteAsset,graduatedHook:f72EventCatalog.TickerGardenMemeHook.address,creatorTaxBps:m.display.creatorTaxBps,creatorFeesToHolders:m.creatorFeesToHolders,stakingEnabled:m.stakingEnabled,burnMemeFees:m.burnMemeFees,lpFeePips:m.lpFeePips},runtime:{poolId:m.poolId??h(0),sourceVersion:m.sourceVersion,launchPhase:m.launchPhase}};}
  else if(fn==='canonicalRoute'){abi=coreMarketRouteAbi;value={poolKey:m.testPoolKey,poolId:m.testPoolId,hook:f72EventCatalog.TickerGardenMemeHook.address,quoteAsset:m.quoteAsset,memeToken:m.memeToken,gauge:m.gauge,curve:m.curve,launchLocker:a(600000+Number(BigInt(m.marketId))),sourceVersion:m.sourceVersion,launchPhase:m.launchPhase,curveTradingEnabled:m.launchPhase===0,poolTradingEnabled:m.launchPhase===1};}
  else if(fn==='canonicalPoolKey')value=m.testPoolKey;
  else if(fn==='canonicalPoolId')value=m.testPoolId;
  else if(fn==='marketIdByToken'||fn==='marketId')value=m.marketId;
  else if(fn==='graduationExecutor')value=a(700003);
  else if(fn==='quoteAsset')value=m.quoteAsset;
  else if(fn==='creatorTaxBps')value=m.display.creatorTaxBps;
  else if(fn==='realQuoteReserve'||fn==='sellableTokens'||fn==='reservedTokens'||fn==='accruedCurveFees')value=BigInt(m.curveProgress[fn]);
  else if(fn==='readyToGraduate')value=false;
  else if(fn==='factory')value=f72EventCatalog.TickerGardenFactoryV1.address;
  else if(fn==='name'||fn==='symbol'||fn==='metadataURI')value=m.identity[fn];
  else if(fn==='deployedAt')value=BigInt(m.identity.deployedAt);
  else if(fn==='totalSupply')value=10n**27n;
  else if(fn==='decimals')value=18;
  else if(fn==='getReserves')value=[10n**19n,10n**27n];
  else if(fn==='effectiveTotalActiveStock'||fn==='marketAllocated')value=0n;
  else if(fn==='extsload')value=h(1n<<96n);
  else if(fn==='rewardMode')value=SNAPSHOT_MODE;
  else if(fn==='snapshotPublisher')value=a(99);
  else if(fn==='marketState')value={token:m.memeToken,quote:m.quoteAsset,vault:a(770000),registeredBlock:1n,lastRound:0n,lastSnapshotBlock:0n,unallocatedQuote:0n,unallocatedMeme:0n,burnMemeFees:m.burnMemeFees};
  else if(fn==='feeSharingExcludedAccounts')value=[m.curve,m.memeToken];
  else throw Error('Unknown fixture function '+fn);
  const result=encodeFunctionResult({abi,functionName:fn,result:value});
  // Bound fixture memory independently of the market population.
  if(cache.size>4096)cache.clear();cache.set(key,result);return result;
 }};
}
