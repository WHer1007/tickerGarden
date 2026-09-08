import {readProjectEnv} from "./environment.mjs";
import fs from 'node:fs';
import path from 'node:path';
import {createPublicClient,createWalletClient,defineChain,http,parseAbi,erc20Abi,encodeFunctionData,keccak256,toBytes,parseEther,decodeEventLog} from '../apps/web/node_modules/viem/_esm/index.js';
import {privateKeyToAccount,generatePrivateKey} from '../apps/web/node_modules/viem/_esm/accounts/index.js';
const releaseId=process.env.TG_RH_RELEASE_ID;
if(!/^0x[0-9a-f]{64}$/.test(releaseId??''))throw Error('Specify reviewed TG_RH_RELEASE_ID');
const dir=`deployments/releases/${releaseId}`;
const read=p=>JSON.parse(fs.readFileSync(p));
const deployed=read(`${dir}/robinhood-testnet-46630.v1.deployed.json`), paired=read(`${dir}/paired-assets.json`);
const artifact=n=>read(`contracts/out-v1/${n}.sol/${n}.json`);
const component=n=>deployed.contracts.find(x=>x.name===n).address;
const router=component('LaunchAndBuyRouter'), factory=deployed.factory, manager='0x8366a39cc670b4001a1121b8f6a443a643e40951',quoter='0x8dc178efb8111bb0973dd9d722ebeff267c98f94';
const env=readProjectEnv();
const rpc=`https://robinhood-testnet.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`;
const chain=defineChain({id:46630,name:'Robinhood Testnet',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:{default:{http:[rpc]}}});
const client=createPublicClient({chain,transport:http(rpc,{timeout:20000,retryCount:1})});
const ensure=(ok,msg)=>{if(!ok)throw Error(msg)};
const json=(_k,v)=>typeof v==='bigint'?String(v):v;
const reportPath=`${dir}/atomic-buy-public-test.json`;
const state=fs.existsSync(reportPath)?read(reportPath):{schemaVersion:1,chainId:46630,releaseId,status:'RUNNING',transactions:[],cases:[]};
const save=()=>{fs.writeFileSync(reportPath+'.tmp',JSON.stringify(state,json,2)+'\n');fs.renameSync(reportPath+'.tmp',reportPath)};
const loadKey=file=>{const stat=fs.lstatSync(file);ensure(!stat.isSymbolicLink()&&(stat.mode&0o077)===0,'Unsafe wallet file permissions');return read(file)};
const deployer=privateKeyToAccount(loadKey('/Users/dear/.config/tickergarden/testnet-wallets/arbitrum-sepolia.json').privateKey);
const keyPath=`/Users/dear/.config/tickergarden/testnet-wallets/rh-atomic-${releaseId.slice(2,14)}.json`;
if(!fs.existsSync(keyPath)){fs.mkdirSync(path.dirname(keyPath),{recursive:true,mode:0o700});fs.writeFileSync(keyPath,JSON.stringify({privateKey:generatePrivateKey()}),{mode:0o600,flag:'wx'})}
const actor=privateKeyToAccount(loadKey(keyPath).privateKey);
const z='0x'+'0'.repeat(40),z32='0x'+'0'.repeat(64);
const lockPath=`${dir}/atomic-buy-test.lock`;
const lock=fs.openSync(lockPath,'wx',0o600);
const tokenBalance=(token,owner)=>client.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[owner]});
async function tx(id,account,to,data='0x',value=0n,expected='success'){
 let row=state.transactions.find(x=>x.id===id);
 if(!row){
  const fees=await client.estimateFeesPerGas();const gas=data==='0x'?100000n:16000000n;
  const reserved=state.transactions.reduce((s,x)=>s+BigInt(x.maxCostWei),0n);
  ensure(reserved+gas*fees.maxFeePerGas+value<=parseEther('0.03'),'Test spend cap exceeded');
  const nonce=await client.getTransactionCount({address:account.address,blockTag:'pending'});
  const signer=createWalletClient({account,chain,transport:http(rpc)});
  const signed=await signer.signTransaction(await signer.prepareTransactionRequest({account,chain,to,data,value,gas,nonce,...fees}));
  row={id,hash:keccak256(signed),from:account.address,to,nonce,value:String(value),inputHash:keccak256(data),maxCostWei:String(value+gas*fees.maxFeePerGas),status:'SIGNED_INTENT'};state.transactions.push(row);save();
  await client.sendRawTransaction({serializedTransaction:signed});row.status='SUBMITTED';save();
 }
 const receipt=await client.waitForTransactionReceipt({hash:row.hash,confirmations:2,timeout:60000});
 const [block,actual]=await Promise.all([client.getBlock({blockNumber:receipt.blockNumber}),client.getTransaction({hash:row.hash})]);
 ensure(block.hash===receipt.blockHash&&actual.from.toLowerCase()===row.from.toLowerCase()&&actual.to.toLowerCase()===row.to.toLowerCase()&&actual.nonce===row.nonce&&keccak256(actual.input)===row.inputHash&&actual.value===BigInt(row.value),'Transaction identity mismatch');
 Object.assign(row,{status:receipt.status,blockNumber:receipt.blockNumber,blockHash:receipt.blockHash,gasUsed:receipt.gasUsed,feeWei:receipt.gasUsed*receipt.effectiveGasPrice});save();
 ensure(receipt.status===expected,`Unexpected receipt status for ${id}`);console.log(JSON.stringify({id,hash:row.hash,status:row.status}));return receipt;
}
const routerAbi=artifact('LaunchAndBuyRouter').abi, factoryAbi=artifact('TickerGardenFactoryV1').abi;
const quoterAbi=parseAbi(['function quoteExactOutputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountIn,uint256 gasEstimate)']);
async function runCase(id,asset,{mode='fallback',fail,partial=false}={}){
 if(state.cases.some(x=>x.id===id&&x.status==='PASSED'))return;
 const amount=asset.symbol==='ETH'?parseEther('0.0001'):parseEther('0.001');
 let row=state.cases.find(x=>x.id===id);
 if(!row){
  const params={assetUid:z32,tickerGardenBaselineId:paired.baselineId,quoteAssetConfigId:asset.quoteAssetConfigId,launchTemplateId:paired.templateId,expectedEconomics:z32,creatorRevenueBeneficiary:actor.address,name:`TG atomic test ${id}`,symbol:'TGTEST',metadataURI:'data:application/json,%7B%22testOnly%22%3Atrue%7D',salt:keccak256(toBytes(`${releaseId}:${id}`)),creatorTaxBps:500,creatorFeesToHolders:true,stakingEnabled:false};
  params.expectedEconomics=await client.readContract({account:actor.address,address:factory,abi:factoryAbi,functionName:'previewMarketEconomics',args:[params]});
  const launchFee=await client.readContract({address:factory,abi:factoryAbi,functionName:'launchFee'});
  let max=0n,quoted=0n;
  if(mode==='fallback'){
   const q=await client.simulateContract({address:quoter,abi:quoterAbi,functionName:'quoteExactOutputSingle',args:[{poolKey:{currency0:z,currency1:asset.tokenAddress,fee:10000,tickSpacing:200,hooks:z},zeroForOne:true,exactAmount:amount,hookData:'0x'}]});quoted=q.result[0];max=(quoted*10100n+9999n)/10000n;
  }
  const value=launchFee+(mode==='fallback'?max:mode==='native'?amount:0n);
  const sim=await client.simulateContract({account:actor.address,address:router,abi:routerAbi,functionName:'launchAndBuy',args:[params,amount,1n,actor.address],value});
  const quoteBefore=asset.symbol==='ETH'?0n:await tokenBalance(asset.tokenAddress,actor.address);
  if(mode==='fallback')ensure(partial?quoteBefore>0n&&quoteBefore<amount:quoteBefore===0n,'Unexpected initial Quote balance');
  row={id,mode,asset:asset.symbol,params,amount,quoted,max,value,marketId:sim.result[0],token:sim.result[1],predictedTokens:sim.result[2],simulatedRefund:sim.result[3],quoteBefore,ethBefore:await client.getBalance({address:actor.address}),routerETHBefore:await client.getBalance({address:router}),routerQuoteBefore:asset.symbol==='ETH'?0n:await tokenBalance(asset.tokenAddress,router),status:'PREPARED'};state.cases.push(row);save();
 }
 const min=fail==='min-output'?2n**255n:BigInt(row.predictedTokens)*99n/100n;
 const value=fail==='max-eth'?BigInt(row.value)-BigInt(row.max)+1n:BigInt(row.value);
 const data=encodeFunctionData({abi:routerAbi,functionName:'launchAndBuy',args:[row.params,BigInt(row.amount),min,actor.address]});
 const receipt=await tx(row.txId??id,actor,router,data,value,fail?'reverted':'success');
 const quoteAfter=asset.symbol==='ETH'?0n:await tokenBalance(asset.tokenAddress,actor.address);
 ensure(await client.getBalance({address:router})===BigInt(row.routerETHBefore),'Router retained unexpected ETH');
 if(asset.symbol!=='ETH')ensure(await tokenBalance(asset.tokenAddress,router)===BigInt(row.routerQuoteBefore),'Router retained unexpected Quote');
 if(fail){ensure(!(await client.getCode({address:row.token})),'Reverted launch created token');ensure(quoteAfter===BigInt(row.quoteBefore),'Reverted launch changed Quote');}
 else {
   const created=receipt.logs.filter(x=>x.address.toLowerCase()===factory.toLowerCase()).map(x=>{try{return decodeEventLog({abi:factoryAbi,data:x.data,topics:x.topics})}catch{return null}}).find(x=>x?.eventName==='MarketCreated');
   ensure(Boolean(created),'Missing Factory MarketCreated event');
   if(mode==='fallback')ensure(receipt.logs.some(x=>x.address.toLowerCase()===manager&&x.topics[0]===keccak256(toBytes('Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)'))),'Missing v4 swap event');
   row.events=receipt.logs.map(x=>({address:x.address,topics:x.topics,data:x.data}));
   const received=await tokenBalance(row.token,actor.address);ensure(received>=min,'Meme output below minimum');row.received=received;if(mode==='fallback')ensure(quoteAfter===BigInt(row.quoteBefore),'Fallback consumed existing wallet Quote');
   if(mode==='quote')ensure(quoteAfter===BigInt(row.quoteBefore)-BigInt(row.amount),'Direct Quote amount mismatch');}
 row.quoteAfter=quoteAfter;row.ethAfter=await client.getBalance({address:actor.address});
 row.actualValueSpent=BigInt(row.ethBefore)-row.ethAfter-receipt.gasUsed*receipt.effectiveGasPrice;
 ensure(row.actualValueSpent>=0n&&row.actualValueSpent<=value,'ETH spend outside authorized value');
 if(fail)ensure(row.actualValueSpent===0n,'Reverted launch retained ETH');
 row.status='PASSED';row.txHash=receipt.transactionHash;save();
}
try {
 ensure(await client.getChainId()===46630&&deployed.chainId===46630&&paired.releaseId===releaseId,'Wrong release/chain');
 ensure(deployer.address.toLowerCase()===deployed.deployer.toLowerCase(),'Wrong deployer');
 ensure((await client.readContract({address:router,abi:routerAbi,functionName:'poolManager'})).toLowerCase()===manager,'Wrong PoolManager');
 state.actor=actor.address;save();
 await tx('fund-test-actor',deployer,actor.address,'0x',parseEther('0.012'));
 const stocks=paired.assets.filter(x=>x.assetKind==='OFFICIAL_STOCK');ensure(stocks.length===5,'Expected 5 official Stocks');
 for(const asset of stocks)await runCase(`zero-${asset.symbol}`,asset);
 const tsla=stocks.find(x=>x.symbol==='TSLA');
 await runCase('revert-max-eth',tsla,{fail:'max-eth'});
 await runCase('revert-min-output',tsla,{fail:'min-output'});
 await tx('fund-partial-quote',deployer,tsla.tokenAddress,encodeFunctionData({abi:erc20Abi,functionName:'transfer',args:[actor.address,parseEther('0.0001')]}));
 await runCase('partial-TSLA',tsla,{partial:true});
 await tx('fund-direct-quote',deployer,tsla.tokenAddress,encodeFunctionData({abi:erc20Abi,functionName:'transfer',args:[actor.address,parseEther('0.002')]}));
 await tx('approve-direct-quote',actor,tsla.tokenAddress,encodeFunctionData({abi:erc20Abi,functionName:'approve',args:[router,parseEther('0.001')]}));
 await runCase('direct-TSLA',tsla,{mode:'quote'});
 await runCase('native-ETH',paired.assets.find(x=>x.symbol==='ETH'),{mode:'native'});
 delete state.failure;delete state.revertDetails;
 state.status='PUBLIC_TESTNET_ATOMIC_BUY_PASSED';state.completedAt=new Date().toISOString();save();
 console.log(JSON.stringify({status:state.status,releaseId,cases:state.cases.length,actor:actor.address}));
}catch(error){state.status='INCOMPLETE';state.revertDetails=[];for(let e=error,i=0;e&&i<8;e=e.cause,i++){if(e.data?.errorName)state.revertDetails.push({name:e.data.errorName,args:e.data.args});if(typeof e.data==='string'&&/^0x[0-9a-f]*$/i.test(e.data))state.revertDetails.push({data:e.data});if(typeof e.signature==='string')state.revertDetails.push({signature:e.signature});}state.failure=String(error.shortMessage??error.message).split(rpc).join('[RPC]').slice(0,600);save();console.error(state.failure);process.exitCode=1}
finally{fs.closeSync(lock);fs.unlinkSync(lockPath)}
