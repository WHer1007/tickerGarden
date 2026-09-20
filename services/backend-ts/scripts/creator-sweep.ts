import {rpcFailoverOptions} from '../packages/chain/src/rpc-policy.ts';
import {reportError} from '../packages/observability/src/index.ts';
/** Explicit operator command. Not started by the ordinary indexing Worker. */
import fs from 'node:fs';import path from 'node:path';
import {privateKeyToAccount} from 'viem/accounts';import type {Address,Hex} from 'viem';
import {createDatabasePool} from '../packages/db/src/index.ts';
import {CURRENT_CHAIN_ID,runtimeReleaseId} from '../packages/runtime-deployment/src/index.ts';
import {PublicationRpcTransport} from '../packages/chain-worker/src/holder-publication-rpc.ts';
import {withSignerLane,privateStatePath} from '../packages/chain-worker/src/signer-coordination.ts';
import {sweepOnce,type SweepJournal,type SweepPolicy} from '../packages/chain-worker/src/creator-sweep.ts';
async function main(){
 const command=process.argv[2];if(!['preview','run','reconcile','retry-signed'].includes(command??'')||!['test','production'].includes(process.env.TG_ENVIRONMENT??''))throw Error('Explicit environment and preview|run|reconcile|retry-signed required');
 const env=process.env,dir=env.TG_CREATOR_SWEEP_STATE_DIR,coord=env.TG_SIGNER_COORDINATION_DIR,signer=env.TG_CREATOR_SWEEP_ADDRESS?.toLowerCase();
 if(!dir||!path.isAbsolute(dir)||!coord||!path.isAbsolute(coord)||!signer||!/^0x[0-9a-f]{40}$/.test(signer))throw Error('Configure private sweep and shared signer directories and address');
 fs.mkdirSync(dir,{recursive:true,mode:0o700});privateStatePath(dir);
 const file=path.join(dir,`${CURRENT_CHAIN_ID}-${signer}.json`);
 const policy:SweepPolicy={chainId:CURRENT_CHAIN_ID,releaseId:runtimeReleaseId,maxTxGasWei:BigInt(env.TG_CREATOR_SWEEP_MAX_TX_GAS_WEI??'0'),dailyGasWei:BigInt(env.TG_CREATOR_SWEEP_DAILY_GAS_WEI??'0'),minByAsset:JSON.parse(env.TG_CREATOR_SWEEP_MIN_BY_ASSET??'{}'),finality:(env.TG_SETTLEMENT_FINALITY??'finalized') as 'finalized'|'delay',delaySeconds:Number(env.TG_FINALITY_SECONDS??'60')};
 const rpc=new PublicationRpcTransport({...rpcFailoverOptions(env),url:env.TG_RPC_URL??''});
 let journal:SweepJournal;
 const save=async()=>{const tmp=file+'.tmp';if(fs.existsSync(tmp))privateStatePath(tmp);fs.writeFileSync(tmp,JSON.stringify(journal),{mode:0o600});const fd=fs.openSync(tmp,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,file);const d=fs.openSync(dir,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}};
 await withSignerLane(coord,CURRENT_CHAIN_ID,signer,'creator',async()=>{
  if(fs.existsSync(file)){privateStatePath(file);journal=JSON.parse(fs.readFileSync(file,'utf8'));}else journal={chainId:CURRENT_CHAIN_ID,releaseId:runtimeReleaseId,signer,day:'',reserved:'0',cursor:'',pending:null};
  if(journal.chainId!==CURRENT_CHAIN_ID||journal.releaseId!==runtimeReleaseId||journal.signer!==signer)throw Error('Sweep journal deployment mismatch');
  if(command==='preview'&&journal.pending){console.log(JSON.stringify({status:'pending',hash:journal.pending.hash}));return;}
  if(command==='reconcile'||command==='retry-signed'||journal.pending){console.log(JSON.stringify(await sweepOnce({rpc,policy,journal,save,retrySigned:command==='retry-signed'})));return;}
  let account;if(command==='run'){const keyFile=env.TG_CREATOR_SWEEP_SIGNER_FILE;if(!keyFile)throw Error('Configure private signer file');privateStatePath(keyFile);account=privateKeyToAccount(JSON.parse(fs.readFileSync(keyFile,'utf8')).privateKey);}
  const {pool}=createDatabasePool(env.TG_PIPELINE_DATABASE_URL??''),schema=env.TG_DATABASE_SCHEMA??'tickergarden_serverless';if(!/^[a-z][a-z0-9_]*$/.test(schema))throw Error('Invalid schema');
  try{
   const rows=(await pool.query(`SELECT a.identity,a.payload FROM "${schema}".aggregate_records a JOIN "${schema}".chain_blocks b ON b.environment=a.environment AND b.chain_id=a.chain_id AND b.deployment_digest=a.deployment_digest AND b.hash=a.block_hash WHERE a.environment=$1 AND a.chain_id=$2 AND a.deployment_digest=$3 AND a.scope='creator-state' AND a.complete AND b.canonical AND b.finalized AND a.identity>$4 ORDER BY a.identity LIMIT 20`,[env.TG_ENVIRONMENT,CURRENT_CHAIN_ID,runtimeReleaseId,journal.cursor])).rows;
   if(!rows.length){journal.cursor='';if(command==='run')await save();}
   for(const row of rows){
    const candidate={marketId:row.identity as Hex,quoteAsset:row.payload.market.quoteAsset as Address};
    if(command==='preview'){console.log(JSON.stringify({marketId:candidate.marketId,curveFees:row.payload.curveFees,minimum:policy.minByAsset[candidate.quoteAsset]??null}));continue;}
    journal.cursor=row.identity;
    try{console.log(JSON.stringify({marketId:row.identity,...await sweepOnce({rpc,policy,journal,save,account:account!,candidate})}));}catch{console.error(JSON.stringify({marketId:row.identity,status:journal.pending?'submission_requires_reconciliation':'market_needs_attention'}));process.exitCode=1;}
    await save();if(journal.pending)break;
   }
  }finally{await pool.end();}
 },()=>Boolean(journal?.pending));
}
main().catch(error=>{reportError('creator-sweep','creator_sweep_failed',error);console.error('Creator sweep stopped. Check configuration and the private journal; no replacement transaction was sent.');process.exitCode=1;});
