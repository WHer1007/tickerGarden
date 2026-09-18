import {createHash} from 'node:crypto';
import type {DeploymentIdentity} from '../../chain/src/index.ts';
export function displayWakeChannel(d:DeploymentIdentity,schema='tickergarden_serverless'):string {
 return 'tg_display_wake_'+createHash('sha256').update([d.environment,d.chainId,d.deploymentDigest,schema].join(':')).digest('hex').slice(0,32);
}
/** Notifications are hints; the durable display cursor is the recovery authority. */
export class DisplayWake {
 private pending=false;
 private notify:(()=>void)|undefined;
 wake=()=>{this.pending=true;this.notify?.();};
 async wait(timeout:number,signal:AbortSignal):Promise<void>{
  if(this.pending){this.pending=false;return;}if(signal.aborted)return;
  await new Promise<void>(resolve=>{
   const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);this.notify=undefined;resolve();};
   const timer=setTimeout(done,timeout);this.notify=done;signal.addEventListener('abort',done,{once:true});
  });this.pending=false;
 }
}
export function displayCatchup(result:string):boolean{return result.startsWith('catchup:')||result.startsWith('initialized:');}
