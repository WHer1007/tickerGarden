import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeFunctionData, encodeFunctionData, type Abi, type Address, type Hex } from "viem";
import { buildStake, buildStockApproval, buildUnstakeAndWithdraw, validateMarketStake } from "../src/v1/features/vault.ts";
import { parseTokenAmount } from "../src/runtime/model.ts";
const manager = `0x${"1".repeat(40)}` as Address;
const vault = `0x${"2".repeat(40)}` as Address;
const stock = `0x${"3".repeat(40)}` as Address;
const market = `0x${"a".repeat(64)}` as Hex;

test("market staking encodes one wallet amount and grants approval only to custody", () => {
  const amount = parseTokenAmount("1.123456", 6, "STOCK");
  validateMarketStake(amount, 2_000_000n, 0n, 500_000n);
  const request = buildStake(manager, market, amount);
  const data = encodeFunctionData({ abi: request.abi as Abi, functionName: request.functionName, args: request.args });
  assert.equal(request.address, manager);
  assert.deepEqual(decodeFunctionData({ abi: request.abi as Abi, data }), { functionName: "stake", args: [market, amount] });
  const approval = buildStockApproval(stock, vault, amount);
  assert.equal(approval.address, stock);
  assert.deepEqual(approval.args, [vault, amount]);
});

test("full exit ABI cannot specify another user, recipient or partial amount", () => {
  const request = buildUnstakeAndWithdraw(manager, market);
  const data = encodeFunctionData({ abi: request.abi as Abi, functionName: request.functionName, args: request.args });
  assert.equal(request.address, manager);
  assert.deepEqual(decodeFunctionData({ abi: request.abi as Abi, data }), { functionName: "unstakeAndWithdraw", args: [market] });
});

test("stake preview validates wallet funding, total minimum and integer boundaries", () => {
  assert.throws(() => validateMarketStake(0n, 1000n, 0n, 500n));
  assert.throws(() => validateMarketStake(500n, 499n, 1000n, 500n), /wallet/);
  assert.throws(() => validateMarketStake(499n, 1000n, 0n, 500n), /minimum/);
  assert.doesNotThrow(() => validateMarketStake(1n, 1n, 499n, 500n));
  assert.throws(() => validateMarketStake(1n, 1n, (1n << 256n) - 1n, 500n), /uint256/);
  assert.throws(() => parseTokenAmount("1.0000001", 6, "STOCK"), /decimal places/);
  assert.throws(() => parseTokenAmount("1e18", 18, "STOCK"), /plain/);
});
