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
const out = 'outputs/reviews/arbitrum-r3-extended';
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
    if(gasLimit*fees.maxFeePerGas>parseEther('0.01') || value>parseEther('0.03'))throw Error('Per-transaction test budget exceeded');
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
const prior=JSON.parse(fs.readFileSync('outputs/reviews/arbitrum-r3-scenarios/results.json'));
if(prior.releaseId!==p.releaseId)throw Error('Wrong prior release');
const m=prior.markets.active;
const asBig=params=>({...params});
const check=(condition,message)=>{if(!condition)throw Error(message);};
async function forcedRevert(id,role,name,address,fn,args=[],value=0n){
  if(!state.transactions.some(t=>t.id===id&&t.status==='EXPECTED_REVERT'))await rejects(id+'-preflight',role,name,address,fn,args,value);
  const data=encodeFunctionData({abi:artifact(name).abi,functionName:fn,args});
  let t=state.transactions.find(x=>x.id===id);
  if(!t){
    const account=accounts[role];const nonce=await c.getTransactionCount({address:account.address,blockTag:'pending'});
    const fee=await c.estimateFeesPerGas();const gas=1500000n;
    if(gas*fee.maxFeePerGas>parseEther('0.01')||value>parseEther('0.03'))throw Error('Revert budget exceeded');
    const req=await clients[role].prepareTransactionRequest({account,to:address,data,value,nonce,gas,...fee});
    const signed=await clients[role].signTransaction(req);t={id,role,to:address,inputHash:keccak256(data),value:String(value),nonce,hash:keccak256(signed),expectedStatus:'reverted',status:'SIGNED'};state.transactions.push(t);save();
    await c.sendRawTransaction({serializedTransaction:signed});t.status='SUBMITTED';save();
  } else check(t.inputHash===keccak256(data)&&t.to===address&&BigInt(t.value)===value,'Changed reverted tx');
  const r=await c.waitForTransactionReceipt({hash:t.hash,confirmations:2,timeout:120000});
  Object.assign(t,{status:r.status==='reverted'?'EXPECTED_REVERT':'UNEXPECTED_SUCCESS',blockNumber:String(r.blockNumber),gasUsed:String(r.gasUsed),gasCostWei:String(r.gasUsed*r.effectiveGasPrice)});save();
  check(r.status==='reverted','Expected mined revert '+id);record(id,{type:'mined_revert',hash:t.hash});
}
async function run(){
  for(const entry of p.contracts){const code=await c.getCode({address:entry.address});check(code&&keccak256(code).toLowerCase()===entry.runtimeCodeHash.toLowerCase(),'Runtime drift '+entry.name);}
  record('r3-runtime-identity',{count:p.contracts.length});
  const launchFee=await read('TickerGardenFactoryV1',p.factory,'launchFee');
  // Missing option combinations, no developer buy. Fees remain genuine R3 parameters.
  for(const [key,staking,holders,tax]of [['no-stake-holders',false,true,500],['stake-no-holders',true,false,0]]){
    let row=state.markets[key];
    if(!row){const params={...prior.markets.active.params,assetUid:staking?prior.markets.active.params.assetUid:z32,name:'TG Extended '+key,symbol:staking?'tgEXTS':'tgEXTH',salt:hash(p.releaseId+':extended:'+key),stakingEnabled:staking,creatorFeesToHolders:holders,creatorTaxBps:tax,expectedEconomics:z32};
      params.expectedEconomics=await c.readContract({account:accounts.creator.address,address:p.factory,abi:artifact('TickerGardenFactoryV1').abi,functionName:'previewMarketEconomics',args:[params]});
      const sim=await c.simulateContract({account:accounts.creator.address,address:p.factory,abi:artifact('TickerGardenFactoryV1').abi,functionName:'createMarket',args:[params],value:launchFee});
      row={id:sim.result[0],token:sim.result[1],params};state.markets[key]=row;save();}
    await call('create-'+key,'creator','TickerGardenFactoryV1',p.factory,'createMarket',[row.params],launchFee);
    const mv=await read('MarketRegistryV1',registry,'market',[row.id]);row.curve=mv.config.curve;row.gauge=mv.config.gauge;save();
    check(mv.runtime.launchPhase===0,'Unexpected phase');check(await read('TickerGardenCurve',row.curve,'realQuoteReserve')===0n,'No-first-buy reserve not zero');
    record('no-first-buy-'+key,{marketId:row.id,staking,holders,tax,curve:row.curve,gauge:row.gauge});
  }
  // Impossible first-buy minimum: verify a genuinely mined revert leaves no created token.
  if(!state.rollback){let params={...state.markets['no-stake-holders'].params,salt:hash(p.releaseId+':extended:atomic-rollback'),expectedEconomics:z32};params.expectedEconomics=await c.readContract({account:accounts.creator.address,address:p.factory,abi:artifact('TickerGardenFactoryV1').abi,functionName:'previewMarketEconomics',args:[params]});const predicted=await read('TickerGardenFactoryV1',p.factory,'predictMarketAddresses',[accounts.creator.address,params]);state.rollback={params,predicted};save();}
  const rollback=state.rollback;
  await forcedRevert('atomic-first-buy-rollback','creator','LaunchAndBuyRouter',router,'launchAndBuy',[rollback.params,parseEther('0.001'),2n**255n,accounts.creator.address],launchFee+parseEther('0.001'));
  // predictMarketAddresses returns named struct; inspect code only at the predicted token field.
  const prediction=await read('TickerGardenFactoryV1',p.factory,'predictMarketAddresses',[accounts.creator.address,rollback.params]);
  const predictedToken=prediction.memeToken??prediction[1];check(predictedToken,'Missing predicted token');check(!(await c.getCode({address:predictedToken})),'Rollback leaked token deployment');record('rollback-no-token',{predictedToken});
  await call('fund-outsider-stock','staker','ArbitrumActiveScenarioStock',prior.activeStock,'transfer',[accounts.outsider.address,parseEther('20')]);
  await rejects('zero-stake','outsider','AllocationManager',manager,'stake',[m.id,0n]);
  await call('approve-outsider-stock','outsider','ArbitrumActiveScenarioStock',prior.activeStock,'approve',[vault,parseEther('10')]);
  await call('stake-second-user','outsider','AllocationManager',manager,'stake',[m.id,parseEther('10')]);
  await forcedRevert('stake-exhausted-allowance','outsider','AllocationManager',manager,'stake',[m.id,parseEther('1')]);
  if(!state.checks.some(x=>x.id==='failed-stake-principal-unchanged')){check(await read('UserStockVault',vault,'allocation',[m.params.assetUid,accounts.outsider.address,m.id])===parseEther('10'),'Failed stake changed allocation');record('failed-stake-principal-unchanged',true);}
  await call('approve-additional-stock','outsider','ArbitrumActiveScenarioStock',prior.activeStock,'approve',[vault,parseEther('5')]);
  await call('increase-second-user','outsider','AllocationManager',manager,'stake',[m.id,parseEther('5')]);
  check(await read('UserStockVault',vault,'allocation',[m.params.assetUid,accounts.outsider.address,m.id])===parseEther('15'),'Increase allocation');record('additional-stake-accounting',true);
  const position=await read('MemeStockGauge',m.gauge,'positionOf',[accounts.outsider.address]);
  const now=(await c.getBlock()).timestamp;const wait=BigInt(position.pendingGeneration)-now+1n;
  if(wait>0n){check(wait<=40n,'Unexpected activation delay');console.log('Waiting '+wait+' seconds for public-chain activation');await new Promise(r=>setTimeout(r,Number(wait)*1000));}
  await call('activate-second-user','outsider','MemeStockGauge',m.gauge,'checkpointActivations');
  const deployTx=prior.transactions.find(t=>t.id==='deploy-v4-test-router');const swapper=(await c.getTransactionReceipt({hash:deployTx.hash})).contractAddress;check(swapper,'Missing swap helper');
  const key=await read('MarketRegistryV1',registry,'canonicalPoolKey',[m.id]);const buy0=key.currency0.toLowerCase()===zero;
  await call('generate-multi-user-rewards','buyer','PoolSwapTest',swapper,'swap',[key,{zeroForOne:buy0,amountSpecified:-parseEther('0.003'),sqrtPriceLimitX96:buy0?4295128741n:1461446703485210103287273052203988822378723970341n},{takeClaims:false,settleUsingBurn:false},'0x'],parseEther('0.003'));
  await rejects('direct-gauge-settlement-rejected','outsider','MemeStockGauge',m.gauge,'settle',[accounts.outsider.address]);
  if(!state.conversionItems){const pos=await read('MemeStockGauge',m.gauge,'positionOf',[accounts.outsider.address]);const creatorMeme=await read('ProtocolFeeVault',fees,'creatorLiability',[m.id,1,m.token]);check(pos.memeClaimable>0n&&creatorMeme>0n,'Rewards missing');state.conversionItems=[{user:accounts.creator.address,creatorEpoch:1,maximumMeme:String(creatorMeme)},{user:accounts.outsider.address,creatorEpoch:0,maximumMeme:String(pos.memeClaimable)}];state.beforeConversion={creatorMeme:String(creatorMeme),outsiderMeme:String(pos.memeClaimable)};save();}
  const items=state.conversionItems.map(x=>({...x,maximumMeme:BigInt(x.maximumMeme)}));
  await forcedRevert('batch-conversion-slippage','admin','ProtocolFeeVault',fees,'settleRewards',[m.id,items,2n**255n,await deadline('batch-conversion-slippage')]);
  check(await read('ProtocolFeeVault',fees,'creatorLiability',[m.id,1,m.token])===BigInt(state.beforeConversion.creatorMeme),'Failed conversion debited creator');check((await read('MemeStockGauge',m.gauge,'positionOf',[accounts.outsider.address])).memeClaimable===BigInt(state.beforeConversion.outsiderMeme),'Failed conversion debited staker');record('failed-conversion-rewards-unchanged',true);
  await call('batch-conversion-success','admin','ProtocolFeeVault',fees,'settleRewards',[m.id,items,1n,await deadline('batch-conversion-success')]);
  const settled=await read('MemeStockGauge',m.gauge,'positionOf',[accounts.outsider.address]);check(settled.quoteClaimable>0n,'No converted quote');record('mixed-creator-staker-batch',{quoteClaimable:String(settled.quoteClaimable)});
  await call('request-raw-exit','creator','ProtocolFeeVault',fees,'requestRawRewardExit',[m.id]);
  state.rawExitAt??=String(await read('ProtocolFeeVault',fees,'rawRewardExitAt',[m.id,accounts.creator.address]));save();
  await call('repeat-raw-exit-request','creator','ProtocolFeeVault',fees,'requestRawRewardExit',[m.id]);check(String(await read('ProtocolFeeVault',fees,'rawRewardExitAt',[m.id,accounts.creator.address]))===state.rawExitAt,'Repeat exit resets timer');record('raw-exit-request-idempotent',true);
  await call('cancel-raw-exit','creator','ProtocolFeeVault',fees,'cancelRawRewardExit',[m.id]);check(await read('ProtocolFeeVault',fees,'rawRewardExitAt',[m.id,accounts.creator.address])===0n,'Cancel failed');record('raw-exit-cancel',true);
  await call('request-raw-exit-for-time-test','creator','ProtocolFeeVault',fees,'requestRawRewardExit',[m.id]);
  await call('second-user-rage-quit','outsider','AllocationManager',manager,'rageQuit',[m.id]);
  check(await read('ArbitrumActiveScenarioStock',prior.activeStock,'balanceOf',[accounts.outsider.address])===parseEther('20'),'Second-user principal not returned');check(await read('UserStockVault',vault,'allocation',[m.params.assetUid,accounts.outsider.address,m.id])===0n,'Exit allocation not zero');record('multi-user-exit-isolated',{originalStakerAllocation:String(await read('UserStockVault',vault,'allocation',[m.params.assetUid,accounts.staker.address,m.id]))});
  await finishExit();
  const pending=await read('AllocationManager',manager,'rageQuitSettlementPending',[m.id,accounts.outsider.address]);record('post-exit-settlement-call',{pending});
  const timestamp=(await c.getBlock()).timestamp;
  state.pendingTimeTests={observedTimestamp:String(timestamp),stakerUnlockAt:prior.stakerUnlockAt,rawCreatorExitAt:String(await read('ProtocolFeeVault',fees,'rawRewardExitAt',[m.id,accounts.creator.address])),holderEpochEnd:prior.holderEpochEnd??'see original report'};
  state.status='IMMEDIATE_SCENARIOS_COMPLETED_TIME_GATES_PENDING';save();
}
async function feeOptions(){
  for(const key of ['no-stake-holders','stake-no-holders']){
    const market=state.markets[key];check(market,'Missing market '+key);
    await call('option-buy-'+key,'buyer','TickerGardenCurve',market.curve,'buy',[parseEther('0.002'),1n,accounts.buyer.address],parseEther('0.002'));
    state.optionSell??={};if(!state.optionSell[key]){state.optionSell[key]=String((await read('TickerMemeTokenV1',market.token,'balanceOf',[accounts.buyer.address]))/3n);save();}
    await call('option-approve-'+key,'buyer','TickerMemeTokenV1',market.token,'approve',[market.curve,BigInt(state.optionSell[key])]);
    await call('option-sell-'+key,'buyer','TickerGardenCurve',market.curve,'sell',[BigInt(state.optionSell[key]),1n,accounts.buyer.address]);
    await call('option-sweep-'+key,'outsider','TickerGardenCurve',market.curve,'sweepCurveFees');
    if(!state.optionCreatorFees)state.optionCreatorFees={};
    if(state.optionCreatorFees[key]===undefined){state.optionCreatorFees[key]=String(await read('ProtocolFeeVault',fees,'creatorLiability',[market.id,1,zero]));save();}
    check(BigInt(state.optionCreatorFees[key])>0n,'Creator fees absent');
    if(!market.params.stakingEnabled){
      await forcedRevert('regression-no-staking-creator-claim','creator','ProtocolFeeVault',fees,'claimCreator',[market.id,1,zero]);
      await rejects('regression-no-staking-platform-claim','buyer','ProtocolFeeVault',fees,'claimPlatform',[market.id,zero]);
      state.findings??=[];if(!state.findings.some(x=>x.id==='NO_STAKING_FEE_CLAIM_BLOCKED'))state.findings.push({id:'NO_STAKING_FEE_CLAIM_BLOCKED',status:'FAIL',severity:'HIGH',marketId:market.id,creatorLiability:state.optionCreatorFees[key],reason:'InvalidFeeMarket rejects zero gauge even for creator/platform claims',transaction:state.transactions.find(t=>t.id==='regression-no-staking-creator-claim').hash});save();continue;
    }
    await call('option-claim-'+key,'creator','ProtocolFeeVault',fees,'claimCreator',[market.id,1,zero]);
    check(await read('ProtocolFeeVault',fees,'creatorLiability',[market.id,1,zero])===0n,'Creator remaining after claim');
    await call('option-repeat-claim-'+key,'buyer','ProtocolFeeVault',fees,'claimCreator',[market.id,1,zero]);
    record('option-buy-sell-claim-'+key,{creatorFees:state.optionCreatorFees[key],claimableAfter:'0',thirdPartyRepeatClaim:true});
  }
  const dl=(await c.getBlock()).timestamp+240n;
  for(const [id,items,minQuote,deadlineValue]of [
    ['empty-batch',[],1n,dl],['zero-minimum',[{user:accounts.creator.address,creatorEpoch:1,maximumMeme:1n}],0n,dl],
    ['expired-deadline',[{user:accounts.creator.address,creatorEpoch:1,maximumMeme:1n}],1n,1n],
    ['oversize-batch',Array.from({length:33},()=>({user:accounts.creator.address,creatorEpoch:1,maximumMeme:1n})),1n,dl]
  ]) await rejects('conversion-'+id,'admin','ProtocolFeeVault',fees,'settleRewards',[m.id,items,minQuote,deadlineValue]);
  await rejects('raw-claim-before-delay','creator','ProtocolFeeVault',fees,'claimCreator',[m.id,1,m.token]);
  await rejects('outsider-set-settlement-operator','outsider','ProtocolFeeVault',fees,'setSettlementOperator',[accounts.outsider.address]);
  await rejects('outsider-retire-asset','outsider','OfficialStockRegistryV1',stocks,'retireAsset',[m.params.assetUid,hash('unauthorized-retire')]);
  await rejects('outsider-change-minimum','outsider','OfficialStockRegistryV1',stocks,'setMinimumAllocation',[m.params.assetUid,414n,hash('unauthorized-minimum')]);
  await rejects('outsider-accept-stock-implementation','outsider','OfficialStockRegistryV1',stocks,'acceptAssetImplementation',[m.params.assetUid,prior.activeStock,keccak256(await c.getCode({address:prior.activeStock})),hash('unauthorized-upgrade')]);
  const pos=await read('MemeStockGauge',m.gauge,'positionOf',[accounts.staker.address]);
  const window=await read('TreasuryDistributorV1',distributor,'epochWindow',[m.id,1]);
  const paused=await read('OfficialStockRegistryV1',stocks,'asset',[prior.markets.sharing.params.assetUid]);
  state.timeObservations={observedTimestamp:String((await c.getBlock()).timestamp),stakerUnlockAt:String(pos.unlockAt),holderWindow:window,pausedAsset:paused,rawExitAt:String(await read('ProtocolFeeVault',fees,'rawRewardExitAt',[m.id,accounts.creator.address]))};
  state.status=state.findings?.length?'FAILED_WITH_UNCOVERED_BLOCKERS':'IMMEDIATE_SCENARIOS_COMPLETED_TIME_AND_RH_SOURCE_BLOCKED';save();
}

