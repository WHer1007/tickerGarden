import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {assertArtifactSourcesCurrent} from '../verify-v1-build-inputs.mjs';
export {keccak256,encodeAbiParameters,decodeAbiParameters,encodeFunctionData,decodeFunctionData,getContractAddress,parseAbiParameters,getAddress,toBytes,toFunctionSelector,parseAbi} from '../../apps/web/node_modules/viem/_esm/index.js';
export const ROOT=fileURLToPath(new URL('../../',import.meta.url));
export const ZERO='0x'+'0'.repeat(40);
export const read=p=>JSON.parse(fs.readFileSync(path.resolve(ROOT,p),'utf8'));
export const json=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n';
export const write=(p,x)=>fs.writeFileSync(p,json(x));
export const sha=p=>createHash('sha256').update(fs.readFileSync(path.resolve(ROOT,p))).digest('hex');
export const equal=(a,b,label)=>{if(String(a).toLowerCase()!==String(b).toLowerCase())throw Error('Mismatch: '+label);};
export function artifact(name){const fileName=['TickerMemeTokenV1Implementation','TickerGardenCurveImplementation'].includes(name)?'TickerGardenFactoryV1':name;const ext=name.startsWith('DeployV1')?'.s.sol':'.sol';const a=read(`contracts/out-v1/${fileName}${ext}/${name}.json`);assertArtifactSourcesCurrent(a,path.join(ROOT,'contracts'),name);return a;}
export function sourceSnapshot(){
 const files=execFileSync('rg',['--files','contracts/src/v1','contracts/script/v1','contracts/test/v1','spec','deployments/src/v1','deployments/test','deployments/schemas','tools/production-release'],{cwd:ROOT,encoding:'utf8'}).trim().split('\n').filter(f=>!f.includes('__pycache__')&&!f.endsWith('.pyc'));
 files.push('contracts/foundry.toml','config/master.env.example','deployments/manifests/robinhood-mainnet-4663.paired-assets.json','deployments/manifests/robinhood-mainnet-4663.staking-assets.json','deployments/manifests/robinhood-mainnet-4663.preparation.json');
 files.push('package.json','deployments/package.json','deployments/package-lock.json','tools/environment.mjs','tools/environment.test.mjs','tools/robinhood-rpc-compat-proxy.mjs','tools/verify-v1-build-inputs.mjs');
 files.push('docs/v1/V1_EXECUTION_SPEC.md','docs/runbooks/RH_MAINNET_RELEASE_2026-09-15.md','docs/reviews/PRODUCTION_RELEASE_PREPARATION_2026-09-15.md');
 return Object.fromEntries([...new Set(files)].sort().map(f=>[f,sha(f)]));
}
export function readonlyRpc(url){
 if(!url)throw Error('Configured internal ROBINHOOD_RPC_URL missing');let id=0;
 const allowed=new Set(['eth_chainId','eth_getBlockByNumber','eth_getBlockByHash','eth_getCode','eth_getBalance','eth_getTransactionCount','eth_getStorageAt','eth_call','eth_gasPrice','eth_feeHistory','eth_maxPriorityFeePerGas']);
 const batch=async calls=>{
  const requests=calls.map(([method,params])=>{if(!allowed.has(method))throw Error('Read-only method denied');return {jsonrpc:'2.0',id:++id,method,params};});
  for(let attempt=0;attempt<3;attempt++){
   try {const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(requests),signal:AbortSignal.timeout(25000)});if(!response.ok)throw Error('HTTP status '+response.status);const result=await response.json();if(!Array.isArray(result))throw Error('Expected RPC batch');const byId=new Map(result.map(x=>[x.id,x]));return requests.map(r=>{const entry=byId.get(r.id);if(!entry||entry.error||!Object.hasOwn(entry,'result'))throw Error('RPC method failed: '+r.method);return entry.result;});}
   catch{if(attempt===2)throw Error('Read-only RPC batch failed: '+requests.map(r=>r.method).join(','));await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)));}
  }
 };
 return {batch,call:async(method,params)=>(await batch([[method,params]]))[0]};
}
