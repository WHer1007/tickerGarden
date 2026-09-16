// Read-only eth_call quotes at a single finalized block; never sends a transaction.
import fs from 'node:fs';
import {parseAbi,parseUnits,formatUnits} from '../../apps/web/node_modules/viem/_esm/index.js';
import {out,read,write,c,bn,chunks} from './rh-catalog-common.mjs';
const E18=10n**18n,Q192=2n**192n;
const zero='0x0000000000000000000000000000000000000000',weth='0x0bd7d308f8e1639fab988df18a8011f41eacad73',usdg='0x5fc5360d0400a0fd4f2af552add042d716f1d168';
const assets=read('raw/assets.json').assets;
const prices=fs.existsSync(`${out}/raw/prices-by-symbol.json`)?read('raw/prices-by-symbol.json').flatMap(x=>x.response?.quotes||[]):read('raw/prices.json').quotes;
const refs={};
for(const a of assets){const p=prices.find(p=>p.tokenSymbol===a.tokenSymbol);const address=a.deployments.find(x=>x.chainId===4663)?.contractAddress.toLowerCase();if(!p||!address)continue;const bid=parseUnits(p.bid,18),ask=parseUnits(p.ask,18);if(bid<=0||ask<=0)continue;
 refs[address]={symbol:a.tokenSymbol,decimals:a.tokenDecimals,usd18:(bid+ask)/2n*parseUnits(a.currentMultiplier,18)/E18,source:'RH_REST_MID_TIMES_MULTIPLIER',generatedAt:p.generatedAt};}
