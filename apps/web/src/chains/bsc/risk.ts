import {parseAbi,type Address,type Hex} from 'viem';
import {bscRiskAbi,bscRegistryRiskAbi} from './generated.ts';
const balances=parseAbi(['function deposited(bytes32,address) view returns(uint256)','function totalDeposited(bytes32) view returns(uint256)']);
const reasons=['Allowed','Issuer controller changed; review required','Issuer pause status unavailable','Issuer paused transfers','Vault restricted by issuer','Wallet restricted by issuer','Asset admission is closed','Asset implementation changed; review required'];
export function assertBscEntryCapacity(state:number,limits:readonly bigint[],total:bigint,user:bigint,additional:bigint){
 if(!Number.isInteger(state)||state!==0)throw Error(reasons[state]??'Issuer status unavailable');
 if(limits.length!==2||limits.some(x=>x<0n)||total<0n||user<0n||additional<0n)throw Error('Invalid BSC custody limits');
 if(total+additional>limits[0]!)throw Error('BSC asset vault deposit limit exceeded');
 if(user+additional>limits[1]!)throw Error('BSC wallet deposit limit exceeded');
}
export async function verifyBscEntry(client:{getBlockNumber():Promise<bigint>;readContract(request:any):Promise<any>},registry:Address,vault:Address,assetUid:Hex,user:Address,additional:bigint){
 const blockNumber=await client.getBlockNumber();
 const [state,limits,total,deposited]=await Promise.all([
 client.readContract({address:vault,abi:bscRiskAbi,functionName:'stockEntryStatus',args:[assetUid,user],blockNumber}),
 client.readContract({address:registry,abi:bscRegistryRiskAbi,functionName:'bscStockDepositLimits',args:[assetUid],blockNumber}),
 client.readContract({address:vault,abi:balances,functionName:'totalDeposited',args:[assetUid],blockNumber}),
 client.readContract({address:vault,abi:balances,functionName:'deposited',args:[assetUid,user],blockNumber}),
 ]);
 assertBscEntryCapacity(Number(state),limits,total,deposited,additional);
}
