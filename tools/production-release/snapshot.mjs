import fs from 'node:fs';import path from 'node:path';
import {ROOT,read,write,readonlyRpc,equal,keccak256,toFunctionSelector,decodeAbiParameters,encodeFunctionData,parseAbi,ZERO} from './common.mjs';
export async function snapshotMainnet(output,{rpcUrl=process.env.ROBINHOOD_RPC_URL}={}){
 fs.mkdirSync(output,{recursive:true});
 const p=read('deployments/manifests/robinhood-mainnet-4663.preparation.json');
 const prior=read(path.resolve(ROOT,'deployments/manifests',p.safeEvidence));const oldDeps=read(p.evidenceDirectory+'dependencies.json').dependencies;
 const quote=read('deployments/manifests/robinhood-mainnet-4663.paired-assets.json');const stake=read('deployments/manifests/robinhood-mainnet-4663.staking-assets.json');
 const rpc=readonlyRpc(rpcUrl);const chainId=Number(BigInt(await rpc.call('eth_chainId',[])));equal(chainId,4663,'mainnet chain');
 const block=await rpc.call('eth_getBlockByNumber',['finalized',false]);if(!block?.hash||!block.l1BlockNumber)throw Error('Finalized block and L1 pin required');
 const pin=block.number;const result={status:'READ_ONLY_PREDEPLOYMENT_SNAPSHOT_NOT_BROADCAST',observedAt:new Date().toISOString(),chainId,pin:{blockNumber:BigInt(pin).toString(),blockHash:block.hash,l1BlockNumber:BigInt(block.l1BlockNumber).toString(),timestamp:BigInt(block.timestamp).toString(),tag:'finalized'},accounts:{},dependencies:{},stocks:[],quoteAssets:[],failures:[]};
 const check=(ok,message)=>{if(!ok)result.failures.push(message);};const decode=(type,raw)=>decodeAbiParameters([{type}],raw)[0];
 const call=(to,signature)=>rpc.call('eth_call',[{to,data:toFunctionSelector(signature)},pin]);
 for(const [role,address] of [['treasury',p.addresses.platformTreasury],['governance',p.addresses.governance],['deployer',p.addresses.deployer],['operator',p.holderSnapshots.publisher]]){
  const [code,balance,nonce,pendingNonce]=await rpc.batch([['eth_getCode',[address,pin]],['eth_getBalance',[address,pin]],['eth_getTransactionCount',[address,pin]],['eth_getTransactionCount',[address,'pending']]]);
  const a={address,codeHash:keccak256(code),codeBytes:(code.length-2)/2,balanceWei:BigInt(balance).toString(),nonce:Number(BigInt(nonce)),pendingNonce:Number(BigInt(pendingNonce))};
  if(role==='treasury'||role==='governance'){
   const sigs=['VERSION()','getThreshold()','getOwners()','nonce()','masterCopy()'];const raw=await rpc.batch(sigs.map(sig=>['eth_call',[{to:address,data:toFunctionSelector(sig)},pin]]));
   Object.assign(a,{version:decode('string',raw[0]),threshold:Number(decode('uint256',raw[1])),owners:decode('address[]',raw[2]),safeNonce:decode('uint256',raw[3]).toString(),singleton:decode('address',raw[4])});
   const moduleData=encodeFunctionData({abi:parseAbi(['function getModulesPaginated(address,uint256) view returns (address[],address)']),functionName:'getModulesPaginated',args:['0x'+'0'.repeat(39)+'1',100n]});
   const [guard,handler,modules,singletonCode]=await rpc.batch([['eth_getStorageAt',[address,keccak256(new TextEncoder().encode('guard_manager.guard.address')),pin]],['eth_getStorageAt',[address,keccak256(new TextEncoder().encode('fallback_manager.handler.address')),pin]],['eth_call',[{to:address,data:moduleData},pin]],['eth_getCode',[a.singleton,pin]]]);
   const [enabled,next]=decodeAbiParameters([{type:'address[]'},{type:'address'}],modules);
   Object.assign(a,{guard:'0x'+guard.slice(-40),fallbackHandler:'0x'+handler.slice(-40),enabledModules:enabled,modulesNext:next,singletonCodeHash:keccak256(singletonCode)});
   const old=prior.accounts[role];check(JSON.stringify(a.owners.map(x=>x.toLowerCase()).sort())===JSON.stringify(old.owners.map(x=>x.toLowerCase()).sort()),role+' owners drift');
   check(a.threshold===Number(decode('uint256',old.reads['getThreshold()']))&&a.version===decode('string',old.reads['VERSION()'])&&a.codeHash===old.codeHash&&a.singletonCodeHash===old.singletonCodeHash,role+' Safe identity drift');
   check(a.guard.toLowerCase()===('0x'+old.guardStorage.slice(-40)).toLowerCase()&&a.fallbackHandler.toLowerCase()===('0x'+old.fallbackHandlerStorage.slice(-40)).toLowerCase()&&enabled.length===0&&BigInt(next)===1n,role+' Safe extensions drift');
  } else if(role==='deployer') {check(code==='0x','deployer must be EOA');check(a.nonce===a.pendingNonce,'deployer has newer or pending transactions');}
  result.accounts[role]=a;
 }
 check(!result.accounts.treasury.owners.some(a=>result.accounts.governance.owners.some(b=>a.toLowerCase()===b.toLowerCase())),'Safe owners overlap');
 for(const [key,value] of Object.entries(oldDeps)){
  const code=await rpc.call('eth_getCode',[value.address,pin]);result.dependencies[key]={address:value.address,codeHash:keccak256(code),codeBytes:(code.length-2)/2};check(keccak256(code)===value.codeHash,key+' code drift');
 }
 const pm=result.dependencies.POSITION_MANAGER.address;equal(decode('address',await call(pm,'poolManager()')),result.dependencies.POOL_MANAGER.address,'position manager pool manager');equal(decode('address',await call(pm,'permit2()')),result.dependencies.PERMIT2.address,'permit2');
 const ref=read('spec/v1_pons_behavior_vectors.json').reference;const referenceCode=await rpc.call('eth_getCode',[ref.factory,pin]);result.baselineReference={chainId:4663,factory:ref.factory,codeHash:keccak256(referenceCode),referenceEvidence:'spec/v1_pons_behavior_vectors.json'};check(keccak256(referenceCode)===ref.runtimeKeccak256,'Pons reference runtime drift');
 const stocks=quote.assets.filter(a=>a.assetKind==='OFFICIAL_STOCK'&&a.includedInRelease);check(stocks.length===194&&stake.assets.length===194,'approved stock counts');check(new Set(stocks.map(a=>a.assetUid)).size===194&&new Set(stocks.map(a=>a.tokenAddress.toLowerCase())).size===194,'stock identity uniqueness');
 const stockDeps=new Map();
 for(const token of stocks)for(const [address,kind] of [[token.expectedFingerprint.beacon,'beacon'],[token.expectedFingerprint.implementation,'implementation']])stockDeps.set(address.toLowerCase(),{address,kind});
 for(const dep of stockDeps.values()){dep.code=await rpc.call('eth_getCode',[dep.address,pin]);dep.codeHash=keccak256(dep.code);if(dep.kind==='beacon')dep.implementation=decode('address',await call(dep.address,'implementation()'));}
 for(let start=0;start<stocks.length;start+=16){
  const slice=stocks.slice(start,start+16);const calls=slice.flatMap(a=>[['eth_getCode',[a.tokenAddress,pin]],['eth_call',[{to:a.tokenAddress,data:toFunctionSelector('uid()')},pin]],['eth_call',[{to:a.tokenAddress,data:toFunctionSelector('decimals()')},pin]]]);const raw=await rpc.batch(calls);
  for(let i=0;i<slice.length;i++){
   const a=slice[i],fp=a.expectedFingerprint,code=raw[i*3],uid=decode('bytes32',raw[i*3+1]),decimals=Number(decode('uint256',raw[i*3+2]));
   const beaconWord=code.slice(2+29*2,2+61*2);const beacon='0x'+beaconWord.slice(-40);const normalized=code.slice(0,2+29*2)+'0'.repeat(64)+code.slice(2+61*2);const beaconState=stockDeps.get(fp.beacon.toLowerCase()),implementationState=stockDeps.get(fp.implementation.toLowerCase());
   const observed={symbol:a.symbol,address:a.tokenAddress,assetUid:uid,decimals,fingerprint:{tokenRuntimeCodeHash:keccak256(code),beacon,beaconRuntimeCodeHash:beaconState.codeHash,implementation:beaconState.implementation,implementationRuntimeCodeHash:implementationState.codeHash},normalizedProxyHash:keccak256(normalized)};
   check(uid.toLowerCase()===a.assetUid.toLowerCase()&&decimals===18,a.symbol+' UID/decimals drift');
   for(const key of Object.keys(fp))check(String(observed.fingerprint[key]).toLowerCase()===String(fp[key]).toLowerCase(),a.symbol+' '+key+' drift');
   check(observed.normalizedProxyHash==='0xcc20afa74ce45ef50184f03d81a5bfd1fe23d087f97a8fd3dc5403155a003d23',a.symbol+' proxy template drift');
   const staking=stake.assets.find(x=>x.assetUid===a.assetUid);check(staking?.tokenAddress.toLowerCase()===a.tokenAddress.toLowerCase()&&staking.minimumAllocation==='500000000000000000',a.symbol+' stake config');result.stocks.push(observed);
  }
  console.log(`Verified Stock identities ${Math.min(start+16,stocks.length)}/${stocks.length}`);
 }
 const usdg=quote.assets.find(a=>a.symbol==='USDG');const priorUsdg=read('docs/reviews/evidence/usdg-quote-2026-09-12/identity.json');const implementationSlot='0x'+(BigInt(keccak256(new TextEncoder().encode('eip1967.proxy.implementation')))-1n).toString(16);
 const [usdgCode,usdgDecimals,slotValue]=await rpc.batch([['eth_getCode',[usdg.tokenAddress,pin]],['eth_call',[{to:usdg.tokenAddress,data:toFunctionSelector('decimals()')},pin]],['eth_getStorageAt',[usdg.tokenAddress,implementationSlot,pin]]]);
 const usdgImpl='0x'+slotValue.slice(-40),usdgImplCode=await rpc.call('eth_getCode',[usdgImpl,pin]);
 result.quoteAssets=[{symbol:'ETH',address:ZERO,decimals:18},{symbol:'USDG',address:usdg.tokenAddress,decimals:Number(decode('uint256',usdgDecimals)),codeHash:keccak256(usdgCode),implementation:usdgImpl,implementationCodeHash:keccak256(usdgImplCode)}];
 check(keccak256(usdgCode)===usdg.runtimeCodeHash&&Number(decode('uint256',usdgDecimals))===6&&slotValue.toLowerCase()===priorUsdg.implementationSlot.toLowerCase(),'USDG identity drift');
 result.network={maxTxGas:decode('uint256',await call('0x'+'0'.repeat(38)+'6c','getMaxTxGasLimit()')).toString(),maxBlockGas:decode('uint256',await call('0x'+'0'.repeat(38)+'6c','getMaxBlockGasLimit()')).toString(),gasPriceWei:BigInt(await rpc.call('eth_gasPrice',[])).toString()};
 equal((await rpc.call('eth_getBlockByNumber',[pin,false])).hash,block.hash,'finalized pin unchanged');
 write(path.join(output,'mainnet-snapshot.json'),result);if(result.failures.length)throw Error('Mainnet snapshot rejected: '+result.failures.join('; '));
 return result;
}
if(process.argv[1]===new URL(import.meta.url).pathname){const directory=path.resolve(process.argv[2]??'docs/reviews/evidence/production-release-2026-09-15');await snapshotMainnet(directory);}
