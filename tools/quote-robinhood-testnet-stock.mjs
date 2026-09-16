import fs from 'node:fs';
import {createPublicClient,http,parseAbi,parseUnits,formatEther} from '../apps/web/node_modules/viem/_esm/index.js';
// Read-only: reuse the executed pool; no website, history, fee-tier discovery or signing.
const manifest=JSON.parse(fs.readFileSync(new URL('../deployments/manifests/robinhood-testnet-46630.stock-swap-routes.json',import.meta.url)));
if(manifest.chainId!==46630||manifest.status!=='EXECUTED_TESTNET_ROUTES'||manifest.rpcGateway!=='http://127.0.0.1:18570')throw Error('Unexpected route manifest');
const [symbol,amount]=process.argv.slice(2);
if(symbol==='--help'){console.log('Usage: node tools/quote-robinhood-testnet-stock.mjs TSLA 1.86\nRead-only exact-output quote through the saved preferred pool. Symbols: '+manifest.routes.map(r=>r.symbol).join(', '));process.exit(0);}
const route=manifest.routes.find(r=>r.symbol===symbol?.toUpperCase());
if(!route||!amount||!/^\d+(\.\d{1,18})?$/.test(amount))throw Error('Specify a supported Stock and positive output amount; use --help');
const output=parseUnits(amount,route.decimals);if(output<=0n||(output>=(1n<<128n)))throw Error('Output outside supported range');
const c=createPublicClient({transport:http(manifest.rpcGateway,{retryCount:0,timeout:20000})});
const abi=parseAbi(['function '+manifest.callSignatures.quote]);
try{
 const [input]=await c.readContract({address:manifest.quoter,abi,functionName:'quoteExactOutputSingle',args:[{tokenIn:route.tokenIn,tokenOut:route.tokenOut,amount:output,fee:route.fee,sqrtPriceLimitX96:0n}]});
 if(input<=0n)throw Error('Invalid quote');
 const max=(input*BigInt(10000+manifest.execution.slippageBps)+9999n)/10000n;
 console.log(JSON.stringify({chainId:46630,symbol:route.symbol,pool:route.pool,fee:route.fee,outputRaw:output.toString(),nativeInputWei:input.toString(),nativeInputETH:formatEther(input),maxNativeInputWei:max.toString(),quotedAt:new Date().toISOString(),note:'Informational quote only; obtain a current quote and simulate a fresh intent before signing.'},null,2));
}catch{throw Error('Saved route quote unavailable. No alternate pools or history were queried. Review saved alternatives in stock-swap-routes.json before expanding discovery.');}
