import {rpcPolicy} from '../packages/chain/src/rpc-policy.ts';
import {CURRENT_CHAIN_ID} from '../packages/runtime-deployment/src/index.ts';
import {readFileSync} from 'node:fs';
import {privateKeyToAccount} from 'viem/accounts';
import type {Address} from 'viem';
import {createDatabasePool} from '../packages/db/src/index.ts';
import {PublicationRpcTransport} from '../packages/chain-worker/src/holder-publication-rpc.ts';
import {verifySnapshot,type SnapshotDataset} from '../packages/chain/src/holder-snapshot.ts';
import {CURRENT_RELEASE_ID,CURRENT_ACTIVATION_BLOCK} from '../packages/events/src/index.ts';
import {publishSnapshotOnce,reconcilePublication,type PublicationPolicy,type PublicationSigner} from '../packages/chain-worker/src/holder-publication.ts';
import {privatePublicationPath,publicationStatus,withPublicationJournal} from '../packages/chain-worker/src/holder-publication-journal.ts';

const safeErrors=new Set([
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
 if(command==='status'?args.length!==0:args.length!==1)throw Error('Usage: holder-snapshot.ts publish|reconcile <dataset.json> | status');
 const publisher=process.env.TG_SNAPSHOT_PUBLISHER_ADDRESS;
 if(!publisher||!/^0x[0-9a-fA-F]{40}$/.test(publisher)||BigInt(publisher)===0n)throw Error('Configure TG_SNAPSHOT_PUBLISHER_ADDRESS');
 const directory=process.env.TG_SNAPSHOT_PUBLICATION_STATE_DIR;
 if(!directory)throw Error('Configure TG_SNAPSHOT_PUBLICATION_STATE_DIR');
 const identity={chainId:CURRENT_CHAIN_ID,releaseId:CURRENT_RELEASE_ID,publisher:publisher.toLowerCase() as Address};
 await withPublicationJournal(directory,identity,async(journal,save)=>{
  if(command==='status'){console.log(JSON.stringify(publicationStatus(journal)));return;}
  try{
   let dataset:SnapshotDataset;
   try{dataset=verifySnapshot(JSON.parse(readFileSync(args[0]!,'utf8')) as SnapshotDataset);}catch{throw Error('Invalid snapshot dataset');}
   const maxGas=process.env.TG_SNAPSHOT_MAX_TX_GAS_WEI;
   if(!maxGas||!/^[1-9][0-9]*$/.test(maxGas))throw Error('Configure positive TG_SNAPSHOT_MAX_TX_GAS_WEI');
   const finalitySeconds=Number(process.env.TG_SNAPSHOT_FINALITY_SECONDS??'600');
   if(!Number.isSafeInteger(finalitySeconds)||finalitySeconds<600)throw Error('Snapshot receipt finality must be at least 600 seconds for this release');
   const policy:PublicationPolicy={publisher:identity.publisher,maxGasWei:BigInt(maxGas),confirmations:Number(process.env.TG_SNAPSHOT_CONFIRMATIONS??'2'),finalitySeconds,intentMaxAgeSeconds:300};
   let signer:PublicationSigner|undefined;
   if(command==='publish'){
    const file=process.env.TG_SNAPSHOT_SIGNER_FILE;if(!file)throw Error('Configure TG_SNAPSHOT_SIGNER_FILE');privatePublicationPath(file);
    try{const account=privateKeyToAccount((JSON.parse(readFileSync(file,'utf8')) as {privateKey:`0x${string}`}).privateKey);signer={address:account.address,sign:tx=>account.signTransaction(tx)};}catch{throw Error('Invalid publication signer file');}
   }
   const {pool}=createDatabasePool(process.env.TG_PIPELINE_DATABASE_URL??'');
   try{
    const options={pool,deployment:{environment:process.env.TG_ENVIRONMENT as 'test'|'production',chainId:CURRENT_CHAIN_ID, deploymentDigest:CURRENT_RELEASE_ID,activationBlock:CURRENT_ACTIVATION_BLOCK},primary:new PublicationRpcTransport({url:process.env.TG_RPC_URL??''}),secondary:new PublicationRpcTransport({url:rpcPolicy(process.env).verificationUrl??''}),...(process.env.TG_DATABASE_SCHEMA?{schemaName:process.env.TG_DATABASE_SCHEMA}:{})};
    const d={options,policy,journal,save};
    const result=command==='publish'?await publishSnapshotOnce(d,dataset,signer!):await reconcilePublication(d,dataset);
    console.log(JSON.stringify(result));
   }finally{await pool.end();}
  }catch(e){
   const error=safePublicationError(e);journal.lastError={at:new Date().toISOString(),error};
   try{await save(journal);}catch{/* Preserve existing durable intent if the disk is unavailable. */}
   console.error(JSON.stringify({status:'needs_attention',error}));process.exitCode=1;
  }
 });
}
