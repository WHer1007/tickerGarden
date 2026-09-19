import assert from "node:assert/strict";
import { test } from "node:test";
import type { Account, Address, Chain, Hash, TransactionReceipt } from "viem";
import {
  V1TransactionError,
  V1TransactionExecutor,
  transactionScopeForOperation,
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
  assert.equal(recovered.pending(account)[0]?.operationKey, original.operationKey);
  await assert.rejects(recovered.execute({ ...original, request: { ...request, functionName: "different" } }), { code: "pending_transaction" });
  timeout = false;
  assert.equal(await recovered.execute({ ...original, operationKey: "new-revision", currentRevision: async () => "newer" }), "confirmed");
  assert.equal(writes, 1);
  assert.deepEqual(recovered.pending(account), []);
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
  api.publicClient.getTransactionReceipt=async()=>receipt;
  assert.equal((await executor.reconcilePending(account, input(async () => {}).operationKey))?.receipt.status, "success");
  assert.equal(writes, 1);
  assert.deepEqual(executor.pending(account), []);
});

test('wallet restore clears an already-mined journal lock without waiting or signing', async () => {
  const storage = journal();
  let waits = 0, writes = 0;
  const api = clients(async () => { writes++; return hash; });
  api.publicClient.waitForTransactionReceipt = async () => { waits++; throw new Error('must not wait'); };
  const first = new V1TransactionExecutor(api, storage);
  await assert.rejects(first.execute(input(async () => {})));
  api.publicClient.getTransactionReceipt = async ({hash: requested}) => { assert.equal(requested, hash); return receipt; };
  const recovered = new V1TransactionExecutor(api, storage);
  assert.equal((await recovered.reconcileSettledPending(account))[0]?.receipt.status, 'success');
  assert.deepEqual(recovered.pending(account), []);
  assert.equal(writes, 1);
  assert.equal(waits, 1);
});

