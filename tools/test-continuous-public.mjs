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
if (!['start', 'finish', 'status'].includes(mode)) throw Error('Expected prepare or run');
const expectedAdmin = '0xA6c3298a5559544c3b4cf8e6DC5f349f4be524ea';
const walletDir = '/Users/dear/.config/tickergarden/testnet-wallets';
const secretPath = path.join(walletDir, 'arbitrum-sepolia-r3-roles.json');
const out = 'outputs/reviews/continuous-public-acceptance-2026-09-07';
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
const candidate=JSON.parse(fs.readFileSync('outputs/reviews/arbitrum-continuous-preflight-2026-09-07/candidate.preview.json'));
const isolated='deployments/releases/'+candidate.releaseId;
const p = JSON.parse(fs.readFileSync(isolated+'/arbitrum-sepolia-421614.v1.deployed.json'));
const active = JSON.parse(fs.readFileSync(isolated+'/activation.json'));
if (p.chainId!==421614 || p.releaseId!==active.releaseId || !p.contracts.some(x=>x.name==='TickerGardenBaselineRegistry')) throw Error('Wrong release');
const c=createPublicClient({chain:arbitrumSepolia,pollingInterval:1000,transport:http('https://sepolia-rollup.arbitrum.io/rpc')});
if (await c.getChainId()!==421614) throw Error('Wrong RPC chain');
const clients=Object.fromEntries(Object.entries(accounts).map(([role,account])=>[role,createWalletClient({account,chain:arbitrumSepolia,transport:http('https://sepolia-rollup.arbitrum.io/rpc')})]));
const statePath=out+'/results.json';
const state=fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath)):{runId:'CONTINUOUS-PUBLIC-2026-09-07',chainId:421614,releaseId:p.releaseId,transactions:[],checks:[],markets:{}};
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

