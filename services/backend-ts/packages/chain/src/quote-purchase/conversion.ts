import {createPublicClient,custom,encodeAbiParameters,encodePacked,parseAbi,parseAbiParameters,type Address,type Hex} from 'viem';
import {purchaseRoute,poolKey,bridge,ZERO,WETH,USDG,Q3,Q4,type PurchaseRoute} from './quote.ts';
import {PURCHASE_ROUTER,purchaseRouterAbi} from './transaction.ts';
export {PURCHASE_ROUTER};
export const TRADE_NATIVE=ZERO,TRADE_USDG=USDG;
export const PURCHASE_ROUTER_CODEHASH='0x2ce6aaaf9f4151f5e1cbf774668772f17f532ae11b15e9284fd0a072a8b0fbde';
export type ConversionIntent={chainId:number;sellToken:Address;buyToken:Address;sellAmount:string;taker:Address};
export type ConversionQuote=ConversionIntent&{provider:'configured-pool';buyAmount:string;minBuyAmount:string;blockNumber:string;expiresAt:number;priceImpactBps:number;providerFee:null};
const positive=(s:unknown):s is string=>typeof s==='string'&&/^[1-9][0-9]{0,38}$/.test(s)&&BigInt(s)<2n**128n;
export function assertConversionIntent(i:ConversionIntent){
 if(i.chainId!==4663||i.sellToken!==ZERO||!/^0x[0-9a-fA-F]{40}$/.test(i.buyToken)||!/^0x[0-9a-fA-F]{40}$/.test(i.taker)||i.taker.toLowerCase()===ZERO||!positive(i.sellAmount))throw Error('Invalid conversion request');
 purchaseRoute(i.buyToken);
}
export function conversionRequest(q:ConversionQuote,i:ConversionIntent,now=Date.now()){
 assertConversionIntent(i);
 if(q.provider!=='configured-pool'||!/^\d+$/.test(q.blockNumber)||!Number.isSafeInteger(q.priceImpactBps)||q.priceImpactBps<0||q.priceImpactBps>10000||q.chainId!==i.chainId||q.sellToken!==i.sellToken||q.buyToken.toLowerCase()!==i.buyToken.toLowerCase()||q.taker.toLowerCase()!==i.taker.toLowerCase()||q.sellAmount!==i.sellAmount||!positive(q.buyAmount)||!positive(q.minBuyAmount)||BigInt(q.minBuyAmount)>BigInt(q.buyAmount)||BigInt(q.minBuyAmount)<BigInt(q.buyAmount)*99n/100n||!Number.isSafeInteger(q.expiresAt)||q.expiresAt<=now||q.expiresAt>now+90000)throw Error('Conversion quote does not match');
 const r=purchaseRoute(i.buyToken),via=r.input===USDG,amount=BigInt(i.sellAmount),minimum=BigInt(q.minBuyAmount),SELF='0x0000000000000000000000000000000000000002',BALANCE=1n<<255n;
 const commands:number[]=[],inputs:Hex[]=[];
 const add=(command:number,schema:string,values:readonly unknown[])=>{commands.push(command);inputs.push(encodeAbiParameters(parseAbiParameters(schema),values));};
 if(r.input!==ZERO)add(11,'address,uint256',[SELF,amount]);
 if(r.version==='v3'){
  const path=via?encodePacked(['address','uint24','address','uint24','address'],[WETH,bridge.fee,USDG,r.fee,r.output]):encodePacked(['address','uint24','address'],[r.input,r.fee,r.output]);
  add(0,'address,uint256,uint256,bytes,bool,uint256[]',[i.taker,amount,minimum,path,false,via?[0n,0n]:[0n]]);
 }else{
  if(via)add(0,'address,uint256,uint256,bytes,bool,uint256[]',[SELF,amount,0n,encodePacked(['address','uint24','address'],[WETH,bridge.fee,USDG]),false,[0n]]);
  // Settle actual bridge proceeds before consuming the resulting V4 credit.
  const settle=encodeAbiParameters(parseAbiParameters('address,uint256,bool'),[r.input,via?BALANCE:amount,false]);
  const swap=encodeAbiParameters(parseAbiParameters('((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData)'),[{poolKey:poolKey(r),zeroForOne:r.input<r.output,amountIn:0n,amountOutMinimum:minimum,minHopPriceX36:0n,hookData:'0x'}]);
  const take=encodeAbiParameters(parseAbiParameters('address,address,uint256'),[r.output,i.taker,0n]);
  add(16,'bytes,bytes[]',['0x0b060e',[settle,swap,take]]);
 }
 if(via)add(4,'address,address,uint256',[USDG,i.taker,0n]);
 if(r.input!==ZERO)add(12,'address,uint256',[i.taker,0n]);
 add(4,'address,address,uint256',[ZERO,i.taker,0n]);
 return {address:PURCHASE_ROUTER,abi:purchaseRouterAbi,functionName:'execute' as const,args:[`0x${commands.map(c=>c.toString(16).padStart(2,'0')).join('')}` as Hex,inputs,BigInt(Math.floor(q.expiresAt/1000))] as const,value:amount};
}
export function preserveConversionMinimum(fresh:ConversionQuote,reviewed:ConversionQuote){
 conversionRequest(fresh,reviewed);
 if(BigInt(fresh.buyAmount)<BigInt(reviewed.minBuyAmount))throw Error('Price changed beyond the confirmed conversion minimum.');
 const result={...fresh,minBuyAmount:String(BigInt(fresh.minBuyAmount)>BigInt(reviewed.minBuyAmount)?fresh.minBuyAmount:reviewed.minBuyAmount)};
 conversionRequest(result,reviewed);return result;
}
const v3=parseAbi(['function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns(uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)']);
const v4=parseAbi(['function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns(uint256 amountOut,uint256 gasEstimate)']);
const state=parseAbi(['function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint8,bool)','function getSlot0(bytes32) view returns(uint160,int24,uint24,uint24)']);
export async function getConversionQuote(i:ConversionIntent,rpc:{call<T>(method:string,params:readonly unknown[]):Promise<T>;atBlock?<T>(number:bigint,hash:string,run:()=>Promise<T>):Promise<T>}):Promise<ConversionQuote>{
 assertConversionIntent(i);
 const c=createPublicClient({transport:custom({request:({method,params})=>rpc.call(method,(params??[]) as unknown[])})});
 if(await c.getChainId()!==4663)throw Error('Wrong conversion network');
 const block=await c.getBlock();
 const build=async()=>{
 async function leg(r:PurchaseRoute,input:bigint,spotInput:bigint){
  const quoted=r.version==='v3'?await c.simulateContract({address:Q3,abi:v3,functionName:'quoteExactInputSingle',args:[{tokenIn:r.input,tokenOut:r.output,amountIn:input,fee:r.fee,sqrtPriceLimitX96:0n}],blockNumber:block.number}):await c.simulateContract({address:Q4,abi:v4,functionName:'quoteExactInputSingle',args:[{poolKey:poolKey(r),zeroForOne:r.input<r.output,exactAmount:input,hookData:'0x'}],blockNumber:block.number});
  const out=quoted.result[0];if(out<=0n||out>=2n**128n)throw Error('No conversion depth');
  const slot=r.version==='v3'?await c.readContract({address:r.pool as Address,abi:state,functionName:'slot0',blockNumber:block.number}):await c.readContract({address:'0xf3334192d15450cdd385c8b70e03f9a6bd9e673b',abi:state,functionName:'getSlot0',args:[r.pool as Hex],blockNumber:block.number});
  const square=slot[0]**2n;if(square===0n)throw Error('No conversion depth');
  return {out,spot:r.input<r.output?spotInput*square/(2n**192n):spotInput*(2n**192n)/square};
 }
 const route=purchaseRoute(i.buyToken),input=BigInt(i.sellAmount);
 const base=route.input===USDG?await leg(bridge,input,input):{out:input,spot:input};
 const result=await leg(route,base.out,base.spot);
 const q:ConversionQuote={...i,provider:'configured-pool',buyAmount:String(result.out),minBuyAmount:String(result.out*99n/100n),blockNumber:String(block.number),expiresAt:Date.now()+30000,priceImpactBps:result.spot>result.out?Number((result.spot-result.out)*10000n/result.spot):0,providerFee:null};
 conversionRequest(q,i);return q;
 };
 return rpc.atBlock?rpc.atBlock(block.number,block.hash,build):build();
}
