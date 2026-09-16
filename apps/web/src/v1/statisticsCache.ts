// Public display statistics only. Never use this cache for quotes or balances.
const entries=new Map<string,{at:number;value?:unknown;error?:unknown;pending?:Promise<unknown>}>();
export function cachedStatistics<T>(key:string,read:()=>Promise<T>,force=false):Promise<T>{
 const old=entries.get(key),now=Date.now();if(old?.pending)return old.pending as Promise<T>;
 if(!force&&old&&now-old.at<(old.error?60_000:20*60_000)){return old.error?Promise.reject(old.error):Promise.resolve(old.value as T);}
 if(entries.size>=64&&!entries.has(key))entries.delete(entries.keys().next().value!);
 const pending=read().then(value=>{entries.set(key,{at:Date.now(),value});return value;}).catch(error=>{if(error instanceof Error&&error.name==='AbortError')entries.delete(key);else entries.set(key,{at:Date.now(),error});throw error;});
 entries.set(key,{at:now,pending});return pending;
}
