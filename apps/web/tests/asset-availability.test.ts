import assert from 'node:assert/strict';
import test from 'node:test';
import {assertFrontendAssetOpen,isFrontendAssetOpen} from '../src/chains/asset-availability.ts';
import {bscPairedRelease,bscStakingAssets} from '../src/chains/bsc/generated.ts';
import {activePairedConfig,isQuoteSelectionPaused,pairedAssetsForChain} from '../src/create/paired-assets.ts';
import {isListedStakingAsset,stakingAssetForConfig} from '../src/create/staking-assets.ts';
import type {ConfigReadModel} from '../src/v1/readApi.ts';

const quote=bscPairedRelease.assets.find(a=>a.symbol==='GPROB')!;
const stake=bscStakingAssets.find(a=>a.symbol==='GPROB')!;
// The shared RH transport type is reused by the BSC chain adapter.
const source:ConfigReadModel['source']={chainId:56 as ConfigReadModel['source']['chainId'],blockNumber:'1',blockHash:`0x${'2'.repeat(64)}`,transactionHash:`0x${'3'.repeat(64)}`,transactionIndex:0,logIndex:0};

test('GPROB listing is scoped to its BSC address and does not affect RH',()=>{
  assert.equal(isFrontendAssetOpen(56,quote.tokenAddress.toUpperCase()),false);
  assert.throws(()=>assertFrontendAssetOpen(56,quote.tokenAddress),/not available/);
  for(const chain of [4663,46630,97])assert.doesNotThrow(()=>assertFrontendAssetOpen(chain,quote.tokenAddress));
  for(const asset of bscPairedRelease.assets.filter(a=>a.symbol!=='GPROB'))assert.equal(isFrontendAssetOpen(56,asset.tokenAddress),true);
});

test('GPROB is absent from Quote choices and stale active registry input cannot restore it',()=>{
  const available=pairedAssetsForChain(56);assert.equal(available.length,80);
  assert.equal(available.some(a=>a.tokenAddress===quote.tokenAddress),false);
  const config:ConfigReadModel={source,kind:'quote',id:`0x${'1'.repeat(64)}`,status:1,values:{quoteAsset:quote.tokenAddress,quoteDecimals:quote.decimals,phantomQuote:quote.phantomQuote,graduationThreshold:quote.graduationThreshold}};
  assert.equal(activePairedConfig({...quote,symbol:'NVDAB'},[config],56),undefined);
  assert.equal(isQuoteSelectionPaused(quote),true);
});

test('GPROB cannot be selected for new stake while its existing position identity remains readable',()=>{
  const config:ConfigReadModel={source,kind:'asset',id:stake.assetUid,status:1,values:{stockToken:stake.tokenAddress}};
  assert.equal(isListedStakingAsset(56,config),false);
  assert.equal(stakingAssetForConfig(56,config)?.symbol,'GPROB');
  assert.equal(stakingAssetForConfig(56,config)?.minimumAllocation,'500000000000000000');
  assert.equal(bscStakingAssets.length,78);assert.equal(bscPairedRelease.assets.length,81);
});
