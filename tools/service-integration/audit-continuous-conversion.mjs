// Read-only audit for the test-only continuous conversion transport.
// It never loads wallet files, signs, broadcasts, or mutates PostgreSQL.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createPublicClient,http,keccak256,decodeFunctionData} from '../../apps/web/node_modules/viem/_esm/index.js';
import {arbitrumSepolia} from '../../apps/web/node_modules/viem/_esm/chains/index.js';

const root='outputs/reviews/continuous-service-2026-09-07';
const out=root+'/conversion';
const db=JSON.parse(fs.readFileSync(root+'/database.json')).url;
if(new URL(db).hostname!=='127.0.0.1') throw new Error('database must be loopback');
const sql=q=>execFileSync('psql',[db,'-X','-At','-v','ON_ERROR_STOP=1','-c',q],{encoding:'utf8'}).trim();
const rows=q=>sql(q).split('\n').filter(Boolean).map(JSON.parse);
const intents=rows('SELECT row_to_json(i) FROM continuous_test.intents i ORDER BY id');
const queues=rows('SELECT row_to_json(q) FROM continuous_test.queue q ORDER BY key');
const c=createPublicClient({chain:arbitrumSepolia,transport:http('https://sepolia-rollup.arbitrum.io/rpc')});
const rpcChainId=await c.getChainId();
const plans={};
for(const name of ['creator-staker-plan.json','holder-plan.json','rewardKind-plan.json']){
 const file=out+'/'+name;
 if(fs.existsSync(file)) plans[name]=JSON.parse(fs.readFileSync(file));
}
const checks=[];
for(const i of intents){
 const p=i.payload||{}; const check={id:i.id,txHash:i.hash,queueKey:i.queue_key,payload:p};
 const errors=[];
 for(const k of ['chainId','releaseId','from','to','nonce','inputHash','gas']) if(p[k]===undefined) errors.push('missing '+k);
 if(typeof p.inputHash==='string'&&!/^0x[0-9a-f]{64}$/i.test(p.inputHash)) errors.push('invalid inputHash');
 if(!/^0x[0-9a-f]{64}$/i.test(i.hash)) errors.push('invalid canonical hash');
 let tx=null,receipt=null;
 try { tx=await c.getTransaction({hash:i.hash}); receipt=await c.getTransactionReceipt({hash:i.hash}); }
 catch(e){ errors.push('receipt unavailable: '+String(e.message||e).slice(0,180)); }
 if(tx&&receipt){
  if(receipt.status!=='success') errors.push('status '+receipt.status);
  if(tx.hash!==i.hash) errors.push('tx hash mismatch');
  for(const [k,v] of [['from',tx.from],['to',tx.to],['nonce',String(tx.nonce)],['inputHash',keccak256(tx.input)],['chainId',String(tx.chainId)]]) if(String(p[k]).toLowerCase()!==String(v).toLowerCase()) errors.push(k+' mismatch');
  if(BigInt(receipt.gasUsed)>BigInt(p.gas)) errors.push('gasUsed exceeds planned gas');
 if(receipt.blockHash!==(await c.getBlock({blockNumber:receipt.blockNumber})).hash) errors.push('block hash mismatch');
  if(i.id.includes(':creator-staker:')||i.id.includes(':holder:')){
   const holder=i.id.includes(':holder:'), fn=holder?'settleHolderRewards':'settleRewards';
   const abi=JSON.parse(fs.readFileSync(`contracts/out-v1/ProtocolFeeVault.sol/ProtocolFeeVault.json`)).abi;
   try {
    const d=decodeFunctionData({abi,data:tx.input}); const file=out+'/'+(holder?'holder-plan.json':'creator-staker-plan.json'); const pv=JSON.parse(fs.readFileSync(file)); const pl=pv.plan; const e=pl.settle||pl;
    if(d.functionName!==fn) errors.push('function mismatch');
    const a=d.args;
    if(String(a[0]).toLowerCase()!==String(pl.marketId).toLowerCase()) errors.push('marketId calldata mismatch');
    if(holder){ if(String(a[1])!==String(pl.epochId)||String(a[2])!==String(e.maximumMeme)||String(a[3])!==String(e.minimumQuote)||String(a[4])!==String(e.deadline)) errors.push('holder plan calldata mismatch'); }
    else { const norm=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?String(v):typeof v==='string'&&v.startsWith('0x')?v.toLowerCase():v); if(norm(a[1])!==norm(pl.items)||String(a[2])!==String(e.minimumQuote)||String(a[3])!==String(e.deadline)) errors.push('creator plan calldata mismatch'); }
    const qb=await c.getBlock({blockNumber:BigInt(pv.quoteBlock)}); if(qb.hash!==pv.quoteHash) errors.push('quote block hash mismatch');
   } catch(e){ errors.push('calldata/plan decode: '+String(e.message||e).slice(0,180)); }
  }
  check.receipt={status:receipt.status,blockNumber:String(receipt.blockNumber),blockHash:receipt.blockHash,gasUsed:String(receipt.gasUsed),logs:receipt.logs.length};
 }
 check.ok=errors.length===0; if(errors.length) check.errors=errors; checks.push(check);
}
const planAudit={};
for(const [name,v] of Object.entries(plans)){
 const plan=v.plan||v; const effective=plan.settle||plan; const expected=BigInt(v.expectedOutput||0); const minimum=BigInt(effective.minimumQuote||0);
 // Settlement uses integer fixed-point math, so compare with floor(expected * 99.5%).
 const floor995=expected*9950n/10000n;
 planAudit[name]={expectedOutput:String(expected),minimumQuote:String(minimum),minimumQuotePctOfExpected:expected?Number(minimum*10000n/expected)/100:0,meetsGtOne:minimum>1n,meets995Pct:expected>0n&&minimum===floor995,floor995PctMinimum:String(floor995),quoteBlock:v.quoteBlock,quoteHash:v.quoteHash};
}
const creator=checks.filter(x=>x.id.includes(':creator-staker:')).some(x=>x.ok);
const holder=checks.filter(x=>x.id.includes(':holder:')).some(x=>x.ok);
const conversionChecks=checks.filter(x=>x.id.includes(':creator-staker:')||x.id.includes(':holder:'));
const planNames=['creator-staker-plan.json','holder-plan.json'];
const plansValid=planNames.every(n=>planAudit[n]?.meetsGtOne&&planAudit[n]?.meets995Pct);
const allIntentsOk=checks.length>0&&checks.every(x=>x.ok);
const result={audit:'continuous-conversion',generatedAt:new Date().toISOString(),scope:'test-only PostgreSQL transport; no production transport claim',status:rpcChainId===421614&&allIntentsOk&&conversionChecks.length===2&&creator&&holder&&plansValid?'TEST_TRANSPORT_AUDIT_PASS':'TEST_TRANSPORT_AUDIT_FAIL',rpcChainId,creatorStakerReceipt:creator,holderReceipt:holder,allIntentsOk,plansValid,intents:checks,queues,plans:planAudit,sourcePlans:['creator-staker-plan.json','holder-plan.json','injected-crash.json','lease-probe.json']};
fs.mkdirSync(out,{recursive:true}); fs.writeFileSync(out+'/audit.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({status:result.status,creatorStakerReceipt:creator,holderReceipt:holder,intents:checks.length}));
if(result.status!=='TEST_TRANSPORT_AUDIT_PASS') process.exitCode=1;
