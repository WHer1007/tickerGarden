import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {sqrtAtTick,planLiquidity,amountsForLiquidity,positionTicks} from './math.mjs';
import {reconcile,verifyReceipt,validateManifest} from './runtime.mjs';
import {encodeAbiParameters,keccak256,toBytes} from '../../apps/web/node_modules/viem/_esm/index.js';
const address='0x'+'11'.repeat(20),hash='0x'+'22'.repeat(32);
const m={chainId:31337,releaseId:hash,marketId:hash,keeper:address,locker:address,registry:address,executor:address,positionManager:address,poolManager:address,codeHashes:Object.fromEntries(['locker','registry','executor','positionManager','poolManager'].map(x=>[x,hash])),maxGasWei:'1000',minLiquidity:'1',bufferBps:50,confirmations:1};
const intent=()=>({hash,raw:'0x1234',nonce:3,marketId:hash,locker:address,releaseId:hash,plan:{tokenId:'1',liquidity:'10',amount0Max:'8',amount1Max:'9',deadline:'200'}});
const receipt=()=>({transactionHash:hash,status:'success',blockNumber:9n,gasUsed:10n,effectiveGasPrice:2n,logs:[{address,topics:[keccak256(toBytes('LockedFeesCompounded(bytes32,uint256,uint128,uint256,uint256,uint256,uint256)')),hash,'0x'+'0'.repeat(63)+'1'],data:encodeAbiParameters([{type:'uint128'},...Array(4).fill({type:'uint256'})],[10n,8n,9n,0n,0n])}]});

test('TickMath canonical extreme values and signed PositionInfo ticks',()=>{
 assert.equal(sqrtAtTick(0),1n<<96n);assert.equal(sqrtAtTick(-887272),4295128739n);assert.equal(sqrtAtTick(887272),1461446703485210103287273052203988822378723970342n);
 assert.deepEqual(positionTicks((BigInt(0x1000000-60)<<8n)|(60n<<32n)),[-60,60]);
});
test('planner conserves caps across prices, zero/single sided fees and asymmetric ranges',()=>{
 for(const tick of [-500,-100,0,100,500])for(const amounts of [[0n,0n],[100000n,0n],[0n,200000n],[100000n,200000n]]){
  const p=planLiquidity({amount0:amounts[0],amount1:amounts[1],sqrtPriceX96:sqrtAtTick(tick),tickLower:-100,tickUpper:100});
  if(p.status==='ready'){const used=amountsForLiquidity(p.liquidity,sqrtAtTick(tick),sqrtAtTick(-100),sqrtAtTick(100));assert.ok(used[0]<=p.amount0Max&&used[1]<=p.amount1Max);assert.ok(p.amount0Max<=amounts[0]&&p.amount1Max<=amounts[1]);}
 }
 assert.equal(planLiquidity({amount0:100n,amount1:0n,sqrtPriceX96:sqrtAtTick(0),tickLower:-100,tickUpper:100}).status,'below_minimum');
 assert.throws(()=>planLiquidity({amount0:1n,amount1:1n,sqrtPriceX96:1n,tickLower:1,tickUpper:0}));
});
test('manifest requires pinned code, gas caps and production confirmation depth',()=>{
 validateManifest(m);assert.throws(()=>validateManifest({...m,codeHashes:{}}));assert.throws(()=>validateManifest({...m,chainId:4663}));assert.throws(()=>validateManifest({...m,maxGasWei:'0'}));
});
test('receipt must match market, token, liquidity and spend ceilings',()=>{
 assert.equal(verifyReceipt(receipt(),intent(),m),'confirmed');assert.throws(()=>verifyReceipt({...receipt(),logs:[]},intent(),m));assert.throws(()=>verifyReceipt(receipt(),{...intent(),plan:{...intent().plan,amount0Max:'7'}},m));assert.equal(verifyReceipt({...receipt(),status:'reverted'},intent(),m),'reverted');
});
test('uncertain send persists intent; restart resends identical bytes then confirms',async()=>{
 const journal={pending:intent()},sent=[];let saved=0;
 const client={getTransactionReceipt:async()=>{const e=Error();e.name='TransactionReceiptNotFoundError';throw e;},getTransactionCount:async()=>3,getBlock:async()=>({timestamp:100n}),sendRawTransaction:async({serializedTransaction})=>{sent.push(serializedTransaction);throw Error('network disconnected');},waitForTransactionReceipt:async()=>receipt()};
 await assert.rejects(reconcile(client,m,journal,async()=>saved++),/uncertain/);assert.equal(journal.pending.raw,'0x1234');assert.equal(saved,0);
 client.sendRawTransaction=async({serializedTransaction})=>sent.push(serializedTransaction);
 await reconcile(client,m,journal,async()=>saved++);assert.deepEqual(sent,['0x1234','0x1234']);assert.equal(journal.pending,null);assert.equal(journal.last.status,'confirmed');assert.equal(journal.last.raw,undefined);assert.equal(saved,1);
});
test('existing receipt does not rebroadcast; consumed nonce and expired intent block replacement',async()=>{
 let sends=0;const client={getTransactionReceipt:async()=>receipt(),waitForTransactionReceipt:async()=>receipt(),sendRawTransaction:async()=>sends++};
 await reconcile(client,m,{pending:intent()},async()=>{});assert.equal(sends,0);
 client.getTransactionReceipt=async()=>{const e=Error();e.name='TransactionReceiptNotFoundError';throw e;};client.getTransactionCount=async()=>4;
 await assert.rejects(reconcile(client,m,{pending:intent()},async()=>{}),/Nonce consumed/);
 client.getTransactionCount=async()=>3;client.getBlock=async()=>({timestamp:201n});
 await assert.rejects(reconcile(client,m,{pending:intent()},async()=>{}),/expired/);assert.equal(sends,0);
});

