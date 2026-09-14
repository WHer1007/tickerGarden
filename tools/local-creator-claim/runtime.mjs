import fs from 'node:fs';
import path from 'node:path';
import {
  createPublicClient, createWalletClient, decodeEventLog, encodeFunctionData, http, keccak256, parseEther,
} from '../../apps/web/node_modules/viem/_esm/index.js';
import {mnemonicToAccount, privateKeyToAccount} from '../../apps/web/node_modules/viem/_esm/accounts/index.js';

const root=path.resolve(path.dirname(new URL(import.meta.url).pathname),'../..');
const rpc=process.env.TG_LOCAL_CREATOR_RPC_URL||'http://127.0.0.1:18678';
const deployerKey=process.env.LOCAL_DEPLOYER_PRIVATE_KEY||`0x${'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'}`;
const creatorKey=process.env.LOCAL_CREATOR_PRIVATE_KEY||`0x${'59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'}`;
const client=createPublicClient({transport:http(rpc)});
const account=privateKeyToAccount(deployerKey);
const wallet=createWalletClient({account,transport:http(rpc)});
const creator=privateKeyToAccount(creatorKey);
const creatorWallet=createWalletClient({account:creator,transport:http(rpc)});
const staker=mnemonicToAccount('test test test test test test test test test test test junk',{addressIndex:2});
const stakerWallet=createWalletClient({account:staker,transport:http(rpc)});
const holder=mnemonicToAccount('test test test test test test test test test test test junk',{addressIndex:3});
const holderPrivateKey=`0x${Buffer.from(holder.getHdKey().privateKey).toString('hex')}`;
const artifact=name=>JSON.parse(fs.readFileSync(path.join(root,`contracts/out/${name}.sol/${name}.json`)));
const localArtifact=name=>JSON.parse(fs.readFileSync(path.join(root,`contracts/out/LocalCreatorClaim.s.sol/${name}.json`)));
const runtimePath=path.join(root,'.codex_tmp/local-creator-claim/runtime.json');
const bootstrapPath=path.join(root,'apps/web/public/integration/local-creator-claim.json');
const lower=value=>String(value).toLowerCase();
const releaseId=keccak256(new TextEncoder().encode('TICKERGARDEN_LOCAL_CREATOR_CLAIM_V1'));
const baselineId=keccak256(new TextEncoder().encode('TICKERGARDEN_LOCAL_BASELINE'));
const templateId=keccak256(new TextEncoder().encode('TICKERGARDEN_LOCAL_TEMPLATE'));
const executionSpecId=keccak256(new TextEncoder().encode('V1-EXEC-11'));
const feePolicyId=keccak256(new TextEncoder().encode('TICKERGARDEN_V1_FEE_POLICY_40_30_30'));
const canonicalPermit2='0x000000000022d473030f116ddee9f6b43ac78ba3';
const canonicalRouter='0x8876789976decbfcbbbe364623c63652db8c0904';
const canonicalQuoter='0x8dc178efb8111bb0973dd9d722ebeff267c98f94';
function readBroadcast(){return JSON.parse(fs.readFileSync(path.join(root,'contracts/broadcast/LocalCreatorClaim.s.sol/46630/run-latest.json')));}
function created(broadcast,name){const i=broadcast.transactions.findIndex(x=>x.contractName===name&&x.transactionType==='CREATE');if(i<0)throw Error(`Missing ${name} deployment`);return lower(broadcast.receipts[i].contractAddress);}
const source=(receipt)=>({chainId:46630,blockNumber:String(BigInt(receipt.blockNumber)),blockHash:lower(receipt.blockHash),transactionHash:lower(receipt.transactionHash),transactionIndex:0,logIndex:0});
const jsonValue=value=>typeof value==='bigint'?value.toString():Array.isArray(value)?value.map(jsonValue):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>Number.isNaN(Number(key))).map(([key,item])=>[key,jsonValue(item)])):value;

