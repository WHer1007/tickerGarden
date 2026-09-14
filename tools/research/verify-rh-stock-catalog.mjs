// Offline structural and cross-source verification; optional live checks are separate.
import fs from 'node:fs';
import {encodeAbiParameters,keccak256,parseAbiParameters,parseUnits} from '../../apps/web/node_modules/viem/_esm/index.js';
const out=process.argv[2]||'outputs/reviews/rh-mainnet-stock-catalog-2026-09-12';const read=n=>JSON.parse(fs.readFileSync(`${out}/${n}`,'utf8'));let count=0;
function check(value,label){if(!value)throw new Error(label);count++}
const assets=read('raw/assets.json').assets,chain=read('raw/token-chain-state.json'),states=new Map(chain.map(a=>[a.address.toLowerCase(),a]));
check(new Set(assets.map(a=>a.id)).size===assets.length,'UID uniqueness');check(new Set(chain.map(a=>a.address.toLowerCase())).size===assets.length,'Address uniqueness');
for(const a of assets){let d=a.deployments.find(d=>d.chainId===4663),c=states.get(d.contractAddress.toLowerCase());check(c.uid.toLowerCase()===a.id.toLowerCase(),'UID '+a.tokenSymbol);check(c.decimals===a.tokenDecimals,'Decimals '+a.tokenSymbol);check(c.uiMultiplier===String(parseUnits(a.currentMultiplier,18)),'Multiplier '+a.tokenSymbol);check(c.codeBytes>0,'Code '+a.tokenSymbol);}
const factories={v2:'0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f',v3:'0x1f7d7550b1b028f7571e69a784071f0205fd2efa'};
for(const v of ['v2','v3'])for(const p of read(`raw/${v}-pool-state.json`)){check(p.verifiedToken0.toLowerCase()===p.token0.toLowerCase(),'token0');check(p.verifiedToken1.toLowerCase()===p.token1.toLowerCase(),'token1');check(p.verifiedFactory.toLowerCase()===factories[v],'factory');if(v==='v3')check(p.verifiedFee===p.fee,'fee')}
for(const p of read('raw/v4-stock-pool-events.json').events){const id=keccak256(encodeAbiParameters(parseAbiParameters('address,address,uint24,int24,address'),[p.currency0,p.currency1,p.fee,p.tickSpacing,p.hooks]));check(id.toLowerCase()===p.id.toLowerCase(),'V4 PoolId '+p.id)}
const v4=new Map(read('raw/v4-pool-state.json').map(p=>[p.id.toLowerCase(),p]));for(const t of read('raw/v4-reserves.json').pools){if(t.status!=='COMPLETE')continue;const p=v4.get(t.id.toLowerCase());check(t.result.sqrtPriceX96===p.slot0[0],'Lens sqrtPrice');check(t.result.activeLiquidity===p.activeLiquidity,'Lens liquidity');check(t.result.tick===p.slot0[1],'Lens tick');}
if(fs.existsSync(`${out}/stocks.json`)){
 check(read('summary.json').datasetStatus==='COMPLETE_WITH_DOCUMENTED_COVERAGE_LIMITS','Complete dataset status');const normalized=read('stocks.json');check(normalized.assets.length===assets.length,'Normalized all assets');
 for(const a of normalized.assets){check(a.chainId===4663,'Normalized chain');check(a.logoHttpStatus===200,'Logo availability');check(a.chainlinkFeedProxy===null,'No invented feed');}
 const pools=read('pools.json').pools;check(new Set(pools.map(p=>p.version+':'+(p.poolAddress||p.poolId))).size===pools.length,'Pool uniqueness');
 for(const p of pools){if(p.version==='v4')check(p.poolAddress===null&&p.poolId.length===66,'V4 identity representation');if(!p.corePair)check(p.estimatedPoolValueUsd===null&&p.depthQuotes.length===0,'Unmeasured scope');}
}
const result={status:'PASS',assertions:count,checkedAt:new Date().toISOString(),block:read('raw/chain-snapshot.json').number};fs.writeFileSync(`${out}/verification.json`,JSON.stringify(result,null,2)+'\n');console.log(result);
