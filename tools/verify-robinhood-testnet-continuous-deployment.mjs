import {readProjectEnv} from "./environment.mjs";
import {reviewPath, simulationPath} from "./robinhood-deployment-run.mjs";
import fs from 'node:fs';
import {createPublicClient,defineChain,http,keccak256,toHex} from '../apps/web/node_modules/viem/_esm/index.js';
const local=readProjectEnv();
if(!local.ALCHEMY_API_KEY)throw Error('Missing ALCHEMY_API_KEY');
const rpc=process.env.TG_RH_DEPLOYMENT_RUN === 'frontend-independent-2026-09-08' ? 'http://127.0.0.1:18570' : `https://robinhood-testnet.g.alchemy.com/v2/${local.ALCHEMY_API_KEY}`;
const chain=defineChain({id:46630,name:'Robinhood Chain Testnet',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:{default:{http:[rpc]}}});
const client=createPublicClient({chain,transport:http(rpc,{timeout:30000,retryCount:2})});
if(await client.getChainId()!==46630)throw Error('Wrong chain');
const plan=JSON.parse(fs.readFileSync(`${reviewPath}/candidate.preview.json`));
const cert=JSON.parse(fs.readFileSync('deployments/evidence/v1-robinhood-testnet-candidate-release.json'));
const checked=JSON.parse(fs.readFileSync(`${simulationPath}/verification.json`));
plan.deployer=cert.deployer;
const directory='deployments/releases/'+plan.releaseId;
const names=['AccessManager','OfficialStockRegistryV1','ApprovedQuoteRegistry','TickerGardenBaselineRegistry','LaunchTemplateRegistry','LaunchConfigResolver','TickerMemeTokenV1Implementation','TickerGardenCurveImplementation','MemeStockGauge','LaunchAndBuyRouter','MarketRegistryV1','CreatorRevenueRegistry','AllocationManager','UserStockVault','HolderRewardsDistributorV1','ProtocolFeeVault'];
const entries=names.map((name,i)=>({name,address:plan.ordinaryComponents[i]}));
entries.push({name:'V1RobinhoodTestnetDeploymentOrchestrator',address:plan.orchestrator},{name:'V1HookExecutorDeployer',address:plan.helper},{name:'TickerGardenMemeHook',address:plan.hook},{name:'GraduationExecutor',address:plan.executor},{name:'TickerGardenFactoryV1',address:plan.factory});
const artifact=name=>JSON.parse(fs.readFileSync(`contracts/out-v1/${['TickerMemeTokenV1Implementation','TickerGardenCurveImplementation'].includes(name)?'TickerGardenFactoryV1':name}.sol/${name}.json`));
const results=await Promise.all(entries.map(async entry=>{
 const a=artifact(entry.name);const code=await client.getCode({address:entry.address});
 if(!code||code==='0x')throw Error('Missing code '+entry.name);
 const normalize=(raw)=>{let b=Buffer.from(raw.slice(2),'hex');for(const ranges of Object.values(a.deployedBytecode.immutableReferences??{}))for(const r of ranges)b.fill(0,r.start,r.start+r.length);return b.toString('hex');};
 if(normalize(code)!==normalize(a.deployedBytecode.object))throw Error('Runtime mismatch '+entry.name);
 return {...entry,runtimeCodeHash:keccak256(code),runtimeBytes:(code.length-2)/2};
}));
const read=(name,address,functionName,args=[])=>client.readContract({address,abi:artifact(name).abi,functionName,args});
const eq=(actual,expected,label)=>{if(String(actual).toLowerCase()!==String(expected).toLowerCase())throw Error('Binding mismatch '+label);};
eq(await read('V1RobinhoodTestnetDeploymentOrchestrator',plan.orchestrator,'completed'),true,'completed');
eq(await read('V1RobinhoodTestnetDeploymentOrchestrator',plan.orchestrator,'authorizer'),plan.deployer,'authorizer');
eq(await read('V1RobinhoodTestnetDeploymentOrchestrator',plan.orchestrator,'releaseId'),plan.releaseId,'releaseId');
eq(await read('V1RobinhoodTestnetDeploymentOrchestrator',plan.orchestrator,'deploymentPayloadHash'),plan.payloadHash,'payload');
for(const n of ['factory','helper','hook','executor'])eq(await read('V1RobinhoodTestnetDeploymentOrchestrator',plan.orchestrator,n),plan[n],n);
const actual=await read('V1RobinhoodTestnetDeploymentOrchestrator',plan.orchestrator,'ordinaryComponents');actual.forEach((a,i)=>eq(a,plan.ordinaryComponents[i],'component '+i));
for(const [name,address,fn,expected] of [
 ['MarketRegistryV1',plan.ordinaryComponents[10],'factory',plan.factory],
 ['MarketRegistryV1',plan.ordinaryComponents[10],'graduationExecutor',plan.executor],
 ['LaunchAndBuyRouter',plan.ordinaryComponents[9],'factory',plan.factory],
 ['TickerGardenMemeHook',plan.hook,'graduationExecutor',plan.executor],
 ['GraduationExecutor',plan.executor,'hook',plan.hook],
 ['ProtocolFeeVault',plan.ordinaryComponents[15],'marketRegistry',plan.ordinaryComponents[10]],
 ['TickerGardenFactoryV1',plan.factory,'protocolFeeVault',plan.ordinaryComponents[15]]])eq(await read(name,address,fn),expected,fn);