async function materialize(){
  if(await client.getChainId()!==46630)throw Error('Local Creator node must use chain 46630');
  const broadcast=readBroadcast();
  const orchestrator=created(broadcast,'V1DeterministicDeploymentOrchestrator');
  const poolManager=created(broadcast,'LocalPoolManager');
  const localPermit2=created(broadcast,'LocalPermit2');
  const localSwapBoundary=created(broadcast,'LocalSwapBoundary');
  const platformTreasury=created(broadcast,'LocalTreasury');
  const orchAbi=artifact('V1DeterministicDeploymentOrchestrator').abi;
  const [factory,hook,components]=await Promise.all([
    client.readContract({address:orchestrator,abi:orchAbi,functionName:'factory'}),
    client.readContract({address:orchestrator,abi:orchAbi,functionName:'hook'}),
    client.readContract({address:orchestrator,abi:orchAbi,functionName:'ordinaryComponents'}),
  ]);
  const permit2Code=localArtifact('LocalPermit2').deployedBytecode.object;
  const boundaryCode=await client.getCode({address:localSwapBoundary});
  if(!permit2Code||!boundaryCode)throw Error('Local trading boundary bytecode missing');
  await client.request({method:'anvil_setCode',params:[canonicalPermit2,permit2Code]});
  await client.request({method:'anvil_setCode',params:[canonicalRouter,boundaryCode]});
  await client.request({method:'anvil_setCode',params:[canonicalQuoter,boundaryCode]});
  const baselineReceipt=broadcast.receipts[8],quoteReceipt=broadcast.receipts[9],templateReceipt=broadcast.receipts[10];
  const quoteAbi=artifact('ApprovedQuoteRegistry').abi;
  const quoteEvents=(await client.getLogs({address:components[2],fromBlock:BigInt(quoteReceipt.blockNumber),toBlock:BigInt(quoteReceipt.blockNumber)}));
  let localQuoteId;
  for(const log of quoteEvents){try{const event=decodeEventLog({abi:quoteAbi,topics:log.topics,data:log.data});if(event.eventName==='QuoteAssetConfigAdded')localQuoteId=event.args.configId;}catch{}}
  if(!localQuoteId)throw Error('Local quote activation event missing');
  const [baseline,quote,template]=await Promise.all([
    client.readContract({address:components[3],abi:artifact('TickerGardenBaselineRegistry').abi,functionName:'baseline',args:[baselineId]}),
    client.readContract({address:components[2],abi:quoteAbi,functionName:'quoteConfig',args:[localQuoteId]}),
    client.readContract({address:components[4],abi:artifact('LaunchTemplateRegistry').abi,functionName:'launchTemplate',args:[templateId]}),
  ]);
  const bindings={officialStockRegistry:lower(components[1]),approvedQuoteRegistry:lower(components[2]),tickerGardenBaselineRegistry:lower(components[3]),launchTemplateRegistry:lower(components[4]),marketRegistry:lower(components[10]),protocolFeeVault:lower(components[15]),allocationManager:lower(components[12]),launchRouter:lower(components[9])};
  const config=(kind,id,values,evidence)=>({kind,id:lower(id),status:1,values:{...jsonValue(values),...(kind==='quote'?{symbol:'ETH'}:{})},source:evidence});
  const bootstrap={version:1,chainId:46630,releaseId:lower(releaseId),status:'DEPLOYED_VERIFIED_ACTIVE_TEST_ONLY',factory:lower(factory),bindings,configs:[config('quote',localQuoteId,quote,source(quoteReceipt)),config('baseline',baselineId,baseline,source(baselineReceipt)),config('template',templateId,template,source(templateReceipt))],assets:[],initialMarkets:[],launchFee:'500000000000000'};
  fs.mkdirSync(path.dirname(runtimePath),{recursive:true});
  fs.writeFileSync(bootstrapPath,JSON.stringify(bootstrap,null,2)+'\n');
  const runtime={rpc,chainId:46630,creator:{address:'0x70997970c51812dc3a010c7d01b50e0d17dc79c8'},deployer:lower(account.address),factory:lower(factory),hook:lower(hook),poolManager,localSwapBoundary,canonicalPermit2,canonicalRouter,canonicalQuoter,platformTreasury,holderDistributor:lower(components[14]),creatorRegistry:lower(components[11]),feeVault:lower(components[15]),marketRegistry:lower(components[10]),launchRouter:lower(components[9]),allocationManager:lower(components[12]),releaseId:lower(releaseId),baselineId:lower(baselineId),quoteId:lower(localQuoteId),templateId:lower(templateId),bootstrap:'/integration/local-creator-claim.json'};
  fs.writeFileSync(runtimePath,JSON.stringify(runtime,null,2)+'\n');
  console.log(JSON.stringify(runtime,null,2));
}

