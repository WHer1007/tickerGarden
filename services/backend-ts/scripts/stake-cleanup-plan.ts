/** Read-only operator tool. Never loads a private key, signs, or broadcasts. */
import {createPublicClient,http,encodeFunctionData,parseAbi,keccak256,type Address,type Hex} from 'viem';
import {createDatabasePool} from '../packages/db/src/index.ts';
import {CURRENT_CHAIN_ID,runtimeReleaseId,runtimeGenesisHash} from '../packages/runtime-deployment/src/index.ts';
import {fixedF72Sources,f72ReadAbis} from '../packages/events/src/index.ts';

const schema=process.env.TG_DATABASE_SCHEMA??'tickergarden_serverless';
if(!/^[a-z][a-z0-9_]{0,62}$/.test(schema))throw Error('invalid schema');
const environment=process.env.TG_ENVIRONMENT;
if(!environment||!['test','preview','production'].includes(environment))throw Error('Explicit TG_ENVIRONMENT required');
const url=process.env.TG_PIPELINE_DATABASE_URL??process.env.TG_DATABASE_URL;
if(!url)throw Error('Pipeline database configuration required');
const account=process.argv[2]?.toLowerCase(),marketId=process.argv[3]?.toLowerCase(),sender=process.argv[4]?.toLowerCase();
if((account||marketId||sender)&&(!/^0x[0-9a-f]{40}$/.test(account??'')||!/^0x[0-9a-f]{64}$/.test(marketId??'')||!/^0x[0-9a-f]{40}$/.test(sender??'')))throw Error('Usage: stake-cleanup-plan.ts [wallet marketId sender]');
const handle=createDatabasePool(url,{max:1});
try{
 const rows=await handle.pool.query(`SELECT o.account,o.asset_uid,o.market_id,o.principal::text,o.block_number::text,o.block_hash FROM "${schema}".stake_cleanup_observations o JOIN "${schema}".chain_blocks b ON b.environment=o.environment AND b.chain_id=o.chain_id AND b.deployment_digest=o.deployment_digest AND b.hash=o.block_hash JOIN "${schema}".ingestion_checkpoints c ON c.environment=o.environment AND c.chain_id=o.chain_id AND c.deployment_digest=o.deployment_digest AND c.generation=o.generation AND c.stream='frontend-events' WHERE o.environment=$1 AND o.chain_id=$2 AND o.deployment_digest=$3 AND o.principal>0 AND b.canonical AND b.finalized AND ($4::text IS NULL OR o.account=$4) AND ($5::text IS NULL OR o.market_id=$5) ORDER BY o.market_id,o.account LIMIT 201`,[environment,CURRENT_CHAIN_ID,runtimeReleaseId,account??null,marketId??null]);
 console.log(JSON.stringify({mode:'read-only',pending:rows.rows.slice(0,200),hasMore:rows.rows.length>200}));
 if(account&&marketId&&sender){
  const endpoint=process.env.TG_RPC_URL;if(!endpoint)throw Error('TG_RPC_URL required for a fresh plan');
  const client=createPublicClient({transport:http(endpoint)});
  const [chain,genesis,block]=await Promise.all([client.getChainId(),client.getBlock({blockNumber:0n}),client.getBlock()]);
  if(chain!==CURRENT_CHAIN_ID||genesis.hash!==runtimeGenesisHash)throw Error('RPC chain identity mismatch');
  const manager=fixedF72Sources().find(s=>s.module==='AllocationManager')!;
  const code=await client.getCode({address:manager.address,blockNumber:block.number});if(!code||keccak256(code)!==manager.runtimeCodeHash)throw Error('AllocationManager runtime mismatch');
  const pending=await client.readContract({address:manager.address,abi:f72ReadAbis.AllocationManager,functionName:'rageQuitSettlementPending',args:[marketId as Hex,account as Address],blockNumber:block.number});
  if(!pending[0])console.log(JSON.stringify({status:'already-clean',blockNumber:String(block.number)}));
  else{
   const data=encodeFunctionData({abi:parseAbi(['function settleRageQuitRewards(bytes32 marketId,address user)']),functionName:'settleRageQuitRewards',args:[marketId as Hex,account as Address]});
   // A generous simulation allowance avoids the principal-first contract's deferred-cleanup reserve path.
   await client.call({account:sender as Address,to:manager.address,data,gas:3000000n,blockNumber:block.number});
   console.log(JSON.stringify({status:'unsigned-plan',chainId:chain,from:sender,to:manager.address,data,value:'0',gas:'3000000',principal:String(pending[1]),observedBlock:String(block.number),observedHash:block.hash,verification:'Call rageQuitSettlementPending again after execution; success status alone does not prove cleanup completed.'}));
  }
 }
}catch{console.error(JSON.stringify({status:'verification-failed',message:'Database or chain verification failed. No transaction was signed or sent.'}));process.exitCode=1;}finally{await handle.pool.end();}
