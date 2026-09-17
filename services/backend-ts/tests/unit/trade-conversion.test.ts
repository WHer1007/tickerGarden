import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeFunctionData, parseAbi, type Address, type Hex } from 'viem';
import {
  ALLOWANCE_HOLDER, TRADE_NATIVE, TRADE_USDG, assertConversionIntent,
  conversionRequest, getConversionQuote, preserveConversionMinimum, providerToken, type ConversionIntent, type ConversionQuote,
} from '../../packages/chain/src/quote-purchase/zeroex.ts';

const wallet = '0x1111111111111111111111111111111111111111' as Address;
const stock = '0x2222222222222222222222222222222222222222' as Address;
const other = '0x3333333333333333333333333333333333333333' as Address;
const holderAbi = parseAbi(['function exec(address operator,address token,uint256 amount,address target,bytes data) payable returns (bytes)']);
const settlerAbi = parseAbi(['function execute((address recipient,address buyToken,uint256 minAmountOut) slippage,bytes[] actions,bytes32 zid) payable returns (bool)']);

function intent(sellToken: Address = TRADE_NATIVE, buyToken: Address = TRADE_USDG, sellAmount = '1000'): ConversionIntent {
  return { chainId: 4663, sellToken, buyToken, sellAmount, taker: wallet };
}

function quote(i = intent(), changes: Partial<ConversionQuote> = {}, minBuyAmount = '900', buyAmount = minBuyAmount): ConversionQuote {
  const settle = encodeFunctionData({ abi: settlerAbi, functionName: 'execute', args: [{ recipient: wallet, buyToken: providerToken(i.buyToken) as Address, minAmountOut: BigInt(minBuyAmount) }, [], `0x${'00'.repeat(32)}` as Hex] });
  // AllowanceHolder uses the canonical zero address for the ETH sell token,
  // while 0x quote parameters use its 0xeeee sentinel.
  const holderSellToken = i.sellToken.toLowerCase() === TRADE_NATIVE ? TRADE_NATIVE : i.sellToken;
  const txData = encodeFunctionData({ abi: holderAbi, functionName: 'exec', args: [ALLOWANCE_HOLDER, holderSellToken, BigInt(i.sellAmount), ALLOWANCE_HOLDER, settle] });
  return {
    ...i, buyAmount, minBuyAmount, expiresAt: Date.now() + 20_000,
    transaction: { to: ALLOWANCE_HOLDER, data: txData, value: i.sellToken === TRADE_NATIVE ? i.sellAmount : '0' },
    providerFee: null, ...changes,
  };
}

test('conversion intent allows ETH and USDG buys to USDG, ETH and supported stock outputs', () => {
  for (const pair of [[TRADE_NATIVE, TRADE_USDG], [TRADE_USDG, TRADE_NATIVE], [TRADE_USDG, stock]] as const)
    assert.doesNotThrow(() => assertConversionIntent(intent(pair[0], pair[1])));
});

test('conversion intent rejects unsupported chain, sells, self trades, zero addresses and zero amount', () => {
  const bad: ConversionIntent[] = [
    { ...intent(), chainId: 1 },
    intent(stock, TRADE_USDG),
    intent(TRADE_NATIVE, TRADE_NATIVE),
    intent(TRADE_USDG, TRADE_USDG),
    intent(TRADE_NATIVE, TRADE_USDG, '0'),
    { ...intent(), taker: TRADE_NATIVE },
  ];
  for (const value of bad) assert.throws(() => assertConversionIntent(value), /Invalid conversion request/);
});

test('synthetic AllowanceHolder exec encloses settler execute and returns an executor request', () => {
  const i = intent();
  const result = conversionRequest(quote(i), i);
  assert.equal(result.address, ALLOWANCE_HOLDER);
  assert.equal(result.functionName, 'exec');
  assert.equal(result.value, 1000n);
  assert.equal(result.args[0].toLowerCase(), ALLOWANCE_HOLDER.toLowerCase());
  assert.equal(result.args[1], TRADE_NATIVE);
  assert.equal(result.args[2], 1000n);
  assert.equal(result.args[3].toLowerCase(), ALLOWANCE_HOLDER.toLowerCase());
});

test('valid USDG to ETH and USDG to stock quotes use zero native value', () => {
  for (const i of [intent(TRADE_USDG, TRADE_NATIVE), intent(TRADE_USDG, stock)]) {
    const result = conversionRequest(quote(i), i);
    assert.equal(result.value, 0n);
  }
});

test('conversion accepts the approved 99% minimum, rejects below 99% or above the buy amount, and keeps the fixed sell amount', () => {
  const i = intent(TRADE_USDG, TRADE_NATIVE, '123456');
  const atFloor = quote(i, {}, '990', '1000');
  const request = conversionRequest(atFloor, i);
  assert.equal(request.args[2], 123456n);
  assert.throws(() => conversionRequest(quote(i, {}, '989', '1000'), i), /Conversion quote does not match/);
  assert.throws(() => conversionRequest(quote(i, {}, '1001', '1000'), i), /Conversion quote does not match/);
});