async function markets(runtime){
  const factoryAbi=artifact('TickerGardenFactoryV1').abi;
  const logs=await client.getLogs({address:runtime.factory,fromBlock:0n,toBlock:'latest'});
  const out=[];
  for(const log of logs){try{const event=decodeEventLog({abi:factoryAbi,topics:log.topics,data:log.data});if(event.eventName==='MarketCreated')out.push({marketId:lower(event.args.marketId),memeToken:lower(event.args.memeToken),curve:lower(event.args.curve),gauge:lower(event.args.gauge),transactionHash:log.transactionHash});}catch{}}
  return out;
}

async function status(){const runtime=JSON.parse(fs.readFileSync(runtimePath));console.log(JSON.stringify({...runtime,markets:await markets(runtime)},null,2));}

async function prepareStaker(){
  const runtime=JSON.parse(fs.readFileSync(runtimePath));
  if(runtime.stakerScenario){console.log(JSON.stringify(runtime.stakerScenario,null,2));return;}
  const snapshot=await client.request({method:'evm_snapshot'});
  try{
    const assetUid='0x00000000000000000000000000000000aa1fee9afa45465cbc65157b4edf63f5';
    const stockToken='0xc9f9c86933092bbbfff3ccb4b105a4a94bf3bd4e';
    const stock=localArtifact('LocalStakingStock');
    const deployHash=await wallet.deployContract({account,abi:stock.abi,bytecode:stock.bytecode.object});
    const deployReceipt=await client.waitForTransactionReceipt({hash:deployHash});
    if(deployReceipt.status!=='success'||!deployReceipt.contractAddress)throw Error('Local STOCK fixture deployment reverted');
    const runtimeCode=await client.getCode({address:deployReceipt.contractAddress});
    if(!runtimeCode)throw Error('Local STOCK runtime missing');
    await client.request({method:'anvil_setCode',params:[stockToken,runtimeCode]});
    const stockCode=await client.getCode({address:stockToken});if(!stockCode)throw Error('Local STOCK address has no code');

    const mintHash=await wallet.writeContract({account,address:stockToken,abi:stock.abi,functionName:'mint',args:[staker.address,parseEther('1000')]});
    if((await client.waitForTransactionReceipt({hash:mintHash})).status!=='success')throw Error('Local STOCK mint reverted');

    const registryAbi=artifact('OfficialStockRegistryV1').abi;
    const factoryAbi=artifact('TickerGardenFactoryV1').abi;
    const factoryBindings=await client.readContract({address:runtime.factory,abi:factoryAbi,functionName:'runtimeBindings'});
    const registryAddress=factoryBindings[0];
    const orchestrator=created(readBroadcast(),'V1DeterministicDeploymentOrchestrator');
    const components=await client.readContract({address:orchestrator,abi:artifact('V1DeterministicDeploymentOrchestrator').abi,functionName:'ordinaryComponents'});
    const vaultAddress=components[13];
    const codeHash=keccak256(stockCode);
    const fingerprint={tokenRuntimeCodeHash:codeHash,beacon:'0x0000000000000000000000000000000000000000',beaconRuntimeCodeHash:`0x${'0'.repeat(64)}`,implementation:stockToken,implementationRuntimeCodeHash:codeHash};
    const registerHash=await wallet.writeContract({account,address:registryAddress,abi:registryAbi,functionName:'registerAsset',args:[assetUid,stockToken,18,vaultAddress,parseEther('1'),fingerprint]});
    const registerReceipt=await client.waitForTransactionReceipt({hash:registerHash});if(registerReceipt.status!=='success')throw Error('Local STOCK registration reverted');

    const params={assetUid,tickerGardenBaselineId:runtime.baselineId,quoteAssetConfigId:runtime.quoteId,launchTemplateId:runtime.templateId,expectedEconomics:`0x${'0'.repeat(64)}`,creatorRevenueBeneficiary:creator.address,name:'Staker Claim Test',symbol:'STKCLAIM',metadataURI:'ipfs://ticker-garden-local-staker-claim',salt:keccak256(new TextEncoder().encode(`staker-claim-${Date.now()}`)),creatorTaxBps:300,creatorFeesToHolders:false,stakingEnabled:true,burnMemeFees:false,lpFeePips:2000};
    params.expectedEconomics=await client.readContract({account:creator.address,address:runtime.factory,abi:factoryAbi,functionName:'previewMarketEconomics',args:[params]});
    const createHash=await creatorWallet.writeContract({account:creator,address:runtime.factory,abi:factoryAbi,functionName:'createMarket',args:[params],value:500000000000000n});
    const createReceipt=await client.waitForTransactionReceipt({hash:createHash});if(createReceipt.status!=='success')throw Error('Staker market creation reverted');
    let marketId,memeToken,gauge;
    for(const log of createReceipt.logs){try{const event=decodeEventLog({abi:factoryAbi,topics:log.topics,data:log.data});if(event.eventName==='MarketCreated'){marketId=lower(event.args.marketId);memeToken=lower(event.args.memeToken);gauge=lower(event.args.gauge);}}catch{}}
    if(!marketId||!memeToken||!gauge)throw Error('Staker MarketCreated receipt missing');

    const marketAbi=artifact('MarketRegistryV1').abi,curveAbi=artifact('TickerGardenCurve').abi;
    let market=await client.readContract({address:runtime.marketRegistry,abi:marketAbi,functionName:'market',args:[marketId]});
    await client.request({method:'evm_increaseTime',params:[6]});await client.request({method:'evm_mine'});
    const graduateHash=await wallet.writeContract({account,address:market.config.curve,abi:curveAbi,functionName:'buy',args:[parseEther('5'),0n,account.address],value:parseEther('5')});
    if((await client.waitForTransactionReceipt({hash:graduateHash})).status!=='success')throw Error('Staker market graduation reverted');
    market=await client.readContract({address:runtime.marketRegistry,abi:marketAbi,functionName:'market',args:[marketId]});
    if(Number(market.runtime.launchPhase)!==1)throw Error('Staker market did not graduate');

    const approvalHash=await stakerWallet.writeContract({account:staker,address:stockToken,abi:stock.abi,functionName:'approve',args:[vaultAddress,parseEther('100')]});
    if((await client.waitForTransactionReceipt({hash:approvalHash})).status!=='success')throw Error('Staker STOCK approval reverted');
    const allocationAbi=artifact('AllocationManager').abi;
    const stakeHash=await stakerWallet.writeContract({account:staker,address:runtime.allocationManager,abi:allocationAbi,functionName:'stake',args:[marketId,parseEther('100')]});
    if((await client.waitForTransactionReceipt({hash:stakeHash})).status!=='success')throw Error('Local stake reverted');
    await client.request({method:'evm_increaseTime',params:[31]});await client.request({method:'evm_mine'});
    const checkpointHash=await wallet.writeContract({account,address:gauge,abi:artifact('MemeStockGauge').abi,functionName:'checkpointActivations'});
    if((await client.waitForTransactionReceipt({hash:checkpointHash})).status!=='success')throw Error('Stake activation reverted');

    const route=await client.readContract({address:runtime.marketRegistry,abi:marketAbi,functionName:'canonicalRoute',args:[marketId]});
    const poolAbi=localArtifact('LocalPoolManager').abi;
    const accrualHashes=[];
    for(const item of [{asset:market.config.quoteAsset,base:parseEther('1')},{asset:market.config.memeToken,base:parseEther('1000')}]){
      const hash=await wallet.writeContract({account,address:runtime.poolManager,abi:poolAbi,functionName:'accrue',args:[runtime.hook,route.poolKey,item.asset,item.base]});
      if((await client.waitForTransactionReceipt({hash})).status!=='success')throw Error('Staker fee accrual reverted');accrualHashes.push(hash);
    }
    await client.request({method:'evm_increaseTime',params:[86401]});await client.request({method:'evm_mine'});
    const position=await client.readContract({address:gauge,abi:artifact('MemeStockGauge').abi,functionName:'positionOf',args:[staker.address]});
    const allocated=position.activeAmount+position.pendingAmount;
    if(allocated!==parseEther('100')||position.quoteClaimable<=0n||position.memeClaimable<=0n){
      const observed=JSON.stringify(position,(_,value)=>typeof value==='bigint'?value.toString():value);
      throw Error(`Prepared staker rewards are not claimable: ${observed}`);
    }

    const assetSource=source(registerReceipt);
    const bootstrap=JSON.parse(fs.readFileSync(bootstrapPath));
    bootstrap.assets=[{kind:'asset',id:assetUid,status:1,values:{stockToken,userStockVault:lower(vaultAddress),tokenDecimals:18,minimumAllocation:parseEther('1').toString(),tokenSymbol:'TSLA',tokenName:'Local Tesla Test Stock'},source:assetSource}];
    fs.writeFileSync(bootstrapPath,JSON.stringify(bootstrap,null,2)+'\n');
    const scenario={ready:true,network:{rpc,chainId:46630},staker:{address:lower(staker.address),privateKey:'0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'},creator:runtime.creator,asset:{assetUid,stockToken,symbol:'TSLA',balance:parseEther('900').toString(),staked:allocated.toString(),active:position.activeAmount.toString(),pendingMaterialization:position.pendingAmount.toString()},market:{marketId,memeToken,gauge,phase:1},claimable:{quote:position.quoteClaimable.toString(),token:position.memeClaimable.toString()},transactions:{register:registerHash,create:createHash,graduate:graduateHash,approve:approvalHash,stake:stakeHash,checkpoint:checkpointHash,accrue:accrualHashes},unlocked:true,claimUrl:`http://127.0.0.1:5179/stake?marketId=${marketId}#positions`};
    runtime.stakerScenario=scenario;fs.writeFileSync(runtimePath,JSON.stringify(runtime,null,2)+'\n');
    console.log(JSON.stringify(scenario,null,2));
  }catch(error){await client.request({method:'evm_revert',params:[snapshot]});throw error;}
}

