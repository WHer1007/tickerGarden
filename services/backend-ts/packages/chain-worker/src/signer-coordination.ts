/** Shared local signer lane. Both publishers must use the same private directory. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
export function privateStatePath(file:string){const s=fs.lstatSync(file);if(s.isSymbolicLink()||(s.mode&0o077))throw Error('Signer state must be private and not symlinks');}
export function acquireSignerLock(file:string){
 const token=randomUUID(),owner={pid:process.pid,host:os.hostname(),token,createdAt:new Date().toISOString()};
 const fd=fs.openSync(file,'wx',0o600);
 try{fs.writeFileSync(fd,JSON.stringify(owner));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 return ()=>{privateStatePath(file);if(JSON.parse(fs.readFileSync(file,'utf8')).token!==token)throw Error('Signer lock ownership changed');fs.unlinkSync(file);};
}
/** Explicit recovery only: exact token and a dead local owner. Never touches pending intent files. */
export function recoverSignerLock(file:string,expectedToken:string){
 privateStatePath(path.dirname(file));privateStatePath(file);
 const stat=fs.lstatSync(file),owner=JSON.parse(fs.readFileSync(file,'utf8'));
 if(owner.host!==os.hostname()||owner.token!==expectedToken||!expectedToken||!Number.isSafeInteger(owner.pid)||owner.pid<=0)throw Error('Lock owner cannot be verified; manual host inspection required');
 try{process.kill(owner.pid,0);throw Error('Signer lock owner is still running');}catch(e){if((e as NodeJS.ErrnoException).code!=='ESRCH')throw e;}
 // A separate recovery guard serializes operators; the existing lock excludes new publishers.
 const release=acquireSignerLock(file+'.recovery');
 try{const current=fs.lstatSync(file);if(current.ino!==stat.ino||JSON.parse(fs.readFileSync(file,'utf8')).token!==expectedToken)throw Error('Signer lock changed during recovery');fs.unlinkSync(file);return {status:'lock_recovered_pending_journal_preserved'};}finally{release();}
}
export async function withSignerLane<T>(directory:string,chainId:number,address:string,owner:'holder'|'locker',action:()=>Promise<T>,hasPending:()=>boolean):Promise<T>{
 if(!path.isAbsolute(directory)||!Number.isSafeInteger(chainId)||chainId<=0||!/^0x[0-9a-f]{40}$/i.test(address))throw Error('Invalid shared signer lane');
 fs.mkdirSync(directory,{recursive:true,mode:0o700});privateStatePath(directory);
 const file=path.join(directory,`${chainId}-${address.toLowerCase()}.json`),release=acquireSignerLock(file+'.lock');
 try{
  if(fs.existsSync(file)){privateStatePath(file);const prior=JSON.parse(fs.readFileSync(file,'utf8'));if(prior.owner!==owner)throw Error('Signer has an unresolved intent in another service');}
  const tmp=file+'.tmp';if(fs.existsSync(tmp))privateStatePath(tmp);
  fs.writeFileSync(tmp,JSON.stringify({owner,chainId,address:address.toLowerCase()}),{mode:0o600});const fd=fs.openSync(tmp,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,file);
  const dir=fs.openSync(directory,'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
  const result=await action();
  if(!hasPending()){fs.unlinkSync(file);const d=fs.openSync(directory,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}}
  return result;
 }finally{release();}
}
