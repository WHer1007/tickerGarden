import {rpcPolicy} from '../packages/chain/src/rpc-policy.ts';
import {CURRENT_CHAIN_ID} from '../packages/runtime-deployment/src/index.ts';
/** Explicit operator CLI. Only publish signs/sends; no scheduling or permission changes. */
import {readFile,writeFile} from 'node:fs/promises';
import {createDatabasePool} from '../packages/db/src/index.ts';
import {RpcTransport} from '../packages/chain/src/index.ts';
import {CURRENT_RELEASE_ID,CURRENT_ACTIVATION_BLOCK} from '../packages/events/src/index.ts';
import {prepareHolderSnapshot,previewSnapshotPublication,previewHolderFunding} from '../packages/chain-worker/src/holder-snapshots.ts';
import {verifySnapshot,type SnapshotDataset} from '../packages/chain/src/holder-snapshot.ts';
const [command,...args]=process.argv.slice(2);
const usage='Usage: holder-snapshot.ts prepare <marketId> <finalized-block> <output.json> | preview|verify|publish|reconcile <dataset.json> | funding <sender> <marketId,...> | status';
if(['publish','reconcile','status'].includes(command??'')) {
 const {runHolderPublicationCommand}=await import('./holder-publication-cli.ts');
 await runHolderPublicationCommand(command!,args);
} else if(command==='verify') {
 if(args.length!==1)throw Error(usage);
 const dataset=verifySnapshot(JSON.parse(await readFile(args[0]!,'utf8')) as SnapshotDataset);
 console.log(JSON.stringify({status:'verified',root:dataset.root,dataHash:dataset.dataHash,accounts:dataset.entries.length}));
} else {
 if(!['prepare','preview','funding'].includes(command??'')||(command==='prepare'?args.length!==3:command==='funding'?args.length!==2:args.length!==1))throw Error(usage);
 if(!['test','production'].includes(process.env.TG_ENVIRONMENT??''))throw Error('This operator CLI requires an explicit runtime environment');
 const pool=createDatabasePool(process.env.TG_PIPELINE_DATABASE_URL??'').pool;
 try {
  const options={pool,deployment:{environment:process.env.TG_ENVIRONMENT as 'test'|'production',chainId:CURRENT_CHAIN_ID,deploymentDigest:CURRENT_RELEASE_ID,activationBlock:CURRENT_ACTIVATION_BLOCK},primary:new RpcTransport({url:process.env.TG_RPC_URL??''}),secondary:new RpcTransport({url:rpcPolicy(process.env).verificationUrl??''}),...(process.env.TG_DATABASE_SCHEMA?{schemaName:process.env.TG_DATABASE_SCHEMA}:{})};
  if(command==='funding') {
   console.log(JSON.stringify(await previewHolderFunding(options,args[1]!.split(',') as `0x${string}`[],args[0] as `0x${string}`)));
  } else if(command==='prepare') {
   if(!/^0x[0-9a-f]{64}$/.test(args[0]!)||!/^[1-9][0-9]*$/.test(args[1]!))throw Error(usage);
   const dataset=await prepareHolderSnapshot({...options,marketId:args[0] as `0x${string}`,blockNumber:BigInt(args[1]!)});
   await writeFile(args[2]!,JSON.stringify(dataset,null,2)+'\n',{flag:'wx',mode:0o600});
   console.log(JSON.stringify({status:'prepared_not_broadcast',file:args[2],dataHash:dataset.dataHash,root:dataset.root,accounts:dataset.entries.length}));
  } else console.log(JSON.stringify(await previewSnapshotPublication(options,JSON.parse(await readFile(args[0]!,'utf8')) as SnapshotDataset)));
 } finally {await pool.end();}
}
