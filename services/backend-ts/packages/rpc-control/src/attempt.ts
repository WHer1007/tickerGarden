import {AsyncLocalStorage} from 'node:async_hooks';
export const rpcAttemptContext=new AsyncLocalStorage<{attempt:number;failover:boolean;purpose:'identity'|'read'}>();