test('wallet restore preserves a genuinely pending journal lock', async () => {
  const storage = journal();
  const api = clients(async () => hash);
  api.publicClient.waitForTransactionReceipt = async () => { throw Object.assign(new Error('timeout'), {name:'WaitForTransactionReceiptTimeoutError'}); };
  await assert.rejects(new V1TransactionExecutor(api, storage).execute(input(async () => {})));
  api.publicClient.getTransactionReceipt = async () => { throw Object.assign(new Error('not found'), {name:'TransactionReceiptNotFoundError'}); };
  const recovered = new V1TransactionExecutor(api, storage);
  assert.deepEqual(await recovered.reconcileSettledPending(account), []);
  assert.equal(recovered.pending(account)[0]?.hash, hash);
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
  api.publicClient.getTransactionReceipt=async()=>receipt;
  const recovered = await executor.reconcilePending(account, input(async () => {}).operationKey);
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

test("different markets and business types can remain pending at the same time", async () => {
  const secondHash = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" as Hash;
  const releases = new Map<Hash, (value: TransactionReceipt) => void>();
  let writes = 0;
  const api = clients(async () => ++writes === 1 ? hash : secondHash);
  api.publicClient.waitForTransactionReceipt = ({ hash: pendingHash }) => new Promise(resolve => releases.set(pendingHash, resolve));
  const executor = new V1TransactionExecutor(api, journal());
  const trade = executor.execute({ ...input(async () => {}), operationKey: "trade:buy:market-a:10:rev" });
  const claim = executor.execute({ ...input(async () => {}), operationKey: "reward:user-claim:market-b:creator:3:0x1111111111111111111111111111111111111111:rev", request: { ...request, functionName: "claim" } });
  while (executor.pending(account).length < 2) await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(writes, 2);
  assert.deepEqual(new Set(executor.pending(account).map(record => record.businessType)), new Set(["trade", "claim"]));
  releases.get(hash)?.(receipt);
  releases.get(secondHash)?.({ ...receipt, transactionHash: secondHash } as TransactionReceipt);
  assert.deepEqual(await Promise.all([trade, claim]), ["confirmed", "confirmed"]);
});

test("a second trade for the same market is blocked while the first quote is pending", async () => {
  let release!: (value: TransactionReceipt) => void;
  let writes = 0;
  const api = clients(async () => { writes += 1; return hash; });
  api.publicClient.waitForTransactionReceipt = () => new Promise(resolve => { release = resolve; });
  const executor = new V1TransactionExecutor(api, journal());
  const first = executor.execute({ ...input(async () => {}), operationKey: "trade:buy:market-a:10:rev-1" });
  await assert.rejects(executor.execute({ ...input(async () => {}), operationKey: "pool-trade:sell:market-a:8:999", request: { ...request, functionName: "sell" } }), { code: "pending_transaction" });
  assert.equal(writes, 0, "the conflicting call is rejected before either flow broadcasts a second transaction");
  while (writes === 0) await new Promise(resolve => setTimeout(resolve, 0));
  release(receipt);
  await first;
  assert.equal(writes, 1);
});

test("the exact same operation is coalesced into one wallet request", async () => {
  let release!: (value: TransactionReceipt) => void;
  let writes = 0;
  const api = clients(async () => { writes += 1; return hash; });
  api.publicClient.waitForTransactionReceipt = () => new Promise(resolve => { release = resolve; });
  const executor = new V1TransactionExecutor(api, journal());
  const operation = { ...input(async () => {}), operationKey: "trade:buy:market-a:10:rev" };
  const first = executor.execute(operation);
  const duplicate = executor.execute(operation);
  assert.equal(first, duplicate);
  while (writes === 0) await new Promise(resolve => setTimeout(resolve, 0));
  release(receipt);
  await first;
  assert.equal(writes, 1);
});

test("wallet restore batch-clears mined records and preserves unresolved records", async () => {
  const secondHash = "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" as Hash;
  let writes = 0;
  const storage = journal();
  const api = clients(async () => ++writes === 1 ? hash : secondHash);
  api.publicClient.waitForTransactionReceipt = async () => { throw Object.assign(new Error("timeout"), { name: "WaitForTransactionReceiptTimeoutError" }); };
  const executor = new V1TransactionExecutor(api, storage);
  await assert.rejects(executor.execute({ ...input(async () => {}), operationKey: "trade:buy:market-a:10:rev" }), { code: "receipt_timeout" });
  await assert.rejects(executor.execute({ ...input(async () => {}), operationKey: "reward:user-claim:market-b:creator:3:0x1111111111111111111111111111111111111111:rev", request: { ...request, functionName: "claim" } }), { code: "receipt_timeout" });
  api.publicClient.getTransactionReceipt = async ({ hash: requested }) => {
    if (requested === secondHash) throw Object.assign(new Error("not found"), { name: "TransactionReceiptNotFoundError" });
    return receipt;
  };
  const settled = await executor.reconcileSettledPending(account);
  assert.equal(settled.length, 1);
  assert.equal(settled[0]?.pending.hash, hash);
  assert.deepEqual(executor.pending(account).map(record => record.hash), [secondHash]);
});

test('batch reconciliation preserves a mined journal record when verification fails', async () => {
  const storage = journal();
  const api = clients(async () => hash);
  api.publicClient.waitForTransactionReceipt = async () => {
    throw Object.assign(new Error('timeout'), {name: 'WaitForTransactionReceiptTimeoutError'});
  };
  const executor = new V1TransactionExecutor(api, storage);
  const operation = {...input(async () => {}), operationKey: 'trade:buy:market-a:10:verify'};
  await assert.rejects(executor.execute(operation), {code: 'receipt_timeout'});
  api.publicClient.getTransactionReceipt = async () => receipt;

  const settled = await executor.reconcileSettledPending(account, {
    verify: async () => { throw new Error('receipt does not match the expected vault action'); },
  });
  assert.deepEqual(settled, []);
  assert.equal(executor.pending(account)[0]?.hash, hash, 'verification failure must leave the recovery journal intact');
});

test('batch reconciliation filters unrelated pending records before RPC lookup', async () => {
  const secondHash = '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' as Hash;
  let writes = 0;
  const storage = journal();
  const api = clients(async () => ++writes === 1 ? hash : secondHash);
  api.publicClient.waitForTransactionReceipt = async () => {
    throw Object.assign(new Error('timeout'), {name: 'WaitForTransactionReceiptTimeoutError'});
  };
  const executor = new V1TransactionExecutor(api, storage);
  const tradeKey = 'trade:buy:market-a:10:filter';
  const claimKey = 'reward:user-claim:market-b:creator:3:0x1111111111111111111111111111111111111111:filter';
  await assert.rejects(executor.execute({...input(async () => {}), operationKey: tradeKey}), {code: 'receipt_timeout'});
  await assert.rejects(executor.execute({...input(async () => {}), operationKey: claimKey, request: {...request, functionName: 'claim'}}), {code: 'receipt_timeout'});
  const requested: Hash[] = [];
  api.publicClient.getTransactionReceipt = async ({hash: requestedHash}) => {
    requested.push(requestedHash);
    return receipt;
  };

  const settled = await executor.reconcileSettledPending(account, {filter: pending => pending.operationKey === tradeKey});
  assert.deepEqual(requested, [hash]);
  assert.equal(settled.length, 1);
  assert.equal(settled[0]?.pending.operationKey, tradeKey);
  assert.deepEqual(executor.pending(account).map(pending => pending.operationKey), [claimKey]);
});

test('batch reconciliation does not overwrite a different pending record added during RPC lookup', async () => {
  const secondHash = '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd' as Hash;
  let writes = 0;
  const storage = journal();
  const api = clients(async () => ++writes === 1 ? hash : secondHash);
  api.publicClient.waitForTransactionReceipt = async () => {
    throw Object.assign(new Error('timeout'), {name: 'WaitForTransactionReceiptTimeoutError'});
  };
  const executor = new V1TransactionExecutor(api, storage);
  await assert.rejects(executor.execute({...input(async () => {}), operationKey: 'trade:buy:market-a:10:race'}), {code: 'receipt_timeout'});

  let releaseReceipt!: (value: TransactionReceipt) => void;
  let lookupStarted = false;
  api.publicClient.getTransactionReceipt = () => {
    lookupStarted = true;
    return new Promise(resolve => { releaseReceipt = resolve; });
  };
  const reconciling = executor.reconcileSettledPending(account);
  while (!lookupStarted) await new Promise(resolve => setTimeout(resolve, 0));

  await assert.rejects(executor.execute({...input(async () => {}), operationKey: 'trade:sell:market-b:8:race', request: {...request, functionName: 'sell'}}), {code: 'receipt_timeout'});
  assert.deepEqual(executor.pending(account).map(pending => pending.hash), [hash, secondHash]);
  releaseReceipt(receipt);
  const settled = await reconciling;
  assert.equal(settled.length, 1);
  assert.deepEqual(executor.pending(account).map(pending => pending.hash), [secondHash]);
});

test("replacement and nonce metadata are kept on the individual pending record", async () => {
  const replacementHash = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as Hash;
  const api = clients(async () => hash);
  api.publicClient.getTransaction = async () => ({ nonce: 7 });
  api.publicClient.waitForTransactionReceipt = async options => {
    options.onReplaced?.({ reason: "repriced", transaction: { hash: replacementHash } });
    throw Object.assign(new Error("timeout"), { name: "WaitForTransactionReceiptTimeoutError" });
  };
  const executor = new V1TransactionExecutor(api, journal());
  await assert.rejects(executor.execute({ ...input(async () => {}), operationKey: "trade:buy:market-a:10:rev" }), { code: "receipt_timeout" });
  const [pending] = executor.pending(account);
  assert.equal(pending?.hash, replacementHash);
  assert.equal(pending?.nonce, 7);
  assert.equal(pending?.stage, "replaced");
  assert.equal(pending?.replacementReason, "repriced");
});

test("a saved claim remains the same conflict after the read revision changes", async () => {
  let writes=0;
  const api=clients(async()=>{writes+=1;return hash;});
  api.publicClient.waitForTransactionReceipt=async()=>{throw Object.assign(new Error("timeout"),{name:"WaitForTransactionReceiptTimeoutError"});};
  const executor=new V1TransactionExecutor(api,journal());
  const base="reward:user-claim:market-a:creator:4:0x1111111111111111111111111111111111111111";
  await assert.rejects(executor.execute({...input(async()=>{}),operationKey:`${base}:rev-1`,request:{...request,functionName:"claim"}}),{code:"receipt_timeout"});
  await assert.rejects(executor.execute({...input(async()=>{}),operationKey:`${base}:rev-2`,request:{...request,functionName:"claim",args:[4n]}}),{code:"pending_transaction"});
  assert.equal(writes,1);
});

test("legacy single-record journals migrate into the wallet and chain record list", () => {
  const data=new Map<string,string>();
  const legacyKey=`tickergarden:pending:${chain.id}:${account.toLowerCase()}`;
  const v2Key=`tickergarden:pending:v2:${chain.id}:${account.toLowerCase()}`;
  data.set(legacyKey,JSON.stringify({intent:"legacy-intent",hash,approval:false,operationKey:"trade:buy:market-a:1:rev"}));
  const storage={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);},removeItem:(key:string)=>{data.delete(key);}};
  const [migrated]=new V1TransactionExecutor(clients(async()=>hash),storage).pending(account);
  assert.equal(migrated?.businessType,"trade");
  assert.equal(migrated?.marketId,"market-a");
  assert.equal(data.has(legacyKey),false);
  assert.equal(data.has(v2Key),true);
});

