// Unsigned dry-run only. No key loading and no broadcast mode.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {assertArtifactSourcesCurrent} from './verify-v1-build-inputs.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
if(process.argv.length!==2)throw Error('This command only supports unsigned simulation without arguments');
const dir=path.join(root,'outputs/reviews/arbitrum-continuous-simulation-2026-09-07');fs.mkdirSync(dir,{recursive:true});
const input=path.join(root,'outputs/reviews/arbitrum-continuous-preflight-2026-09-07');
const cfg=Object.fromEntries(fs.readFileSync(input+'/candidate.public.env','utf8').split('\n').filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)];}));
for(const k of Object.keys(cfg))if(!/^V1_/.test(k))throw Error('Unexpected public input');
if(cfg.V1_EXPECTED_CHAIN_ID!=='421614')throw Error('Wrong chain');
const publicText=fs.readFileSync(root+'deployments/config/arbitrum-sepolia.public.env','utf8');
const rpc=publicText.match(/^ARBITRUM_SEPOLIA_RPC_URL=(.+)$/m)?.[1];if(!rpc)throw Error('Missing testnet RPC');
const preview=JSON.parse(fs.readFileSync(input+'/candidate.preview.json'));
if(preview.releaseId!==cfg.V1_RELEASE_ID)throw Error('Preview/config mismatch');
const script='DeployV1ArbitrumContinuousHolders';
const artifact=JSON.parse(fs.readFileSync(root+`contracts/out-v1/${script}.s.sol/${script}.json`));
assertArtifactSourcesCurrent(artifact,root+'contracts',script);
const env={...process.env,...cfg};delete env.DEPLOYER_PRIVATE_KEY;
// simulate() itself also rejects Forge ScriptBroadcast and ScriptResume contexts.
const r=spawnSync(process.execPath,['tools/run-forge.mjs','script',`script/v1/${script}.s.sol:${script}`,'--sig','simulate()','--rpc-url',rpc,'--sender',cfg.V1_EXPECTED_DEPLOYER,'--non-interactive','-vv'],{cwd:root,env,encoding:'utf8',maxBuffer:30*1024*1024});
const log=((r.stdout??'')+(r.stderr??'')).split(rpc).join('[ARBITRUM_RPC]');
fs.writeFileSync(dir+'/simulation.log',log);
if(r.status!==0||!log.includes('Script ran successfully.')||!/simulation complete/i.test(log))throw Error('Simulation did not complete; see simulation.log');
const source=root+`contracts/broadcast/${script}.s.sol/421614/dry-run/simulate-latest.json`;
fs.copyFileSync(source,dir+'/unsigned-transactions.json');
console.log(JSON.stringify({status:'UNSIGNED_SIMULATION_COMPLETED_NOT_BROADCAST',output:dir}));
