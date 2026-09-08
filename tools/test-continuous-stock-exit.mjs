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
const out = 'outputs/reviews/continuous-stock-exit-2026-09-07';
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
const state=fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath)):{runId:'CONTINUOUS-STOCK-EXIT-2026-09-07',chainId:421614,releaseId:p.releaseId,transactions:[],checks:[],markets:{}};
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


const source=JSON.parse(fs.readFileSync('outputs/reviews/continuous-v4-public-2026-09-07/results.json'));
if(source.releaseId!==p.releaseId)throw Error('Market source release mismatch');
const m=source.markets['ERC20-S1-H1-T500'];
const manager=p.ordinaryComponents[12],vault=p.ordinaryComponents[13],fees=p.ordinaryComponents[15];
const done=id=>state.checks.some(x=>x.id===id&&x.status==='PASS');
const check=(ok,label)=>{if(!ok)throw Error(label);};
const balance=(token,user)=>read('TickerMemeTokenV1',token,'balanceOf',[user]);
async function rejection(id,role,address,name,fn,args,expected){
 if(done(id))return;
 let error;
 try{await c.simulateContract({account:accounts[role].address,address,abi:artifact(name).abi,functionName:fn,args});}
 catch(e){let x=e,raw;while(x){if(typeof x.data==='string'&&x.data.startsWith('0x'))raw=x.data;x=x.cause;}if(raw)error=decodeErrorResult({abi:[...artifact(name).abi,...artifact('MemeStockGauge').abi],data:raw}).errorName;}
 check(error===expected,id+': wrong or missing EVM error '+error);record(id,{expected,error,evidence:'ETH_CALL'});
}
const pin=await c.getBlock();
for(const name of ['AllocationManager','UserStockVault','ProtocolFeeVault','MarketRegistryV1']){const item=p.contracts.find(x=>x.name===name);check(keccak256(await c.getCode({address:item.address,blockNumber:pin.number}))===item.runtimeCodeHash,'Runtime changed '+name);}
check((await c.getBlock({blockNumber:pin.number})).hash===pin.hash,'Canonical pin changed');
const waiting=[];
for(const role of ['staker','outsider']){
 if(done('normal-exit-'+role))continue;
 const user=accounts[role].address,other=accounts[role==='staker'?'outsider':'staker'].address;
 const position=await read('MemeStockGauge',m.gauge,'positionOf',[user]);
 const now=(await c.getBlock()).timestamp;
 if(now<position.unlockAt){
  await rejection('early-exit-'+role,role,manager,'AllocationManager','unstakeAndWithdraw',[m.id],'PositionLockedUntil');
  await rejection('early-claim-'+role,role,fees,'ProtocolFeeVault','claimStaker',[m.id,m.quote],'PositionLockedUntil');
  waiting.push({role,chainTimestamp:String(now),unlockAt:String(position.unlockAt)});continue;
 }
 state.snapshots??={};
 const id='normal-'+role;
 if(!state.snapshots[id]){
  state.snapshots[id]={principal:String(await read('UserStockVault',vault,'allocation',[source.stockUid,user,m.id])),stockBalance:String(await balance(source.stock,user)),quoteBalance:String(await balance(m.quote,user)),quoteClaimable:String(position.quoteClaimable),memeClaimable:String(position.memeClaimable),otherAllocation:String(await read('UserStockVault',vault,'allocation',[source.stockUid,other,m.id]))};save();
 }
 const before=state.snapshots[id];check(BigInt(before.principal)>0n,'Missing normal principal');
 if(!done(id+'-exit-verified')){
 await call(id+'-exit',role,'AllocationManager',manager,'unstakeAndWithdraw',[m.id]);
 check(await balance(source.stock,user)===BigInt(before.stockBalance)+BigInt(before.principal),'Principal transfer mismatch');
 check(await read('UserStockVault',vault,'allocation',[source.stockUid,user,m.id])===0n,'Principal allocation not cleared');
 check(await read('UserStockVault',vault,'allocation',[source.stockUid,other,m.id])===BigInt(before.otherAllocation),'Other staker changed');
 const after=await read('MemeStockGauge',m.gauge,'positionOf',[user]);
 check(after.activeAmount===0n&&after.pendingAmount===0n,'Gauge principal not cleared');
 check(after.quoteClaimable===BigInt(before.quoteClaimable)&&after.memeClaimable===BigInt(before.memeClaimable),'Earned rewards lost');
 await rejection(id+'-repeat-exit',role,manager,'AllocationManager','unstakeAndWithdraw',[m.id],'NoAllocationPosition');
 record(id+'-exit-verified',{principalReturned:before.principal,rewardsPreserved:true});
 }
 await call(id+'-claim',role,'ProtocolFeeVault',fees,'claimStaker',[m.id,m.quote]);
 check(await balance(m.quote,user)===BigInt(before.quoteBalance)+BigInt(before.quoteClaimable),'Quote claim payment mismatch');
 check((await read('MemeStockGauge',m.gauge,'positionOf',[user])).quoteClaimable===0n,'Quote claim not cleared');
 const repeat=await c.simulateContract({account:user,address:fees,abi:artifact('ProtocolFeeVault').abi,functionName:'claimStaker',args:[m.id,m.quote]});check(repeat.result===0n,'Repeated claim nonzero');
 record('normal-exit-'+role,{marketId:m.id,...before,exactPrincipalReturn:true,rewardsPreserved:true,quoteClaimExact:true});
}
state.status=waiting.length?'WAITING_CHAIN_TIME':'NORMAL_EXIT_AND_CLAIMS_PASS';state.waiting=waiting;save();console.log(JSON.stringify({status:state.status,waiting,transactions:state.transactions.length,checks:state.checks.length}));
