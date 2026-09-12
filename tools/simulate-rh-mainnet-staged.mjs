import fs from 'node:fs';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createPinnedRpcProxy} from './robinhood-rpc-compat-proxy.mjs';
const req=createRequire(new URL('../deployments/package.json',import.meta.url));
const {keccak_256}=req('@noble/hashes/sha3');
const hash=x=>'0x'+Buffer.from(keccak_256(x)).toString('hex');
const read=p=>JSON.parse(fs.readFileSync(p));
const m=read('deployments/manifests/robinhood-mainnet-4663.preparation.json');
const base=m.evidenceDirectory??'docs/reviews/evidence/rh-mainnet-preparation-2026-09-13/';
const deps=read(base+'dependencies.json'),accounts=read(base+'accounts.json');
if(m.chainId!==4663||deps.chainId!==4663||deps.pin.blockHash!==m.forkPin.blockHash||accounts.block.hash!==m.forkPin.blockHash)throw Error('Snapshot binding mismatch');
for(const [role,key] of [['treasury','platformTreasury'],['governance','governance'],['deployer','deployer']])if(accounts.accounts[role].address!==m.addresses[key])throw Error('Account evidence mismatch');
// First-buy funding uses wallet Quote only; no external swap parameters.
const configuration={chainId:4663,addresses:m.addresses,dependencies:deps.dependencies,holderMode:'dual-asset-24h-v4',feePolicyId:hash('TICKERGARDEN_V1_FEE_POLICY_40_30_30'),firstBuyFunding:"wallet-quote-only"};
const releaseId=hash(JSON.stringify({domain:'TICKERGARDEN_RH_MAINNET_STAGED_PREPARATION_2026_09_13',configuration}));
const env={...process.env,V1_EXPECTED_CHAIN_ID:'4663',V1_EXPECTED_DEPLOYER:m.addresses.deployer,V1_INITIAL_ADMIN:m.addresses.initialAdmin,V1_PLATFORM_TREASURY:m.addresses.platformTreasury,V1_PLATFORM_TREASURY_CODEHASH:accounts.accounts.treasury.codeHash,V1_FEE_POLICY_ID:configuration.feePolicyId,V1_RELEASE_ID:releaseId,V1_DEPLOYMENT_HOLDER_MODE:configuration.holderMode};
for(const [key,{address,codeHash}]of Object.entries(deps.dependencies)){env['V1_'+key]=address;env['V1_'+key+'_CODEHASH']=codeHash;}
const outputBase='docs/reviews/evidence/quote-only-launch-2026-09-13/';
fs.mkdirSync(outputBase,{recursive:true});
fs.writeFileSync(outputBase+'simulation-inputs.json',JSON.stringify({status:'SIMULATION_ONLY_NOT_SIGNABLE',releaseId,configuration,pin:m.forkPin},null,2)+'\n');
const proxy=await createPinnedRpcProxy({upstreamUrl:process.env.ROBINHOOD_RPC_URL?.trim()||m.publicRpc,expectedChainId:4663,blockNumber:m.forkPin.blockNumber,blockHash:m.forkPin.blockHash});
try{
 const args=['tools/run-forge.mjs','script','script/v1/DeployV1RobinhoodMainnetStaged.s.sol:DeployV1RobinhoodMainnetStaged','--sig','simulate()','--fork-url',proxy.url,'--fork-block-number',m.forkPin.blockNumber,'-vv'];
 const child=spawn(process.execPath,args,{env,stdio:'inherit'});
 process.exitCode=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>resolve(code??1));});
}finally{await proxy.close();}