async function finishExit(){
  const before=await read('AllocationManager',manager,'rageQuitSettlementPending',[m.id,accounts.outsider.address]);
  if(before[0]){
    state.deferredExitBefore=before;save();
    await call('permissionless-deferred-settlement','buyer','AllocationManager',manager,'settleRageQuitRewards',[m.id,accounts.outsider.address]);
    const after=await read('AllocationManager',manager,'rageQuitSettlementPending',[m.id,accounts.outsider.address]);
    check(!after[0],'Deferred settlement not cleared');record('deferred-reward-settlement-recovered',{before,after});
  }
  await rejects('no-pending-settlement-rejected','buyer','AllocationManager',manager,'settleRageQuitRewards',[m.id,accounts.outsider.address]);
  state.status='IMMEDIATE_PHASE_ONE_COMPLETED';save();
}

async function erc20Quote(){
  const token=prior.activeStock;
  const quoteId=keccak256(encodeAbiParameters([{type:'bytes32'},{type:'uint256'},{type:'uint256'},{type:'bytes32'},{type:'address'},{type:'uint8'},{type:'uint256'},{type:'uint256'}],[hash('TICKERGARDEN_V1_QUOTE_ECONOMICS'),1n,421614n,active.baselineId,token,18,parseEther('40'),parseEther('100')]));
  const config={tickerGardenBaselineId:active.baselineId,quoteAsset:token,quoteDecimals:18,phantomQuote:parseEther('40'),graduationThreshold:parseEther('100'),economicsHash:quoteId,status:1};
  await call('whitelist-test-erc20-quote','admin','ApprovedQuoteRegistry',quotes,'addQuoteConfig',[quoteId,config]);
  await call('fund-erc20-quote','staker','ArbitrumActiveScenarioStock',token,'transfer',[accounts.buyer.address,parseEther('250')]);
  const key='erc20-quote';let row=state.markets[key];
  const launchFee=await read('TickerGardenFactoryV1',p.factory,'launchFee');
  if(!row){const params={...prior.markets.active.params,quoteAssetConfigId:quoteId,name:'TG ERC20 Quote Test',symbol:'tgERCQ',creatorRevenueBeneficiary:accounts.buyer.address,salt:hash(p.releaseId+':extended:erc20-quote'),expectedEconomics:z32};params.expectedEconomics=await c.readContract({account:accounts.buyer.address,address:p.factory,abi:artifact('TickerGardenFactoryV1').abi,functionName:'previewMarketEconomics',args:[params]});state.erc20Params=params;save();}
  const params=row?.params??state.erc20Params;
  await call('approve-erc20-first-buy','buyer','ArbitrumActiveScenarioStock',token,'approve',[router,parseEther('1')]);
  if(!row){const sim=await c.simulateContract({account:accounts.buyer.address,address:router,abi:artifact('LaunchAndBuyRouter').abi,functionName:'launchAndBuy',args:[params,parseEther('1'),1n,accounts.buyer.address],value:launchFee});row={id:sim.result[0],token:sim.result[1],params};state.markets[key]=row;save();}
  await call('erc20-atomic-first-buy','buyer','LaunchAndBuyRouter',router,'launchAndBuy',[params,parseEther('1'),1n,accounts.buyer.address],launchFee);
  const mv=await read('MarketRegistryV1',registry,'market',[row.id]);row.curve=mv.config.curve;row.gauge=mv.config.gauge;save();
  await call('approve-erc20-curve','buyer','ArbitrumActiveScenarioStock',token,'approve',[row.curve,parseEther('200')]);
  await call('erc20-curve-buy','buyer','TickerGardenCurve',row.curve,'buy',[parseEther('2'),1n,accounts.buyer.address]);
  if(!state.erc20Sell){state.erc20Sell=String((await read('TickerMemeTokenV1',row.token,'balanceOf',[accounts.buyer.address]))/10n);save();}
  await call('approve-erc20-market-meme','buyer','TickerMemeTokenV1',row.token,'approve',[row.curve,BigInt(state.erc20Sell)]);
  await call('erc20-curve-sell','buyer','TickerGardenCurve',row.curve,'sell',[BigInt(state.erc20Sell),1n,accounts.buyer.address]);
  await call('erc20-graduate','buyer','TickerGardenCurve',row.curve,'buy',[parseEther('130'),1n,accounts.buyer.address]);
  check((await read('MarketRegistryV1',registry,'market',[row.id])).runtime.launchPhase===1,'ERC20 graduation failed');record('erc20-quote-graduation',{marketId:row.id,quoteToken:token,quoteId});
  await call('erc20-creator-claim','outsider','ProtocolFeeVault',fees,'claimCreator',[row.id,1,token]);
  check(await read('ProtocolFeeVault',fees,'creatorLiability',[row.id,1,token])===0n,'ERC20 fee remaining');record('erc20-quote-creator-claim',true);
  const swapper=(await c.getTransactionReceipt({hash:prior.transactions.find(t=>t.id==='deploy-v4-test-router').hash})).contractAddress;
  await call('approve-erc20-v4','buyer','ArbitrumActiveScenarioStock',token,'approve',[swapper,parseEther('1')]);
  const poolKey=await read('MarketRegistryV1',registry,'canonicalPoolKey',[row.id]);const buy0=poolKey.currency0.toLowerCase()===token.toLowerCase();
  await call('erc20-v4-buy','buyer','PoolSwapTest',swapper,'swap',[poolKey,{zeroForOne:buy0,amountSpecified:-parseEther('1'),sqrtPriceLimitX96:buy0?4295128741n:1461446703485210103287273052203988822378723970341n},{takeClaims:false,settleUsingBurn:false},'0x']);
  record('erc20-v4-route',true);state.status=state.findings?.length?'FAILED_WITH_UNCOVERED_BLOCKERS':'IMMEDIATE_SCENARIOS_COMPLETED';save();
}

