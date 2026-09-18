/** Read-only, bounded ledger audit. A mismatch never overwrites financial facts. */
import {createPublicClient,custom,parseAbi,keccak256,type Address,type Hex} from 'viem';
import {createDatabasePool,transaction} from '../packages/db/src/index.ts';
import {RpcTransport} from '../packages/chain/src/index.ts';
import {CURRENT_CHAIN_ID,runtimeReleaseId} from '../packages/runtime-deployment/src/index.ts';
import {fixedF72Sources} from '../packages/events/src/index.ts';
async function main(){
 if(!['test','production'].includes(process.env.TG_ENVIRONMENT??''))throw Error('Explicit environment required');
 const schema=process.env.TG_DATABASE_SCHEMA??'tickergarden_serverless';if(!/^[a-z][a-z0-9_]*$/.test(schema))throw Error('Invalid schema');
 const after=process.argv[2]??'';if(after&&!/^0x[0-9a-f]{64}:[1-9][0-9]*:0x[0-9a-f]{40}$/.test(after))throw Error('Invalid reconciliation cursor');
 const [afterMarket='',afterEpoch='0',afterAsset='']=after.split(':');
 const {pool}=createDatabasePool(process.env.TG_READ_DATABASE_URL??'');
 try{
  const snapshot=await transaction(pool,async c=>{
   await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const id=[process.env.TG_ENVIRONMENT,CURRENT_CHAIN_ID,runtimeReleaseId];
   const head=(await c.query(`SELECT p.next_block-1 AS number,b.hash FROM "${schema}".projection_checkpoints p JOIN "${schema}".chain_blocks b ON b.environment=p.environment AND b.chain_id=p.chain_id AND b.deployment_digest=p.deployment_digest AND b.number=p.next_block-1 AND b.canonical AND b.finalized WHERE p.environment=$1 AND p.chain_id=$2 AND p.deployment_digest=$3 AND p.scope='history' AND p.algorithm_version='history-incremental-v3-creator'`,id)).rows[0];
   if(!head)throw Error('Creator checkpoint not available');
   const rows=(await c.query(`SELECT r.*,r.market_id||':'||r.epoch||':'||r.asset AS cursor FROM "${schema}".creator_reward_balances r JOIN "${schema}".chain_blocks b ON b.environment=r.environment AND b.chain_id=r.chain_id AND b.deployment_digest=r.deployment_digest AND b.hash=r.block_hash AND b.canonical AND b.finalized WHERE r.environment=$1 AND r.chain_id=$2 AND r.deployment_digest=$3 AND (r.market_id,r.epoch,r.asset)>($4,$5::bigint,$6) ORDER BY r.market_id,r.epoch,r.asset LIMIT 20`,[...id,afterMarket,afterEpoch,afterAsset])).rows;
   return {head,rows};
  });
  const rpc=new RpcTransport({url:process.env.TG_RPC_URL??''}),client=createPublicClient({transport:custom({request:({method,params})=>rpc.call(method,params as unknown[]??[])})});
  if(await client.getChainId()!==CURRENT_CHAIN_ID)throw Error('Reconciliation chain mismatch');
  const blockNumber=BigInt(snapshot.head.number),block=await client.getBlock({blockNumber});if(block.hash!==snapshot.head.hash)throw Error('Reconciliation anchor changed');
  const vault=fixedF72Sources().find(s=>s.module==='ProtocolFeeVault')!,registry=fixedF72Sources().find(s=>s.module==='CreatorRevenueRegistry')!;
  for(const source of [vault,registry])if(!source.runtimeCodeHash||keccak256(await client.getCode({address:source.address,blockNumber})??'0x')!==source.runtimeCodeHash)throw Error('Reconciliation contract mismatch');
  const abi=parseAbi(['function creatorLiability(bytes32,uint32,address) view returns(uint256)','function creatorBeneficiaryAt(bytes32,uint32) view returns(address)']);
  const mismatches=[];
  for(const row of snapshot.rows){const args=[row.market_id as Hex,Number(row.epoch)] as const;
   const [amount,owner]=await Promise.all([client.readContract({address:vault.address,abi,functionName:'creatorLiability',args:[...args,row.asset as Address],blockNumber}),client.readContract({address:registry.address,abi,functionName:'creatorBeneficiaryAt',args,blockNumber})]);
   if(amount!==BigInt(row.remaining)||owner.toLowerCase()!==row.beneficiary)mismatches.push(row.cursor);
  }
  if((await client.getBlock({blockNumber})).hash!==block.hash)throw Error('Reconciliation anchor changed');
  console.log(JSON.stringify({status:mismatches.length?'mismatch':'matched',checked:snapshot.rows.length,blockNumber:String(blockNumber),mismatches,nextCursor:snapshot.rows.length===20?snapshot.rows.at(-1).cursor:null}));if(mismatches.length)process.exitCode=1;
 }finally{await pool.end();}
}
main().catch(()=>{console.error('Creator reconciliation failed. Check the database checkpoint, RPC and deployment configuration. No data was changed.');process.exitCode=1;});