async function prepareHolder(){
  const runtime=JSON.parse(fs.readFileSync(runtimePath));
  const holderAbi=artifact('HolderRewardsDistributorV1').abi;
  if(runtime.holderScenario){
    runtime.holderScenario.holder.privateKey=holderPrivateKey;
    fs.writeFileSync(runtimePath,JSON.stringify(runtime,null,2)+'\n');
    const claimed=await client.readContract({address:runtime.holderDistributor,abi:holderAbi,functionName:'claimedAssets',args:[runtime.holderScenario.market.marketId,BigInt(runtime.holderScenario.round.round),holder.address]});
    console.log(JSON.stringify({...runtime.holderScenario,claimedAssets:Number(claimed)},null,2));
    return;
  }
  const snapshot=await client.request({method:'evm_snapshot'});
  try{
    const factoryAbi=artifact('TickerGardenFactoryV1').abi;
    const zero32=`0x${'0'.repeat(64)}`;
    const params={
      assetUid:zero32,tickerGardenBaselineId:runtime.baselineId,quoteAssetConfigId:runtime.quoteId,
      launchTemplateId:runtime.templateId,expectedEconomics:zero32,creatorRevenueBeneficiary:creator.address,
      name:'Holder Claim Test',symbol:'HLDCLAIM',metadataURI:'ipfs://ticker-garden-local-holder-claim',
      salt:keccak256(new TextEncoder().encode(`holder-claim-${Date.now()}`)),creatorTaxBps:300,
      creatorFeesToHolders:true,stakingEnabled:false,burnMemeFees:false,lpFeePips:2000,
    };
    params.expectedEconomics=await client.readContract({account:creator.address,address:runtime.factory,abi:factoryAbi,functionName:'previewMarketEconomics',args:[params]});
    const createHash=await creatorWallet.writeContract({account:creator,address:runtime.factory,abi:factoryAbi,functionName:'createMarket',args:[params],value:500000000000000n});
    const createReceipt=await client.waitForTransactionReceipt({hash:createHash});if(createReceipt.status!=='success')throw Error('Holder market creation reverted');
    let marketId,memeToken;
    for(const log of createReceipt.logs){try{const event=decodeEventLog({abi:factoryAbi,topics:log.topics,data:log.data});if(event.eventName==='MarketCreated'){marketId=lower(event.args.marketId);memeToken=lower(event.args.memeToken);}}catch{}}
    if(!marketId||!memeToken)throw Error('Holder MarketCreated receipt missing');

    const marketAbi=artifact('MarketRegistryV1').abi,curveAbi=artifact('TickerGardenCurve').abi,tokenAbi=artifact('TickerMemeTokenV1').abi;
    let market=await client.readContract({address:runtime.marketRegistry,abi:marketAbi,functionName:'market',args:[marketId]});
    await client.request({method:'evm_increaseTime',params:[6]});await client.request({method:'evm_mine'});
    const graduateHash=await wallet.writeContract({account,address:market.config.curve,abi:curveAbi,functionName:'buy',args:[parseEther('5'),0n,account.address],value:parseEther('5')});
    if((await client.waitForTransactionReceipt({hash:graduateHash})).status!=='success')throw Error('Holder market graduation reverted');
    market=await client.readContract({address:runtime.marketRegistry,abi:marketAbi,functionName:'market',args:[marketId]});
    if(Number(market.runtime.launchPhase)!==1)throw Error('Holder market did not graduate');
    const acquired=await client.readContract({address:memeToken,abi:tokenAbi,functionName:'balanceOf',args:[account.address]});
    if(acquired===0n)throw Error('Graduation buyer received no Holder test tokens');
    const transferHash=await wallet.writeContract({account,address:memeToken,abi:tokenAbi,functionName:'transfer',args:[holder.address,acquired]});
    if((await client.waitForTransactionReceipt({hash:transferHash})).status!=='success')throw Error('Holder token transfer reverted');

    const route=await client.readContract({address:runtime.marketRegistry,abi:marketAbi,functionName:'canonicalRoute',args:[marketId]});
    const poolAbi=localArtifact('LocalPoolManager').abi,accrualHashes=[];
    for(const item of [{asset:market.config.quoteAsset,base:parseEther('1')},{asset:market.config.memeToken,base:parseEther('1000')}]){
      const hash=await wallet.writeContract({account,address:runtime.poolManager,abi:poolAbi,functionName:'accrue',args:[runtime.hook,route.poolKey,item.asset,item.base]});
      if((await client.waitForTransactionReceipt({hash})).status!=='success')throw Error('Holder fee accrual reverted');accrualHashes.push(hash);
    }
    const vaultAbi=artifact('ProtocolFeeVault').abi;
    const liabilities=await Promise.all([market.config.quoteAsset,market.config.memeToken].map(asset=>client.readContract({address:runtime.feeVault,abi:vaultAbi,functionName:'holderLiability',args:[marketId,1,asset]})));
    if(liabilities.some(value=>value===0n))throw Error(`Holder liabilities were not accrued: ${liabilities.join(',')}`);
    const fundQuoteHash=await wallet.writeContract({account,address:runtime.feeVault,abi:vaultAbi,functionName:'fundHolderRewards',args:[marketId,1]});
    if((await client.waitForTransactionReceipt({hash:fundQuoteHash})).status!=='success')throw Error('Holder Quote funding reverted');
    const fundTokenHash=await wallet.writeContract({account,address:runtime.feeVault,abi:vaultAbi,functionName:'fundHolderMemeRewards',args:[marketId]});
    if((await client.waitForTransactionReceipt({hash:fundTokenHash})).status!=='success')throw Error('Holder Token funding reverted');

    const currentPublisher=await client.readContract({address:runtime.holderDistributor,abi:holderAbi,functionName:'snapshotPublisher'});
    let publisherHash=null;
    if(lower(currentPublisher)!==lower(account.address)){
      publisherHash=await wallet.writeContract({account,address:runtime.holderDistributor,abi:holderAbi,functionName:'setSnapshotPublisher',args:[account.address]});
      if((await client.waitForTransactionReceipt({hash:publisherHash})).status!=='success')throw Error('Snapshot publisher configuration reverted');
    }
    const snapshotHead=await client.getBlock();
    const round=1n,quoteAmount=liabilities[0],tokenAmount=liabilities[1];
    const rootHash=await client.readContract({address:runtime.holderDistributor,abi:holderAbi,functionName:'claimLeaf',args:[marketId,round,holder.address,quoteAmount,tokenAmount]});
    const dataHash=keccak256(new TextEncoder().encode(JSON.stringify({marketId,round:String(round),snapshotBlock:String(snapshotHead.number),account:lower(holder.address),quoteAmount:String(quoteAmount),tokenAmount:String(tokenAmount)})));
    // Anvil's chain-46630 ArbSys placeholder cannot serve arbBlockHash. Keep the
    // snapshot outside the contract's 256-block recent-hash window, matching the
    // repository's dedicated local publication fixture.
    await client.request({method:'anvil_mine',params:['0x101']});
    const publication={marketId,round,snapshotBlock:snapshotHead.number,snapshotBlockHash:snapshotHead.hash,root:rootHash,dataHash,quoteBudget:quoteAmount,memeBudget:tokenAmount};
    const publishHash=await wallet.writeContract({account,address:runtime.holderDistributor,abi:holderAbi,functionName:'publishSnapshots',args:[[publication]]});
    if((await client.waitForTransactionReceipt({hash:publishHash})).status!=='success')throw Error('Holder snapshot publication reverted');
    const live=await client.readContract({address:runtime.holderDistributor,abi:holderAbi,functionName:'roundState',args:[marketId,round]});
    if(live.root!==rootHash||live.quoteRemaining!==quoteAmount||live.memeRemaining!==tokenAmount)throw Error('Published Holder round does not match prepared data');
    const scenario={ready:true,network:{rpc,chainId:46630},holder:{address:lower(holder.address),privateKey:holderPrivateKey},creator:runtime.creator,
      market:{marketId,memeToken,name:'Holder Claim Test',symbol:'HLDCLAIM',phase:1},balance:{token:acquired.toString()},
      round:{round:round.toString(),snapshotBlock:snapshotHead.number.toString(),snapshotBlockHash:lower(snapshotHead.hash),root:lower(rootHash),dataHash:lower(dataHash),quoteAmount:quoteAmount.toString(),tokenAmount:tokenAmount.toString(),proof:[]},
      transactions:{create:createHash,graduate:graduateHash,transfer:transferHash,accrue:accrualHashes,fundQuote:fundQuoteHash,fundToken:fundTokenHash,setPublisher:publisherHash,publish:publishHash},
      claimUrl:`http://127.0.0.1:5179/claim?marketId=${marketId}#holder`};
    runtime.holderScenario=scenario;fs.writeFileSync(runtimePath,JSON.stringify(runtime,null,2)+'\n');
    console.log(JSON.stringify({...scenario,claimedAssets:0},null,2));
  }catch(error){await client.request({method:'evm_revert',params:[snapshot]});throw error;}
}

