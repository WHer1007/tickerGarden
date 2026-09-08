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

function journal() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}

test("timeout survives reload and changing operation keys without broadcasting again", async () => {
  let writes = 0;
  let timeout = true;
  const storage = journal();
  const api = clients(async () => { writes++; return hash; });
  api.publicClient.waitForTransactionReceipt = async () => {
    if (timeout) throw Object.assign(new Error("timeout"), { name: "WaitForTransactionReceiptTimeoutError" });
    return receipt;
  };
  const original = input(async () => {});
  await assert.rejects(new V1TransactionExecutor(api, storage).execute(original), { code: "receipt_timeout" });
  const recovered = new V1TransactionExecutor(api, storage);
  await assert.rejects(recovered.execute({ ...original, request: { ...request, functionName: "different" } }), { code: "pending_transaction" });
  timeout = false;
  assert.equal(await recovered.execute({ ...original, operationKey: "new-revision", currentRevision: async () => "newer" }), "confirmed");
  assert.equal(writes, 1);
  assert.equal(recovered.pending(account), null);
});

test("confirmation failure retries reconciliation instead of the successful write", async () => {
  let writes = 0;
  const executor = new V1TransactionExecutor(clients(async () => { writes++; return hash; }), journal());
  await assert.rejects(executor.execute({ ...input(async () => {}), confirm: async () => { throw new Error("API offline"); } }), { code: "confirmation_failed" });
  assert.equal(await executor.execute(input(async () => {})), "confirmed");
  assert.equal(writes, 1);
});

test("approval timeout resumes approval then sends the business transaction once", async () => {
  let writes = 0;
  let waits = 0;
  const api = clients(async () => { writes++; return hash; });
  api.publicClient.waitForTransactionReceipt = async () => {
    if (++waits === 1) throw Object.assign(new Error("timeout"), { name: "WaitForTransactionReceiptTimeoutError" });
    return receipt;
  };
  const executor = new V1TransactionExecutor(api, journal());
  const operation = { ...input(async () => {}), approval: { ...request, functionName: "approve" } };
  await assert.rejects(executor.execute(operation), { code: "receipt_timeout" });
  assert.equal(await executor.execute(operation), "confirmed");
  assert.equal(writes, 2);
});

test("explicit recovery checks existing receipt without requesting a signature", async () => {
  const storage = journal();
  let timeout = true;
  let writes = 0;
  const api = clients(async () => { writes++; return hash; });
  api.publicClient.waitForTransactionReceipt = async () => { if (timeout) throw new Error("RPC offline"); return receipt; };
  const executor = new V1TransactionExecutor(api, storage);
  await assert.rejects(executor.execute(input(async () => {})), { code: "pending_transaction" });
  timeout = false;
  assert.equal((await executor.reconcilePending(account))?.receipt.status, "success");
  assert.equal(writes, 1);
  assert.equal(executor.pending(account), null);
});

test("already-mined approval is recovered even when fresh allowance no longer requires approval", async () => {
  let writes = 0, waits = 0;
  const api = clients(async () => { writes++; return hash; });
  api.publicClient.waitForTransactionReceipt = async () => {
    if (++waits === 1) throw Object.assign(new Error("timeout"), { name: "WaitForTransactionReceiptTimeoutError" });
    return receipt;
  };
  const executor = new V1TransactionExecutor(api, journal());
  await assert.rejects(executor.execute({ ...input(async () => {}), approval: { ...request, functionName: "approve" } }));
  assert.equal(await executor.execute(input(async () => {})), "confirmed");
  assert.equal(writes, 2);
});

test("cancellation replacement survives timeout without becoming a confirmed business transaction", async () => {
  let first = true, writes = 0;
  const api = clients(async () => { writes++; return hash; });
  api.publicClient.waitForTransactionReceipt = async (options) => {
    if (first) { first = false; options.onReplaced?.({ reason: "cancelled", transaction: { hash } }); throw new Error("offline"); }
    return receipt;
  };
  const executor = new V1TransactionExecutor(api, journal());
  await assert.rejects(executor.execute(input(async () => {})));
  const recovered = await executor.reconcilePending(account);
  assert.equal(recovered?.cancelled, true);
  assert.equal(writes, 1);
});


test("preserves the explicit atomic-launch Gas budget through simulation and wallet submission", async () => {
  const gas = 16_000_000n;
  let submitted: unknown;
  const configured = clients(async value => { submitted = value; return hash; });
  configured.publicClient.simulateContract = async value => ({ request: value });
  const executor = new V1TransactionExecutor(configured);
  await executor.execute({ ...input(async () => {}), request: { ...request, gas } });
  assert.equal((submitted as { gas: bigint }).gas, gas);
});

test('direct state transactions do not wait for an unavailable analytics snapshot', async () => {
  let writes=0,stateChecks=0;
  const executor=new V1TransactionExecutor(clients(async()=>{writes++;return hash;}),journal());
  const result=await executor.execute({...input(async()=>{}),snapshot:{...snapshot,syncStatus:'unavailable',authority:'direct-chain'},currentRevision:async()=>{stateChecks++;return revision;}});
  assert.equal(result,'confirmed');assert.equal(writes,1);assert.ok(stateChecks>=2);
});

test('direct state mode still requires live wallet and state checks before signing', async () => {
 let writes=0;const executor=new V1TransactionExecutor(clients(async()=>{writes++;return hash;}),journal());
 await assert.rejects(executor.execute({...input(async()=>{}),snapshot:{...snapshot,syncStatus:'unavailable',authority:'direct-chain'},currentRevision:undefined}),{code:'stale_snapshot'});
 assert.equal(writes,0);
});

test('malformed pending journal fails closed with a readable error and is not deleted', () => {
  for (const raw of ['{broken','null','[]','{}']) {
    let removed = false;
    const executor = new V1TransactionExecutor(clients(async () => hash), {
      getItem: () => raw, setItem: () => {}, removeItem: () => { removed = true; },
    });
    assert.throws(() => executor.pending(account), (error: unknown) => error instanceof V1TransactionError && error.code === 'pending_transaction');
    assert.equal(removed,false);
  }
});
