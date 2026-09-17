import {encodeAbiParameters,parseAbiParameters,encodePacked,parseAbi,type Address,type Hex} from 'viem';
import {purchaseRoute,poolKey,bridge,ZERO,WETH,USDG,type PurchaseQuote,type PurchaseRoute} from './quote.ts';
export const PURCHASE_ROUTER='0x8876789976decbfcbbbe364623c63652db8c0904' as const;
export const purchaseRouterAbi=parseAbi(['function execute(bytes commands,bytes[] inputs,uint256 deadline) payable']);
const SELF='0x0000000000000000000000000000000000000002' as const;
export function purchaseEthLimit(estimated:bigint):bigint {
 if(estimated<=0n||estimated>=2n**128n)throw Error('Invalid purchase amount');
 return (estimated*110n+99n)/100n;
}
export function purchaseRequest(q:PurchaseQuote,recipient:Address,now=Date.now(),maximumEth=purchaseEthLimit(BigInt(q.amountIn))){
 if(!Number.isSafeInteger(q.expiresAt)||q.chainId!==4663||q.expiresAt<=now||q.expiresAt>now+120000||!/^0x[0-9a-fA-F]{40}$/.test(recipient)||recipient.toLowerCase()===ZERO)throw Error('Purchase quote expired or invalid');
 for(const n of [q.amountOut,q.amountIn,q.stockInput])if(!/^[1-9][0-9]{0,38}$/.test(n)||BigInt(n)>=2n**128n)throw Error('Invalid purchase amount');
 if(maximumEth<BigInt(q.amountIn)||maximumEth>=2n**128n)throw Error('Purchase cost exceeds approved ETH limit');
 const r=purchaseRoute(q.token),via=r.input===USDG;
 if(!via&&q.stockInput!==q.amountIn)throw Error('Invalid direct purchase');
 const commands:number[]=[],inputs:Hex[]=[];
 const add=(command:number,schema:string,values:readonly unknown[])=>{commands.push(command);inputs.push(encodeAbiParameters(parseAbiParameters(schema),values));};
 const v3=(route:PurchaseRoute,to:Address,out:bigint,max:bigint)=>add(1,'address,uint256,uint256,bytes,bool,uint256[]',[to,out,max,encodePacked(['address','uint24','address'],[route.output,route.fee,route.input]),false,[0n]]);
 if(r.input!==ZERO)add(11,'address,uint256',[SELF,maximumEth]);
 // V3 can settle both hops backwards, so only the exact WETH cost is spent.
 if(via&&r.version==='v3')add(1,'address,uint256,uint256,bytes,bool,uint256[]',[recipient,BigInt(q.amountOut),maximumEth,encodePacked(['address','uint24','address','uint24','address'],[r.output,r.fee,USDG,bridge.fee,WETH]),false,[0n,0n]]);
 else if(r.version==='v3')v3(r,recipient,BigInt(q.amountOut),maximumEth);
 else {
  // Mixed V3/V4 routes cannot share an exact-output callback. Fund V4 with
  // USDG bought within the approved ETH budget; unused USDG is returned below.
  if(via)add(0,'address,uint256,uint256,bytes,bool,uint256[]',[SELF,maximumEth,BigInt(q.stockInput),encodePacked(['address','uint24','address'],[WETH,bridge.fee,USDG]),false,[0n]]);
  const swap=encodeAbiParameters(parseAbiParameters('((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountOut,uint128 amountInMaximum,uint256 minHopPriceX36,bytes hookData)'),[{poolKey:poolKey(r),zeroForOne:r.input<r.output,amountOut:BigInt(q.amountOut),amountInMaximum:via?(2n**128n-1n):maximumEth,minHopPriceX36:0n,hookData:'0x'}]);
  const settle=encodeAbiParameters(parseAbiParameters('address,uint256,bool'),[r.input,0n,false]);
  const take=encodeAbiParameters(parseAbiParameters('address,address,uint256'),[r.output,recipient,0n]);
  add(16,'bytes,bytes[]',['0x080b0e',[swap,settle,take]]);
 }
 if(via)add(4,'address,address,uint256',[USDG,recipient,0n]);
 if(r.input!==ZERO)add(12,'address,uint256',[recipient,0n]);
 add(4,'address,address,uint256',[ZERO,recipient,0n]);
 return {address:PURCHASE_ROUTER,abi:purchaseRouterAbi,functionName:'execute' as const,args:[`0x${commands.map(c=>c.toString(16).padStart(2,'0')).join('')}` as Hex,inputs,BigInt(Math.floor(q.expiresAt/1000))] as const,value:maximumEth};
}
