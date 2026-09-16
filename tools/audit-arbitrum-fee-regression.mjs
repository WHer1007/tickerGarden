import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createPublicClient,http,decodeEventLog,keccak256} from '../apps/web/node_modules/viem/_esm/index.js';
const dir='outputs/reviews/arbitrum-r4-fix/public-regression',s=JSON.parse(fs.readFileSync(dir+'/results.json')),p=JSON.parse(fs.readFileSync('deployments/manifests/arbitrum-sepolia-421614.v1.deployed.json'));
const c=createPublicClient({transport:http('https://sepolia-rollup.arbitrum.io/rpc')});assert.equal(await c.getChainId(),421614);assert.equal(s.releaseId,p.releaseId);
const artifact=n=>JSON.parse(fs.readFileSync(`contracts/out-v1/${n}.sol/${n}.json`)).abi;
const fees=p.ordinaryComponents[15],vault=p.ordinaryComponents[13],manager=p.ordinaryComponents[12],zero='0x'+'00'.repeat(20);
const markets=s.markets,roles=JSON.parse(fs.readFileSync(dir+'/roles.json')).roles;
const receipts=[],feeRows=[],curveRows=[],conversions=[],exits=[];let gas=0n;
for(const tx of s.transactions){
 const r=await c.getTransactionReceipt({hash:tx.hash});const chainTx=await c.getTransaction({hash:tx.hash});const header=await c.getBlock({blockNumber:r.blockNumber});
 assert.equal(header.hash,r.blockHash,'Receipt canonical block');assert.equal(keccak256(chainTx.input),tx.inputHash,'Saved payload differs');assert.equal(chainTx.from.toLowerCase(),roles[tx.role].toLowerCase());assert.equal(chainTx.to?.toLowerCase(),tx.to?.toLowerCase());assert.equal(chainTx.value,BigInt(tx.value));assert.equal(r.status,tx.expectedStatus??'success',tx.id);if(r.status==='reverted')assert.equal(r.logs.length,0);
 gas+=r.gasUsed*r.effectiveGasPrice;receipts.push({id:tx.id,hash:tx.hash,status:r.status,blockNumber:r.blockNumber,blockHash:r.blockHash,gasWei:r.gasUsed*r.effectiveGasPrice});
 const events=[];
 for(const log of r.logs){let name=log.address.toLowerCase()===fees.toLowerCase()?'ProtocolFeeVault':log.address.toLowerCase()===p.hook.toLowerCase()?'TickerGardenMemeHook':log.address.toLowerCase()===manager.toLowerCase()?'AllocationManager':null;if(!name)continue;try{events.push(decodeEventLog({abi:artifact(name),data:log.data,topics:log.topics}));}catch{}}
 for(const e of events.filter(x=>x.eventName==='V4FeeAccrued')){const a=e.args,b=events.find(x=>x.eventName==='FeeBucketsCredited'&&x.args.feeId===a.feeId)?.args;assert.ok(b);const m=Object.values(markets).find(x=>x.id===a.marketId);assert.ok(m);const basic=a.base/100n,tax=a.base*BigInt(m.params.creatorTaxBps)/10000n,platform=basic*3000n/10000n,staker=b.activeStock>0n?basic*3000n/10000n:0n,creatorBase=basic-platform-staker,holder=m.params.creatorFeesToHolders?creatorBase/2n:0n;
 assert.equal(a.totalFee,basic+tax);assert.equal(b.platformAmount,platform);assert.equal(b.stakerAmount,staker);assert.equal(b.creatorAmount,creatorBase-holder+tax);
 const h=events.filter(x=>x.eventName==='HolderFeesAccrued'&&x.args.marketId===a.marketId&&x.args.feeAsset.toLowerCase()===a.feeAsset.toLowerCase()).reduce((v,x)=>v+x.args.amount,0n);assert.equal(h,holder);assert.equal(b.creatorAmount+staker+platform+holder,a.totalFee);
 feeRows.push({id:tx.id,asset:a.feeAsset,basic,tax,creator:b.creatorAmount,staker,platform,holder,activeStock:b.activeStock});}
 for(const e of events.filter(x=>x.eventName==='CurveFeesSwept')){const a=e.args;const holder=events.filter(x=>x.eventName==='HolderFeesAccrued'&&x.args.marketId===a.marketId&&x.args.feeAsset.toLowerCase()===a.quoteAsset.toLowerCase()).reduce((v,x)=>v+x.args.amount,0n);assert.equal(a.amount,a.creatorAmount+a.platformAmount+holder,'Curve fee conservation');curveRows.push({id:tx.id,...a,holder});}
 for(const e of events.filter(x=>x.eventName==='RewardBatchConverted')){const parts=events.filter(x=>x.eventName==='RewardConverted');conversions.push({id:tx.id,batch:e.args,items:parts.map(x=>x.args)});assert.equal(parts.length,tx.id==='batch-conversion-success'?2:1,'Conversion item count');assert.equal(parts.reduce((v,x)=>v+x.args.quoteReceived,0n),e.args.quoteReceived,'Quote conversion conservation');assert.equal(parts.reduce((v,x)=>v+x.args.memeSpent,0n),e.args.memeSpent,'Meme conversion conservation');}
 for(const e of events.filter(x=>/RageQuit|Settlement/.test(x.eventName)))exits.push({id:tx.id,event:e.eventName,args:e.args});
 for(const e of events.filter(x=>x.eventName==='FeeClaimed'&&x.args.beneficiaryType===0))assert.equal(e.args.beneficiary.toLowerCase(),Object.values(markets).find(m=>m.id===e.args.marketId).params.creatorRevenueBeneficiary.toLowerCase());
 if(tx.id.startsWith('option-repeat-claim-'))assert.equal(events.filter(x=>x.eventName==='FeeClaimed').length,0,'Duplicate payout');
}
const block=await c.getBlock();const read=(n,address,functionName,args=[])=>c.readContract({address,abi:artifact(n),functionName,args,blockNumber:block.number});
const solvency=[];
for(const asset of [zero,s.testQuote,...new Set(Object.values(markets).map(m=>m.token))]){const balance=asset===zero?await c.getBalance({address:fees,blockNumber:block.number}):await read('TickerMemeTokenV1',asset,'balanceOf',[fees]);const liability=await read('ProtocolFeeVault',fees,'totalLiability',[asset]);assert.ok(balance>=liability,'Insolvent '+asset);solvency.push({asset,balance,liability});}
assert.equal(s.status,'PUBLIC_R5_FEE_REGRESSION_PASSED');
assert.equal(feeRows.length,2,'actual v4 buy and sell fee rows');
assert.equal(conversions.length,1,'creator conversion batch');
assert.ok(feeRows.every(row=>row.staker===0n),'no staking reward in disabled markets');
const report={status:'PUBLIC_R5_RECEIPTS_AND_ACCOUNTING_VERIFIED',chainId:421614,releaseId:p.releaseId,verifiedAt:new Date().toISOString(),blockNumber:block.number,blockHash:block.hash,transactions:receipts.length,gasWei:gas,receipts,feeRows,curveRows,conversions,solvency};
fs.writeFileSync(dir+'/receipt-audit.json',JSON.stringify(report,(_,v)=>typeof v==='bigint'?String(v):v,2)+'\n');
console.log(JSON.stringify({status:report.status,transactions:receipts.length,feeRows:feeRows.length,gasWei:String(gas)}));
