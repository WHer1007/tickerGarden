import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activePairedConfig, pairedAssetsForChain, RELEASE_PAIRED_ASSETS, releasePairForSelection } from '../src/create/paired-assets.ts';
import { quoteIconFilename } from '../src/create/quote-icon-names.ts';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { ConfigReadModel } from '../src/v1/readApi.ts';
const eth = RELEASE_PAIRED_ASSETS.find(asset => asset.symbol === 'ETH')!;
function config(overrides = {}): ConfigReadModel {
  return { id: `0x${'1'.repeat(64)}`,kind:'quote',status:1,source:{chainId:4663,blockNumber:'1',blockHash:`0x${'2'.repeat(64)}`,transactionHash:`0x${'3'.repeat(64)}`,transactionIndex:0,logIndex:0},values:{quoteAsset:eth.tokenAddress,quoteDecimals:18,phantomQuote:eth.phantomQuote,graduationThreshold:eth.graduationThreshold}, ...overrides } as ConfigReadModel;
}
test('release mirrors observed asset universe, including quote decimal differences', () => {
  assert.equal(RELEASE_PAIRED_ASSETS.length, 56);
  assert.equal(new Set(RELEASE_PAIRED_ASSETS.map(a=>a.tokenAddress)).size, 56);
  assert.equal(RELEASE_PAIRED_ASSETS.find(a=>a.symbol==='USDG')?.decimals,6);
  assert.equal(RELEASE_PAIRED_ASSETS.find(a=>a.symbol==='cbBTC')?.decimals,8);
  assert.equal(RELEASE_PAIRED_ASSETS.find(a=>a.symbol==='WETH'),undefined);
  assert.equal(new Set(RELEASE_PAIRED_ASSETS.map(a=>a.activationStatus)).size, 1);
  assert.equal(RELEASE_PAIRED_ASSETS.every(a=>a.activationStatus === 'REGISTRY_ACTIVATION_REQUIRED'), true);
  assert.equal(new Set(RELEASE_PAIRED_ASSETS.map(a=>a.admissionPath)).size, 1);
  assert.equal(RELEASE_PAIRED_ASSETS.every(a=>a.admissionPath === 'ADMIN_REVIEWED_WHITELIST'), true);
});
test('every release paired asset has a local logo icon', async () => {
  await Promise.all(RELEASE_PAIRED_ASSETS.map(asset => access(fileURLToPath(new URL(`../assets/quotes/${quoteIconFilename(asset.symbol)}`, import.meta.url)))));
});
test('release candidates never imply an active quote or cross-network address reuse', () => {
  assert.equal(activePairedConfig(eth,[],4663),undefined);
  assert.equal(activePairedConfig(eth,[config()],46630),undefined);
  assert.equal(activePairedConfig(eth,[config({status:2})],4663),undefined);
  assert.equal(activePairedConfig(eth,[config()],4663)?.id,config().id);
  assert.equal(activePairedConfig(eth,[config({values:{...config().values,graduationThreshold:'1'}})],4663),undefined);
  assert.equal(releasePairForSelection('pending:USDG',[])?.symbol,'USDG');
  assert.equal(releasePairForSelection(config().id,[config()])?.symbol,'ETH');
});
test('Arbitrum Sepolia selection exposes only its native ETH release row', () => {
  const assets = pairedAssetsForChain(421614);
  assert.equal(assets.length, 1);
  assert.equal(assets[0]?.symbol, 'ETH');
  assert.equal(assets[0]?.chainId, 421614);
  assert.equal(assets[0]?.activationStatus, 'REGISTRY_ACTIVE');
  assert.equal(assets[0]?.admissionPath, 'ADMIN_REVIEWED_WHITELIST');
  assert.equal(assets[0]?.tokenAddress, '0x0000000000000000000000000000000000000000');
  assert.equal(pairedAssetsForChain(4663).length, RELEASE_PAIRED_ASSETS.length);
});
test('Robinhood testnet selection exposes only its activated canonical assets', () => {
  const testnet = pairedAssetsForChain(46630);
  assert.deepEqual(testnet.map(asset => asset.symbol), ['ETH','USDG','TSLA','AMZN','PLTR','NFLX','AMD']);
  assert.equal(testnet.every(asset => asset.chainId === 46630 && asset.activationStatus === 'REGISTRY_ACTIVE'), true);
  assert.deepEqual(Object.fromEntries(testnet.map(asset => [asset.symbol, asset.tokenAddress])), {
    ETH: '0x0000000000000000000000000000000000000000',
    USDG: '0x7e955252e15c84f5768b83c41a71f9eba181802f',
    TSLA: '0xc9f9c86933092bbbfff3ccb4b105a4a94bf3bd4e',
    AMZN: '0x5884ad2f920c162cfbbacc88c9c51aa75ec09e02',
    PLTR: '0x1fbe1a0e43594b3455993b5de5fd0a7a266298d0',
    NFLX: '0x3b8262a63d25f0477c4dde23f83cfe22cb768c93',
    AMD: '0x71178bac73cbeb415514eb542a8995b82669778d',
  });
  assert.equal(testnet.some(asset => ['NVDA','AAPL'].includes(asset.symbol)), false);
  assert.notEqual(testnet, pairedAssetsForChain(4663));
});