async function accrue(){
  const runtime=JSON.parse(fs.readFileSync(runtimePath));
  const rows=await markets(runtime);const selected=process.argv[3]||rows.at(-1)?.marketId;if(!selected)throw Error('Create a market first');
  const marketAbi=artifact('MarketRegistryV1').abi,curveAbi=artifact('TickerGardenCurve').abi;
  let market=await client.readContract({address:runtime.marketRegistry,abi:marketAbi,functionName:'market',args:[selected]});
  if(Number(market.runtime.launchPhase)===0){
    // Keep the helper deterministic: an immediate non-creator buy is subject to the
    // launch anti-snipe fee and may intentionally leave the curve incomplete.
    await client.request({method:'evm_increaseTime',params:[6]});
    await client.request({method:'evm_mine'});
    const hash=await wallet.writeContract({account,address:market.config.curve,abi:curveAbi,functionName:'buy',args:[parseEther('5'),0n,account.address],value:parseEther('5')});
    const receipt=await client.waitForTransactionReceipt({hash});if(receipt.status!=='success')throw Error('Local graduation reverted');
    market=await client.readContract({address:runtime.marketRegistry,abi:marketAbi,functionName:'market',args:[selected]});
  }
  if(Number(market.runtime.launchPhase)!==1)throw Error('Market did not graduate');
  const route=await client.readContract({address:runtime.marketRegistry,abi:marketAbi,functionName:'canonicalRoute',args:[selected]});
  const poolAbi=localArtifact('LocalPoolManager').abi;
  const calls=[{asset:market.config.quoteAsset,base:parseEther('1')},{asset:market.config.memeToken,base:parseEther('1000')}];
  const receipts=[];
  for(const item of calls){const hash=await wallet.writeContract({account,address:runtime.poolManager,abi:poolAbi,functionName:'accrue',args:[runtime.hook,route.poolKey,item.asset,item.base]});const receipt=await client.waitForTransactionReceipt({hash});if(receipt.status!=='success')throw Error(`Fee accrual reverted for ${item.asset}`);receipts.push(hash);}
  const vaultAbi=artifact('ProtocolFeeVault').abi;
  const [quote,meme]=await Promise.all([market.config.quoteAsset,market.config.memeToken].map(asset=>client.readContract({address:runtime.feeVault,abi:vaultAbi,functionName:'creatorLiability',args:[selected,1,asset]})));
  console.log(JSON.stringify({marketId:selected,memeToken:lower(market.config.memeToken),phase:Number(market.runtime.launchPhase),transactions:receipts,creatorLiability:{quote:quote.toString(),meme:meme.toString()}},null,2));
}