test('CLI status redacts signed bytes and an existing signer lock blocks concurrent work',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tg-locker-cli-'));fs.chmodSync(dir,0o700);
 try{
  const manifest=path.join(dir,'manifest.json');fs.writeFileSync(manifest,JSON.stringify(m));
  const journal=path.join(dir,`${m.chainId}-${m.keeper}.json`);
  fs.writeFileSync(journal,JSON.stringify({chainId:m.chainId,keeper:m.keeper,pending:intent()}),{mode:0o600});
  const run=()=>spawnSync(process.execPath,['tools/locker-compounding/worker.mjs','status',manifest],{encoding:'utf8',env:{...process.env,TG_LOCKER_STATE_DIR:dir}});
  const result=run();assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).pending.raw,undefined);
  fs.writeFileSync(journal+'.lock','existing owner',{mode:0o600});const blocked=run();assert.equal(blocked.status,1);assert.equal(fs.readFileSync(journal+'.lock','utf8'),'existing owner');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('CLI malformed signer cannot leak key material and persists sanitized failure',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tg-locker-key-'));fs.chmodSync(dir,0o700);
 try{
  const manifest=path.join(dir,'manifest.json');fs.writeFileSync(manifest,JSON.stringify(m));
  const signer=path.join(dir,'signer.json');fs.writeFileSync(signer,'SENSITIVE_TEST_SENTINEL',{mode:0o600});
  const result=spawnSync(process.execPath,['tools/locker-compounding/worker.mjs','execute',manifest],{encoding:'utf8',env:{...process.env,TG_LOCKER_STATE_DIR:dir,TG_LOCKER_SIGNER_FILE:signer,TG_LOCKER_RPC_URL:'http://127.0.0.1:1'}});
  assert.equal(result.status,1);assert.ok(!result.stderr.includes('SENSITIVE_TEST_SENTINEL'));assert.match(result.stderr,/Invalid private signer file/);
  const journal=JSON.parse(fs.readFileSync(path.join(dir,`${m.chainId}-${m.keeper}.json`)));assert.equal(journal.lastError.error,'Invalid private signer file');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