const rewardName='HolderRewardsDistributorV1';
check(p.contracts.some(x=>x.name===rewardName),'Not streaming release');
const balance=(token,who)=>read('TickerMemeTokenV1',token,'balanceOf',[who]);
async function snapshot(id,fn){state.snapshots??={};if(!state.snapshots[id]){state.snapshots[id]=await fn();save();}return state.snapshots[id];}
async function claimAndAudit(id,role,m){
 if(done(id))return;
 const receipt=await call(id,role,rewardName,distributor,'claim',[m.id]);
 const logs=receipt.logs.flatMap(log=>{if(log.address.toLowerCase()!==distributor.toLowerCase())return [];try{return [decodeEventLog({abi:artifact(rewardName).abi,data:log.data,topics:log.topics})];}catch{return [];}});
 const event=logs.find(x=>x.eventName==='HolderStreamClaimed');check(event&&event.args.amount>0n,'No positive reward claim');check(event.args.account.toLowerCase()===accounts[role].address.toLowerCase(),'Claim beneficiary');
 const before=await c.getBalance({address:accounts[role].address,blockNumber:receipt.blockNumber-1n}),after=await c.getBalance({address:accounts[role].address,blockNumber:receipt.blockNumber});
 check(after-before===event.args.amount-receipt.gasUsed*receipt.effectiveGasPrice,'Claim native balance delta');
 record(id,{amount:String(event.args.amount),block:String(receipt.blockNumber),hash:receipt.transactionHash,balanceDeltaAudited:true});
}
if(mode==='start'){
 for(const role of ['creator','buyer']){
  const funding=await snapshot('fund-role-'+role,async()=>({amount:String((await c.getBalance({address:accounts[role].address}))<parseEther('0.02')?parseEther('0.03'):0n)}));
  if(BigInt(funding.amount)>0n)await send('fund-role-'+role,'admin',accounts[role].address,'0x',BigInt(funding.amount));
 }
 const key='NATURAL-24H',amount=parseEther('0.001'),launchFee=await read('TickerGardenFactoryV1',p.factory,'launchFee');
 if(!state.markets[key]){
  const params={assetUid:z32,tickerGardenBaselineId:active.baselineId,quoteAssetConfigId:active.quoteId,launchTemplateId:active.templateId,expectedEconomics:z32,creatorRevenueBeneficiary:accounts.creator.address,name:'TickerGarden Continuous Test',symbol:'tgFLOW',metadataURI:'data:application/json,%7B%22testOnly%22%3Atrue%7D',salt:hash(state.runId+key),creatorTaxBps:500,creatorFeesToHolders:true,stakingEnabled:false};
  params.expectedEconomics=await c.readContract({account:accounts.creator.address,address:p.factory,abi:artifact('TickerGardenFactoryV1').abi,functionName:'previewMarketEconomics',args:[params]});
  const sim=await c.simulateContract({account:accounts.creator.address,address:router,abi:artifact('LaunchAndBuyRouter').abi,functionName:'launchAndBuy',args:[params,amount,1n,accounts.creator.address],value:launchFee+amount});
  state.markets[key]={id:sim.result[0],token:sim.result[1],params};save();
 }
 const m=state.markets[key];
 if(!done('stream-start')){
  await call('launch','creator','LaunchAndBuyRouter',router,'launchAndBuy',[m.params,amount,1n,accounts.creator.address],launchFee+amount);
  const market=await read('MarketRegistryV1',registry,'market',[m.id]);m.curve=market.config.curve;save();check(market.config.gauge===zero,'Disabled staking gauge');
  await call('sweep','buyer','TickerGardenCurve',m.curve,'sweepCurveFees');
  const funding=await snapshot('holder-funding',async()=>({amount:String(await read('ProtocolFeeVault',fees,'holderLiability',[m.id,1,zero]))}));
  check(BigInt(funding.amount)>0n,'Missing holder fees');
  const r=await call('fund-holder','buyer','ProtocolFeeVault',fees,'fundHolderRewards',[m.id,1]);
  const b=await c.getBlock({blockNumber:r.blockNumber});const release=await read(rewardName,distributor,'releaseState',[m.id]);
  check(release[2]===b.timestamp+86400n,'Not natural 24 hour stream');
  m.fundingBlock=String(r.blockNumber);m.fundedAt=String(b.timestamp);m.endsAt=String(release[2]);m.funded=funding.amount;save();
  record('stream-start',{funded:m.funded,fundedAt:m.fundedAt,endsAt:m.endsAt,hash:r.transactionHash});
 }
 if(!done('transfer-preserves-earned')){
  const transfer=await snapshot('transfer',async()=>({amount:String((await balance(m.token,accounts.creator.address))/2n)}));
  const r=await call('transfer-half','creator','TickerMemeTokenV1',m.token,'transfer',[accounts.buyer.address,BigInt(transfer.amount)]);
  const at=who=>c.readContract({address:distributor,abi:artifact(rewardName).abi,functionName:'claimable',args:[m.id,who],blockNumber:r.blockNumber});
  const earned=await at(accounts.creator.address),newEarned=await at(accounts.buyer.address);
  check(earned>0n&&newEarned===0n,'Transfer reassigned historical earnings');
  record('transfer-preserves-earned',{creatorEarned:String(earned),newHolderEarned:String(newEarned),block:String(r.blockNumber)});
 }
 await claimAndAudit('early-creator-claim','creator',m);
 await claimAndAudit('early-buyer-claim','buyer',m);
 state.status='AWAITING_NATURAL_24H';save();
}
if(mode==='finish'){
 const m=state.markets['NATURAL-24H'];check(m?.endsAt,'Missing natural stream');
 const b=await c.getBlock();
 if(b.timestamp<BigInt(m.endsAt)){console.log(JSON.stringify({status:'WAITING_CHAIN_TIME',chainTimestamp:String(b.timestamp),endsAt:m.endsAt,secondsRemaining:String(BigInt(m.endsAt)-b.timestamp)}));process.exit(0);}
 await claimAndAudit('final-creator-claim','creator',m);await claimAndAudit('final-buyer-claim','buyer',m);
 const release=await read(rewardName,distributor,'releaseState',[m.id]);check(release[0]===0n&&release[3]===0n,'Stream not finished');
 const market=await read(rewardName,distributor,'marketState',[m.id]);check(market.paid<=market.funded&&market.funded-market.paid<=2n,'Conservation or rounding mismatch');
 record('natural-24h-finished',{funded:String(market.funded),paid:String(market.paid),dust:String(market.funded-market.paid),chainTimestamp:String(b.timestamp)});state.status='NATURAL_24H_PASSED';save();
}
console.log(JSON.stringify({status:state.status,transactions:state.transactions.length,checks:state.checks.length,naturalEnd:state.markets['NATURAL-24H']?.endsAt}));
