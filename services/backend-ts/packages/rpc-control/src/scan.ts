export type ScanFilter={from:bigint;to:bigint;addresses:string[];topics:(string|string[]|null)[]};
export type ScanRecord={from_block:string;to_block:string;block_hash:string;addresses:string[];topics:ScanFilter['topics'];payload:Record<string,unknown>[]};
export function scanFilter(method:string,params:readonly unknown[]):ScanFilter|undefined{
 if(method!=='eth_getLogs'||params.length!==1)return;
 const f=params[0] as Record<string,unknown>|undefined;
 if(!f||Object.keys(f).some(k=>!['fromBlock','toBlock','address','topics'].includes(k))||typeof f.fromBlock!=='string'||typeof f.toBlock!=='string'||!/^0x[0-9a-f]+$/i.test(f.fromBlock)||!/^0x[0-9a-f]+$/i.test(f.toBlock))return;
 const addresses=Array.isArray(f.address)?f.address:[f.address];
 if(!addresses.length||addresses.some(a=>typeof a!=='string'||!/^0x[0-9a-f]{40}$/i.test(a))||!Array.isArray(f.topics)||!f.topics.length)return;
 if(!f.topics.every(t=>t===null||typeof t==='string'&&/^0x[0-9a-f]{64}$/i.test(t)||Array.isArray(t)&&t.length>0&&t.every(v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/i.test(v))))return;
 return {from:BigInt(f.fromBlock),to:BigInt(f.toBlock),addresses:addresses.map(a=>String(a).toLowerCase()).sort(),topics:f.topics.map(t=>t===null?null:Array.isArray(t)?t.map(v=>v.toLowerCase()).sort():String(t).toLowerCase())};
}
export function coversTopics(have:ScanFilter['topics'],want:ScanFilter['topics']){
 return have.every((h,i)=>h===null||want[i]!==undefined&&want[i]!==null&&(Array.isArray(want[i])?want[i]:[want[i]]).every(v=>(Array.isArray(h)?h:[h]).includes(v!)));
}
export function filterScan(logs:Record<string,unknown>[],f:ScanFilter){
 return logs.filter(l=>typeof l.blockNumber==='string'&&BigInt(l.blockNumber)>=f.from&&BigInt(l.blockNumber)<=f.to&&f.addresses.includes(String(l.address).toLowerCase())&&Array.isArray(l.topics)&&f.topics.every((t,i)=>t===null||(Array.isArray(t)?t:[t]).includes(String((l.topics as unknown[])[i]).toLowerCase()))).sort((a,b)=>{const block=BigInt(String(a.blockNumber))-BigInt(String(b.blockNumber));if(block!==0n)return block<0n?-1:1;const log=BigInt(String(a.logIndex??'0x0'))-BigInt(String(b.logIndex??'0x0'));return log<0n?-1:log>0n?1:0;});
}
