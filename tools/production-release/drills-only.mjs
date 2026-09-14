import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {decodeFunctionResult} from '../../apps/web/node_modules/viem/_esm/index.js';
import {read,write,sha,equal,artifact,encodeFunctionData,keccak256} from './common.mjs';
import {createLocalFork} from './local-fork.mjs';
import {runReleaseDrills} from './drills.mjs';
const output=path.resolve(process.argv[2]??'docs/reviews/evidence/production-release-2026-09-15');
const runtime=read(path.join(output,'runtime-plan.json')),activation=read(path.join(output,'activation-plan.json')),snapshot=read(path.join(output,'mainnet-snapshot.json')),observedCode=read(path.join(output,'runtime-code.json'));
const checkpoint=read(path.join(output,'local-checkpoint.json'));
equal(checkpoint.releaseId,runtime.releaseId,'local checkpoint release');equal(checkpoint.sha256,sha(path.join(output,'local-initialized-state.hex')),'local checkpoint hash');
const fork=await createLocalFork(snapshot,output),rpc=fork.call,abis=new Map();
const abi=name=>{if(!abis.has(name))abis.set(name,artifact(name).abi);return abis.get(name);};
const call=async(name,to,functionName,args=[],from=runtime.deployer)=>decodeFunctionResult({abi:abi(name),functionName,data:await rpc('eth_call',[{from,to,data:encodeFunctionData({abi:abi(name),functionName,args})},'latest'])});
try{
 const state=JSON.parse(zlib.gunzipSync(Buffer.from(fs.readFileSync(path.join(output,'local-initialized-state.hex'),'utf8').slice(2),'hex')));
 // Restore only accounts changed by initialization. Untouched external assets
 // remain sourced from the verified pin, without re-importing their read cache.
 const keep=new Set([...Object.values(observedCode).map(x=>x.address.toLowerCase()),runtime.deployer.toLowerCase(),'0x4e59b44847b379578588920ca78fbf26c0b4956c']);
 const compact={...state,accounts:Object.fromEntries(Object.entries(state.accounts).filter(([address])=>keep.has(address.toLowerCase()))),blocks:[],transactions:[],historical_states:null};
 await rpc('anvil_loadState',['0x'+zlib.gzipSync(Buffer.from(JSON.stringify(compact))).toString('hex')]);
 const head=await rpc('eth_getBlockByNumber',['latest',false]);
 const missing=BigInt(state.best_block_number)-BigInt(head.number);
 if(missing<0n||missing>34n)throw Error('Unexpected restored local block range');
 if(missing>0n){
  if(missing>1n)await rpc('anvil_mine',['0x'+(missing-1n).toString(16),'0x0']);
  await rpc('evm_setNextBlockTimestamp',[Number(BigInt(state.block.timestamp))]);await rpc('evm_mine');
 }
 for(const [name,entry] of Object.entries(observedCode))equal(keccak256(await rpc('eth_getCode',[entry.address,'latest'])),entry.codeHash,'restored runtime '+name);
 equal(await call('V1RobinhoodMainnetDeploymentOrchestrator',runtime.orchestrator,'completed'),true,'restored deployment completed');
 equal(await call('GraduationExecutor',runtime.graduationExecutor,'compoundKeeper'),runtime.configuration.lpCompounding.keeperAtLaunch,'restored keeper');
 equal((await call('AccessManager',runtime.components.AccessManager,'hasRole',[0n,runtime.deployer]))[0],false,'restored admin renounced');
 await runReleaseDrills({runtime,activation,observedCode,rpc,call,output});
}finally{await fork.close();}
