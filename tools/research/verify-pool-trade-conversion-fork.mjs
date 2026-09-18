// All sends and signatures are confined to an ephemeral localhost Anvil fork.
import fs from 'node:fs';import {parseEnv} from 'node:util';import {spawn} from 'node:child_process';
import {createPublicClient,createWalletClient,http,erc20Abi,keccak256} from '../../apps/web/node_modules/viem/_esm/index.js';
import {privateKeyToAccount} from '../../apps/web/node_modules/viem/_esm/accounts/index.js';
import {createPinnedRpcProxy} from '../robinhood-rpc-compat-proxy.mjs';
import {getConversionQuote,conversionRequest,TRADE_NATIVE,TRADE_USDG,PURCHASE_ROUTER,PURCHASE_ROUTER_CODEHASH} from '../../services/backend-ts/packages/chain/src/quote-purchase/conversion.ts';
import {routes} from '../../services/backend-ts/packages/chain/src/quote-purchase/routes.ts';
import {WETH} from '../../services/backend-ts/packages/chain/src/quote-purchase/quote.ts';
import curveAbi from '../../apps/web/src/v1/generated/contracts/legacy/TickerGardenCurve.ts';
const env=parseEnv(fs.readFileSync('/Users/dear/Documents/code/TickerGarden/.env.test.local','utf8'));
const remote=createPublicClient({transport:http(env.ROBINHOOD_RPC_URL,{timeout:30000})});
if(await remote.getChainId()!==4663)throw Error('Wrong fork chain');
const block=await remote.getBlock();
const proxy=await createPinnedRpcProxy({upstreamUrl:env.ROBINHOOD_RPC_URL,expectedChainId:4663,blockNumber:String(block.number),blockHash:block.hash});
const port=18553,child=spawn('/Users/dear/.foundry/bin/anvil',['--host','127.0.0.1','--port',String(port),'--fork-url',proxy.url,'--fork-block-number',String(block.number),'--chain-id','4663','--hardfork','cancun','--silent'],{stdio:'ignore'});
const account=privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const client=createPublicClient({transport:http(`http://127.0.0.1:${port}`,{timeout:60000,retryCount:0})}),wallet=createWalletClient({account,transport:http(`http://127.0.0.1:${port}`)});
const rpc={call:(method,params)=>client.request({method,params})};const results=[];
const send=async request=>{const {request:sim}=await client.simulateContract({...request,account:account.address});const receipt=await client.waitForTransactionReceipt({hash:await wallet.writeContract({...sim,chain:null})});if(receipt.status!=='success')throw Error('Fork transaction reverted');return receipt;};
try{
 for(let i=0;i<60;i++){try{await client.getChainId();break;}catch{await new Promise(r=>setTimeout(r,500));}}
 await client.request({method:'anvil_setCode',params:[account.address,'0x']});await client.request({method:'anvil_setBalance',params:[account.address,'0x56bc75e2d63100000']});
 await client.request({method:'evm_mine',params:[]});
 console.log('Fork ready',String(block.number));
 const code=await client.getCode({address:PURCHASE_ROUTER});if(!code||keccak256(code)!==PURCHASE_ROUTER_CODEHASH)throw Error('Router code changed');
 const aapl='0xaf3d76f1834a1d425780943c99ea8a608f8a93f9';
 const samples=[TRADE_USDG,aapl,...['v3','v4'].flatMap(version=>[WETH,TRADE_NATIVE,TRADE_USDG].flatMap(input=>{const r=Object.values(routes).find(r=>r.version===version&&r.input===input);return r?[r.output]:[];}))];
 for(const token of [...new Set(samples)]){
  const intent={chainId:4663,sellToken:TRADE_NATIVE,buyToken:token,sellAmount:'1000000000000000',taker:account.address};
  console.log('Quoting',token);const q=await getConversionQuote(intent,rpc);console.log('Executing',token);const before=await client.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[account.address]});
  const ethBefore=await client.getBalance({address:account.address});const r=await send(conversionRequest(q,intent));
  const received=await client.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[account.address]})-before;
  const ethAfter=await client.getBalance({address:account.address});if(received<BigInt(q.minBuyAmount)||ethBefore-ethAfter-r.gasUsed*r.effectiveGasPrice!==BigInt(intent.sellAmount))throw Error('Wrong conversion amount or ETH spend');
  results.push({token,version:routes[token]?.version??'v3',input:routes[token]?.input??WETH,received:String(received),status:'PASS'});console.log(JSON.stringify(results.at(-1)));
  if(token===aapl){
   const curve='0x4ae38c1cdea6f4d449385d68470cabd2aaf71a12',seed='0xde47a062ff9870079d3692f603ae6723b4e6adcb';
   await send({address:aapl,abi:erc20Abi,functionName:'approve',args:[curve,received]});
   const failed=await client.waitForTransactionReceipt({hash:await wallet.writeContract({address:curve,abi:curveAbi,functionName:'buy',args:[received,2n**255n,account.address],chain:null,gas:8000000n})});
   if(failed.status!=='reverted'||await client.readContract({address:aapl,abi:erc20Abi,functionName:'balanceOf',args:[account.address]})!==before+received)throw Error('Failed buy did not retain AAPL');
   const quote=await client.readContract({address:curve,abi:curveAbi,functionName:'quoteBuy',args:[received,account.address]});
   await send({address:curve,abi:curveAbi,functionName:'buy',args:[received,quote[0],account.address]});
   const held=await client.readContract({address:seed,abi:erc20Abi,functionName:'balanceOf',args:[account.address]});if(held<quote[0])throw Error('Missing SEED');
   results.push({route:'ETH -> AAPL -> SEED, failed second leg retains AAPL then retry',received:String(held),status:'PASS'});console.log(JSON.stringify(results.at(-1)));
  }
 }
 fs.mkdirSync('outputs/reviews/trade-conversion',{recursive:true});fs.writeFileSync(`outputs/reviews/trade-conversion/pool-fork-${block.number}.json`,JSON.stringify({block:String(block.number),hash:block.hash,broadcast:false,results},null,2));
 console.log(JSON.stringify({status:'PASS',block:String(block.number),broadcast:false,cases:results.length}));
}catch(e){for(let x=e,i=0;x&&i<8;x=x.cause,i++)console.error(String(x.shortMessage??x.message).replaceAll(env.ROBINHOOD_RPC_URL,'[RPC]').slice(0,500));process.exitCode=1;}finally{child.kill();await proxy.close();}
