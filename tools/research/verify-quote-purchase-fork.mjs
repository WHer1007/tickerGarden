import {productionRuntime} from '../../services/backend-ts/packages/runtime-deployment/src/production.generated.ts';
import factoryAbi from '../../apps/web/src/v1/generated/contracts/current/TickerGardenFactoryV1.ts';
import launchAbi from '../../apps/web/src/v1/generated/contracts/current/LaunchAndBuyRouter.ts';
// Local fork only. The upstream proxy rejects all transaction submission methods.
import fs from 'node:fs';import {parseEnv} from 'node:util';import {spawn} from 'node:child_process';
import {createPublicClient,createWalletClient,http,erc20Abi,keccak256} from '../../apps/web/node_modules/viem/_esm/index.js';
import {privateKeyToAccount} from '../../apps/web/node_modules/viem/_esm/accounts/index.js';
import {createPinnedRpcProxy} from '../robinhood-rpc-compat-proxy.mjs';
import {quotePurchase} from '../../services/backend-ts/packages/chain/src/quote-purchase/quote.ts';
import {purchaseRequest,PURCHASE_ROUTER} from '../../services/backend-ts/packages/chain/src/quote-purchase/transaction.ts';
const env=parseEnv(fs.readFileSync('/Users/dear/Documents/code/TickerGarden/.env.test.local','utf8'));
const remote=createPublicClient({transport:http(env.ROBINHOOD_RPC_URL,{timeout:30000})});
const block=await remote.getBlock({blockTag:'latest'});
const proxy=await createPinnedRpcProxy({upstreamUrl:env.ROBINHOOD_RPC_URL,expectedChainId:4663,blockNumber:String(block.number),blockHash:block.hash});
const port=18549;const child=spawn('/Users/dear/.foundry/bin/anvil',['--host','127.0.0.1','--port',String(port),'--fork-url',proxy.url,'--fork-block-number',String(block.number),'--chain-id','4663','--silent'],{stdio:'ignore'});
const client=createPublicClient({transport:http(`http://127.0.0.1:${port}`,{retryCount:0,timeout:60000})});
const account=privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const wallet=createWalletClient({account,transport:http(`http://127.0.0.1:${port}`)});
const results=[];
try{
 for(let i=0;i<60;i++){try{await client.getChainId();break;}catch{await new Promise(r=>setTimeout(r,500));}}
 await client.request({method:'evm_mine'});
 console.log('fork',String(block.number),'router hash',keccak256(await client.getCode({address:PURCHASE_ROUTER})));
 const raw=JSON.parse(fs.readFileSync(new URL('../../outputs/reviews/rh-buy-routes-2026-09-16/fixed-route-candidates.json',import.meta.url)));
 const sample=process.env.TG_ALL_ROUTES==='1'?raw.assets.filter(a=>a.primary):(process.env.TG_FORK_SYMBOLS??'P,CRM,ON,DELL').split(',').map(s=>raw.assets.find(a=>a.symbol===s));
 sample.push({symbol:'USDG',stock:'0x5fc5360d0400a0fd4f2af552add042d716f1d168',exactOutputProbe:{requestedAmount:'100000000'}});
 for(const a of sample){const snap=await client.request({method:'evm_snapshot'});try{
  const liveQuote=await quotePurchase({call:(method,params)=>client.request({method,params})},a.stock,a.exactOutputProbe.requestedAmount);
  const q=process.env.TG_CAP_DRIFT==='1'?{...liveQuote,amountIn:String(BigInt(liveQuote.amountIn)*98n/100n),stockInput:String(BigInt(liveQuote.stockInput)*98n/100n)}:liveQuote;
 const req=purchaseRequest(q,account.address,Number((await client.getBlock()).timestamp)*1000);
  const before=await client.readContract({address:a.stock,abi:erc20Abi,functionName:'balanceOf',args:[account.address]});
  const badQuote={...q,amountIn:String(BigInt(q.amountIn)/2n),...(q.stockInput===q.amountIn?{stockInput:String(BigInt(q.stockInput)/2n)}:{})};
  const bad=purchaseRequest(badQuote,account.address,Number((await client.getBlock()).timestamp)*1000);
  const rejected=await client.waitForTransactionReceipt({hash:await wallet.writeContract({...bad,chain:null,gas:1500000n})});
  const unchanged=await client.readContract({address:a.stock,abi:erc20Abi,functionName:'balanceOf',args:[account.address]});
  if(rejected.status!=='reverted'||unchanged!==before)throw Error('Purchase cap did not roll back atomically');
  const ethBefore=await client.getBalance({address:account.address});
  const hash=await wallet.writeContract({...req,chain:null,gas:4000000n});
  const receipt=await client.waitForTransactionReceipt({hash});
  const after=await client.readContract({address:a.stock,abi:erc20Abi,functionName:'balanceOf',args:[account.address]});
  const ethAfter=await client.getBalance({address:account.address});
  const actualSpent=ethBefore-ethAfter-receipt.gasUsed*receipt.effectiveGasPrice;
  if(actualSpent>req.value)throw Error('ETH cap exceeded');
  const held=await client.getBalance({address:PURCHASE_ROUTER});
  if(receipt.status!=='success'||after-before!==BigInt(q.amountOut)||held!==0n)throw Error('Execution or balance assertion failed');
  if(a.symbol==='CRM'){
   const rt=productionRuntime.runtime,factory=rt.TickerGardenFactoryV1.address,launch=rt.LaunchAndBuyRouter.address;
   const config=productionRuntime.configs.find(c=>c.kind==='quote'&&c.values.quoteAsset===a.stock);
   const zero='0x'+'0'.repeat(64);
   const params={assetUid:zero,tickerGardenBaselineId:config.values.tickerGardenBaselineId,quoteAssetConfigId:config.id,launchTemplateId:productionRuntime.configs.find(c=>c.kind==='template').id,expectedEconomics:zero,creatorRevenueBeneficiary:account.address,name:'Local ETH funding acceptance',symbol:'LOCAL',metadataURI:'ipfs://local-only',salt:'0x'+'9'.repeat(64),creatorTaxBps:0,creatorFeesToHolders:false,stakingEnabled:false,burnMemeFees:false,lpFeePips:0};
   params.expectedEconomics=await client.readContract({address:factory,abi:factoryAbi,functionName:'previewMarketEconomics',args:[params],account:account.address});
   const predicted=await client.readContract({address:factory,abi:factoryAbi,functionName:'predictMarketAddresses',args:[account.address,params]});
   await client.waitForTransactionReceipt({hash:await wallet.writeContract({chain:null,address:a.stock,abi:erc20Abi,functionName:'approve',args:[launch,BigInt(q.amountOut)]})});
   const launchRequest={chain:null,address:launch,abi:launchAbi,functionName:'launchAndBuy',args:[params,BigInt(q.amountOut),1n,account.address],value:500000000000000n};
   const failed=await client.waitForTransactionReceipt({hash:await wallet.writeContract({...launchRequest,args:[params,BigInt(q.amountOut),2n**255n,account.address],gas:10000000n})});
   const retained=await client.readContract({address:a.stock,abi:erc20Abi,functionName:'balanceOf',args:[account.address]});
   if(failed.status!=='reverted'||retained!==after)throw Error('Failed launch did not retain purchased quote');
   const simulation=await client.simulateContract({...launchRequest,account:account.address});
   launchRequest.args[2]=simulation.result[2];
   const receipt=await client.waitForTransactionReceipt({hash:await wallet.writeContract({...launchRequest,gas:10000000n})});
   const tokens=await client.readContract({address:predicted[1],abi:erc20Abi,functionName:'balanceOf',args:[account.address]});
   if(receipt.status!=='success'||tokens<simulation.result[2])throw Error('Launch and first buy failed');
   results.push({symbol:a.symbol,status:'PASS',step:'PURCHASE_APPROVE_FAILED_LAUNCH_RETAIN_AND_RETRY_BUY',tokensReceived:String(tokens)});console.log('CRM full launch PASS');
  }
  results.push({symbol:a.symbol,status:'PASS',gas:String(receipt.gasUsed),underfundedPurchaseReverted:true,received:String(after-before),maximumEth:String(req.value),actualEthSpent:String(actualSpent),quoteDrift:process.env.TG_CAP_DRIFT==='1'});console.log(a.symbol,'PASS',String(receipt.gasUsed));
 }catch(e){results.push({symbol:a.symbol,status:'FAIL',error:e.shortMessage??e.message});console.log(a.symbol,'FAIL',String(e.message).replaceAll(env.ROBINHOOD_RPC_URL,'[RPC]').slice(0,5000));}finally{await client.request({method:'evm_revert',params:[snap]});}}
 fs.mkdirSync('outputs/reviews/quote-purchase-integration',{recursive:true});fs.writeFileSync('outputs/reviews/quote-purchase-integration/fork-'+String(block.number)+'.json',JSON.stringify({chainId:4663,block:String(block.number),hash:block.hash,broadcast:false,results},null,2));
 if(results.some(r=>r.status==='FAIL'))process.exitCode=1;
}finally{child.kill();await proxy.close();}
