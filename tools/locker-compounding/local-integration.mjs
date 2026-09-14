// Dedicated localhost Anvil fixture replay. Never accepts an external RPC URL.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createPublicClient,createWalletClient,defineChain,http,keccak256,parseAbi} from '../../apps/web/node_modules/viem/_esm/index.js';
import {privateKeyToAccount} from '../../apps/web/node_modules/viem/_esm/accounts/index.js';
import {preview,executeOnce,json} from './runtime.mjs';
const dir=path.resolve('.codex_tmp/locker-runtime');
const chain=defineChain({id:31337,name:'Dedicated local Locker fixture',nativeCurrency:{name:'ETH',symbol:'ETH',decimals:18},rpcUrls:{default:{http:['http://127.0.0.1:18676']}}});
const client=createPublicClient({chain,transport:http(chain.rpcUrls.default.http[0])});
assert.equal(await client.getChainId(),31337);
assert.match(await client.request({method:'web3_clientVersion'}),/anvil/i);
const alloc=JSON.parse(fs.readFileSync(path.join(dir,'alloc.json')));
for(const [address,a]of Object.entries(alloc)){
 if(a.code)await client.request({method:'anvil_setCode',params:[address,a.code]});
 if(a.balance)await client.request({method:'anvil_setBalance',params:[address,a.balance]});
 for(const [slot,value]of Object.entries(a.storage||{}))await client.request({method:'anvil_setStorageAt',params:[address,slot,value]});
}
const timestamp=Number((await client.getBlock()).timestamp)+1;
await client.request({method:'evm_setNextBlockTimestamp',params:[Math.max(timestamp,1800000100)]});
await client.request({method:'evm_mine'});
const m={...JSON.parse(fs.readFileSync(path.join(dir,'addresses.json'))),chainId:31337,releaseId:'0x'+'12'.repeat(32),codeHashes:{},minLiquidity:'1',maxGasWei:'100000000000000000',bufferBps:50,confirmations:1};
await client.request({method:'anvil_setCode',params:[m.executor,m.executorCode]});
for(const k of ['locker','registry','executor','positionManager','poolManager'])m.codeHashes[k]=keccak256(await client.getBytecode({address:m[k]}));
const wallet=createWalletClient({chain,account:privateKeyToAccount('0x'+'0'.repeat(63)+'1'),transport:http(chain.rpcUrls.default.http[0])});
assert.equal(wallet.account.address.toLowerCase(),m.keeper.toLowerCase());
const abi=parseAbi(['function getPositionLiquidity(uint256) view returns(uint128)']);
const before=await client.readContract({address:m.positionManager,abi,functionName:'getPositionLiquidity',args:[1n]});
const plan=await preview(client,m);assert.equal(plan.status,'ready');
let durable=null;const save=async j=>{durable=JSON.parse(json(j));fs.writeFileSync(path.join(dir,'journal.json'),json(j),{mode:0o600});};
const journal={chainId:31337,keeper:m.keeper,pending:null};
const outcome=await executeOnce(client,wallet,m,journal,save);
assert.equal(outcome.status,'confirmed');assert.equal(durable.pending,null);
const after=await client.readContract({address:m.positionManager,abi,functionName:'getPositionLiquidity',args:[1n]});
assert.equal(after-before,BigInt(outcome.plan.liquidity));
const result={scope:'local imported fixture: real Locker/PoolManager/PositionManager; fixture Registry/Executor/Permit2/tokens; LP fee growth seeded with v4 donate',status:outcome.status,transactionHash:outcome.hash,gasWei:outcome.gasWei,beforeLiquidity:before,afterLiquidity:after,liquidityAdded:after-before,remaining:await preview(client,m)};
fs.writeFileSync(process.env.TG_LOCAL_LOCKER_EVIDENCE ?? 'docs/reviews/evidence/lp-runtime-gas-2026-09-13/local-integration.json',json(result)+'\n');
console.log(json({status:result.status,transactionHash:result.transactionHash,liquidityAdded:result.liquidityAdded}));
