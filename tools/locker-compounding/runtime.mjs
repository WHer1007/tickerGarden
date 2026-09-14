import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {encodeAbiParameters,encodeFunctionData,keccak256,parseAbi,decodeEventLog} from '../../apps/web/node_modules/viem/_esm/index.js';
import {planLiquidity,positionTicks} from './math.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const artifact=name=>JSON.parse(fs.readFileSync(path.join(root,`contracts/out-v1/${name}.sol/${name}.json`))).abi;
const abis={locker:artifact('LaunchLocker'),registry:artifact('MarketRegistryV1'),executor:artifact('GraduationExecutor'),
 positionManager:parseAbi(['function ownerOf(uint256) view returns(address)','function poolManager() view returns(address)','function getPositionLiquidity(uint256) view returns(uint128)','function getPoolAndPositionInfo(uint256) view returns((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks),uint256)']),
 poolManager:parseAbi(['function extsload(bytes32) view returns(bytes32)'])};
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
export const json=value=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v,null,2);
export function validateManifest(m){
 if(!Number.isSafeInteger(m.chainId)||m.chainId<1||!/^0x[0-9a-f]{64}$/i.test(m.releaseId)||BigInt(m.releaseId)===0n||!/^0x[0-9a-f]{64}$/i.test(m.marketId)||BigInt(m.marketId)===0n)throw Error('Invalid deployment identity');
 for(const k of ['keeper','locker','registry','executor','positionManager','poolManager'])if(!/^0x[0-9a-f]{40}$/i.test(m[k])||BigInt(m[k])===0n)throw Error('Invalid address: '+k);
 for(const k of Object.keys(abis))if(!/^0x[0-9a-f]{64}$/i.test(m.codeHashes?.[k]))throw Error('Missing verified runtime hash: '+k);
 for(const k of ['maxGasWei','minLiquidity'])if(!/^[1-9][0-9]*$/.test(m[k]))throw Error('Missing positive policy: '+k);
 if(!Number.isInteger(m.bufferBps)||m.bufferBps<1||m.bufferBps>1000)throw Error('Invalid buffer');
 if(!Number.isInteger(m.confirmations)||m.confirmations<1||(m.chainId!==31337&&m.confirmations<2))throw Error('Invalid confirmation policy');
 return m;
}

/** Pins all reads to one block and validates the canonical position before any signing. */
export async function preview(client,m){
 validateManifest(m);
 if(await client.getChainId()!==m.chainId)throw Error('Wrong RPC chain');
 const head=await client.getBlock();
 const read=(kind,fn,args=[])=>client.readContract({address:m[kind],abi:abis[kind],functionName:fn,args,blockNumber:head.number});
 for(const kind of Object.keys(abis)){
  const code=await client.getBytecode({address:m[kind],blockNumber:head.number});
  if(!code||!same(keccak256(code),m.codeHashes[kind]))throw Error('Runtime drift: '+kind);
 }
 if(!same(await read('registry','graduationExecutor'),m.executor)||!same(await read('executor','positionManager'),m.positionManager)||!same(await read('executor','poolManager'),m.poolManager)||!same(await read('positionManager','poolManager'),m.poolManager))throw Error('Deployment dependency mismatch');
 if(!same(await read('executor','compoundKeeper'),m.keeper))throw Error('Keeper disabled or rotated');
 if(!same(await read('executor','predictLaunchLocker',[m.marketId]),m.locker)||!same(await read('locker','marketId'),m.marketId))throw Error('Noncanonical Locker');
 const market=await read('registry','market',[m.marketId]);
 if(Number(market.runtime.launchPhase)!==1)throw Error('Market not graduated');
 const [tokenId,poolId]=await read('locker','lockedPosition');
 if(!same(poolId,await read('registry','canonicalPoolId',[m.marketId]))||!same(poolId,market.runtime.poolId)||!same(await read('positionManager','ownerOf',[tokenId]),m.locker))throw Error('Position ownership or pool mismatch');
 const [key,info]=await read('positionManager','getPoolAndPositionInfo',[tokenId]);
 const encoded=encodeAbiParameters([{type:'address'},{type:'address'},{type:'uint24'},{type:'int24'},{type:'address'}],[key.currency0,key.currency1,key.fee,key.tickSpacing,key.hooks]);
 if(!same(keccak256(encoded),poolId))throw Error('Position key mismatch');
 const slot=keccak256(encodeAbiParameters([{type:'bytes32'},{type:'uint256'}],[poolId,6n]));
 const price=BigInt(await read('poolManager','extsload',[slot]))&((1n<<160n)-1n);
 const [pending0,pending1]=await read('locker','pendingCompoundFees');
 // Collection preview causes no state mutation. Final compound simulation remains authoritative
 // when a historical deficit consumes some of these newly collected fees.
 const collected=await client.simulateContract({address:m.locker,abi:abis.locker,functionName:'collectLockedFees',account:m.keeper,blockNumber:head.number});
 const [tickLower,tickUpper]=positionTicks(BigInt(info));
 const plan=planLiquidity({amount0:pending0+collected.result[0],amount1:pending1+collected.result[1],sqrtPriceX96:price,tickLower,tickUpper,bufferBps:m.bufferBps,minLiquidity:BigInt(m.minLiquidity)});
 const base={...plan,chainId:m.chainId,releaseId:m.releaseId,marketId:m.marketId,locker:m.locker,tokenId,poolId,blockNumber:head.number,blockHash:head.hash,pending0,pending1,collectable0:collected.result[0],collectable1:collected.result[1],sqrtPriceX96:price};
 if(plan.status!=='ready')return base;
 const deadline=head.timestamp+180n;
 const args=[plan.liquidity,plan.amount0Max,plan.amount1Max,deadline];
 await client.simulateContract({address:m.locker,abi:abis.locker,functionName:'compoundLockedFees',account:m.keeper,args,blockNumber:head.number});
 const data=encodeFunctionData({abi:abis.locker,functionName:'compoundLockedFees',args});
 const gas=(await client.estimateGas({account:m.keeper,to:m.locker,data}))*120n/100n;
 const fees=await client.estimateFeesPerGas();
 if(fees.maxFeePerGas===undefined||fees.maxPriorityFeePerGas===undefined)throw Error('EIP-1559 fee estimate unavailable');
 if(gas*fees.maxFeePerGas>BigInt(m.maxGasWei))return {...base,status:'gas_cap_exceeded',gas,maxFeePerGas:fees.maxFeePerGas};
 if(!same((await client.getBlock({blockNumber:head.number})).hash,head.hash))throw Error('Preview anchor orphaned');
 return {...base,deadline,data,gas,maxFeePerGas:fees.maxFeePerGas,maxPriorityFeePerGas:fees.maxPriorityFeePerGas};
}