test("all staking mutations for one market share a state dependency", () => {
  const keys=["reward:stake:market-a:user:rev","reward:unstakeAndWithdraw:market-a:user:rev","reward:rageQuit:market-a:user:rev","reward:direct-vault-rage-quit:market-a:user:1"];
  assert.deepEqual(new Set(keys.map(key=>transactionScopeForOperation(key).conflictKey)),new Set(["stake:market-a"]));
});

for (const [label,error,code] of [
 ['wallet rejection',Object.assign(new Error('User rejected'),{code:4001}),'user_rejected'],
 ['wallet submission failure',new Error('insufficient funds'),'submission_failed'],
] as const) test(`${label} never creates a saved pending transaction`,async()=>{
 const executor=new V1TransactionExecutor(clients(async()=>{throw error;}),journal());
 await assert.rejects(executor.execute(input(async()=>{})),{code});
 assert.deepEqual(executor.pending(account),[]);
});

test('retirement preserves an archive and only removes the exact saved hash',async()=>{
 const storage=journal(),api=clients(async()=>hash);
 api.publicClient.waitForTransactionReceipt=async()=>{throw Object.assign(new Error('timeout'),{name:'WaitForTransactionReceiptTimeoutError'});};
 const executor=new V1TransactionExecutor(api,storage);
 await assert.rejects(executor.execute(input(async()=>{})));
 const record=executor.pending(account)[0]!;
 assert.equal(executor.retirePending(account,record.operationKey,`0x${'f'.repeat(64)}`,'nonce_consumed'),false);
 assert.equal(executor.pending(account).length,1);
 executor.rememberPendingNonce(account,record.operationKey,hash,9);
 assert.equal(executor.pending(account)[0]!.nonce,9);
 executor.rememberPendingNonce(account,record.operationKey,hash,10);
 assert.equal(executor.pending(account)[0]!.nonce,9);
 assert.equal(executor.retirePending(account,record.operationKey,hash,'nonce_consumed'),true);
 assert.equal(executor.pending(account).length,0);
});

