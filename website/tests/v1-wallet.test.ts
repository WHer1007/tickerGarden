import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import type { Address, Hash, TransactionReceipt } from "viem";
import { ROBINHOOD_CHAIN_ID, robinhoodChain } from "../src/v1/chain.ts";
import { createTickerGardenWagmiConfig } from "../src/v1/wagmiConfig.ts";
import { V1_ABI_SOURCES, V1_EXECUTION_SPEC_ID, v1Abis } from "../src/v1/generated/abis.ts";
import type { ConfigReadModel, SyncStatus } from "../src/v1/readApi.ts";
import {
  V1TransactionError,
  V1TransactionExecutor,
  createContractWriteRequest,
  type ExecuteV1Transaction,
  type TransactionUpdate,
  type V1TransactionClients,
} from "../src/v1/transaction.ts";

const address = (value: string): Address => `0x${value.padStart(40, "0")}`;
const hash = (value: string): Hash => `0x${value.padStart(64, "0")}`;
const account = address("a");
const request = createContractWriteRequest({
  abi: v1Abis.UserStockVault,
  address: address("1"),
  functionName: "withdrawFreeStock",
  args: [hash("1"), 1n],
});
const receipt = (status: "success" | "reverted" = "success") => ({ status }) as TransactionReceipt;
const snapshot = { executionSpecId: "V1-EXEC-6", revision: "100:0xaa", syncStatus: "synced" as const };

function clients(options: {
  chainId?: number;
  connected?: Address;
  simulateError?: unknown;
  writeError?: unknown;
  receiptStatus?: "success" | "reverted";
  replacement?: { reason: "repriced" | "replaced" | "cancelled"; hash: Hash };
  wait?: Promise<void>;
} = {}): { clients: V1TransactionClients; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    clients: {
      walletClient: {
        account: options.connected ?? account,
        chain: { id: options.chainId ?? ROBINHOOD_CHAIN_ID } as never,
        async writeContract() {
          calls.push("write");
          if (options.writeError) throw options.writeError;
          return hash("10");
        },
      },
      publicClient: {
        async simulateContract() {
          calls.push("simulate");
          if (options.simulateError) throw options.simulateError;
          return { request };
        },
        async waitForTransactionReceipt(waitOptions) {
          calls.push("receipt");
          await options.wait;
          if (options.replacement) waitOptions.onReplaced?.({
            reason: options.replacement.reason,
            transaction: { hash: options.replacement.hash },
          });
          return receipt(options.receiptStatus);
        },
      },
    },
  };
}

function input(overrides: Partial<ExecuteV1Transaction<string>> = {}): ExecuteV1Transaction<string> {
  return {
    operationKey: "withdraw:1",
    expectedAccount: account,
    snapshot,
    request,
    confirm: async () => "reconciled",
    ...overrides,
  };
}

test("Robinhood Chain identity matches the frozen execution network", () => {
  assert.equal(robinhoodChain.id, 4663);
  assert.equal(robinhoodChain.nativeCurrency.symbol, "ETH");
  assert.equal(robinhoodChain.rpcUrls.default.http[0], "https://rpc.mainnet.chain.robinhood.com");
  assert.equal(robinhoodChain.blockExplorers?.default.url, "https://robinhoodchain.blockscout.com");
  const config = createTickerGardenWagmiConfig();
  assert.deepEqual(config.chains.map((chain) => chain.id), [4663]);
  assert.equal(config.connectors.length, 1);
});

test("generated ABI bridge exactly matches all eighteen compiled E102 interface artifacts", async () => {
  assert.equal(V1_EXECUTION_SPEC_ID, "V1-EXEC-6");
  assert.equal(V1_ABI_SOURCES.length, 18);
  assert.deepEqual(Object.keys(v1Abis).sort(), V1_ABI_SOURCES.map((source) => source.module).sort());
  for (const source of V1_ABI_SOURCES) {
    const artifact = JSON.parse(await readFile(new URL(`../../${source.artifact}`, import.meta.url), "utf8"));
    assert.deepEqual(v1Abis[source.module], artifact.abi);
  }
});

test("Web consumes the generated Backend contract and carries dynamic minimum policy in asset config", () => {
  const sync = { chainId: 4663, status: "synced", blockNumber: "1", blockHash: hash("1"), finality: "finalized", headBlockNumber: "1", headBlockHash: hash("1"), lagBlocks: "0", revision: "1:0x01" } satisfies SyncStatus;
  const assetConfig = {
    kind: "asset",
    id: hash("2"),
    status: 1,
    values: { minimumAllocation: "10000000000000000000" },
    source: {
      chainId: 4663,
      blockNumber: "1",
      blockHash: hash("1"),
      transactionHash: hash("3"),
      transactionIndex: 0,
      logIndex: 0,
    },
  } satisfies ConfigReadModel;
  assert.equal(sync.chainId, 4663);
  assert.equal(typeof assetConfig.values.minimumAllocation, "string");
});

