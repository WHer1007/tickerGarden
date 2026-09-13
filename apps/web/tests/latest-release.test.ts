import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { encodeFunctionData } from 'viem';
import { currentV4Abis } from '../src/v1/generated/abis.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const release = JSON.parse(readFileSync(`${root}deployments/releases/0x685b5c20e826f4ddd076b61216c7529a967322082925c4741469b0fda837a7f2/frontend-bootstrap.json`, 'utf8'));
const integration = JSON.parse(readFileSync(`${root}apps/web/public/integration/rh-685b5c20.json`, 'utf8'));

test('latest RH testnet release matches frontend integration catalog', () => {
  assert.equal(release.chainId, 46630);
  assert.equal(integration.chainId, release.chainId);
  assert.equal(integration.factory.toLowerCase(), release.factory.toLowerCase());
  for (const key of ['officialStockRegistry','approvedQuoteRegistry','tickerGardenBaselineRegistry','launchTemplateRegistry','marketRegistry','protocolFeeVault','allocationManager','launchRouter']) {
    assert.equal(integration.bindings[key].toLowerCase(), release.bindings[key].toLowerCase(), key);
  }
  assert.deepEqual(integration.assets, []);
  const quote = release.configs.find((x: any) => x.kind === 'quote');
  const baseline = release.configs.find((x: any) => x.kind === 'baseline');
  const template = release.configs.find((x: any) => x.kind === 'template');
  const iQuote = integration.configs.find((x: any) => x.kind === 'quote');
  const iBaseline = integration.configs.find((x: any) => x.kind === 'baseline');
  const iTemplate = integration.configs.find((x: any) => x.kind === 'template');
  assert.equal(iQuote.id, quote.id);
  assert.equal(iBaseline.id, baseline.id);
  assert.equal(iTemplate.id, template.id);
  assert.equal(quote.values.quoteAsset, '0x0000000000000000000000000000000000000000');
  assert.equal(quote.values.symbol, 'ETH');
  assert.equal(quote.values.phantomQuote, '168000000000000000');
  assert.equal(quote.values.graduationThreshold, '420000000000000000');
  assert.equal(integration.launchFee, release.launchFee);
});

test('current burnMemeFees creation path encodes with V4 ABI', () => {
  const abi = currentV4Abis.LaunchAndBuyRouter;
  const params = {
    assetUid: `0x${'11'.repeat(32)}`, tickerGardenBaselineId: `0x${'22'.repeat(32)}`, quoteAssetConfigId: `0x${'33'.repeat(32)}`,
    launchTemplateId: `0x${'44'.repeat(32)}`, expectedEconomics: `0x${'55'.repeat(32)}`, creatorRevenueBeneficiary: '0x0000000000000000000000000000000000000001',
    name: 'Name', symbol: 'MEME', metadataURI: 'ipfs://metadata', salt: `0x${'66'.repeat(32)}`, creatorTaxBps: 25, creatorFeesToHolders: true, stakingEnabled: true, burnMemeFees: true,
  } as const;
  const data = encodeFunctionData({ abi, functionName: 'launchAndBuy', args: [params, 1n, 1n, '0x0000000000000000000000000000000000000001'] });
  assert.match(data, /^0x[0-9a-f]+$/);
});
