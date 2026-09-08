import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeAbiParameters, encodeAbiParameters, keccak256, parseAbiParameters, zeroAddress } from "viem";
import { buildPoolTrade, poolAmount, poolTradeRoute } from "../src/v1/poolTrade.ts";

const quote = "0x0000000000000000000000000000000000000000" as const;
const token = "0x1111111111111111111111111111111111111111" as const;
const tokenQuote = "0x4444444444444444444444444444444444444444" as const;
const hook = "0x2222222222222222222222222222222222222222" as const;
const router = "0x8876789976decbfcbbbe364623c63652db8c0904" as const;
const quoter = "0x3333333333333333333333333333333333333333" as const;
const key = { currency0: quote, currency1: token, fee: 3000, tickSpacing: 60, hooks: hook };
const keyParams = parseAbiParameters("(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)");

function market(overrides: Record<string, unknown> = {}) {
  const boundKey = (overrides.poolKey ?? key) as typeof key;
  return {
    launchPhase: 1, poolId: keccak256(encodeAbiParameters(keyParams, [boundKey])), poolKey: boundKey,
    memeToken: token, quoteAsset: quote,
    canonicalRoute: { router, quoter, hook, curveTradingEnabled: false, poolTradingEnabled: true },
    ...overrides,
  } as any;
}

test("binds buy and sell directions to the canonical pool", () => {
  const buy = poolTradeRoute(market(), "buy");
  const sell = poolTradeRoute(market(), "sell");
  assert.deepEqual({ input: buy.input, output: buy.output, zeroForOne: buy.zeroForOne }, { input: quote, output: token, zeroForOne: true });
  assert.deepEqual({ input: sell.input, output: sell.output, zeroForOne: sell.zeroForOne }, { input: token, output: quote, zeroForOne: false });
});

test("rejects invalid pool binding and amount limits", () => {
  assert.throws(() => poolTradeRoute(market({ poolId: `0x${"00".repeat(32)}` }), "buy"), /pool ID/);
  assert.throws(() => poolTradeRoute(market({ poolKey: { ...key, hooks: quoter } }), "buy"), /canonical pool binding/);
  assert.throws(() => poolAmount(0n), /outside/);
  assert.throws(() => poolAmount(1n << 128n), /outside/);
  assert.throws(() => buildPoolTrade(market(), "buy", 1n, 1n << 128n, 99n), /outside/);
});

test("encodes token UniversalRouter V4_SWAP with minimums and hop price", () => {
  const request = buildPoolTrade(market({ quoteAsset: tokenQuote, poolKey: { ...key, currency0: token, currency1: tokenQuote } }), "buy", 7n, 5n, 99n) as any;
  assert.equal(request.functionName, "execute");
  assert.equal(request.args[0], "0x10");
  assert.equal(request.value, 0n);
  assert.equal(request.args[2], 99n);
  const [commands, inputs] = decodeAbiParameters(parseAbiParameters("bytes,bytes[]"), request.args[1][0]);
  assert.equal(commands, "0x060c0f");
  const swapInput = inputs[0]; assert.ok(swapInput);
  const [swap] = decodeAbiParameters(parseAbiParameters("((address,address,uint24,int24,address),bool,uint128,uint128,uint256,bytes)"), swapInput);
  assert.equal(swap[1], false); assert.equal(swap[2], 7n); assert.equal(swap[3], 5n); assert.equal(swap[4], 0n);
  const settleInput = inputs[1]; assert.ok(settleInput);
  const [settleAsset, settleAmount] = decodeAbiParameters(parseAbiParameters("address,uint256"), settleInput);
  assert.equal(settleAsset, tokenQuote); assert.equal(settleAmount, 7n);
  const takeInput = inputs[2]; assert.ok(takeInput);
  const [takeAsset, takeMinimum] = decodeAbiParameters(parseAbiParameters("address,uint256"), takeInput);
  assert.equal(takeAsset, token); assert.equal(takeMinimum, 5n);
});

test("adds native refund sweep for native input", () => {
  const m = market({ poolKey: { ...key, currency0: quote, currency1: token }, quoteAsset: quote });
  const request = buildPoolTrade(m, "buy", 7n, 5n, 99n) as any;
  assert.equal(request.args[0], "0x1004"); assert.equal(request.value, 7n); assert.equal(request.args[1].length, 2);
  const [asset, recipient, amount] = decodeAbiParameters(parseAbiParameters("address,address,uint256"), request.args[1][1]);
  assert.equal(asset, zeroAddress); assert.equal(recipient, "0x0000000000000000000000000000000000000001"); assert.equal(amount, 0n);
});
