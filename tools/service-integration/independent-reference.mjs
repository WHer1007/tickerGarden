// Historical R6 fast-clock reproduction only. Uses its frozen overlay reference; never production or current CI.
// Do not substitute the current seven-day reference: that would change the historical test epoch semantics.
// Independent token-scoped RPC scan, not an export of the Go journal input.
import fs from 'node:fs';
import {createPublicClient,http} from '../../apps/web/node_modules/viem/_esm/index.js';
import {generateTreasuryRoot} from '../../.codex_tmp/r6-fast-test/services/treasury-root-generator/src/index.ts';
const root='.codex_tmp/r6-fast-test',out='outputs/reviews/formal-clock-service-integration-2026-09-06/service-live';
const s=JSON.parse(fs.readFileSync(root+'/outputs/reviews/service-live-2026-09-06/results.json')),manifest=JSON.parse(fs.readFileSync(out+'/manifest.json'));
const c=createPublicClient({transport:http('https://sepolia-rollup.arbitrum.io/rpc')});if(await c.getChainId()!==421614)throw Error('Wrong chain');
const distributor=manifest.contracts.find(x=>x.module==='TreasuryDistributorV1').address;
const abi=JSON.parse(fs.readFileSync(root+'/contracts/out-v1/TreasuryDistributorV1.sol/TreasuryDistributorV1.json')).abi;
const marketId=s.market.id,memeToken=s.market.token;
const read=(functionName,args)=>c.readContract({address:distributor,abi,functionName,args});
const e=await read('epoch',[marketId,1]),m=await read('market',[marketId]),window=await read('epochWindow',[marketId,1]),excludedAccounts=await read('feeSharingExcludedAccounts',[marketId]);
if(e.status!==1)throw Error('Root request not active');
const source=await c.getBlock({blockNumber:BigInt(e.sourceBlockNumber)});if(source.hash!==e.sourceBlockHash)throw Error('Committed source mismatch');
const event=JSON.parse(fs.readFileSync(root+'/contracts/out-v1/TickerMemeTokenV1.sol/TickerMemeTokenV1.json')).abi.find(x=>x.type==='event'&&x.name==='Transfer');
const start=BigInt(s.transactions.find(t=>t.id==='service-launch').blockNumber);const transfers=[],ranges=[],headers=new Map(),receipts=new Map();
for(let from=start;from<=source.number;from+=2000n){const to=from+1999n<source.number?from+1999n:source.number;const logs=await c.getLogs({address:memeToken,event,fromBlock:from,toBlock:to,strict:true});
 for(const l of logs){if(!headers.has(String(l.blockNumber)))headers.set(String(l.blockNumber),await c.getBlock({blockNumber:l.blockNumber}));const h=headers.get(String(l.blockNumber));if(h.hash!==l.blockHash)throw Error('Transfer/header mismatch');
 if(!receipts.has(l.transactionHash))receipts.set(l.transactionHash,await c.getTransactionReceipt({hash:l.transactionHash}));const r=receipts.get(l.transactionHash);if(r.status!=='success'||r.blockHash!==h.hash||!r.logs.some(x=>x.logIndex===l.logIndex&&x.address.toLowerCase()===memeToken.toLowerCase()&&x.data===l.data))throw Error('Receipt does not prove transfer');
 transfers.push({blockNumber:l.blockNumber,transactionIndex:l.transactionIndex,logIndex:l.logIndex,timestamp:h.timestamp,from:l.args.from,to:l.args.to,value:l.args.value});}
 ranges.push({from:String(from),to:String(to),logs:logs.length});}
if((await c.getBlock({blockNumber:source.number})).hash!==source.hash)throw Error('Reorg during independent scan');
const input={chainId:421614n,distributor,marketId,memeToken,quoteToken:m.quoteToken,eligibilityPolicyHash:m.eligibilityPolicyHash,excludedAccounts,epochId:1,windowStart:window[0],windowEnd:window[1],sourceBlockNumber:source.number,sourceBlockHash:source.hash,sourceBlockTimestamp:source.timestamp,quoteAmount:e.quoteAmount,transfers};
const dataset=generateTreasuryRoot(input),json=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?String(v):v,2)+'\n';
fs.writeFileSync(out+'/independent-input.json',json(input));fs.writeFileSync(out+'/independent-typescript.json',json(dataset));fs.writeFileSync(out+'/independent-history.json',json({upstream:'https://sepolia-rollup.arbitrum.io/rpc',ranges,headers:[...headers.values()],receipts:[...receipts.values()],source,receiptRootVerified:false,method:'TOKEN_SCOPED_ALL_TRANSFER_RANGES_PLUS_CANONICAL_RECEIPTS'}));
fs.writeFileSync(out+'/request.json',json({...input,transfers:[]}));fs.writeFileSync(out+'/policies.json',json([{chainId:421614,marketId,policyHash:m.eligibilityPolicyHash,excludedAccounts}]));
for(const l of dataset.leaves)if((await read('claimLeaf',[marketId,1,BigInt(l.index),l.account,l.twab,l.amount])).toLowerCase()!==l.leaf.toLowerCase())throw Error('Solidity leaf mismatch');
console.log(json({leafCount:dataset.leafCount,merkleRoot:dataset.merkleRoot,datasetHash:dataset.datasetHash,solidityLeavesMatch:true}));
