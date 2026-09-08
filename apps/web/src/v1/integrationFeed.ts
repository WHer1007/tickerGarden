export interface QueryEvent {blockNumber:string;blockHash:string;payload:{address:string;topics:`0x${string}`[];data:`0x${string}`;transactionHash:`0x${string}`;transactionIndex:string;logIndex:string;event:{signature:string;args:Record<string,string>}}}
export interface QueryFeed {scope:string;chainId:number;finality:string;historyFrom:string;stale:boolean;events:QueryEvent[]}
const cache=new Map<string,{at:number;value:QueryFeed}>(),pending=new Map<string,Promise<QueryFeed>>();
export function integrationFeed(base:string,scope=''):Promise<QueryFeed>{
 const key=base+':'+scope,old=cache.get(key);if(old&&Date.now()-old.at<5_000)return Promise.resolve(old.value);
 const work=pending.get(key);if(work)return work;
 const task=(async()=>{const r=await fetch(`${base}/v1/events?limit=100${scope?'&scope='+encodeURIComponent(scope):''}`,{signal:AbortSignal.timeout(5_000)});if(!r.ok)throw Error('Event query unavailable');const v=await r.json() as QueryFeed;if(v.chainId!==46630||v.finality!=='head'||!Array.isArray(v.events))throw Error('Head event feed unavailable');cache.set(key,{at:Date.now(),value:v});return v;})().finally(()=>pending.delete(key));pending.set(key,task);return task;
}
