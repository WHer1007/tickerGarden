import {decodeFunctionData,encodeFunctionData,parseAbi,type Address,type Hex} from 'viem';
export const TRADE_NATIVE='0x0000000000000000000000000000000000000000' as const;
export const TRADE_USDG='0x5fc5360d0400a0fd4f2af552add042d716f1d168' as const;
export const ZEROEX_NATIVE='0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as const;
export const ALLOWANCE_HOLDER='0x0000000000001ff3684f28c67538d4d072c22734' as const;
export const SETTLER_REGISTRY='0x00000000000004533fe15556b1e086bb1a72ceae' as const;
export const registryAbi=parseAbi(['function ownerOf(uint256 tokenId) view returns (address)','function prev(uint128 featureId) view returns (address)']);
export const holderAbi=parseAbi(['function exec(address operator,address token,uint256 amount,address target,bytes data) payable returns (bytes)']);
const settlerAbi=parseAbi(['function execute((address recipient,address buyToken,uint256 minAmountOut) slippage,bytes[] actions,bytes32 zid) payable returns (bool)']);
export type ConversionIntent={chainId:number;sellToken:Address;buyToken:Address;sellAmount:string;taker:Address};
export class ConversionUnavailableError extends Error {
 readonly code:string;
 constructor(code:string){super('Conversion service unavailable');this.name='ConversionUnavailableError';this.code=code;}
}
export type ConversionQuote=ConversionIntent&{buyAmount:string;minBuyAmount:string;blockNumber?:string;expiresAt:number;transaction:{to:Address;data:Hex;value:string};providerFee:{amount:string;token:Address}|null};
const addr=(x:unknown):x is Address=>typeof x==='string'&&/^0x[0-9a-fA-F]{40}$/.test(x);
const positive=(x:unknown):x is string=>typeof x==='string'&&/^[1-9][0-9]{0,38}$/.test(x)&&BigInt(x)<2n**128n;
export const providerToken=(x:string)=>x.toLowerCase()===TRADE_NATIVE?ZEROEX_NATIVE:x.toLowerCase();
export function assertConversionIntent(i:ConversionIntent):void{
 if(i.chainId!==4663||!addr(i.sellToken)||![TRADE_NATIVE,TRADE_USDG].includes(i.sellToken.toLowerCase() as typeof TRADE_NATIVE)||!addr(i.buyToken)||i.sellToken.toLowerCase()===i.buyToken.toLowerCase()||!addr(i.taker)||i.taker===TRADE_NATIVE||!positive(i.sellAmount))throw Error('Invalid conversion request');
}
/** Decode the narrow AllowanceHolder entry point; never accept arbitrary API calls/approvals. */
export function conversionRequest(q:ConversionQuote,i:ConversionIntent,now=Date.now()){
 assertConversionIntent(i);
 if(q.chainId!==i.chainId||q.sellToken?.toLowerCase()!==i.sellToken.toLowerCase()||q.buyToken?.toLowerCase()!==i.buyToken.toLowerCase()||q.taker?.toLowerCase()!==i.taker.toLowerCase()||q.sellAmount!==i.sellAmount||!positive(q.buyAmount)||!positive(q.minBuyAmount)||(BigInt(q.minBuyAmount)>BigInt(q.buyAmount)||BigInt(q.minBuyAmount)<BigInt(q.buyAmount)*99n/100n)||!Number.isSafeInteger(q.expiresAt)||q.expiresAt<=now||q.expiresAt>now+60_000)throw Error('Conversion quote does not match');
 const fee=q.providerFee;if(fee&&(!/^\d{1,39}$/.test(fee.amount)||!addr(fee.token)||![providerToken(i.sellToken),providerToken(i.buyToken)].includes(providerToken(fee.token))))throw Error('Invalid conversion fee');
 const tx=q.transaction;
 if(tx?.to?.toLowerCase()!==ALLOWANCE_HOLDER||!/^0x(?:[0-9a-fA-F]{2}){4,32768}$/.test(tx.data)||!/^\d{1,39}$/.test(tx.value)||BigInt(tx.value)!==(i.sellToken===TRADE_NATIVE?BigInt(i.sellAmount):0n))throw Error('Invalid conversion transaction');
 const {args}=decodeFunctionData({abi:holderAbi,data:tx.data});
 if(args[0].toLowerCase()!==args[3].toLowerCase()||args[1].toLowerCase()!==i.sellToken.toLowerCase()||args[2]!==BigInt(i.sellAmount))throw Error('Invalid conversion spend');
 const {args:[slippage]}=decodeFunctionData({abi:settlerAbi,data:args[4]});
 if(slippage.recipient.toLowerCase()!==i.taker.toLowerCase()||providerToken(slippage.buyToken)!==providerToken(i.buyToken)||slippage.minAmountOut!==BigInt(q.minBuyAmount))throw Error('Invalid conversion recipient or minimum');
 return {address:ALLOWANCE_HOLDER,abi:holderAbi,functionName:'exec' as const,args,value:BigInt(tx.value)};
}
/** Refresh may tighten, never lower, the minimum accepted in the initial confirmation. */
export function preserveConversionMinimum(fresh:ConversionQuote,reviewed:ConversionQuote):ConversionQuote{
 conversionRequest(fresh,reviewed);
 const floor=BigInt(reviewed.minBuyAmount);
 if(BigInt(fresh.buyAmount)<floor)throw Error('Price changed beyond the confirmed conversion minimum.');
 if(BigInt(fresh.minBuyAmount)>=floor)return fresh;
 const outer=decodeFunctionData({abi:holderAbi,data:fresh.transaction.data}).args;
 const inner=decodeFunctionData({abi:settlerAbi,data:outer[4]}).args;
 const data=encodeFunctionData({abi:settlerAbi,functionName:'execute',args:[{...inner[0],minAmountOut:floor},inner[1],inner[2]]});
 const result={...fresh,minBuyAmount:String(floor),transaction:{...fresh.transaction,data:encodeFunctionData({abi:holderAbi,functionName:'exec',args:[outer[0],outer[1],outer[2],outer[3],data]})}};
 conversionRequest(result,reviewed);return result;
}
export function conversionSettler(q:ConversionQuote){return decodeFunctionData({abi:holderAbi,data:q.transaction.data}).args[3];}
export async function getConversionQuote(i:ConversionIntent,key:string,fetcher:typeof fetch=fetch):Promise<ConversionQuote>{
 assertConversionIntent(i);if(!key)throw new ConversionUnavailableError('conversion_not_configured');
 const u=new URL('https://api.0x.org/swap/allowance-holder/quote');
 // User-approved conversion tolerance: 1%. The project-buy floor is quoted separately.
 u.search=new URLSearchParams({chainId:String(i.chainId),sellToken:providerToken(i.sellToken),buyToken:providerToken(i.buyToken),sellAmount:i.sellAmount,taker:i.taker,recipient:i.taker,slippageBps:'100',wrapUnwrapMode:'settler'}).toString();
 const r=await fetcher(u,{headers:{'0x-api-key':key,'0x-version':'v2'},signal:AbortSignal.timeout(12000)});
 if(!r.ok){
  const failure=await r.json().catch(()=>null) as {name?:string}|null;
  // Only stable public categories escape the provider boundary, never raw errors.
  throw new ConversionUnavailableError(failure?.name==='BUY_TOKEN_NOT_AUTHORIZED_FOR_TRADE'?'conversion_asset_unavailable':'conversion_quote_failed');
 }
 const raw=await r.json();
 if(raw.liquidityAvailable!==true||raw.sellToken?.toLowerCase()!==providerToken(i.sellToken)||raw.buyToken?.toLowerCase()!==providerToken(i.buyToken)||raw.sellAmount!==i.sellAmount||raw.allowanceTarget?.toLowerCase()!==ALLOWANCE_HOLDER||(raw.issues?.allowance&&raw.issues.allowance.spender?.toLowerCase()!==ALLOWANCE_HOLDER))throw Error('Conversion route unavailable');
 const fee=raw.fees?.zeroExFee;
 if(fee&&(!/^\d{1,39}$/.test(fee.amount)||!addr(fee.token)))throw Error('Invalid conversion fee');
 const q:ConversionQuote={...i,buyAmount:raw.buyAmount,minBuyAmount:raw.minBuyAmount,expiresAt:Date.now()+30_000,...(/^\d+$/.test(String(raw.blockNumber))?{blockNumber:String(raw.blockNumber)}:{}),transaction:{to:raw.transaction?.to,data:raw.transaction?.data,value:raw.transaction?.value},providerFee:fee?{amount:fee.amount,token:fee.token}:null};
 conversionRequest(q,i);return q;
}