export function verifyReceipt(receipt,row,m){
 if(!same(receipt.transactionHash,row.hash))throw Error('Receipt hash mismatch');
 if(receipt.status!=='success')return 'reverted';
 const events=receipt.logs.filter(l=>same(l.address,m.locker)).flatMap(l=>{try{return [decodeEventLog({abi:abis.locker,data:l.data,topics:l.topics})]}catch{return []}}).filter(e=>e.eventName==='LockedFeesCompounded');
 if(events.length!==1)throw Error('Missing or duplicate compound receipt');
 const a=events[0].args;
 if(!same(a.marketId,m.marketId)||a.tokenId!==BigInt(row.plan.tokenId)||a.liquidity!==BigInt(row.plan.liquidity)||a.amount0>BigInt(row.plan.amount0Max)||a.amount1>BigInt(row.plan.amount1Max))throw Error('Compound receipt does not match intent');
 return 'confirmed';
}

/** One signer/chain journal must be shared by all markets. Persist signed bytes before sending. */
export async function reconcile(client,m,journal,save){
 const row=journal.pending;
 if(!row)return null;
 if(!same(row.marketId,m.marketId)||!same(row.locker,m.locker)||!same(row.releaseId,m.releaseId))throw Error('Pending operation belongs to another manifest; reconcile that market first');
 let receipt;
 try{receipt=await client.getTransactionReceipt({hash:row.hash});}catch(e){if(e.name!=='TransactionReceiptNotFoundError')throw e;}
 if(!receipt){
  const latest=await client.getTransactionCount({address:m.keeper,blockTag:'latest'});
  if(latest>row.nonce)throw Error('Nonce consumed without receipt; reconciliation required');
  const head=await client.getBlock();
  if(head.timestamp>=BigInt(row.plan.deadline))throw Error('Unresolved intent expired; inspect nonce/receipt before replacing it');
  try{await client.sendRawTransaction({serializedTransaction:row.raw});}catch(e){if(!/already known|known transaction/i.test(e.shortMessage||e.message||''))throw Error('Submission uncertain; durable intent retained');}
 }
 receipt=await client.waitForTransactionReceipt({hash:row.hash,confirmations:m.confirmations,timeout:55000});
 const status=verifyReceipt(receipt,row,m);
 journal.last={...row,status,blockNumber:String(receipt.blockNumber),gasWei:String(receipt.gasUsed*receipt.effectiveGasPrice)};
 delete journal.last.raw;
 journal.pending=null;
 await save(journal);
 return journal.last;
}

export async function executeOnce(client,wallet,m,journal,save){
 if(!same(wallet.account.address,m.keeper))throw Error('Signer is not configured Keeper');
 if(await client.getChainId()!==m.chainId)throw Error('Wrong RPC chain');
 if(journal.pending)return reconcile(client,m,journal,save);
 const plan=await preview(client,m);
 if(plan.status!=='ready'){journal.last=plan;await save(journal);return plan;}
 const nonce=await client.getTransactionCount({address:m.keeper,blockTag:'pending'});
 if(nonce!==await client.getTransactionCount({address:m.keeper,blockTag:'latest'}))throw Error('Keeper has an external pending transaction');
 const head=await client.getBlock();
 if(head.timestamp+30n>=plan.deadline||!same((await client.getBlock({blockNumber:plan.blockNumber})).hash,plan.blockHash))throw Error('Plan expired or orphaned');
 // Recheck current Keeper and exact call immediately before signing; price movement fails closed.
 await client.call({account:m.keeper,to:m.locker,data:plan.data,gas:plan.gas});
 if(await client.getBalance({address:m.keeper})<plan.gas*plan.maxFeePerGas)throw Error('Keeper gas balance insufficient');
 const raw=await wallet.signTransaction({account:wallet.account,chain:wallet.chain,type:'eip1559',to:m.locker,data:plan.data,value:0n,nonce,gas:plan.gas,maxFeePerGas:plan.maxFeePerGas,maxPriorityFeePerGas:plan.maxPriorityFeePerGas});
 journal.pending={status:'signed',marketId:m.marketId,locker:m.locker,releaseId:m.releaseId,nonce,hash:keccak256(raw),raw,plan};
 await save(journal);
 return reconcile(client,m,journal,save);
}
