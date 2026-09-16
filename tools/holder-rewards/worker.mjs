import fs from 'node:fs';
import path from 'node:path';
import {readProjectEnv,root} from '../environment.mjs';
import {createPublicClient,createWalletClient,defineChain,http,keccak256,parseUnits,decodeEventLog,encodeFunctionData} from '../../apps/web/node_modules/viem/_esm/index.js';
import {privateKeyToAccount} from '../../apps/web/node_modules/viem/_esm/accounts/index.js';
import {DUAL_MODE,supportedMode,streamCheckpointDue,due,fundingDecision,configuredInterval,restartDelay,requireCurrentOperation} from './policy.mjs';
const e=readProjectEnv(process.env.TG_PROFILE||'test');
const execute=process.argv.includes('--execute'),loop=process.argv.includes('--run');
const intervalSeconds=configuredInterval(e.TG_HOLDER_INTERVAL_SECONDS);
if(e.TG_PROFILE!=='test'||Number(e.TG_CHAIN_ID)!==46630)throw Error('Worker activation is limited to the configured test release');
const release=JSON.parse(e.VITE_MARKET_RELEASE_CATALOG)[0];
const rpc=e.TG_HOLDER_RPC_URL||'http://127.0.0.1:18570';
const chain=defineChain({id:46630,name:'Robinhood Testnet',nativeCurrency:{name:'ETH',symbol:'ETH',decimals:18},rpcUrls:{default:{http:[rpc]}}});
const c=createPublicClient({chain,transport:http(rpc,{retryCount:0,timeout:20000}),pollingInterval:5000});
const abi=name=>JSON.parse(fs.readFileSync(path.join(root,`contracts/out-v1/${name}.sol/${name}.json`))).abi;
const read=(name,address,functionName,args=[])=>c.readContract({abi:abi(name),address,functionName,args});
const dir=e.TG_HOLDER_STATE_DIR;if(!dir||!path.isAbsolute(dir))throw Error('Configure TG_HOLDER_STATE_DIR');
fs.mkdirSync(dir,{recursive:true,mode:0o700});
function safe(p){const s=fs.lstatSync(p);if(s.isSymbolicLink()||(s.mode&0o077))throw Error('Unsafe worker file permissions');return JSON.parse(fs.readFileSync(p));}
if(fs.lstatSync(dir).isSymbolicLink()||(fs.statSync(dir).mode&0o077))throw Error('Unsafe worker directory');
const lock=path.join(dir,'worker.lock');
if(fs.existsSync(lock)){const owner=safe(lock);try{process.kill(owner.pid,0);throw Error('Holder worker already running')}catch(err){if(err.code!=='ESRCH')throw err;fs.unlinkSync(lock)}}
fs.writeFileSync(lock,JSON.stringify({pid:process.pid}),{flag:'wx',mode:0o600});
const file=path.join(dir,'journal.json');
const state=fs.existsSync(file)?safe(file):{chainId:46630,releaseId:e.V1_RELEASE_ID,markets:{},transactions:[]};
if(state.chainId!==46630||state.releaseId!==e.V1_RELEASE_ID)throw Error('Worker release mismatch');
const save=()=>{fs.writeFileSync(file+'.tmp',JSON.stringify(state,(_,v)=>typeof v==='bigint'?String(v):v),{mode:0o600});const fd=fs.openSync(file+'.tmp','r');try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.renameSync(file+'.tmp',file);const dd=fs.openSync(dir,'r');try{fs.fsyncSync(dd)}finally{fs.closeSync(dd)}};
const log=(value)=>console.log(JSON.stringify(value));
let account,wallet;
if(execute){if(!e.TG_HOLDER_SIGNER_FILE)throw Error('Configure TG_HOLDER_SIGNER_FILE');account=privateKeyToAccount(safe(e.TG_HOLDER_SIGNER_FILE).privateKey);wallet=createWalletClient({account,chain,transport:http(rpc,{retryCount:0})});}
const minima=JSON.parse(e.TG_HOLDER_MINIMUM_QUOTE_JSON||'{}');
const gasCap=BigInt(e.TG_HOLDER_MAX_TX_GAS_WEI||'1000000000000000');
const dailyCap=BigInt(e.TG_HOLDER_DAILY_GAS_WEI||'10000000000000000');
function capability(row){
 if(!e.TG_HOLDER_CAPABILITY_FILE) return;
 const p=safe(e.TG_HOLDER_CAPABILITY_FILE);
 if(p.chainId!==46630||p.scope!=='AUTHORIZED_TESTNET_SCENARIOS')throw Error('Invalid gateway capability');
 p.senders=[...new Set([...p.senders,account.address.toLowerCase()])];
 if(row)p.transactions=[...p.transactions.filter(t=>t.hash!==row.hash).slice(-398),{hash:row.hash,from:account.address.toLowerCase()}];p.expiresAt=Math.floor(Date.now()/1000)+7200;
 fs.writeFileSync(e.TG_HOLDER_CAPABILITY_FILE+'.tmp',JSON.stringify(p),{mode:0o600});fs.renameSync(e.TG_HOLDER_CAPABILITY_FILE+'.tmp',e.TG_HOLDER_CAPABILITY_FILE);
}
async function settlePending(row){
 requireCurrentOperation(row.operation);
 capability(row);
 let receipt=await c.getTransactionReceipt({hash:row.hash}).catch(()=>null);
 if(!receipt){
  const nonce=await c.getTransactionCount({address:account.address,blockTag:'latest'});
  if(nonce>row.nonce)throw Error('Pending intent nonce consumed; manual reconciliation required');
  // Recovery resends the same durable signed bytes, never a replacement intent.
  try{await c.sendRawTransaction({serializedTransaction:row.raw})}catch(err){if(!/already known|known transaction/i.test(err.shortMessage||''))throw Error('Submission uncertain; exact intent retained')}
  receipt=await c.waitForTransactionReceipt({hash:row.hash,confirmations:2,timeout:55000});
 }else{
  receipt=await c.waitForTransactionReceipt({hash:row.hash,confirmations:2,timeout:55000});
 }
 row.fee=String(receipt.gasUsed*receipt.effectiveGasPrice);row.block=String(receipt.blockNumber);
 if(receipt.status!=='success'){row.status='reverted';delete row.raw;save();throw Error('Holder operation reverted');}
 const expected={sweep:['CurveFeesSwept'],fund:['HolderRewardsQueued'],'fund-meme':['HolderAssetFunded'],checkpoint:[]}[row.operation];
 const holder=['fund','fund-meme','checkpoint'].includes(row.operation);
 const address=holder?release.holderDistributor:release.feeVault;
 const contract=holder?'HolderRewardsDistributorV1':'ProtocolFeeVault';
 // Permissionless checkpoint can become a successful no-op if another caller starts the same batch first.
 const matched=row.operation==='checkpoint'||receipt.logs.some(l=>{if(l.address.toLowerCase()!==address.toLowerCase())return false;try{const event=decodeEventLog({abi:abi(contract),data:l.data,topics:l.topics});return expected?.includes(event.eventName)&&event.args.marketId===row.marketId}catch{return false}});
 if(!matched){row.status='needs_attention';save();throw Error('Expected holder receipt event missing');}
 row.status='success';delete row.raw;save();
 if(state.markets[row.marketId]){state.markets[row.marketId].nextAt=0;state.markets[row.marketId].retry=true;save()}
 log({marketId:row.marketId,operation:row.operation,status:row.status,hash:row.hash});
}
async function send(marketId,operation,name,address,functionName,args){
 requireCurrentOperation(operation);
 if(state.transactions.some(t=>t.status==='needs_attention'))throw Error('Receipt reconciliation required');
 if(!execute){log({marketId,operation,status:'PREVIEW'});return false}
 const pending=state.transactions.find(t=>t.status==='signed');if(pending){await settlePending(pending);throw Error('Recovered pending intent; re-read market before continuing')}
 const [latest,nonce]=await Promise.all(['latest','pending'].map(blockTag=>c.getTransactionCount({address:account.address,blockTag})));if(latest!==nonce)throw Error('Signer has another pending transaction');
 const simulationAbi=abi(name);
 const simulation=await c.simulateContract({account,abi:simulationAbi,address,functionName,args});
 const gas=(await c.estimateContractGas(simulation.request))*13n/10n;
 const fees=await c.estimateFeesPerGas();const maximum=gas*fees.maxFeePerGas;
 const recent=state.transactions.filter(t=>Date.now()-t.at<86400000).reduce((n,t)=>n+BigInt(t.fee??t.reserved),0n);
 if(maximum>gasCap||recent+maximum>dailyCap)throw Error('Holder gas budget reached');
 const data=encodeFunctionData({abi:abi(name),functionName,args});
 const request=await wallet.prepareTransactionRequest({account,chain,to:address,data,value:0n,gas,...fees,nonce});
 const raw=await wallet.signTransaction(request),row={marketId,operation,nonce,raw,hash:keccak256(raw),status:'signed',at:Date.now(),reserved:String(maximum)};
 state.transactions.push(row);save();await settlePending(row);return true;
}
async function market(item){
 const id=item.marketId;
 const v=await read('MarketRegistryV1',release.marketRegistry,'market',[id]);
 if(v.config.memeToken.toLowerCase()!==item.token)throw Error('Market identity mismatch');
 if((await read('ProtocolFeeVault',release.feeVault,'marketRegistry')).toLowerCase()!==release.marketRegistry.toLowerCase())throw Error('Fee vault binding mismatch');
 if(await read('ProtocolFeeVault',release.feeVault,'userClaimMode')!==keccak256(new TextEncoder().encode('TICKERGARDEN_USER_CLAIM_ASSET_SELECTION_V1')))throw Error('Unsupported reward claim mode');
 const quoteAsset=v.config.quoteAsset.toLowerCase();
 const decimals=quoteAsset==='0x0000000000000000000000000000000000000000'?18:await read('IERC20Metadata',quoteAsset,'decimals');
 const minimum=parseUnits(minima[quoteAsset]||'0',Number(decimals));if(minimum<=0n)throw Error('Configure asset dust minimum');
 const now=BigInt((await c.getBlock()).timestamp);
 if(Number(v.runtime.launchPhase)===0){
  const unswept=await read('TickerGardenCurve',v.config.curve,'accruedCurveFees');
  if(unswept>=minimum)await send(id,'sweep','TickerGardenCurve',v.config.curve,'sweepCurveFees',[]);
 }
 if(!v.config.creatorFeesToHolders)return {retry:false,status:'FEES_CHECKED'};
 const distributor=await read('TickerMemeTokenV1',item.token,'holderRewardsDistributor');
 const mode=await read('HolderRewardsDistributorV1',distributor,'rewardMode');
 if(distributor.toLowerCase()!==release.holderDistributor.toLowerCase()||!supportedMode(mode))throw Error('Unsupported distributor');
 const s=await read('HolderRewardsDistributorV1',distributor,'marketState',[id]);
 if(s.token.toLowerCase()!==item.token||s.vault.toLowerCase()!==release.feeVault.toLowerCase()||s.quote.toLowerCase()!==quoteAsset)throw Error('Reward binding mismatch');
 {
  const nextStart=await read('HolderRewardsDistributorV1',distributor,'nextStreamStartAt',[id]);
  let checkpointDue=streamCheckpointDue({mode,idle:s.idle,supply:s.supply,nextStart,now});
  if(mode===DUAL_MODE){
   const ms=await read('HolderRewardsDistributorV1',distributor,'memeMarketState',[id]);
   const mn=await read('HolderRewardsDistributorV1',distributor,'memeNextStreamStartAt',[id]);
   checkpointDue||=streamCheckpointDue({mode,idle:ms.idle,supply:ms.supply,nextStart:mn,now});
  }
  if(checkpointDue)await send(id,'checkpoint','HolderRewardsDistributorV1',distributor,'checkpoint',[id]);
 }
 const meme=await read('ProtocolFeeVault',release.feeVault,'holderLiability',[id,1,item.token]);
 if(mode===DUAL_MODE&&meme>0n&&meme>=parseUnits(minima[item.token]||'1',18)) await send(id,'fund-meme','ProtocolFeeVault',release.feeVault,'fundHolderMemeRewards',[id]);
 const quote=await read('ProtocolFeeVault',release.feeVault,'holderLiability',[id,1,s.quote]);
 const decision=fundingDecision({amount:quote,minimum,mode});
 if(decision==='fund')await send(id,'fund','ProtocolFeeVault',release.feeVault,'fundHolderRewards',[id,1]);
 return {retry:false,status:decision.toUpperCase()};
}
let chainVerified=false;
async function tick(){
 state.lastAttemptAt=new Date().toISOString();if(execute)save();
 if(!chainVerified){if(await c.getChainId()!==46630)throw Error('Wrong RPC chain');chainVerified=true;}
 if(execute)capability(null);
 if(process.argv.includes('--retry-now')){for(const entry of Object.values(state.markets))if(entry.retry)entry.nextAt=0;process.argv=process.argv.filter(a=>a!=='--retry-now')}
 if(state.transactions.some(t=>t.status==='needs_attention'))throw Error('Receipt reconciliation required');
 if(execute){const pending=state.transactions.find(t=>t.status==='signed');if(pending)await settlePending(pending)}
 const response=await fetch(new URL('/v1/holder-maintenance-markets',e.VITE_V1_READ_API_URL||'http://127.0.0.1:8794'),{signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('Candidate API unavailable');const result=await response.json();if(result.chainId!==46630||result.displayOnly!==true||!Array.isArray(result.items))throw Error('Wrong candidate scope');
 for(const item of result.items)due(item,undefined,0);
 state.lastTickAt=new Date().toISOString();if(execute)save();
 let failures=0;
 for(const item of result.items){const now=Math.floor(Date.now()/1000);if(state.markets[item.marketId]?.nextAt>now&&!(process.argv.includes('--preview-all')&&!execute))continue;
  try{const outcome=await market(item);if(execute){state.markets[item.marketId]={revision:item.revision,nextAt:now+intervalSeconds,...outcome};save()}log({marketId:item.marketId,...outcome})}
  catch(error){failures++;log({marketId:item.marketId,status:'RETRY_REQUIRED',reason:error.shortMessage?'RPC_OR_SIMULATION_FAILED':error.message});if(execute){state.markets[item.marketId]={revision:item.revision,nextAt:now+intervalSeconds,retry:true,status:'RETRY_REQUIRED',reason:error.shortMessage?'RPC_OR_SIMULATION_FAILED':error.message};save()}if(state.transactions.some(t=>t.status==='signed'))throw Error('Pending signed intent blocks further sends')}
 }
 state.lastCompletedAt=new Date().toISOString();state.failedMarkets=failures;if(!failures)state.lastSuccessAt=state.lastCompletedAt;delete state.lastError;if(execute)save();
}
let stopping=false,wake;
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopping=true;wake?.()});
const wait=ms=>new Promise(r=>{const timer=setTimeout(r,ms);wake=()=>{clearTimeout(timer);r()}});
try{
 const delay=loop&&!state.transactions.some(t=>t.status==='signed')?restartDelay(state.lastTickAt,Date.now(),intervalSeconds):0;
 if(delay>0){log({status:'WAITING',intervalSeconds,nextCheckAt:new Date(Date.now()+delay).toISOString()});await wait(delay)}
 if(!stopping)do{try{await tick()}catch(error){state.lastError=error.shortMessage?'RPC_OR_SIMULATION_FAILED':error.message;if(execute)save();log({status:'WORKER_RETRY_REQUIRED',reason:error.shortMessage?'RPC_OR_SIMULATION_FAILED':error.message})}if(loop&&!stopping)await wait(state.transactions.some(t=>t.status==='signed')?30000:state.lastError?60000:intervalSeconds*1000);}while(loop&&!stopping);
}finally{fs.unlinkSync(lock)}
