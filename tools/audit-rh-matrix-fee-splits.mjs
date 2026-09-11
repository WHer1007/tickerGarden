import fs from 'node:fs';import {decodeEventLog} from '../apps/web/node_modules/viem/_esm/index.js';
const run=process.env.TG_RH_MATRIX_RUN;if(!run||!/^[a-z0-9-]+$/.test(run))throw Error('Explicit matrix run required');
const out='outputs/reviews/'+run,s=JSON.parse(fs.readFileSync(out+'/results.json')),abi=n=>JSON.parse(fs.readFileSync(`contracts/out-v1/${n}.sol/${n}.json`)).abi;
const abis=[...abi('TickerGardenCurve'),...abi('ProtocolFeeVault'),...abi('TickerGardenMemeHook')];
const marketById=new Map(s.markets.map(m=>[m.id.toLowerCase(),m])),marketByCurve=new Map(s.markets.map(m=>[m.curve.toLowerCase(),m]));
const pending=new Map(),result={chainId:s.chainId,runId:s.runId,status:'RUNNING',receipts:0,curveTrades:0,poolCredits:0,sweeps:0,checks:[],failures:[],fees:{},seenEvents:0};const seen=new Set();
const check=(ok,tx,name,details)=>{(ok?result.checks:result.failures).push({transactionHash:tx.hash,name,...details});};
const buckets=(base,tax,active,holders)=>{const platform=base*3000n/10000n,staker=active?base*3000n/10000n:0n,creatorBase=base-platform-staker,holder=holders?creatorBase/2n:0n;return{platform,staker,creator:creatorBase+tax-holder,holder};};
for(const tx of s.transactions.filter(t=>t.status==='success')){result.receipts++;const events=tx.logs.flatMap(log=>{try{const d=decodeEventLog({abi:abis,data:log.data,topics:log.topics,strict:true});return [{...d,log}]}catch{return []}});
 for(const ev of events){const k=tx.hash+':'+ev.log.logIndex;check(!seen.has(k),tx,'unique-event',{event:k});seen.add(k);const a=ev.args,m=marketById.get(a.marketId?.toLowerCase())??marketByCurve.get(ev.log.address.toLowerCase());if(!m)continue;
 if(['CurveBuy','CurveSell'].includes(ev.eventName)){result.curveTrades++;const old=pending.get(m.id)??{base:0n,tax:0n};old.base+=a.fee;old.tax+=a.tax;pending.set(m.id,old);}
 if(['CurveFeesSwept','FeeBucketsCredited'].includes(ev.eventName)){
 const asset=(a.feeAsset??a.quoteAsset).toLowerCase(),holder=events.filter(e=>e.eventName==='HolderFeesAccrued'&&e.args.marketId.toLowerCase()===m.id.toLowerCase()&&e.args.feeAsset.toLowerCase()===asset).reduce((n,e)=>n+e.args.amount,0n);let expected;
 if(ev.eventName==='CurveFeesSwept'){result.sweeps++;const p=pending.get(m.id)??{base:0n,tax:0n};check(a.amount===p.base+p.tax,tx,'sweep-equals-unswept-trade-fees',{marketId:m.id});expected=buckets(p.base,p.tax,false,m.params.creatorFeesToHolders);pending.set(m.id,{base:0n,tax:0n});}
 else{result.poolCredits++;const accrued=events.find(e=>e.eventName==='V4FeeAccrued'&&e.args.feeId===a.feeId);check(!!accrued,tx,'pool-fee-has-accrual',{marketId:m.id});if(!accrued)continue;const base=accrued.args.base/100n,tax=accrued.args.base*BigInt(m.params.creatorTaxBps)/10000n;check(accrued.args.totalFee===base+tax,tx,'pool-1pct-plus-creator-tax',{marketId:m.id});expected=buckets(base,tax,a.activeStock>0n,m.params.creatorFeesToHolders);}
 const actual={creator:a.creatorAmount,staker:a.stakerAmount??0n,platform:a.platformAmount,holder};for(const name of Object.keys(expected))check(actual[name]===expected[name],tx,'exact-'+name+'-allocation',{marketId:m.id,asset,expected:String(expected[name]),actual:String(actual[name])});
 result.fees[m.id]??={};result.fees[m.id][asset]??={creator:'0',staker:'0',holder:'0',platform:'0'};for(const name of Object.keys(actual))result.fees[m.id][asset][name]=String(BigInt(result.fees[m.id][asset][name])+actual[name]);
 }
 }
}
result.seenEvents=seen.size;result.status=result.failures.length?'FAIL':'PASS';fs.writeFileSync(out+'/fee-split-audit.json',JSON.stringify(result,null,2));console.log(JSON.stringify({status:result.status,receipts:result.receipts,curveTrades:result.curveTrades,poolCredits:result.poolCredits,sweeps:result.sweeps,checks:result.checks.length,failures:result.failures.slice(0,4)}));

if(result.status==='FAIL')process.exitCode=1;
