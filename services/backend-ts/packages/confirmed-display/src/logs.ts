import type {RpcTransport} from '../../chain/src/index.ts';
import {eventTopicsForModules,fixedF72Sources} from '../../events/src/index.ts';

const ADDRESS_BATCH_SIZE=256;

/** Every request is restricted to known project contracts and that module's events. */
export async function displayLogs(rpc:RpcTransport,modules:ReadonlyMap<string,string>,from:bigint,to:bigint,sharedCoverage=false):Promise<Record<string,unknown>[]> {
 const range={fromBlock:`0x${from.toString(16)}`,toBlock:`0x${to.toString(16)}`};
 const topicsByAddress=new Map<string,Set<string>>();
 for(const [address,module] of modules){
  if(module==='UniswapV4PoolManager')continue;
  const topics=eventTopicsForModules([module]);
  if(!topics.length)continue;
  topicsByAddress.set(address.toLowerCase(),new Set(topics.map(topic=>topic.toLowerCase())));
 }
 const addresses=[...modules.keys()].filter(address=>topicsByAddress.has(address.toLowerCase()));
 const topics=sharedCoverage?eventTopicsForModules([...fixedF72Sources().filter(s=>s.module!=='UniswapV4PoolManager').map(s=>s.module),'TickerMemeTokenV1','TickerGardenCurve']):[...new Set([...topicsByAddress.values()].flatMap(addressTopics=>[...addressTopics]))];
 const result:Record<string,unknown>[]=[];
 for(let start=0;start<addresses.length;start+=ADDRESS_BATCH_SIZE){
  const logs=await boundedLogs(rpc,range,topics,addresses.slice(start,start+ADDRESS_BATCH_SIZE));
  result.push(...logs.filter(log=>{
   const address=typeof log.address==='string'?log.address.toLowerCase():'';
   const topic0=Array.isArray(log.topics)&&typeof log.topics[0]==='string'?log.topics[0].toLowerCase():'';
   return topicsByAddress.get(address)?.has(topic0)??false;
  }));
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
