import {encodeAbiParameters,keccak256,parseAbi,parseAbiParameters,type Address} from 'viem';
import type {MarketReadModel} from './generated/read-api.ts';
import type {ContractWriteRequest} from './transaction.ts';
import {ZERO_ADDRESS} from '../runtime/model.ts';

export const PERMIT2:Address='0x000000000022d473030f116ddee9f6b43ac78ba3';
export const poolRouterAbi=parseAbi(['function execute(bytes commands,bytes[] inputs,uint256 deadline) payable','function poolManager() view returns (address)']);
export const poolQuoterAbi=parseAbi(['function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)','function poolManager() view returns (address)']);
export const permit2Abi=parseAbi(['function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)','function approve(address token,address spender,uint160 amount,uint48 expiration)']);
export const poolSwapAbi=parseAbi(['event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)']);
const keyType='(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)';
// Existing deployment evidence pins this router, whose decoder includes minHopPriceX36.
// Never guess a new router's calldata layout from its address alone.
export function assertPoolRouterProfile(chain:number,router:string){
 if(chain!==46630||router.toLowerCase()!=='0x8876789976decbfcbbbe364623c63652db8c0904')throw Error('Pool trading is not configured for this router on this network');
}
export function poolTradeRoute(market:MarketReadModel,side:'buy'|'sell'){
 const r=market.canonicalRoute,k=market.poolKey;
 if(market.launchPhase!==1||!r.poolTradingEnabled||r.curveTradingEnabled||!k||!market.poolId)throw Error('The graduated pool is not ready for trading');
 const currency0=k.currency0.toLowerCase() as Address,currency1=k.currency1.toLowerCase() as Address;
 const input=(side==='buy'?market.quoteAsset:market.memeToken).toLowerCase() as Address;
 const output=(side==='buy'?market.memeToken:market.quoteAsset).toLowerCase() as Address;
 if(currency0>=currency1||![currency0,currency1].includes(input)||![currency0,currency1].includes(output)||input===output||k.hooks.toLowerCase()!==r.hook.toLowerCase()||r.router===ZERO_ADDRESS||r.quoter===ZERO_ADDRESS)throw Error('Invalid canonical pool binding');
 const poolKey={...k,currency0,currency1,hooks:k.hooks as Address};
 if(keccak256(encodeAbiParameters(parseAbiParameters(keyType),[poolKey]))!==market.poolId.toLowerCase())throw Error('Canonical pool ID does not match its key');
 return {poolKey,input,output,zeroForOne:input===currency0,router:r.router as Address,quoter:r.quoter as Address};
}
export function poolAmount(amount:bigint){if(amount<=0n||amount>=(1n<<128n))throw Error('Pool amount is outside the supported range');return amount;}
export function buildPoolTrade(market:MarketReadModel,side:'buy'|'sell',amount:bigint,minimum:bigint,deadline:bigint):ContractWriteRequest{
 const route=poolTradeRoute(market,side);poolAmount(amount);poolAmount(minimum);
 const swap=encodeAbiParameters(parseAbiParameters(`(${keyType} poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData)`),[{poolKey:route.poolKey,zeroForOne:route.zeroForOne,amountIn:amount,amountOutMinimum:minimum,minHopPriceX36:0n,hookData:'0x'}]);
 const settle=encodeAbiParameters(parseAbiParameters('address,uint256'),[route.input,amount]);
 const take=encodeAbiParameters(parseAbiParameters('address,uint256'),[route.output,minimum]);
 const input=encodeAbiParameters(parseAbiParameters('bytes,bytes[]'),['0x060c0f',[swap,settle,take]]);
 // Sweep unspent native input on a partial fill back to the caller. No allow-revert commands.
 const sweep=encodeAbiParameters(parseAbiParameters('address,address,uint256'),[ZERO_ADDRESS,'0x0000000000000000000000000000000000000001',0n]);
 return {abi:poolRouterAbi,address:route.router,functionName:'execute',args:[route.input===ZERO_ADDRESS?'0x1004':'0x10',route.input===ZERO_ADDRESS?[input,sweep]:[input],deadline],value:route.input===ZERO_ADDRESS?amount:0n};
}