async function erc20Rewards(){
 const row=state.markets['erc20-quote'];const token=prior.activeStock;check(row,'Missing ERC20 market');
 const swapper=(await c.getTransactionReceipt({hash:prior.transactions.find(t=>t.id==='deploy-v4-test-router').hash})).contractAddress;
 const key=await read('MarketRegistryV1',registry,'canonicalPoolKey',[row.id]);const sell0=key.currency0.toLowerCase()===row.token.toLowerCase();
 if(!state.erc20V4Sell){state.erc20V4Sell=String((await read('TickerMemeTokenV1',row.token,'balanceOf',[accounts.buyer.address]))/100n);save();}
 await call('approve-erc20-v4-sell','buyer','TickerMemeTokenV1',row.token,'approve',[swapper,BigInt(state.erc20V4Sell)]);
 await call('erc20-v4-sell','buyer','PoolSwapTest',swapper,'swap',[key,{zeroForOne:sell0,amountSpecified:-BigInt(state.erc20V4Sell),sqrtPriceLimitX96:sell0?4295128741n:1461446703485210103287273052203988822378723970341n},{takeClaims:false,settleUsingBurn:false},'0x']);
 if(!state.erc20RewardMeme){state.erc20RewardMeme=String(await read('ProtocolFeeVault',fees,'creatorLiability',[row.id,1,row.token]));save();}check(BigInt(state.erc20RewardMeme)>0n,'Missing ERC20-route reward');
 await call('erc20-reward-conversion','admin','ProtocolFeeVault',fees,'settleRewards',[row.id,[{user:accounts.buyer.address,creatorEpoch:1,maximumMeme:BigInt(state.erc20RewardMeme)}],1n,await deadline('erc20-reward-conversion')]);
 await call('erc20-converted-creator-claim','outsider','ProtocolFeeVault',fees,'claimCreator',[row.id,1,token]);
 record('erc20-reward-conversion-and-claim',true);
 if(!state.erc20HolderMeme){state.erc20HolderMeme=String(await read('ProtocolFeeVault',fees,'holderLiability',[row.id,1,row.token]));save();}
 await call('erc20-holder-conversion','admin','ProtocolFeeVault',fees,'settleHolderRewards',[row.id,1,BigInt(state.erc20HolderMeme),1n,await deadline('erc20-holder-conversion')]);
 await call('erc20-holder-funding','outsider','ProtocolFeeVault',fees,'fundHolderRewards',[row.id,1]);
 const amount=await read('TreasuryDistributorV1',distributor,'epochQuoteAmount',[row.id,1]);check(amount>0n,'Missing ERC20 holder funding');record('erc20-holder-conversion-and-funding',{epochId:1,amount:String(amount)});
 state.status=state.findings?.length?'FAILED_WITH_UNCOVERED_BLOCKERS':'IMMEDIATE_SCENARIOS_COMPLETED';save();
}

