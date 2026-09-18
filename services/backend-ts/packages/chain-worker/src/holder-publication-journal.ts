import {acquireSignerLock,recoverSignerLock} from './signer-coordination.ts';
import fs from 'node:fs';
import path from 'node:path';
import type {Address,Hex} from 'viem';
import type {PublicationJournal} from './holder-publication.ts';

export function privatePublicationPath(file:string){
 const s=fs.lstatSync(file);
 if(s.isSymbolicLink()||(s.mode&0o077))throw Error('Publication state and signer paths must be private and not symlinks');
}
export function publicationStatus(journal:PublicationJournal){
 const safe=structuredClone(journal) as PublicationJournal & {pending:Partial<NonNullable<PublicationJournal['pending']>>|null};
 if(safe.pending)delete (safe.pending as {raw?:Hex}).raw;
 return safe;
}
export async function withPublicationJournal<T>(directory:string,identity:{chainId:number;releaseId:Hex;publisher:Address},action:(journal:PublicationJournal,save:(j:PublicationJournal)=>Promise<void>)=>Promise<T>):Promise<T>{
 if(!path.isAbsolute(directory))throw Error('Publication state directory must be absolute');
 fs.mkdirSync(directory,{recursive:true,mode:0o700});privatePublicationPath(directory);
 // Shared by all rounds/markets/releases for one signer and chain. Release changes require
 // deliberate archival after pending nonce reconciliation, not another concurrent nonce lane.
 const file=path.join(directory,`${identity.chainId}-${identity.publisher.toLowerCase()}.json`),lock=file+'.lock';
 const release=acquireSignerLock(lock);
 try{
  let journal:PublicationJournal={...identity,pending:null};
  if(fs.existsSync(file)){privatePublicationPath(file);journal=JSON.parse(fs.readFileSync(file,'utf8')) as PublicationJournal;}
  if(journal.chainId!==identity.chainId||journal.releaseId!==identity.releaseId||journal.publisher.toLowerCase()!==identity.publisher.toLowerCase())throw Error('Publication journal/deployment mismatch');
  const save=async(value:PublicationJournal)=>{
   const tmp=file+'.tmp';if(fs.existsSync(tmp))privatePublicationPath(tmp);
   fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600});
   const f=fs.openSync(tmp,'r');try{fs.fsyncSync(f);}finally{fs.closeSync(f);}
   fs.renameSync(tmp,file);
   const d=fs.openSync(directory,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}
  };
  return await action(journal,save);
 }finally{release();}
}

export {recoverSignerLock};