test('unobserved submission releases the lock but preserves its unresolved diagnostic record',async()=>{
 const storage=journal(),api=clients(async()=>hash);
 api.publicClient.waitForTransactionReceipt=async()=>{throw Object.assign(new Error('timeout'),{name:'WaitForTransactionReceiptTimeoutError'});};
 const executor=new V1TransactionExecutor(api,storage);
 await assert.rejects(executor.execute(input(async()=>{})));
 const record=executor.pending(account)[0]!;
 assert.equal(executor.retirePending(account,record.operationKey,hash,'submission_unobserved'),true);
 const archived=JSON.parse(storage.getItem(`tickergarden:pending:v2:4663:${account}:archive:${hash}`)!);
 assert.equal(archived.reason,'submission_unobserved');
 assert.equal(archived.hash,hash);
 assert.equal(archived.stage,record.stage);
 assert.ok(archived.retiredAt>=record.createdAt);
 assert.deepEqual(executor.pending(account),[]);
 assert.equal(executor.retirePending(account,record.operationKey,hash,'submission_unobserved'),false);
});

test('trade wallet silence releases the operation at 20 seconds and late hash is archive-only',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let respond!:(hash:Hash)=>void;let entered=false,confirmed=0,late=0;
 const storage=journal(),api=clients(()=>{entered=true;return new Promise(resolve=>{respond=resolve;});});
 const executor=new V1TransactionExecutor({...api,onLateSubmission:()=>{late++;}},storage);
 const execution=executor.execute({...input(async()=>{}),operationKey:'trade:buy:market-a:timeout',confirm:async()=>{confirmed++;}});
 const rejection=assert.rejects(execution,{code:'wallet_response_timeout'});
 while(!entered)await Promise.resolve();
 t.mock.timers.tick(20000);await rejection;
 assert.deepEqual(executor.pending(account),[]);
 respond(hash);await Promise.resolve();await Promise.resolve();
 assert.equal(confirmed,0);assert.equal(late,1);
 assert.deepEqual(executor.pending(account),[]);
 assert.equal(JSON.parse(storage.getItem(`tickergarden:pending:v2:4663:${account}:archive:${hash}`)!).reason,'late_wallet_response');
});
test('optional nonce lookup cannot delay a successful trade receipt',async()=>{
 const api=clients(async()=>hash);api.publicClient.getTransaction=()=>new Promise(()=>{});
 let confirmed=false;
 const executor=new V1TransactionExecutor(api,journal());
 await executor.execute({...input(async()=>{}),operationKey:'trade:buy:market-a:nonce',confirm:async()=>{confirmed=true;}});
 assert.equal(confirmed,true);assert.deepEqual(executor.pending(account),[]);
});

