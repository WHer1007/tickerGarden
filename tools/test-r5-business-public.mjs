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
const out = 'outputs/reviews/r5-business-acceptance-2026-09-06/public';
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
const c=createPublicClient({chain:arbitrumSepolia,pollingInterval:1000,transport:http('https://sepolia-rollup.arbitrum.io/rpc')});
if (await c.getChainId()!==421614) throw Error('Wrong RPC chain');
const clients=Object.fromEntries(Object.entries(accounts).map(([role,account])=>[role,createWalletClient({account,chain:arbitrumSepolia,transport:http('https://sepolia-rollup.arbitrum.io/rpc')})]));
const statePath=out+'/results.json';
const state=fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath)):{runId:'R5-BUSINESS-2026-09-06',chainId:421614,releaseId:p.releaseId,transactions:[],checks:[],markets:{}};
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
  t.status=receipt.status==='success'?'CONFIRMED':'REVERTED';t.blockHash=receipt.blockHash;t.blockNumber=String(receipt.blockNumber);t.gasUsed=String(receipt.gasUsed);t.gasCostWei=String(receipt.gasUsed*receipt.effectiveGasPrice);save();
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
const stage=process.argv[3]??'matrix';
const balance=(asset,address)=>asset===zero?c.getBalance({address}):read('TickerMemeTokenV1',asset,'balanceOf',[address]);
async function snapshot(id,fn){state.snapshots??={};if(!state.snapshots[id]){state.snapshots[id]=await fn();save();}return state.snapshots[id];}
async function strictReject(id,role,name,address,fn,args,expected,value=0n){
 if(done(id))return;let actual,raw;
 try{await c.simulateContract({account:accounts[role].address,address,abi:artifact(name).abi,functionName:fn,args,value});}
 catch(e){let x=e;while(x){if(typeof x.data==='string'&&x.data.startsWith('0x'))raw=x.data;x=x.cause;}if(raw){try{actual=decodeErrorResult({abi:[...artifact(name).abi,...artifact('TickerGardenCurve').abi,...artifact('ProtocolFeeVault').abi,...artifact('MemeStockGauge').abi,...artifact('AllocationManager').abi,...artifact('TickerGardenMemeHook').abi],data:raw}).errorName;}catch{actual=raw.slice(0,10);}}}
 check(actual===expected,`${id}: expected ${expected}, actual ${actual??'no EVM revert'}`);
 const block=await c.getBlock();record(id,{evidenceType:'ETH_CALL',expected,actual,raw,role,address,fn,blockNumber:String(block.number),blockHash:block.hash});
}
async function fixture(){
 state.stock=await deploy('fixture-stock','ArbitrumActiveScenarioStock',[accounts.staker.address]);
 state.testQuote=await deploy('fixture-quote','ArbitrumScenarioStock',[accounts.staker.address]);save();
 state.stockUid=await read('ArbitrumActiveScenarioStock',state.stock,'uid');save();const code=keccak256(await c.getCode({address:state.stock}));
 await call('stock-register','admin','OfficialStockRegistryV1',stocks,'registerAsset',[state.stockUid,state.stock,18,vault,parseEther('1'),{tokenRuntimeCodeHash:code,beacon:zero,beaconRuntimeCodeHash:z32,implementation:state.stock,implementationRuntimeCodeHash:code}]);
 state.quoteId=keccak256(encodeAbiParameters([{type:'bytes32'},{type:'uint256'},{type:'uint256'},{type:'bytes32'},{type:'address'},{type:'uint8'},{type:'uint256'},{type:'uint256'}],[hash('TICKERGARDEN_V1_QUOTE_ECONOMICS'),1n,421614n,active.baselineId,state.testQuote,18,parseEther('40'),parseEther('100')]));save();
 await call('quote-register','admin','ApprovedQuoteRegistry',quotes,'addQuoteConfig',[state.quoteId,{tickerGardenBaselineId:active.baselineId,quoteAsset:state.testQuote,quoteDecimals:18,phantomQuote:parseEther('40'),graduationThreshold:parseEther('100'),economicsHash:state.quoteId,status:1}]);
 for(const role of ['creator','buyer'])await call('quote-fund-'+role,'staker','ArbitrumScenarioStock',state.testQuote,'transfer',[accounts[role].address,parseEther('10000')]);
 await call('stock-fund-second-staker','staker','ArbitrumActiveScenarioStock',state.stock,'transfer',[accounts.outsider.address,parseEther('1000')]);
 await call('quote-router-approval','creator','ArbitrumScenarioStock',state.testQuote,'approve',[router,parseEther('1000')]);
 record('fixture-identities',{stock:state.stock,stockUid:state.stockUid,quote:state.testQuote,quoteId:state.quoteId,synthetic:true,notRHSameSource:true});
}
async function matrix(){
 await fixture();const launchFee=await read('TickerGardenFactoryV1',p.factory,'launchFee');
 for(const native of [true,false])for(const staking of [false,true])for(const sharing of [false,true])for(const tax of [0,500]){
  const key=`${native?'ETH':'ERC20'}-S${+staking}-H${+sharing}-T${tax}`;
  const amount=native?parseEther('0.001'):parseEther('1'),quote=native?zero:state.testQuote;
  if(!state.markets[key]){
   const params={assetUid:staking?state.stockUid:z32,tickerGardenBaselineId:active.baselineId,quoteAssetConfigId:native?active.quoteId:state.quoteId,launchTemplateId:active.templateId,expectedEconomics:z32,creatorRevenueBeneficiary:accounts.creator.address,name:'TickerGarden Business '+key,symbol:'tgBIZ',metadataURI:'data:application/json,%7B%22testOnly%22%3Atrue%7D',salt:hash(state.runId+key),creatorTaxBps:tax,creatorFeesToHolders:sharing,stakingEnabled:staking};
   params.expectedEconomics=await c.readContract({account:accounts.creator.address,address:p.factory,abi:artifact('TickerGardenFactoryV1').abi,functionName:'previewMarketEconomics',args:[params]});
   const sim=await c.simulateContract({account:accounts.creator.address,address:router,abi:artifact('LaunchAndBuyRouter').abi,functionName:'launchAndBuy',args:[params,amount,1n,accounts.creator.address],value:launchFee+(native?amount:0n)});
   state.markets[key]={key,id:sim.result[0],token:sim.result[1],params,quote};save();
  }
  const m=state.markets[key];if(done('matrix-'+key))continue;
  await call('launch-'+key,'creator','LaunchAndBuyRouter',router,'launchAndBuy',[m.params,amount,1n,accounts.creator.address],launchFee+(native?amount:0n));
  const v=await read('MarketRegistryV1',registry,'market',[m.id]);m.curve=v.config.curve;m.gauge=v.config.gauge;save();
  check((m.gauge!==zero)===staking,'Gauge mode mismatch');check(await balance(m.token,accounts.creator.address)>0n,'Atomic purchase missing');
  if(!native)await call('curve-approve-quote-'+key,'buyer','ArbitrumScenarioStock',quote,'approve',[m.curve,parseEther('1000')]);
  await call('curve-buy-'+key,'buyer','TickerGardenCurve',m.curve,'buy',[amount,1n,accounts.buyer.address],native?amount:0n);
  const s=await snapshot('sell-'+key,async()=>({amount:String((await balance(m.token,accounts.buyer.address))/4n)}));
  await call('curve-sell-approve-'+key,'buyer','TickerMemeTokenV1',m.token,'approve',[m.curve,BigInt(s.amount)]);
  await call('curve-sell-'+key,'buyer','TickerGardenCurve',m.curve,'sell',[BigInt(s.amount),1n,accounts.buyer.address]);
  await call('curve-sweep-'+key,'outsider','TickerGardenCurve',m.curve,'sweepCurveFees');
  const holder=await read('ProtocolFeeVault',fees,'holderLiability',[m.id,1,quote]);check((holder>0n)===sharing,'Holder toggle mismatch');
  await claims('curve-claims-'+key,m,[quote]);
  record('matrix-'+key,{marketId:m.id,quote,staking,sharing,tax,developerBuy:true,curveBuySell:true,holderLiability:String(holder),fixedRecipientClaims:true,evidenceType:'MINED_TX',independentFeeAudit:'PENDING'});
 }
 state.status='MATRIX_EXECUTED_ACCOUNTING_AUDIT_PENDING';save();
}
async function swap(id,m,buy,amount){
 const key=await read('MarketRegistryV1',registry,'canonicalPoolKey',[m.id]);const buy0=key.currency0.toLowerCase()===m.quote.toLowerCase(),direction=buy?buy0:!buy0;
 const input=buy?m.quote:m.token;if(input!==zero)await call(id+'-approve','buyer','TickerMemeTokenV1',input,'approve',[state.swapper,amount]);
 await call(id,'buyer','PoolSwapTest',state.swapper,'swap',[key,{zeroForOne:direction,amountSpecified:-amount,sqrtPriceLimitX96:direction?4295128741n:1461446703485210103287273052203988822378723970341n},{takeClaims:false,settleUsingBurn:false},'0x'],input===zero?amount:0n);
}
async function graduated(){
 check(Object.keys(state.markets).length===16,'Incomplete creation matrix');
 await call('stock-fund-second-staker-extra','staker','ArbitrumActiveScenarioStock',state.stock,'transfer',[accounts.outsider.address,parseEther('500')]);
 state.swapper=await deploy('fixture-swapper','PoolSwapTest',[JSON.parse(fs.readFileSync('deployments/manifests/arbitrum-sepolia-421614.v1.plan.json')).externalDependencies.find(x=>x.name==='POOL_MANAGER').address]);save();
 // Fund one ETH graduation; retain the other seven ETH combinations as explicit coverage gaps.
 await send('fund-one-eth-graduation','admin',accounts.buyer.address,'0x',parseEther('0.36'));
 for(const m of Object.values(state.markets).filter(m=>m.quote!==zero||m.key==='ETH-S1-H1-T500')){
  const key=m.key,native=m.quote===zero;if(done('graduated-'+key))continue;
  const amount=native?parseEther('0.45'):parseEther('120');
  await call('graduate-'+key,'buyer','TickerGardenCurve',m.curve,'buy',[amount,1n,accounts.buyer.address],native?amount:0n);
  const view=await read('MarketRegistryV1',registry,'market',[m.id]);check(view.runtime.launchPhase===1,'Graduation incomplete');
  await swap('v4-zero-buy-'+key,m,true,native?parseEther('0.001'):parseEther('1'));
  const sell=await snapshot('v4-zero-sell-'+key,async()=>({amount:String((await balance(m.token,accounts.buyer.address))/1000n)}));
  await swap('v4-zero-sell-'+key,m,false,BigInt(sell.amount));
  if(m.params.stakingEnabled){
   await call('approve-stock-'+key,'staker','ArbitrumActiveScenarioStock',state.stock,'approve',[vault,parseEther('1000')]);
   await call('stake-'+key,'staker','AllocationManager',manager,'stake',[m.id,parseEther('100')]);
   await call('approve-stock-second-'+key,'outsider','ArbitrumActiveScenarioStock',state.stock,'approve',[vault,parseEther('1000')]);
   await call('stake-second-'+key,'outsider','AllocationManager',manager,'stake',[m.id,parseEther('300')]);
   const pos=await read('MemeStockGauge',m.gauge,'positionOf',[accounts.outsider.address]);
   let remaining=BigInt(pos.pendingGeneration)-(await c.getBlock()).timestamp+1n;
   check(remaining<=60n,'Unexpected activation wait');if(remaining>0n){console.log('Natural activation wait '+remaining+'s '+key);await new Promise(r=>setTimeout(r,Number(remaining)*1000));}
   await call('checkpoint-'+key,'buyer','MemeStockGauge',m.gauge,'checkpointActivations');
   check(await read('UserStockVault',vault,'allocation',[state.stockUid,accounts.staker.address,m.id])===parseEther('100'),'staker principal');
   check(await read('UserStockVault',vault,'allocation',[state.stockUid,accounts.outsider.address,m.id])===parseEther('300'),'second principal');
   await swap('v4-active-buy-'+key,m,true,native?parseEther('0.001'):parseEther('1'));
   const sell2=await snapshot('v4-active-sell-'+key,async()=>({amount:String((await balance(m.token,accounts.buyer.address))/1000n)}));
   await swap('v4-active-sell-'+key,m,false,BigInt(sell2.amount));
  }
  const conv=await snapshot('conversion-'+key,async()=>({creator:String(await read('ProtocolFeeVault',fees,'creatorLiability',[m.id,1,m.token])),holder:String(await read('ProtocolFeeVault',fees,'holderLiability',[m.id,1,m.token])),staker:m.params.stakingEnabled?String((await read('MemeStockGauge',m.gauge,'positionOf',[accounts.staker.address])).memeClaimable):'0',quoteBefore:String(await read('ProtocolFeeVault',fees,'creatorLiability',[m.id,1,m.quote]))}));
  check(BigInt(conv.creator)>0n,'Creator reward missing');const items=[{user:accounts.creator.address,creatorEpoch:1,maximumMeme:BigInt(conv.creator)}];
  if(m.params.stakingEnabled){check(BigInt(conv.staker)>0n,'Staker reward missing');items.push({user:accounts.staker.address,creatorEpoch:0,maximumMeme:BigInt(conv.staker)});}
  await call('convert-batch-'+key,'admin','ProtocolFeeVault',fees,'settleRewards',[m.id,items,1n,await deadline('convert-batch-'+key)]);
  check(await read('ProtocolFeeVault',fees,'holderLiability',[m.id,1,m.token])===BigInt(conv.holder),'Batch changed holder liabilities');
  await claims('v4-claims-'+key,m,[m.quote,m.token]);
  if(m.params.creatorFeesToHolders){
   await call('convert-holder-'+key,'admin','ProtocolFeeVault',fees,'settleHolderRewards',[m.id,1,BigInt(conv.holder),1n,await deadline('convert-holder-'+key)]);
   check(await read('ProtocolFeeVault',fees,'creatorLiability',[m.id,1,m.quote])===0n,'Holder conversion touched creator');
   await call('fund-holder-'+key,'outsider','ProtocolFeeVault',fees,'fundHolderRewards',[m.id,1]);
   m.epochWindow=await read('TreasuryDistributorV1',distributor,'epochWindow',[m.id,1]);m.holderFunded=String(await read('TreasuryDistributorV1',distributor,'epochQuoteAmount',[m.id,1]));check(BigInt(m.holderFunded)>0n,'No funded holder quote');
  }
  if(m.params.stakingEnabled){m.stakerPosition=await read('MemeStockGauge',m.gauge,'positionOf',[accounts.staker.address]);check(m.stakerPosition.quoteClaimable>0n,'Missing converted staker quote');m.normalExitDueAt=String(m.stakerPosition.unlockAt);}
  record('graduated-'+key,{marketId:m.id,zeroActiveFeeState:true,activeFeeState:m.params.stakingEnabled,batchItems:items.length,holderFunding:m.holderFunded??'0',evidenceType:'MINED_TX',timeGates:'PENDING',independentFeeAudit:'PENDING'});save();
 }
 state.status='IMMEDIATE_GRADUATION_EXECUTED_TIME_GATES_AND_AUDIT_PENDING';save();
}
async function negative(){
 const m=state.markets['ETH-S0-H0-T0'],st=state.markets['ETH-S1-H0-T0'],launchFee=await read('TickerGardenFactoryV1',p.factory,'launchFee');
 for(const [id,params,error,value]of [
 ['tax-cap',{...m.params,creatorTaxBps:501},'CreatorTaxTooHigh',launchFee],
 ['staking-missing-stock',{...st.params,assetUid:z32},'InvalidStakingConfiguration',launchFee],
 ['disabled-staking-stock',{...m.params,assetUid:state.stockUid},'InvalidStakingConfiguration',launchFee],
 ['stale-economics',{...m.params,expectedEconomics:hash('STALE')},'ExpectedEconomicsMismatch',launchFee],
 ['wrong-launch-fee',m.params,'InvalidLaunchFee',0n],
 ['duplicate-identity',m.params,'MarketIdentityAlreadyReserved',launchFee]])await strictReject(id,'creator','TickerGardenFactoryV1',p.factory,'createMarket',[params],error,value);
 await strictReject('disabled-stake','staker','AllocationManager',manager,'stake',[m.id,parseEther('1')],'StockAllocationClosed');
 await strictReject('pregraduation-stake','staker','AllocationManager',manager,'stake',[st.id,parseEther('1')],'StockAllocationClosed');
 await strictReject('no-staker-claim','staker','ProtocolFeeVault',fees,'claimStaker',[m.id,zero],'InvalidFeeMarket');
 await strictReject('outsider-convert','outsider','ProtocolFeeVault',fees,'settleRewards',[m.id,[],1n,0n],'UnauthorizedSettlementOperator');
 await strictReject('conversion-invalid-deadline','admin','ProtocolFeeVault',fees,'settleRewards',[m.id,[{user:accounts.creator.address,creatorEpoch:1,maximumMeme:1n}],1n,2n**64n],'InvalidConversion');
 await strictReject('curve-slippage','buyer','TickerGardenCurve',m.curve,'buy',[parseEther('0.001'),2n**255n,accounts.buyer.address],'SlippageExceeded',parseEther('0.001'));
 if(!done('mined-atomic-rollback')){
  const snap=await snapshot('atomic-failure',async()=>{
   const params={...m.params,salt:hash(state.runId+'mined-rollback')};params.expectedEconomics=await c.readContract({account:accounts.creator.address,address:p.factory,abi:artifact('TickerGardenFactoryV1').abi,functionName:'previewMarketEconomics',args:[params]});
   const sim=await c.simulateContract({account:accounts.creator.address,address:router,abi:artifact('LaunchAndBuyRouter').abi,functionName:'launchAndBuy',args:[params,parseEther('0.001'),1n,accounts.creator.address],value:launchFee+parseEther('0.001')});
   return {params,marketId:sim.result[0],token:sim.result[1],creatorBalance:String(await c.getBalance({address:accounts.creator.address})),treasuryBalance:String(await c.getBalance({address:p.platformTreasury})),routerBalance:String(await c.getBalance({address:router}))};
  });
  await strictReject('atomic-revert-simulation','creator','LaunchAndBuyRouter',router,'launchAndBuy',[snap.params,parseEther('0.001'),2n**255n,accounts.creator.address],'SlippageExceeded',launchFee+parseEther('0.001'));
  const id='mined-atomic-failure';let t=state.transactions.find(x=>x.id===id);const data=encodeFunctionData({abi:artifact('LaunchAndBuyRouter').abi,functionName:'launchAndBuy',args:[snap.params,parseEther('0.001'),2n**255n,accounts.creator.address]});
  if(!t){
   const account=accounts.creator,nonce=await c.getTransactionCount({address:account.address,blockTag:'pending'}),ff=await c.estimateFeesPerGas(),value=launchFee+parseEther('0.001'),gas=12000000n;
   check(gas*ff.maxFeePerGas<parseEther('0.005'),'Forced revert gas budget');
   const signed=await clients.creator.signTransaction(await clients.creator.prepareTransactionRequest({account,to:router,data,value,nonce,gas,...ff}));
   t={id,role:'creator',to:router,value:String(value),inputHash:keccak256(data),nonce,hash:keccak256(signed),status:'SIGNED',expectedStatus:'reverted'};state.transactions.push(t);save();await c.sendRawTransaction({serializedTransaction:signed});
  }
  const r=await c.waitForTransactionReceipt({hash:t.hash,confirmations:2});check(r.status==='reverted','Expected mined revert');t.status='EXPECTED_REVERT';t.blockNumber=String(r.blockNumber);t.blockHash=r.blockHash;t.gasCostWei=String(r.gasUsed*r.effectiveGasPrice);save();
  check(!await c.getCode({address:snap.token}),'Rollback left token code');check(await c.getBalance({address:accounts.creator.address})===BigInt(snap.creatorBalance)-BigInt(t.gasCostWei),'Atomic failure deducted funds beyond gas');check(await c.getBalance({address:p.platformTreasury})===BigInt(snap.treasuryBalance),'Atomic failure paid launch fee');check(await c.getBalance({address:router})===BigInt(snap.routerBalance),'Router residual changed');
  const retry=await c.simulateContract({account:accounts.creator.address,address:router,abi:artifact('LaunchAndBuyRouter').abi,functionName:'launchAndBuy',args:[snap.params,parseEther('0.001'),1n,accounts.creator.address],value:launchFee+parseEther('0.001')});check(retry.result[0]===snap.marketId,'Identity not reusable');record('mined-atomic-rollback',{hash:t.hash,onlyGasSpent:true,noTokenCode:true,noLaunchFeePaid:true,retrySameIdentity:'ETH_CALL_SUCCESS'});
 }
 state.status='NEGATIVE_TESTS_EXECUTED';save();
}

