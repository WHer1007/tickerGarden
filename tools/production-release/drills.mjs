import path from 'node:path';
import assert from 'node:assert/strict';
import {decodeFunctionResult} from '../../apps/web/node_modules/viem/_esm/index.js';
import {artifact,write,equal,ZERO,keccak256,toBytes,encodeFunctionData,encodeAbiParameters,parseAbiParameters,parseAbi} from './common.mjs';
import {quantity} from './local-fork.mjs';
export async function runReleaseDrills({runtime,activation,rpc,call,output}){
 const restore=await rpc('evm_snapshot');const c=runtime.components,gov=runtime.configuration.addresses.governance,guardian=runtime.configuration.addresses.pauseGuardian,operator=runtime.configuration.holderSnapshots.publisher;
 const wallet='0x100000000000000000000000000000000000c0fe';
 const abis=new Map();const abi=name=>{if(!abis.has(name))abis.set(name,artifact(name).abi);return abis.get(name);};
 const encode=(name,fn,args)=>encodeFunctionData({abi:abi(name),functionName:fn,args});
 const transact=async(from,to,data,value=0n)=>{
  const req={from,to,data,value:quantity(value)};
  const gas=BigInt(await rpc('eth_estimateGas',[req]))*125n/100n+25000n;assert.ok(gas<32000000n,'drill tx gas');
  const hash=await rpc('eth_sendTransaction',[{...req,gas:quantity(gas)}]);let receipt;
  for(let i=0;i<100;i++){receipt=await rpc('eth_getTransactionReceipt',[hash]);if(receipt)break;await new Promise(r=>setTimeout(r,100));}
  assert.ok(receipt,'drill receipt');equal(receipt.status,'0x1','drill tx');return receipt;
 };
 const mustReject=async promise=>{let rejected=false;try{await promise;}catch(error){if(/revert|Unauthorized|not ready/i.test(error.message))rejected=true;else throw error;}assert.ok(rejected,'unauthorized/early operation must revert');};
 const result={status:'LOCAL_FORK_DRILLS_IN_PROGRESS_NOT_MAINNET_CONTROL_PROOF',releaseId:runtime.releaseId,privateKeysUsed:false,safeSignaturesUsed:false,syntheticFunding:true,transferResults:[],marketPreviews:[]};
 try{
  for(const account of [...new Set([wallet,gov,guardian,operator])]){await rpc('anvil_impersonateAccount',[account]);await rpc('anvil_setBalance',[account,quantity(1000n*10n**18n)]);}
  const governanceCheckpoint=await rpc('evm_snapshot');
  const setKeeper=encode('GraduationExecutor','setCompoundKeeper',[operator]);
  const setPublisher=encode('HolderRewardsDistributorV1','setSnapshotPublisher',[operator]);
  await mustReject(rpc('eth_call',[{from:runtime.deployer,to:runtime.graduationExecutor,data:setKeeper},'latest']));
  await mustReject(rpc('eth_call',[{from:gov,to:runtime.graduationExecutor,data:setKeeper},'latest']));
  await transact(guardian,c.HolderRewardsDistributorV1,encode('HolderRewardsDistributorV1','revokeSnapshotPublisher',[operator]));
  equal(await call('HolderRewardsDistributorV1',c.HolderRewardsDistributorV1,'snapshotPublisher'),ZERO,'guardian immediate revoke');
  await mustReject(rpc('eth_call',[{from:guardian,to:c.HolderRewardsDistributorV1,data:setPublisher},'latest']));
  for(const [target,data] of [[runtime.graduationExecutor,setKeeper],[c.HolderRewardsDistributorV1,setPublisher]])await transact(gov,c.AccessManager,encode('AccessManager','schedule',[target,data,0]));
  const executeKeeper=encode('AccessManager','execute',[runtime.graduationExecutor,setKeeper]);
  await mustReject(rpc('eth_call',[{from:gov,to:c.AccessManager,data:executeKeeper},'latest']));
  await rpc('evm_increaseTime',[172801]);await rpc('evm_mine');
  await transact(gov,c.AccessManager,executeKeeper);
  await transact(gov,c.AccessManager,encode('AccessManager','execute',[c.HolderRewardsDistributorV1,setPublisher]));
  equal(await call('GraduationExecutor',runtime.graduationExecutor,'compoundKeeper'),operator,'48h keeper execution');
  equal(await call('HolderRewardsDistributorV1',c.HolderRewardsDistributorV1,'snapshotPublisher'),operator,'48h publisher restored');
  result.governance={bootstrapRejected:true,governanceDirectRejected:true,earlyExecutionRejected:true,delayedExecutionPassed:true,guardianRevokedPublisher:true,guardianCannotInstallPublisher:true,executionDelaySeconds:172800,scope:'Safe addresses impersonated only on owned local fork; real owner signatures remain external evidence'};
  equal(await rpc('evm_revert',[governanceCheckpoint]),true,'restore pinned time before asset drills');
  write(path.join(output,'release-drills.json'),result);console.log('Governance delay and guardian drills passed');
  const erc20=parseAbi(['function balanceOf(address) view returns(uint256)','function totalSupply() view returns(uint256)','function approve(address,uint256) returns(bool)']);
  const tokenCall=async(token,fn,args=[])=>decodeFunctionResult({abi:erc20,functionName:fn,data:await rpc('eth_call',[{to:token,data:encodeFunctionData({abi:erc20,functionName:fn,args})},'latest'])});
  // Verified RH Stock implementation uses ERC-7201 OpenZeppelin ERC20 storage.
  // Only this isolated drill snapshot receives synthetic balances and supply.
  const storageBase=0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00n;
  const amount=5n*10n**17n;
  for(const a of activation.stakes){
   equal(await tokenCall(a.tokenAddress,'balanceOf',[wallet]),0,a.symbol+' initial synthetic account');
   const balanceSlot=keccak256(encodeAbiParameters(parseAbiParameters('address,uint256'),[wallet,storageBase]));
   const supply=await tokenCall(a.tokenAddress,'totalSupply');
   await rpc('anvil_setStorageAt',[a.tokenAddress,balanceSlot,'0x'+amount.toString(16).padStart(64,'0')]);
   await rpc('anvil_setStorageAt',[a.tokenAddress,'0x'+(storageBase+2n).toString(16).padStart(64,'0'),'0x'+(supply+amount).toString(16).padStart(64,'0')]);
   equal(await tokenCall(a.tokenAddress,'balanceOf',[wallet]),amount,a.symbol+' synthetic funding');
   equal(await tokenCall(a.tokenAddress,'totalSupply'),supply+amount,a.symbol+' synthetic supply');
   await transact(wallet,a.tokenAddress,encodeFunctionData({abi:erc20,functionName:'approve',args:[c.UserStockVault,amount]}));
   const deposit=await transact(wallet,c.UserStockVault,encode('UserStockVault','depositStock',[a.assetUid,amount]));
   equal(await tokenCall(a.tokenAddress,'balanceOf',[wallet]),0,a.symbol+' depositor debited');
   equal(await tokenCall(a.tokenAddress,'balanceOf',[c.UserStockVault]),amount,a.symbol+' Vault received exact');
   equal(await call('UserStockVault',c.UserStockVault,'freeBalanceOf',[a.assetUid,wallet]),amount,a.symbol+' free balance');
   const withdrawal=await transact(wallet,c.UserStockVault,encode('UserStockVault','withdrawFreeStock',[a.assetUid,amount]));
   equal(await tokenCall(a.tokenAddress,'balanceOf',[wallet]),amount,a.symbol+' user returned exact');
   equal(await tokenCall(a.tokenAddress,'balanceOf',[c.UserStockVault]),0,a.symbol+' Vault cleared');
   equal(await call('UserStockVault',c.UserStockVault,'totalDeposited',[a.assetUid]),0,a.symbol+' deposited cleared');
   result.transferResults.push({symbol:a.symbol,assetUid:a.assetUid,amount:amount.toString(),exactDepositAndWithdrawal:true,depositGas:BigInt(deposit.gasUsed).toString(),withdrawalGas:BigInt(withdrawal.gasUsed).toString()});
   if(result.transferResults.length%25===0){write(path.join(output,'release-drills.json'),result);console.log('Exact Stock Vault deposit/withdraw '+result.transferResults.length+'/194');}
  }
  for(const [index,q] of activation.quoteConfigs.entries()){
   const stake=activation.stakes.find(a=>a.tokenAddress.toLowerCase()===q.value.quoteAsset.toLowerCase())??activation.stakes[0];
   const params={assetUid:stake.assetUid,tickerGardenBaselineId:activation.baselineId,quoteAssetConfigId:q.configId,launchTemplateId:activation.launchTemplateId,expectedEconomics:'0x'+'0'.repeat(64),creatorRevenueBeneficiary:wallet,name:'Local release drill '+q.symbol,symbol:'DRILL',metadataURI:'ipfs://local-release-drill',salt:keccak256(toBytes('local-only-'+index)),creatorTaxBps:0,creatorFeesToHolders:false,stakingEnabled:true,burnMemeFees:false,lpFeePips:3000};
   params.expectedEconomics=await call('TickerGardenFactoryV1',runtime.factory,'previewMarketEconomics',[params],wallet);
   const predicted=await call('TickerGardenFactoryV1',runtime.factory,'predictMarketAddresses',[wallet,params],wallet);
   result.marketPreviews.push({symbol:q.symbol,quoteConfigId:q.configId,stakeUid:stake.assetUid,economicsHash:params.expectedEconomics,marketId:predicted[0]});
   if(['ETH','USDG','CRM'].includes(q.symbol)){
    const receipt=await transact(wallet,runtime.factory,encode('TickerGardenFactoryV1','createMarket',[params]),500000000000000n);
    assert.ok((await rpc('eth_getCode',[predicted[1],'latest'])).length>2,'market token deployed');
    result.marketPreviews.at(-1).creationGas=BigInt(receipt.gasUsed).toString();
   }
  }
  result.status='LOCAL_FORK_DRILLS_PASSED_NOT_MAINNET_CONTROL_PROOF';write(path.join(output,'release-drills.json'),result);console.log('Release drills passed: 194 exact transfers, 196 launch previews, 3 market creations');
 }catch(error){result.failure=error.message;write(path.join(output,'release-drills.json'),result);throw error;}finally{equal(await rpc('evm_revert',[restore]),true,'restore initialization-only state');}
 return result;
}