test('manual and automatic recovery verify and commit before clearing the same hash',async()=>{
 const api=clients(async()=>hash),storage=journal();
 api.publicClient.waitForTransactionReceipt=async()=>{throw Error('offline');};
 const executor=new V1TransactionExecutor(api,storage);await assert.rejects(executor.execute(input(async()=>{})));
 api.publicClient.getTransactionReceipt=async()=>receipt;
 let committed=0;
 const bad={verify:async()=>{throw Error('wrong block');},commit:async()=>{committed++;}};
 assert.equal(await executor.reconcilePending(account,'transaction-test',bad),null);
 assert.deepEqual(await executor.reconcileSettledPending(account,bad),[]);
 assert.equal(executor.pending(account).length,1);assert.equal(committed,0);
 const failedCommit={verify:async()=>{},commit:async()=>{throw Error('disk full');}};
 assert.equal(await executor.reconcilePending(account,'transaction-test',failedCommit),null);assert.equal(executor.pending(account).length,1);
 const events:string[]=[];
 assert.ok(await executor.reconcilePending(account,'transaction-test',{verify:async()=>{events.push('verify');},commit:async()=>{assert.equal(executor.pending(account).length,1);events.push('commit');}}));
 assert.deepEqual(events,['verify','commit']);assert.deepEqual(executor.pending(account),[]);
});
test('trade-scoped standalone approval has the same 20 second wallet deadline',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let entered=false;
 const api=clients(()=>{entered=true;return new Promise(()=>{});});
 const executor=new V1TransactionExecutor(api,journal());
 const result=executor.execute({...input(async()=>{}),operationKey:'pool-approval:market-a:100'});
 const rejection=assert.rejects(result,{code:'wallet_response_timeout'});
 while(!entered)await Promise.resolve();t.mock.timers.tick(20000);await rejection;assert.deepEqual(executor.pending(account),[]);
});
test('wallet and receipt share one 20 second deadline even when RPC ignores timeout options',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
 let walletCalled=false,receiptCalled=false,finished=false;
 const api=clients(async()=>{walletCalled=true;await new Promise(r=>setTimeout(r,10000));return hash;});
 api.publicClient.waitForTransactionReceipt=async()=>{receiptCalled=true;return new Promise(()=>{});};
 const executor=new V1TransactionExecutor(api,journal());
 const promise=executor.execute({...input(async()=>{}),operationKey:'pool-approval:market-budget:100'});
 const rejection=assert.rejects(promise,{code:'receipt_timeout'}).then(()=>{finished=true;});
 while(!walletCalled)await Promise.resolve();t.mock.timers.tick(10000);
 while(!receiptCalled)await Promise.resolve();t.mock.timers.tick(9999);await Promise.resolve();assert.equal(finished,false);
 t.mock.timers.tick(1);await rejection;assert.equal(finished,true);assert.equal(executor.pending(account).length,1);
});