async function lifecycle(){
 for(const w of Object.values(state.markets).filter(m=>m.normalExitDueAt)){
  const id='two-staker-weight-'+w.key;if(done(id))continue;
  const a=BigInt(state.snapshots['conversion-'+w.key].staker),b=(await read('MemeStockGauge',w.gauge,'positionOf',[accounts.outsider.address])).memeClaimable;
  check(a>0n&&b>=3n*a&&b<=3n*a+2n,'1:3 staker allocation '+w.key);record(id,{marketId:w.id,firstPrincipal:'100',secondPrincipal:'300',firstMeme:String(a),secondMeme:String(b),roundingDifference:String(b-3n*a),evidenceType:'READ_ONLY_STATE_AFTER_MINED_TRADES'});
 }
 const closed=state.markets['ERC20-S1-H0-T500'];
 if(!done('all-stakers-exited-zero-fee-state')){
  for(const [role,amount]of [['staker',100n],['outsider',300n]]){
   const b=await snapshot('full-exit-'+role,async()=>({wallet:String(await balance(state.stock,accounts[role].address))}));
   await call('full-exit-'+role,role,'AllocationManager',manager,'rageQuit',[closed.id]);
   check(await balance(state.stock,accounts[role].address)===BigInt(b.wallet)+amount*10n**18n,'Full exit principal delta');
   if((await read('AllocationManager',manager,'rageQuitSettlementPending',[closed.id,accounts[role].address]))[0])await call('full-exit-settle-'+role,'buyer','AllocationManager',manager,'settleRageQuitRewards',[closed.id,accounts[role].address]);
  }
  check(await read('AllocationManager',manager,'rewardEligibleActiveStock',[closed.id])===0n,'Nonzero active after all exits');
  await swap('post-full-exit-buy-'+closed.key,closed,true,parseEther('1'));
  delete closed.normalExitDueAt;closed.allPositionsExited=true;record('all-stakers-exited-zero-fee-state',{marketId:closed.id,activeStock:'0',principalReturned:'400000000000000000000',independentFeeAudit:'PENDING'});save();
 }
 const m=state.markets['ERC20-S1-H0-T0'];check(done('graduated-'+m.key),'Lifecycle requires graduated staking market');
 await strictReject('early-staker-quote','staker','ProtocolFeeVault',fees,'claimStaker',[m.id,m.quote],'PositionLockedUntil');
 await strictReject('early-normal-unstake','staker','AllocationManager',manager,'unstakeAndWithdraw',[m.id],'PositionLockedUntil');
 if(!done('ragequit-principal')){
  const b=await snapshot('ragequit',async()=>({balance:String(await balance(state.stock,accounts.outsider.address)),allocation:String(await read('UserStockVault',vault,'allocation',[state.stockUid,accounts.outsider.address,m.id]))}));check(BigInt(b.allocation)===parseEther('300'),'Expected second stake');
  await call('ragequit-outsider','outsider','AllocationManager',manager,'rageQuit',[m.id]);
  check(await balance(state.stock,accounts.outsider.address)===BigInt(b.balance)+BigInt(b.allocation),'Rage quit principal delta');check(await read('UserStockVault',vault,'allocation',[state.stockUid,accounts.outsider.address,m.id])===0n,'Rage quit principal ledger');
  const pending=await read('AllocationManager',manager,'rageQuitSettlementPending',[m.id,accounts.outsider.address]);
  if(pending[0])await call('ragequit-retry','buyer','AllocationManager',manager,'settleRageQuitRewards',[m.id,accounts.outsider.address]);
  check(!(await read('AllocationManager',manager,'rageQuitSettlementPending',[m.id,accounts.outsider.address]))[0],'Deferred reward unsettled');
  record('ragequit-principal',{exactPrincipal:String(b.allocation),rewardCleanupWasDeferred:pending[0],evidenceType:'MINED_TX',remainingStock:String(await read('AllocationManager',manager,'rewardEligibleActiveStock',[m.id]))});
 }
  if(!done('creator-beneficiary-epochs')){
  const e=state.markets['ETH-S0-H0-T0'];
  await strictReject('outsider-creator-transfer','outsider','CreatorRevenueRegistry',creators,'transferCreatorRevenueBeneficiary',[e.id,accounts.buyer.address],'UnauthorizedCurrentBeneficiary');
  await call('epoch1-curve-buy','buyer','TickerGardenCurve',e.curve,'buy',[parseEther('0.001'),1n,accounts.buyer.address],parseEther('0.001'));
  await call('creator-transfer','creator','CreatorRevenueRegistry',creators,'transferCreatorRevenueBeneficiary',[e.id,accounts.buyer.address]);
  state.beneficiaryTransfers={[e.id]:{1:accounts.creator.address,2:accounts.buyer.address}};save();
  await call('epoch2-curve-buy','buyer','TickerGardenCurve',e.curve,'buy',[parseEther('0.001'),1n,accounts.buyer.address],parseEther('0.001'));
  await call('epoch2-sweep','outsider','TickerGardenCurve',e.curve,'sweepCurveFees');
  const epoch=await snapshot('epoch-claims',async()=>({old:String(await read('ProtocolFeeVault',fees,'creatorLiability',[e.id,1,zero])),next:String(await read('ProtocolFeeVault',fees,'creatorLiability',[e.id,2,zero])),oldBalance:String(await c.getBalance({address:accounts.creator.address})),nextBalance:String(await c.getBalance({address:accounts.buyer.address}))}));
  check(BigInt(epoch.old)>0n&&BigInt(epoch.next)>0n,'Missing independent epochs');
  await call('epoch1-claim','outsider','ProtocolFeeVault',fees,'claimCreator',[e.id,1,zero]);
  await call('epoch2-claim','outsider','ProtocolFeeVault',fees,'claimCreator',[e.id,2,zero]);
  check(await c.getBalance({address:accounts.creator.address})===BigInt(epoch.oldBalance)+BigInt(epoch.old),'Old beneficiary mispaid');check(await c.getBalance({address:accounts.buyer.address})===BigInt(epoch.nextBalance)+BigInt(epoch.next),'New beneficiary mispaid');
  record('creator-beneficiary-epochs',{marketId:e.id,old:accounts.creator.address,next:accounts.buyer.address,oldClaim:epoch.old,newClaim:epoch.next,exactRecipientDeltas:true});
 }

 const n=state.markets['ETH-S1-H1-T500'];
 if(!state.rawExit){
 await swap('raw-reward-seed-buy-'+n.key,n,true,parseEther('0.001'));
 await call('raw-request','creator','ProtocolFeeVault',fees,'requestRawRewardExit',[n.id]);
 const at=await snapshot('raw-first',async()=>({at:String(await read('ProtocolFeeVault',fees,'rawRewardExitAt',[n.id,accounts.creator.address]))}));
 await call('raw-repeat-request','creator','ProtocolFeeVault',fees,'requestRawRewardExit',[n.id]);check(await read('ProtocolFeeVault',fees,'rawRewardExitAt',[n.id,accounts.creator.address])===BigInt(at.at),'Raw repeat reset timer');
 await strictReject('raw-too-early','creator','ProtocolFeeVault',fees,'claimCreator',[n.id,1,n.token],'OriginalRewardExitNotReady');
 await call('raw-cancel','creator','ProtocolFeeVault',fees,'cancelRawRewardExit',[n.id]);
 await call('raw-request-again','creator','ProtocolFeeVault',fees,'requestRawRewardExit',[n.id]);
 const due=await read('ProtocolFeeVault',fees,'rawRewardExitAt',[n.id,accounts.creator.address]);check(due>=BigInt(at.at),'Raw re-request bypassed timer');
 state.rawExit={marketId:n.id,user:accounts.creator.address,availableAt:String(due),memeLiability:String(await read('ProtocolFeeVault',fees,'creatorLiability',[n.id,1,n.token]))};
 save();
 }
 check(await read('ProtocolFeeVault',fees,'rawRewardExitAt',[n.id,accounts.creator.address])===BigInt(state.rawExit.availableAt),'Raw exit stored timer mismatch');
 for(const h of Object.values(state.markets).filter(m=>m.holderFunded))await strictReject('epoch-not-closed-'+h.key,'creator','TreasuryDistributorV1',distributor,'requestRoot',[h.id,1],'EpochNotClosed',parseEther('0.001'));
 state.timeQueue=[];const finality=BigInt(await read('TreasuryDistributorV1',distributor,'finalityDelaySeconds'));
 for(const h of Object.values(state.markets)){
  if(h.normalExitDueAt)state.timeQueue.push({type:'NORMAL_STAKE_EXIT_AND_QUOTE_CLAIM',marketId:h.id,user:accounts.staker.address,availableAt:h.normalExitDueAt,status:'WAITING_TIME'});
  if(h.epochWindow)state.timeQueue.push({type:'HOLDER_ROOT_REQUEST',marketId:h.id,epoch:1,availableAt:String(BigInt(h.epochWindow[1])+finality),status:'WAITING_TIME',next:'publish canonical root, review, finalize, real proof claim, then start actual 30-day claim deadline'});
 }
 await strictReject('outsider-stock-pause','outsider','OfficialStockRegistryV1',stocks,'pauseAsset',[state.stockUid,hash('BUSINESS_TEST_PAUSE')],'AccessManagedUnauthorized');
 await call('pause-test-stock','admin','OfficialStockRegistryV1',stocks,'pauseAsset',[state.stockUid,hash('BUSINESS_TEST_PAUSE')]);
 await strictReject('paused-stock-increase','staker','AllocationManager',manager,'stake',[m.id,parseEther('1')],'StockAllocationClosed');
 await strictReject('unpause-too-early','admin','OfficialStockRegistryV1',stocks,'unpauseAsset',[state.stockUid],'UnpauseStateDelayNotElapsed');
 const pauseTx=state.transactions.find(t=>t.id==='pause-test-stock'),pauseBlock=await c.getBlock({blockNumber:BigInt(pauseTx.blockNumber)});
 state.timeQueue.push({type:'STOCK_UNPAUSE',assetUid:state.stockUid,availableAt:String(pauseBlock.timestamp+86400n),status:'WAITING_TIME'});
 state.timeQueue.push({type:'RAW_MEME_EXIT',...state.rawExit,status:'WAITING_TIME'});record('natural-time-queue',{entries:state.timeQueue.length,rawExit:state.rawExit});state.status='IMMEDIATE_EXECUTION_FINISHED_WAITING_TIME_AND_COVERAGE_GAPS';save();
}

