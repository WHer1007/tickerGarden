import assert from "node:assert/strict";
import { test } from "node:test";
import type { Account, Address, Chain, Hash, TransactionReceipt } from "viem";
import {
  V1TransactionError,
  V1TransactionExecutor,
  type V1TransactionClients,
} from "../src/v1/transaction.ts";
import { V1_EXECUTION_SPEC_ID } from "../src/v1/generated/abis.ts";

const account = "0x1111111111111111111111111111111111111111" as Address;
const contract = "0x2222222222222222222222222222222222222222" as Address;
const hash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Hash;
const revision = "42:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const snapshot = { executionSpecId: V1_EXECUTION_SPEC_ID, revision, syncStatus: "synced" } as const;
const request = { abi: [], address: contract, functionName: "execute" } as const;
const chain = { id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "X", symbol: "X", decimals: 18 }, rpcUrls: { default: { http: [] } } } as unknown as Chain;
const receipt = { status: "success", logs: [], blockNumber: 43n } as unknown as TransactionReceipt;

function clients(writeContract: (request: unknown) => Promise<Hash>): V1TransactionClients {
  return {
    publicClient: {
      simulateContract: async () => ({ request: { to: contract, data: "0x" } }),
      waitForTransactionReceipt: async () => receipt,
    },
    walletClient: { account, chain, writeContract },
  };
}

function input(verifyWalletContext: () => Promise<void>) {
  return {
    operationKey: "transaction-test",
    expectedAccount: account,
    snapshot,
    request,
    verifyWalletContext,
    currentRevision: async () => revision,
    confirm: async () => "confirmed",
  };
}

test("blocks signing when the wallet changes after simulation", async () => {
  let checks = 0;
  let writes = 0;
  const executor = new V1TransactionExecutor(clients(async () => {
    writes += 1;
    return hash;
  }));

  await assert.rejects(
    executor.execute(input(async () => {
      checks += 1;
      if (checks === 3) throw new V1TransactionError("wrong_account", "wallet changed after simulation");
    })),
    (error: unknown) => error instanceof V1TransactionError && error.code === "wrong_account",
  );
  assert.equal(checks, 3, "the post-simulation wallet check must run before signing");
  assert.equal(writes, 0, "wallet signing must not occur after a failed live-context check");
});

test("successful execution still simulates, signs, waits, and confirms", async () => {
  let checks = 0;
  let writes = 0;
  const executor = new V1TransactionExecutor(clients(async () => {
    writes += 1;
    return hash;
  }));

  const result = await executor.execute(input(async () => {
    checks += 1;
  }));

  assert.equal(result, "confirmed");
  assert.equal(checks, 4, "wallet context is checked before and after the asynchronous simulation boundary");
  assert.equal(writes, 1);
});
