import {rpcRuntimeOptions} from '../packages/rpc-control/src/runtime.ts';
import {rpcFailoverOptions} from '../packages/chain/src/rpc-policy.ts';
import {rpcPolicy} from '../packages/chain/src/rpc-policy.ts';
import {CURRENT_CHAIN_ID} from '../packages/runtime-deployment/src/index.ts';
import {readFileSync} from 'node:fs';
import {privateKeyToAccount} from 'viem/accounts';
import type {Address} from 'viem';
import {createDatabasePool} from '../packages/db/src/index.ts';
import {PublicationRpcTransport} from '../packages/chain-worker/src/holder-publication-rpc.ts';
import {verifySnapshotArtifact,type SnapshotArtifact} from '../packages/chain/src/holder-artifact.ts';
import path from 'node:path';
import {withSignerLane,recoverSignerLock} from '../packages/chain-worker/src/signer-coordination.ts';
import {CURRENT_RELEASE_ID,CURRENT_ACTIVATION_BLOCK} from '../packages/events/src/index.ts';
import {publishSnapshotOnce,reconcilePublication,type PublicationPolicy,type PublicationSigner} from '../packages/chain-worker/src/holder-publication.ts';
import {privatePublicationPath,publicationStatus,withPublicationJournal} from '../packages/chain-worker/src/holder-publication-journal.ts';

