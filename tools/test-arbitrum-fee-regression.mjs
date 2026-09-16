import fs from 'node:fs';
import path from 'node:path';
import {
  createPublicClient, createWalletClient, http, parseEther, formatEther, keccak256, toBytes,
  encodeFunctionData, encodeDeployData, encodeAbiParameters, getContractAddress, decodeErrorResult, decodeEventLog,
} from '../apps/web/node_modules/viem/_esm/index.js';
import {generatePrivateKey, privateKeyToAccount} from '../apps/web/node_modules/viem/_esm/accounts/index.js';
import {arbitrumSepolia} from '../apps/web/node_modules/viem/_esm/chains/index.js';

// Resumable test-only runner. Private keys never enter repository artifacts or console output.
const mode = process.argv[2];
if (!['prepare', 'run'].includes(mode)) throw Error('Expected prepare or run');
const expectedAdmin = '0xA6c3298a5559544c3b4cf8e6DC5f349f4be524ea';
const walletDir = '/Users/dear/.config/tickergarden/testnet-wallets';
const secretPath = path.join(walletDir, 'arbitrum-sepolia-r3-roles.json');
const out = 'outputs/reviews/arbitrum-r4-fix/public-regression';
fs.mkdirSync(out, {recursive: true});
function secretRead(file) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || (stat.mode & 0o077)) throw Error('Unsafe wallet permissions');
  return JSON.parse(fs.readFileSync(file));
}
const adminWallet = secretRead(path.join(walletDir, 'arbitrum-sepolia.json'));
const admin = privateKeyToAccount(adminWallet.privateKey);
if (adminWallet.chainId !== 421614 || admin.address.toLowerCase() !== expectedAdmin.toLowerCase()) throw Error('Wrong admin');
if (!fs.existsSync(secretPath)) {
  const roles = Object.fromEntries(['creator', 'buyer', 'staker', 'outsider'].map(role => {
    const privateKey = generatePrivateKey(); return [role, {address: privateKeyToAccount(privateKey).address, privateKey}];
  }));
  fs.writeFileSync(secretPath, JSON.stringify({chainId:421614, roles}), {mode:0o600, flag:'wx'});
}
const saved = secretRead(secretPath);
if (saved.chainId !== 421614) throw Error('Wrong role chain');
const accounts = {admin, ...Object.fromEntries(Object.entries(saved.roles).map(([role,w]) => [role,privateKeyToAccount(w.privateKey)]))};
const publicRoles = Object.fromEntries(Object.entries(accounts).map(([role,a]) => [role,a.address]));
fs.writeFileSync(out+'/roles.json', JSON.stringify({chainId:421614,roles:publicRoles},null,2)+'\n');
if (mode === 'prepare') {console.log(JSON.stringify({roles:publicRoles,secretFile:secretPath}));process.exit(0);}
const p = JSON.parse(fs.readFileSync('deployments/manifests/arbitrum-sepolia-421614.v1.deployed.json'));
const active = JSON.parse(fs.readFileSync('deployments/manifests/arbitrum-sepolia-421614.v1.activation.json'));
if (p.chainId!==421614 || p.releaseId!==active.releaseId || !p.contracts.some(x=>x.name==='TickerGardenBaselineRegistry')) throw Error('Wrong release');
const c=createPublicClient({chain:arbitrumSepolia,transport:http('https://sepolia-rollup.arbitrum.io/rpc')});
if (await c.getChainId()!==421614) throw Error('Wrong RPC chain');
const clients=Object.fromEntries(Object.entries(accounts).map(([role,account])=>[role,createWalletClient({account,chain:arbitrumSepolia,transport:http('https://sepolia-rollup.arbitrum.io/rpc')})]));
const statePath=out+'/results.json';
const state=fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath)):{chainId:421614,releaseId:p.releaseId,transactions:[],checks:[],markets:{}};
if(state.releaseId!==p.releaseId)throw Error('Scenario release changed');
const save=()=>{const temporary=statePath+'.tmp';fs.writeFileSync(temporary,JSON.stringify(state,(_,v)=>typeof v==='bigint'?String(v):v,2)+'\n');fs.renameSync(temporary,statePath);};
const record=(id,detail)=>{if(state.checks.some(x=>x.id===id&&x.status==='PASS'))return;state.checks=state.checks.filter(x=>x.id!==id);state.checks.push({id,status:'PASS',detail,at:new Date().toISOString()});save();console.log('PASS '+id);};
const artifact=n=>JSON.parse(fs.readFileSync(`contracts/out-v1/${n}.sol/${n}.json`));
const zero='0x0000000000000000000000000000000000000000',z32='0x'+'00'.repeat(32),hash=s=>keccak256(toBytes(s));
const read=(name,address,functionName,args=[])=>c.readContract({address,abi:artifact(name).abi,functionName,args});
async function send(id,role,to,data='0x',value=0n){
  let t=state.transactions.find(t=>t.id===id);
  if(t && (t.inputHash!==keccak256(data)||t.to!==to||t.role!==role||BigInt(t.value)!==value))throw Error('Changed transaction '+id);
  if(!t){
    const account=accounts[role], nonce=await c.getTransactionCount({address:account.address,blockTag:'pending'});
    const gas=await c.estimateGas({account:account.address,to,data,value});const fees=await c.estimateFeesPerGas();
    const gasLimit=gas*13n/10n;
    if(gasLimit*fees.maxFeePerGas>parseEther('0.01') || value>parseEther('0.55'))throw Error('Per-transaction test budget exceeded');
    if(value+gasLimit*fees.maxFeePerGas>await c.getBalance({address:account.address}))throw Error('Insufficient balance '+role);
    const req=await clients[role].prepareTransactionRequest({account,to,data,value,nonce,gas:gasLimit,...fees});
    const signed=await clients[role].signTransaction(req);
    t={id,role,to,value:String(value),inputHash:keccak256(data),nonce,hash:keccak256(signed),status:'SIGNED'};state.transactions.push(t);save();
    await c.sendRawTransaction({serializedTransaction:signed});t.status='SUBMITTED';save();
  }
  const receipt=await c.waitForTransactionReceipt({hash:t.hash,confirmations:2,timeout:120000});
  t.status=receipt.status==='success'?'CONFIRMED':'REVERTED';t.blockNumber=String(receipt.blockNumber);t.gasUsed=String(receipt.gasUsed);t.gasCostWei=String(receipt.gasUsed*receipt.effectiveGasPrice);save();
  if(receipt.status!=='success')throw Error('Reverted '+id);return receipt;
}
const call=(id,role,name,address,fn,args=[],value=0n)=>send(id,role,address,encodeFunctionData({abi:artifact(name).abi,functionName:fn,args}),value);
async function deadline(id){state.deadlines??={};if(!state.transactions.some(t=>t.id===id)){state.deadlines[id]=String((await c.getBlock()).timestamp+240n);save();}return BigInt(state.deadlines[id]);}