async function controls(){
 const uid=m.params.assetUid;
 state.originalMinimum??=String(await read('OfficialStockRegistryV1',stocks,'minimumAllocation',[uid]));save();
 await call('admin-set-minimum','admin','OfficialStockRegistryV1',stocks,'setMinimumAllocation',[uid,parseEther('2'),hash('extended-test-minimum')]);
 try {await rejects('stake-below-updated-minimum','outsider','AllocationManager',manager,'stake',[m.id,parseEther('1')]);}
 finally {await call('admin-restore-minimum','admin','OfficialStockRegistryV1',stocks,'setMinimumAllocation',[uid,BigInt(state.originalMinimum),hash('extended-test-restore')]);}
 check(String(await read('OfficialStockRegistryV1',stocks,'minimumAllocation',[uid]))===state.originalMinimum,'Minimum not restored');record('admin-minimum-update-restored',true);
 const row=state.markets['erc20-quote'];const qid=row.params.quoteAssetConfigId;
 await call('pause-test-erc20-quote','admin','ApprovedQuoteRegistry',quotes,'pauseQuote',[qid,hash('extended-pause-test')]);
 await rejects('paused-quote-new-market','buyer','TickerGardenFactoryV1',p.factory,'previewMarketEconomics',[{...row.params,salt:hash('paused-quote-new-market')}]);
 await rejects('test-quote-unpause-too-early','admin','ApprovedQuoteRegistry',quotes,'unpauseQuote',[qid]);
 record('test-erc20-quote-paused',{quoteId:qid,onlyExtendedFixture:true});
 state.status=state.findings?.length?'FAILED_WITH_UNCOVERED_BLOCKERS':'IMMEDIATE_SCENARIOS_COMPLETED';save();
}