test('refresh tightens to the reviewed minimum without changing sell amount and keeps a stronger improved-price floor', () => {
  const i = intent(TRADE_USDG, TRADE_NATIVE, '123456');
  const reviewed = quote(i, {}, '990', '1000');

  const refreshed = preserveConversionMinimum(quote(i, {}, '985', '995'), reviewed);
  assert.equal(refreshed.buyAmount, '995');
  assert.equal(refreshed.minBuyAmount, '990');
  assert.equal(refreshed.sellAmount, '123456');
  assert.equal(conversionRequest(refreshed, i).args[2], 123456n);

  assert.throws(() => preserveConversionMinimum(quote(i, {}, '979', '989'), reviewed), /confirmed conversion minimum/);

  const improved = preserveConversionMinimum(quote(i, {}, '1089', '1100'), reviewed);
  assert.equal(improved.buyAmount, '1100');
  assert.equal(improved.minBuyAmount, '1089');
  assert.equal(improved.sellAmount, '123456');
  assert.equal(conversionRequest(improved, i).args[2], 123456n);
});

test('conversion validation rejects altered intent, spender, recipient, minimum, value and expiry', () => {
  const i = intent();
  const base = quote(i);
  const tampered: ConversionQuote[] = [
    { ...base, sellAmount: '1001' },
    { ...base, transaction: { ...base.transaction, value: '999' } },
    { ...base, transaction: { ...base.transaction, data: encodeFunctionData({ abi: holderAbi, functionName: 'exec', args: [other, TRADE_NATIVE, 1000n, ALLOWANCE_HOLDER, base.transaction.data] }) } },
    { ...base, transaction: { ...base.transaction, data: encodeFunctionData({ abi: holderAbi, functionName: 'exec', args: [ALLOWANCE_HOLDER, TRADE_NATIVE, 1001n, ALLOWANCE_HOLDER, base.transaction.data] }) } },
    { ...base, transaction: { ...base.transaction, data: encodeFunctionData({ abi: holderAbi, functionName: 'exec', args: [ALLOWANCE_HOLDER, TRADE_NATIVE, 1000n, other, base.transaction.data] }) } },
    { ...base, transaction: { ...base.transaction, data: encodeFunctionData({ abi: holderAbi, functionName: 'exec', args: [ALLOWANCE_HOLDER, TRADE_NATIVE, 1000n, ALLOWANCE_HOLDER, encodeFunctionData({ abi: settlerAbi, functionName: 'execute', args: [{ recipient: other, buyToken: providerToken(i.buyToken) as Address, minAmountOut: 900n }, [], `0x${'00'.repeat(32)}` as Hex] })] }) } },
    { ...base, transaction: { ...base.transaction, data: encodeFunctionData({ abi: holderAbi, functionName: 'exec', args: [ALLOWANCE_HOLDER, TRADE_NATIVE, 1000n, ALLOWANCE_HOLDER, encodeFunctionData({ abi: settlerAbi, functionName: 'execute', args: [{ recipient: wallet, buyToken: providerToken(i.buyToken) as Address, minAmountOut: 899n }, [], `0x${'00'.repeat(32)}` as Hex] })] }) } },
    { ...base, expiresAt: Date.now() - 1 },
  ];
  for (const value of tampered) assert.throws(() => conversionRequest(value, i), /Conversion quote|Invalid conversion/);

  const usdgi = intent(TRADE_USDG, TRADE_NATIVE);
  assert.throws(() => conversionRequest({ ...quote(usdgi), transaction: { ...quote(usdgi).transaction, value: '1' } }, usdgi), /Invalid conversion transaction/);
});

test('getConversionQuote calls the fixed API with server key and 1% slippage, returning sanitized fields', async () => {
  const i = intent(TRADE_USDG, TRADE_NATIVE);
  let seenUrl = '';
  let seenHeaders: HeadersInit | undefined;
  const fetcher: typeof fetch = async (input, init) => {
    seenUrl = String(input); seenHeaders = init?.headers;
    const u = new URL(seenUrl);
    const provider = quote(i, {}, '990', '1000');
    // Return provider-format transaction fields and a deliberately noisy field.
    return new Response(JSON.stringify({
      liquidityAvailable: true,
      sellToken: providerToken(i.sellToken), buyToken: providerToken(i.buyToken), sellAmount: i.sellAmount,
      allowanceTarget: ALLOWANCE_HOLDER,
      buyAmount: '1000', minBuyAmount: '990', transaction: { ...provider.transaction, gas: '777777', to: ALLOWANCE_HOLDER },
      fees: { zeroExFee: { amount: '2', token: i.sellToken } },
      arbitraryProviderField: 'must not escape',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const result = await getConversionQuote(i, 'private-test-key', fetcher);
  const u = new URL(seenUrl);
  assert.equal(u.origin, 'https://api.0x.org');
  assert.equal(u.searchParams.get('chainId'), '4663');
  assert.equal(u.searchParams.get('sellToken'), providerToken(i.sellToken));
  assert.equal(u.searchParams.get('buyToken'), providerToken(i.buyToken));
  assert.equal(u.searchParams.get('slippageBps'), '100');
  assert.equal(u.searchParams.get('recipient'), wallet);
  assert.equal((seenHeaders as Record<string, string>)['0x-api-key'], 'private-test-key');
  assert.equal((seenHeaders as Record<string, string>)['0x-version'], 'v2');
  assert.equal(result.transaction.to, ALLOWANCE_HOLDER);
  assert.equal(result.providerFee?.amount, '2');
  assert.equal('arbitraryProviderField' in result, false);
  assert.equal('gas' in result.transaction, false);
});