const baseAbi=parseAbi(['function decimals() view returns(uint8)','function getPool(address,address,uint24) view returns(address)','function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint8,bool)','function liquidity() view returns(uint128)','function balanceOf(address) view returns(uint256)']);
const ud=await c.readContract({address:usdg,abi:baseAbi,functionName:'decimals',blockNumber:bn});
refs[usdg]={symbol:'USDG',decimals:ud,usd18:E18,source:'USDG_NOMINAL_1_USD_ASSUMPTION_NOT_MARKET_PRICE'};
let bases=[];
for(const fee of [100,500,3000,10000]){
 const address=await c.readContract({address:'0x1f7d7550b1b028f7571e69a784071f0205fd2efa',abi:baseAbi,functionName:'getPool',args:[weth,usdg,fee],blockNumber:bn});if(address===zero)continue;
 const slot0=await c.readContract({address,abi:baseAbi,functionName:'slot0',blockNumber:bn});
 const balance=await c.readContract({address:usdg,abi:baseAbi,functionName:'balanceOf',args:[address],blockNumber:bn});
 bases.push({address,fee,slot0,usdgBalance:balance,usd18:slot0[0]**2n*10n**18n*E18/(Q192*10n**BigInt(ud))});
}
bases.sort((a,b)=>a.usdgBalance>b.usdgBalance?-1:1);
if(!bases[0]||bases[0].usd18===0n)throw new Error('No ETH sizing price');
for(const addr of [zero,weth])refs[addr]={symbol:addr===zero?'ETH':'WETH',decimals:18,usd18:bases[0].usd18,source:'V3_WETH_USDG_SPOT_USDG_NOMINAL_1USD',pool:bases[0].address};
write('raw/depth-price-basis.json',{block:bn,refs,ethReferenceCandidates:bases});
const v3abi=parseAbi(['function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns(uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)']);
const v4abi=parseAbi(['function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns(uint256 amountOut,uint256 gasEstimate)']);
for(const version of ['v2','v3']){
 const input=`raw/${version}-pool-state.json`,file=`raw/${version}-depth-quotes.json`;
 if(!fs.existsSync(`${out}/${input}`)||fs.existsSync(`${out}/${file}`))continue;
 const pools=read(input);
 const result=await chunks(pools,async p=>{
 const a=(p.token0||p.currency0).toLowerCase(),b=(p.token1||p.currency1).toLowerCase();const row={version,pool:p.pool||p.pair||p.id,token0:a,token1:b,quotes:[]};
 if(!refs[a]||!refs[b])return {...row,status:'MISSING_REFERENCE_PRICE'};
 if(version!=='v2'&&(!p.slot0||BigInt(p.slot0[0])===0n))return {...row,status:'UNINITIALIZED_OR_READ_FAILED'};
 if(version==='v3'&&p.activeLiquidity==='0')return {...row,status:'ZERO_ACTIVE_LIQUIDITY_NOT_QUOTED'};
 if(version==='v4'&&p.activeLiquidity==='0')return {...row,status:p.hooks.toLowerCase()===zero?'ZERO_ACTIVE_LIQUIDITY_NOT_QUOTED':'ZERO_CORE_LIQUIDITY_HOOK_ROUTE_UNASSESSED'};
 if(version==='v2'&&(!p.reserves||BigInt(p.reserves[0])===0n||BigInt(p.reserves[1])===0n))return {...row,status:'NO_TWO_SIDED_RESERVES'};
 for(const isBuy0 of [false,true])for(const usd of [100,1000,10000]){
  const tokenIn=isBuy0?b:a,tokenOut=isBuy0?a:b;
  const amountIn=BigInt(usd)*E18*10n**BigInt(refs[tokenIn].decimals)/BigInt(refs[tokenIn].usd18);
  const q={direction:isBuy0?'1_TO_0':'0_TO_1',inputNotionalUsd:usd,amountIn};
  try{
   let amountOut,after;
   if(version==='v2'){
    const ri=BigInt(p.reserves[isBuy0?1:0]),ro=BigInt(p.reserves[isBuy0?0:1]);amountOut=amountIn*997n*ro/(ri*1000n+amountIn*997n);q.method='V2_EXACT_RESERVE_FORMULA';
   }else if(version==='v3'){
    const r=await c.simulateContract({address:'0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7',abi:v3abi,functionName:'quoteExactInputSingle',args:[{tokenIn,tokenOut,amountIn,fee:p.fee,sqrtPriceLimitX96:0n}],blockNumber:bn,gas:3000000n});
    [amountOut,after,q.initializedTicksCrossed,q.gasEstimate]=r.result;q.method='V3_QUOTERV2_ETH_CALL';
   }else{
    const r=await c.simulateContract({address:'0x8dc178efb8111bb0973dd9d722ebeff267c98f94',abi:v4abi,functionName:'quoteExactInputSingle',args:[{poolKey:{currency0:p.currency0,currency1:p.currency1,fee:p.fee,tickSpacing:p.tickSpacing,hooks:p.hooks},zeroForOne:!isBuy0,exactAmount:amountIn,hookData:'0x'}],blockNumber:bn,gas:3000000n});
    [amountOut,q.gasEstimate]=r.result;q.method='V4_QUOTER_ETH_CALL_EMPTY_HOOK_DATA';
   }
   const sq=version==='v2'?null:BigInt(p.slot0[0])**2n;
   const spotOut=version==='v2'?amountIn*BigInt(p.reserves[isBuy0?0:1])/BigInt(p.reserves[isBuy0?1:0]):isBuy0?amountIn*Q192/sq:amountIn*sq/Q192;
   q.amountOut=amountOut;q.sqrtPriceX96After=after??null;q.spotExpectedRaw=spotOut;
   q.executionShortfallBps=spotOut>0n?(spotOut-amountOut)*10000n/spotOut:null;
   q.outputReferenceUsd18=amountOut*BigInt(refs[tokenOut].usd18)/10n**BigInt(refs[tokenOut].decimals);
   q.status=amountOut>0n?'QUOTED':'ZERO_OUTPUT';
  }catch(e){q.status='QUOTE_FAILED';q.errorName=e.name;const reason=e.cause?.data?.errorName||e.cause?.reason||e.details;q.reason=typeof reason==='string'?reason.replace(/https?:\/\/\S+/g,'[redacted-url]').slice(0,180):null;}
  row.quotes.push(q);
 }
 return row;
 },6);write(file,result);
}
console.log('depth finished');