for(const operationKey of ['launch:direct:market','reward:stake:market','reward:user-claim:market:creator:1:wallet','reward:snapshot:market:1:wallet','reward:user-claim:market:staker:0:wallet','approval:asset:spender'])test(`${operationKey} ends silent wallet waiting and archives late results without continuing`,async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let entered=false,confirmations=0;let respond!:(hash:Hash)=>void;
 const storage=journal(),api=clients(()=>{entered=true;return new Promise(resolve=>{respond=resolve;});});
 const executor=new V1TransactionExecutor(api,storage);
 const promise=executor.execute({...input(async()=>{}),operationKey,confirm:async()=>{confirmations++;}});
 const rejection=assert.rejects(promise,{code:'wallet_response_timeout'});
 while(!entered)await Promise.resolve();t.mock.timers.tick(20000);await rejection;
 respond(hash);await Promise.resolve();await Promise.resolve();assert.equal(confirmations,0);
 const reloaded=new V1TransactionExecutor(api,storage);
 assert.equal(reloaded.archived(account).length,1);assert.deepEqual(reloaded.pending(account),[]);
 assert.deepEqual(reloaded.archived(contract),[]);
 reloaded.completeArchived(account,hash);assert.deepEqual(reloaded.archived(account),[]);
});
test('archive observation expires and invalid entries do not affect current pending state',async()=>{
 const storage=journal(),api=clients(async()=>hash);api.publicClient.waitForTransactionReceipt=async()=>{throw Error('offline');};
 const executor=new V1TransactionExecutor(api,storage);await assert.rejects(executor.execute(input(async()=>{})));
 assert.equal(executor.retirePending(account,'transaction-test',hash,'foreground_timeout'),true);
 assert.equal(executor.archived(account).length,1);
 assert.deepEqual(executor.archived(account,Date.now()+86400001),[]);
 storage.setItem(`tickergarden:pending:v2:4663:${account}:archive:index`,'["unrelated"]');
 assert.deepEqual(executor.archived(account),[]);
});

 test('reward receipt transport cannot hold the foreground beyond twenty seconds',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});let waiting=false;
 const api=clients(async()=>hash);api.publicClient.waitForTransactionReceipt=async()=>{waiting=true;return new Promise(()=>{});};
 const executor=new V1TransactionExecutor(api,journal());
 const result=executor.execute({...input(async()=>{}),operationKey:'reward:user-claim:market:0:1:wallet'});
 const rejection=assert.rejects(result,{code:'receipt_timeout'});
 while(!waiting)await Promise.resolve();t.mock.timers.tick(20000);await rejection;
 assert.equal(executor.pending(account)[0]!.businessType,'claim');
 });