const safeErrors=new Set([
 'Publication batch requires 1 to 32 distinct markets','Publication batch deployment mismatch','Publication batch partially published; reconcile datasets before signing','Pending batch differs from signed datasets','Unexpected snapshot publication event count','Publisher nonce changed before signing','Publication batch simulation anchor changed','Publication finalized anchor changed','Signer has an unresolved intent in another service',
 'Invalid publication policy','Publication journal/deployment mismatch','Publication RPC chain mismatch','Snapshot publisher is not configured',
 'Signer differs from configured publisher','Preview identity/calldata mismatch','Pending intent belongs to another dataset or is corrupt','Signed publication intent mismatch',
 'Publication receipt RPC disagreement','Publication receipt is orphaned','Expected exactly one snapshot publication event','Published event differs from signed dataset',
 'Confirmed receipt has no matching current round','Publication confirmation anchor changed','Publication nonce consumed without matching receipts; reconcile manually',
 'Unresolved publication intent expired; do not replace before nonce reconciliation','Publication submission uncertain; original signed intent retained',
 'Publisher nonce disagreement or outstanding transaction','Publication exceeds configured gas cost cap','Publisher gas balance insufficient','Publication preflight became stale',
 'Invalid publication signer file','Publication state and signer paths must be private and not symlinks',
]);
export const safePublicationError=(e:unknown)=>e instanceof Error&&safeErrors.has(e.message)?e.message:'Publication command failed; verify dataset, RPC, database and private journal before retrying';
export async function runHolderPublicationCommand(command:string,args:string[]){
 if(!['test','production'].includes(process.env.TG_ENVIRONMENT??''))throw Error('Manual publication requires an explicit runtime environment');
 if(command==='status'?args.length!==0:command==='recover-lock'?args.length!==2:args.length<1||args.length>32)throw Error('Usage: holder-snapshot.ts publish|reconcile <dataset.json> | status');
 const publisher=process.env.TG_SNAPSHOT_PUBLISHER_ADDRESS;
 if(!publisher||!/^0x[0-9a-fA-F]{40}$/.test(publisher)||BigInt(publisher)===0n)throw Error('Configure TG_SNAPSHOT_PUBLISHER_ADDRESS');
 const directory=process.env.TG_SNAPSHOT_PUBLICATION_STATE_DIR;
 if(!directory)throw Error('Configure TG_SNAPSHOT_PUBLICATION_STATE_DIR');
 const identity={chainId:CURRENT_CHAIN_ID,releaseId:CURRENT_RELEASE_ID,publisher:publisher.toLowerCase() as Address};
 if(command==='recover-lock'){
  if(!['publication','signer'].includes(args[0]!))throw Error('Choose publication or signer lock');
  const dir=args[0]==='publication'?directory:process.env.TG_SIGNER_COORDINATION_DIR;
  if(!dir||!path.isAbsolute(dir))throw Error('Configure absolute signer coordination directory');
  console.log(JSON.stringify(recoverSignerLock(path.join(dir,`${identity.chainId}-${identity.publisher}.json.lock`),args[1]!)));return;
 }
 await withPublicationJournal(directory,identity,async(journal,save)=>{
  if(command==='status'){console.log(JSON.stringify(publicationStatus(journal)));return;}
  try{
   let dataset:SnapshotArtifact[];
   try{dataset=args.map(file=>verifySnapshotArtifact(JSON.parse(readFileSync(file,'utf8')) as SnapshotArtifact));}catch{throw Error('Invalid snapshot dataset');}
   const maxGas=process.env.TG_SNAPSHOT_MAX_TX_GAS_WEI;
   if(!maxGas||!/^[1-9][0-9]*$/.test(maxGas))throw Error('Configure positive TG_SNAPSHOT_MAX_TX_GAS_WEI');
   const finalityMode=process.env.TG_SETTLEMENT_FINALITY??'finalized';
   if(!['finalized','delay'].includes(finalityMode))throw Error('Invalid settlement finality mode');
   const finalitySeconds=Number(process.env.TG_SNAPSHOT_FINALITY_SECONDS??process.env.TG_FINALITY_SECONDS??'60');
   if(!Number.isSafeInteger(finalitySeconds)||finalitySeconds<60)throw Error('Snapshot receipt fallback finality must be at least 60 seconds');
   const policy:PublicationPolicy={publisher:identity.publisher,maxGasWei:BigInt(maxGas),finalityMode:finalityMode as 'finalized'|'delay',confirmations:Number(process.env.TG_SNAPSHOT_CONFIRMATIONS??'2'),finalitySeconds,intentMaxAgeSeconds:300};
   let signer:PublicationSigner|undefined;
   if(command==='publish'){
    const file=process.env.TG_SNAPSHOT_SIGNER_FILE;if(!file)throw Error('Configure TG_SNAPSHOT_SIGNER_FILE');privatePublicationPath(file);
    try{const account=privateKeyToAccount((JSON.parse(readFileSync(file,'utf8')) as {privateKey:`0x${string}`}).privateKey);signer={address:account.address,sign:tx=>account.signTransaction(tx)};}catch{throw Error('Invalid publication signer file');}
   }
   const {pool}=createDatabasePool(process.env.TG_PIPELINE_DATABASE_URL??'');
   try{
 const rpcRuntime=rpcRuntimeOptions(process.env,'holder-publication','background');
    const options={pool,deployment:{environment:process.env.TG_ENVIRONMENT as 'test'|'production',chainId:CURRENT_CHAIN_ID, deploymentDigest:CURRENT_RELEASE_ID,activationBlock:CURRENT_ACTIVATION_BLOCK},primary:new PublicationRpcTransport({...rpcRuntime,...rpcFailoverOptions(process.env),url:process.env.TG_RPC_URL??''}),secondary:new PublicationRpcTransport({...rpcRuntime,...(rpcPolicy(process.env).mode==='single'?rpcFailoverOptions(process.env):{}),url:rpcPolicy(process.env).verificationUrl??''}),...(process.env.TG_DATABASE_SCHEMA?{schemaName:process.env.TG_DATABASE_SCHEMA}:{})};
    const d={options,policy,journal,save};
    const coordination=process.env.TG_SIGNER_COORDINATION_DIR;if(!coordination)throw Error('Configure TG_SIGNER_COORDINATION_DIR shared with Locker Keeper');
    const result=await withSignerLane(coordination,identity.chainId,identity.publisher,'holder',()=>command==='publish'?publishSnapshotOnce(d,dataset,signer!):reconcilePublication(d,dataset),()=>journal.pending!==null);
    console.log(JSON.stringify(result));
   }finally{await pool.end();}
  }catch(e){
   const error=safePublicationError(e);journal.lastError={at:new Date().toISOString(),error};
   try{await save(journal);}catch{/* Preserve existing durable intent if the disk is unavailable. */}
   console.error(JSON.stringify({status:'needs_attention',error}));process.exitCode=1;
  }
 });
}