async function smoke(){
  const runtime=JSON.parse(fs.readFileSync(runtimePath));
  const snapshot=await client.request({method:'evm_snapshot'});
  try {
    const factoryAbi=artifact('TickerGardenFactoryV1').abi;
    const zero32=`0x${'0'.repeat(64)}`;
    const params={
      assetUid:zero32,
      tickerGardenBaselineId:runtime.baselineId,
      quoteAssetConfigId:runtime.quoteId,
      launchTemplateId:runtime.templateId,
      expectedEconomics:zero32,
      creatorRevenueBeneficiary:creator.address,
      name:'Creator Claim Smoke',
      symbol:'CCS',
      metadataURI:'ipfs://ticker-garden-local-creator-claim-smoke',
      salt:keccak256(new TextEncoder().encode(`creator-claim-smoke-${Date.now()}`)),
      creatorTaxBps:300,
      creatorFeesToHolders:false,
      stakingEnabled:false,
      burnMemeFees:false,
      lpFeePips:2000,
    };
    params.expectedEconomics=await client.readContract({account:creator.address,address:runtime.factory,abi:factoryAbi,functionName:'previewMarketEconomics',args:[params]});
    const createHash=await creatorWallet.writeContract({account:creator,address:runtime.factory,abi:factoryAbi,functionName:'createMarket',args:[params],value:500000000000000n});
    const createReceipt=await client.waitForTransactionReceipt({hash:createHash});
    if(createReceipt.status!=='success')throw Error('Creator market creation reverted');
    let createdMarket;
    for(const log of createReceipt.logs){try{const event=decodeEventLog({abi:factoryAbi,topics:log.topics,data:log.data});if(event.eventName==='MarketCreated')createdMarket={marketId:lower(event.args.marketId),memeToken:lower(event.args.memeToken)};}catch{}}
    if(!createdMarket)throw Error('MarketCreated receipt missing');
    process.argv[3]=createdMarket.marketId;
    await accrue();
    const vaultAbi=artifact('ProtocolFeeVault').abi;
    const tokenAbi=artifact('TickerMemeTokenV1').abi;
    const marketAbi=artifact('MarketRegistryV1').abi;
    const record=await client.readContract({address:runtime.marketRegistry,abi:marketAbi,functionName:'market',args:[createdMarket.marketId]});
    const before={quote:await client.getBalance({address:creator.address}),meme:await client.readContract({address:createdMarket.memeToken,abi:tokenAbi,functionName:'balanceOf',args:[creator.address]})};
    const claimHash=await creatorWallet.writeContract({account:creator,address:runtime.feeVault,abi:vaultAbi,functionName:'claimUserRewards',args:[createdMarket.marketId,0,1]});
    const claimReceipt=await client.waitForTransactionReceipt({hash:claimHash});
    if(claimReceipt.status!=='success')throw Error('Creator reward claim reverted');
    const after={quote:await client.getBalance({address:creator.address}),meme:await client.readContract({address:createdMarket.memeToken,abi:tokenAbi,functionName:'balanceOf',args:[creator.address]})};
    const [quoteRemaining,memeRemaining]=await Promise.all([record.config.quoteAsset,record.config.memeToken].map(asset=>client.readContract({address:runtime.feeVault,abi:vaultAbi,functionName:'creatorLiability',args:[createdMarket.marketId,1,asset]})));
    if(after.meme<=before.meme||quoteRemaining!==0n||memeRemaining!==0n)throw Error('Creator dual-asset claim accounting did not close');
    console.log(JSON.stringify({ok:true,marketId:createdMarket.marketId,createTransaction:createHash,claimTransaction:claimHash,creatorMemeReceived:(after.meme-before.meme).toString(),creatorQuoteBalanceBefore:before.quote.toString(),creatorQuoteBalanceAfterGas:after.quote.toString(),liabilityAfterClaim:{quote:quoteRemaining.toString(),meme:memeRemaining.toString()}},null,2));
  } finally {
    const reverted=await client.request({method:'evm_revert',params:[snapshot]});
    if(!reverted)throw Error('Could not restore clean local chain after smoke test');
  }
}

const command=process.argv[2]||'status';
if(command==='materialize')await materialize();else if(command==='status')await status();else if(command==='accrue')await accrue();else if(command==='prepare-staker')await prepareStaker();else if(command==='prepare-holder')await prepareHolder();else if(command==='smoke')await smoke();else throw Error('Use materialize, status, accrue [marketId], prepare-staker, prepare-holder, or smoke');
