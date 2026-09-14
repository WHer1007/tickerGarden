import assert from 'node:assert/strict';import test from 'node:test';
import {allocatedFeeTotals,validateStakePositions,stakeHistoryEvent,stakeAfter,showStakePortfolioEmpty,stakeDirectorySource,stakePortfolioMode,stakeMarketIsOpen,firstActiveStakeMarket,summarizeDirectStakeAllocations,unstakeConfirmationCopy} from '../src/v1/stakingView.ts';
import type {TokenDetailFee,UserActivityRecord,UserPositionReadModel} from '../src/v1/generated/read-api.ts';
const address=('0x'+'1'.repeat(40)) as `0x${string}`,market=('0x'+'2'.repeat(64)) as `0x${string}`,asset=('0x'+'3'.repeat(64)) as `0x${string}`;
const source={chainId:46630 as const,blockNumber:'10',blockHash:('0x'+'4'.repeat(64)) as `0x${string}`,transactionHash:('0x'+'5'.repeat(64)) as `0x${string}`,transactionIndex:1,logIndex:2};
const position={user:address,marketId:market,assetUid:asset,free:'3',allocated:'12',active:'10',pending:'2',activationAt:'7',unlockAt:'100',claimable:[{kind:'quote' as const,asset:address,amount:'4'},{kind:'meme' as const,asset:('0x'+'6'.repeat(40)) as `0x${string}`,amount:'5'}],source} satisfies UserPositionReadModel;
test('fees remain asset separated and unavailable does not become zero',()=>{assert.equal(allocatedFeeTotals(null),null);const rows=[{asset:address,amountRaw:'9007199254740993000',recipient:'creator'},{asset:address,amountRaw:'3',recipient:'holders'},{asset:'0x'+'4'.repeat(40),amountRaw:'5',recipient:'stakers'}] as TokenDetailFee[];const sums=allocatedFeeTotals(rows)!;assert.equal(sums.size,2);assert.equal(sums.get(address),9007199254740993003n);});
test('stake history requires position owner and known event signature',()=>{const e={signature:'AllocationReleased(bytes32,address,bytes32,uint256,uint256,uint256)',arguments:{user:address,marketId:market,assetUid:asset,userMarketAllocation:'0'}} as unknown as UserActivityRecord;assert.equal(stakeHistoryEvent(e,address)?.exited,true);assert.equal(stakeHistoryEvent(e,'0x'+'5'.repeat(40)),null);assert.equal(stakeHistoryEvent({...e,signature:'Transfer(address,address,uint256)'},address),null);});
test('unstake confirmation explains every user-visible consequence',()=>{const copy=unstakeConfirmationCopy({principal:'12.5',assetSymbol:'TSLA',marketSymbol:'GARDEN'});assert.match(copy.intro,/entire GARDEN/);assert.match(copy.effects.join(' '),/12\.5 TSLA.*connected wallet/);assert.match(copy.effects.join(' '),/All active and pending stake will be withdrawn.*no longer earn rewards/);assert.match(copy.effects.join(' '),/rewards.*claimed separately/);assert.match(copy.note,/Partial withdrawal is not supported.*new 24-hour lock/);});
test('position display rejects another account and inconsistent amounts',()=>{const p=position;assert.equal(validateStakePositions([p],address,46630).length,1);assert.throws(()=>validateStakePositions([{...p,allocated:'15'}],address,46630));assert.throws(()=>validateStakePositions([p],'0x'+'4'.repeat(40),46630));assert.equal(stakeAfter(25n,10n),35n);assert.equal(stakeAfter(25n,null),null);});
test('position pages reject a market already committed by an earlier page',()=>{assert.throws(()=>validateStakePositions([position],address,46630,new Set([market])),/identity mismatch/);});
test('empty portfolio waits for authoritative indexed or local verification',()=>{
  const base={walletConnected:true,busy:false,hasActive:false,marketOpen:false};
  assert.equal(showStakePortfolioEmpty({...base,indexedComplete:true,directVerified:false}),true);
  assert.equal(showStakePortfolioEmpty({...base,indexedComplete:false,directVerified:true}),true);
  assert.equal(showStakePortfolioEmpty({...base,indexedComplete:false,directVerified:false}),false);
  assert.equal(showStakePortfolioEmpty({...base,indexedComplete:true,directVerified:false,hasActive:true}),false);
  assert.equal(showStakePortfolioEmpty({...base,indexedComplete:true,directVerified:false,marketOpen:true}),false);
  assert.equal(stakeMarketIsOpen(true,false),false,'a stale or URL-restored selection must not suppress the empty state');
  assert.equal(stakeMarketIsOpen(true,true),true,'an explicit market choice opens staking controls');
});
test('direct stake discovery treats verified zero allocations as an empty portfolio',()=>{
  const zero=summarizeDirectStakeAllocations([{marketId:market,assetUid:asset,allocated:0n}]);
  assert.equal(zero.verified,true);assert.deepEqual(zero.active,[]);
  const active=summarizeDirectStakeAllocations([{marketId:market,assetUid:asset,allocated:100n}]);
  assert.equal(active.verified,true);assert.deepEqual(active.active,[{marketId:market,assetUid:asset,allocated:100n}]);
  const incomplete=summarizeDirectStakeAllocations([null,{marketId:market,assetUid:asset,allocated:0n}]);
  assert.equal(incomplete.verified,false,'a failed canonical allocation read must not be reported as empty');
  assert.throws(()=>summarizeDirectStakeAllocations([{marketId:market,assetUid:asset,allocated:-1n}]));
});
test('stake portfolio state never falls through to blank operation cards',()=>{
  const base={busy:false,verified:false,failed:false,hasActive:false,marketOpen:false};
  assert.equal(stakePortfolioMode({...base,walletConnected:false}),'connect');
  assert.equal(stakePortfolioMode({...base,walletConnected:true,busy:true}),'checking');
  assert.equal(stakePortfolioMode({...base,walletConnected:true,verified:true}),'empty');
  assert.equal(stakePortfolioMode({...base,walletConnected:true,failed:true}),'unavailable');
  assert.equal(stakePortfolioMode({...base,walletConnected:true,hasActive:true}),'content');
  assert.equal(stakePortfolioMode({...base,walletConnected:true,marketOpen:true}),'content');
});
test('local direct staking takes priority over a metadata service URL',()=>{
  assert.equal(stakeDirectorySource({direct:true,readApiAvailable:true}),'direct');
  assert.equal(stakeDirectorySource({direct:false,readApiAvailable:true}),'indexed');
  assert.equal(stakeDirectorySource({direct:false,readApiAvailable:false}),'unavailable');
});
test('the first active stake is focused only when no market is selected',()=>{
  const other=('0x'+'7'.repeat(64));
  const rows=[{marketId:other,active:false},{marketId:market,active:true},{marketId:asset,active:true}];
  assert.equal(firstActiveStakeMarket(rows,''),market);
  assert.equal(firstActiveStakeMarket(rows.map(row=>({...row,active:false})),''),null);
  assert.equal(firstActiveStakeMarket(rows,other),null);
});
test('position display rejects duplicate markets and malformed raw amounts',()=>{
  const p=position;
  assert.throws(()=>validateStakePositions([p,p],address,46630));
  assert.throws(()=>validateStakePositions([{...p,active:'1e1'}],address,46630));
  assert.throws(()=>validateStakePositions([p],address,4663));
});
test('position display validates free, claimable, timestamps and source against the page snapshot',()=>{
  assert.equal(validateStakePositions([position],address,46630,new Set(),{blockNumber:'10',blockHash:source.blockHash}).length,1);
  assert.throws(()=>validateStakePositions([{...position,free:'-1'}],address,46630),/amount invalid/);
  assert.throws(()=>validateStakePositions([{...position,activationAt:'1e3'}],address,46630),/timestamp invalid/);
  assert.throws(()=>validateStakePositions([{...position,claimable:[position.claimable[1],position.claimable[0]] as unknown as UserPositionReadModel['claimable']}],address,46630),/claimable unavailable/);
  assert.throws(()=>validateStakePositions([{...position,claimable:[{...position.claimable[0],amount:'-1'},position.claimable[1]]}],address,46630),/claimable invalid/);
  assert.throws(()=>validateStakePositions([{...position,source:{...source,transactionHash:'bad' as `0x${string}`}}],address,46630),/source invalid/);
  assert.throws(()=>validateStakePositions([position],address,46630,new Set(),{blockNumber:'9',blockHash:source.blockHash}),/exceeds snapshot/);
  assert.throws(()=>validateStakePositions([position],address,46630,new Set(),{blockNumber:'10',blockHash:('0x'+'7'.repeat(64)) as `0x${string}`}),/exceeds snapshot/);
});
