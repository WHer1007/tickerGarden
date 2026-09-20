import assert from 'node:assert/strict';
import test from 'node:test';
import { RpcTransport } from '../../packages/chain/src/index.ts';
import { displayPoolPrice, observeF72Market, type MarketCreation } from '../../packages/market-projector/src/index.ts';

const hash = (character: string): `0x${string}` => `0x${character.repeat(64)}`;
const address = (character: string): `0x${string}` => `0x${character.repeat(40)}`;

function fixedResult(result: string): typeof fetch {
  return async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { id: number; method: string };
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: request.method==='eth_getBlockByNumber'?{number:'0xa',hash:hash('9'),parentHash:hash('8'),timestamp:'0x64'}:result }), { headers: { 'content-type': 'application/json' } });
  };
}

test('market observation rejects provider disagreement before decoding state', async () => {
  const creation: MarketCreation = {
    marketId: hash('1'), assetUid: hash('2'), memeToken: address('3'), curve: address('4'), gauge: address('5'),
    quoteAsset: address('0'), quoteAssetConfigId: hash('6'), tickerGardenBaselineId: hash('7'), expectedEconomics: hash('8'),
    source: { chainId: 46630, blockNumber: '10', blockHash: hash('9'), transactionHash: hash('a'), transactionIndex: 0, logIndex: 1 },
  };
  await assert.rejects(observeF72Market({
    creation, blockNumber: 10n, blockHash: hash('9'), blockTimestamp: 100n,
    primary: new RpcTransport({ url: 'https://primary.example', fetch: fixedResult('0x') }),
    secondary: new RpcTransport({ url: 'https://secondary.example', fetch: fixedResult('0x00') }),
  }), /providers disagree on market/);
});


test('display pool price normalizes orientation and token decimals without floating point', () => {
  const q96 = 1n << 96n;
  assert.equal(displayPoolPrice(q96, true, 18), '1');
  assert.equal(displayPoolPrice(2n*q96, true, 18), '4');
  assert.equal(displayPoolPrice(2n*q96, false, 18), '0.25');
  assert.equal(displayPoolPrice(q96, true, 6), '1000000000000');
  assert.equal(displayPoolPrice(0n, true, 18), null);
});
