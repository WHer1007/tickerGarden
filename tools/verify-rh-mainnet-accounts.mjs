import {createRequire} from 'node:module';
import fs from 'node:fs';
const req=createRequire(process.cwd()+'/deployments/package.json');
const {keccak_256}=req('@noble/hashes/sha3');
const preparation=JSON.parse(fs.readFileSync('deployments/manifests/robinhood-mainnet-4663.preparation.json'));
const addresses={treasury:preparation.addresses.platformTreasury,governance:preparation.addresses.governance,deployer:preparation.addresses.deployer};
const selector=s=>'0x'+Buffer.from(keccak_256(s)).toString('hex').slice(0,8);
let id=0;
async function rpc(method,params){
 const r=await fetch('https://rpc.mainnet.chain.robinhood.com',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(20000)});
 const j=await r.json();if(j.error)throw Error(JSON.stringify(j.error));return j.result;
}
const chainId=Number(BigInt(await rpc('eth_chainId',[])));if(chainId!==4663)throw Error('Wrong chain');
const block=await rpc('eth_getBlockByNumber',['0x'+BigInt(preparation.forkPin.blockNumber).toString(16),false]);
if(block.hash!==preparation.forkPin.blockHash)throw Error('Pinned block hash mismatch');
const output={observedAt:new Date().toISOString(),chainId,block:{number:block.number,hash:block.hash},accounts:{}};
for(const [role,address]of Object.entries(addresses)){
 if(!/^0x[0-9a-fA-F]{40}$/.test(address))throw Error('Invalid address '+role);
 const a={address,code:await rpc('eth_getCode',[address,block.number]),balance:await rpc('eth_getBalance',[address,block.number]),nonce:await rpc('eth_getTransactionCount',[address,block.number])};
 if(role!=='deployer'&&a.code!=='0x'){
  a.reads={};
  for(const sig of ['VERSION()','getThreshold()','getOwners()','nonce()','masterCopy()']){
   try{a.reads[sig]=await rpc('eth_call',[{to:address,data:selector(sig)},block.number]);}
   catch(e){a.reads[sig]={error:e.message};}
  }
 }
 if(role!=='deployer'&&a.code!=='0x'){
  const slot=s=>'0x'+Buffer.from(keccak_256(s)).toString('hex');
  a.guardStorage=await rpc('eth_getStorageAt',[address,slot('guard_manager.guard.address'),block.number]);
  a.fallbackHandlerStorage=await rpc('eth_getStorageAt',[address,slot('fallback_manager.handler.address'),block.number]);
  a.modules=await rpc('eth_call',[{to:address,data:selector('getModulesPaginated(address,uint256)')+'1'.padStart(64,'0')+'64'.padStart(64,'0')},block.number]);
  const impl='0x'+a.reads['masterCopy()'].slice(-40);
  a.singletonCodeHash='0x'+Buffer.from(keccak_256(Buffer.from((await rpc('eth_getCode',[impl,block.number])).slice(2),'hex'))).toString('hex');
 }
 a.codeHash='0x'+Buffer.from(keccak_256(Buffer.from(a.code.slice(2),'hex'))).toString('hex');
 if(role==='deployer') {
  if(a.code!=='0x')throw Error('Unexpected deployer code');
 } else {
  if(a.code==='0x'||BigInt(a.reads['getThreshold()'])!==2n)throw Error('Safe code or threshold mismatch');
  const words=a.reads['getOwners()'].slice(2).match(/.{64}/g);
  if(BigInt('0x'+words[1])!==3n)throw Error('Safe owner count mismatch');
  a.owners=words.slice(2).map(w=>'0x'+w.slice(-40));
  if(new Set(a.owners).size!==3)throw Error('Duplicate owners');
  if(BigInt(a.guardStorage)!==0n)throw Error('Unexpected Safe guard');
  const modules=a.modules.slice(2).match(/.{64}/g);
  if(BigInt('0x'+modules[1])!==1n||BigInt('0x'+modules[2])!==0n)throw Error('Unexpected enabled Safe modules');
 }
 output.accounts[role]=a;console.log(role,JSON.stringify(a));
}
if(output.accounts.treasury.owners.some(a=>output.accounts.governance.owners.includes(a)))throw Error('Safe owner overlap');
const lastBlock=await rpc('eth_getBlockByNumber',[block.number,false]);
if(lastBlock.hash!==block.hash)throw Error('Pinned block changed during verification');
const evidenceDirectory=preparation.evidenceDirectory??'docs/reviews/evidence/rh-mainnet-preparation-2026-09-13/';
fs.mkdirSync(evidenceDirectory,{recursive:true});
fs.writeFileSync(evidenceDirectory+'accounts.json',JSON.stringify(output,null,2)+'\n');
console.log('PIN',block.number,block.hash);