async function conversionRejections(){
 const m=state.markets['ETH-S1-H1-T500'],amount=await read('ProtocolFeeVault',fees,'creatorLiability',[m.id,1,m.token]);check(amount>0n,'Need real residual rewards');
 const item={user:accounts.creator.address,creatorEpoch:1,maximumMeme:amount},dl=(await c.getBlock()).timestamp+240n;
 const before={meme:String(await read('ProtocolFeeVault',fees,'totalLiability',[m.token])),quote:String(await read('ProtocolFeeVault',fees,'totalLiability',[zero])),nonce:String(await read('ProtocolFeeVault',fees,'conversionNonce',[m.id]))};
 await strictReject('conversion-expired','admin','ProtocolFeeVault',fees,'settleRewards',[m.id,[item],1n,1n],'InvalidConversion');
 await strictReject('conversion-duplicate-items','admin','ProtocolFeeVault',fees,'settleRewards',[m.id,[item,item],1n,dl],'InvalidConversion');
 await strictReject('conversion-wrong-beneficiary','admin','ProtocolFeeVault',fees,'settleRewards',[m.id,[{...item,user:accounts.buyer.address}],1n,dl],'InvalidConversion');
 await strictReject('conversion-min-output','admin','ProtocolFeeVault',fees,'settleRewards',[m.id,[item],2n**200n,dl],'InvalidRewardConversion');
 check(String(await read('ProtocolFeeVault',fees,'totalLiability',[m.token]))===before.meme,'Failed conversion changed meme liability');check(String(await read('ProtocolFeeVault',fees,'totalLiability',[zero]))===before.quote,'Failed conversion changed quote liability');check(String(await read('ProtocolFeeVault',fees,'conversionNonce',[m.id]))===before.nonce,'Failed conversion changed nonce');record('conversion-failures-state-unchanged',{...before,evidenceType:'ETH_CALL_ONLY',notMinedRevert:true});
}

