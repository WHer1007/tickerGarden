/** A durable queue is authoritative; this hint only avoids idle polling latency. */
export class IdleWake {
 revision=0;private waiters=new Set<()=>void>();
 wake(){this.revision++;for(const done of [...this.waiters])done();}
 wait(ms:number,observed:number):Promise<void>{
  if(observed!==this.revision)return Promise.resolve();
  return new Promise(resolve=>{const done=()=>{clearTimeout(timer);this.waiters.delete(done);resolve();};const timer=setTimeout(done,ms);this.waiters.add(done);if(observed!==this.revision)done();});
 }
}
