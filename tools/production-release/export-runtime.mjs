import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';
import {createPinnedRpcProxy} from '../robinhood-rpc-compat-proxy.mjs';
import {ROOT,read,write,sourceSnapshot,sha,artifact,json,keccak256,toBytes} from './common.mjs';
import {verifyAndBuildRuntime,COMPONENTS} from './runtime-plan.mjs';
export async function exportRuntime(snapshot,output){
 const prep=read('deployments/manifests/robinhood-mainnet-4663.preparation.json');const hashes=sourceSnapshot();
 if(snapshot.failures.length||snapshot.chainId!==4663)throw Error('Valid mainnet snapshot required');
 const configuration={chainId:4663,addresses:prep.addresses,dependencies:Object.fromEntries(Object.entries(snapshot.dependencies).filter(([key])=>!['SWAP_ROUTER','QUOTER'].includes(key)).map(([key,{address,codeHash}])=>[key,{address,codeHash}])),holderMode:'wallet-snapshot-v1',feePolicyId:keccak256(toBytes('TICKERGARDEN_V1_FEE_POLICY_40_30_30')),firstBuyFunding:'wallet-quote-only',rewardClaims:'raw-assets-only',tradingServices:'off-chain',holderSnapshots:prep.holderSnapshots,lpCompounding:prep.lpCompounding,operatorWalletPolicy:prep.operatorWalletPolicy,quoteManifestSha256:sha('deployments/manifests/robinhood-mainnet-4663.paired-assets.json'),stakeManifestSha256:sha('deployments/manifests/robinhood-mainnet-4663.staking-assets.json')};
 const codeHashes=Object.fromEntries(Object.entries(hashes).filter(([file])=>file.startsWith('contracts/src/')||file.startsWith('contracts/script/')||file==='contracts/foundry.toml'));
 const releaseId=keccak256(toBytes(json({domain:'TICKERGARDEN_MAINNET_PRODUCTION_RELEASE_V1',configuration,codeHashes})));
 fs.mkdirSync(output,{recursive:true});write(path.join(output,'source-sha256.json'),hashes);
 const env={...process.env,V1_EXPECTED_CHAIN_ID:'4663',V1_EXPECTED_DEPLOYER:prep.addresses.deployer,V1_INITIAL_ADMIN:prep.addresses.initialAdmin,V1_PLATFORM_TREASURY:prep.addresses.platformTreasury,V1_PLATFORM_TREASURY_CODEHASH:snapshot.accounts.treasury.codeHash,V1_FEE_POLICY_ID:configuration.feePolicyId,V1_RELEASE_ID:releaseId,V1_DEPLOYMENT_HOLDER_MODE:configuration.holderMode};
 delete env.DEPLOYER_PRIVATE_KEY;
 for(const [key,{address,codeHash}] of Object.entries(configuration.dependencies)){env['V1_'+key]=address;env['V1_'+key+'_CODEHASH']=codeHash;}
 const proxy=await createPinnedRpcProxy({upstreamUrl:process.env.ROBINHOOD_RPC_URL,expectedChainId:4663,...snapshot.pin});
 try {
  const stdout=fs.openSync(path.join(output,'runtime-export.json'),'w'),stderr=fs.openSync(path.join(output,'runtime-export.log'),'w');
  const child=spawn(process.execPath,['tools/run-forge.mjs','script','script/v1/DeployV1RobinhoodMainnetStaged.s.sol:DeployV1RobinhoodMainnetStaged','--sig','exportPlan()','--fork-url',proxy.url,'--fork-block-number',snapshot.pin.blockNumber,'--json'],{cwd:ROOT,env,stdio:['ignore',stdout,stderr]});
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>resolve(code));});fs.closeSync(stdout);fs.closeSync(stderr);if(code!==0)throw Error('Runtime export failed; see sanitized runtime-export.log');
 }finally{await proxy.close();}
 const raw=JSON.parse(fs.readFileSync(path.join(output,'runtime-export.json'),'utf8'));const encoded=raw.returns?.encoded?.value;if(typeof encoded!=='string'||!encoded.startsWith('0x'))throw Error('Missing encoded runtime export');
 const plan=verifyAndBuildRuntime(encoded,configuration,releaseId,snapshot.accounts.deployer.nonce);write(path.join(output,'runtime-plan.json'),plan);
 const names=[...COMPONENTS,'V1RobinhoodMainnetDeploymentOrchestrator','V1HookExecutorDeployer','TickerGardenMemeHook','GraduationExecutor','TickerGardenFactoryV1','LaunchLocker','DeployV1RobinhoodMainnetStaged'];const archive=path.join(output,'build');fs.mkdirSync(archive,{recursive:true});
 const sources=new Set();for(const name of names){const a=artifact(name);write(path.join(archive,name+'.json'),a);const metadata=typeof a.metadata==='string'?JSON.parse(a.metadata):a.metadata;for(const source of Object.keys(metadata.sources))sources.add(source);}
 for(const source of sources){const dest=path.join(output,'source-archive/contracts',source);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(ROOT,'contracts',source),dest);}
 write(path.join(output,'runtime-build-provenance.json'),{status:'CURRENT_ARTIFACTS_AND_EXACT_CONSTRUCTOR_INPUTS_VERIFIED',releaseId,codeHashes,artifactsArchived:names.length,soliditySourcesArchived:sources.size});
 console.log(json({releaseId,factory:plan.factory,transactions:plan.transactions.length,status:plan.status}));return plan;
}
if(process.argv[1]===new URL(import.meta.url).pathname){const output=path.resolve(process.argv[2]??'docs/reviews/evidence/production-release-2026-09-15');await exportRuntime(read(path.join(output,'mainnet-snapshot.json')),output);}
