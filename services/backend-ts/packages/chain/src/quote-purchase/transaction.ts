import {encodeAbiParameters,parseAbiParameters,encodePacked,parseAbi,type Address,type Hex} from 'viem';
import {purchaseRoute,poolKey,bridge,ZERO,WETH,USDG,type PurchaseQuote,type PurchaseRoute} from './quote.ts';
export const PURCHASE_ROUTER='0x8876789976decbfcbbbe364623c63652db8c0904' as const;
export const purchaseRouterAbi=parseAbi(['function execute(bytes commands,bytes[] inputs,uint256 deadline) payable']);
const SELF='0x0000000000000000000000000000000000000002' as const;
export function purchaseRequest(q:PurchaseQuote,recipient:Address,now=Date.now()){
 if(!Number.isSafeInteger(q.expiresAt)||q.chainId!==4663||q.expiresAt<=now||q.expiresAt>now+120000||!/^0x[0-9a-fA-F]{40}$/.test(recipient)||recipient.toLowerCase()===ZERO)throw Error('Purchase quote expired or invalid');
 for(const n of [q.amountOut,q.amountIn,q.stockInput])if(!/^[1-9][0-9]{0,38}$/.test(n)||BigInt(n)>=2n**128n)throw Error('Invalid purchase amount');
 const r=purchaseRoute(q.token),via=r.input===USDG;
 if(!via&&q.stockInput!==q.amountIn)throw Error('Invalid direct purchase');
 const commands:number[]=[],inputs:Hex[]=[];
 const add=(command:number,schema:string,values:readonly unknown[])=>{commands.push(command);inputs.push(encodeAbiParameters(parseAbiParameters(schema),values));};
 const v3=(route:PurchaseRoute,to:Address,out:bigint,max:bigint)=>add(1,'address,uint256,uint256,bytes,bool,uint256[]',[to,out,max,encodePacked(['address','uint24','address'],[route.output,route.fee,route.input]),false,[0n]]);
 if(r.input!==ZERO)add(11,'address,uint256',[SELF,BigInt(q.amountIn)]);
 if(via)v3(bridge,SELF,BigInt(q.stockInput),BigInt(q.amountIn));
 if(r.version==='v3')v3(r,recipient,BigInt(q.amountOut),BigInt(q.stockInput));
 else {
  const swap=encodeAbiParameters(parseAbiParameters('((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountOut,uint128 amountInMaximum,uint256 minHopPriceX36,bytes hookData)'),[{poolKey:poolKey(r),zeroForOne:r.input<r.output,amountOut:BigInt(q.amountOut),amountInMaximum:BigInt(q.stockInput),minHopPriceX36:0n,hookData:'0x'}]);
  const settle=encodeAbiParameters(parseAbiParameters('address,uint256,bool'),[r.input,0n,false]);
  const take=encodeAbiParameters(parseAbiParameters('address,address,uint256'),[r.output,recipient,0n]);
  add(16,'bytes,bytes[]',['0x080b0e',[swap,settle,take]]);
 }
 if(via)add(4,'address,address,uint256',[USDG,recipient,0n]);
 if(r.input!==ZERO)add(12,'address,uint256',[recipient,0n]);
 add(4,'address,address,uint256',[ZERO,recipient,0n]);
 return {address:PURCHASE_ROUTER,abi:purchaseRouterAbi,functionName:'execute' as const,args:[`0x${commands.map(c=>c.toString(16).padStart(2,'0')).join('')}` as Hex,inputs,BigInt(Math.floor(q.expiresAt/1000))] as const,value:BigInt(q.amountIn)};
}
