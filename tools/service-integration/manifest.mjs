import fs from 'node:fs';
import {createPublicClient,http,keccak256} from '../../apps/web/node_modules/viem/_esm/index.js';
const root='.codex_tmp/r6-fast-test';const p=JSON.parse(fs.readFileSync(root+'/deployments/manifests/arbitrum-sepolia-421614.v1.deployed.json'));
const names=['TickerGardenFactoryV1','OfficialStockRegistryV1','ApprovedQuoteRegistry','TickerGardenBaselineRegistry','LaunchTemplateRegistry','MarketRegistryV1','ProtocolFeeVault','AllocationManager','LaunchAndBuyRouter','TreasuryDistributorV1'];
const c=createPublicClient({transport:http('https://sepolia-rollup.arbitrum.io/rpc')});if(await c.getChainId()!==421614)throw Error('wrongchain');
const genesis=await c.getBlock({blockNumber:0n}),block=await c.getBlock({blockTag:'finalized'}),contracts=[];
for(const module of names){const item=p.contracts.find(x=>x.name===module);if(!item)throw Error(module);const address=item.address.toLowerCase();const code=await c.request({method:'eth_getCode',params:[address,{blockHash:block.hash,requireCanonical:true}]});if(!code||code==='0x')throw Error('absent code');contracts.push({module,address,runtimeCodeHash:keccak256(code)});}
const out='outputs/reviews/formal-clock-service-integration-2026-09-06/service-live';fs.writeFileSync(out+'/manifest.json',JSON.stringify({executionSpecId:'V1-EXEC-11',chainId:421614,genesisHash:genesis.hash,contracts},null,2));fs.writeFileSync(out+'/manifest-observation.json',JSON.stringify({releaseId:p.releaseId,blockNumber:String(block.number),blockHash:block.hash,at:new Date().toISOString()},null,2));
