// Read-only second audit: reconcile holder payments and rollover against canonical receipts.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createPublicClient,http,decodeEventLog} from '../apps/web/node_modules/viem/_esm/index.js';
const dir='outputs/reviews/r6-fast-test-2026-09-06/public';
const s=JSON.parse(fs.readFileSync(dir+'/results.json'));
const prior=JSON.parse(fs.readFileSync(dir+'/receipt-audit.json'));
const p=JSON.parse(fs.readFileSync('deployments/manifests/arbitrum-sepolia-421614.v1.deployed.json'));
assert.equal(p.releaseId,'0xf2ab431cdae9144d0bd1b5f4f3c52c337e0b77a5aa8fd5504cff3d46bf2eec4f');
assert.equal(s.releaseId,p.releaseId);assert.equal(prior.releaseId,p.releaseId);
assert.equal(prior.sourceTransactions,s.transactions.length,'Receipt audit must cover current journal');
assert.equal(prior.status,'RECEIPTS_AND_OBSERVED_ACCOUNTING_VERIFIED');
const c=createPublicClient({transport:http('https://sepolia-rollup.arbitrum.io/rpc')});
assert.equal(await c.getChainId(),421614);
const blockNumber=BigInt(prior.blockNumber),header=await c.getBlock({blockNumber});assert.equal(header.hash,prior.blockHash);
const distributor=p.ordinaryComponents[14];
const abi=JSON.parse(fs.readFileSync('contracts/out-v1/TreasuryDistributorV1.sol/TreasuryDistributorV1.json')).abi;
const read=(functionName,args)=>c.readContract({address:distributor,abi,functionName,args,blockNumber});
const events=[];
for(const t of s.transactions){
 const cached=JSON.parse(fs.readFileSync(dir+'/receipts/'+t.hash+'.json'));
 assert.equal(cached.receipt.blockHash,t.blockHash);assert.equal(cached.receipt.transactionHash,t.hash);
 for(const l of cached.receipt.logs){
  if(l.address.toLowerCase()!==distributor.toLowerCase())continue;
  try{events.push({...decodeEventLog({abi,data:l.data,topics:l.topics}),transactionHash:t.hash,blockTimestamp:BigInt(cached.header.timestamp)});}catch{}
 }
}
const rows=[];
for(const [key,root]of Object.entries(s.roots??{})){
 if(!root.published)continue;
 const m=s.markets[key],epoch=await read('epoch',[m.id,1]),dataset=root.dataset;
 assert.equal(epoch.merkleRoot.toLowerCase(),dataset.merkleRoot.toLowerCase());
 assert.equal(epoch.datasetHash.toLowerCase(),dataset.datasetHash.toLowerCase());
 const source=await c.getBlock({blockNumber:BigInt(epoch.sourceBlockNumber)});assert.equal(source.hash,epoch.sourceBlockHash);
 const paid=events.filter(x=>x.eventName==='TreasuryClaimed'&&x.args.marketId===m.id&&x.args.epochId===1);
 const indices=new Set();let sum=0n;
 for(const event of paid){
  const a=event.args,leaf=dataset.leaves.find(x=>BigInt(x.index)===a.leafIndex);assert.ok(leaf,'Unknown paid leaf');
  assert.ok(!indices.has(String(a.leafIndex)),'Duplicate paid leaf');indices.add(String(a.leafIndex));
  assert.equal(a.account.toLowerCase(),leaf.account.toLowerCase());assert.equal(a.twab,BigInt(leaf.twab));assert.equal(a.amount,BigInt(leaf.amount));sum+=a.amount;
 }
 assert.equal(sum,epoch.claimedAmount);assert.ok(sum<=epoch.quoteAmount);
 if(root.claimed){
  const tx=s.transactions.find(x=>x.id==='root-finalize-'+key);assert.ok(tx);
  const receipt=JSON.parse(fs.readFileSync(dir+'/receipts/'+tx.hash+'.json'));
  assert.equal(epoch.claimUntil-BigInt(receipt.header.timestamp),7200n);
  assert.equal(paid.length,dataset.leaves.length-root.unclaimed.length);
 }
 const rollovers=events.filter(x=>x.eventName==='EpochRemainderRolledOver'&&x.args.marketId===m.id&&x.args.fromEpochId===1);
 if(root.rolledOver){
  assert.equal(rollovers.length,1);assert.equal(rollovers[0].args.amount,epoch.quoteAmount-sum);
  assert.ok(rollovers[0].blockTimestamp>epoch.claimUntil);
 }
 rows.push({key,sourceBlockNumber:epoch.sourceBlockNumber,sourceBlockHash:source.hash,paidLeaves:paid.length,paidAmount:sum,epochQuote:epoch.quoteAmount,rolledOver:!!root.rolledOver,rolloverAmount:rollovers[0]?.args.amount??null});
}
const zero='0x'+'00'.repeat(20),solvency=[];
for(const asset of [zero,s.testQuote]){
 const quote=await read('totalQuoteLiability',[asset]),service=await read('totalServiceLiability',[asset]);
 const balance=asset===zero?await c.getBalance({address:distributor,blockNumber}):await c.readContract({address:asset,abi:JSON.parse(fs.readFileSync('contracts/out-v1/TickerMemeTokenV1.sol/TickerMemeTokenV1.json')).abi,functionName:'balanceOf',args:[distributor],blockNumber});
 assert.ok(balance>=quote+service,'Holder/service insolvency');solvency.push({asset,balance,quoteLiability:quote,serviceLiability:service});
}
if(process.argv.includes('--final')){assert.equal(rows.length,8);assert.ok(rows.every(x=>x.rolledOver));}
assert.equal((await c.getBlock({blockNumber})).hash,header.hash,'Audit pin changed');
const output={status:'HOLDER_RECEIPTS_AND_LIABILITIES_VERIFIED',scope:'Actual published roots only; not continuous indexer or browser coverage',releaseId:p.releaseId,sourceTransactions:s.transactions.length,blockNumber,blockHash:header.hash,rows,solvency};
fs.writeFileSync(dir+'/holder-audit.json',JSON.stringify(output,(_,x)=>typeof x==='bigint'?String(x):x,2)+'\n');
console.log(JSON.stringify({status:output.status,markets:rows.length,rolledOver:rows.filter(x=>x.rolledOver).length}));
