import {createPublicClient, custom, parseAbi, type Address} from 'viem';
import {routes} from './routes.ts';
export const ZERO='0x0000000000000000000000000000000000000000' as const;
export const WETH='0x0bd7d308f8e1639fab988df18a8011f41eacad73' as const;
export const USDG='0x5fc5360d0400a0fd4f2af552add042d716f1d168' as const;
export type PurchaseRoute={version:'v3'|'v4';pool:string;input:Address;output:Address;fee:number;tickSpacing?:number|null;hooks?:string|null};
export const bridge:PurchaseRoute={version:'v3',pool:'0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca',input:WETH,output:USDG,fee:100};
export function purchaseRoute(token:string):PurchaseRoute {
 if(token.toLowerCase()===USDG)return bridge;
 const route=(routes as Record<string,PurchaseRoute>)[token.toLowerCase()];
 if(!route)throw Error('Unsupported paired asset');
 return route;
}
export const Q3='0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7' as const;
export const Q4='0x8dc178efb8111bb0973dd9d722ebeff267c98f94' as const;
const q3=parseAbi(['function quoteExactOutputSingle((address tokenIn,address tokenOut,uint256 amount,uint24 fee,uint160 sqrtPriceLimitX96) params) returns(uint256 amountIn,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)']);
const q4=parseAbi(['function quoteExactOutputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns(uint256 amountIn,uint256 gasEstimate)']);
const state=parseAbi(['function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint8,bool)','function getSlot0(bytes32) view returns(uint160,int24,uint24,uint24)']);
export function poolKey(r:PurchaseRoute){const [currency0,currency1]=[r.input,r.output].sort() as [Address,Address];return {currency0,currency1,fee:r.fee,tickSpacing:r.tickSpacing!,hooks:ZERO};}
export type PurchaseQuote={chainId:4663;token:Address;amountOut:string;amountIn:string;stockInput:string;blockNumber:string;expiresAt:number;priceImpactBps:number};
export async function quotePurchase(rpc:{call<T>(method:string,params:readonly unknown[]):Promise<T>},token:string,amount:string):Promise<PurchaseQuote>{
 if(!/^[1-9][0-9]{0,38}$/.test(amount)||BigInt(amount)>=2n**128n)throw Error('Invalid purchase amount');
 const r=purchaseRoute(token);
 const client=createPublicClient({transport:custom({request:({method,params})=>rpc.call(method,(params??[]) as unknown[])})});
 if(await client.getChainId()!==4663)throw Error('Wrong purchase network');
 const block=await client.getBlock();
 async function leg(route:PurchaseRoute,out:bigint){
  const quoted=route.version==='v3'
   ?await client.simulateContract({address:Q3,abi:q3,functionName:'quoteExactOutputSingle',args:[{tokenIn:route.input,tokenOut:route.output,amount:out,fee:route.fee,sqrtPriceLimitX96:0n}],blockNumber:block.number})
   :await client.simulateContract({address:Q4,abi:q4,functionName:'quoteExactOutputSingle',args:[{poolKey:poolKey(route),zeroForOne:route.input<route.output,exactAmount:out,hookData:'0x'}],blockNumber:block.number});
  const input=quoted.result[0];if(input<=0n||input>=2n**128n)throw Error('No purchase depth');
  const slot=route.version==='v3'?await client.readContract({address:route.pool as Address,abi:state,functionName:'slot0',blockNumber:block.number}):await client.readContract({address:'0xf3334192d15450cdd385c8b70e03f9a6bd9e673b',abi:state,functionName:'getSlot0',args:[route.pool as `0x${string}`],blockNumber:block.number});
  const square=slot[0]**2n;const spot=route.input<route.output?input*square/(2n**192n):input*(2n**192n)/square;
  return {input,spot};
 }
 const stock=await leg(r,BigInt(amount));
 const via=r.input===USDG;const base=via?await leg(bridge,stock.input):stock;
 // Compare total input with the two pools' pre-trade spot; includes LP fees.
 const spot=via?base.spot*stock.spot/stock.input:stock.spot;
 return {chainId:4663,token:r.output,amountOut:amount,amountIn:String(base.input),stockInput:String(stock.input),blockNumber:String(block.number),expiresAt:Number(block.timestamp)*1000+90000,priceImpactBps:spot>0n?Math.max(0,Number((spot-BigInt(amount))*10000n/spot)):0};
}
