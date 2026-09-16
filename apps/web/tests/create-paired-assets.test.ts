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
  assert.equal(RELEASE_PAIRED_ASSETS.length, 196);
  assert.equal(new Set(RELEASE_PAIRED_ASSETS.map(a=>a.tokenAddress)).size, 196);
  assert.equal(RELEASE_PAIRED_ASSETS.find(a=>a.symbol==='USDG')?.decimals,6);
  assert.equal(RELEASE_PAIRED_ASSETS.find(a=>a.symbol==='cbBTC'),undefined);
  assert.equal(RELEASE_PAIRED_ASSETS.find(a=>a.symbol==='WETH'),undefined);
  assert.equal(new Set(RELEASE_PAIRED_ASSETS.map(a=>a.activationStatus)).size, 1);
  assert.equal(RELEASE_PAIRED_ASSETS.filter(a=>a.activationStatus === 'PARAMETERS_PENDING').length, 0);
  assert.equal(eth.graduationThreshold, '3000000000000000000');
  assert.equal(new Set(RELEASE_PAIRED_ASSETS.map(a=>a.admissionPath)).size, 1);
  assert.equal(RELEASE_PAIRED_ASSETS.every(a=>a.admissionPath === 'ADMIN_REVIEWED_WHITELIST'), true);
});
test('every release paired asset has a local or official logo icon', async () => {
  await Promise.all(RELEASE_PAIRED_ASSETS.map(async asset => {
    try { await access(fileURLToPath(new URL(`../assets/quotes/${quoteIconFilename(asset.symbol)}`, import.meta.url))); }
    catch { assert.ok(asset.logoUrl); assert.equal(new URL(asset.logoUrl!).hostname, 'cdn.robinhood.com'); }
  }));
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
  assert.deepEqual(testnet.map(asset => asset.symbol), ['ETH']);
  assert.equal(testnet.every(asset => asset.chainId === 46630 && asset.activationStatus === 'REGISTRY_ACTIVE'), true);
  assert.deepEqual(Object.fromEntries(testnet.map(asset => [asset.symbol, asset.tokenAddress])), { ETH: '0x0000000000000000000000000000000000000000' });
  assert.equal(testnet.some(asset => ['NVDA','AAPL'].includes(asset.symbol)), false);
  assert.notEqual(testnet, pairedAssetsForChain(4663));
});

test('pending production thresholds cannot match even an active database config', () => {
  const pending = pairedAssetsForChain(4663).filter(a => a.graduationThreshold === null);
  assert.equal(pending.length, 0);
  for (const asset of pending) {
    const old = config({values: {quoteAsset:asset.tokenAddress,quoteDecimals:asset.decimals,phantomQuote:asset.phantomQuote,graduationThreshold:'100'}});
    assert.equal(activePairedConfig(asset,[old],4663),undefined);
  }
});
