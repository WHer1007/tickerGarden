import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {deriveV1AccessManagerPlan} from '../../deployments/src/v1/access-manager-plan.ts';
import {ROOT,read,sha,equal,artifact,keccak256,toBytes,encodeAbiParameters,parseAbiParameters,encodeFunctionData} from './common.mjs';
const hashText=x=>keccak256(toBytes(x));
export function buildActivation(runtime,observedCode){
 const c=runtime.components,config=runtime.configuration;
 const abis=new Map();const abi=name=>{if(!abis.has(name))abis.set(name,artifact(name).abi);return abis.get(name);};
 assert.equal(config.chainId,4663);
 equal(sha('deployments/manifests/robinhood-mainnet-4663.paired-assets.json'),config.quoteManifestSha256,'approved quote manifest');
 equal(sha('deployments/manifests/robinhood-mainnet-4663.staking-assets.json'),config.stakeManifestSha256,'approved stake manifest');
 assert.equal(config.lpCompounding.onchainEnabledAtLaunch,true);assert.equal(config.lpCompounding.schedulerEnabled,false);
 equal(config.lpCompounding.keeperAtLaunch,config.holderSnapshots.publisher,'shared operator');
 const stakes=read('deployments/manifests/robinhood-mainnet-4663.staking-assets.json').assets;
 const quotes=read('deployments/manifests/robinhood-mainnet-4663.paired-assets.json').assets;
 assert.equal(stakes.length,194);assert.equal(quotes.length,196);
 assert.equal(new Set(stakes.map(x=>x.assetUid)).size,194);assert.equal(new Set(quotes.map(x=>x.tokenAddress.toLowerCase())).size,196);
 const reference=read('spec/v1_pons_behavior_vectors.json').reference;
 const baselineId=hashText(runtime.releaseId+':RH_MAINNET_BASELINE');
 const launchTemplateId=hashText(runtime.releaseId+':RH_MAINNET_TEMPLATE');
 const baseline={referenceChainId:BigInt(reference.chainId),referenceFactory:reference.factory,referenceFactoryCodeHash:reference.runtimeKeccak256,launchConfigId:0n,supply:10n**27n,curveFeeBps:100n,poolFee:0,tickSpacing:200,behaviorVectorRoot:keccak256(fs.readFileSync(path.join(ROOT,'spec/v1_pons_behavior_vectors.json'))),status:1};
 const codeHash=(name,address)=>{const observed=observedCode[name];assert.ok(observed?.codeHash,'missing verified code '+name);equal(observed.address,address,name+' address');return observed.codeHash;};
 const template={memeTokenImplementation:c.TickerMemeTokenV1Implementation,memeTokenCodeHash:codeHash('TickerMemeTokenV1Implementation',c.TickerMemeTokenV1Implementation),curveImplementation:c.TickerGardenCurveImplementation,curveCodeHash:codeHash('TickerGardenCurveImplementation',c.TickerGardenCurveImplementation),gaugeImplementation:c.MemeStockGauge,gaugeCodeHash:codeHash('MemeStockGauge',c.MemeStockGauge),graduatedHook:runtime.hook,hookCodeHash:codeHash('TickerGardenMemeHook',runtime.hook),graduationExecutor:runtime.graduationExecutor,graduationExecutorCodeHash:codeHash('GraduationExecutor',runtime.graduationExecutor),feePolicyId:config.feePolicyId,executionSpecId:hashText('V1-EXEC-11'),status:1};
 let nonce=runtime.transactions.at(-1).nonce+1;
 const tx=(id,phase,to,data,description)=>({id,phase,chainId:4663,from:runtime.deployer,to,value:'0',nonce:nonce++,data,inputHash:keccak256(data),description});
 const call=(id,phase,name,to,fn,args,description)=>tx(id,phase,to,encodeFunctionData({abi:abi(name),functionName:fn,args}),description);
 const transactions=[call('register-baseline','ASSET_ACTIVATION','TickerGardenBaselineRegistry',c.TickerGardenBaselineRegistry,'addBaseline',[baselineId,baseline],'Approved fixed supply, curve fee and mainnet reference code identity')];
 for(const a of stakes){assert.equal(a.enabled,true);equal(a.minimumAllocation,'500000000000000000','minimum allocation '+a.symbol);transactions.push(call('register-stock-'+a.symbol,'ASSET_ACTIVATION','OfficialStockRegistryV1',c.OfficialStockRegistryV1,'registerAsset',[a.assetUid,a.tokenAddress,a.decimals,c.UserStockVault,BigInt(a.minimumAllocation),a.expectedFingerprint],'Register '+a.symbol+' with canonical Vault and approved fingerprint'));}
 const quoteConfigs=quotes.map(a=>{
  assert.equal(a.includedInRelease,true);assert.equal(a.graduationThresholdStatus,'APPROVED');assert.equal(a.admissionPath,'ADMIN_REVIEWED_WHITELIST');
  const configId=keccak256(encodeAbiParameters(parseAbiParameters('bytes32,uint256,uint256,bytes32,address,uint8,uint256,uint256'),[hashText('TICKERGARDEN_V1_QUOTE_ECONOMICS'),1n,4663n,baselineId,a.tokenAddress,a.decimals,BigInt(a.phantomQuote),BigInt(a.graduationThreshold)]));
  const value={tickerGardenBaselineId:baselineId,quoteAsset:a.tokenAddress,quoteDecimals:a.decimals,phantomQuote:BigInt(a.phantomQuote),graduationThreshold:BigInt(a.graduationThreshold),economicsHash:configId,status:1};
  transactions.push(call('register-quote-'+a.symbol,'ASSET_ACTIVATION','ApprovedQuoteRegistry',c.ApprovedQuoteRegistry,'addQuoteConfig',[configId,value],'Approved administrator whitelist; frozen raw amounts for '+a.symbol));return {symbol:a.symbol,configId,value};
 });
 transactions.push(call('register-template','ASSET_ACTIVATION','LaunchTemplateRegistry',c.LaunchTemplateRegistry,'addLaunchTemplate',[launchTemplateId,template],'Bind exact runtime identities and V1-EXEC-11'));
 transactions.push(call('initialize-holder-publisher','OPERATOR_INITIALIZATION','HolderRewardsDistributorV1',c.HolderRewardsDistributorV1,'setSnapshotPublisher',[config.holderSnapshots.publisher],'Initialize publisher while bootstrap admin is still immediate'));
 transactions.push(call('initialize-compound-keeper','OPERATOR_INITIALIZATION','GraduationExecutor',runtime.graduationExecutor,'setCompoundKeeper',[config.lpCompounding.keeperAtLaunch],'Compounding usable at launch; offchain scheduling remains disabled'));
 const moduleAddresses=Object.fromEntries(['OfficialStockRegistryV1','ApprovedQuoteRegistry','TickerGardenBaselineRegistry','LaunchTemplateRegistry'].map(name=>[name,c[name]]));moduleAddresses.GraduationExecutor=runtime.graduationExecutor;
 const access=deriveV1AccessManagerPlan({accessManager:c.AccessManager,deployer:runtime.deployer,governanceSafe:config.addresses.governance,guardianSafe:config.addresses.pauseGuardian,securityOrGovernanceSafe:config.addresses.unpause,moduleAddresses,holderRewardsDistributor:c.HolderRewardsDistributorV1});
 access.actions.forEach((a,i)=>transactions.push(tx('access-'+i+'-'+a.phase,a.phase,a.target,a.data,a.description)));
 assert.equal(transactions.at(-1).phase,'RENOUNCE_DEPLOYER');
 // AccessManager already provides Multicall. execute() checks the original
 // deployer's permissions before calling each Registry; no new admin is granted.
 const operations=transactions.map(({nonce,...operation})=>operation);
 const accessAbi=artifact('AccessManager').abi;
 const batches=[];let batchNonce=runtime.transactions.at(-1).nonce+1;
 const batch=(id,phase,items)=>{
  const calls=items.map(op=>op.to.toLowerCase()===c.AccessManager.toLowerCase()?op.data:encodeFunctionData({abi:accessAbi,functionName:'execute',args:[op.to,op.data]}));
  const data=encodeFunctionData({abi:accessAbi,functionName:'multicall',args:[calls]});
  batches.push({id,phase,chainId:4663,from:runtime.deployer,to:c.AccessManager,value:'0',nonce:batchNonce++,data,inputHash:keccak256(data),operationIds:items.map(op=>op.id),description:'Atomic batch of '+items.length+' individually reviewed operations'});
 };
 const stockOps=operations.filter(op=>op.id.startsWith('register-stock-'));
 const quoteOps=operations.filter(op=>op.id.startsWith('register-quote-'));
 for(let i=0;i<stockOps.length;i+=32)batch('register-stock-batch-'+(i/32+1),'ASSET_ACTIVATION',i===0?[operations[0],...stockOps.slice(i,i+32)]:stockOps.slice(i,i+32));
 for(let i=0;i<quoteOps.length;i+=32)batch('register-quote-batch-'+(i/32+1),'ASSET_ACTIVATION',quoteOps.slice(i,i+32));
 // Template activation, operator setup and admin renunciation are one atomic
 // transaction. No market can launch between these initialization steps.
 batch('activate-template-operators-and-handoff','ATOMIC_ACTIVATION_AND_HANDOFF',operations.filter(op=>op.id==='register-template'||op.phase==='OPERATOR_INITIALIZATION'||access.actions.some((_,i)=>op.id.startsWith('access-'+i+'-'))));
 assert.deepEqual(batches.flatMap(tx=>tx.operationIds),operations.map(op=>op.id));
 return {schemaVersion:1,chainId:4663,releaseId:runtime.releaseId,status:'UNSIGNED_REQUIRES_SIMULATION_AND_REVIEW_NOT_BROADCAST',baselineId,baseline,launchTemplateId,template,stakes,quoteConfigs,access,operations,transactions:batches};
}
