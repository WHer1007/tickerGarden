import fs from 'node:fs';
import { createPublicClient, createWalletClient, http, keccak256 } from '../apps/web/node_modules/viem/_esm/index.js';
import { privateKeyToAccount } from '../apps/web/node_modules/viem/_esm/accounts/index.js';
import { arbitrumSepolia } from '../apps/web/node_modules/viem/_esm/chains/index.js';

export async function broadcastSequential(env, secret) {
 const client=createPublicClient({chain:arbitrumSepolia,transport:http(env.ARBITRUM_SEPOLIA_RPC_URL)});
 const account=privateKeyToAccount(secret);
 if(await client.getChainId()!==421614||account.address.toLowerCase()!==env.V1_EXPECTED_DEPLOYER.toLowerCase())throw Error('Chain/account mismatch');
 const signer=createWalletClient({chain:arbitrumSepolia,account,transport:http(env.ARBITRUM_SEPOLIA_RPC_URL)});
 const batch=JSON.parse(fs.readFileSync('contracts/broadcast/DeployV1ArbitrumStaged.s.sol/421614/dry-run/run-latest.json'));
 const cert=JSON.parse(fs.readFileSync('deployments/evidence/v1-current-release.json'));
 if(cert.status!=='VERIFIED'||cert.expiresAt*1000<Date.now())throw Error('Release certificate expired');
 const releaseDirectory='deployments/releases/'+env.V1_RELEASE_ID;
 fs.mkdirSync(releaseDirectory,{recursive:true});
 const recordPath=releaseDirectory+'/transactions.json';
 const records=fs.existsSync(recordPath)?JSON.parse(fs.readFileSync(recordPath)):[];
 const persist=()=>{const json=JSON.stringify(records,null,2)+'\n';fs.writeFileSync(recordPath,json);fs.writeFileSync('deployments/manifests/arbitrum-sepolia-421614.v1.transactions.json',json);};
 for(const entry of batch.transactions){
  const tx=entry.transaction;
  if(tx.from.toLowerCase()!==account.address.toLowerCase()||BigInt(tx.value??'0x0')!==0n||(tx.input.length-2)/2>90000)throw Error('Unapproved transaction fields');
  const nonce=Number(BigInt(tx.nonce));const inputHash=keccak256(tx.input);
  let record=records.find(r=>r.nonce===nonce);
  if(record&&(record.inputHash!==inputHash||record.to.toLowerCase()!==tx.to.toLowerCase()))throw Error('Previously submitted nonce has different payload');
  if(!record){
   if(await client.getTransactionCount({address:account.address,blockTag:'pending'})!==nonce)throw Error('Unexpected pending nonce; reconcile before retry');
   const gas=await client.estimateGas({account:account.address,to:tx.to,data:tx.input,value:0n});
   const fees=await client.estimateFeesPerGas();
   const gasLimit=gas*13n/10n;
   if(gasLimit*fees.maxFeePerGas>await client.getBalance({address:account.address}))throw Error('Insufficient test ETH');
   const prepared=await signer.prepareTransactionRequest({account,chain:arbitrumSepolia,to:tx.to,data:tx.input,value:0n,nonce,gas:gasLimit,...fees});
   const signed=await signer.signTransaction(prepared);
   record={nonce,to:tx.to,inputHash,transactionHash:keccak256(signed),status:'SIGNED_PENDING_SUBMISSION',estimatedGas:gas.toString()};
   records.push(record);persist();
   await client.sendRawTransaction({serializedTransaction:signed});
   record.status='SUBMITTED';persist();
  }
  const receipt=await client.waitForTransactionReceipt({hash:record.transactionHash,confirmations:2,timeout:120000});
  record.status=receipt.status==='success'?'CONFIRMED':'REVERTED';record.blockNumber=receipt.blockNumber.toString();record.gasUsed=receipt.gasUsed.toString();
  persist();
  console.log(JSON.stringify({nonce,status:record.status,hash:record.transactionHash,gasUsed:record.gasUsed}));
  if(receipt.status!=='success')throw Error('Onchain transaction reverted; stop and reconcile');
 }
}
