import {AsyncLocalStorage} from 'node:async_hooks';

type Scope = {number:bigint;hash:string;reads:Map<string,Promise<unknown>>;writes:(()=>Promise<void>)[]};
const scopes=new AsyncLocalStorage<Scope>();
/** A scope is bounded by fresh canonical checks by its owner. Never cache latest,
 * nonce, gas estimates or the canonical checks themselves. */
export async function fixedBlockContext<T>(number:bigint,hash:string,run:()=>Promise<T>,verify:()=>Promise<void>):Promise<T>{
 const current=scopes.getStore();
 if(current?.number===number&&current.hash===hash){const result=await run();await verify();return result;}
 return scopes.run({number,hash,reads:new Map(),writes:[]},async()=>{const result=await run();await verify();for(const write of scopes.getStore()!.writes)await write();return result;});
}
export function fixedReadScope(method:string,params:readonly unknown[]){
 const scope=scopes.getStore();
 if(!scope||!['eth_call','eth_getCode','eth_getBalance'].includes(method)||params.length!==2)return undefined;
 const tag=params[1];
 if(typeof tag!=='string'||!/^0x[0-9a-f]+$/i.test(tag)||BigInt(tag)!==scope.number)return undefined;
 return scope;
}
