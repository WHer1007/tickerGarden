// Included in the isolated R6 runner. Uses its single nonce/receipt journal.
async function naturalExits(){
 for(const m of Object.values(state.markets).filter(x=>x.normalExitDueAt)){
  const id='normal-exit-'+m.key;if(done(id))continue;
  const allocation=await read('UserStockVault',vault,'allocation',[state.stockUid,accounts.staker.address,m.id]);
  if(allocation===0n&&!state.transactions.some(t=>t.id===id)){record(id,{status:'ALREADY_RAGEQUIT',normalExitTest:false});continue;}
  if((await c.getBlock()).timestamp<BigInt(m.normalExitDueAt)){console.log('WAIT '+id+' '+m.normalExitDueAt);continue;}
  const before=await snapshot(id,async()=>({stock:String(await balance(state.stock,accounts.staker.address)),principal:String(allocation)}));
  await call(id,'staker','AllocationManager',manager,'unstakeAndWithdraw',[m.id]);
  check(await balance(state.stock,accounts.staker.address)===BigInt(before.stock)+BigInt(before.principal),'Normal principal mismatch');
  const claim=await snapshot(id+'-claim',async()=>({balance:String(await balance(m.quote,accounts.staker.address)),amount:String((await c.simulateContract({account:accounts.staker.address,address:fees,abi:artifact('ProtocolFeeVault').abi,functionName:'claimStaker',args:[m.id,m.quote]})).result)}));
  check(BigInt(claim.amount)>0n,'Normal exit lost converted rewards');
  const receipt=await call(id+'-claim','staker','ProtocolFeeVault',fees,'claimStaker',[m.id,m.quote]);
  const gas=m.quote===zero?receipt.gasUsed*receipt.effectiveGasPrice:0n;
  check(await balance(m.quote,accounts.staker.address)+gas===BigInt(claim.balance)+BigInt(claim.amount),'Normal reward mismatch');
  check((await c.simulateContract({account:accounts.staker.address,address:fees,abi:artifact('ProtocolFeeVault').abi,functionName:'claimStaker',args:[m.id,m.quote]})).result===0n,'Repeated normal reward');
  check(await read('UserStockVault',vault,'allocation',[state.stockUid,accounts.staker.address,m.id])===0n,'Principal ledger not cleared');
  record(id,{principal:before.principal,quoteClaim:claim.amount,evidenceType:'MINED_TX_NATURAL_TIME'});
 }
 const q=state.timeQueue?.find(x=>x.type==='STOCK_UNPAUSE');
 if(q&&!done('natural-stock-unpause')&&(await c.getBlock()).timestamp>=BigInt(q.availableAt)){
  const code=keccak256(await c.getCode({address:state.stock}));check(code===state.stockRuntimeHash,'Stock code changed');
  await call('natural-stock-unpause','admin','OfficialStockRegistryV1',stocks,'unpauseAsset',[state.stockUid]);
  const m=state.markets['ERC20-S1-H0-T500'];
  await call('unpaused-stake-approve','staker','ArbitrumActiveScenarioStock',state.stock,'approve',[vault,parseEther('1')]);
  await call('unpaused-stake','staker','AllocationManager',manager,'stake',[m.id,parseEther('1')]);
  check(await read('UserStockVault',vault,'allocation',[state.stockUid,accounts.staker.address,m.id])===parseEther('1'),'Unpaused stake not accepted');
  await call('unpaused-cleanup','staker','AllocationManager',manager,'rageQuit',[m.id]);
  const pending=await read('AllocationManager',manager,'rageQuitSettlementPending',[m.id,accounts.staker.address]);
  if(pending[0])await call('unpaused-cleanup-rewards','outsider','AllocationManager',manager,'settleRageQuitRewards',[m.id,accounts.staker.address]);
  record('natural-stock-unpause',{codeHash:code,newStakeAccepted:true,evidenceType:'MINED_TX_NATURAL_TIME'});
 }
 const r=state.rawExit;
 if(r&&!done('natural-raw-exit')&&(await c.getBlock()).timestamp>=BigInt(r.availableAt)){
  const m=Object.values(state.markets).find(m=>m.id===r.marketId);
  const before=await snapshot('natural-raw-exit',async()=>({balance:String(await balance(m.token,accounts.creator.address)),liability:String(await read('ProtocolFeeVault',fees,'creatorLiability',[m.id,1,m.token]))}));
  check(BigInt(before.liability)>0n,'Raw sample consumed');
  await call('natural-raw-exit','creator','ProtocolFeeVault',fees,'claimCreator',[m.id,1,m.token]);
  check(await balance(m.token,accounts.creator.address)===BigInt(before.balance)+BigInt(before.liability),'Raw exit paid wrong amount');
  check(await read('ProtocolFeeVault',fees,'creatorLiability',[m.id,1,m.token])===0n,'Raw debt remains');
  record('natural-raw-exit',{memeAmount:before.liability,evidenceType:'MINED_TX_NATURAL_TIME'});
 }
}
async function canonicalHolderDataset(m){
 const dir=out+'/roots/'+m.key;fs.mkdirSync(dir,{recursive:true});
 const epoch=await read('TreasuryDistributorV1',distributor,'epoch',[m.id,1]);
 const source=await c.getBlock({blockNumber:BigInt(epoch.sourceBlockNumber)});
 check(source.hash===epoch.sourceBlockHash,'Root source must match actual L2 RPC header');
 const market=await read('TreasuryDistributorV1',distributor,'market',[m.id]);
 const window=await read('TreasuryDistributorV1',distributor,'epochWindow',[m.id,1]);
 const excludedAccounts=await read('TreasuryDistributorV1',distributor,'feeSharingExcludedAccounts',[m.id]);
 const launch=state.transactions.find(t=>t.id==='launch-'+m.key);check(launch,'Missing token birth receipt');
 check(source.number>=BigInt(launch.blockNumber),'Source predates token birth');
 const transfers=[],ranges=[],headers=new Map();const event=artifact('TickerMemeTokenV1').abi.find(x=>x.type==='event'&&x.name==='Transfer');
 for(let from=BigInt(launch.blockNumber);from<=source.number;from+=2000n){
  const to=from+1999n<source.number?from+1999n:source.number;
  const logs=await c.getLogs({address:m.token,event,fromBlock:from,toBlock:to,strict:true});
  for(const log of logs){
   const k=String(log.blockNumber);if(!headers.has(k))headers.set(k,await c.getBlock({blockNumber:log.blockNumber}));
   const h=headers.get(k);check(h.hash===log.blockHash,'Transfer reorg');
   transfers.push({blockNumber:log.blockNumber,transactionIndex:log.transactionIndex,logIndex:log.logIndex,timestamp:h.timestamp,from:log.args.from,to:log.args.to,value:log.args.value});
  }
  ranges.push({from:String(from),to:String(to),logs:logs.length});
 }
 check((await c.getBlock({blockNumber:source.number})).hash===source.hash,'Source changed after full scan');
 const input={chainId:421614n,distributor,marketId:m.id,memeToken:m.token,quoteToken:m.quote,eligibilityPolicyHash:market.eligibilityPolicyHash,excludedAccounts,epochId:1,windowStart:BigInt(window[0]),windowEnd:BigInt(window[1]),sourceBlockNumber:source.number,sourceBlockHash:source.hash,sourceBlockTimestamp:source.timestamp,quoteAmount:BigInt(epoch.quoteAmount),transfers};
 const {generateTreasuryRoot}=await import('../services/backend-go/testsupport/treasury-reference.ts');
 const dataset=generateTreasuryRoot(input);
 const json=v=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?String(x):x,2)+'\n';
 fs.writeFileSync(dir+'/input.json',json(input));fs.writeFileSync(dir+'/typescript.json',json(dataset));fs.writeFileSync(dir+'/ranges.json',json({sourceHash:source.hash,ranges,headers:[...headers.values()],coverage:'ALL_TOKEN_TRANSFER_LOGS_FROM_BIRTH_TO_COMMITTED_L2_SOURCE'}));
 const {spawnSync}=await import('node:child_process');const go=spawnSync('go',['run','./cmd/treasury-worker','--input',path.resolve(dir+'/input.json')],{cwd:'services/backend-go',encoding:'utf8',maxBuffer:16*1024*1024});
 fs.writeFileSync(dir+'/go.stdout',go.stdout??'');fs.writeFileSync(dir+'/go.stderr',go.stderr??'');check(go.status===0,'Go holder calculation failed');
 const other=JSON.parse(go.stdout).dataset;check(other.merkleRoot.toLowerCase()===dataset.merkleRoot.toLowerCase()&&other.datasetHash.toLowerCase()===dataset.datasetHash.toLowerCase(),'Independent TS/Go mismatch');
 check(BigInt(other.totalTwab)===dataset.totalTwab&&BigInt(other.totalAllocated)===dataset.totalAllocated,'Independent TWAB/allocation mismatch');
 for(const leaf of dataset.leaves)check((await read('TreasuryDistributorV1',distributor,'claimLeaf',[m.id,1,BigInt(leaf.index),leaf.account,leaf.twab,leaf.amount])).toLowerCase()===leaf.leaf.toLowerCase(),'Contract leaf differs from independent services');
 return dataset;
}
async function naturalRoots(){
 state.roots??={};
 for(const m of Object.values(state.markets).filter(x=>x.holderFunded)){
  const k=m.key,root=state.roots[k]??={};save();if(root.published)continue;
  const now=(await c.getBlock()).timestamp;if(now<BigInt(m.epochWindow[1])+600n){console.log('WAIT root '+k);continue;}
  for(const asset of [m.token,m.quote]){
   const debt=await read('ProtocolFeeVault',fees,'holderLiability',[m.id,1,asset]);
   if(debt===0n)continue;
   if(asset===m.token)await call('root-clean-meme-'+k,'admin','ProtocolFeeVault',fees,'settleHolderRewards',[m.id,1,debt,1n,await deadline('root-clean-meme-'+k)]);
   else await call('root-clean-quote-'+k,'outsider','ProtocolFeeVault',fees,'fundHolderRewards',[m.id,1]);
  }
  const serviceFee=(await read('TreasuryDistributorV1',distributor,'rootServiceFee')).amount;
  await call('root-request-'+k,'creator','TreasuryDistributorV1',distributor,'requestRoot',[m.id,1],serviceFee);
  if(k==='ERC20-S0-H1-T0'&&!root.badRootCancelled){
   const original=await read('TreasuryDistributorV1',distributor,'epoch',[m.id,1]);
   const credit=await snapshot('bad-root-credit-'+k,async()=>({before:String(await read('TreasuryDistributorV1',distributor,'serviceCredit',[zero,accounts.creator.address])),quote:String(original.quoteAmount)}));
   await call('intentional-bad-root-'+k,'admin','TreasuryDistributorV1',distributor,'publishRoot',[m.id,1,hash('R6_INTENTIONAL_WRONG_ROOT'),hash('R6_INTENTIONAL_WRONG_DATASET'),1n,1,BigInt(credit.quote)]);
   await strictReject('outsider-cancel-root-'+k,'outsider','TreasuryDistributorV1',distributor,'cancelPendingRoot',[m.id,1,hash('R6_REVIEW_REJECT')],'AccessManagedUnauthorized');
   await call('review-cancel-bad-root-'+k,'admin','TreasuryDistributorV1',distributor,'cancelPendingRoot',[m.id,1,hash('R6_REVIEW_REJECT')]);
   check((await read('TreasuryDistributorV1',distributor,'epoch',[m.id,1])).status===0,'Cancelled root not reset');
   check(await read('TreasuryDistributorV1',distributor,'serviceCredit',[zero,accounts.creator.address])===BigInt(credit.before)+serviceFee,'Root cancellation refund credit mismatch');
   check(await read('TreasuryDistributorV1',distributor,'epochQuoteAmount',[m.id,1])===BigInt(credit.quote),'Root cancellation lost holder quote');
   root.badRootCancelled=true;save();record('bad-root-review-cancelled',{marketId:m.id,holderFundsPreserved:true,refundCredit:String(serviceFee),permissionlessFraudProof:false});
  }
  if(root.badRootCancelled)await call('correct-root-rerequest-'+k,'creator','TreasuryDistributorV1',distributor,'requestRoot',[m.id,1],serviceFee);
  const dataset=await canonicalHolderDataset(m);check(dataset.leafCount>=2,'Need two real holders');
  await call('root-publish-'+k,'admin','TreasuryDistributorV1',distributor,'publishRoot',[m.id,1,dataset.merkleRoot,dataset.datasetHash,dataset.totalTwab,dataset.leafCount,dataset.totalAllocated]);
  const epoch=await read('TreasuryDistributorV1',distributor,'epoch',[m.id,1]);
  if((await c.getBlock()).timestamp<BigInt(epoch.finalizeAfter))await strictReject('root-review-too-early-'+k,'outsider','TreasuryDistributorV1',distributor,'finalizeRoot',[m.id,1],'RootReviewPending');
  root.published=true;root.finalizeAfter=String(epoch.finalizeAfter);root.dataset=JSON.parse(JSON.stringify(dataset,(_,x)=>typeof x==='bigint'?String(x):x));save();
  record('canonical-root-published-'+k,{sourceBlockNumber:String(epoch.sourceBlockNumber),sourceBlockHash:epoch.sourceBlockHash,merkleRoot:dataset.merkleRoot,holders:dataset.leafCount,independentTSGoAndContractLeaf:true,continuousService:false});
 }
}
async function naturalClaims(){
 for(const [k,root]of Object.entries(state.roots??{})){
  if(!root.published||root.claimed||(await c.getBlock()).timestamp<BigInt(root.finalizeAfter))continue;
  const m=state.markets[k];await call('root-finalize-'+k,'outsider','TreasuryDistributorV1',distributor,'finalizeRoot',[m.id,1]);
  const epoch=await read('TreasuryDistributorV1',distributor,'epoch',[m.id,1]);root.claimUntil=String(epoch.claimUntil);save();
  const finalized=state.transactions.find(t=>t.id==='root-finalize-'+k);const finalizedBlock=await c.getBlock({blockNumber:BigInt(finalized.blockNumber)});
  check(BigInt(epoch.claimUntil)-finalizedBlock.timestamp===7200n,'Wrong real claim window');
  const leaves=root.dataset.leaves;const first=leaves[0];
  await strictReject('invalid-proof-'+k,'outsider','TreasuryDistributorV1',distributor,'claim',[m.id,1,BigInt(first.index),first.account,BigInt(first.twab),BigInt(first.amount)+1n,first.proof],'InvalidMerkleProof');
  const limit=k==='ERC20-S0-H1-T0'?leaves.length-1:leaves.length;
  for(const leaf of leaves.slice(0,limit)){
   const id='holder-claim-'+k+'-'+leaf.index;const before=await snapshot(id,async()=>({balance:String(await balance(m.quote,leaf.account))}));
   const payment=await call(id,'outsider','TreasuryDistributorV1',distributor,'claim',[m.id,1,BigInt(leaf.index),leaf.account,BigInt(leaf.twab),BigInt(leaf.amount),leaf.proof]);
   const recipientGas=m.quote===zero&&leaf.account.toLowerCase()===accounts.outsider.address.toLowerCase()?payment.gasUsed*payment.effectiveGasPrice:0n;
   check(await balance(m.quote,leaf.account)+recipientGas===BigInt(before.balance)+BigInt(leaf.amount),'Holder exact recipient delta');
   await strictReject('holder-repeat-'+k+'-'+leaf.index,'outsider','TreasuryDistributorV1',distributor,'claim',[m.id,1,BigInt(leaf.index),leaf.account,BigInt(leaf.twab),BigInt(leaf.amount),leaf.proof],'ClaimAlreadyConsumed');
  }
  root.unclaimed=leaves.slice(limit);root.claimed=true;save();record('holder-natural-claims-'+k,{paidLeaves:limit,remainingLeaves:root.unclaimed.length,claimUntil:root.claimUntil,evidenceType:'MINED_TX_NATURAL_TIME'});
 }
}
async function naturalRollover(){
 for(const [k,root]of Object.entries(state.roots??{})){
  if(!root.claimed||root.rolledOver)continue;const m=state.markets[k];const now=(await c.getBlock()).timestamp;
  if(now<=BigInt(root.claimUntil)){await strictReject('rollover-too-early-'+k,'outsider','TreasuryDistributorV1',distributor,'rolloverExpiredEpoch',[m.id,1],'EpochStillClaimable');continue;}
  for(const leaf of root.unclaimed)await strictReject('expired-proof-'+k,'outsider','TreasuryDistributorV1',distributor,'claim',[m.id,1,BigInt(leaf.index),leaf.account,BigInt(leaf.twab),BigInt(leaf.amount),leaf.proof],'ClaimWindowClosed');
  const before=await snapshot('rollover-'+k,async()=>({epoch:await read('TreasuryDistributorV1',distributor,'epoch',[m.id,1]),total:String(await read('TreasuryDistributorV1',distributor,'totalQuoteLiability',[m.quote]))}));
  const receipt=await call('rollover-'+k,'outsider','TreasuryDistributorV1',distributor,'rolloverExpiredEpoch',[m.id,1]);
  const event=receipt.logs.map(l=>{try{return decodeEventLog({abi:artifact('TreasuryDistributorV1').abi,data:l.data,topics:l.topics})}catch{return null}}).find(x=>x?.eventName==='EpochRemainderRolledOver');
  check(event&&event.args.amount===BigInt(before.epoch.quoteAmount)-BigInt(before.epoch.claimedAmount),'Rollover remainder mismatch');
  check(await read('TreasuryDistributorV1',distributor,'totalQuoteLiability',[m.quote])===BigInt(before.total),'Rollover changed total liability');
  root.rolledOver=true;save();record('natural-rollover-'+k,{amount:String(event.args.amount),toEpoch:String(event.args.toEpochId),evidenceType:'MINED_TX_NATURAL_TIME'});
 }
}
