import fs from 'node:fs';
import {createPublicClient,http,keccak256} from '../apps/web/node_modules/viem/_esm/index.js';
import {arbitrumSepolia} from '../apps/web/node_modules/viem/_esm/chains/index.js';
const client=createPublicClient({chain:arbitrumSepolia,transport:http('https://sepolia-rollup.arbitrum.io/rpc')});
if(await client.getChainId()!==421614)throw Error('Wrong chain');
const plan=JSON.parse(fs.readFileSync('outputs/reviews/arbitrum-continuous-preflight-2026-09-07/candidate.preview.json'));
const cert=JSON.parse(fs.readFileSync('deployments/evidence/v1-continuous-candidate-release.json'));
const checked=JSON.parse(fs.readFileSync('outputs/reviews/arbitrum-continuous-simulation-2026-09-07/verification.json'));
plan.deployer=cert.deployer;plan.helper=checked.helper;
const directory='deployments/releases/'+plan.releaseId;
const names=['AccessManager','OfficialStockRegistryV1','ApprovedQuoteRegistry','TickerGardenBaselineRegistry','LaunchTemplateRegistry','LaunchConfigResolver','TickerMemeTokenV1Implementation','TickerGardenCurveImplementation','MemeStockGauge','LaunchAndBuyRouter','MarketRegistryV1','CreatorRevenueRegistry','AllocationManager','UserStockVault','HolderRewardsDistributorV1','ProtocolFeeVault'];
const entries=names.map((name,i)=>({name,address:plan.ordinaryComponents[i]}));
entries.push({name:'V1ArbitrumDeploymentOrchestrator',address:plan.orchestrator},{name:'V1HookExecutorDeployer',address:plan.helper},{name:'TickerGardenMemeHook',address:plan.hook},{name:'GraduationExecutor',address:plan.executor},{name:'TickerGardenFactoryV1',address:plan.factory});
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
eq(await read('V1ArbitrumDeploymentOrchestrator',plan.orchestrator,'completed'),true,'completed');
eq(await read('V1ArbitrumDeploymentOrchestrator',plan.orchestrator,'authorizer'),plan.deployer,'authorizer');
eq(await read('V1ArbitrumDeploymentOrchestrator',plan.orchestrator,'releaseId'),plan.releaseId,'releaseId');
eq(await read('V1ArbitrumDeploymentOrchestrator',plan.orchestrator,'deploymentPayloadHash'),plan.payloadHash,'payload');
for(const n of ['factory','helper','hook','executor'])eq(await read('V1ArbitrumDeploymentOrchestrator',plan.orchestrator,n),plan[n],n);
const actual=await read('V1ArbitrumDeploymentOrchestrator',plan.orchestrator,'ordinaryComponents');actual.forEach((a,i)=>eq(a,plan.ordinaryComponents[i],'component '+i));
for(const [name,address,fn,expected] of [
 ['MarketRegistryV1',plan.ordinaryComponents[10],'factory',plan.factory],
 ['MarketRegistryV1',plan.ordinaryComponents[10],'graduationExecutor',plan.executor],
 ['LaunchAndBuyRouter',plan.ordinaryComponents[9],'factory',plan.factory],
 ['TickerGardenMemeHook',plan.hook,'graduationExecutor',plan.executor],
 ['GraduationExecutor',plan.executor,'hook',plan.hook],
 ['ProtocolFeeVault',plan.ordinaryComponents[15],'marketRegistry',plan.ordinaryComponents[10]],
 ['TickerGardenFactoryV1',plan.factory,'protocolFeeVault',plan.ordinaryComponents[15]]])eq(await read(name,address,fn),expected,fn);
const treasury=JSON.parse(fs.readFileSync('deployments/manifests/arbitrum-sepolia-421614.test-treasury.json'));
eq(await read('TickerGardenFactoryV1',plan.factory,'platformTreasury'),treasury.address,'platformTreasury');
const receiverArtifact=artifact('ArbitrumTestTreasury');
const receiverCode=await client.getCode({address:treasury.address});
const normalizedReceiver=Buffer.from(receiverCode.slice(2),'hex');
for(const ranges of Object.values(receiverArtifact.deployedBytecode.immutableReferences??{}))for(const r of ranges)normalizedReceiver.fill(0,r.start,r.start+r.length);
if(normalizedReceiver.toString('hex')!==receiverArtifact.deployedBytecode.object.slice(2))throw Error('Receiver runtime mismatch');
eq(await read('ArbitrumTestTreasury',treasury.address,'owner'),plan.deployer,'receiver owner');
const settlementOperator=await read('ProtocolFeeVault',plan.ordinaryComponents[15],'settlementOperator');
const operatorConfigured=settlementOperator.toLowerCase()===plan.deployer.toLowerCase();
const admin=await read('AccessManager',plan.ordinaryComponents[0],'hasRole',[0n,plan.deployer]);
if(!admin[0])throw Error('Admin role missing');
if((BigInt(plan.hook)&0x3fffn)!==0x2044n)throw Error('Hook mask mismatch');
eq(await read('HolderRewardsDistributorV1',plan.ordinaryComponents[14],'STREAM_DURATION'),86400,'Stream duration');
eq(await read('HolderRewardsDistributorV1',plan.ordinaryComponents[14],'marketRegistry'),plan.ordinaryComponents[10],'Distributor registry');
eq(await read('TickerGardenFactoryV1',plan.factory,'treasuryDistributor'),plan.ordinaryComponents[14],'Factory distributor');
const txs=JSON.parse(fs.readFileSync(directory+'/continuous-deployment-transactions.json'));
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
const report={...plan,status:operatorConfigured?(active?'DEPLOYED_VERIFIED_ACTIVE_TEST_ONLY':'DEPLOYED_VERIFIED_NOT_ACTIVATED'):'DEPLOYED_VERIFIED_PENDING_OPERATOR_AND_ACTIVATION',settlementOperator,operatorConfigured,productionTargetChainId:4663,verifiedAt:new Date().toISOString(),contracts:results,startBlock:txs[0].blockNumber,endBlock:txs.at(-1).blockNumber,transactionCount:txs.length,balanceWei:(await client.getBalance({address:plan.deployer})).toString(),platformTreasury:treasury.address,activation,publicTestnetE2E:false};
fs.writeFileSync(directory+'/arbitrum-sepolia-421614.v1.deployed.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,factory:plan.factory,router:plan.ordinaryComponents[9],hook:plan.hook,contractsVerified:results.length,transactionCount:txs.length,balanceWei:report.balanceWei},null,2));
