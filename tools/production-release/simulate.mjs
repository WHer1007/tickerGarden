import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {decodeFunctionResult} from '../../apps/web/node_modules/viem/_esm/index.js';
import {artifact,read,write,sha,json,equal,keccak256,encodeFunctionData,toFunctionSelector,getContractAddress} from './common.mjs';
import {createLocalFork,quantity} from './local-fork.mjs';
import {verifyAndBuildRuntime} from './runtime-plan.mjs';
import {buildActivation} from './activation-plan.mjs';
export async function simulateRelease(output){
 const snapshot=read(path.join(output,'mainnet-snapshot.json')),stored=read(path.join(output,'runtime-plan.json'));
 const runtime=verifyAndBuildRuntime(read(path.join(output,'runtime-export.json')).returns.encoded.value,stored.configuration,stored.releaseId,snapshot.accounts.deployer.nonce);
 equal(json(runtime),json(stored),'recomputed runtime plan');
 const fork=await createLocalFork(snapshot,output),rpc=fork.call;
 const receipts=[];
 const abis=new Map();const abi=name=>{if(!abis.has(name))abis.set(name,artifact(name).abi);return abis.get(name);};
 const call=async(name,to,functionName,args=[],from=runtime.deployer)=>decodeFunctionResult({abi:abi(name),functionName,data:await rpc('eth_call',[{from,to,data:encodeFunctionData({abi:abi(name),functionName,args})},'latest'])});
 const send=async tx=>{
  equal(BigInt(await rpc('eth_getTransactionCount',[tx.from,'pending'])),tx.nonce,tx.id+' nonce');
  const req={from:tx.from,to:tx.to,value:quantity(tx.value),nonce:quantity(tx.nonce),data:tx.data,gasPrice:quantity(snapshot.network.gasPriceWei)};
  const estimate=BigInt(await rpc('eth_estimateGas',[req]));const gasLimit=estimate*125n/100n+25000n;
  assert.ok(gasLimit<32000000n,tx.id+' exceeds guarded transaction gas budget');
  const hash=await rpc('eth_sendTransaction',[{...req,gas:quantity(gasLimit)}]);
  let receipt;for(let attempt=0;attempt<100;attempt++){receipt=await rpc('eth_getTransactionReceipt',[hash]);if(receipt)break;await new Promise(r=>setTimeout(r,100));}
  assert.ok(receipt,tx.id+' mined receipt');equal(receipt.status,'0x1',tx.id+' execution status');
  const evidence={id:tx.id,phase:tx.phase,nonce:tx.nonce,inputHash:tx.inputHash,calldataBytes:(tx.data.length-2)/2,estimatedEvmGas:estimate.toString(),gasLimit:gasLimit.toString(),evmGasUsed:BigInt(receipt.gasUsed).toString(),localTransactionHash:hash,localBlockNumber:BigInt(receipt.blockNumber).toString()};
  receipts.push(evidence);fs.appendFileSync(path.join(output,'simulation-receipts.jsonl'),JSON.stringify(evidence)+'\n');
  if(receipts.length<=19||receipts.length%25===0||tx.phase==='RENOUNCE_DEPLOYER')console.log(tx.id+' gas='+evidence.evmGasUsed);
  return receipt;
 };
 try{
  fs.writeFileSync(path.join(output,'simulation-receipts.jsonl'),'');
  await rpc('anvil_impersonateAccount',[runtime.deployer]);
  // Local funding allows the whole plan to execute even when the real deployer
  // needs a top-up. The final fee budget separately checks its actual balance.
  await rpc('anvil_setBalance',[runtime.deployer,quantity(10n**18n)]);
  for(const tx of runtime.transactions)await send(tx);
  const addresses={...runtime.components,V1RobinhoodMainnetDeploymentOrchestrator:runtime.orchestrator,V1HookExecutorDeployer:runtime.helper,TickerGardenMemeHook:runtime.hook,GraduationExecutor:runtime.graduationExecutor,TickerGardenFactoryV1:runtime.factory};
  const observedCode={};
  for(const [name,address] of Object.entries(addresses)){
   const code=await rpc('eth_getCode',[address,'latest']);assert.ok(code.length>2,name+' deployed');
   const a=artifact(name),expected=Buffer.from(a.deployedBytecode.object.slice(2),'hex'),actual=Buffer.from(code.slice(2),'hex');assert.equal(actual.length,expected.length,name+' runtime length');
   for(const refs of Object.values(a.deployedBytecode.immutableReferences??{}))for(const {start,length} of refs){expected.fill(0,start,start+length);actual.fill(0,start,start+length);}
   assert.ok(expected.equals(actual),name+' runtime executable bytes');
   observedCode[name]={address,codeHash:keccak256(code),runtimeBytes:(code.length-2)/2};
  }
  // The executor's only CREATE deploys its exact immutable Locker creation-code store.
  const store=getContractAddress({from:runtime.graduationExecutor,nonce:1n});const storeCode=await rpc('eth_getCode',[store,'latest']);
  equal(storeCode,artifact('LaunchLocker').bytecode.object,'Locker creation code store');
  equal(await call('GraduationExecutor',runtime.graduationExecutor,'launchLockerCreationCodeHash'),keccak256(storeCode),'Locker code hash getter');
  observedCode.LaunchLockerCreationCodeStore={address:store,codeHash:keccak256(storeCode),runtimeBytes:(storeCode.length-2)/2};
  equal(await call('V1RobinhoodMainnetDeploymentOrchestrator',runtime.orchestrator,'completed'),true,'runtime complete');
  equal(await call('V1RobinhoodMainnetDeploymentOrchestrator',runtime.orchestrator,'deploymentPayloadHash'),runtime.payloadHash,'payload committed');
  write(path.join(output,'runtime-code.json'),observedCode);
  const activation=buildActivation(runtime,observedCode);write(path.join(output,'activation-plan.json'),activation);
  for(const tx of activation.transactions)await send(tx);
  const c=runtime.components;
  for(const a of activation.stakes){
   const value=await call('OfficialStockRegistryV1',c.OfficialStockRegistryV1,'asset',[a.assetUid]);
   equal(value.stockToken,a.tokenAddress,a.symbol+' stock');equal(value.userStockVault,c.UserStockVault,a.symbol+' Vault');equal(value.tokenDecimals,a.decimals,a.symbol+' decimals');equal(value.status,1,a.symbol+' status');
   equal(await call('OfficialStockRegistryV1',c.OfficialStockRegistryV1,'assetIdentityCurrent',[a.assetUid]),true,a.symbol+' identity');
   equal(await call('OfficialStockRegistryV1',c.OfficialStockRegistryV1,'minimumAllocation',[a.assetUid]),a.minimumAllocation,a.symbol+' minimum');
  }
  for(const q of activation.quoteConfigs){
   equal(json(await call('ApprovedQuoteRegistry',c.ApprovedQuoteRegistry,'quoteConfig',[q.configId])),json(q.value),q.symbol+' quote');
   equal(await call('ApprovedQuoteRegistry',c.ApprovedQuoteRegistry,'quoteIdentityCurrent',[q.configId]),true,q.symbol+' quote identity');
   const resolved=await call('LaunchConfigResolver',c.LaunchConfigResolver,'resolve',[q.configId,activation.baselineId,activation.launchTemplateId]);
   equal(resolved[0].economicsHash,q.configId,q.symbol+' resolve');
  }
  equal(await call('HolderRewardsDistributorV1',c.HolderRewardsDistributorV1,'snapshotPublisher'),runtime.configuration.holderSnapshots.publisher,'publisher initialized');
  equal(await call('GraduationExecutor',runtime.graduationExecutor,'compoundKeeper'),runtime.configuration.lpCompounding.keeperAtLaunch,'keeper initialized');
  equal((await call('AccessManager',c.AccessManager,'hasRole',[0n,runtime.deployer]))[0],false,'bootstrap admin renounced');
  for(const role of activation.access.roles){const membership=await call('AccessManager',c.AccessManager,'hasRole',[BigInt(role.roleId),role.member]);equal(membership[0],true,role.name+' membership');equal(membership[1],role.executionDelaySeconds,role.name+' delay');equal(await call('AccessManager',c.AccessManager,'getRoleAdmin',[BigInt(role.roleId)]),1,role.name+' role admin');}
  for(const role of [1n,3n])equal(await call('AccessManager',c.AccessManager,'getRoleGuardian',[role]),2,'role guardian');
  const keeperSelector=toFunctionSelector('setCompoundKeeper(address)');
  const gov=runtime.configuration.addresses.governance;
  const ability=await call('AccessManager',c.AccessManager,'canCall',[gov,runtime.graduationExecutor,keeperSelector]);equal(ability[0],false,'governance not immediate');equal(ability[1],172800,'governance 48h');
  equal((await call('AccessManager',c.AccessManager,'canCall',[runtime.deployer,runtime.graduationExecutor,keeperSelector]))[0],false,'deployer cannot set keeper');
  const summary={schemaVersion:1,status:'LOCAL_FORK_INITIALIZATION_PASSED_NOT_BROADCAST',releaseId:runtime.releaseId,chainId:4663,pin:snapshot.pin,runtimeTransactions:runtime.transactions.length,activationTransactions:activation.transactions.length,totalTransactions:receipts.length,stocks:activation.stakes.length,quotes:activation.quoteConfigs.length,verifiedRuntimeContracts:Object.keys(observedCode).length,bootstrapAdminRenounced:true,publisher:runtime.configuration.holderSnapshots.publisher,keeper:runtime.configuration.lpCompounding.keeperAtLaunch,schedulerEnabled:false,totalEvmGas:receipts.reduce((s,x)=>s+BigInt(x.evmGasUsed),0n),maximumEvmGas:receipts.reduce((a,b)=>BigInt(a.evmGasUsed)>BigInt(b.evmGasUsed)?a:b),gasScope:'Local Anvil EVM execution only. Native Arbitrum L1-data fees and live nonce/fees must be refreshed before signing.',deployerBalanceAfterLocalInitialization:BigInt(await rpc('eth_getBalance',[runtime.deployer,'latest'])),nativeBroadcast:false,privateKeysUsed:false};
  write(path.join(output,'simulation-summary.json'),summary);console.log(json(summary));
  // Save a local-only checkpoint so an upstream read failure in subsequent
  // drills does not require replaying the already verified initialization.
  fs.writeFileSync(path.join(output,'local-initialized-state.hex'),await rpc('anvil_dumpState'));
  write(path.join(output,'local-checkpoint.json'),{status:'LOCAL_ANVIL_ONLY_NOT_MAINNET',releaseId:runtime.releaseId,sha256:sha(path.join(output,'local-initialized-state.hex'))});
  // Additional safety drills run on a reverted copy and never enter the unsigned initialization pack.
  const {runReleaseDrills}=await import('./drills.mjs');await runReleaseDrills({runtime,activation,observedCode,rpc,call,output});
  return summary;
 }finally{await fork.close();}
}
if(process.argv[1]===new URL(import.meta.url).pathname)await simulateRelease(path.resolve(process.argv[2]??'docs/reviews/evidence/production-release-2026-09-15'));
