import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {acquireSignerLock,recoverSignerLock,withSignerLane} from '../../packages/chain-worker/src/signer-coordination.ts';

const address='0x'+'1'.repeat(40),chainId=46630;
async function inPrivateDirectory<T>(run:(directory:string)=>Promise<T>):Promise<T>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'tg-signer-lane-'));fs.chmodSync(directory,0o700);
 try{return await run(directory);}finally{fs.rmSync(directory,{recursive:true,force:true});}
}
function deadPid(){
 for(let pid=process.pid+1000;pid<process.pid+2000;pid++)try{process.kill(pid,0);}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return pid;}
 throw new Error('unable to find a dead process id for lock recovery fixture');
}
function ownerFile(file:string,owner:{pid:number;host:string;token:string}){
 fs.writeFileSync(file,JSON.stringify({...owner,createdAt:new Date(0).toISOString()}),{mode:0o600});
}

test('live signer lock refuses recovery even with its exact token',async()=>inPrivateDirectory(async directory=>{
 const file=path.join(directory,'lane.lock'),release=acquireSignerLock(file),owner=JSON.parse(fs.readFileSync(file,'utf8')) as {token:string};
 try{assert.throws(()=>recoverSignerLock(file,owner.token),/still running/);assert.equal(fs.existsSync(file),true);}
 finally{release();}
}));

test('recovery requires the exact token and preserves the adjacent pending journal',async()=>inPrivateDirectory(async directory=>{
 const file=path.join(directory,'lane.lock'),journal=path.join(directory,'pending.json'),token='dead-owner-token';
 ownerFile(file,{pid:deadPid(),host:os.hostname(),token});const journalBytes='{"pending":"signed intent"}\n';fs.writeFileSync(journal,journalBytes,{mode:0o600});
 assert.throws(()=>recoverSignerLock(file,'wrong-token'),/cannot be verified/);assert.equal(fs.existsSync(file),true);assert.equal(fs.readFileSync(journal,'utf8'),journalBytes);
 assert.deepEqual(recoverSignerLock(file,token),{status:'lock_recovered_pending_journal_preserved'});assert.equal(fs.existsSync(file),false);assert.equal(fs.readFileSync(journal,'utf8'),journalBytes);
}));

test('foreign-host lock owners cannot be recovered locally',async()=>inPrivateDirectory(async directory=>{
 const file=path.join(directory,'lane.lock');ownerFile(file,{pid:deadPid(),host:`foreign-${os.hostname()}`,token:'foreign-token'});
 assert.throws(()=>recoverSignerLock(file,'foreign-token'),/manual host inspection/);assert.equal(fs.existsSync(file),true);
}));

test('different services cannot overlap, retain pending reservations, or clear them after failed work',async()=>inPrivateDirectory(async directory=>{
 const reservation=path.join(directory,`${chainId}-${address}.json`);let entered!:()=>void,finish!:()=>void;
 const started=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{finish=resolve;});
 const first=withSignerLane(directory,chainId,address,'holder',async()=>{entered();await gate;return 'done';},()=>false);
 await started;
 await assert.rejects(()=>withSignerLane(directory,chainId,address,'locker',async()=>{throw new Error('must not enter');},()=>false),/EEXIST/);
 finish();assert.equal(await first,'done');assert.equal(fs.existsSync(reservation),false);
 await assert.rejects(()=>withSignerLane(directory,chainId,address,'holder',async()=>{throw new Error('operation failed');},()=>false),/operation failed/);
 assert.equal(fs.existsSync(reservation),true,'failed work must retain reservation even if callback reports no pending intent');
 await assert.rejects(()=>withSignerLane(directory,chainId,address,'locker',async()=>undefined,()=>false),/unresolved intent in another service/);
 await withSignerLane(directory,chainId,address,'holder',async()=>undefined,()=>true);
 assert.equal(fs.existsSync(reservation),true,'same service can resume while unresolved intent remains');
 await withSignerLane(directory,chainId,address,'holder',async()=>undefined,()=>false);
 assert.equal(fs.existsSync(reservation),false,'normal completion clears a resolved reservation');
}));

test('a normal return with pending work retains the lane reservation',async()=>inPrivateDirectory(async directory=>{
 const reservation=path.join(directory,`${chainId}-${address}.json`);
 assert.equal(await withSignerLane(directory,chainId,address,'holder',async()=>42,()=>true),42);
 assert.equal(fs.existsSync(reservation),true);
}));

