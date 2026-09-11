import assert from 'node:assert/strict';
import { test } from 'node:test';
import { access } from 'node:fs/promises';
import { STAKING_ASSETS, stakingAssetForConfig, isListedStakingAsset } from '../src/create/staking-assets.ts';
import type { ConfigReadModel } from '../src/v1/readApi.ts';

const asset = STAKING_ASSETS[0]!;
const config = (overrides = {}) => ({id:asset.assetUid,kind:'asset',source:{chainId:46630,blockNumber:'1',blockHash:`0x${'2'.repeat(64)}`,transactionHash:`0x${'3'.repeat(64)}`,transactionIndex:0,logIndex:0},status:1,values:{stockToken:asset.tokenAddress},...overrides}) as ConfigReadModel;

test('staking catalog matches chain, address and UID, not a reused symbol', () => {
  assert.equal(stakingAssetForConfig(46630,config())?.symbol,'TSLA');
  assert.equal(isListedStakingAsset(46630,config()),true);
  assert.equal(isListedStakingAsset(4663,config()),false);
  assert.equal(isListedStakingAsset(46630,config({status:0})),false);
  assert.equal(isListedStakingAsset(46630,config({id:`0x${'0'.repeat(64)}`})),false);
  assert.equal(isListedStakingAsset(46630,config({values:{stockToken:`0x${'1'.repeat(40)}`,tokenSymbol:'TSLA'}})),false);
});

test('staking catalog identities are unique and local logos exist', async () => {
  const keys=new Set<string>();
  for(const entry of STAKING_ASSETS){
    const key=`${entry.chainId}:${entry.tokenAddress.toLowerCase()}`;
    assert.equal(keys.has(key),false);keys.add(key);
    assert.match(entry.tokenAddress,/^0x[0-9a-f]{40}$/);
    assert.match(entry.assetUid,/^0x[0-9a-f]{64}$/);
    assert.match(entry.logo,/^[a-z0-9-]+\.(svg|png)$/);
    assert.ok(Number.isInteger(entry.decimals)&&entry.decimals>=0&&entry.decimals<=255);
    await access(new URL(`../assets/quotes/${entry.logo}`,import.meta.url));
  }
});
