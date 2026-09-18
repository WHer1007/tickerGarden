import {withSignerLane} from '../../services/backend-ts/packages/chain-worker/src/signer-coordination.ts';
import fs from 'node:fs';
import path from 'node:path';
import {createPublicClient,createWalletClient,defineChain,http} from '../../apps/web/node_modules/viem/_esm/index.js';
import {privateKeyToAccount} from '../../apps/web/node_modules/viem/_esm/accounts/index.js';
import {validateManifest,preview,executeOnce,json} from './runtime.mjs';

const args=process.argv.slice(2),mode=args[0],manifestFile=args[1];
if(!['preview','execute','status'].includes(mode)||!manifestFile||args.length!==2)throw Error('Usage: node tools/locker-compounding/worker.mjs preview|execute|status manifest.json');
const m=validateManifest(JSON.parse(fs.readFileSync(manifestFile,'utf8')));
const rpc=process.env.TG_LOCKER_RPC_URL;
const stateDir=process.env.TG_LOCKER_STATE_DIR;
if(!stateDir||!path.isAbsolute(stateDir))throw Error('Set absolute TG_LOCKER_STATE_DIR (shared across all markets for this signer)');
fs.mkdirSync(stateDir,{recursive:true,mode:0o700});
function privatePath(file){const s=fs.lstatSync(file);if(s.isSymbolicLink()||(s.mode&0o077))throw Error('State/signer path must be private and not a symlink');}
privatePath(stateDir);
const file=path.join(stateDir,`${m.chainId}-${m.keeper.toLowerCase()}.json`);
const lock=file+'.lock';
const save=async value=>{
 const tmp=file+'.tmp';
 if(fs.existsSync(tmp))privatePath(tmp);
 fs.writeFileSync(tmp,json(value),{mode:0o600});
 const fd=fs.openSync(tmp,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 fs.renameSync(tmp,file);
 const dir=fs.openSync(stateDir,'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
};
let locked=false,journal,safeJournal=false;
try{
 // Never auto-delete an uncertain lock. A crashed process requires operator PID verification.
 const fd=fs.openSync(lock,'wx',0o600);locked=true;fs.writeFileSync(fd,json({pid:process.pid}));fs.closeSync(fd);
 journal={chainId:m.chainId,keeper:m.keeper,pending:null,last:null};
 if(fs.existsSync(file)){privatePath(file);journal=JSON.parse(fs.readFileSync(file,'utf8'));}
 if(journal.chainId!==m.chainId||journal.keeper.toLowerCase()!==m.keeper.toLowerCase())throw Error('Journal identity mismatch');
 safeJournal=true;
 if(mode==='status'){
  const safe=structuredClone(journal);if(safe.pending)delete safe.pending.raw;
  console.log(json(safe));
 }else{
  if(!rpc)throw Error('Set TG_LOCKER_RPC_URL');
  const chain=defineChain({id:m.chainId,name:'Explicit Locker execution environment',nativeCurrency:{name:'ETH',symbol:'ETH',decimals:18},rpcUrls:{default:{http:[rpc]}}});
  const client=createPublicClient({chain,transport:http(rpc,{retryCount:0,timeout:20000})});
  if(mode==='preview')console.log(json(await preview(client,m)));
  else{
   const signer=process.env.TG_LOCKER_SIGNER_FILE;if(!signer)throw Error('Set TG_LOCKER_SIGNER_FILE');privatePath(signer);
   let account;
   try{account=privateKeyToAccount(JSON.parse(fs.readFileSync(signer,'utf8')).privateKey);}catch{throw Error('Invalid private signer file');}
   const wallet=createWalletClient({account,chain,transport:http(rpc,{retryCount:0,timeout:20000})});
   const coordination=process.env.TG_SIGNER_COORDINATION_DIR;if(!coordination)throw Error('Set TG_SIGNER_COORDINATION_DIR shared with Holder publisher');
   console.log(json(await withSignerLane(coordination,m.chainId,m.keeper,'locker',()=>executeOnce(client,wallet,m,journal,save),()=>journal.pending!==null&&journal.pending!==undefined)));
  }
 }
}catch(e){
 // Do not print provider URLs, signed bytes, or private inputs through nested RPC errors.
 const error=e.shortMessage?'RPC operation failed; inspect local state before retrying':String(e.message).replace(/https?:\/\/\S+/g,'[RPC]');
 if(safeJournal&&mode!=='status'){journal.lastError={at:new Date().toISOString(),error};try{await save(journal);}catch{/* The original journal remains authoritative if persistence also fails. */}}
 console.error(json({status:'needs_attention',error}));
 process.exitCode=1;
}finally{if(locked)fs.unlinkSync(lock);}
