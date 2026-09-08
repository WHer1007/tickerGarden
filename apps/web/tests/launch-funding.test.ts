import assert from "node:assert/strict";
import test from "node:test";
import { addBpsCeil, resolveLaunchFunding } from "../src/v1/launchFunding.ts";

const account = "0x1111111111111111111111111111111111111111" as const;
const quote = "0x2222222222222222222222222222222222222222" as const;
const quoter = "0x3333333333333333333333333333333333333333" as const;

test("slippage ceiling never rounds the ETH cap below its exact basis-point value", () => {
  assert.equal(addBpsCeil(1n, 100n), 2n);
  assert.equal(addBpsCeil(10_000n, 100n), 10_100n);
});

test("sufficient Quote selects the direct path without consulting the v4 quoter", async () => {
  let simulations = 0;
  const result = await resolveLaunchFunding({
    client: {
      getBalance: async () => 5n,
      readContract: async () => 100n,
      simulateContract: async () => { simulations += 1; throw new Error("unexpected"); },
    } as never,
    account, quoteAsset: quote, quoteAmount: 100n, quoter, poolFee: 10_000, tickSpacing: 200,
  });
  assert.equal(result.mode, "quote");
  assert.equal(simulations, 0);
});

test("zero or insufficient Quote automatically quotes full exact output from ETH", async () => {
  const result = await resolveLaunchFunding({
    client: {
      getBalance: async () => 10_000n,
      readContract: async () => 25n,
      simulateContract: async () => ({ result: [1_000n, 80_000n] }),
    } as never,
    account, quoteAsset: quote, quoteAmount: 100n, quoter, poolFee: 10_000, tickSpacing: 200,
  });
  assert.equal(result.mode, "native-fallback");
  assert.equal(result.quoteBalance, 25n);
  assert.equal(result.quotedNativeInput, 1_000n);
  assert.equal(result.maxNativeQuoteInput, 1_010n);
});

test("invalid or unavailable fallback quotes fail closed", async () => {
  await assert.rejects(resolveLaunchFunding({
    client: {
      getBalance: async () => 10_000n,
      readContract: async () => 0n,
      simulateContract: async () => ({ result: [0n, 0n] }),
    } as never,
    account, quoteAsset: quote, quoteAmount: 100n, quoter, poolFee: 10_000, tickSpacing: 200,
  }), /invalid quote/);
});
