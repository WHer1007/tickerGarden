import path from 'node:path';
import {decodeFunctionResult} from '../../apps/web/node_modules/viem/_esm/index.js';
import {read,write,json,readonlyRpc,equal,parseAbi,encodeFunctionData} from './common.mjs';
export async function quoteNativeFees(output){
 const snapshot=read(path.join(output,'mainnet-snapshot.json')),runtime=read(path.join(output,'runtime-plan.json')),activation=read(path.join(output,'activation-plan.json'));
 const transactions=[...runtime.transactions,...activation.transactions];
 const rpc=readonlyRpc(process.env.ROBINHOOD_RPC_URL);equal(BigInt(await rpc.call('eth_chainId',[])),4663,'fee quote chain');
 const block='0x'+BigInt(snapshot.pin.blockNumber).toString(16);
 equal((await rpc.call('eth_getBlockByNumber',[block,false])).hash,snapshot.pin.blockHash,'fee quote pin');
 const abi=parseAbi(['function gasEstimateL1Component(address to,bool contractCreation,bytes data) payable returns(uint64 gasEstimateForL1,uint256 baseFee,uint256 l1BaseFeeEstimate)']);const quotes=[];
 for(let start=0;start<transactions.length;start+=8){
  const chunk=transactions.slice(start,start+8);
  const results=await rpc.batch(chunk.map(tx=>['eth_call',[{from:tx.from,to:'0x00000000000000000000000000000000000000C8',data:encodeFunctionData({abi,functionName:'gasEstimateL1Component',args:[tx.to,false,tx.data]})},block]]));
  results.forEach((data,index)=>{const [gasEstimateForL1,baseFee,l1BaseFeeEstimate]=decodeFunctionResult({abi,functionName:'gasEstimateL1Component',data});quotes.push({id:chunk[index].id,inputHash:chunk[index].inputHash,gasEstimateForL1,baseFee,l1BaseFeeEstimate});});
 }
 equal((await rpc.call('eth_getBlockByNumber',[block,false])).hash,snapshot.pin.blockHash,'fee quote final pin');
 const result={status:'PINNED_NATIVE_L1_DATA_FEE_QUOTES_NOT_SIGNING_FEES',chainId:4663,pin:snapshot.pin,method:'NodeInterface.gasEstimateL1Component',reference:'https://github.com/OffchainLabs/arbitrum-tutorials/blob/master/packages/gas-estimation/scripts/exec.ts',quotes};
 write(path.join(output,'native-fee-quotes.json'),result);console.log(json({status:result.status,transactions:quotes.length,first:quotes[0],last:quotes.at(-1)}));return result;
}
if(process.argv[1]===new URL(import.meta.url).pathname)await quoteNativeFees(path.resolve(process.argv[2]??'docs/reviews/evidence/production-release-2026-09-15'));
