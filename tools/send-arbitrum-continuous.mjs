// Testnet-only staged sender. Never touches the active release or frontend bindings.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createPublicClient,createWalletClient,http,keccak256} from '../apps/web/node_modules/viem/_esm/index.js';
import {privateKeyToAccount} from '../apps/web/node_modules/viem/_esm/accounts/index.js';
import {arbitrumSepolia} from '../apps/web/node_modules/viem/_esm/chains/index.js';
import {verifyBatch,output} from './verify-arbitrum-continuous-simulation.mjs';
const root=new URL('../',import.meta.url).pathname;
if(process.argv.length!==3||!['check','send'].includes(process.argv[2]))throw Error('Use check or send');
const mode=process.argv[2],read=p=>JSON.parse(fs.readFileSync(root+p));
const cert=read('deployments/evidence/v1-continuous-candidate-release.json');
const checked=verifyBatch();
const ensure=(ok,msg)=>{if(!ok)throw Error(msg);};
ensure(cert.status==='VERIFIED'&&cert.chainId===421614&&cert.payloadHash===checked.payloadHash&&cert.releaseId===checked.releaseId,'Invalid certificate identity');
for(const [p,h] of Object.entries(cert.inputHashes))ensure('0x'+createHash('sha256').update(fs.readFileSync(root+p)).digest('hex')===h,'Certificate input drift: '+p);
const rpc=fs.readFileSync(root+'deployments/config/arbitrum-sepolia.public.env','utf8').match(/^ARBITRUM_SEPOLIA_RPC_URL=(.+)$/m)[1];
const client=createPublicClient({chain:arbitrumSepolia,transport:http(rpc,{timeout:30000,retryCount:2})});
ensure(await client.getChainId()===421614,'Wrong chain');
const block=await client.getBlock();ensure(Number(block.timestamp)>=cert.verifiedAt&&Number(block.timestamp)<=cert.expiresAt&&Date.now()/1000<=cert.expiresAt,'Expired certificate');
const snap=JSON.parse(fs.readFileSync(output+'/certificate-chain-check.json'));
for(const d of snap.dependencies)ensure(keccak256(await client.getCode({address:d.address}))===d.codeHash,'Dependency drift: '+d.name);
const dir=root+'deployments/releases/'+cert.releaseId;fs.mkdirSync(dir,{recursive:true});
const journalPath=dir+'/continuous-deployment-transactions.json';
const records=fs.existsSync(journalPath)?JSON.parse(fs.readFileSync(journalPath)):[];
const batch=JSON.parse(fs.readFileSync(output+'/unsigned-transactions.json'));
const cap=50000000000000000n; // 0.05 test ETH, core deployment only; never a production budget.
let spent=0n;
console.log(JSON.stringify({mode,chainId:421614,releaseId:cert.releaseId,transactions:19,budgetCapWei:String(cap),priorRecords:records.length}));
if(mode==='check')process.exit(0);
const lock=dir+'/continuous-sender.lock';const fd=fs.openSync(lock,'wx',0o600);fs.writeSync(fd,String(process.pid));
const persist=()=>{const tmp=journalPath+'.tmp';fs.writeFileSync(tmp,JSON.stringify(records,null,2)+'\n',{mode:0o600});fs.renameSync(tmp,journalPath);};
try{
 const walletPath='/Users/dear/.config/tickergarden/testnet-wallets/arbitrum-sepolia.json';const stat=fs.lstatSync(walletPath);ensure(!stat.isSymbolicLink()&&!(stat.mode&0o077),'Unsafe wallet permissions');
 const wallet=JSON.parse(fs.readFileSync(walletPath));ensure(wallet.chainId===421614,'Wallet chain');
 const account=privateKeyToAccount(wallet.privateKey);ensure(account.address.toLowerCase()===cert.deployer.toLowerCase(),'Wrong wallet');
 const signer=createWalletClient({account,chain:arbitrumSepolia,transport:http(rpc)});
 for(let i=0;i<batch.transactions.length;i++){
  ensure(Date.now()/1000<=cert.expiresAt,'Certificate expired during execution');
  const t=batch.transactions[i].transaction,nonce=Number(BigInt(t.nonce)),inputHash=keccak256(t.input);
  let record=records[i];
  if(record)ensure(record.index===i&&record.nonce===nonce&&record.inputHash===inputHash&&record.to.toLowerCase()===t.to.toLowerCase(),'Journal mismatch');
  if(!record){
   ensure(await client.getTransactionCount({address:account.address,blockTag:'pending'})===nonce,'Nonce drift; reconcile without resubmitting');
   const gas=await client.estimateGas({account:account.address,to:t.to,data:t.input,value:0n});
   const fees=await client.estimateFeesPerGas(),gasLimit=(gas*13n+9n)/10n,maxCost=gasLimit*fees.maxFeePerGas;
   ensure(spent+maxCost<=cap,'Deployment budget cap exceeded');ensure(await client.getBalance({address:account.address})>=maxCost,'Insufficient test ETH');
   const prepared=await signer.prepareTransactionRequest({account,chain:arbitrumSepolia,to:t.to,data:t.input,value:0n,nonce,gas:gasLimit,...fees});
   const signed=await signer.signTransaction(prepared);
   record={index:i,nonce,to:t.to,inputHash,hash:keccak256(signed),status:'SIGNED_INTENT',estimatedGas:String(gas),gasLimit:String(gasLimit),maxFeePerGas:String(fees.maxFeePerGas)};
   records.push(record);persist();
   await client.sendRawTransaction({serializedTransaction:signed});record.status='SUBMITTED';persist();
  }
  // Unknown submission always reconciles the same hash; never signs a replacement or repeats the business action.
  const receipt=await client.waitForTransactionReceipt({hash:record.hash,confirmations:2,timeout:120000});
  const actual=await client.getTransaction({hash:record.hash}),canonical=await client.getBlock({blockNumber:receipt.blockNumber});
  ensure(canonical.hash===receipt.blockHash&&actual.from.toLowerCase()===cert.deployer.toLowerCase()&&actual.to.toLowerCase()===t.to.toLowerCase()&&actual.nonce===nonce&&keccak256(actual.input)===inputHash&&actual.value===0n,'Receipt transaction identity mismatch');
  record.status=receipt.status==='success'?'CONFIRMED':'REVERTED';record.blockNumber=String(receipt.blockNumber);record.blockHash=receipt.blockHash;record.gasUsed=String(receipt.gasUsed);record.effectiveGasPrice=String(receipt.effectiveGasPrice);record.feeWei=String(receipt.gasUsed*receipt.effectiveGasPrice);persist();
  ensure(receipt.status==='success','Transaction reverted; stop');spent+=BigInt(record.feeWei);ensure(spent<=cap,'Actual budget exceeded');
  console.log(JSON.stringify({index:i,nonce,status:record.status,hash:record.hash,gasUsed:record.gasUsed,spentWei:String(spent)}));
 }
 console.log(JSON.stringify({status:'DEPLOYED_NOT_ACTIVATED',releaseId:cert.releaseId,transactions:records.length,totalFeeWei:String(spent)}));
}finally{fs.closeSync(fd);fs.unlinkSync(lock);}
