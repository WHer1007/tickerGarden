import type {RpcTransport} from '../../chain/src/index.ts';
import {eventTopicsForModules} from '../../events/src/index.ts';

const ADDRESS_BATCH_SIZE=256;

/** Every request is restricted to known project contracts and that module's events. */
export async function displayLogs(rpc:RpcTransport,modules:ReadonlyMap<string,string>,from:bigint,to:bigint):Promise<Record<string,unknown>[]> {
 const range={fromBlock:`0x${from.toString(16)}`,toBlock:`0x${to.toString(16)}`};
 const byModule=new Map<string,string[]>();
 for(const [address,module] of modules){
  if(module==='UniswapV4PoolManager')continue;
  const addresses=byModule.get(module)??[];
  addresses.push(address);
  byModule.set(module,addresses);
 }
 const result:Record<string,unknown>[]=[];
 for(const [module,addresses] of byModule){
  const topics=eventTopicsForModules([module]);
  if(!topics.length)continue;
  for(let start=0;start<addresses.length;start+=ADDRESS_BATCH_SIZE){
   result.push(...await boundedLogs(rpc,range,topics,addresses.slice(start,start+ADDRESS_BATCH_SIZE)));
  }
 }
 return result;
}
async function boundedLogs(rpc:RpcTransport,range:{fromBlock:string;toBlock:string},topics:string[],addresses:string[]):Promise<Record<string,unknown>[]> {
 try{return await rpc.call<Record<string,unknown>[]>('eth_getLogs',[{...range,address:addresses,topics:[topics]}]);}
 catch(error){
  if(!/response exceeds size limit|RPC returned error code -32005/.test(String(error)))throw error;
  const from=BigInt(range.fromBlock),to=BigInt(range.toBlock);
  if(from<to){const mid=(from+to)/2n;return [...await boundedLogs(rpc,{fromBlock:range.fromBlock,toBlock:`0x${mid.toString(16)}`},topics,addresses),...await boundedLogs(rpc,{fromBlock:`0x${(mid+1n).toString(16)}`,toBlock:range.toBlock},topics,addresses)];}
  if(addresses.length>1){const mid=Math.ceil(addresses.length/2);return [...await boundedLogs(rpc,range,topics,addresses.slice(0,mid)),...await boundedLogs(rpc,range,topics,addresses.slice(mid))];}
  throw error;
 }
}
