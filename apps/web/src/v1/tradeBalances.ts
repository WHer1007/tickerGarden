export type BalanceContext={key:string;account:string;quote:string;meme:string};
export type TradeBalances={quote?:bigint;meme?:bigint};
export function createTradeBalanceLoader(options:{read:(asset:string,account:string)=>Promise<bigint>;changed:(value:TradeBalances|null)=>void;retryMs?:number;timeoutMs?:number}){
 let context:BalanceContext|null=null,generation=0,values:TradeBalances={};
 const pending=new Map<string,Promise<void>>(),timers=new Set<ReturnType<typeof setTimeout>>();
 const cancellations=new Set<()=>void>();
 const clear=()=>{generation++;for(const cancel of cancellations)cancel();cancellations.clear();context=null;values={};pending.clear();for(const timer of timers)clearTimeout(timer);timers.clear();options.changed(null);};
 const read=async(side:'quote'|'meme',attempt=0):Promise<void>=>{
  if(!context)return;
  const identity=context,own=generation,key=`${own}:${side}`;
  if(pending.has(key))return pending.get(key);
  const task=(async()=>{
   let timeout:ReturnType<typeof setTimeout>|undefined,cancel:(()=>void)|undefined;
   try{
    const value=await Promise.race([new Promise<never>((_,reject)=>{cancel=()=>reject(Error('Balance context changed'));cancellations.add(cancel);}),Promise.resolve().then(()=>options.read(identity[side],identity.account)),new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(Error('Balance request timed out')),options.timeoutMs??10000);timers.add(timeout);})]);
    if(own!==generation)return;
    if(value<0n)throw Error('Invalid balance');
    values={...values,[side]:value};options.changed({...values});
   }catch{
    if(own!==generation)return;
    if(attempt<2){const timer=setTimeout(()=>{timers.delete(timer);if(own===generation)void read(side,attempt+1);},(options.retryMs??1000)*(attempt+1));timers.add(timer);}
   }finally{if(cancel)cancellations.delete(cancel);if(timeout){clearTimeout(timeout);timers.delete(timeout);}if(own===generation)pending.delete(key);}
  })();pending.set(key,task);return task;
 };
 return {clear,load(next:BalanceContext|null){
  if(!next){clear();return Promise.resolve();}
  if(!context||context.key!==next.key){clear();context=next;}
  return Promise.all([read('quote'),read('meme')]).then(()=>{});
 }};
}
