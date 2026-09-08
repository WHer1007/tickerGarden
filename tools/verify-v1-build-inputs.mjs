import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {keccak256, decodeFunctionData} from '../apps/web/node_modules/viem/_esm/index.js';

const root=fileURLToPath(new URL('../',import.meta.url));
export const ordinaryArtifactNames=['AccessManager','OfficialStockRegistryV1','ApprovedQuoteRegistry','TickerGardenBaselineRegistry','LaunchTemplateRegistry','LaunchConfigResolver','TickerMemeTokenV1Implementation','TickerGardenCurveImplementation','MemeStockGauge','LaunchAndBuyRouter','MarketRegistryV1','CreatorRevenueRegistry','AllocationManager','UserStockVault','TreasuryDistributorV1','ProtocolFeeVault'];
const fileName=n=>['TickerMemeTokenV1Implementation','TickerGardenCurveImplementation'].includes(n)?'TickerGardenFactoryV1':n;
export function assertArtifactSourcesCurrent(artifact, contractsRoot, label='artifact') {
 const metadata=typeof artifact.metadata==='string'?JSON.parse(artifact.metadata):artifact.metadata;
 const entries=Object.entries(metadata?.sources??{});
 if(!entries.length)throw Error('Missing compiler source provenance: '+label);
 const base=path.resolve(contractsRoot);
 for(const [source,record] of entries){
  const file=path.resolve(base,source);
  if(!file.startsWith(base+path.sep)||!fs.existsSync(file))throw Error('Unresolvable compiler source: '+source);
  const actual=keccak256(fs.readFileSync(file));
  if(actual!==record.keccak256)throw Error(`Stale compiled source in ${label}: ${source}; clean rebuild required`);
 }
 return entries.length;
}
export function assertOrdinaryInitCodesCurrent(batch, abi, artifacts) {
 const seen=new Set();
 for(const entry of batch.transactions??[]){
  let call;try{call=decodeFunctionData({abi,data:entry.transaction.input});}catch{continue;}
  if(call.functionName!=='deployComponent')continue;
  const [rawIndex,code]=call.args,index=Number(rawIndex),expected=artifacts[index]?.bytecode?.object;
  if(index<0||index>=16||seen.has(index)||!expected||expected==='0x'||!code.startsWith(expected))throw Error('Stale or invalid deployment init code at component '+index);
  seen.add(index);
 }
 if(seen.size!==16)throw Error('Expected exactly 16 reviewed component deployments');
 return seen.size;
}
export function verifyV1BuildInputs({checkBatch=false}={}) {
 const load=(n,script=false)=>JSON.parse(fs.readFileSync(path.join(root,'contracts/out-v1',fileName(n)+(script?'.s.sol':'.sol'),n+'.json')));
 const artifacts=ordinaryArtifactNames.map(n=>load(n));
 const scripts=[load('DeployV1ArbitrumStaged',true),load('V1ArbitrumDeploymentOrchestrator'),load('V1HookExecutorDeployer')];
 const all=[...artifacts,...scripts,load('TickerGardenFactoryV1'),load('TickerGardenMemeHook'),load('GraduationExecutor')];
 let sourceChecks=0;for(let i=0;i<all.length;i++)sourceChecks+=assertArtifactSourcesCurrent(all[i],path.join(root,'contracts'),'deployment artifact '+i);
 let componentsChecked=0;
 if(checkBatch){const batch=JSON.parse(fs.readFileSync(path.join(root,'contracts/broadcast/DeployV1ArbitrumStaged.s.sol/421614/dry-run/run-latest.json')));componentsChecked=assertOrdinaryInitCodesCurrent(batch,scripts[1].abi,artifacts);}
 return {status:'CURRENT_BUILD_INPUTS_VERIFIED',artifactsChecked:all.length,sourceChecks,componentsChecked};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(verifyV1BuildInputs({checkBatch:process.argv.includes('--batch')})));
