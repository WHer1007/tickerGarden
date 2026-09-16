import {parseAbi} from '../../apps/web/node_modules/viem/_esm/index.js';
import {read,write,c,bn} from './rh-catalog-common.mjs';
const all=read('pools.json').pools;
const samples=all.filter(p=>p.version==='v4'&&p.hooks==='0x0000000000000000000000000000000000000000'&&p.twoWay2PctSampleUsd>=1000&&p.estimatedPoolValueUsd).sort((a,b)=>Number(b.estimatedPoolValueUsd)-Number(a.estimatedPoolValueUsd)).slice(0,3);
const abi=parseAbi(['function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns(uint256 amountOut,uint256 gasEstimate)']);
const checks=[];
for(const p of samples)for(const q of p.depthQuotes.filter(q=>q.inputNotionalUsd===1000)){
 const {result}=await c.simulateContract({address:'0x8dc178efb8111bb0973dd9d722ebeff267c98f94',abi,functionName:'quoteExactInputSingle',args:[{poolKey:{currency0:p.token0,currency1:p.token1,fee:p.feePipsAtCreation,tickSpacing:p.tickSpacing,hooks:p.hooks},zeroForOne:q.direction==='0_TO_1',exactAmount:BigInt(q.amountIn),hookData:'0x'}],blockNumber:bn,gas:3000000n});
 if(result[0]!==BigInt(q.amountOut))throw new Error('Batch/direct amount mismatch '+p.poolId);
 checks.push({poolId:p.poolId,direction:q.direction,amountIn:q.amountIn,amountOut:q.amountOut,status:'MATCH'});
}
if(checks.length!==6)throw new Error('Expected 6 independent live checks');
write('live-sample-verification.json',{status:'PASS',block:bn,checkedAt:new Date().toISOString(),checks});console.log('6 direct quotes match batch snapshot');
