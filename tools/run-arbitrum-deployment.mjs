import fs from 'node:fs';
import {verifyV1BuildInputs} from './verify-v1-build-inputs.mjs';
import {createHash} from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadV1TestnetDeploymentPlan, verifyV1TestnetDeploymentPlanLive } from '../deployments/src/v1/testnet-plan.ts';
import { HttpV1ReadOnlyRpc } from '../deployments/src/v1/preflight.ts';
const mode=process.argv[2];
if(!['preview','simulate','broadcast'].includes(mode))throw Error('Mode must be preview, simulate or broadcast');
// Reject stale embedded creation code before preview, simulation, or any signature.
console.log(JSON.stringify(verifyV1BuildInputs({checkBatch:mode==='broadcast'})));
const root=fileURLToPath(new URL('../',import.meta.url));
const env={...process.env};delete env.DEPLOYER_PRIVATE_KEY;
for(const line of fs.readFileSync(new URL('../deployments/config/arbitrum-sepolia.public.env',import.meta.url),'utf8').split('\n')){
 if(!line||line.startsWith('#'))continue;const i=line.indexOf('=');const k=line.slice(0,i);if(!/^(V1_|ARBITRUM_SEPOLIA_RPC_URL$)/.test(k))throw Error('Unexpected public configuration key');env[k]=line.slice(i+1);
}
if(env.V1_EXPECTED_CHAIN_ID!=='421614')throw Error('Only Arbitrum Sepolia is permitted');
const plan=loadV1TestnetDeploymentPlan('arbitrum-sepolia');
const live=await verifyV1TestnetDeploymentPlanLive(plan,new HttpV1ReadOnlyRpc(env.ARBITRUM_SEPOLIA_RPC_URL));
const bindingFiles=['deployments/config/arbitrum-sepolia.public.env','deployments/manifests/arbitrum-sepolia-421614.v1.preview.json','deployments/evidence/v1-current-release.json','spec/v1_product_artifact_manifest.json','contracts/script/v1/DeployV1ArbitrumStaged.s.sol','contracts/script/v1/V1ArbitrumDeploymentOrchestrator.sol','tools/arbitrum-broadcast-sequential.mjs','tools/run-arbitrum-deployment.mjs','tools/verify-v1-build-inputs.mjs','contracts/broadcast/DeployV1ArbitrumStaged.s.sol/421614/dry-run/run-latest.json'];
const binding=()=>Object.fromEntries(bindingFiles.map(p=>[p,createHash('sha256').update(fs.readFileSync(root+p)).digest('hex')]));
const bindingPath=root+'outputs/reviews/arbitrum-wallet-deployment/simulation-binding.json';
let secret;
if(mode!=='preview'){
 const walletPath='/Users/dear/.config/tickergarden/testnet-wallets/arbitrum-sepolia.json';
 const stat=fs.lstatSync(walletPath);if(stat.isSymbolicLink()||(stat.mode&0o077)!==0)throw Error('Wallet file permissions must be owner-only');
 const wallet=JSON.parse(fs.readFileSync(walletPath,'utf8'));
 if(wallet.chainId!==421614||wallet.address.toLowerCase()!==env.V1_EXPECTED_DEPLOYER.toLowerCase())throw Error('Wallet target mismatch');
 const preview=JSON.parse(fs.readFileSync(new URL('../deployments/manifests/arbitrum-sepolia-421614.v1.preview.json',import.meta.url)));
 if(preview.deployer.toLowerCase()!==wallet.address.toLowerCase()||preview.releaseId!==env.V1_RELEASE_ID)throw Error('Preview mismatch');
 env.V1_EXPECTED_ORCHESTRATOR=preview.orchestrator;secret=wallet.privateKey;env.DEPLOYER_PRIVATE_KEY=secret;
 if(mode==='broadcast'){
  const forkLog=fs.readFileSync(root+'outputs/reviews/arbitrum-wallet-deployment/receiver-fix-fork.log','utf8');
  if(!forkLog.includes('1 tests passed, 0 failed')&&!forkLog.includes('1 passed; 0 failed'))throw Error('Receiver integration Fork must pass before broadcast');
  const saved=JSON.parse(fs.readFileSync(bindingPath));
  if(JSON.stringify(saved.files)!==JSON.stringify(binding())||Date.now()-saved.at>3600000)throw Error('Simulation inputs changed or expired');
  const prior=fs.readFileSync(new URL('../outputs/reviews/arbitrum-wallet-deployment/simulate.log',import.meta.url),'utf8');
  if(!prior.includes('Script ran successfully.')||!/simulation complete/i.test(prior))throw Error('Successful full simulation required before broadcast');
 }
}
if(mode==='broadcast') {
 const {broadcastSequential}=await import('./arbitrum-broadcast-sequential.mjs');
 try {await broadcastSequential(env,secret);} catch(error){console.error('Broadcast stopped: '+(error.shortMessage??error.message));process.exit(1);}
 process.exit(0);
}
const args=['tools/run-forge.mjs','script','script/v1/DeployV1ArbitrumStaged.s.sol:DeployV1ArbitrumStaged','--sig',mode==='preview'?'preview()':'run()','--rpc-url',env.ARBITRUM_SEPOLIA_RPC_URL,'--sender',env.V1_EXPECTED_DEPLOYER,'--non-interactive','-vv'];
if(mode==='broadcast')args.push('--broadcast','--slow');
const child=spawn(process.execPath,args,{cwd:root,env,stdio:['ignore','pipe','pipe']});
let result='';child.stdout.on('data',b=>result+=b);child.stderr.on('data',b=>result+=b);
const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
if(secret)for(const value of [secret,secret.slice(2),BigInt(secret).toString()])result=result.split(value).join('[REDACTED]');
const output=new URL(`../outputs/reviews/arbitrum-wallet-deployment/${mode}.log`,import.meta.url);
fs.writeFileSync(output,result);
console.log(JSON.stringify({mode,exitCode:code,log:fileURLToPath(output),dependencyVerification:live}));
if(code!==0){console.log(result.split('\n').slice(-14).join('\n'));process.exitCode=code??1;}
else if(mode==='preview'){
 const take=(label,re)=>{const m=result.match(re);if(!m)throw Error('Missing preview '+label);return m[1];};
 const preview={schemaVersion:1,chainId:421614,status:'PREDICTED_NOT_DEPLOYED',deployer:env.V1_EXPECTED_DEPLOYER,releaseId:env.V1_RELEASE_ID,
 orchestrator:take('orchestrator',/\borchestrator (0x[\da-fA-F]{40})/),
 helper:take('helper',/\bhelper (0x[\da-fA-F]{40})/),hook:take('hook',/\bhook (0x[\da-fA-F]{40})/),executor:take('executor',/\bexecutor (0x[\da-fA-F]{40})/),factory:take('factory',/\bfactory (0x[\da-fA-F]{40})/),payloadHash:take('payload hash',/payload hash\s+(0x[\da-fA-F]{64})/),ordinaryComponents:take('components',/ordinaryComponents: \[([^\]]+)\]/).split(',').map(s=>s.trim()),observedAt:new Date().toISOString()};
 if((BigInt(preview.hook)&0x3fffn)!==0x2044n||preview.ordinaryComponents.length!==16)throw Error('Invalid deterministic graph');
 fs.writeFileSync(new URL('../deployments/manifests/arbitrum-sepolia-421614.v1.preview.json',import.meta.url),JSON.stringify(preview,null,2)+'\n');console.log(JSON.stringify(preview,null,2));
}

if(mode==='simulate'&&code===0&&result.includes('Script ran successfully.')&&/simulation complete/i.test(result)){
 console.log(JSON.stringify(verifyV1BuildInputs({checkBatch:true})));
 fs.writeFileSync(bindingPath,JSON.stringify({at:Date.now(),files:binding()},null,2)+'\n');
}
