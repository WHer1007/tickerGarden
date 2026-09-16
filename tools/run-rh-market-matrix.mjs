import fs from 'node:fs';
import {readProjectEnv} from './environment.mjs';
import {createPublicClient,createWalletClient,defineChain,http,parseEther,formatEther,formatUnits,erc20Abi,encodeFunctionData,keccak256,toBytes,decodeEventLog,decodeErrorResult,parseAbi,encodeAbiParameters,parseAbiParameters} from '../apps/web/node_modules/viem/_esm/index.js';
import {generatePrivateKey,privateKeyToAccount} from '../apps/web/node_modules/viem/_esm/accounts/index.js';
const run=process.env.TG_RH_MATRIX_RUN;if(!run||!/^[a-z0-9-]+$/.test(run))throw Error('Explicit isolated matrix run required');
const e=readProjectEnv('test'),out='outputs/reviews/'+run,file=out+'/results.json',cap=out+'/capability.json',z='0x'+'0'.repeat(40),z32='0x'+'0'.repeat(64),rpc='http://127.0.0.1:18570';
fs.mkdirSync(out,{recursive:true});
const bootstrapFile=process.env.TG_RH_MATRIX_BOOTSTRAP||e.TG_DEPLOYMENT_BOOTSTRAP_FILE;if(!bootstrapFile)throw Error('Server-side matrix bootstrap required');
const b=JSON.parse(fs.readFileSync(bootstrapFile));
const secret=p=>{const s=fs.lstatSync(p);if(s.isSymbolicLink()||(s.mode&0o077))throw Error('Unsafe secret permissions');return JSON.parse(fs.readFileSync(p));};
const keypath='/Users/dear/.config/tickergarden/testnet-wallets/'+run+'.json';
if(!fs.existsSync(keypath))fs.writeFileSync(keypath,JSON.stringify({chainId:46630,roles:Object.fromEntries(['alice','bob','carol','dave'].map(k=>[k,{privateKey:generatePrivateKey()}]))}),{flag:'wx',mode:0o600});
const keys=secret(keypath);if(keys.chainId!==46630)throw Error('Wrong signer network');
const accounts={main:privateKeyToAccount(secret('/Users/dear/.config/tickergarden/testnet-wallets/arbitrum-sepolia.json').privateKey),...Object.fromEntries(Object.entries(keys.roles).map(([k,v])=>[k,privateKeyToAccount(v.privateKey)]))};
if(accounts.main.address.toLowerCase()!=='0xa6c3298a5559544c3b4cf8e6dc5f349f4be524ea')throw Error('Wrong main');
const chain=defineChain({id:46630,name:'Robinhood Testnet',nativeCurrency:{name:'ETH',symbol:'ETH',decimals:18},rpcUrls:{default:{http:[rpc]}}});
const c=createPublicClient({chain,pollingInterval:2500,transport:http(rpc,{timeout:25000,retryCount:0})});
const clients=Object.fromEntries(Object.entries(accounts).map(([k,account])=>[k,createWalletClient({account,chain,transport:http(rpc,{retryCount:0})})]));
const state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{chainId:46630,releaseId:b.releaseId,runId:run,status:'PREPARING',transactions:[],markets:[],checks:[],wallets:Object.fromEntries(Object.entries(accounts).map(([k,a])=>[k,a.address]))};
if(state.releaseId!==b.releaseId||state.chainId!==46630)throw Error('Release drift');
const json=(_k,v)=>typeof v==='bigint'?String(v):v;
const save=()=>{fs.writeFileSync(file+'.tmp',JSON.stringify(state,json,2));fs.renameSync(file+'.tmp',file);};
function capability(){const payload={chainId:46630,scope:'AUTHORIZED_TESTNET_SCENARIOS',expiresAt:Math.floor(Date.now()/1000)+12*3600,senders:Object.values(accounts).map(a=>a.address.toLowerCase()),transactions:state.transactions.map(t=>({hash:t.hash,from:t.from.toLowerCase()}))};fs.writeFileSync(cap+'.tmp',JSON.stringify(payload),{mode:0o600});fs.renameSync(cap+'.tmp',cap);}
const abi=n=>JSON.parse(fs.readFileSync(`contracts/out-v1/${n}.sol/${n}.json`)).abi;
const read=(n,address,fn,args=[])=>c.readContract({abi:abi(n),address,functionName:fn,args});
const balance=(token,owner)=>c.readContract({abi:erc20Abi,address:token,functionName:'balanceOf',args:[owner]});
async function tx(id,role,to,data='0x',value=0n){
 let row=state.transactions.find(t=>t.id===id);if(row){if(row.to.toLowerCase()!==to.toLowerCase()||row.role!==role||row.inputHash!==keccak256(data)||BigInt(row.value)!==value)throw Error('Intent changed '+id);}
 if(!row){const account=accounts[role];const fees=await c.estimateFeesPerGas();const gas=data==='0x'?100000n:(await c.estimateGas({account,to,data,value}))*13n/10n;
 if(gas*fees.maxFeePerGas>parseEther('0.01')||value>parseEther('1'))throw Error('Per transaction budget');
 const spent=state.transactions.filter(t=>t.role==='main').reduce((a,t)=>a+BigInt(t.value)+BigInt(t.feeWei??0),0n);if(role==='main'&&spent+value>parseEther('2.5'))throw Error('Main funding budget 2.5 ETH');
 const nonce=await c.getTransactionCount({address:account.address,blockTag:'pending'});const signed=await clients[role].signTransaction(await clients[role].prepareTransactionRequest({account,chain,to,data,value,gas,...fees,nonce}));
 row={id,role,from:account.address,to,value:String(value),inputHash:keccak256(data),nonce,hash:keccak256(signed),status:'SIGNED'};state.transactions.push(row);save();capability();
 // Persist signed bytes only in the protected wallet directory for exact recovery.
 fs.writeFileSync(keypath+'.'+nonce+'.'+role+'.tx',signed,{mode:0o600,flag:'wx'});
 await c.sendRawTransaction({serializedTransaction:signed});row.status='SUBMITTED';save();
 }
 if(row.status==='SIGNED'){const signed=fs.readFileSync(keypath+'.'+row.nonce+'.'+role+'.tx','utf8');try{await c.sendRawTransaction({serializedTransaction:signed});}catch{} }
 const receipt=await c.waitForTransactionReceipt({hash:row.hash,confirmations:2,timeout:150000});row.status=receipt.status;row.blockNumber=String(receipt.blockNumber);row.blockHash=receipt.blockHash;row.feeWei=String(receipt.gasUsed*receipt.effectiveGasPrice);row.logs=receipt.logs;save();if(receipt.status!=='success')throw Error('Reverted '+id);console.log(JSON.stringify({id,hash:row.hash,status:row.status}));return receipt;
}
const call=(id,role,name,address,fn,args=[],value=0n)=>tx(id,role,address,encodeFunctionData({abi:abi(name),functionName:fn,args}),value);
const tokenCall=(id,role,token,fn,args)=>tx(id,role,token,encodeFunctionData({abi:erc20Abi,functionName:fn,args}));
const roles=['alice','bob','carol','dave'];
async function prepare(){
 if(await c.getChainId()!==46630)throw Error('Wrong chain');
 state.before={mainETH:formatEther(await c.getBalance({address:accounts.main.address})),stocks:{}};
 for(const a of b.assets)state.before.stocks[a.values.tokenSymbol]=formatUnits(await balance(a.values.stockToken,accounts.main.address),18);
 state.startBlock??=String((await c.getBlock()).number);save();capability();console.log(JSON.stringify({before:state.before,wallets:state.wallets,release:b.releaseId,startBlock:state.startBlock}));
}
async function launch(){
 for(const [i,role]of roles.entries())await tx('fund-'+role,'main',accounts[role].address,'0x',parseEther(i<3?'0.62':'0.12'));
 const fee=await read('TickerGardenFactoryV1',b.factory,'launchFee');
 for(let i=0;i<12;i++){
  const role=roles[i%4],quote=b.configs.filter(c=>c.kind==='quote')[i<7?0:i-6],stock=b.assets[(i+1)%5],staking=i%3!==1,holders=i%2===0,tax=[0,25,100,250,500,125][i%6];
  let m=state.markets.find(m=>m.index===i);
  if(!m){const params={assetUid:staking?stock.id:z32,tickerGardenBaselineId:b.configs.find(c=>c.kind==='baseline').id,quoteAssetConfigId:quote.id,launchTemplateId:b.configs.find(c=>c.kind==='template').id,expectedEconomics:z32,creatorRevenueBeneficiary:accounts[role].address,name:`Garden QA ${String(i+1).padStart(2,'0')} ${quote.values.symbol??'ETH'}`,symbol:`GQA${String(i+1).padStart(2,'0')}`,metadataURI:'data:application/json,'+encodeURIComponent(JSON.stringify({name:`Garden QA ${i+1}`,description:'Authorized multiwallet testnet lifecycle QA. Not an investment.',testOnly:true})),salt:keccak256(toBytes(state.runId+':'+i)),creatorTaxBps:tax,creatorFeesToHolders:holders,stakingEnabled:staking};
  params.expectedEconomics=await c.readContract({account:accounts[role].address,address:b.factory,abi:abi('TickerGardenFactoryV1'),functionName:'previewMarketEconomics',args:[params]});
  m={index:i,role,params,quote:quote.values.quoteAsset,quoteSymbol:quote.values.symbol??'ETH',threshold:quote.values.graduationThreshold};state.markets.push(m);save();}
  if(!m.id){const receipt=await call('launch-'+i,role,'TickerGardenFactoryV1',b.factory,'createMarket',[m.params],fee);const event=receipt.logs.map(l=>{try{return decodeEventLog({abi:abi('TickerGardenFactoryV1'),data:l.data,topics:l.topics});}catch{return null;}}).find(l=>l?.eventName==='MarketCreated');if(!event)throw Error('Missing creation event');Object.assign(m,{id:event.args.marketId,token:event.args.memeToken,curve:event.args.curve,gauge:event.args.gauge,createdBlock:String(receipt.blockNumber)});save();}
 }
 state.status='MARKETS_CREATED';save();
}
async function trades(){
 if(state.markets.length!==12||state.markets.some(m=>!m.id))throw Error('Create all markets first');
 for(const m of state.markets){
  const role=roles[m.index%4],other=roles[(m.index+1)%4];
  if(m.quote!==z){for(const trader of [role,other])await tokenCall(`stock-fund-${m.index}-${trader}`,'main',m.quote,'transfer',[accounts[trader].address,parseEther('0.15')]);for(const trader of [role,other])await tokenCall(`stock-approve-${m.index}-${trader}`,trader,m.quote,'approve',[m.curve,parseEther('0.15')]);}
  for(let j=0;j<3;j++){const trader=j===1?other:role;const amount=parseEther(m.quote===z?['0.0021','0.0037','0.0013'][(m.index+j)%3]:['0.021','0.037','0.013'][(m.index+j)%3]);await call(`buy-${m.index}-${j}`,trader,'TickerGardenCurve',m.curve,'buy',[amount,0n,accounts[trader].address],m.quote===z?amount:0n);}
  m.sellAmount??=String((await balance(m.token,accounts[role].address))/5n);save();
  await tokenCall(`sell-approve-${m.index}`,role,m.token,'approve',[m.curve,BigInt(m.sellAmount)]);
  await call(`sell-${m.index}`,role,'TickerGardenCurve',m.curve,'sell',[BigInt(m.sellAmount),0n,accounts[role].address]);
  await call(`sweep-${m.index}`,role,'TickerGardenCurve',m.curve,'sweepCurveFees');
 }
 state.status='CURVE_TRADES_CONFIRMED';save();
}
async function graduate(){
 for(const m of state.markets.slice(0,3)){
 const role=roles[m.index];await call(`graduate-${m.index}`,role,'TickerGardenCurve',m.curve,'buy',[parseEther('0.5'),0n,accounts[role].address],parseEther('0.5'));
 const result=await read('MarketRegistryV1',b.bindings.marketRegistry,'market',[m.id]);if(Number(result.runtime.launchPhase)!==1)throw Error('Graduation phase mismatch');m.graduated=true;m.poolKey=await read('MarketRegistryV1',b.bindings.marketRegistry,'canonicalPoolKey',[m.id]);save();
 }
 state.status='THREE_MARKETS_BLOOMED';save();
}
async function poolBuy(m,role,id,amount){
 const key=m.poolKey,input=m.quote,direction=key.currency0.toLowerCase()===input;
 const swap=encodeAbiParameters(parseAbiParameters('((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData)'),[{poolKey:key,zeroForOne:direction,amountIn:amount,amountOutMinimum:0n,minHopPriceX36:0n,hookData:'0x'}]);
 const settle=encodeAbiParameters(parseAbiParameters('address,uint256'),[input,amount]),take=encodeAbiParameters(parseAbiParameters('address,uint256'),[m.token,0n]);
 const commands=encodeAbiParameters(parseAbiParameters('bytes,bytes[]'),['0x060c0f',[swap,settle,take]]),sweep=encodeAbiParameters(parseAbiParameters('address,address,uint256'),[z,'0x0000000000000000000000000000000000000001',0n]);
 state.deadlines??={};state.deadlines[id]??=String((await c.getBlock()).timestamp+600n);save();
 return tx(id,role,'0x8876789976decbfcbbbe364623c63652db8c0904',encodeFunctionData({abi:parseAbi(['function execute(bytes commands,bytes[] inputs,uint256 deadline) payable']),functionName:'execute',args:['0x1004',[commands,sweep],BigInt(state.deadlines[id])]}),amount);
}
async function staking(){
 for(const m of state.markets.slice(0,3)){
 if(!m.graduated)throw Error('Graduate first');
 await poolBuy(m,'dave',`pool-zero-stake-${m.index}`,parseEther('0.001'));
 if(m.params.stakingEnabled){
  const stock=b.assets.find(a=>a.id===m.params.assetUid),vault=stock.values.userStockVault;
  for(const role of ['bob','dave']){
   await tokenCall(`stake-fund-${m.index}-${role}`,'main',stock.values.stockToken,'transfer',[accounts[role].address,parseEther('1')]);
   await tokenCall(`stake-approve-${m.index}-${role}`,role,stock.values.stockToken,'approve',[vault,parseEther('1')]);
   await call(`stake-${m.index}-${role}`,role,'AllocationManager',b.bindings.allocationManager,'stake',[m.id,parseEther('1')]);
  }
  const pos=await read('MemeStockGauge',m.gauge,'positionOf',[accounts.dave.address]);m.stakePosition=pos;save();
 }
 }
 state.status='STAKE_SUBMITTED';save();
}
async function rewards(){
 const feeVault=b.bindings.protocolFeeVault;
 state.checks??=[];const check=(id,ok,details)=>{if(!ok)throw Error(id);state.checks=state.checks.filter(x=>x.id!==id);state.checks.push({id,status:'PASS',details});save();};
 for(const m of state.markets.slice(0,3)){
  if(m.params.stakingEnabled){await call(`activation-${m.index}`,'dave','MemeStockGauge',m.gauge,'checkpointActivations');const active=await read('MemeStockGauge',m.gauge,'effectiveTotalActiveStock');check(`active-stake-${m.index}`,active===parseEther('2'),String(active));}
  await poolBuy(m,'dave',`pool-active-buy-${m.index}`,parseEther('0.0017'));
 }
 check('current-claim-mode',await read('ProtocolFeeVault',feeVault,'userClaimMode')===keccak256(toBytes('TICKERGARDEN_USER_CLAIM_ASSET_SELECTION_V1')),'asset selection V1');
 for(const m of state.markets){
 m.creatorQuoteBefore??=String(await read('ProtocolFeeVault',feeVault,'creatorLiability',[m.id,1,m.quote]));
 m.creatorMemeBefore??=String(await read('ProtocolFeeVault',feeVault,'creatorLiability',[m.id,1,m.token]));save();
  const creatorMemeClaimId=`claim-creator-meme-${m.index}`;
  const creatorMemeAlreadyClaimed=state.transactions.some(t=>t.id===creatorMemeClaimId&&t.status==='success');
  const receipt=await call(`claim-creator-quote-${m.index}`,m.role,'ProtocolFeeVault',feeVault,'claimUserRewardAssets',[m.id,0,1,1,false,false,0n]);
  const claimed=receipt.logs.map(l=>{try{return decodeEventLog({abi:abi('ProtocolFeeVault'),data:l.data,topics:l.topics})}catch{return null}}).find(l=>l?.eventName==='UserRewardsClaimed');
  check(`creator-payment-${m.index}`,claimed?.args.user.toLowerCase()===accounts[m.role].address.toLowerCase()&&claimed.args.quotePaid===BigInt(m.creatorQuoteBefore)&&claimed.args.memePaid===0n,{quotePaid:String(claimed?.args.quotePaid??0n)});
  check(`creator-cleared-${m.index}`,await read('ProtocolFeeVault',feeVault,'creatorLiability',[m.id,1,m.quote])===0n,'zero remaining selected Quote');
  if(!creatorMemeAlreadyClaimed)check(`creator-meme-preserved-${m.index}`,await read('ProtocolFeeVault',feeVault,'creatorLiability',[m.id,1,m.token])===BigInt(m.creatorMemeBefore),'unselected Meme preserved');
  if(BigInt(m.creatorMemeBefore)>0n){
   const id=creatorMemeClaimId,convert=m.index%2===1;
   state.deadlines??={};if(!state.transactions.some(t=>t.id===id))state.deadlines[id]=String((await c.getBlock()).timestamp+240n);save();
   const r=await call(id,m.role,'ProtocolFeeVault',feeVault,'claimUserRewardAssets',[m.id,0,1,2,convert,false,convert?BigInt(state.deadlines[id]):0n]);
   const evt=r.logs.map(l=>{try{return decodeEventLog({abi:abi('ProtocolFeeVault'),data:l.data,topics:l.topics})}catch{return null}}).find(l=>l?.eventName==='UserRewardsClaimed');
   check(`creator-meme-${m.index}`,!!evt&&!evt.args.conversionFailed&&evt.args.memeRetained===0n&&(convert?evt.args.memeConverted===BigInt(m.creatorMemeBefore)&&evt.args.quotePaid>0n:evt.args.memePaid===BigInt(m.creatorMemeBefore)),{convert,...evt?.args});
  }
  if(m.graduated&&m.params.stakingEnabled)for(const role of ['bob','dave']){const before=await read('MemeStockGauge',m.gauge,'positionOf',[accounts[role].address]);if(before.unlockAt>(await c.getBlock()).timestamp){state.deferred??=[];if(!state.deferred.some(x=>x.marketId===m.id&&x.role===role))state.deferred.push({kind:'STAKER_CLAIM_AFTER_24H',marketId:m.id,role,unlockAt:String(before.unlockAt),quoteClaimable:String(before.quoteClaimable),memeClaimable:String(before.memeClaimable),expectedRevert:'PositionLockedUntil'});save();continue;}await call(`claim-staker-${m.index}-${role}`,role,'ProtocolFeeVault',feeVault,'claimUserRewardAssets',[m.id,1,0,3,false,false,0n]);}
  if(m.params.creatorFeesToHolders){
   const q=await read('ProtocolFeeVault',feeVault,'holderLiability',[m.id,1,m.quote]);
   if(q>0n||state.transactions.some(t=>t.id===`fund-holder-${m.index}`))await call(`fund-holder-${m.index}`,'dave','ProtocolFeeVault',feeVault,'fundHolderRewards',[m.id,1]);
   const mm=await read('ProtocolFeeVault',feeVault,'holderLiability',[m.id,1,m.token]);
   if(mm>0n||state.transactions.some(t=>t.id===`fund-holder-meme-${m.index}`))await call(`fund-holder-meme-${m.index}`,'dave','ProtocolFeeVault',feeVault,'fundHolderMemeRewards',[m.id]);
   m.distributor=await read('TickerMemeTokenV1',m.token,'holderRewardsDistributor');
   await call(`claim-holder-${m.index}`,m.role,'ProtocolFeeVault',feeVault,'claimUserRewardAssets',[m.id,2,0,3,false,false,0n]);
   m.holderState=await read('HolderRewardsDistributorV1',m.distributor,'marketState',[m.id]);m.holderMemeState=await read('HolderRewardsDistributorV1',m.distributor,'memeMarketState',[m.id]);save();
   check(`holder-conservation-${m.index}`,m.holderState.paid<=m.holderState.funded&&m.holderMemeState.paid<=m.holderMemeState.funded,{quote:m.holderState,meme:m.holderMemeState});
  }
 }
 state.status='REWARDS_CHECKED';delete state.error;save();
}
async function poolSells(){
 for(const m of state.markets.slice(0,3)){
  const role='alice';m.poolSellAmount??=String((await balance(m.token,accounts.dave.address))/10n);save();const amount=BigInt(m.poolSellAmount),permit='0x000000000022d473030f116ddee9f6b43ac78ba3',router='0x8876789976decbfcbbbe364623c63652db8c0904';
  await tokenCall(`permit-token-${m.index}`,'dave',m.token,'approve',[permit,amount]);
  state.deadlines??={};const id=`pool-sell-${m.index}`;if(!state.transactions.some(t=>t.id===id))state.deadlines[id]=String((await c.getBlock()).timestamp+600n);save();
  await tx(`permit-router-${m.index}`,'dave',permit,encodeFunctionData({abi:parseAbi(['function approve(address token,address spender,uint160 amount,uint48 expiration)']),functionName:'approve',args:[m.token,router,amount,Number(state.deadlines[id])]}));
  const swap=encodeAbiParameters(parseAbiParameters('((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData)'),[{poolKey:m.poolKey,zeroForOne:m.poolKey.currency0.toLowerCase()===m.token.toLowerCase(),amountIn:amount,amountOutMinimum:0n,minHopPriceX36:0n,hookData:'0x'}]);
  const settle=encodeAbiParameters(parseAbiParameters('address,uint256'),[m.token,amount]),take=encodeAbiParameters(parseAbiParameters('address,uint256'),[m.quote,0n]);
  const commands=encodeAbiParameters(parseAbiParameters('bytes,bytes[]'),['0x060c0f',[swap,settle,take]]);
  await tx(id,'dave',router,encodeFunctionData({abi:parseAbi(['function execute(bytes commands,bytes[] inputs,uint256 deadline) payable']),functionName:'execute',args:['0x10',[commands],BigInt(state.deadlines[id])]}));

 }
 state.status='POOL_SELLS_VERIFIED';save();
}
async function exits(){
 const manager=b.bindings.allocationManager;
 const exitCheck=(id,ok,details)=>{if(!ok)throw Error(id);state.checks=state.checks.filter(x=>x.id!==id);state.checks.push({id,status:'PASS',details});save();};
 for(const m of state.markets.slice(0,3).filter(m=>m.params.stakingEnabled)){
  const stock=b.assets.find(a=>a.id===m.params.assetUid);if(!stock)throw Error('Missing market Stock asset');
  for(const role of ['bob','dave']){
   const action=role==='bob'?'unstakeAndWithdraw':'rageQuit',id=`${action}-${m.index}-${role}`;
   state.exitSnapshots??={};
   if(!state.exitSnapshots[id]){
    const principal=await read('UserStockVault',stock.values.userStockVault,'allocation',[stock.id,accounts[role].address,m.id]);
    const stockBefore=await balance(stock.values.stockToken,accounts[role].address);
    if(principal===0n)throw Error('Missing exit principal '+id);
    state.exitSnapshots[id]={principal:String(principal),stockBefore:String(stockBefore)};save();
   }
   const before=state.exitSnapshots[id];
   await call(id,role,'AllocationManager',manager,action,[m.id]);
   const principalAfter=await read('UserStockVault',stock.values.userStockVault,'allocation',[stock.id,accounts[role].address,m.id]);
   const stockAfter=await balance(stock.values.stockToken,accounts[role].address);
   if(action==='rageQuit'){
    const settlementAlreadyConfirmed=state.transactions.some(t=>t.id===`settle-rage-${m.index}-${role}`&&t.status==='success');
    if(!settlementAlreadyConfirmed){const pending=await read('AllocationManager',manager,'rageQuitSettlementPending',[m.id,accounts[role].address]);
    exitCheck(`rage-principal-${m.index}-${role}`,principalAfter===0n&&stockAfter===BigInt(before.stockBefore)+BigInt(before.principal)&&pending[0]&&pending[1]===BigInt(before.principal),{action,principal:before.principal,stockAfter:String(stockAfter),settlementPending:true});}
    await call(`settle-rage-${m.index}-${role}`,role,'AllocationManager',manager,'settleRageQuitRewards',[m.id,accounts[role].address]);
   }
   const position=await read('MemeStockGauge',m.gauge,'positionOf',[accounts[role].address]);
   const pendingAfter=action==='rageQuit'?await read('AllocationManager',manager,'rageQuitSettlementPending',[m.id,accounts[role].address]):[false,0n];
   exitCheck(`exit-${m.index}-${role}`,principalAfter===0n&&stockAfter===BigInt(before.stockBefore)+BigInt(before.principal)&&position.activeAmount===0n&&position.pendingAmount===0n&&!pendingAfter[0],{action,principal:before.principal,stockAfter:String(stockAfter),settlementPending:false});
   state.deferred=(state.deferred??[]).filter(item=>item.marketId!==m.id||item.role!==role);save();
  }
 }
 state.status='STAKE_EXITS_VERIFIED';delete state.error;save();
}
async function negative(){
 const tests=[['buy-zero','alice','TickerGardenCurve',state.markets[3].curve,'buy',[0n,0n,accounts.alice.address],0n],['graduated-curve-buy','alice','TickerGardenCurve',state.markets[0].curve,'buy',[parseEther('0.001'),0n,accounts.alice.address],parseEther('0.001')],['excess-creator-tax','alice','TickerGardenFactoryV1',b.factory,'previewMarketEconomics',[{...state.markets[0].params,creatorTaxBps:501}],0n],['invalid-asset-mask','dave','ProtocolFeeVault',b.bindings.protocolFeeVault,'claimUserRewardAssets',[state.markets[0].id,0,1,0,false,false,0n],0n],['unauthorized-creator','dave','ProtocolFeeVault',b.bindings.protocolFeeVault,'claimUserRewardAssets',[state.markets[0].id,0,1,1,false,false,0n],0n]];
 for(const m of state.markets.slice(0,3).filter(m=>m.params.stakingEnabled))for(const role of ['bob','dave'])tests.push([`locked-claim-${m.index}-${role}`,role,'ProtocolFeeVault',b.bindings.protocolFeeVault,'claimUserRewardAssets',[m.id,1,0,1,false,false,0n],0n]);
 for(const [id,role,name,address,functionName,args,value]of tests){let decoded;try{await c.simulateContract({account:accounts[role].address,address,abi:abi(name),functionName,args,value});}catch(error){for(let cause=error;cause;cause=cause.cause){if(cause.data?.errorName)decoded=cause.data.errorName;if(typeof cause.data==='string'){try{decoded=decodeErrorResult({abi:[...abi('ProtocolFeeVault'),...abi('MemeStockGauge'),...abi('AllocationManager'),...abi('TickerGardenCurve'),...abi('TickerGardenFactoryV1')],data:cause.data}).errorName}catch{}}}}
 if(!decoded)throw Error('No decoded EVM rejection: '+id);state.checks=state.checks.filter(x=>x.id!==id);state.checks.push({id,status:'PASS',type:'ETH_CALL_REVERT',error:decoded});save();console.log(JSON.stringify({id,revert:decoded}));}
 state.status='IMMEDIATE_CASES_VERIFIED_TIME_LOCKS_PENDING';save();
}
try{const mode=process.argv[2]??'prepare';if(mode!=='prepare')capability();if(mode==='prepare')await prepare();else if(mode==='launch')await launch();else if(mode==='trades')await trades();else if(mode==='graduate')await graduate();else if(mode==='staking')await staking();else if(mode==='rewards')await rewards();else if(mode==='pool-sells')await poolSells();else if(mode==='exits')await exits();else if(mode==='negative')await negative();else throw Error('Unknown mode');}catch(error){state.status='INCOMPLETE';state.error=String(error.shortMessage??error.message).slice(0,600);state.errorDetails=[];for(let cause=error;cause;cause=cause.cause){if(cause.data?.errorName)state.errorDetails.push(cause.data);if(typeof cause.data==='string'&&cause.data.startsWith('0x')){try{state.errorDetails.push(decodeErrorResult({abi:[...abi('ProtocolFeeVault'),...abi('MemeStockGauge'),...abi('AllocationManager'),...abi('HolderRewardsDistributorV1')],data:cause.data}));}catch{state.errorDetails.push({data:cause.data})}}}save();console.error(state.error);process.exitCode=1;}