test("transaction path simulates before signature, waits for success, then reconciles fresh facts", async () => {
  const harness = clients();
  const updates: TransactionUpdate[] = [];
  let confirmedHash: Hash | undefined;
  const result = await new V1TransactionExecutor(harness.clients).execute(input({
    confirmations: 2,
    onUpdate: (update) => updates.push(update),
    confirm: async (_receipt, transactionHash) => {
      confirmedHash = transactionHash;
      return "fresh-chain-read";
    },
  }));
  assert.equal(result, "fresh-chain-read");
  assert.equal(confirmedHash, hash("10"));
  assert.deepEqual(harness.calls, ["simulate", "write", "receipt"]);
  assert.deepEqual(updates.map((update) => update.stage), [
    "preflight", "simulating", "awaiting_signature", "submitted", "pending", "confirming", "confirmed",
  ]);
});

test("optional allowance approval confirms before the main simulation and tracks a repriced hash", async () => {
  const replacementHash = hash("20");
  const harness = clients({ replacement: { reason: "repriced", hash: replacementHash } });
  const updates: TransactionUpdate[] = [];
  const result = await new V1TransactionExecutor(harness.clients).execute(input({
    approval: { ...request, functionName: "approve" },
    onUpdate: (update) => updates.push(update),
    confirm: async (_receipt, transactionHash) => transactionHash,
  }));
  assert.equal(result, replacementHash);
  assert.deepEqual(harness.calls, ["simulate", "write", "receipt", "simulate", "write", "receipt"]);
  assert.ok(updates.some((update) => update.stage === "approval_confirmed"));
  assert.ok(updates.some((update) => update.stage === "replaced" && update.hash === replacementHash));
});

test("duplicate operation keys share one in-flight wallet request", async () => {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const harness = clients({ wait });
  const executor = new V1TransactionExecutor(harness.clients);
  const first = executor.execute(input());
  const second = executor.execute(input());
  assert.equal(first, second);
  release();
  assert.equal(await second, "reconciled");
  assert.equal(harness.calls.filter((call) => call === "write").length, 1);
});

test("preflight distinguishes chain, account, quote, snapshot, and Indexer failures before simulation", async () => {
  const cases: Array<[V1TransactionClients, ExecuteV1Transaction<string>, string]> = [
    [clients({ chainId: 1 }).clients, input(), "unsupported_chain"],
    [clients({ connected: address("b") }).clients, input(), "wrong_account"],
    [clients().clients, input({ quoteExpiresAtMs: 10, now: () => 10 }), "stale_quote"],
    [clients().clients, input({ snapshot: { ...snapshot, executionSpecId: "V1-EXEC-2" } }), "stale_snapshot"],
    [clients().clients, input({ snapshot: { ...snapshot, syncStatus: "lagging" } }), "indexer_lagging"],
    [clients().clients, input({ snapshot: { ...snapshot, syncStatus: "unavailable" } }), "indexer_unavailable"],
    [clients().clients, input({ currentRevision: async () => "101:0xbb" }), "stale_snapshot"],
    [clients().clients, input({ currentRevision: async () => { throw new V1TransactionError("indexer_unavailable", "health unavailable"); } }), "indexer_unavailable"],
  ];
  for (const [clientSet, transaction, code] of cases) {
    await assert.rejects(new V1TransactionExecutor(clientSet).execute(transaction), (error: unknown) => {
      assert.ok(error instanceof V1TransactionError);
      assert.equal(error.code, code);
      return true;
    });
  }
});

test("wallet or snapshot drift after simulation prevents a signature", async () => {
  const harness = clients();
  let reads = 0;
  await assert.rejects(new V1TransactionExecutor(harness.clients).execute(input({
    currentRevision: async () => ++reads === 1 ? snapshot.revision : "101:0xbb",
  })), (error: unknown) => error instanceof V1TransactionError && error.code === "stale_snapshot");
  assert.deepEqual(harness.calls, ["simulate"]);
});

test("simulation, rejection, revert, cancellation, and confirmation failures remain distinct", async () => {
  const scenarios: Array<[V1TransactionClients, ExecuteV1Transaction<string>, string]> = [
    [clients({ simulateError: new Error("revert") }).clients, input(), "simulation_failed"],
    [clients({ writeError: { code: 4001 } }).clients, input(), "user_rejected"],
    [clients({ receiptStatus: "reverted" }).clients, input(), "transaction_reverted"],
    [clients({ replacement: { reason: "cancelled", hash: hash("30") } }).clients, input(), "replacement_cancelled"],
    [clients().clients, input({ confirm: async () => { throw new Error("readback drift"); } }), "confirmation_failed"],
  ];
  for (const [clientSet, transaction, code] of scenarios) {
    await assert.rejects(new V1TransactionExecutor(clientSet).execute(transaction), (error: unknown) => {
      assert.ok(error instanceof V1TransactionError);
      assert.equal(error.code, code);
      return true;
    });
  }
});
