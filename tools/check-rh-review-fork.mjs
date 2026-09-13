// Read-only current-source business regression against a fresh, hash-pinned RH mainnet block.
// Does not update the production deployment pin or authorize any mainnet transaction.
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {createPinnedRpcProxy} from './robinhood-rpc-compat-proxy.mjs';
import {reviewPath} from './robinhood-deployment-run.mjs';
if (!process.env.TG_RH_DEPLOYMENT_RUN) throw Error('Explicit review run required');
const upstreamUrl = 'https://rpc.mainnet.chain.robinhood.com';
async function rpc(method, params) {
  const response = await fetch(upstreamUrl, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(30000)});
  const body = await response.json();
  if (!response.ok || body.error || body.result == null) throw Error(`Read-only RPC failed: ${method}`);
  return body.result;
}
if (BigInt(await rpc('eth_chainId', [])) !== 4663n) throw Error('Wrong chain');
const b = await rpc('eth_getBlockByNumber', ['latest',false]);
if (!/^0x[0-9a-f]+$/i.test(b.l1BlockNumber ?? '')) throw Error('Header missing L1 height');
const pin = {chainId:4663,blockNumber:String(BigInt(b.number)),blockHash:b.hash,l1BlockNumber:String(BigInt(b.l1BlockNumber)),observedAt:new Date().toISOString(),scope:'READ_ONLY_CURRENT_SOURCE_BUSINESS_FORK'};
fs.mkdirSync(reviewPath,{recursive:true});
fs.writeFileSync(`${reviewPath}/fresh-mainnet-fork-pin.json`,JSON.stringify(pin,null,2)+'\n');
const proxy = await createPinnedRpcProxy({upstreamUrl,expectedChainId:4663,blockNumber:pin.blockNumber,blockHash:pin.blockHash});
try {
  const child = spawn(process.execPath,['tools/run-forge.mjs','test','--match-contract','V1MainnetCandidateForkE2ETest','--fork-url',proxy.url,'--fork-block-number',pin.blockNumber,'-vv'],{stdio:'inherit',env:{...process.env,TG_MAINNET_FORK_BLOCK:pin.blockNumber,TG_MAINNET_FORK_HASH:pin.blockHash,TG_MAINNET_FORK_L1_BLOCK:pin.l1BlockNumber}});
  const code = await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',c=>resolve(c??1));});
  const after = await rpc('eth_getBlockByNumber',[b.number,false]);
  if (after.hash !== pin.blockHash) throw Error('Pinned block changed');
  process.exitCode = code;
} finally { await proxy.close(); }
