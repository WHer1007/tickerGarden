import type {RpcTransport} from '../../chain/src/index.ts';
import {eventTopicsForModules} from '../../events/src/index.ts';

/** Generic ERC20 events must never query all tokens on the chain. */
export async function displayLogs(rpc:RpcTransport,modules:ReadonlyMap<string,string>,from:bigint,to:bigint):Promise<Record<string,unknown>[]> {
 const range={fromBlock:`0x${from.toString(16)}`,toBlock:`0x${to.toString(16)}`};
 const topics=eventTopicsForModules([...new Set([...modules.values()].filter(m=>m!=='UniswapV4PoolManager'&&m!=='TickerMemeTokenV1'))]);
 const result=topics.length?await boundedLogs(rpc,range,topics):[];
 const tokens=[...modules].filter(([,m])=>m==='TickerMemeTokenV1').map(([address])=>address);
 const transferTopics=eventTopicsForModules(['TickerMemeTokenV1']);
 for(let start=0;start<tokens.length;start+=256)result.push(...await boundedLogs(rpc,range,transferTopics,tokens.slice(start,start+256)));
 return result;
}
async function boundedLogs(rpc:RpcTransport,range:{fromBlock:string;toBlock:string},topics:string[],addresses?:string[]):Promise<Record<string,unknown>[]> {
 try{return await rpc.call<Record<string,unknown>[]>('eth_getLogs',[{...range,topics:[topics],...(addresses?{address:addresses}:{})}]);}
 catch(error){
  if(!/response exceeds size limit|RPC returned error code -32005/.test(String(error)))throw error;
  const from=BigInt(range.fromBlock),to=BigInt(range.toBlock);
  if(from<to){const mid=(from+to)/2n;return [...await boundedLogs(rpc,{fromBlock:range.fromBlock,toBlock:`0x${mid.toString(16)}`},topics,addresses),...await boundedLogs(rpc,{fromBlock:`0x${(mid+1n).toString(16)}`,toBlock:range.toBlock},topics,addresses)];}
  if(addresses&&addresses.length>1){const mid=Math.ceil(addresses.length/2);return [...await boundedLogs(rpc,range,topics,addresses.slice(0,mid)),...await boundedLogs(rpc,range,topics,addresses.slice(mid))];}
  throw error;
 }
}
