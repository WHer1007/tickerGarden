import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {ROOT,read,write,json,sha,equal,keccak256,toBytes,sourceSnapshot,artifact} from './common.mjs';
export function finalizeCandidate(output){
 const lockedInputs=sourceSnapshot();
 for(const file of Object.keys(lockedInputs)){
  const archived=path.join(output,'source-archive/repository',file);
  fs.mkdirSync(path.dirname(archived),{recursive:true});fs.copyFileSync(path.join(ROOT,file),archived);
  equal(sha(archived),lockedInputs[file],'archived input '+file);
 }
 const runtime=read(path.join(output,'runtime-plan.json')),activation=read(path.join(output,'activation-plan.json'));
 const simulation=read(path.join(output,'simulation-summary.json')),drills=read(path.join(output,'release-drills.json'));
 const snapshot=read(path.join(output,'mainnet-snapshot.json')),native=read(path.join(output,'native-fee-quotes.json'));
 const receipts=fs.readFileSync(path.join(output,'simulation-receipts.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert.equal(snapshot.failures.length,0);assert.equal(simulation.status,'LOCAL_FORK_INITIALIZATION_PASSED_NOT_BROADCAST');assert.equal(drills.status,'LOCAL_FORK_DRILLS_PASSED_NOT_MAINNET_CONTROL_PROOF');
 const txs=[...runtime.transactions,...activation.transactions];assert.equal(receipts.length,txs.length);assert.equal(native.quotes.length,txs.length);
 equal(runtime.releaseId,activation.releaseId,'activation release');equal(runtime.releaseId,simulation.releaseId,'simulation release');equal(runtime.releaseId,drills.releaseId,'drill release');
 const gasPrice=BigInt(snapshot.network.gasPriceWei),maxFee=gasPrice*2n,maxPriority=1000000n;
 let totalExpected=0n,totalMaximum=0n,totalGas=0n;
 const transactions=txs.map((tx,index)=>{
  const receipt=receipts[index],l1=native.quotes[index];equal(tx.id,receipt.id,'simulation ordering');equal(tx.inputHash,receipt.inputHash,'simulation calldata');equal(tx.id,l1.id,'native fee ordering');equal(tx.inputHash,l1.inputHash,'native fee calldata');equal(keccak256(tx.data),tx.inputHash,'calldata hash');
  const expectedGas=BigInt(receipt.evmGasUsed)+BigInt(l1.gasEstimateForL1);
  const gas=(BigInt(receipt.estimatedEvmGas)+BigInt(l1.gasEstimateForL1))*125n/100n+25000n;
  assert.ok(gas<BigInt(snapshot.network.maxTxGas),'transaction gas cap');
  totalGas+=expectedGas;totalExpected+=expectedGas*gasPrice;totalMaximum+=gas*maxFee;
  return {...tx,type:'eip1559',gasLimit:gas.toString(),maxFeePerGas:maxFee.toString(),maxPriorityFeePerGas:maxPriority.toString(),feeCeilingWei:(gas*maxFee).toString(),estimatedEvmGas:receipt.estimatedEvmGas,simulatedEvmGasUsed:receipt.evmGasUsed,nativeL1GasEstimate:l1.gasEstimateForL1,calldataBytes:receipt.calldataBytes};
 });
 const balance=BigInt(snapshot.accounts.deployer.balanceWei),shortfall=totalMaximum>balance?totalMaximum-balance:0n;
 const recommendedBalance=((totalMaximum+5000000000000000n+9999999999999999n)/10000000000000000n)*10000000000000000n;
 const funding={status:shortfall>0n?'DEPLOYER_TOP_UP_REQUIRED':'BALANCE_COVERS_PROPOSED_CEILING',pin:snapshot.pin,gasPriceWei:gasPrice,totalGas,totalExpectedWei:totalExpected,totalMaximumWei:totalMaximum,currentDeployerBalanceWei:balance,shortfallToCeilingWei:shortfall,recommendedDeployerBalanceWei:recommendedBalance,recommendedTopUpWei:recommendedBalance>balance?recommendedBalance-balance:0n,operator:runtime.configuration.holderSnapshots.publisher,operatorBalanceWei:snapshot.accounts.operator.balanceWei,policy:'Proposed signing limits: pinned EVM estimate plus native L1 gas, 25 percent gas margin plus 25000 per transaction, 2x observed gas price. Refresh live fees and nonce before approval/signing.',approvalStatus:'PROPOSED_NOT_AUTHORIZED'};
 write(path.join(output,'fee-budget.json'),funding);
 const pack={schemaVersion:1,status:'TECHNICALLY_PREPARED_EXTERNAL_GATES_PENDING_NOT_BROADCAST',chainId:4663,releaseId:runtime.releaseId,pin:snapshot.pin,sourceBundleStatus:'CONTRACT_RELEASE_INPUTS_ARCHIVED_AND_HASHED',broadcastAuthorized:false,productionReady:false,transactionCount:transactions.length,startingNonce:transactions[0].nonce,endingNonce:transactions.at(-1).nonce,feeBudgetFile:'fee-budget.json',transactions};
 write(path.join(output,'transactions.unsigned.json'),pack);
 const code=read(path.join(output,'runtime-code.json'));
 write(path.join(output,'runtime-catalog.candidate.json'),{schemaVersion:1,status:'CANDIDATE_NOT_DEPLOYED_DO_NOT_SERVE_TO_PRODUCTION',chainId:4663,releaseId:runtime.releaseId,activationBlock:null,activationBlockHash:null,contracts:code,abiArtifacts:Object.fromEntries(Object.keys(code).filter(n=>n!=='LaunchLockerCreationCodeStore').map(n=>[n,{path:'build/'+n+'.json',sha256:sha(path.join(output,'build',n+'.json'))}])),baselineId:activation.baselineId,launchTemplateId:activation.launchTemplateId,quotes:activation.quoteConfigs,stakingAssets:activation.stakes,holderPublisher:runtime.configuration.holderSnapshots.publisher,compoundKeeper:runtime.configuration.lpCompounding.keeperAtLaunch,offchainSchedulerEnabled:false});
 const sizes=Object.fromEntries(Object.entries(code).map(([name,v])=>[name,v.runtimeBytes]));assert.ok(sizes.TickerGardenFactoryV1<=24000);assert.ok(sizes.ProtocolFeeVault<=23500);for(const [name,size]of Object.entries(sizes))assert.ok(size<=24576,name+' EIP170');
 write(path.join(output,'runtime-sizes.json'),{status:'WITHIN_RUNTIME_LIMITS',runtimeBytes:sizes,projectBudgets:{TickerGardenFactoryV1:24000,ProtocolFeeVault:23500}});
 write(path.join(output,'input-lock.json'),{schemaVersion:1,releaseId:runtime.releaseId,archiveDirectory:'source-archive/repository',files:lockedInputs});
 write(path.join(output,'source-sha256.json'),lockedInputs);
 console.log(json({status:pack.status,transactions:transactions.length,totalExpectedETH:Number(totalExpected)/1e18,totalCeilingETH:Number(totalMaximum)/1e18,recommendedBalanceETH:Number(recommendedBalance)/1e18}));return {pack,funding};
}
if(process.argv[1]===new URL(import.meta.url).pathname)finalizeCandidate(path.resolve(process.argv[2]??'docs/reviews/evidence/production-release-2026-09-15'));
