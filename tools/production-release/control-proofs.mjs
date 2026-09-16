import path from 'node:path';
import assert from 'node:assert/strict';
import {recoverMessageAddress,hashMessage} from '../../apps/web/node_modules/viem/_esm/index.js';
import {read,write,json,sha,equal} from './common.mjs';
function buildControlChallenges(output){
 const snapshot=read(path.join(output,'mainnet-snapshot.json')),pack=read(path.join(output,'transactions.unsigned.json'));
 assert.equal(pack.chainId,4663);assert.equal(snapshot.chainId,4663);assert.equal(pack.broadcastAuthorized,false);
 const packSha256=sha(path.join(output,'transactions.unsigned.json'));
 const challenge=(role,address,owners,threshold)=>{
  const message=['TickerGarden production readiness control proof','Purpose: prove signer availability only. This is not a transaction and does not authorize broadcasting or spending.','Chain ID: 4663','Release ID: '+pack.releaseId,'Unsigned transaction pack SHA256: '+packSha256,'Role: '+role,'Account: '+address,'Pinned block hash: '+snapshot.pin.blockHash].join('\n');
  return {role,address,eligibleSigners:owners,requiredSignatures:threshold,scheme:'EIP-191 personal_sign UTF-8 text',message,messageHash:hashMessage(message)};
 };
 const challenges=[challenge('Treasury and Pause Guardian Safe',snapshot.accounts.treasury.address,snapshot.accounts.treasury.owners,snapshot.accounts.treasury.threshold),challenge('Governance and Unpause Safe',snapshot.accounts.governance.address,snapshot.accounts.governance.owners,snapshot.accounts.governance.threshold),challenge('Holder publisher and on-demand Keeper',snapshot.accounts.operator.address,[snapshot.accounts.operator.address],1)];
 return {status:'UNSIGNED_CONTROL_CHALLENGES_NOT_BROADCAST_AUTHORIZATION',chainId:4663,releaseId:pack.releaseId,packSha256,challenges};
}
export function prepareControlChallenges(output){
 const result=buildControlChallenges(output);write(path.join(output,'control-challenges.json'),result);return result;
}
export async function verifyControlProofs(output,proofFile){
 const prepared=read(path.join(output,'control-challenges.json')),proofs=read(proofFile);equal(prepared.packSha256,sha(path.join(output,'transactions.unsigned.json')),'control proof pack binding');
 assert.deepEqual(prepared,buildControlChallenges(output),'Control challenge must match the pinned owners, threshold, release and transaction pack');
 const results=[];
 for(const challenge of prepared.challenges){
  const row=proofs.find(p=>p.address?.toLowerCase()===challenge.address.toLowerCase());assert.ok(row,'Missing account control proof');const signers=new Set();
  for(const signature of row.signatures??[]){const signer=(await recoverMessageAddress({message:challenge.message,signature})).toLowerCase();assert.ok(challenge.eligibleSigners.some(x=>x.toLowerCase()===signer),'Ineligible control signer');assert.ok(!signers.has(signer),'Duplicate control signer');signers.add(signer);}
  assert.ok(signers.size>=challenge.requiredSignatures,'Insufficient control signatures');results.push({account:challenge.address,signers:[...signers],threshold:challenge.requiredSignatures});
 }
 return {status:'EOA_OWNER_CONTROL_PROOFS_VERIFIED_NOT_SAFE_TRANSACTION_EXECUTION',releaseId:prepared.releaseId,results};
}
if(process.argv[1]===new URL(import.meta.url).pathname){const output=path.resolve(process.argv[2]??'docs/reviews/evidence/production-release-2026-09-15');console.log(json(process.argv[3]?await verifyControlProofs(output,process.argv[3]):prepareControlChallenges(output)));}
