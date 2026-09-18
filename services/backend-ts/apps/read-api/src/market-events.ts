import type {Pool,PoolClient,Notification} from 'pg';
import {streamSSE} from 'hono/streaming';
import type {Context} from 'hono';
import {changeChannel} from '../../../packages/confirmed-display/src/changes.ts';
import type {DeploymentIdentity} from '../../../packages/chain/src/index.ts';
/** One LISTEN connection per warm instance, shared across market subscribers. */
export function createMarketEvents(pool:()=>Pool,d:DeploymentIdentity,schema?:string){
 const channel=changeChannel(d,schema),listeners=new Map<symbol,{market:string;send:(payload:string)=>void;close:()=>void}>();
 let client:PoolClient|null=null,opening:Promise<void>|null=null;
 const close=()=>{const c=client;client=null;c?.removeAllListeners('notification');c?.removeListener('error',failed);c?.release(true);};
 const failed=()=>{for(const l of [...listeners.values()])l.close();close();};
 const receive=(n:Notification)=>{if(n.channel!==channel||!n.payload)return;try{const data=JSON.parse(n.payload);const stats=Array.isArray(data.statsRegions);if(!stats&&typeof data.marketId!=='string')return;for(const l of listeners.values())if(stats?l.market==='@stats':l.market==='*'||l.market===data.marketId)l.send(n.payload);}catch{/* Only invalidation hints; malformed payloads are ignored. */}};
 const connect=()=>opening??=(async()=>{if(client)return;const c=await pool().connect();client=c;c.on('error',failed);c.on('notification',receive);try{await c.query(`LISTEN ${channel}`);}catch(e){close();throw e;}})().finally(()=>{opening=null;});
 return async(context:Context,market:string)=>{
  if(listeners.size>=128)return context.json({error:'stream_capacity'},503);
  await connect();
  context.header('Cache-Control','no-store');context.header('X-Accel-Buffering','no');
  return streamSSE(context,async stream=>{
   const key=Symbol(),done=new Promise<void>(resolve=>{
    let pending=0;
    const finish=()=>{listeners.delete(key);resolve();};
    listeners.set(key,{market,close:finish,send:payload=>{if(++pending>8){finish();return;}void stream.writeSSE({event:'change',data:payload}).catch(finish).finally(()=>pending--);}});
    stream.onAbort(finish);
   });
   const heartbeat=setInterval(()=>{void stream.writeSSE({event:'ping',data:'{}'}).catch(()=>listeners.get(key)?.close());},15000);
   const timeout=setTimeout(()=>listeners.get(key)?.close(),240000);
   try{await stream.writeSSE({event:'ready',data:'{}',retry:2000});await done;}
   finally{clearInterval(heartbeat);clearTimeout(timeout);listeners.delete(key);if(!listeners.size)close();}
  });
 };
}
