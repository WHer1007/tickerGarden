import {AsyncLocalStorage} from 'node:async_hooks';
export type RpcPurpose = 'identity'|'read'|'canonical-before'|'canonical-after'|'bootstrap-source'|'projection-anchor'|'finality'|'event-header';
const purposes = new AsyncLocalStorage<RpcPurpose>();
export const withRpcPurpose = <T>(purpose:RpcPurpose, run:()=>T):T => purposes.run(purpose,run);
export const currentRpcPurpose = ():RpcPurpose => purposes.getStore()??'read';
export const rpcAttemptContext=new AsyncLocalStorage<{attempt:number;failover:boolean;purpose:RpcPurpose}>();
/** Safe attribution for duplicate block reads; never log endpoint, addresses or calldata. */
export function rpcBlockTag(request:{method?:string;params?:unknown[]}|undefined):string|undefined {
 const tag=request?.params?.[0];
 return request?.method==='eth_getBlockByNumber'&&typeof tag==='string'&&/^(?:0x[0-9a-f]{1,16}|latest|finalized|safe|earliest|pending)$/i.test(tag)?tag.toLowerCase():undefined;
}
