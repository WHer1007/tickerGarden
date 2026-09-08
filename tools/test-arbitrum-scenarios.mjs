import fs from 'node:fs';
import path from 'node:path';
import {
  createPublicClient, createWalletClient, http, parseEther, formatEther, keccak256, toBytes,
  encodeFunctionData, encodeDeployData, getContractAddress, decodeErrorResult, decodeEventLog,
} from '../apps/web/node_modules/viem/_esm/index.js';
import {generatePrivateKey, privateKeyToAccount} from '../apps/web/node_modules/viem/_esm/accounts/index.js';
import {arbitrumSepolia} from '../apps/web/node_modules/viem/_esm/chains/index.js';

// Resumable test-only runner. Private keys never enter repository artifacts or console output.
const mode = process.argv[2];
if (!['prepare', 'run'].includes(mode)) throw Error('Expected prepare or run');
const expectedAdmin = '0xA6c3298a5559544c3b4cf8e6DC5f349f4be524ea';
const walletDir = '/Users/dear/.config/tickergarden/testnet-wallets';
const secretPath = path.join(walletDir, 'arbitrum-sepolia-r3-roles.json');
const out = 'outputs/reviews/arbitrum-r3-scenarios';
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
const save=()=>fs.writeFileSync(statePath,JSON.stringify(state,(_,v)=>typeof v==='bigint'?String(v):v,2)+'\n');
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
try{
  if(await read('TreasuryDistributorV1',distributor,'EPOCH_DURATION')!==604800)throw Error('Not seven days');
  if(BigInt(active.graduationThreshold)!==parseEther('0.42'))throw Error('Wrong threshold');
  record('release-parameters',{epochSeconds:604800,claimWindow:String(await read('TreasuryDistributorV1',distributor,'claimWindow')),graduationETH:'0.42',phantomETH:'0.168'});
  // Deliberately capped at 1.08 ETH total; unused funds remain in the user's test-role wallets.
  for(const [role,amount]of [['creator','0.15'],['buyer','0.85'],['staker','0.06'],['outsider','0.02']])await send('fund-'+role,'admin',accounts[role].address,'0x',parseEther(amount));
  const stock=await deploy('deploy-synthetic-stock','ArbitrumScenarioStock',[accounts.staker.address]);
  state.syntheticStock=stock;save();const uid=await read('ArbitrumScenarioStock',stock,'uid');const code=await c.getCode({address:stock});
  const fp={tokenRuntimeCodeHash:keccak256(code),beacon:zero,beaconRuntimeCodeHash:z32,implementation:stock,implementationRuntimeCodeHash:keccak256(code)};
  await rejects('outsider-register-asset','outsider','OfficialStockRegistryV1',stocks,'registerAsset',[uid,stock,18,vault,parseEther('1'),fp]);
  await call('register-synthetic-stock','admin','OfficialStockRegistryV1',stocks,'registerAsset',[uid,stock,18,vault,parseEther('1'),fp]);
  record('synthetic-stock-fingerprint',await read('OfficialStockRegistryV1',stocks,'assetIdentityCurrent',[uid]));
  const launchFee=await read('TickerGardenFactoryV1',p.factory,'launchFee');
  for(const [key,sharing,staking,tax]of [['sharing',true,true,500],['plain',false,false,0]]){
    const params={assetUid:staking?uid:z32,tickerGardenBaselineId:active.baselineId,quoteAssetConfigId:active.quoteId,launchTemplateId:active.templateId,expectedEconomics:z32,creatorRevenueBeneficiary:accounts.creator.address,name:sharing?'TickerGarden Holder Test':'TickerGarden Plain Test',symbol:sharing?'tgHOLD':'tgPLAIN',metadataURI:'data:application/json,%7B%22testOnly%22%3Atrue%7D',salt:hash(p.releaseId+':scenario:'+key),creatorTaxBps:tax,creatorFeesToHolders:sharing,stakingEnabled:staking};
    params.expectedEconomics=state.markets[key]?.params.expectedEconomics??await c.readContract({account:accounts.creator.address,address:p.factory,abi:artifact('TickerGardenFactoryV1').abi,functionName:'previewMarketEconomics',args:[params]});
    if(!state.markets[key]){
      const result=await c.simulateContract({account:accounts.creator.address,address:router,abi:artifact('LaunchAndBuyRouter').abi,functionName:'launchAndBuy',args:[params,parseEther('0.01'),1n,accounts.creator.address],value:launchFee+parseEther('0.01')});
      const [id,token]=result.result;state.markets[key]={id,token,params};save();
    }
    const m=state.markets[key];
    await call('launch-'+key,'creator','LaunchAndBuyRouter',router,'launchAndBuy',[params,parseEther('0.01'),1n,accounts.creator.address],launchFee+parseEther('0.01'));
    const view=await read('MarketRegistryV1',registry,'market',[m.id]);m.curve=view.config.curve;m.gauge=view.config.gauge;save();
    record('atomic-launch-'+key,{marketId:m.id,staking,sharing,creatorTaxBps:tax});
  }
  let m=state.markets.sharing;const n=state.markets.plain;
  await rejects('creator-tax-above-cap','creator','TickerGardenFactoryV1',p.factory,'createMarket',[{...m.params,salt:hash('invalid-tax'),creatorTaxBps:501}],launchFee);
  await rejects('unknown-quote','creator','TickerGardenFactoryV1',p.factory,'createMarket',[{...m.params,salt:hash('invalid-quote'),quoteAssetConfigId:hash('unregistered')}],launchFee);
  await rejects('missing-stock-identity','creator','TickerGardenFactoryV1',p.factory,'createMarket',[{...m.params,salt:hash('invalid-stock'),assetUid:z32}],launchFee);
  await rejects('wrong-launch-fee','creator','TickerGardenFactoryV1',p.factory,'createMarket',[{...m.params,salt:hash('invalid-fee')}],0n);
  await rejects('duplicate-market','creator','TickerGardenFactoryV1',p.factory,'createMarket',[m.params],launchFee);
  await rejects('disabled-staking','staker','AllocationManager',manager,'stake',[n.id,parseEther('10')]);
  await rejects('stake-before-graduation','staker','AllocationManager',manager,'stake',[m.id,parseEther('10')]);
  await rejects('buy-slippage','buyer','TickerGardenCurve',m.curve,'buy',[parseEther('0.02'),2n**255n,accounts.buyer.address],parseEther('0.02'));
  await call('curve-buy','buyer','TickerGardenCurve',m.curve,'buy',[parseEther('0.02'),1n,accounts.buyer.address],parseEther('0.02'));
  if(!state.sellAmount){state.sellAmount=String((await read('TickerMemeTokenV1',m.token,'balanceOf',[accounts.buyer.address]))/4n);save();}
  const sellAmount=BigInt(state.sellAmount);
  await call('approve-curve','buyer','TickerMemeTokenV1',m.token,'approve',[m.curve,sellAmount]);
  await call('curve-sell','buyer','TickerGardenCurve',m.curve,'sell',[sellAmount,1n,accounts.buyer.address]);
  await call('sweep-curve','outsider','TickerGardenCurve',m.curve,'sweepCurveFees');
  const creatorBefore=await read('ProtocolFeeVault',fees,'creatorLiability',[m.id,1,zero]);
  if(creatorBefore===0n&&!state.transactions.some(t=>t.id==='creator-claim-curve'))throw Error('Missing creator fee');
  await call('creator-claim-curve','creator','ProtocolFeeVault',fees,'claimCreator',[m.id,1,zero]);
  record('creator-curve-claim',{liabilityAfter:String(await read('ProtocolFeeVault',fees,'creatorLiability',[m.id,1,zero]))});
  await call('graduate','buyer','TickerGardenCurve',m.curve,'buy',[parseEther('0.55'),1n,accounts.buyer.address],parseEther('0.55'));
  const mv=await read('MarketRegistryV1',registry,'market',[m.id]);if(mv.runtime.launchPhase!==1)throw Error('Not graduated');record('atomic-graduation',{phase:mv.runtime.launchPhase,poolId:mv.runtime.poolId});
  await rejects('stake-without-allowance','staker','AllocationManager',manager,'stake',[m.id,parseEther('10')]);
  await call('approve-stock','staker','ArbitrumScenarioStock',stock,'approve',[vault,parseEther('1000')]);
  await call('stake','staker','AllocationManager',manager,'stake',[m.id,parseEther('100')]);
  if(!state.checks.some(x=>x.id==='direct-stake')){const locked=await read('UserStockVault',vault,'allocation',[uid,accounts.staker.address,m.id]);if(locked!==parseEther('100'))throw Error('Stake accounting');record('direct-stake',{amount:String(locked)});}
  await rejects('early-unstake','staker','AllocationManager',manager,'unstakeAndWithdraw',[m.id]);
  await rejects('outsider-pause-stock','outsider','OfficialStockRegistryV1',stocks,'pauseAsset',[uid,hash('test-pause')]);
  await call('pause-stock','admin','OfficialStockRegistryV1',stocks,'pauseAsset',[uid,hash('test-pause')]);
  await rejects('paused-stock-new-stake','staker','AllocationManager',manager,'stake',[m.id,parseEther('10')]);
  await call('rage-quit','staker','AllocationManager',manager,'rageQuit',[m.id]);
  if(!state.checks.some(x=>x.id==='rage-quit-principal-returned')){if(await read('UserStockVault',vault,'allocation',[uid,accounts.staker.address,m.id])!==0n)throw Error('Rage quit locked');record('rage-quit-principal-returned',true);}
  await rejects('unpause-cooldown-enforced','admin','OfficialStockRegistryV1',stocks,'unpauseAsset',[uid]);
  const activeStock=await deploy('deploy-active-stock','ArbitrumActiveScenarioStock',[accounts.staker.address]);
  const activeUid=await read('ArbitrumActiveScenarioStock',activeStock,'uid');const activeCode=keccak256(await c.getCode({address:activeStock}));
  await call('register-active-stock','admin','OfficialStockRegistryV1',stocks,'registerAsset',[activeUid,activeStock,18,vault,parseEther('1'),{tokenRuntimeCodeHash:activeCode,beacon:zero,beaconRuntimeCodeHash:z32,implementation:activeStock,implementationRuntimeCodeHash:activeCode}]);
  const activeParams={...m.params,assetUid:activeUid,salt:hash(p.releaseId+':active-staker'),name:'TickerGarden Active Staker Test',symbol:'tgACTIVE'};
  activeParams.expectedEconomics=state.markets.active?.params.expectedEconomics??await c.readContract({account:accounts.creator.address,address:p.factory,abi:artifact('TickerGardenFactoryV1').abi,functionName:'previewMarketEconomics',args:[activeParams]});
  if(!state.markets.active){const sim=await c.simulateContract({account:accounts.creator.address,address:router,abi:artifact('LaunchAndBuyRouter').abi,functionName:'launchAndBuy',args:[activeParams,parseEther('0.01'),1n,accounts.creator.address],value:launchFee+parseEther('0.01')});state.markets.active={id:sim.result[0],token:sim.result[1],params:activeParams};save();}
  await call('launch-active','creator','LaunchAndBuyRouter',router,'launchAndBuy',[activeParams,parseEther('0.01'),1n,accounts.creator.address],launchFee+parseEther('0.01'));
  m=state.markets.active;const activeView=await read('MarketRegistryV1',registry,'market',[m.id]);m.curve=activeView.config.curve;m.gauge=activeView.config.gauge;state.activeStock=activeStock;save();
  await send('fund-second-graduation','admin',accounts.buyer.address,'0x',parseEther('0.15'));
  await call('graduate-active','buyer','TickerGardenCurve',m.curve,'buy',[parseEther('0.50'),1n,accounts.buyer.address],parseEther('0.50'));
  await call('approve-active-stock','staker','ArbitrumActiveScenarioStock',activeStock,'approve',[vault,parseEther('1000')]);
  record('independent-active-staker-market',{marketId:m.id,syntheticStock:activeStock});
  await call('restake','staker','AllocationManager',manager,'stake',[m.id,parseEther('100')]);
  await rejects('curve-trading-after-graduation','buyer','TickerGardenCurve',m.curve,'buy',[1n,0n,accounts.buyer.address],1n);
  await rejects('holder-root-before-seven-days','buyer','TreasuryDistributorV1',distributor,'requestRoot',[m.id,1],parseEther('0.001'));
  const swapper=await deploy('deploy-v4-test-router','PoolSwapTest',[mv.config.poolManager??JSON.parse(fs.readFileSync('deployments/manifests/arbitrum-sepolia-421614.v1.plan.json')).externalDependencies.find(x=>x.name==='POOL_MANAGER').address]);
  const position=await read('MemeStockGauge',m.gauge,'positionOf',[accounts.staker.address]);
  const latest=await c.getBlock();const waitSeconds=Number(BigInt(position.pendingGeneration)-latest.timestamp+1n);
  if(waitSeconds>0&&waitSeconds<=35){console.log('Waiting '+waitSeconds+' seconds for real stake activation');await new Promise(r=>setTimeout(r,waitSeconds*1000));}
  await call('checkpoint-staker','outsider','MemeStockGauge',m.gauge,'checkpointActivations');
  const key=await read('MarketRegistryV1',registry,'canonicalPoolKey',[m.id]);const settings={takeClaims:false,settleUsingBurn:false};
  const buy0=key.currency0===zero;
  await call('v4-buy','buyer','PoolSwapTest',swapper,'swap',[key,{zeroForOne:buy0,amountSpecified:-parseEther('0.005'),sqrtPriceLimitX96:buy0?4295128741n:1461446703485210103287273052203988822378723970341n},settings,'0x'],parseEther('0.005'));
  const sell0=!buy0;if(!state.v4SellAmount){state.v4SellAmount=String((await read('TickerMemeTokenV1',m.token,'balanceOf',[accounts.buyer.address]))/100n);save();}
  await call('approve-v4','buyer','TickerMemeTokenV1',m.token,'approve',[swapper,BigInt(state.v4SellAmount)]);
  await call('v4-sell','buyer','PoolSwapTest',swapper,'swap',[key,{zeroForOne:sell0,amountSpecified:-BigInt(state.v4SellAmount),sqrtPriceLimitX96:sell0?4295128741n:1461446703485210103287273052203988822378723970341n},settings,'0x']);
  record('v4-buy-and-sell',true);
  await rejects('unauthorized-reward-conversion','outsider','ProtocolFeeVault',fees,'settleRewards',[m.id,[],1n,2n**64n]);
  if(!state.creatorMeme){state.creatorMeme=String(await read('ProtocolFeeVault',fees,'creatorLiability',[m.id,1,m.token]));save();}
  await rejects('conversion-deadline-too-far','admin','ProtocolFeeVault',fees,'settleRewards',[m.id,[{user:accounts.creator.address,creatorEpoch:1,maximumMeme:BigInt(state.creatorMeme)}],1n,2n**64n]);
  if(BigInt(state.creatorMeme)>0n){
    await call('convert-creator-rewards','admin','ProtocolFeeVault',fees,'settleRewards',[m.id,[{user:accounts.creator.address,creatorEpoch:1,maximumMeme:BigInt(state.creatorMeme)}],1n,await deadline('convert-creator-rewards')]);
    await call('claim-converted-creator','creator','ProtocolFeeVault',fees,'claimCreator',[m.id,1,zero]);record('creator-internal-conversion',true);
  }
  if(!state.stakerMeme){const position=await read('MemeStockGauge',m.gauge,'positionOf',[accounts.staker.address]);state.stakerMeme=String(position.memeClaimable);save();}
  if(BigInt(state.stakerMeme)>0n){await call('convert-staker-rewards','admin','ProtocolFeeVault',fees,'settleRewards',[m.id,[{user:accounts.staker.address,creatorEpoch:0,maximumMeme:BigInt(state.stakerMeme)}],1n,await deadline('convert-staker-rewards')]);await rejects('staker-claim-before-unlock','staker','ProtocolFeeVault',fees,'claimStaker',[m.id,zero]);const settledPosition=await read('MemeStockGauge',m.gauge,'positionOf',[accounts.staker.address]);if(settledPosition.quoteClaimable===0n)throw Error('Missing converted staker Quote');state.stakerUnlockAt=String(settledPosition.unlockAt);record('staker-internal-conversion',{quoteClaimable:String(settledPosition.quoteClaimable),unlockAt:state.stakerUnlockAt});}
  else throw Error('No staker meme reward: activation/reward scenario incomplete');
  const holderMeme=await read('ProtocolFeeVault',fees,'holderLiability',[m.id,1,m.token]);record('holder-fee-separate',{memeLiability:String(holderMeme),creatorMemeRemaining:String(await read('ProtocolFeeVault',fees,'creatorLiability',[m.id,1,m.token]))});
  if(!state.holderMeme){state.holderMeme=String(holderMeme);save();}
  const creatorQuoteBeforeHolder=await read('ProtocolFeeVault',fees,'creatorLiability',[m.id,1,zero]);
  if(BigInt(state.holderMeme)>0n)await call('convert-holder-rewards','admin','ProtocolFeeVault',fees,'settleHolderRewards',[m.id,1,BigInt(state.holderMeme),1n,await deadline('convert-holder-rewards')]);
  if(await read('ProtocolFeeVault',fees,'creatorLiability',[m.id,1,zero])!==creatorQuoteBeforeHolder)throw Error('Holder conversion changed creator balance');
  await call('fund-holder-period','outsider','ProtocolFeeVault',fees,'fundHolderRewards',[m.id,1]);
  const funded=await read('TreasuryDistributorV1',distributor,'epochQuoteAmount',[m.id,1]);if(funded===0n)throw Error('Holder period not funded');
  state.holderEpochQuoteAmount=String(funded);record('holder-internal-conversion-and-period-funding',{epochId:1,quoteAmount:String(funded)});
  await call('claim-platform','outsider','ProtocolFeeVault',fees,'claimPlatform',[m.id,zero]);
  record('permissionless-platform-claim-fixed-recipient',true);
  const feeEvents=[];for(const tx of state.transactions){const receipt=await c.getTransactionReceipt({hash:tx.hash});for(const log of receipt.logs){if(log.address.toLowerCase()!==fees.toLowerCase())continue;try{const e=decodeEventLog({abi:artifact('ProtocolFeeVault').abi,data:log.data,topics:log.topics});if(['FeeClaimed','FeeBucketsCredited','HolderFeesAccrued','CurveFeesSwept','RewardConverted'].includes(e.eventName))feeEvents.push({transaction:tx.id,event:e.eventName,args:e.args});}catch{}}}
  for(const e of feeEvents.filter(x=>x.event==='FeeClaimed')){const recipient=e.args.beneficiary.toLowerCase();if(e.args.beneficiaryType===0&&recipient!==accounts.creator.address.toLowerCase())throw Error('Creator payment misdirected');if(e.args.beneficiaryType===1&&recipient!==accounts.staker.address.toLowerCase())throw Error('Staker payment misdirected');if(e.args.beneficiaryType===2&&recipient!==p.platformTreasury.toLowerCase())throw Error('Platform payment misdirected');}
  state.feeEvents=feeEvents;record('fee-recipient-audit',{events:feeEvents.length});
  for(const asset of [zero,m.token]){const balance=asset===zero?await c.getBalance({address:fees}):await read('TickerMemeTokenV1',asset,'balanceOf',[fees]);const liability=await read('ProtocolFeeVault',fees,'totalLiability',[asset]);if(balance<liability)throw Error('Fee vault insolvency');record('solvency-'+asset,{balance:String(balance),liability:String(liability)});}
  await rejects('outsider-transfer-creator','outsider','CreatorRevenueRegistry',creators,'transferCreatorRevenueBeneficiary',[n.id,accounts.buyer.address]);
  await call('transfer-creator-beneficiary','creator','CreatorRevenueRegistry',creators,'transferCreatorRevenueBeneficiary',[n.id,accounts.buyer.address]);
  if((await read('CreatorRevenueRegistry',creators,'creatorBeneficiaryAt',[n.id,2])).toLowerCase()!==accounts.buyer.address.toLowerCase())throw Error('Creator transfer mismatch');
  record('creator-beneficiary-transfer-epoch-isolation',true);
  state.epochWindow=await read('TreasuryDistributorV1',distributor,'epochWindow',[m.id,1]);
  state.balances=Object.fromEntries(await Promise.all(Object.entries(accounts).map(async([role,a])=>[role,formatEther(await c.getBalance({address:a.address}))])));
  if(state.error){state.priorHarnessError=state.error;delete state.error;}
  state.status='PUBLIC_IMMEDIATE_SCENARIOS_PASSED_TIME_GATED_SCENARIOS_PENDING';state.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({status:state.status,transactions:state.transactions.length,checks:state.checks.length}));
}catch(error){state.status='STOPPED_REQUIRES_RECONCILIATION';state.error=error.shortMessage??error.message;save();console.error(state.error);process.exitCode=1;}