async function minimumProof(){
 const uid=m.params.assetUid;
 const oldCheck=state.checks.find(x=>x.id==='stake-below-updated-minimum');if(oldCheck){oldCheck.status='SUPERSEDED_WRONG_REVERT';oldCheck.note='Allowance rejection preceded minimum check; replaced with funded and approved mined test.';save();}
 await call('minimum-test-approve','outsider','ArbitrumActiveScenarioStock',prior.activeStock,'approve',[vault,parseEther('1')]);
 await call('minimum-test-set-two','admin','OfficialStockRegistryV1',stocks,'setMinimumAllocation',[uid,parseEther('2'),hash('extended-minimum-proof')]);
 try{
  await forcedRevert('minimum-with-valid-allowance','outsider','AllocationManager',manager,'stake',[m.id,parseEther('1')]);
  check(state.checks.find(x=>x.id==='minimum-with-valid-allowance-preflight')?.detail.errorName==='PositionBelowMinimum','Wrong minimum revert');
  check(await read('ArbitrumActiveScenarioStock',prior.activeStock,'balanceOf',[accounts.outsider.address])===parseEther('20'),'Failed minimum lost principal');record('minimum-transfer-rollback',true);
 }finally{
  await call('minimum-proof-restore','admin','OfficialStockRegistryV1',stocks,'setMinimumAllocation',[uid,BigInt(state.originalMinimum),hash('extended-minimum-proof-restore')]);
  await call('minimum-proof-revoke-approval','outsider','ArbitrumActiveScenarioStock',prior.activeStock,'approve',[vault,0n]);
 }
 state.status='FAILED_WITH_UNCOVERED_BLOCKERS';save();
}

const phase=process.argv[3]??'run';
const completedCheck={minimum:'minimum-transfer-rollback',controls:'test-erc20-quote-paused','erc20-rewards':'erc20-holder-conversion-and-funding',erc20:'erc20-v4-route',fees:'test-quote-unpause-too-early',exit:'no-pending-settlement-rejected',run:'deferred-reward-settlement-recovered'};
const dispatch={minimum:minimumProof,controls,'erc20-rewards':erc20Rewards,erc20:erc20Quote,fees:feeOptions,exit:finishExit,run};
if(!dispatch[phase])throw Error('Unknown phase');
try{if(state.checks.some(x=>x.id===completedCheck[phase]&&x.status==='PASS'))console.log('Phase already completed; no duplicate transactions: '+phase);else await dispatch[phase]();}catch(e){state.status='STOPPED';state.error=e.shortMessage??e.message;save();console.error(state.error);process.exitCode=1;}
