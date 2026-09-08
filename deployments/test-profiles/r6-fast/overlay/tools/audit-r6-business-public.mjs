import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash}from'node:crypto';
import {createPublicClient,http,decodeEventLog,decodeFunctionData,keccak256} from '../apps/web/node_modules/viem/_esm/index.js';
const dir='outputs/reviews/r6-fast-test-2026-09-06/public';const s=JSON.parse(fs.readFileSync(dir+'/results.json')),p=JSON.parse(fs.readFileSync('deployments/manifests/arbitrum-sepolia-421614.v1.deployed.json')),roles=JSON.parse(fs.readFileSync(dir+'/roles.json')).roles;
s.transactions=s.transactions.filter(t=>['CONFIRMED','EXPECTED_REVERT'].includes(t.status));
const c=createPublicClient({transport:http('https://sepolia-rollup.arbitrum.io/rpc')});assert.equal(await c.getChainId(),421614);assert.equal(s.releaseId,p.releaseId);
const serial=v=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?String(x):x,2)+'\n';const abi=n=>JSON.parse(fs.readFileSync(`contracts/out-v1/${n}.sol/${n}.json`)).abi;
const fees=p.ordinaryComponents[15],zero='0x'+'00'.repeat(20),markets=Object.values(s.markets),pending=new Map(),launchTimestamps=new Map(),curveNet=new Map(),curveTokens=new Map();
const feeRows=[],curveRows=[],conversions=[],receipts=[],claimRows=[];let gas=0n;
fs.mkdirSync(dir+'/receipts',{recursive:true});
const chainEvidence=[];
for(let start=0;start<s.transactions.length;start+=6){
 const batch=await Promise.all(s.transactions.slice(start,start+6).map(async t=>{let r,tx;const cached=dir+'/receipts/'+t.hash+'.json';
 if(fs.existsSync(cached)){const v=JSON.parse(fs.readFileSync(cached));r=v.receipt;tx=v.transaction;for(const k of ['blockNumber','gasUsed','effectiveGasPrice'])r[k]=BigInt(r[k]);tx.value=BigInt(tx.value);}
 else [r,tx]=await Promise.all([c.getTransactionReceipt({hash:t.hash}),c.getTransaction({hash:t.hash})]);
 const header=await c.getBlock({blockNumber:r.blockNumber});fs.writeFileSync(dir+'/receipts/'+t.hash+'.json',serial({receipt:r,transaction:tx,header}));return {t,r,tx,header};}));chainEvidence.push(...batch);
}
for(const {t,r,tx,header}of chainEvidence){
 assert.equal(header.hash,r.blockHash);assert.equal(keccak256(tx.input),t.inputHash);assert.equal(tx.from.toLowerCase(),roles[t.role].toLowerCase());assert.equal(tx.to?.toLowerCase(),t.to?.toLowerCase());assert.equal(tx.value,BigInt(t.value));assert.equal(r.status,t.expectedStatus??'success',t.id);
 gas+=r.gasUsed*r.effectiveGasPrice;receipts.push({id:t.id,hash:t.hash,status:r.status,blockNumber:r.blockNumber,blockHash:r.blockHash,gasWei:r.gasUsed*r.effectiveGasPrice});
 const mtx=markets.find(m=>t.id==='launch-'+m.key);if(mtx)launchTimestamps.set(mtx.id,header.timestamp);
 const events=[];
 for(const l of r.logs){const curve=markets.find(m=>m.curve?.toLowerCase()===l.address.toLowerCase());const name=curve?'TickerGardenCurve':l.address.toLowerCase()===fees.toLowerCase()?'ProtocolFeeVault':l.address.toLowerCase()===p.hook.toLowerCase()?'TickerGardenMemeHook':null;if(!name)continue;try{events.push({...decodeEventLog({abi:abi(name),data:l.data,topics:l.topics}),curve});}catch{}}
 for(const e of events){
  if(e.eventName==='CurveBuy'||e.eventName==='CurveSell'){
   const m=e.curve,a=e.args,gross=e.eventName==='CurveBuy'?a.quoteIn:a.quoteOut+a.fee+a.tax;
   const basic=gross/100n,tax=gross*BigInt(m.params.creatorTaxBps)/10000n;
   assert.equal(a.fee,basic,'Curve basic '+t.id);
   let anti=0n;if(e.eventName==='CurveBuy'&&a.recipient.toLowerCase()!==roles.creator.toLowerCase()){
    const elapsed=header.timestamp-launchTimestamps.get(m.id);const raw=elapsed>=3n?0n:elapsed===0n?9900n:elapsed===1n?618n:19n;
    const max=9800n-BigInt(m.params.creatorTaxBps);anti=gross*(raw<max?raw:max)/10000n;
   }
   assert.equal(a.tax,tax+anti,'Curve tax '+t.id);
   const supply=1000000000n*10n**18n,phantom=m.quote===zero?1680000000000000n:40n*10n**18n,threshold=m.quote===zero?4200000000000000n:100n*10n**18n;
   const tokensBefore=curveTokens.get(m.id)??supply,quoteBefore=phantom+(curveNet.get(m.id)??0n),reserved=supply*phantom/(phantom+threshold);
   if(e.eventName==='CurveBuy'){
    const net=gross-basic-tax-anti,uncapped=net*tokensBefore/(quoteBefore+net),sellable=tokensBefore-reserved;
    assert.equal(a.tokensOut,uncapped>sellable?sellable:uncapped,'Independent constant-product buy '+t.id);
    if(uncapped>sellable){
     const netRequired=sellable*quoteBefore/(tokensBefore-sellable)+1n;
     const denominator=10000n-100n-BigInt(m.params.creatorTaxBps);assert.equal(anti,0n,'Tail-fill anti-snipe needs separate oracle');
     assert.equal(gross,(netRequired*10000n+denominator-1n)/denominator,'Exact rounded tail gross');
    }
    curveTokens.set(m.id,tokensBefore-a.tokensOut);
   }else{
    assert.equal(gross,a.tokensIn*quoteBefore/(tokensBefore+a.tokensIn),'Independent constant-product sell '+t.id);curveTokens.set(m.id,tokensBefore+a.tokensIn);
   }
   curveNet.set(m.id,(curveNet.get(m.id)??0n)+(e.eventName==='CurveBuy'?gross-basic-tax-anti:-gross));
   if(e.eventName==='CurveBuy'){
    const call=decodeFunctionData({abi:abi(t.id.startsWith('launch-')?'LaunchAndBuyRouter':'TickerGardenCurve'),data:tx.input});const declared=t.id.startsWith('launch-')?call.args[1]:call.args[0];
    const refunds=events.filter(x=>x.eventName==='CurveBuyRefunded').reduce((v,x)=>v+x.args.unusedQuote,0n);assert.equal(a.quoteIn+refunds,declared,'Partial fill/refund conservation');
   }
   const v=pending.get(m.id)??{base:0n,tax:0n};v.base+=basic+anti;v.tax+=tax;pending.set(m.id,v);
  }
  if(e.eventName==='CurveFeesSwept'){
   const a=e.args,m=markets.find(m=>m.id===a.marketId),v=pending.get(m.id);assert.ok(v,'No curve fee origin');
   const platform=v.base*3000n/10000n,creatorBase=v.base-platform,holder=m.params.creatorFeesToHolders?creatorBase/2n:0n;
   assert.equal(a.amount,v.base+v.tax);assert.equal(a.platformAmount,platform);assert.equal(a.creatorAmount,creatorBase-holder+v.tax);
   const actualHolder=events.filter(x=>x.eventName==='HolderFeesAccrued'&&x.args.marketId===m.id&&x.args.feeAsset.toLowerCase()===m.quote.toLowerCase()).reduce((a,x)=>a+x.args.amount,0n);assert.equal(actualHolder,holder);
   curveRows.push({id:t.id,marketId:m.id,base:v.base,tax:v.tax,creator:a.creatorAmount,platform,holder});pending.set(m.id,{base:0n,tax:0n});
  }
  if(e.eventName==='V4FeeAccrued'){
   const a=e.args,b=events.find(x=>x.eventName==='FeeBucketsCredited'&&x.args.feeId===a.feeId)?.args;assert.ok(b);const m=markets.find(m=>m.id===a.marketId);assert.ok(m);
   const basic=a.base/100n,tax=a.base*BigInt(m.params.creatorTaxBps)/10000n,platform=basic*3000n/10000n,staker=b.activeStock>0n?basic*3000n/10000n:0n,creatorBase=basic-platform-staker,holder=m.params.creatorFeesToHolders?creatorBase/2n:0n;
   assert.equal(a.totalFee,basic+tax);assert.equal(b.platformAmount,platform);assert.equal(b.stakerAmount,staker);assert.equal(b.creatorAmount,creatorBase-holder+tax);
   const h=events.filter(x=>x.eventName==='HolderFeesAccrued'&&x.args.marketId===m.id&&x.args.feeAsset.toLowerCase()===a.feeAsset.toLowerCase()).reduce((v,x)=>v+x.args.amount,0n);assert.equal(h,holder);assert.equal(b.creatorAmount+staker+platform+holder,a.totalFee);
   if(t.id.includes('-buy-'))assert.equal(a.feeAsset.toLowerCase(),m.token.toLowerCase());if(t.id.includes('-sell-'))assert.equal(a.feeAsset.toLowerCase(),m.quote.toLowerCase());
   if(t.id.includes('zero-'))assert.equal(b.activeStock,0n);if(t.id.includes('active-'))assert.equal(b.activeStock,400n*10n**18n);
   feeRows.push({id:t.id,marketId:m.id,asset:a.feeAsset,basic,tax,creator:b.creatorAmount,staker,platform,holder,activeStock:b.activeStock});
  }
  if(e.eventName==='RewardBatchConverted'){
   const parts=events.filter(x=>x.eventName==='RewardConverted');const m=markets.find(m=>m.id===e.args.marketId);assert.equal(parts.length,m.params.stakingEnabled?2:1);assert.equal(parts.reduce((v,x)=>v+x.args.quoteReceived,0n),e.args.quoteReceived);assert.equal(parts.reduce((v,x)=>v+x.args.memeSpent,0n),e.args.memeSpent);
   assert.equal(events.filter(x=>x.eventName==='V4FeeAccrued').length,0,'Reward conversion must not charge normal fees');conversions.push({id:t.id,batch:e.args,items:parts.map(x=>x.args)});
  }
  if(e.eventName==='FeeClaimed'){
   const a=e.args,m=markets.find(m=>m.id===a.marketId);const expected=a.beneficiaryType===0?(s.beneficiaryTransfers?.[m.id]?.[a.beneficiaryEpoch]??m.params.creatorRevenueBeneficiary):a.beneficiaryType===2?p.platformTreasury:null;
   if(expected)assert.equal(a.beneficiary.toLowerCase(),expected.toLowerCase());claimRows.push({id:t.id,...a});
  }
 }
}
const lastIncludedBlock=receipts.reduce((n,r)=>r.blockNumber>n?r.blockNumber:n,0n);
const block=await c.getBlock({blockNumber:lastIncludedBlock}),solvency=[];
for(const asset of [zero,s.testQuote,...markets.map(m=>m.token)]){const balance=asset===zero?await c.getBalance({address:fees,blockNumber:block.number}):await c.readContract({address:asset,abi:abi('TickerMemeTokenV1'),functionName:'balanceOf',args:[fees],blockNumber:block.number});const liability=await c.readContract({address:fees,abi:abi('ProtocolFeeVault'),functionName:'totalLiability',args:[asset],blockNumber:block.number});assert.ok(balance>=liability,'Insolvent '+asset);solvency.push({asset,balance,liability});}
const curveReserveRows=[];
for(const m of markets){const view=await c.readContract({address:p.ordinaryComponents[10],abi:abi('MarketRegistryV1'),functionName:'market',args:[m.id],blockNumber:block.number});
 const actual=await c.readContract({address:m.curve,abi:abi('TickerGardenCurve'),functionName:'realQuoteReserve',blockNumber:block.number});const expected=curveNet.get(m.id)??0n;
 if(view.runtime.launchPhase===0)assert.equal(actual,expected,'Curve reserve '+m.key);
 else {assert.equal(actual,0n,'Graduated curve reserve not emptied');const threshold=m.quote===zero?4200000000000000n:100000000000000000000n;const supply=1000000000n*10n**18n,phantom=m.quote===zero?1680000000000000n:40n*10n**18n,reserved=supply*phantom/(phantom+threshold),minimum=((supply-reserved)*phantom+reserved-1n)/reserved;assert.equal(curveTokens.get(m.id),reserved,'Graduation sells exactly the curve inventory');assert.ok(expected>=minimum,'Canonical graduation minimum');}
 curveReserveRows.push({marketId:m.id,key:m.key,netQuoteFromTrades:expected,actualCurveReserve:actual,phase:view.runtime.launchPhase,nominalThresholdRoundingExcess:view.runtime.launchPhase===1?expected-(m.quote===zero?4200000000000000n:100n*10n**18n):null});}
const report={curveReserveRows,status:'RECEIPTS_AND_OBSERVED_ACCOUNTING_VERIFIED',scope:'Only transactions present in source snapshot; not complete business acceptance',chainId:421614,releaseId:p.releaseId,verifiedAt:new Date().toISOString(),sourceTransactions:s.transactions.length,blockNumber:block.number,blockHash:block.hash,gasWei:gas,receipts,curveRows,feeRows,conversions,claimRows,solvency};
fs.writeFileSync(dir+'/receipt-audit.json',serial(report));console.log(serial({status:report.status,transactions:receipts.length,curveRows:curveRows.length,v4FeeRows:feeRows.length,conversions:conversions.length,gasWei:gas}));