async function deploy(id,name,args=[]){
  const prior=state.transactions.find(t=>t.id===id);const nonce=prior?.nonce??await c.getTransactionCount({address:admin.address,blockTag:'pending'});
  const address=getContractAddress({from:admin.address,nonce:BigInt(nonce)});
  await send(id,'admin',undefined,encodeDeployData({abi:artifact(name).abi,bytecode:artifact(name).bytecode.object,args}));return address;
}
async function rejects(id,role,name,address,fn,args=[],value=0n){
  if(state.checks.some(x=>x.id===id&&x.status==='PASS'))return;
  let reverted=false, errorName;
  try{await c.simulateContract({account:accounts[role].address,address,abi:artifact(name).abi,functionName:fn,args,value});}
  catch(e){let x=e,raw;while(x){if(typeof x.data==='string'&&x.data.startsWith('0x'))raw=x.data;x=x.cause;}if(!raw)throw Error('No EVM revert evidence for '+id);try{errorName=decodeErrorResult({abi:artifact(name).abi,data:raw}).errorName;}catch{errorName=raw.slice(0,10);}reverted=true;}
  if(!reverted)throw Error('Expected failure '+id);record(id,{type:'eth_call_revert',errorName});
}
const [access,stocks,quotes,,templates,,tokenImpl,curveImpl,gaugeImpl,router,registry,creators,manager,vault,distributor,fees]=p.ordinaryComponents;
const check=(condition,message)=>{if(!condition)throw Error(message);};
const done=id=>state.checks.some(x=>x.id===id&&x.status==='PASS');
async function exactReject(id,role,fn,args,expected){
 if(done(id))return;
 let actual;
 try{await c.simulateContract({account:accounts[role].address,address:fees,abi:artifact('ProtocolFeeVault').abi,functionName:fn,args});}
 catch(e){let x=e,raw;while(x){if(typeof x.data==='string'&&x.data.startsWith('0x'))raw=x.data;x=x.cause;}if(raw)actual=decodeErrorResult({abi:artifact('ProtocolFeeVault').abi,data:raw}).errorName;}
 check(actual===expected,`${id}: expected ${expected}, received ${actual??'no EVM revert'}`);record(id,{type:'eth_call_revert',error:actual});
}
async function claims(id,m,assets=[zero]){
 if(done(id))return;
 state.claimSnapshots??={};
 if(!state.claimSnapshots[id]){
   const balances=[];
   for(const asset of assets){const creator=await read('ProtocolFeeVault',fees,'creatorLiability',[m.id,1,asset]),platform=await read('ProtocolFeeVault',fees,'liability',[m.id,asset,2]);
    const balance=async address=>asset===zero?c.getBalance({address}):read('TickerMemeTokenV1',asset,'balanceOf',[address]);
    balances.push({asset,creator:String(creator),platform:String(platform),creatorBalance:String(await balance(accounts.creator.address)),platformBalance:String(await balance(p.platformTreasury))});}
   state.claimSnapshots[id]=balances;save();
 }
 for(const s of state.claimSnapshots[id]){
   check(BigInt(s.platform)>0n,'missing platform fee '+id);
   if(s.asset!==m.token)check(BigInt(s.creator)>0n,'missing creator quote '+id);
   if(s.asset!==m.token)await call(id+'-creator-'+s.asset,'outsider','ProtocolFeeVault',fees,'claimCreator',[m.id,1,s.asset]);
   else {check(BigInt(s.creator)===0n,'creator meme must first convert');await exactReject(id+'-raw-meme-gate','creator','claimCreator',[m.id,1,s.asset],'OriginalRewardExitNotReady');}
   await call(id+'-platform-'+s.asset,'outsider','ProtocolFeeVault',fees,'claimPlatform',[m.id,s.asset]);
   const balance=async address=>s.asset===zero?c.getBalance({address}):read('TickerMemeTokenV1',s.asset,'balanceOf',[address]);
   check(await balance(accounts.creator.address)===BigInt(s.creatorBalance)+BigInt(s.creator),'creator balance delta '+id);
   check(await balance(p.platformTreasury)===BigInt(s.platformBalance)+BigInt(s.platform),'platform balance delta '+id);
   check(await read('ProtocolFeeVault',fees,'creatorLiability',[m.id,1,s.asset])===0n,'creator uncleared');
   check(await read('ProtocolFeeVault',fees,'liability',[m.id,s.asset,2])===0n,'platform uncleared');
   const repeats=[['claimPlatform',[m.id,s.asset]]];if(s.asset!==m.token)repeats.push(['claimCreator',[m.id,1,s.asset]]);
   for(const [fn,args]of repeats){
    const sim=await c.simulateContract({account:accounts.outsider.address,address:fees,abi:artifact('ProtocolFeeVault').abi,functionName:fn,args});check(sim.result===0n,'repeat claim not zero');
   }
 }
 record(id,{gauge:m.gauge,exactRecipientDeltas:true,liabilitiesCleared:true,repeatClaimsZero:true,assets});
}
async function erc20CurveRegression(){
 const quote=JSON.parse(fs.readFileSync('outputs/reviews/arbitrum-r3-scenarios/results.json')).activeStock;
 check(keccak256(await c.getCode({address:quote}))===keccak256(artifact('ArbitrumActiveScenarioStock').deployedBytecode.object),'Synthetic quote source drift');
 state.testQuote=quote;save();
 const quoteId=keccak256(encodeAbiParameters([{type:'bytes32'},{type:'uint256'},{type:'uint256'},{type:'bytes32'},{type:'address'},{type:'uint8'},{type:'uint256'},{type:'uint256'}],[hash('TICKERGARDEN_V1_QUOTE_ECONOMICS'),1n,421614n,active.baselineId,quote,18,parseEther('40'),parseEther('100')]));
 await call('whitelist-erc20-test-quote','admin','ApprovedQuoteRegistry',quotes,'addQuoteConfig',[quoteId,{tickerGardenBaselineId:active.baselineId,quoteAsset:quote,quoteDecimals:18,phantomQuote:parseEther('40'),graduationThreshold:parseEther('100'),economicsHash:quoteId,status:1}]);
 await call('fund-erc20-creator','staker','ArbitrumActiveScenarioStock',quote,'transfer',[accounts.creator.address,parseEther('5')]);
 await call('approve-erc20-router','creator','ArbitrumActiveScenarioStock',quote,'approve',[router,parseEther('2')]);
 const launchFee=await read('TickerGardenFactoryV1',p.factory,'launchFee');
 for(const [sharing,tax]of [[false,0],[true,500]]){
  const key=`erc20-no-stake-holder-${sharing}-tax-${tax}`;
  if(!state.markets[key]){
   const params={...state.markets['no-stake-holder-false-tax-0'].params,quoteAssetConfigId:quoteId,salt:hash(p.releaseId+key),creatorTaxBps:tax,creatorFeesToHolders:sharing,name:'TickerGarden ERC20 Fee Regression',symbol:'tgQREG'};
   params.expectedEconomics=await c.readContract({account:accounts.creator.address,address:p.factory,abi:artifact('TickerGardenFactoryV1').abi,functionName:'previewMarketEconomics',args:[params]});
   const sim=await c.simulateContract({account:accounts.creator.address,address:router,abi:artifact('LaunchAndBuyRouter').abi,functionName:'launchAndBuy',args:[params,parseEther('1'),1n,accounts.creator.address],value:launchFee});state.markets[key]={id:sim.result[0],token:sim.result[1],params};save();
  }
  const m=state.markets[key];
  await call('launch-'+key,'creator','LaunchAndBuyRouter',router,'launchAndBuy',[m.params,parseEther('1'),1n,accounts.creator.address],launchFee);
  const v=await read('MarketRegistryV1',registry,'market',[m.id]);m.curve=v.config.curve;m.gauge=v.config.gauge;save();check(m.gauge===zero,'Unexpected ERC20 market Gauge');
  await call('sweep-'+key,'outsider','TickerGardenCurve',m.curve,'sweepCurveFees');
  await claims('curve-claims-'+key,m,[quote]);
  await exactReject('no-staker-claim-'+key,'staker','claimStaker',[m.id,quote],'InvalidFeeMarket');
 }
 // Keep this synthetic fixture out of further launch admission after its isolated regression.
 await call('pause-erc20-test-quote','admin','ApprovedQuoteRegistry',quotes,'pauseQuote',[quoteId,hash('R5_SYNTHETIC_REGRESSION_COMPLETE')]);
 record('erc20-no-stake-claims-complete',{quote,quoteId,status:'PAUSED_TEST_FIXTURE',markets:2});
}

