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
if (!['idle', 'capacity', 'retry', 'status'].includes(mode)) throw Error('Expected idle, capacity, retry or status');
const expectedAdmin = '0xA6c3298a5559544c3b4cf8e6DC5f349f4be524ea';
const walletDir = '/Users/dear/.config/tickergarden/testnet-wallets';
const secretPath = path.join(walletDir, 'arbitrum-sepolia-r3-roles.json');
const out = 'outputs/reviews/continuous-edge-public-2026-09-07';
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
const state=fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath)):{runId:'CONTINUOUS-EDGE-PUBLIC-2026-09-07',chainId:421614,releaseId:p.releaseId,transactions:[],checks:[],markets:{}};
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

async function launch(key){
 const amount=parseEther('0.001'),launchFee=await read('TickerGardenFactoryV1',p.factory,'launchFee');
 if(!state.markets[key]){
  const params={assetUid:z32,tickerGardenBaselineId:active.baselineId,quoteAssetConfigId:active.quoteId,launchTemplateId:active.templateId,expectedEconomics:z32,creatorRevenueBeneficiary:accounts.creator.address,name:'TickerGarden Edge '+key,symbol:'tgEDGE',metadataURI:'data:application/json,%7B%22testOnly%22%3Atrue%7D',salt:hash(state.runId+key),creatorTaxBps:0,creatorFeesToHolders:true,stakingEnabled:false};
  params.expectedEconomics=await c.readContract({account:accounts.creator.address,address:p.factory,abi:artifact('TickerGardenFactoryV1').abi,functionName:'previewMarketEconomics',args:[params]});
  const sim=await c.simulateContract({account:accounts.creator.address,address:router,abi:artifact('LaunchAndBuyRouter').abi,functionName:'launchAndBuy',args:[params,amount,1n,accounts.creator.address],value:launchFee+amount});
  state.markets[key]={id:sim.result[0],token:sim.result[1],params};save();
 }
 const m=state.markets[key];await call('launch-'+key,'creator','LaunchAndBuyRouter',router,'launchAndBuy',[m.params,amount,1n,accounts.creator.address],launchFee+amount);
 m.curve=(await read('MarketRegistryV1',registry,'market',[m.id])).config.curve;save();return m;
}
async function expectCapacityTransaction(id,m){
 const role='creator',to=fees,data=encodeFunctionData({abi:artifact('ProtocolFeeVault').abi,functionName:'fundHolderRewards',args:[m.id,1]});
 let raw;
 try{await c.call({account:accounts[role].address,to,data});}catch(e){for(let x=e;x;x=x.cause)if(typeof x.data==='string')raw=x.data;}
 check(raw&&decodeErrorResult({abi:artifact(rewardName).abi,data:raw}).errorName==='StreamCapacity','Wrong capacity failure');
 let t=state.transactions.find(t=>t.id===id);
 if(!t){
  const account=accounts[role],nonce=await c.getTransactionCount({address:account.address,blockTag:'pending'}),fee=await c.estimateFeesPerGas(),gas=1000000n;
  check(gas*fee.maxFeePerGas<parseEther('0.002'),'Expected-revert budget');
  const request=await clients[role].prepareTransactionRequest({account,to,data,value:0n,nonce,gas,...fee}),signed=await clients[role].signTransaction(request);
  t={id,role,to,value:'0',inputHash:keccak256(data),nonce,hash:keccak256(signed),status:'SIGNED',expectedStatus:'reverted'};state.transactions.push(t);save();
  await c.sendRawTransaction({serializedTransaction:signed});t.status='SUBMITTED';save();
 }
 const receipt=await c.waitForTransactionReceipt({hash:t.hash,confirmations:2,timeout:120000});check(receipt.status==='reverted','Capacity transaction unexpectedly succeeded');
 t.status='EXPECTED_REVERT';t.blockNumber=String(receipt.blockNumber);t.blockHash=receipt.blockHash;t.gasUsed=String(receipt.gasUsed);t.gasCostWei=String(receipt.gasUsed*receipt.effectiveGasPrice);save();return receipt;
}
if(mode!=='status'){
 for(const role of ['creator','buyer']){
  const f=await snapshot('role-fund-'+role,async()=>({amount:String((await c.getBalance({address:accounts[role].address}))<parseEther('0.01')?parseEther('0.025'):0n)}));
  if(BigInt(f.amount)>0n)await send('role-fund-'+role,'admin',accounts[role].address,'0x',BigInt(f.amount));
 }
}
if(mode==='idle'&&!done('idle-restarted')){
 const m=await launch('IDLE');
 await call('idle-sweep','buyer','TickerGardenCurve',m.curve,'sweepCurveFees');
 await call('idle-fund','buyer','ProtocolFeeVault',fees,'fundHolderRewards',[m.id,1]);
 const amount=await snapshot('idle-tokens',async()=>({amount:String(await balance(m.token,accounts.creator.address))}));
 await call('idle-exclude-all','creator','TickerMemeTokenV1',m.token,'transfer',['0x000000000000000000000000000000000000dEaD',BigInt(amount.amount)]);
 if(!state.transactions.some(t=>t.id==='idle-new-buy'))check((await read(rewardName,distributor,'marketState',[m.id])).supply===0n,'Effective supply not zero');
 await call('idle-checkpoint','buyer',rewardName,distributor,'checkpoint',[m.id]);
 const before=await snapshot('idle-before-restart',async()=>{const v=await read(rewardName,distributor,'marketState',[m.id]);return {idle:String(v.idle),funded:String(v.funded),paid:String(v.paid)};});check(BigInt(before.idle)>0n,'No idle accrual');
 const r=await call('idle-new-buy','buyer','TickerGardenCurve',m.curve,'buy',[parseEther('0.00001'),1n,accounts.buyer.address],parseEther('0.00001'));
 const v=await c.readContract({address:distributor,abi:artifact(rewardName).abi,functionName:'marketState',args:[m.id],blockNumber:r.blockNumber});
 const newEarned=await c.readContract({address:distributor,abi:artifact(rewardName).abi,functionName:'claimable',args:[m.id,accounts.buyer.address],blockNumber:r.blockNumber});
 check(v.idle===0n&&v.supply>0n&&newEarned===0n,'Idle restart credited history immediately');
 const restarted=r.logs.flatMap(l=>{if(l.address.toLowerCase()!==distributor.toLowerCase())return [];try{return [decodeEventLog({abi:artifact(rewardName).abi,data:l.data,topics:l.topics})];}catch{return [];}}).find(e=>e.eventName==='IdleRewardsRestarted');
 check(restarted&&restarted.args.scaledAmount>=BigInt(before.idle),'No restart event');
 check(BigInt(restarted.args.end)===(await c.getBlock({blockNumber:r.blockNumber})).timestamp+86400n,'Idle restart duration');
 m.idleRestartEndsAt=String(restarted.args.end);save();
 await claimAndAudit('idle-old-earned-claim','creator',m);
 record('idle-restarted',{marketId:m.id,idleBefore:before.idle,restartedScaled:String(restarted.args.scaledAmount),newHolderHistory:'0',endsAt:m.idleRestartEndsAt});
}
if(mode==='capacity'&&!done('capacity-rollback')){
 const m=await launch('CAPACITY');
 state.driver=await deploy('capacity-driver','ArbitrumContinuousTestDriver',[fees]);save();
 for(let i=0;i<64;i++){
  if(done('stream-'+i))continue;
  const r=await call('capacity-cycle-'+i,'creator','ArbitrumContinuousTestDriver',state.driver,'cycle',[m.curve,m.id],parseEther('0.000001'));
  const v=await c.readContract({address:distributor,abi:artifact(rewardName).abi,functionName:'marketState',args:[m.id],blockNumber:r.blockNumber});
  check(Number(v.count)===i+1,'Distinct timestamp stream count mismatch');
  const b=await c.getBlock({blockNumber:r.blockNumber});if(i===0)m.firstExpiry=String(b.timestamp+86400n);m.lastExpiry=String(b.timestamp+86400n);save();
  record('stream-'+i,{count:Number(v.count),block:String(r.blockNumber),timestamp:String(b.timestamp)});
 }
 await call('capacity-overflow-buy','creator','TickerGardenCurve',m.curve,'buy',[parseEther('0.000001'),1n,accounts.creator.address],parseEther('0.000001'));
 await call('capacity-overflow-sweep','buyer','TickerGardenCurve',m.curve,'sweepCurveFees');
 const before=await snapshot('capacity-before',async()=>({liability:String(await read('ProtocolFeeVault',fees,'holderLiability',[m.id,1,zero])),funded:String((await read(rewardName,distributor,'marketState',[m.id])).funded),vaultBalance:String(await c.getBalance({address:fees})),distributorBalance:String(await c.getBalance({address:distributor}))}));
 check(BigInt(before.liability)>0n,'No pending overflow liability');
 await expectCapacityTransaction('capacity-expected-revert',m);
 check(await read('ProtocolFeeVault',fees,'holderLiability',[m.id,1,zero])===BigInt(before.liability),'Liability changed after revert');
 check((await read(rewardName,distributor,'marketState',[m.id])).funded===BigInt(before.funded),'Funding changed after revert');
 check(await c.getBalance({address:fees})===BigInt(before.vaultBalance)&&await c.getBalance({address:distributor})===BigInt(before.distributorBalance),'Balances changed after revert');
 await call('capacity-transfer','creator','TickerMemeTokenV1',m.token,'transfer',[accounts.buyer.address,1n]);
 await claimAndAudit('capacity-claim-while-full','creator',m);
 record('capacity-rollback',{marketId:m.id,liability:before.liability,transferAndClaimAllowed:true,firstExpiry:m.firstExpiry});
}
if(mode==='retry'&&!done('capacity-retry')){
 const m=state.markets.CAPACITY;check(done('capacity-rollback'),'Capacity test not finished');
 const b=await c.getBlock();if(b.timestamp<BigInt(m.firstExpiry)){console.log(JSON.stringify({status:'WAITING_CHAIN_TIME',endsAt:m.firstExpiry}));process.exit(0);}
 const before=await snapshot('capacity-retry-before',async()=>({pending:String(await read('ProtocolFeeVault',fees,'holderLiability',[m.id,1,zero])),funded:String((await read(rewardName,distributor,'marketState',[m.id])).funded)}));
 await call('capacity-retry-fund','buyer','ProtocolFeeVault',fees,'fundHolderRewards',[m.id,1]);
 check(await read('ProtocolFeeVault',fees,'holderLiability',[m.id,1,zero])===0n,'Retry did not clear pending');
 check((await read(rewardName,distributor,'marketState',[m.id])).funded===BigInt(before.funded)+BigInt(before.pending),'Retry amount mismatch');
 record('capacity-retry',{amount:before.pending});
}
console.log(JSON.stringify({mode,transactions:state.transactions.length,checks:state.checks.length,firstExpiry:state.markets.CAPACITY?.firstExpiry}));