try{
 check(p.releaseId===hash('TICKERGARDEN_ARB_SEPOLIA_R5_NO_STAKING_FEE_FIX_CLEAN_BUILD_2026_09_06'),'Expected R5');
 for(const entry of p.contracts)check(keccak256(await c.getCode({address:entry.address}))===entry.runtimeCodeHash,'Code drift '+entry.name);
 const catalog='docs/testing/R5_BUSINESS_CASES.json';check(fs.existsSync(catalog),'Case catalog must exist before public execution');
 const digest=hash(fs.readFileSync(catalog,'utf8'));if(state.catalogHash)check(state.catalogHash===digest,'Catalog changed');else state.catalogHash=digest;save();
 if(stage==='matrix')await matrix();else if(stage==='graduated')await graduated();else if(stage==='negative')await negative();else if(stage==='lifecycle')await lifecycle();else if(stage==='conversion-rejections')await conversionRejections();else throw Error('Unknown stage');
 delete state.error;state.updatedAt=new Date().toISOString();save();console.log(JSON.stringify({status:state.status,transactions:state.transactions.length,checks:state.checks.length}));
}catch(error){state.failures??=[];state.failures.push({at:new Date().toISOString(),stage,message:error.shortMessage??error.message});state.status='STOPPED_REQUIRES_RECONCILIATION';state.error=error.shortMessage??error.message;save();console.error(state.error);process.exitCode=1;}