try{
 check(p.releaseId===hash('TICKERGARDEN_ARB_SEPOLIA_R5_NO_STAKING_FEE_FIX_CLEAN_BUILD_2026_09_06'),'Expected R5 release');
 for(const entry of p.contracts)check(keccak256(await c.getCode({address:entry.address}))===entry.runtimeCodeHash,'Code drift '+entry.name);
 check(await read('TreasuryDistributorV1',distributor,'EPOCH_DURATION')===604800,'seven-day period');
 check(BigInt(active.graduationThreshold)===parseEther('0.42'),'threshold');
 record('verified-r5-code-and-parameters',{releaseId:p.releaseId,holderEpochSeconds:604800,graduationETH:'0.42'});
 const launchFee=await read('TickerGardenFactoryV1',p.factory,'launchFee');
 for(const sharing of [false,true])for(const tax of [0,500]){
  const key=`no-stake-holder-${sharing}-tax-${tax}`;
  const params=state.markets[key]?.params??{assetUid:z32,tickerGardenBaselineId:active.baselineId,quoteAssetConfigId:active.quoteId,launchTemplateId:active.templateId,expectedEconomics:z32,creatorRevenueBeneficiary:accounts.creator.address,name:'TickerGarden Fee Regression',symbol:'tgR5',metadataURI:'data:application/json,%7B%22testOnly%22%3Atrue%7D',salt:hash(p.releaseId+key),creatorTaxBps:tax,creatorFeesToHolders:sharing,stakingEnabled:false};
  if(!state.markets[key]){
   params.expectedEconomics=await c.readContract({account:accounts.creator.address,address:p.factory,abi:artifact('TickerGardenFactoryV1').abi,functionName:'previewMarketEconomics',args:[params]});
   const sim=await c.simulateContract({account:accounts.creator.address,address:router,abi:artifact('LaunchAndBuyRouter').abi,functionName:'launchAndBuy',args:[params,parseEther('0.003'),1n,accounts.creator.address],value:launchFee+parseEther('0.003')});
   state.markets[key]={id:sim.result[0],token:sim.result[1],params};save();
  }
  const m=state.markets[key];
  await call('launch-'+key,'creator','LaunchAndBuyRouter',router,'launchAndBuy',[params,parseEther('0.003'),1n,accounts.creator.address],launchFee+parseEther('0.003'));
  const v=await read('MarketRegistryV1',registry,'market',[m.id]);m.curve=v.config.curve;m.gauge=v.config.gauge;save();check(m.gauge===zero,'unexpected Gauge');
  await call('sweep-'+key,'outsider','TickerGardenCurve',m.curve,'sweepCurveFees');
  await claims('curve-claims-'+key,m);
  await exactReject('no-staker-claim-'+key,'staker','claimStaker',[m.id,zero],'InvalidFeeMarket');
 }
 const m=state.markets['no-stake-holder-true-tax-500'];
 if(!state.transactions.some(t=>t.id==='graduate')){
   const available=await c.getBalance({address:accounts.buyer.address});
   if(!state.funding){state.funding=String(available<parseEther('0.54')?parseEther('0.54')-available:0n);save();}
   if(BigInt(state.funding)>0n)await send('fund-graduation','admin',accounts.buyer.address,'0x',BigInt(state.funding));
 }
 await call('graduate','buyer','TickerGardenCurve',m.curve,'buy',[parseEther('0.50'),1n,accounts.buyer.address],parseEther('0.50'));
 check((await read('MarketRegistryV1',registry,'market',[m.id])).runtime.launchPhase===1,'graduation failed');record('no-stake-graduation',true);
 const poolManager=JSON.parse(fs.readFileSync('deployments/manifests/arbitrum-sepolia-421614.v1.plan.json')).externalDependencies.find(x=>x.name==='POOL_MANAGER').address;
 const swapper=await deploy('deploy-v4-regression-router','PoolSwapTest',[poolManager]);
 const key=await read('MarketRegistryV1',registry,'canonicalPoolKey',[m.id]),buy0=key.currency0===zero,settings={takeClaims:false,settleUsingBurn:false};
 await call('v4-buy','buyer','PoolSwapTest',swapper,'swap',[key,{zeroForOne:buy0,amountSpecified:-parseEther('0.005'),sqrtPriceLimitX96:buy0?4295128741n:1461446703485210103287273052203988822378723970341n},settings,'0x'],parseEther('0.005'));
 if(!state.sellAmount){state.sellAmount=String((await read('TickerMemeTokenV1',m.token,'balanceOf',[accounts.buyer.address]))/100n);save();}
 await call('approve-v4','buyer','TickerMemeTokenV1',m.token,'approve',[swapper,BigInt(state.sellAmount)]);
 await call('v4-sell','buyer','PoolSwapTest',swapper,'swap',[key,{zeroForOne:!buy0,amountSpecified:-BigInt(state.sellAmount),sqrtPriceLimitX96:!buy0?4295128741n:1461446703485210103287273052203988822378723970341n},settings,'0x']);record('no-stake-v4-buy-and-sell',true);
 if(!done('creator-conversion-isolated')){
  if(!state.conversion){state.conversion={creatorMeme:String(await read('ProtocolFeeVault',fees,'creatorLiability',[m.id,1,m.token])),holderMeme:String(await read('ProtocolFeeVault',fees,'holderLiability',[m.id,1,m.token])),creatorQuote:String(await read('ProtocolFeeVault',fees,'creatorLiability',[m.id,1,zero]))};save();}
  check(BigInt(state.conversion.creatorMeme)>0n,'missing creator meme');check(BigInt(state.conversion.holderMeme)>0n,'missing holder meme');
  await call('convert-creator','admin','ProtocolFeeVault',fees,'settleRewards',[m.id,[{user:accounts.creator.address,creatorEpoch:1,maximumMeme:BigInt(state.conversion.creatorMeme)}],1n,await deadline('convert-creator')]);
  check(await read('ProtocolFeeVault',fees,'creatorLiability',[m.id,1,m.token])===0n,'creator meme not converted');
  check(await read('ProtocolFeeVault',fees,'creatorLiability',[m.id,1,zero])>BigInt(state.conversion.creatorQuote),'conversion no quote');
  check(await read('ProtocolFeeVault',fees,'holderLiability',[m.id,1,m.token])===BigInt(state.conversion.holderMeme),'holder balance changed');record('creator-conversion-isolated',state.conversion);
 }
 await claims('graduated-claims',m,[zero,m.token]);
 if(!done('holder-conversion-isolated')){
  if(!state.holderConversion){state.holderConversion={meme:String(await read('ProtocolFeeVault',fees,'holderLiability',[m.id,1,m.token])),creatorQuote:String(await read('ProtocolFeeVault',fees,'creatorLiability',[m.id,1,zero]))};save();}
  await call('convert-holder','admin','ProtocolFeeVault',fees,'settleHolderRewards',[m.id,1,BigInt(state.holderConversion.meme),1n,await deadline('convert-holder')]);
  check(await read('ProtocolFeeVault',fees,'creatorLiability',[m.id,1,zero])===BigInt(state.holderConversion.creatorQuote),'holder changed creator quote');
  await call('fund-holder','outsider','ProtocolFeeVault',fees,'fundHolderRewards',[m.id,1]);
  const amount=await read('TreasuryDistributorV1',distributor,'epochQuoteAmount',[m.id,1]);check(amount>0n,'holder not funded');record('holder-conversion-isolated',{funded:String(amount)});
 }
 await erc20CurveRegression();
 for(const asset of [zero,state.testQuote,m.token,...Object.values(state.markets).map(x=>x.token)]){const balance=asset===zero?await c.getBalance({address:fees}):await read('TickerMemeTokenV1',asset,'balanceOf',[fees]),liability=await read('ProtocolFeeVault',fees,'totalLiability',[asset]);check(balance>=liability,'insolvent vault');record('solvency-'+asset,{balance:String(balance),liability:String(liability)});}
 state.status='PUBLIC_R5_FEE_REGRESSION_PASSED';delete state.error;state.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({status:state.status,transactions:state.transactions.length,checks:state.checks.length}));
}catch(error){state.status='STOPPED_REQUIRES_RECONCILIATION';state.error=error.shortMessage??error.message;save();console.error(state.error);process.exitCode=1;}
