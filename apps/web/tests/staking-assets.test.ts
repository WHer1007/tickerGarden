import assert from 'node:assert/strict';
import { test } from 'node:test';
import { access } from 'node:fs/promises';
import { STAKING_ASSETS, stakingAssetForConfig, isListedStakingAsset, stockTokenAddress } from '../src/create/staking-assets.ts';
import {getAddress} from 'viem';
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

test('staking catalog identities are unique and bundled logos exist', async () => {
  const keys=new Set<string>();
  for(const entry of STAKING_ASSETS){
    const key=`${entry.chainId}:${entry.tokenAddress.toLowerCase()}`;
    assert.equal(keys.has(key),false);keys.add(key);
    assert.match(entry.tokenAddress,/^0x[0-9a-f]{40}$/);
    assert.match(entry.assetUid,/^0x[0-9a-f]{64}$/);
    if(entry.logo) assert.match(entry.logo,/^[a-z0-9-]+\.(svg|png)$/);
    else if(entry.chainId===56){assert.match(entry.logoUrl!, /^\/(stock-logos|company-logos)\/[a-z0-9]+\.png$/);await access(new URL(`../public${entry.logoUrl}`,import.meta.url));}
    else { assert.match(entry.logoUrl!, /^\/stock-logos\/0x[0-9a-f]{40}\.png$/); await access(new URL(`../public${entry.logoUrl}`,import.meta.url)); }
    assert.ok(Number.isInteger(entry.decimals)&&entry.decimals>=0&&entry.decimals<=255);
    if(entry.logo) await access(new URL(`../assets/quotes/${entry.logo}`,import.meta.url));
  }
});

test('production lists all 194 official assets with 0.5 minimum total stake',()=>{
 const mainnet=STAKING_ASSETS.filter(a=>a.chainId===4663);assert.equal(mainnet.length,194);assert.equal(STAKING_ASSETS.filter(a=>a.chainId===46630).length,5);
 for(const a of mainnet){assert.equal(a.minimumAllocation,'500000000000000000');assert.equal(a.enabled,true);const c=config({id:a.assetUid,values:{stockToken:a.tokenAddress}});assert.equal(isListedStakingAsset(4663,c),true);assert.equal(isListedStakingAsset(4663,{...c,status:2}),false);}
});

test('BSC keeps 78 asset identities and opens 77 with the production minimum',()=>{const rows=STAKING_ASSETS.filter(a=>a.chainId===56);assert.equal(rows.length,78);assert.equal(rows.filter(a=>a.enabled).length,77);assert.ok(rows.every(a=>a.minimumAllocation==='500000000000000000'));assert.deepEqual(rows.filter(a=>!a.enabled).map(a=>a.symbol),['GPROB']);});

test('TBULL Explore stock identity accepts the checksum address returned by the production bootstrap',()=>{
 const c=config({id:'0x962d12a104378c952e72340f6289a88d5e7317c4c658f49b16986d1a7046689a',values:{stockToken:'0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436'}});
 assert.equal(stockTokenAddress(c),'0x02fca66c1d1afb4e2a7884261eb00f63598a7436');
 assert.equal(stakingAssetForConfig(56,c)?.symbol,'NVDAB');
 assert.equal(stakingAssetForConfig(4663,c),undefined);
});

test('checksum and lowercase registry addresses map every catalog entry without changing admission',()=>{
 for(const asset of STAKING_ASSETS){
  const c=config({id:asset.assetUid,values:{stockToken:getAddress(asset.tokenAddress)}});
  assert.equal(stockTokenAddress(c),asset.tokenAddress);
  assert.equal(stakingAssetForConfig(asset.chainId,c)?.symbol,asset.symbol);
  assert.equal(isListedStakingAsset(asset.chainId,c),asset.enabled);
  assert.equal(isListedStakingAsset(asset.chainId,{...c,status:2}),false);
 }
});

test('missing or malformed stock addresses remain unavailable instead of inventing an identity',()=>{
 for(const value of [undefined,null,123,{},'','0x1234','0x'+'g'.repeat(40),' '+asset.tokenAddress]){
  const c=config({values:{stockToken:value}});
  assert.equal(stockTokenAddress(c),null);assert.equal(stakingAssetForConfig(46630,c),undefined);
 }
});
