type ListenerClient={query(sql:string):Promise<unknown>;release(destroy?:boolean):void};

/** Owns a checked-out LISTEN connection across error callbacks and shutdown. */
export class DisplayListener {
 private released=false;
 private closing:Promise<void>|undefined;
 readonly client:ListenerClient;
 constructor(client:ListenerClient){this.client=client;}
 release(destroy=false):void{
  if(this.released)return;
  this.released=true;
  this.client.release(destroy);
 }
 close():Promise<void>{
  return this.closing??=(async()=>{
   if(this.released)return;
   try{await this.client.query('UNLISTEN *');}catch{/* Connection errors also release through the listener's error handler. */}
   finally{this.release();}
  })();
 }
}