eq(await read('LaunchAndBuyRouter',plan.ordinaryComponents[9],'poolManager'),'0x8366a39cc670b4001a1121b8f6a443a643e40951','Native fallback PoolManager');
const treasury=JSON.parse(fs.readFileSync('deployments/manifests/robinhood-testnet-46630.test-treasury.json'));
eq(await read('TickerGardenFactoryV1',plan.factory,'platformTreasury'),treasury.address,'platformTreasury');
// This receiver is an already-deployed dependency: validate its recorded bytecode, not a new build.
const receiverCode=await client.getCode({address:treasury.address});
if(!receiverCode || receiverCode==='0x' || !/^0x[0-9a-fA-F]{64}$/.test(treasury.runtimeCodeHash))throw Error('Missing receiver identity evidence');
eq(keccak256(receiverCode),treasury.runtimeCodeHash,'Receiver runtime codehash');
eq(await read('RobinhoodTestnetTreasury',treasury.address,'owner'),plan.deployer,'receiver owner');
const admin=await read('AccessManager',plan.ordinaryComponents[0],'hasRole',[0n,plan.deployer]);
if(!admin[0])throw Error('Admin role missing');
if((BigInt(plan.hook)&0x3fffn)!==0x2044n)throw Error('Hook mask mismatch');
eq(await read('HolderRewardsDistributorV1',plan.ordinaryComponents[14],'STREAM_DURATION'),86400,'Stream duration');
eq(await read('HolderRewardsDistributorV1',plan.ordinaryComponents[14],'FUNDING_INTERVAL'),14400,'Default funding interval');
eq(
 await read('HolderRewardsDistributorV1',plan.ordinaryComponents[14],'rewardMode'),
 keccak256(toHex('TICKERGARDEN_HOLDER_DUAL_ASSET_24H_V4')),
 'Holder reward mode'
);
eq(await read('HolderRewardsDistributorV1',plan.ordinaryComponents[14],'marketRegistry'),plan.ordinaryComponents[10],'Distributor registry');
eq(await read('TickerGardenFactoryV1',plan.factory,'holderRewardsDistributor'),plan.ordinaryComponents[14],'Factory distributor');
eq(
 await read('ProtocolFeeVault',plan.ordinaryComponents[15],'userClaimMode'),
 keccak256(toHex('TICKERGARDEN_USER_CLAIM_ASSET_SELECTION_V1')),
 'User claim mode'
);
const txs=JSON.parse(fs.readFileSync(directory+'/robinhood-testnet-continuous-transactions.json'));
if(!txs.length||txs.some(t=>t.status!=='CONFIRMED'))throw Error('Unconfirmed transactions');
for(const t of txs){const r=await client.getTransactionReceipt({hash:t.hash});if(r.status!=='success')throw Error('Receipt failed');}
let activation={quote:false,baseline:false,template:false};
const activationPath=directory+'/activation.json';
if(fs.existsSync(activationPath)) {
 const active=JSON.parse(fs.readFileSync(activationPath));
 if(active.releaseId===plan.releaseId) {
  activation.baseline=(await read('TickerGardenBaselineRegistry',plan.ordinaryComponents[3],'baseline',[active.baselineId])).status===1;
  activation.quote=(await read('ApprovedQuoteRegistry',plan.ordinaryComponents[2],'quoteConfig',[active.quoteId])).status===1;
  activation.template=(await read('LaunchTemplateRegistry',plan.ordinaryComponents[4],'launchTemplate',[active.templateId])).status===1;
 }
}
const active=Object.values(activation).every(Boolean);
const report={...plan,status:active?'DEPLOYED_VERIFIED_ACTIVE_TEST_ONLY':'DEPLOYED_VERIFIED_NOT_ACTIVATED',productionTargetChainId:4663,networkScope:'ROBINHOOD_TESTNET_ONLY',verifiedAt:new Date().toISOString(),contracts:results,startBlock:txs[0].blockNumber,endBlock:txs.at(-1).blockNumber,transactionCount:txs.length,totalDeploymentFeeWei:txs.reduce((sum,t)=>sum+BigInt(t.feeWei),0n).toString(),balanceWei:(await client.getBalance({address:plan.deployer})).toString(),platformTreasury:treasury.address,activation,publicTestnetE2E:false};
fs.writeFileSync(directory+'/robinhood-testnet-46630.v1.deployed.json',JSON.stringify(report,null,2)+'\n');
const statusPath=directory+'/release-status.json';
const prior=fs.existsSync(statusPath)?JSON.parse(fs.readFileSync(statusPath)):{};
fs.writeFileSync(statusPath,JSON.stringify({...prior,schemaVersion:1,status:report.status,chainId:46630,productionTargetChainId:4663,releaseId:plan.releaseId,deployer:plan.deployer,platformTreasury:treasury.address,orchestrator:plan.orchestrator,factory:plan.factory,hook:plan.hook,graduationExecutor:plan.executor,payloadHash:plan.payloadHash,components:Object.fromEntries(entries.map(x=>[x.name,x.address])),transactions:{...prior.transactions,core:txs.map(x=>x.hash)},publicTestnetE2E:false},null,2)+'\n');
console.log(JSON.stringify({status:report.status,factory:plan.factory,router:plan.ordinaryComponents[9],hook:plan.hook,contractsVerified:results.length,transactionCount:txs.length,totalDeploymentFeeWei:txs.reduce((sum,t)=>sum+BigInt(t.feeWei),0n).toString(),balanceWei:report.balanceWei},null,2));
