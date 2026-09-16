import fs from 'node:fs';
import {createPublicClient,http,keccak256} from '../apps/web/node_modules/viem/_esm/index.js';
const root=new URL('../',import.meta.url).pathname;
const j=p=>JSON.parse(fs.readFileSync(root+p));
const candidate=j('outputs/reviews/arbitrum-continuous-preflight-2026-09-07/candidate.preview.json');
const p=j('deployments/releases/'+candidate.releaseId+'/arbitrum-sepolia-421614.v1.deployed.json');
const c=createPublicClient({transport:http('https://sepolia-rollup.arbitrum.io/rpc')});if(await c.getChainId()!==421614)throw Error('Wrong chain');
const block=await c.getBlock(),genesis=await c.getBlock({blockNumber:0n});
const names=['TickerGardenFactoryV1','OfficialStockRegistryV1','ApprovedQuoteRegistry','TickerGardenBaselineRegistry','LaunchTemplateRegistry','MarketRegistryV1','ProtocolFeeVault','AllocationManager','LaunchAndBuyRouter','HolderRewardsDistributorV1'];
const contracts=names.map(module=>{const x=p.contracts.find(c=>c.name===module);if(!x)throw Error(module);return {module,address:x.address.toLowerCase(),runtimeCodeHash:x.runtimeCodeHash};});
const markets={};
for(const source of ['outputs/reviews/continuous-public-acceptance-2026-09-07/results.json','outputs/reviews/continuous-v4-public-2026-09-07/results.json']){
 const run=j(source);if(run.releaseId!==p.releaseId)throw Error('Different release');
 for(const m of Object.values(run.markets)){
  const token=m.token.toLowerCase(),code=await c.getCode({address:token,blockNumber:block.number});
  markets[m.id]={marketId:m.id,state:{memeToken:token,quoteAsset:(m.quote??'0x0000000000000000000000000000000000000000').toLowerCase(),creatorFeesToHolders:true},contracts:[{module:'TickerMemeTokenV1',address:token,runtimeCodeHash:keccak256(code)}]};
 }
}
const fixture={manifest:{executionSpecId:'V1-EXEC-11',chainId:421614,genesisHash:genesis.hash,contracts},markets,blockNumber:'0x'+block.number.toString(16),blockHash:block.hash,scope:'PUBLIC_CHAIN_CANONICAL_HEAD_NOT_FINALIZED_PIPELINE',releaseId:p.releaseId};
fs.writeFileSync(root+'outputs/reviews/continuous-release-acceptance-2026-09-07/observer-fixture.json',JSON.stringify(fixture,null,2)+'\n');console.log('OBSERVER_FIXTURE_PREPARED');
