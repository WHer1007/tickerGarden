import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeAbiParameters, parseAbiParameters, type Address } from 'viem';
import { routes } from '../../packages/chain/src/quote-purchase/routes.ts';
import { purchaseRoute, quotePurchase, USDG, WETH, ZERO } from '../../packages/chain/src/quote-purchase/quote.ts';
import { purchaseRequest, PURCHASE_ROUTER } from '../../packages/chain/src/quote-purchase/transaction.ts';

const wallet = '0x1111111111111111111111111111111111111111' as Address;
const now = Date.now();
const quote = (token: Address, extra: Partial<Record<string, unknown>> = {}) => ({
  chainId: 4663 as const, token, amountOut: '1000', amountIn: '2000', stockInput: '1500',
  blockNumber: '123', expiresAt: now + 60_000, priceImpactBps: 0, ...extra,
});

test('the route catalog contains 192 stocks and USDG, and rejects unknown/SATS/BND', () => {
  assert.equal(Object.keys(routes).length, 192);
  assert.equal(purchaseRoute(USDG).input, WETH);
  for (const token of ['0x0000000000000000000000000000000000000003', 'SATS', 'BND'])
    assert.throws(() => purchaseRoute(token), /Unsupported paired asset/);
});

test('quote policy rejects zero, nonpositive, malformed and oversized amounts before RPC', async () => {
  for (const amount of ['0', '-1', '0x10', '01', '1'.repeat(40), (2n ** 128n).toString()])
    await assert.rejects(() => quotePurchase({ call: async () => 4663 } as any, Object.keys(routes)[0]!, amount), /Invalid purchase amount/);
});

test('direct ETH to V4 uses exact output, router-funded settlement, wallet take and refunds', () => {
  const token = '0x1cdad396db64bda184d5182a97dd9b3c62100b7d' as Address;
  const req = purchaseRequest(quote(token, { amountIn: '2000', stockInput: '2000' }), wallet, now);
  assert.equal(req.address, PURCHASE_ROUTER); assert.equal(req.value, 2000n);
  const commands = req.args[0]; const inputs = req.args[1] as readonly `0x${string}`[];
  assert.equal(commands, '0x1004'); assert.equal(inputs.length, 2);
  const [actions, params] = decodeAbiParameters(parseAbiParameters('bytes,bytes[]'), inputs[0]!);
  assert.equal(actions, '0x080b0e');
  const [swap] = decodeAbiParameters(parseAbiParameters('((address,address,uint24,int24,address),bool,uint128,uint128,uint256,bytes)'), params[0]!);
  assert.equal(swap[2], 1000n); assert.equal(swap[3], 2000n); assert.equal(swap[4], 0n);
  const settle = decodeAbiParameters(parseAbiParameters('address,uint256,bool'), params[1]!);
  assert.equal(String(settle[0]).toLowerCase(), ZERO); assert.equal(settle[1], 0n); assert.equal(settle[2], false);
  const take = decodeAbiParameters(parseAbiParameters('address,address,uint256'), params[2]!);
  assert.equal(String(take[0]).toLowerCase(), token); assert.equal(String(take[1]).toLowerCase(), wallet); assert.equal(take[2], 0n);
  const ethRefund = decodeAbiParameters(parseAbiParameters('address,address,uint256'), inputs[1]!);
  assert.equal(String(ethRefund[0]).toLowerCase(), ZERO); assert.equal(String(ethRefund[1]).toLowerCase(), wallet); assert.equal(ethRefund[2], 0n);
  assert.equal(req.args[0].includes('80'), false);
});

test('V3 direct WETH route wraps ETH and uses reverse path plus minHop array', () => {
  const token = '0x941ae714ec6d8130c7b75d67160ca08f1e7d11dd' as Address;
  const req = purchaseRequest(quote(token, { amountIn: '1500', stockInput: '1500' }), wallet, now);
  assert.equal(req.args[0], '0x0b010c04');
  const wrap = decodeAbiParameters(parseAbiParameters('address,uint256'), req.args[1][0]!);
  assert.equal(wrap[0], '0x0000000000000000000000000000000000000002');
  const [to, out, cap, path, payer, hops] = decodeAbiParameters(parseAbiParameters('address,uint256,uint256,bytes,bool,uint256[]'), req.args[1][1]!);
  assert.equal(to, wallet); assert.equal(out, 1000n); assert.equal(cap, 1500n); assert.equal(payer, false); assert.deepEqual(hops, [0n]);
  assert.equal(path.toLowerCase(), `0x${token.slice(2)}000bb80bd7d308f8e1639fab988df18a8011f41eacad73`.toLowerCase());
});

test('USDG two-leg route uses router-funded reversed V3 bridge and refunds USDG', () => {
  const token = '0xbbd09f72b025360fee5c928053dca6248d35be54' as Address;
  const req = purchaseRequest(quote(token), wallet, now);
  assert.equal(req.args[0], '0x0b0101040c04');
  const [, bridgeOut, bridgeCap, bridgePath, bridgePayer, bridgeHops] = decodeAbiParameters(parseAbiParameters('address,uint256,uint256,bytes,bool,uint256[]'), req.args[1][1]!);
  assert.equal(bridgeOut, 1500n); assert.equal(bridgeCap, 2000n); assert.equal(bridgePayer, false); assert.deepEqual(bridgeHops, [0n]);
  assert.equal(bridgePath.toLowerCase(), `0x${USDG.slice(2)}0000640bd7d308f8e1639fab988df18a8011f41eacad73`.toLowerCase());
  const [stockTo] = decodeAbiParameters(parseAbiParameters('address,uint256,uint256,bytes,bool,uint256[]'), req.args[1][2]!);
  assert.equal(stockTo, wallet);
  const [refundToken, refundRecipient, refundMin] = decodeAbiParameters(parseAbiParameters('address,address,uint256'), req.args[1][3]!);
  assert.equal(String(refundToken).toLowerCase(), USDG); assert.equal(String(refundRecipient).toLowerCase(), wallet); assert.equal(refundMin, 0n);
});

test('purchase request rejects bad chain, expiry, recipient and direct cap mismatch', () => {
  const token = Object.keys(routes)[0] as Address;
  assert.throws(() => purchaseRequest(quote(token, { chainId: 1 }), wallet, now), /expired or invalid/);
  assert.throws(() => purchaseRequest(quote(token, { expiresAt: now - 1 }), wallet, now), /expired or invalid/);
  assert.throws(() => purchaseRequest(quote(token), ZERO, now), /expired or invalid/);
  const direct = Object.entries(routes).find(([, r]) => r.input === ZERO)![0] as Address;
  assert.throws(() => purchaseRequest(quote(direct, { stockInput: '1001' }), wallet, now), /Invalid direct purchase/);
});
