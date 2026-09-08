import fs from 'node:fs';
import {createPublicClient,createWalletClient,http,encodeFunctionData,encodeDeployData,encodeAbiParameters,keccak256,toBytes,getContractAddress,decodeErrorResult} from '../apps/web/node_modules/viem/_esm/index.js';
import {privateKeyToAccount} from '../apps/web/node_modules/viem/_esm/accounts/index.js';
import {arbitrumSepolia} from '../apps/web/node_modules/viem/_esm/chains/index.js';
const broadcast=process.argv[2]==='broadcast';
const p=JSON.parse(fs.readFileSync('deployments/manifests/arbitrum-sepolia-421614.v1.deployed.json'));
if(!p.contracts?.some(x=>x.name==='TickerGardenBaselineRegistry')) throw Error('Brand-renamed ABI requires a newly verified release. Existing R2 uses the historical ABI; do not activate it with this checkout.');
const treasury=JSON.parse(fs.readFileSync('deployments/manifests/arbitrum-sepolia-421614.test-treasury.json'));
const walletPath='/Users/dear/.config/tickergarden/testnet-wallets/arbitrum-sepolia.json';
const st=fs.lstatSync(walletPath);if(st.isSymbolicLink()||(st.mode&0o077)!==0)throw Error('Unsafe wallet permissions');
const wallet=JSON.parse(fs.readFileSync(walletPath));const account=privateKeyToAccount(wallet.privateKey);
if(wallet.chainId!==421614||p.chainId!==421614||account.address.toLowerCase()!==p.deployer.toLowerCase())throw Error('Account/chain mismatch');
const c=createPublicClient({chain:arbitrumSepolia,transport:http('https://sepolia-rollup.arbitrum.io/rpc')});
const signer=createWalletClient({account,chain:arbitrumSepolia,transport:http('https://sepolia-rollup.arbitrum.io/rpc')});
if(await c.getChainId()!==421614)throw Error('Wrong chain');
const artifact=n=>JSON.parse(fs.readFileSync(`contracts/out-v1/${n}.sol/${n}.json`));
const read=(name,address,functionName,args=[])=>c.readContract({account:account.address,address,abi:artifact(name).abi,functionName,args});
if(!await read('V1ArbitrumDeploymentOrchestrator',p.orchestrator,'completed'))throw Error('Incomplete graph');
if(await read('V1ArbitrumDeploymentOrchestrator',p.orchestrator,'deploymentPayloadHash')!==p.payloadHash)throw Error('Payload mismatch');
if((await read('ProtocolFeeVault',p.ordinaryComponents[15],'platformTreasury')).toLowerCase()!==treasury.address.toLowerCase())throw Error('Treasury binding mismatch');
if(keccak256(await c.getCode({address:treasury.address}))!==treasury.runtimeCodeHash)throw Error('Treasury code drift');
const dir='deployments/releases/'+p.releaseId;fs.mkdirSync(dir,{recursive:true});
const file=dir+'/activation.json';const state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{chainId:421614,releaseId:p.releaseId,status:'PLANNED',transactions:[]};
const save=()=>fs.writeFileSync(file,JSON.stringify(state,null,2)+'\n');
async function send(id,to,data){
 let entry=state.transactions.find(t=>t.id===id);
 if(entry){if(entry.to!==to||entry.inputHash!==keccak256(data))throw Error('Activation payload changed '+id);}
 else {
  const gas=await c.estimateGas({account:account.address,to,data,value:0n});console.log(JSON.stringify({id,estimatedGas:String(gas),broadcast}));
  if(!broadcast)return;
  const nonce=await c.getTransactionCount({address:account.address,blockTag:'pending'});
  const fees=await c.estimateFeesPerGas();const limit=gas*13n/10n;
  if(limit*fees.maxFeePerGas>await c.getBalance({address:account.address}))throw Error('Insufficient ETH');
  const request=await signer.prepareTransactionRequest({account,chain:arbitrumSepolia,to,data,value:0n,nonce,gas:limit,...fees});
  const signed=await signer.signTransaction(request);entry={id,to,inputHash:keccak256(data),transactionHash:keccak256(signed),nonce,status:'SIGNED'};
  state.transactions.push(entry);save();await c.sendRawTransaction({serializedTransaction:signed});entry.status='SUBMITTED';save();
 }
 const r=await c.waitForTransactionReceipt({hash:entry.transactionHash,confirmations:2,timeout:120000});
 entry.status=r.status==='success'?'CONFIRMED':'REVERTED';entry.blockNumber=String(r.blockNumber);save();
 if(r.status!=='success')throw Error('Activation reverted '+id);console.log(id+' confirmed '+entry.transactionHash);
}
const call=(name,address,fn,args)=>({to:address,data:encodeFunctionData({abi:artifact(name).abi,functionName:fn,args})});
const vault=p.ordinaryComponents[15];
const config=call('ArbitrumTestTreasury',treasury.address,'configureSettlementOperator',[vault,account.address]);
await send('configure-operator',config.to,config.data);
if(!broadcast){console.log('Preview covers receiver configuration. Subsequent registry calls are simulated against confirmed preceding state during broadcast.');process.exit(0);}
if((await read('ProtocolFeeVault',vault,'settlementOperator')).toLowerCase()!==account.address.toLowerCase())throw Error('Operator not configured');
// Compare exact revert selectors: authorized operator reaches argument validation, outsider fails authority.
async function expectRevert(from,to,data,abi,name){
 try {await c.call({account:from,to,data});throw Error('Expected revert '+name);}catch(e){
  let error=e,raw;while(error){if(typeof error.data==='string'&&error.data.startsWith('0x'))raw=error.data;error=error.cause;}
  if(!raw||decodeErrorResult({abi,data:raw}).errorName!==name)throw Error('Unexpected permission probe result '+name);
 }
}
const outsider='0x000000000000000000000000000000000000bEEF';
await expectRevert(outsider,treasury.address,config.data,artifact('ArbitrumTestTreasury').abi,'Unauthorized');
const settle=call('ProtocolFeeVault',vault,'settleRewards',['0x'+'0'.repeat(64),[],1n,BigInt(Math.floor(Date.now()/1000)+120)]);
await expectRevert(account.address,vault,settle.data,artifact('ProtocolFeeVault').abi,'InvalidConversion');
await expectRevert(outsider,vault,settle.data,artifact('ProtocolFeeVault').abi,'UnauthorizedSettlementOperator');
state.operator=account.address;state.permissionProbes='PASSED';save();
const fixtureArtifact=artifact('ArbitrumTestBaselineFixture');
const existing=state.transactions.find(t=>t.id==='baseline-fixture');
const nonce=existing?.nonce??await c.getTransactionCount({address:account.address,blockTag:'pending'});
const fixture=getContractAddress({from:account.address,nonce:BigInt(nonce)});
await send('baseline-fixture',undefined,encodeDeployData({abi:fixtureArtifact.abi,bytecode:fixtureArtifact.bytecode.object,args:[]}));
const fixtureCode=await c.getCode({address:fixture});if(!fixtureCode||fixtureCode==='0x')throw Error('Missing fixture');
const hash=s=>keccak256(toBytes(s));const baselineId=hash(p.releaseId+':TICKERGARDEN_TEST_BASELINE');const templateId=hash(p.releaseId+':TEMPLATE');
const release=JSON.parse(fs.readFileSync('deployments/manifests/arbitrum-sepolia-421614.paired-assets.json'));const native=release.assets.find(x=>x.symbol==='ETH');
const baseline={referenceChainId:421614n,referenceFactory:fixture,referenceFactoryCodeHash:keccak256(fixtureCode),launchConfigId:0n,supply:BigInt(release.supplyReferenceRaw),curveFeeBps:100n,poolFee:0,tickSpacing:200,behaviorVectorRoot:keccak256(fs.readFileSync('spec/v1_pons_behavior_vectors.json')),status:1};
const quoteId=keccak256(encodeAbiParameters([{type:'bytes32'},{type:'uint256'},{type:'uint256'},{type:'bytes32'},{type:'address'},{type:'uint8'},{type:'uint256'},{type:'uint256'}],[hash('TICKERGARDEN_V1_QUOTE_ECONOMICS'),1n,421614n,baselineId,'0x0000000000000000000000000000000000000000',18,BigInt(native.phantomQuote),BigInt(native.graduationThreshold)]));
const quote={tickerGardenBaselineId:baselineId,quoteAsset:'0x0000000000000000000000000000000000000000',quoteDecimals:18,phantomQuote:BigInt(native.phantomQuote),graduationThreshold:BigInt(native.graduationThreshold),economicsHash:quoteId,status:1};
const codehash=async address=>keccak256(await c.getCode({address}));
const template={memeTokenImplementation:p.ordinaryComponents[6],memeTokenCodeHash:await codehash(p.ordinaryComponents[6]),curveImplementation:p.ordinaryComponents[7],curveCodeHash:await codehash(p.ordinaryComponents[7]),gaugeImplementation:p.ordinaryComponents[8],gaugeCodeHash:await codehash(p.ordinaryComponents[8]),graduatedHook:p.hook,hookCodeHash:await codehash(p.hook),graduationExecutor:p.executor,graduationExecutorCodeHash:await codehash(p.executor),feePolicyId:await read('TickerGardenFactoryV1',p.factory,'feePolicyId'),executionSpecId:hash('V1-EXEC-11'),status:1};
for(const [id,name,address,fn,args] of [ ['baseline','TickerGardenBaselineRegistry',p.ordinaryComponents[3],'addBaseline',[baselineId,baseline]],['quote','ApprovedQuoteRegistry',p.ordinaryComponents[2],'addQuoteConfig',[quoteId,quote]],['template','LaunchTemplateRegistry',p.ordinaryComponents[4],'addLaunchTemplate',[templateId,template]] ]){const a=call(name,address,fn,args);await send(id,a.to,a.data);}
for(const [name,address,fn,id] of [['TickerGardenBaselineRegistry',p.ordinaryComponents[3],'baseline',baselineId],['ApprovedQuoteRegistry',p.ordinaryComponents[2],'quoteConfig',quoteId],['LaunchTemplateRegistry',p.ordinaryComponents[4],'launchTemplate',templateId]])if((await read(name,address,fn,[id])).status!==1)throw Error('Configuration not active '+name);
const params={assetUid:'0x'+'0'.repeat(64),tickerGardenBaselineId:baselineId,quoteAssetConfigId:quoteId,launchTemplateId:templateId,expectedEconomics:'0x'+'0'.repeat(64),creatorRevenueBeneficiary:account.address,name:'Receiver Fix Readonly Smoke',symbol:'tgSMOKE',metadataURI:'data:application/json,%7B%22testOnly%22%3Atrue%7D',salt:hash(p.releaseId+':READONLY_SMOKE'),creatorTaxBps:500,creatorFeesToHolders:true,stakingEnabled:false};
params.expectedEconomics=await read('TickerGardenFactoryV1',p.factory,'previewMarketEconomics',[params]);
await c.simulateContract({account:account.address,address:p.ordinaryComponents[9],abi:artifact('LaunchAndBuyRouter').abi,functionName:'launchAndBuy',args:[params,1000000000000000n,1n,account.address],value:1500000000000000n});
state.launchAndBuySimulation='PASSED_READ_ONLY_NO_MARKET_CREATED';
state.status='ACTIVE_TEST_ONLY';state.baselineId=baselineId;state.quoteId=quoteId;state.templateId=templateId;state.baselineFixture=fixture;state.phantomQuote=native.phantomQuote;state.graduationThreshold=native.graduationThreshold;state.observedAt=new Date().toISOString();save();
fs.writeFileSync('deployments/manifests/arbitrum-sepolia-421614.v1.activation.json',JSON.stringify(state,null,2)+'\n');
p.status='DEPLOYED_VERIFIED_ACTIVE_TEST_ONLY';p.activation={quote:true,baseline:true,template:true};p.settlementOperator=account.address;p.operatorConfigured=true;p.activationManifest='arbitrum-sepolia-421614.v1.activation.json';p.balanceWei=String(await c.getBalance({address:account.address}));
fs.writeFileSync('deployments/manifests/arbitrum-sepolia-421614.v1.deployed.json',JSON.stringify(p,null,2)+'\n');
console.log(JSON.stringify({status:state.status,operator:state.operator,baselineId,quoteId,templateId,balanceWei:p.balanceWei}));
