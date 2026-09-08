import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createPublicClient,http,decodeEventLog} from '../apps/web/node_modules/viem/_esm/index.js';

// Read-only, independent receipt/accounting audit. No wallet or signing capability is loaded.
const dir='outputs/reviews/arbitrum-r3-scenarios';
const s=JSON.parse(fs.readFileSync(dir+'/results.json'));
const p=JSON.parse(fs.readFileSync('deployments/manifests/arbitrum-sepolia-421614.v1.deployed.json'));
assert.equal(s.releaseId,p.releaseId);
const roles=JSON.parse(fs.readFileSync(dir+'/roles.json')).roles;
const c=createPublicClient({transport:http('https://sepolia-rollup.arbitrum.io/rpc')});
assert.equal(await c.getChainId(),421614);
const abi=n=>JSON.parse(fs.readFileSync(`contracts/out-v1/${n}.sol/${n}.json`)).abi;
const read=(n,address,functionName,args=[])=>c.readContract({address,abi:abi(n),functionName,args});
const fees=p.ordinaryComponents[15],zero='0x0000000000000000000000000000000000000000';
const equalAddress=(a,b)=>assert.equal(a.toLowerCase(),b.toLowerCase());
const active=JSON.parse(fs.readFileSync('deployments/manifests/arbitrum-sepolia-421614.v1.activation.json'));
const q=await read('ApprovedQuoteRegistry',p.ordinaryComponents[2],'quoteConfig',[active.quoteId]);assert.equal(q.graduationThreshold,420000000000000000n);assert.equal(q.phantomQuote,168000000000000000n);assert.equal(q.status,1);
assert.equal(await read('TreasuryDistributorV1',p.ordinaryComponents[14],'EPOCH_DURATION'),604800);assert.equal(await read('TreasuryDistributorV1',p.ordinaryComponents[14],'claimWindow'),2592000);
const rows=[];
let scenarioGas=0n;
for(const t of s.transactions){
  const r=await c.getTransactionReceipt({hash:t.hash});assert.equal(r.status,'success',t.id);
  scenarioGas+=r.gasUsed*r.effectiveGasPrice;
  const events=[];
  for(const log of r.logs){
    const name=log.address.toLowerCase()===fees.toLowerCase()?'ProtocolFeeVault':log.address.toLowerCase()===p.hook.toLowerCase()?'TickerGardenMemeHook':null;
    if(!name)continue;
    try{const e=decodeEventLog({abi:abi(name),data:log.data,topics:log.topics});events.push(e);}catch{}
  }
  for(const e of events.filter(e=>e.eventName==='V4FeeAccrued')){
    const a=e.args,b=events.find(x=>x.eventName==='FeeBucketsCredited'&&x.args.feeId===a.feeId)?.args;
    assert.ok(b,'missing attribution '+t.id);
    const market=Object.values(s.markets).find(x=>x.id===a.marketId);assert.ok(market);
    const basic=a.base/100n,tax=a.base*BigInt(market.params.creatorTaxBps)/10000n;
    assert.equal(a.totalFee,basic+tax,'base fee + creator tax');assert.equal(a.lpAmount,0n);
    const platform=basic*3000n/10000n,staker=b.activeStock>0n?basic*3000n/10000n:0n;
    const creatorBase=basic-platform-staker,holder=market.params.creatorFeesToHolders?creatorBase/2n:0n;
    assert.equal(b.platformAmount,platform);assert.equal(b.stakerAmount,staker);assert.equal(b.creatorAmount,creatorBase-holder+tax);
    const h=events.filter(x=>x.eventName==='HolderFeesAccrued'&&x.args.marketId===a.marketId&&x.args.feeAsset.toLowerCase()===a.feeAsset.toLowerCase()).reduce((sum,x)=>sum+x.args.amount,0n);
    assert.equal(h,holder,'holder excludes all creator tax');
    assert.equal(b.creatorAmount+b.stakerAmount+b.platformAmount+h,a.totalFee,'exact fee conservation');
    rows.push({transactionId:t.id,hash:t.hash,asset:a.feeAsset,baseFee:basic,creatorTax:tax,creator:b.creatorAmount,staker,platform,holder,activeStock:b.activeStock});
  }
  for(const e of events.filter(e=>e.eventName==='FeeClaimed')){
    const a=e.args;
    if(a.beneficiaryType===0)equalAddress(a.beneficiary,roles.creator);
    else if(a.beneficiaryType===1)equalAddress(a.beneficiary,roles.staker);
    else if(a.beneficiaryType===2)equalAddress(a.beneficiary,p.platformTreasury);
    assert.ok(a.amount>0n);
  }
}
assert.ok(rows.some(x=>x.transactionId==='v4-buy'),'v4 buy was tested');
assert.ok(rows.some(x=>x.transactionId==='v4-sell'),'v4 sell was tested');
assert.ok(rows.every(x=>x.activeStock>0n),'live staker earns fees');
const paused=s.markets.sharing;
assert.equal(await read('ArbitrumScenarioStock',s.syntheticStock,'balanceOf',[roles.staker]),10n**24n,'paused-stock principal returned in full');
assert.equal(await read('UserStockVault',p.ordinaryComponents[13],'allocation',[paused.params.assetUid,roles.staker,paused.id]),0n);
const solvency=[];
for(const asset of [zero,s.markets.active.token,paused.token]){
  const balance=asset===zero?await c.getBalance({address:fees}):await read('TickerMemeTokenV1',asset,'balanceOf',[fees]);
  const liability=await read('ProtocolFeeVault',fees,'totalLiability',[asset]);assert.ok(balance>=liability);
  solvency.push({asset,balance,liability});
}
const report={status:'PASSED',chainId:421614,releaseId:s.releaseId,observedAt:new Date().toISOString(),confirmedScenarioTransactions:s.transactions.length,scenarioGasWei:scenarioGas,feeRows:rows,solvency,pausedStockPrincipalReturned:true,scope:'Receipt-level fee partition, recipient and custody accounting; no mature-epoch claim assertion'};
fs.writeFileSync(dir+'/receipt-audit.json',JSON.stringify(report,(_,v)=>typeof v==='bigint'?String(v):v,2)+'\n');
console.log(JSON.stringify({status:report.status,transactions:s.transactions.length,feeRows:rows.length,scenarioGasWei:String(scenarioGas)}));
