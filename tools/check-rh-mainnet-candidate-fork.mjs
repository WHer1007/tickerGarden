import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {createPinnedRpcProxy} from './robinhood-rpc-compat-proxy.mjs';
const m=JSON.parse(fs.readFileSync(new URL('../deployments/manifests/robinhood-mainnet-4663.preparation.json',import.meta.url)));
if(m.chainId!==4663||!/^\d+$/.test(m.forkPin?.l1BlockNumber??''))throw Error('Invalid mainnet pin');
const p=m.forkPin;
const proxy=await createPinnedRpcProxy({upstreamUrl:process.env.ROBINHOOD_RPC_URL?.trim()||m.publicRpc,expectedChainId:4663,blockNumber:p.blockNumber,blockHash:p.blockHash});
try{
 const child=spawn(process.execPath,['tools/run-forge.mjs','test','--match-contract','V1MainnetCandidateForkE2ETest','--fork-url',proxy.url,'--fork-block-number',p.blockNumber,'-vv'],{stdio:'inherit',env:{...process.env,TG_MAINNET_FORK_BLOCK:p.blockNumber,TG_MAINNET_FORK_HASH:p.blockHash,TG_MAINNET_FORK_L1_BLOCK:p.l1BlockNumber}});
 process.exitCode=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',c=>resolve(c??1));});
}finally{await proxy.close();}
