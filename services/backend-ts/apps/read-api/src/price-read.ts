import {performance} from 'node:perf_hooks';
import type {Pool, PoolClient} from 'pg';
import {logEvent} from '../../../packages/observability/src/index.ts';
import {withDatabaseTask} from '../../../packages/db/src/telemetry.ts';

/** Only published-price SELECTs use this recovery path. Never retry a submitted query. */
export async function withPriceReadConnection<T>(pool: Pick<Pool,'connect'|'totalCount'|'idleCount'|'waitingCount'>, read: (client: PoolClient) => Promise<T>, options: {budgetMs?:number;connectMs?:number;backoffMs?:number} = {}): Promise<T> {
 const budget=options.budgetMs??12_000, connectMs=options.connectMs??5_250, backoff=options.backoffMs??150;
 if (![budget,connectMs,backoff].every(Number.isFinite)||budget<=0||connectMs<=0||backoff<0) throw Error('invalid price read budget');
 return withDatabaseTask('read-api','prices.read',async()=>{
  const started=performance.now(),remaining=()=>Math.max(0,budget-(performance.now()-started));
  let client:PoolClient|undefined,attempt=0,destroy=false;
  const fields=()=>({attempt,retryCount:Math.max(0,attempt-1),elapsedMs:performance.now()-started,poolTotal:pool.totalCount,poolIdle:pool.idleCount,poolWaiting:pool.waitingCount});
  try {
   for(attempt=1;attempt<=2;attempt++){
    try {client=await acquire(pool,Math.min(connectMs,remaining()));break;}
    catch(error){
     const retry=attempt===1&&isTransientConnectError(error)&&remaining()>backoff+connectMs;
     logEvent('database','warn','price_connection_failed',{...fields(),phase:'acquire',willRetry:retry,errorCode:safeCode(error)});
     if(!retry)throw error;
     await new Promise(resolve=>setTimeout(resolve,backoff));
    }
   }
   if(!client)throw Error('price connection unavailable');
   // Bound the complete operation too; a late acquisition is released by acquire().
   const result=await within(()=>read(client!),remaining());
   if(attempt>1)logEvent('database','info','price_connection_recovered',{...fields(),phase:'complete'});
   return result;
  }catch(error){destroy=true;throw error;}
  finally{client?.release(destroy);}
 });
}
function acquire(pool:Pick<Pool,'connect'>,ms:number):Promise<PoolClient>{
 if(ms<=0)return Promise.reject(Error('price read deadline exceeded'));
 return new Promise((resolve,reject)=>{
  let expired=false;
  const timer=setTimeout(()=>{expired=true;reject(Error('price connection deadline exceeded'));},ms);
  void Promise.resolve().then(()=>pool.connect()).then(client=>{clearTimeout(timer);if(expired)client.release(true);else resolve(client);},error=>{clearTimeout(timer);if(!expired)reject(error);});
 });
}
function within<T>(run:()=>Promise<T>,ms:number):Promise<T>{
 if(ms<=0)return Promise.reject(Error('price read deadline exceeded'));
 return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('price read deadline exceeded')),ms);void Promise.resolve().then(run).then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});});
}
function safeCode(error:unknown):string{const code=(error as {code?:unknown}|null)?.code;return typeof code==='string'&&/^[A-Z0-9_]{1,32}$/.test(code)?code:'unknown';}
function isTransientConnectError(error:unknown):boolean{
 const message=(error as {message?:unknown}|null)?.message;
 return ['ETIMEDOUT','ECONNRESET','ECONNREFUSED','EPIPE'].includes(safeCode(error))||message==='Connection terminated due to connection timeout'||message==='Connection terminated unexpectedly';
}
