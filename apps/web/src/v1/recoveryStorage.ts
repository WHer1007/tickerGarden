/** In-memory safety net after broadcast. A failed write must not erase a known outcome. */
type StorageLike=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
const fallback=new WeakMap<object,Map<string,string|null>>();
export function recoveryRead(storage:Pick<Storage,'getItem'>,key:string):string|null{
 const retained=fallback.get(storage);if(retained?.has(key))return retained.get(key)??null;
 return storage.getItem(key);
}
export function recoveryWrite(storage:Pick<Storage,'setItem'>,key:string,value:string):void{
 try{storage.setItem(key,value);fallback.get(storage)?.delete(key);}
 catch{let entries=fallback.get(storage);if(!entries){entries=new Map();fallback.set(storage,entries);}entries.set(key,value);}
}
export function recoveryRemove(storage:Pick<Storage,'removeItem'>,key:string):void{
 try{storage.removeItem(key);fallback.get(storage)?.delete(key);}
 catch{let entries=fallback.get(storage);if(!entries){entries=new Map();fallback.set(storage,entries);}entries.set(key,null);}
}
/** Read only matching launch records. Receipts must be verified before clearing. */
export function savedLaunchTransaction(storage:StorageLike,chain:number,account:string,intent:string){
 for(const key of [`tickergarden:pending:v2:${chain}:${account.toLowerCase()}`,`tickergarden:pending:${chain}:${account.toLowerCase()}`]){
  const raw=recoveryRead(storage,key);if(!raw)continue;const data=JSON.parse(raw);
  const records=data.version===2&&Array.isArray(data.records)?data.records:[data];
  const record=records.find((r:any)=>r?.intent===intent&&r.approval===false&&/^0x[\da-f]{64}$/i.test(r.hash));
  if(record)return record as {hash:string;intent:string;cancelled?:boolean};
 }
 return null;
}
export function clearVerifiedLaunchTransaction(storage:StorageLike,chain:number,account:string,intent:string,hash:string):void{
 for(const key of [`tickergarden:pending:v2:${chain}:${account.toLowerCase()}`,`tickergarden:pending:${chain}:${account.toLowerCase()}`]){
  const raw=recoveryRead(storage,key);if(!raw)continue;const data=JSON.parse(raw);
  const matches=(r:any)=>r?.intent===intent&&r.approval===false&&r.hash?.toLowerCase()===hash.toLowerCase();
  if(data.version===2&&Array.isArray(data.records)){const records=data.records.filter((r:any)=>!matches(r));if(records.length===data.records.length)continue;if(records.length)recoveryWrite(storage,key,JSON.stringify({...data,records}));else recoveryRemove(storage,key);}
  else if(matches(data))recoveryRemove(storage,key);
 }
}
