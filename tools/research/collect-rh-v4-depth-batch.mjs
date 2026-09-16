import {parseAbi,encodeFunctionData,decodeFunctionResult} from '../../apps/web/node_modules/viem/_esm/index.js';
import {read,write,c,bn} from './rh-catalog-common.mjs';
const refs=read('raw/depth-price-basis.json').refs,pools=read('raw/v4-pool-state.json'),rows=[],jobs=[];
const zero='0x0000000000000000000000000000000000000000',Q192=2n**192n,E18=10n**18n;
const quoter='0x8dc178efb8111bb0973dd9d722ebeff267c98f94';
const abi=parseAbi(['function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns(uint256 amountOut,uint256 gasEstimate)']);
const agg=parseAbi(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)']);
for(const p of pools){
 const a=p.currency0.toLowerCase(),b=p.currency1.toLowerCase();const row={version:'v4',pool:p.id,token0:a,token1:b,quotes:[]};rows.push(row);
 if(!refs[a]||!refs[b]){row.status='MISSING_REFERENCE_PRICE';continue}
 if(!p.slot0||!p.activeLiquidity){row.status='READ_FAILED';continue}
 if(BigInt(p.activeLiquidity)===0n){row.status=p.hooks.toLowerCase()===zero?'ZERO_ACTIVE_LIQUIDITY_NOT_QUOTED':'ZERO_CORE_LIQUIDITY_HOOK_ROUTE_UNASSESSED';continue}
 for(const reverse of [false,true])for(const usd of [100,1000,10000]){
  const ti=reverse?b:a,to=reverse?a:b;
  const amountIn=BigInt(usd)*E18*10n**BigInt(refs[ti].decimals)/BigInt(refs[ti].usd18);
  const sq=BigInt(p.slot0[0])**2n;
  const q={direction:reverse?'1_TO_0':'0_TO_1',inputNotionalUsd:usd,amountIn,spotExpectedRaw:reverse?amountIn*Q192/sq:amountIn*sq/Q192,method:'V4_QUOTER_MULTICALL_ETH_CALL_EMPTY_HOOK_DATA'};
  row.quotes.push(q);
  const params={poolKey:{currency0:p.currency0,currency1:p.currency1,fee:p.fee,tickSpacing:p.tickSpacing,hooks:p.hooks},zeroForOne:!reverse,exactAmount:amountIn,hookData:'0x'};
  jobs.push({q,params,to});
 }
}
async function single(j){try{const {result}=await c.simulateContract({address:quoter,abi,functionName:'quoteExactInputSingle',args:[j.params],blockNumber:bn,gas:3000000n});return result}catch(e){j.q.errorName=e.name;return null}}
function assign(j,result){const q=j.q;if(!result){q.status='QUOTE_FAILED';return;}const [amountOut,gasEstimate]=result;q.amountOut=amountOut;q.gasEstimate=gasEstimate;q.status=amountOut>0n?'QUOTED':'ZERO_OUTPUT';q.executionShortfallBps=q.spotExpectedRaw>0n?(q.spotExpectedRaw-amountOut)*10000n/q.spotExpectedRaw:null;q.outputReferenceUsd18=amountOut*BigInt(refs[j.to].usd18)/10n**BigInt(refs[j.to].decimals);}
async function batch(part){
 try{
  const {result}=await c.simulateContract({address:'0xca11bde05977b3631167028862be2a173976ca11',abi:agg,functionName:'aggregate3',args:[part.map(j=>({target:quoter,allowFailure:true,callData:encodeFunctionData({abi,functionName:'quoteExactInputSingle',args:[j.params]})}))],blockNumber:bn,gas:30000000n});
  for(let i=0;i<part.length;i++){const r=result[i];assign(part[i],r.success?decodeFunctionResult({abi,functionName:'quoteExactInputSingle',data:r.returnData}):await single(part[i]));}
 }catch(e){if(part.length===1){assign(part[0],await single(part[0]));return;}const m=Math.floor(part.length/2);await batch(part.slice(0,m));await batch(part.slice(m));}
}
console.log('V4 quotes',jobs.length);
for(let i=0;i<jobs.length;i+=144){await Promise.all([0,36,72,108].filter(j=>i+j<jobs.length).map(j=>batch(jobs.slice(i+j,i+j+36))));if(i%720===0)console.log('quotes',Math.min(i+144,jobs.length),'/',jobs.length);}
write('raw/v4-depth-quotes.json',rows);
