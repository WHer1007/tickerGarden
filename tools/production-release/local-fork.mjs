import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {homedir} from 'node:os';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {createPinnedRpcProxy} from '../robinhood-rpc-compat-proxy.mjs';
import {equal} from './common.mjs';
export const quantity=x=>'0x'+BigInt(x).toString(16);
export async function createLocalFork(snapshot,output){
 const proxy=await createPinnedRpcProxy({upstreamUrl:process.env.ROBINHOOD_RPC_URL,expectedChainId:4663,...snapshot.pin});
 const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
 const log=fs.openSync(path.join(output,'anvil.log'),'w');
 const child=spawn(path.join(homedir(),'.foundry/bin/anvil'),['--host','127.0.0.1','--port',String(port),'--fork-url',proxy.url,'--fork-block-number',snapshot.pin.blockNumber,'--chain-id','4663','--hardfork','cancun','--gas-limit','32000000','--silent'],{stdio:['ignore',log,log]});
 let exited=false;child.on('exit',()=>{exited=true;});let id=0,verified=false;
 const url=`http://127.0.0.1:${port}`;
 const writeMethods=new Set(['eth_sendTransaction','anvil_impersonateAccount','anvil_stopImpersonatingAccount','anvil_setBalance','anvil_setStorageAt','anvil_loadState','anvil_mine','evm_setNextBlockTimestamp','evm_snapshot','evm_revert','evm_increaseTime','evm_mine']);
 const call=async(method,params=[])=>{
  assert.ok(!exited,'Owned local Anvil exited');
  if(writeMethods.has(method))assert.ok(verified,'Local writes require verified owned Anvil');
  for(let attempt=0;attempt<3;attempt++){
   // Cold estimates may fetch many pinned slots. Retry only transient read
   // failures at the same state; never retry an uncertain transaction send.
   try{
    const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(['eth_estimateGas','anvil_loadState'].includes(method)?300000:60000)});
    const result=await response.json();if(result.error)throw Error(`${method}: ${JSON.stringify(result.error)}`);return result.result;
   }catch(error){
    const retryable=['eth_estimateGas','eth_call','eth_getCode','eth_getStorageAt'].includes(method)&&/HTTP error (429|502|503|504)|aborted due to timeout|fetch failed/i.test(error.message);
    if(!retryable||attempt===2)throw error;
    await new Promise(r=>setTimeout(r,250*(attempt+1)));
   }
  }
 };
 try{
  let ready=false;for(let i=0;i<200;i++){try{const version=await call('web3_clientVersion');if(!/anvil/i.test(version))throw Error('Unexpected local server');ready=true;break;}catch(error){if(exited)throw error;await new Promise(r=>setTimeout(r,100));}}
  assert.ok(ready,'Owned local Anvil did not start');equal(BigInt(await call('eth_chainId')),4663,'local chain');
  const info=await call('anvil_nodeInfo');equal(info.environment.chainId,4663,'Anvil chain');
  const block=await call('eth_getBlockByNumber',[quantity(snapshot.pin.blockNumber),false]);equal(block.hash,snapshot.pin.blockHash,'local fork pin');
  verified=true;return {call,info,close:async()=>{if(!exited){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}fs.closeSync(log);await proxy.close();}};
 }catch(error){child.kill('SIGTERM');fs.closeSync(log);await proxy.close();throw error;}
}
