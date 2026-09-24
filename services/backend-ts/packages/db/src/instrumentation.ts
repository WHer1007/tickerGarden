import {AsyncResource} from 'node:async_hooks';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import type {Pool,PoolClient} from 'pg';
import {recordDatabaseTiming} from './telemetry.ts';

const instrumented=new WeakSet<object>();
/** Measure driver round trips separately from pool acquisition. Never log SQL/values/URLs. */
export function instrumentDatabasePool(pool:Pool):void{
 if(instrumented.has(pool))return;instrumented.add(pool);
 pool.on('connect',instrumentClient);
 const connect=pool.connect;
 pool.connect=function(this:Pool,...args:unknown[]){
  const done=timer('connection',undefined,pool);
  const callback=args[0];
  if(typeof callback==='function'){
   return connect.call(this,((error:Error|undefined,client:PoolClient,release:()=>void)=>{done(error);callback(error,client,release);}) as never);
  }
  try{return (Reflect.apply(connect,this,[]) as Promise<PoolClient>).then(client=>{done();return client;},error=>{done(error);throw error;});}
  catch(error){done(error);throw error;}
 } as Pool['connect'];
}
function instrumentClient(client:PoolClient){
 if(instrumented.has(client))return;instrumented.add(client);
 const query=client.query;
 client.query=function(this:PoolClient,...args:unknown[]){
  const config=args[0];const text=typeof config==='string'?config:config&&typeof config==='object'&&'text'in config?String(config.text):'query';
  const queryId=createHash('sha256').update(text.replace(/\s+/g,' ').trim()).digest('hex').slice(0,16);
  const done=timer('sql',queryId),last=args.length-1,callback=args[last];
  if(typeof callback==='function')args[last]=function(...values:unknown[]){done(values[0]);return callback(...values);};
  try{
   const result=Reflect.apply(query,this,args);
   if(result&&typeof result.then==='function')return result.then((value:unknown)=>{done();return value;},(error:unknown)=>{done(error);throw error;});
   if(typeof callback!=='function'&&result&&typeof result.once==='function'){result.once('end',()=>done());result.once('error',(error:unknown)=>done(error));}
   return result;
  }catch(error){done(error);throw error;}
 } as PoolClient['query'];
}
function timer(phase:'connection'|'sql',queryId?:string,pool?:Pool){
 const started=performance.now();let finished=false;
 // Socket callbacks may run in a different async context than the caller.
 return AsyncResource.bind((error?:unknown)=>{if(finished)return;finished=true;recordDatabaseTiming(phase,performance.now()-started,error,queryId,pool?{poolTotal:pool.totalCount,poolIdle:pool.idleCount,poolWaiting:pool.waitingCount}:undefined);});
}
