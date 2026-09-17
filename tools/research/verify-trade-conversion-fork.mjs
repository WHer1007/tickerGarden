// Read-only upstream; all signatures and sends stay on an ephemeral LOCAL Anvil fork.
import fs from 'node:fs';import {parseEnv} from 'node:util';import {spawn} from 'node:child_process';
import {createPublicClient,createWalletClient,http,erc20Abi} from '../../apps/web/node_modules/viem/_esm/index.js';
import {privateKeyToAccount} from '../../apps/web/node_modules/viem/_esm/accounts/index.js';
import {createPinnedRpcProxy} from '../robinhood-rpc-compat-proxy.mjs';
import {getConversionQuote,conversionRequest,TRADE_NATIVE,TRADE_USDG,ALLOWANCE_HOLDER,SETTLER_REGISTRY,registryAbi,conversionSettler} from '../../services/backend-ts/packages/chain/src/quote-purchase/zeroex.ts';
import {productionRuntime} from '../../services/backend-ts/packages/runtime-deployment/src/production.generated.ts';
import factoryAbi from '../../apps/web/src/v1/generated/contracts/current/TickerGardenFactoryV1.ts';
import curveAbi from '../../apps/web/src/v1/generated/contracts/legacy/TickerGardenCurve.ts';
const env=parseEnv(fs.readFileSync('/Users/dear/Documents/code/TickerGarden/.env.test.local','utf8'));
const keys=parseEnv(fs.readFileSync('/Users/dear/Documents/code/TickerGarden/.env.master.local','utf8'));
const remote=createPublicClient({transport:http(env.ROBINHOOD_RPC_URL,{timeout:30000})});
const account=privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const first=await getConversionQuote({chainId:4663,sellToken:TRADE_NATIVE,buyToken:TRADE_USDG,sellAmount:'10000000000000000',taker:account.address},keys.ZEROX_API_KEY);
if(!first.blockNumber)throw Error('Quote block missing');
const firstRequest=conversionRequest(first,first);
const block=await remote.getBlock({blockNumber:BigInt(first.blockNumber)});
const proxy=await createPinnedRpcProxy({upstreamUrl:env.ROBINHOOD_RPC_URL,expectedChainId:4663,blockNumber:String(block.number),blockHash:block.hash});
const port=18551;const child=spawn('/Users/dear/.foundry/bin/anvil',['--host','127.0.0.1','--port',String(port),'--fork-url',proxy.url,'--fork-block-number',String(block.number),'--chain-id','4663','--silent'],{stdio:'ignore'});
const client=createPublicClient({transport:http(`http://127.0.0.1:${port}`,{timeout:60000,retryCount:0})});
const wallet=createWalletClient({account,transport:http(`http://127.0.0.1:${port}`)});
const results=[];
const send=async request=>{console.log('sending',request.functionName);const {request:simulated}=await client.simulateContract({...request,account:account.address});const r=await client.waitForTransactionReceipt({hash:await wallet.writeContract({...simulated,chain:null})});if(r.status!=='success')throw Error('Local transaction reverted');return r;};
try{
 for(let n=0;n<60;n++){try{await client.getChainId();break;}catch{await new Promise(r=>setTimeout(r,500));}}
 await client.request({method:'anvil_setCode',params:[account.address,'0x']});await client.request({method:'anvil_setBalance',params:[account.address,'0x56bc75e2d63100000']});
 await client.request({method:'evm_mine'});
 const registered=await client.readContract({address:SETTLER_REGISTRY,abi:registryAbi,functionName:'ownerOf',args:[2n]});const previous=await client.readContract({address:SETTLER_REGISTRY,abi:registryAbi,functionName:'prev',args:[2n]});if(![registered.toLowerCase(),previous.toLowerCase()].includes(conversionSettler(first).toLowerCase()))throw Error('Unregistered Settler');
 await send(firstRequest);
 const balance=await client.readContract({address:TRADE_USDG,abi:erc20Abi,functionName:'balanceOf',args:[account.address]});if(balance<BigInt(first.minBuyAmount))throw Error('Missing converted USDG');
 results.push({route:'ETH -> USDG',status:'PASS',received:String(balance)});
 // Execute the second leg through a production Factory-created USDG curve on this fork.
 const rt=productionRuntime.runtime,factory=rt.TickerGardenFactoryV1.address;
 const config=productionRuntime.configs.find(c=>c.kind==='quote'&&c.values.quoteAsset===TRADE_USDG);
 const zero='0x'+'0'.repeat(64);
 const params={assetUid:zero,tickerGardenBaselineId:config.values.tickerGardenBaselineId,quoteAssetConfigId:config.id,launchTemplateId:productionRuntime.configs.find(c=>c.kind==='template').id,expectedEconomics:zero,creatorRevenueBeneficiary:account.address,name:'Local conversion acceptance',symbol:'LOCAL',metadataURI:'ipfs://local-only',salt:'0x'+'8'.repeat(64),creatorTaxBps:0,creatorFeesToHolders:false,stakingEnabled:false,burnMemeFees:false,lpFeePips:0};
 params.expectedEconomics=await client.readContract({address:factory,abi:factoryAbi,functionName:'previewMarketEconomics',args:[params],account:account.address});
 const predicted=await client.readContract({address:factory,abi:factoryAbi,functionName:'predictMarketAddresses',args:[account.address,params]});
 await send({address:factory,abi:factoryAbi,functionName:'createMarket',args:[params],value:500000000000000n});
 const curve=predicted[2],token=predicted[1];
 // Factory predicts (marketId, memeToken, curve).
 await send({address:TRADE_USDG,abi:erc20Abi,functionName:'approve',args:[curve,BigInt(first.minBuyAmount)]});
 const entry=curveAbi.find(f=>f.type==='function'&&f.name==='buy');
 if(!entry)throw Error('Curve buy entry missing');
 console.log('curve buy inputs',entry.inputs.map(x=>x.name).join(','));
 const quote=await client.readContract({address:curve,abi:curveAbi,functionName:'quoteBuy',args:[BigInt(first.minBuyAmount),account.address]});
 // Same request shape as web buildCurveBuyRequest.
 const buy={address:curve,abi:curveAbi,functionName:'buy',args:[BigInt(first.minBuyAmount),quote[0],account.address]};
 const failed=await client.waitForTransactionReceipt({hash:await wallet.writeContract({...buy,args:[BigInt(first.minBuyAmount),2n**255n,account.address],chain:null,gas:8000000n})});
 if(failed.status!=='reverted'||await client.readContract({address:TRADE_USDG,abi:erc20Abi,functionName:'balanceOf',args:[account.address]})!==balance)throw Error('Failed buy did not retain converted asset');
 await send(buy);const received=await client.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[account.address]});if(received<quote[0])throw Error('Missing project tokens');
 results.push({route:'0x conversion -> failed curve buy -> retry curve buy',status:'PASS',received:String(received)});
 const reverse=await getConversionQuote({chainId:4663,sellToken:TRADE_USDG,buyToken:TRADE_NATIVE,sellAmount:'100000',taker:account.address},keys.ZEROX_API_KEY);
 await send({address:TRADE_USDG,abi:erc20Abi,functionName:'approve',args:[ALLOWANCE_HOLDER,100000n]});
 const ethBefore=await client.getBalance({address:account.address});const rr=await send(conversionRequest(reverse,reverse));const ethAfter=await client.getBalance({address:account.address});
 if(ethAfter-ethBefore+rr.gasUsed*rr.effectiveGasPrice<BigInt(reverse.minBuyAmount))throw Error('Native conversion below minimum');
 results.push({route:'USDG -> ETH',status:'PASS'});
 console.log(JSON.stringify({block:String(block.number),broadcast:false,results}));
 fs.mkdirSync('outputs/reviews/trade-conversion',{recursive:true});fs.writeFileSync(`outputs/reviews/trade-conversion/fork-${block.number}.json`,JSON.stringify({block:String(block.number),hash:block.hash,broadcast:false,results},null,2));
}catch(e){let x=e;for(let i=0;x&&i<8;i++,x=x.cause)console.error(x.name,String(x.details??x.shortMessage??x.message??'').replaceAll(env.ROBINHOOD_RPC_URL,'[RPC]').slice(0,700));process.exitCode=1;}finally{child.kill();await proxy.close();}
