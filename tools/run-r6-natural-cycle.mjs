// A bounded continuation of this test run, not a recurring automation.
// Uses the existing transaction journal; any stage failure stops for reconciliation.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createPublicClient,http} from '../apps/web/node_modules/viem/_esm/index.js';
const base=process.cwd(), dir=path.join(base,'outputs/reviews/r6-fast-test-2026-09-06');
const expected='0xf2ab431cdae9144d0bd1b5f4f3c52c337e0b77a5aa8fd5504cff3d46bf2eec4f';
const journal=()=>JSON.parse(fs.readFileSync(path.join(dir,'public/results.json')));
const c=createPublicClient({transport:http('https://sepolia-rollup.arbitrum.io/rpc')});
if(await c.getChainId()!==421614)throw Error('Wrong chain');
const initial=journal();
if(initial.releaseId!==expected||!initial.timeQueue||initial.error)throw Error('R6 lifecycle must be reconciled first');
const statusPath=path.join(dir,'natural-cycle.json');
const status={startedAt:new Date().toISOString(),releaseId:expected,status:'RUNNING',stages:[]};
const save=()=>fs.writeFileSync(statusPath,JSON.stringify(status,null,2)+'\n');
const end=Date.now()+6*60*60*1000;
async function run(stage){
 const logfile=path.join(dir,`natural-cycle-${stage}-${Date.now()}.log`);
 const fd=fs.openSync(logfile,'a');
 const args=stage==='audit-holder'?['tools/audit-r6-holder-public.mjs','--final']:stage==='audit'?['tools/audit-r6-business-public.mjs']:['--experimental-strip-types','tools/test-r6-business-public.mjs','run',stage];
 const exit=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{cwd:base,stdio:['ignore',fd,fd]});child.once('error',reject);child.once('exit',resolve);});
 fs.closeSync(fd);status.stages.push({stage,exit,logfile:path.relative(base,logfile),finishedAt:new Date().toISOString()});save();
 if(exit!==0)throw Error(`Stage ${stage} stopped; inspect ${logfile}`);
 console.log('COMPLETED '+stage);
}
async function publishReport(){
 const project=path.resolve(base,'../..');
 const script=path.join(project,'tools/report-r6-fast-test.py');
 if(!base.endsWith('/.codex_tmp/r6-fast-test')||!fs.existsSync(script))throw Error('Unknown durable report root');
 const exit=await new Promise((resolve,reject)=>{const child=spawn('python3',[script],{cwd:project,stdio:'inherit'});child.once('error',reject);child.once('exit',resolve);});
 if(exit!==0)throw Error('Durable report refresh failed');
}
try{
 save();
 while(Date.now()<end){
  let s=journal();if(s.releaseId!==expected||s.error)throw Error('Journal requires reconciliation');
  let now=Number((await c.getBlock()).timestamp);
  const done=id=>s.checks.some(x=>x.id===id&&x.status==='PASS');
  const roots=Object.entries(s.roots??{}),holders=Object.values(s.markets).filter(x=>x.holderFunded);
  const exits=Object.values(s.markets).filter(x=>x.normalExitDueAt);
  const unpause=s.timeQueue.find(x=>x.type==='STOCK_UNPAUSE');
  if(exits.some(x=>s.checks.find(v=>v.id==='normal-exit-'+x.key)?.detail?.normalExitTest===false))throw Error('Expected normal exit sample was already rage-quit');
  const readyExit=exits.some(x=>!done('normal-exit-'+x.key)&&now>=Number(x.normalExitDueAt))||(!done('natural-stock-unpause')&&now>=Number(unpause.availableAt))||(!done('natural-raw-exit')&&now>=Number(s.rawExit.availableAt));
  if(readyExit){await run('natural-exits');continue;}
  if(holders.some(x=>!s.roots?.[x.key]?.published&&now>=Number(x.epochWindow[1])+600)){await run('natural-roots');continue;}
  if(roots.some(([,x])=>x.published&&!x.claimed&&now>=Number(x.finalizeAfter))){await run('natural-claims');continue;}
  if(roots.some(([k,x])=>x.claimed&&!x.rolledOver&&(now>Number(x.claimUntil)||!done('rollover-too-early-'+k)))){await run('natural-rollover');continue;}
  const finished=holders.length===8&&roots.length===8&&roots.every(([,x])=>x.rolledOver)&&exits.every(x=>done('normal-exit-'+x.key))&&done('natural-stock-unpause')&&done('natural-raw-exit');
  if(finished){await run('audit');await run('audit-holder');status.status='NATURAL_STAGES_AND_RECEIPT_AUDIT_FINISHED';status.finishedAt=new Date().toISOString();save();await publishReport();console.log(status.status);process.exit(0);}
  const due=[...exits.filter(x=>!done('normal-exit-'+x.key)).map(x=>Number(x.normalExitDueAt)),...holders.filter(x=>!s.roots?.[x.key]?.published).map(x=>Number(x.epochWindow[1])+600),...roots.filter(([,x])=>!x.claimed).map(([,x])=>Number(x.finalizeAfter)),...roots.filter(([,x])=>x.claimed&&!x.rolledOver).map(([,x])=>Number(x.claimUntil)+1),...(!done('natural-stock-unpause')?[Number(unpause.availableAt)]:[]),...(!done('natural-raw-exit')?[Number(s.rawExit.availableAt)]:[])].filter(x=>Number.isFinite(x)&&x>now);
  status.status='WAITING_NATURAL_CHAIN_TIME';status.nextAvailableAt=due.length?Math.min(...due):null;status.checkedAt=new Date().toISOString();save();
  if(status.lastReportedDeadline!==status.nextAvailableAt){status.lastReportedDeadline=status.nextAvailableAt;save();await publishReport();}
  await new Promise(resolve=>setTimeout(resolve,Math.min(60,Math.max(1,(status.nextAvailableAt??now+60)-now))*1000));
 }
 throw Error('Six-hour bound reached; inspect remaining tests');
}catch(error){status.status='STOPPED_REQUIRES_RECONCILIATION';status.error=error.message;save();await publishReport().catch(e=>console.error(e.message));console.error(error.message);process.exitCode=1;}
