import {recoveryRead,recoveryWrite,recoveryRemove} from './recoveryStorage.ts';
import {V1_EXECUTION_SPEC_ID} from './generated/abi-identity.ts';
import type {
  Abi,
  Account,
  Address,
  Chain,
  ContractFunctionArgs,
  ContractFunctionName,
  Hash,
  TransactionReceipt,
} from "viem";
import { ROBINHOOD_CHAIN_ID } from "./chain.ts";


export type TransactionFailureCode =
  | "pending_transaction"
  | "unsupported_chain"
  | "wrong_account"
  | "stale_quote"
  | "stale_snapshot"
  | "indexer_lagging"
  | "indexer_unavailable"
  | "simulation_failed"
  | "user_rejected"
  | "submission_failed"
  | "approval_reverted"
  | "transaction_reverted"
  | "replacement_cancelled"
  | "receipt_timeout"
  | "confirmation_failed";

export class V1TransactionError extends Error {
  readonly code: TransactionFailureCode;
  readonly cause?: unknown;

  constructor(
    code: TransactionFailureCode,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "V1TransactionError";
    this.code = code;
    this.cause = cause;
  }
}

export type TransactionStage =
  | "preflight"
  | "simulating_approval"
  | "awaiting_approval_signature"
  | "approval_submitted"
  | "approval_confirmed"
  | "simulating"
  | "awaiting_signature"
  | "submitted"
  | "pending"
  | "replaced"
  | "confirming"
  | "confirmed"
  | "unknown"
  | "failed";

export interface TransactionUpdate {
  readonly operationKey: string;
  readonly stage: TransactionStage;
  readonly hash?: Hash;
  readonly replacementReason?: "repriced" | "replaced" | "cancelled";
  readonly error?: V1TransactionError;
}

export interface ReconciledSnapshot {
  readonly executionSpecId: string;
  readonly revision: string;
  readonly syncStatus: "synced" | "lagging" | "unavailable";
 readonly authority?: "direct-chain";
}

export interface ContractWriteRequest {
  readonly abi: Abi | readonly unknown[];
  readonly address: Address;
  readonly functionName: string;
  readonly args?: readonly unknown[];
  readonly value?: bigint;
  readonly gas?: bigint;
}

export function createContractWriteRequest<
  const abi extends Abi | readonly unknown[],
  functionName extends ContractFunctionName<abi, "payable" | "nonpayable">,
>(request: {
  readonly abi: abi;
  readonly address: Address;
  readonly functionName: functionName;
  readonly args: ContractFunctionArgs<abi, "payable" | "nonpayable", functionName>;
  readonly value?: bigint;
}): ContractWriteRequest {
  return request as ContractWriteRequest;
}

interface SimulatedRequest { readonly request: unknown }
interface Replacement {
  readonly reason: "repriced" | "replaced" | "cancelled";
  readonly transaction: { readonly hash: Hash };
}

export interface V1TransactionClients {
  readonly publicClient: {
    simulateContract(request: ContractWriteRequest & { readonly account: Address }): Promise<SimulatedRequest>;
    getTransactionReceipt?(options: { readonly hash: Hash }): Promise<TransactionReceipt>;
    getTransaction?(options: { readonly hash: Hash }): Promise<{ readonly nonce: number }>;
    waitForTransactionReceipt(options: {
      readonly hash: Hash;
      readonly confirmations?: number;
      readonly pollingInterval?: number;
      readonly timeout?: number;
      readonly onReplaced?: (replacement: Replacement) => void;
    }): Promise<TransactionReceipt>;
  };
  readonly walletClient: {
    readonly account?: Account | Address | null;
    readonly chain?: Chain | null;
    writeContract(request: unknown): Promise<Hash>;
  };
}

export interface ExecuteV1Transaction<T> {
  readonly operationKey: string;
  readonly scope?: TransactionScope;
  readonly expectedAccount: Address;
  readonly snapshot: ReconciledSnapshot;
  readonly request: ContractWriteRequest;
  readonly approval?: ContractWriteRequest;
  readonly quoteExpiresAtMs?: number;
  readonly confirmations?: number;
  /** Revalidates the injected provider and the caller-owned wallet generation. */
  readonly verifyWalletContext?: () => Promise<void>;
  readonly currentRevision?: () => Promise<string>;
  readonly confirm: (receipt: TransactionReceipt, hash: Hash) => Promise<T>;
  readonly onUpdate?: (update: TransactionUpdate) => void;
  readonly now?: () => number;
}

function accountAddress(account: Account | Address | null | undefined): Address | undefined {
  return typeof account === "string" ? account : account?.address;
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function isUserRejected(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; name?: unknown; cause?: unknown };
  return candidate.code === 4001 || candidate.name === "UserRejectedRequestError" || isUserRejected(candidate.cause);
}

function isReceiptTimeout(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { name?: unknown }).name === "WaitForTransactionReceiptTimeoutError");
}

export interface PendingTransaction {
  readonly intent: string;
  readonly hash: Hash;
  readonly approval: boolean;
  readonly operationKey: string;
  readonly businessType: TransactionBusinessType;
  readonly marketId?: string;
  readonly conflictKey: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly nonce?: number;
  readonly stage?: "pending" | "replaced" | "unknown";
  readonly replacementReason?: "repriced" | "replaced" | "cancelled";
  readonly cancelled?: boolean;
}

export type TransactionBusinessType = "trade" | "claim" | "stake" | "launch" | "approval" | "settlement" | "handoff" | "treasury" | "other";

export interface TransactionScope {
  readonly businessType: TransactionBusinessType;
  readonly marketId?: string;
  /** Operations sharing this key depend on the same mutable state and must run serially. */
  readonly conflictKey: string;
}

interface PendingTransactionJournalV2 {
  readonly version: 2;
  readonly records: readonly PendingTransaction[];
}

export interface ReconciledPendingTransaction {
  readonly pending: PendingTransaction;
  readonly receipt: TransactionReceipt;
  readonly approval: boolean;
  readonly cancelled: boolean;
}

export interface TransactionJournal {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Browser persistence is required when available; inaccessible storage fails before signing. */
function defaultJournal(): TransactionJournal {
  if (typeof window !== "undefined") return window.localStorage;
  const entries = new Map<string, string>();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => { entries.set(key, value); },
    removeItem: (key) => { entries.delete(key); },
  };
}

function transactionIntent(request: ContractWriteRequest): string {
  return JSON.stringify([request.address.toLowerCase(), request.functionName, request.args ?? [], request.value ?? 0n],
    (_key, value: unknown) => typeof value === "bigint" ? value.toString() : value);
}

export function transactionScopeForOperation(operationKey: string): TransactionScope {
  const parts = operationKey.split(":");
  if (parts[0] === "trade" && parts[2]) return { businessType: "trade", marketId: parts[2], conflictKey: `trade:${parts[2]}` };
  if ((parts[0] === "pool-trade" || parts[0] === "pool-approval") && parts[1 + (parts[0] === "pool-trade" ? 1 : 0)]) {
    const marketId = parts[0] === "pool-trade" ? parts[2] : parts[1];
    return { businessType: parts[0] === "pool-trade" ? "trade" : "approval", marketId, conflictKey: `trade:${marketId}` };
  }
  if (parts[0] === "launch" && parts[2]) return { businessType: "launch", marketId: parts[2], conflictKey: `launch:${parts[2]}` };
  if (parts[0] === "approval") return { businessType: "approval", conflictKey: operationKey };
  if (parts[0] === "reward") {
    const action = parts[1] ?? "other";
    const marketId = parts[2] || undefined;
    if (action === "snapshot") return { businessType: "claim", marketId, conflictKey: `claim:${marketId}:${parts[3] ?? ""}:${parts[4] ?? ""}` };
    if (action === "user-claim") return { businessType: "claim", marketId, conflictKey: `claim:${marketId}:${parts[3] ?? ""}:${parts[4] ?? ""}:${parts[5] ?? ""}` };
    if (["stake", "unstake", "unstakeAndWithdraw", "rageQuit", "rage-quit", "direct-vault-rage-quit"].includes(action)) return { businessType: "stake", marketId, conflictKey: `stake:${marketId ?? operationKey}` };
    if (action === "settle") return { businessType: "settlement", marketId, conflictKey: `settlement:${marketId ?? operationKey}` };
    if (action === "creator-handoff") return { businessType: "handoff", marketId, conflictKey: `handoff:${marketId ?? operationKey}` };
    if (action === "treasury") return { businessType: "treasury", marketId: parts[3] || undefined, conflictKey: operationKey };
  }
  return { businessType: "other", conflictKey: operationKey };
}

function validScope(scope: TransactionScope): boolean {
  return ["trade", "claim", "stake", "launch", "approval", "settlement", "handoff", "treasury", "other"].includes(scope.businessType)
    && typeof scope.conflictKey === "string" && scope.conflictKey.length > 0 && scope.conflictKey.length <= 512
    && (scope.marketId === undefined || (typeof scope.marketId === "string" && scope.marketId.length > 0 && scope.marketId.length <= 256));
}

export class V1TransactionExecutor {
  readonly #inflight = new Map<string, { readonly promise: Promise<unknown>; readonly scope: TransactionScope }>();
  readonly clients: V1TransactionClients;

  readonly journal: TransactionJournal;

  constructor(clients: V1TransactionClients, journal: TransactionJournal = defaultJournal()) {
    this.clients = clients;
    this.journal = journal;
  }

  #journalKey(account: Address): string {
    return `tickergarden:pending:v2:${this.clients.walletClient.chain?.id}:${account.toLowerCase()}`;
  }

  #legacyJournalKey(account: Address): string {
    return `tickergarden:pending:${this.clients.walletClient.chain?.id}:${account.toLowerCase()}`;
  }

  #validatePending(value: unknown): PendingTransaction {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new V1TransactionError("pending_transaction", "Saved transaction record is invalid; check wallet history before continuing");
    const parsed = value as Partial<PendingTransaction>;
    const scope = { businessType: parsed.businessType, marketId: parsed.marketId, conflictKey: parsed.conflictKey } as TransactionScope;
    if (!/^0x[0-9a-fA-F]{64}$/.test(parsed.hash ?? "") || typeof parsed.intent !== "string" || typeof parsed.approval !== "boolean"
      || typeof parsed.operationKey !== "string" || !parsed.operationKey || parsed.operationKey.length > 512 || !validScope(scope)
      || typeof parsed.createdAt !== "number" || !Number.isFinite(parsed.createdAt) || typeof parsed.updatedAt !== "number" || !Number.isFinite(parsed.updatedAt)
      || (parsed.nonce !== undefined && (!Number.isSafeInteger(parsed.nonce) || parsed.nonce < 0))
      || (parsed.stage !== undefined && !["pending", "replaced", "unknown"].includes(parsed.stage))
      || (parsed.replacementReason !== undefined && !["repriced", "replaced", "cancelled"].includes(parsed.replacementReason))
      || (parsed.cancelled !== undefined && typeof parsed.cancelled !== "boolean")) {
      throw new V1TransactionError("pending_transaction", "Pending transaction journal is invalid; reconcile wallet history before continuing");
    }
    return parsed as PendingTransaction;
  }

  #writePending(account: Address, records: readonly PendingTransaction[]): void {
    const key = this.#journalKey(account);
    if (!records.length) { recoveryRemove(this.journal,key); return; }
    recoveryWrite(this.journal,key, JSON.stringify({ version: 2, records } satisfies PendingTransactionJournalV2));
  }

  pending(account: Address): readonly PendingTransaction[] {
    const raw = recoveryRead(this.journal,this.#journalKey(account));
    if (!raw) {
      const legacyRaw = recoveryRead(this.journal,this.#legacyJournalKey(account));
      if (!legacyRaw) return [];
      let legacy: { intent?: unknown; hash?: unknown; approval?: unknown; operationKey?: unknown; cancelled?: unknown };
      try { legacy = JSON.parse(legacyRaw) as typeof legacy; }
      catch { throw new V1TransactionError("pending_transaction", "Saved transaction record cannot be read; check wallet history before continuing"); }
      if (!legacy || typeof legacy !== "object" || Array.isArray(legacy) || typeof legacy.operationKey !== "string" || !legacy.operationKey) {
        throw new V1TransactionError("pending_transaction", "Saved transaction record is invalid; check wallet history before continuing");
      }
      const scope = transactionScopeForOperation(legacy.operationKey);
      const now = Date.now();
      const migrated = this.#validatePending({ ...legacy, ...scope, operationKey: legacy.operationKey, createdAt: now, updatedAt: now, stage: "unknown" });
      this.#writePending(account, [migrated]);
      recoveryRemove(this.journal,this.#legacyJournalKey(account));
      return [migrated];
    }
    let parsed: PendingTransactionJournalV2;
    try { parsed = JSON.parse(raw) as PendingTransactionJournalV2; }
    catch { throw new V1TransactionError("pending_transaction", "Saved transaction record cannot be read; check wallet history before continuing"); }
    if (!parsed || typeof parsed !== "object" || parsed.version !== 2 || !Array.isArray(parsed.records)) throw new V1TransactionError("pending_transaction", "Saved transaction record is invalid; check wallet history before continuing");
    const records = parsed.records.map(record => this.#validatePending(record));
    if (new Set(records.map(record => record.operationKey)).size !== records.length) throw new V1TransactionError("pending_transaction", "Pending transaction journal contains duplicate operations; reconcile wallet history before continuing");
    return records;
  }

  #replacePending(account: Address, record: PendingTransaction): void {
    const records = this.pending(account);
    this.#writePending(account, [...records.filter(item => item.operationKey !== record.operationKey), record]);
  }

  #removePending(account: Address, operationKey: string): void {
    this.#writePending(account, this.pending(account).filter(item => item.operationKey !== operationKey));
  }

  /** Archive a specific record after external canonical nonce verification or explicit retry consent. */
  retirePending(account:Address,operationKey:string,hash:Hash,reason:'nonce_consumed'|'retry_authorized'):boolean {
    const record=this.pending(account).find(p=>p.operationKey===operationKey&&p.hash===hash);
    if(!record||this.#inflight.has(operationKey))return false;
    const key=`${this.#journalKey(account)}:archive:${hash}`;
    this.journal.setItem(key,JSON.stringify({...record,retiredAt:Date.now(),reason}));
    this.#removePending(account,operationKey);return true;
  }

  rememberPendingNonce(account:Address,operationKey:string,hash:Hash,nonce:number):void {
    const record=this.pending(account).find(p=>p.operationKey===operationKey&&p.hash===hash);
    if(record&&Number.isSafeInteger(nonce)&&nonce>=0&&(record.nonce===undefined||record.nonce===nonce))this.#replacePending(account,{...record,nonce});
  }

  /** Batch-checks every saved hash and clears only records that already have a receipt. */
  async reconcileSettledPending(account: Address, options: {filter?:(pending:PendingTransaction)=>boolean;verify?:(result:ReconciledPendingTransaction)=>Promise<void>} = {}): Promise<readonly ReconciledPendingTransaction[]> {
    const records = this.pending(account);
    if (!records.length || !this.clients.publicClient.getTransactionReceipt) return [];
    const results = await Promise.all(records.filter(p=>!options.filter||options.filter(p)).map(async pending => {
      try {
        const receipt = await this.clients.publicClient.getTransactionReceipt!({ hash: pending.hash });
        const result={ pending, receipt, approval: pending.approval, cancelled: pending.cancelled ?? false } satisfies ReconciledPendingTransaction;
        await options.verify?.(result);
        return result;
      } catch (error) {
        if (error instanceof Error && error.name === "TransactionReceiptNotFoundError") return null;
        // A transient failure for one hash must not prevent other mined records
        // from being reconciled during wallet restore.
        return null;
      }
    }));
    const settled = results.filter((result): result is ReconciledPendingTransaction => result !== null);
    if (settled.length) {
      const settledKeys = new Set(settled.map(result => result.pending.operationKey));
      this.#writePending(account, this.pending(account).filter(record => !settledKeys.has(record.operationKey) || !settled.some(r=>r.pending.operationKey===record.operationKey&&r.pending.hash===record.hash)));
    }
    return settled;
  }

  /** Explicit receipt recovery never creates a new wallet transaction. */
  async reconcilePending(account: Address, operationKey: string): Promise<ReconciledPendingTransaction | null> {
    const pending = this.pending(account).find(record => record.operationKey === operationKey);
    if (!pending) return null;
    let cancelled = pending.cancelled ?? false;
    const receipt = await this.clients.publicClient.waitForTransactionReceipt({
      hash: pending.hash,
      pollingInterval: 3_000,
      timeout: 30_000,
      onReplaced: (replacement) => {
        cancelled = replacement.reason === "cancelled";
        this.#replacePending(account, { ...pending, hash: replacement.transaction.hash, cancelled, stage: "replaced", replacementReason: replacement.reason, updatedAt: Date.now() });
      },
    });
    this.#removePending(account, operationKey);
    return { pending, receipt, approval: pending.approval, cancelled };
  }

  execute<T>(input: ExecuteV1Transaction<T>): Promise<T> {
    const existing = this.#inflight.get(input.operationKey)?.promise as Promise<T> | undefined;
    if (existing) return existing;
    const scope = input.scope ?? transactionScopeForOperation(input.operationKey);
    const activeConflict = [...this.#inflight.values()].find(item => item.scope.conflictKey === scope.conflictKey);
    if (activeConflict) return Promise.reject(new V1TransactionError("pending_transaction", "A dependent transaction for this market is already running"));
    const pending = this.#execute(input).finally(() => this.#inflight.delete(input.operationKey));
    this.#inflight.set(input.operationKey, { promise: pending, scope });
    return pending;
  }

  async #execute<T>(input: ExecuteV1Transaction<T>): Promise<T> {
    const emit = (update: Omit<TransactionUpdate, "operationKey">) => input.onUpdate?.({ operationKey: input.operationKey, ...update });
    try {
      emit({ stage: "preflight" });
      const scope = input.scope ?? transactionScopeForOperation(input.operationKey);
      const records = this.pending(input.expectedAccount);
      const intent=transactionIntent(input.request);
      const exact=records.find(record => record.operationKey === input.operationKey);
      if(exact&&exact.intent!==intent)throw new V1TransactionError("pending_transaction",`The saved operation does not match this transaction request: ${exact.hash}`);
      const unresolved = exact ?? records.find(record => record.intent === intent);
      const conflict = records.find(record => record.conflictKey === scope.conflictKey && record.operationKey !== unresolved?.operationKey);
      if (conflict) throw new V1TransactionError("pending_transaction", `A dependent transaction for this market is still pending: ${conflict.hash}`);
      if (unresolved) {
        const connected = accountAddress(this.clients.walletClient.account);
        if (!connected || !sameAddress(connected, input.expectedAccount)) throw new V1TransactionError("wrong_account", "Reconnect the original account to recover its transaction");
        await this.#verifyWalletContext(input);
      } else {
        await this.#assertFresh(input, "before simulation");
      }

      if (unresolved?.approval || (input.approval && !unresolved)) {
        await this.#sendAndConfirm(input.approval ?? input.request, input, emit, true);
        await this.#assertFresh(input, "after approval");
      }

      const { receipt, hash } = await this.#sendAndConfirm(input.request, input, emit, false);
      emit({ stage: "confirming", hash });
      try {
        const confirmed = await input.confirm(receipt, hash);
        this.#removePending(input.expectedAccount, unresolved?.operationKey ?? input.operationKey);
        emit({ stage: "confirmed", hash });
        return confirmed;
      } catch (error) {
        throw new V1TransactionError("confirmation_failed", "transaction receipt could not be reconciled with fresh chain facts", error);
      }
    } catch (error) {
      const typed = error instanceof V1TransactionError ? error : new V1TransactionError("submission_failed", "transaction workflow failed", error);
      emit({ stage: ["pending_transaction", "receipt_timeout", "confirmation_failed"].includes(typed.code) ? "unknown" : "failed", error: typed });
      throw typed;
    }
  }

  #assertPreflight<T>(input: ExecuteV1Transaction<T>): void {
    const chainId = this.clients.walletClient.chain?.id;
    if (chainId !== ROBINHOOD_CHAIN_ID) throw new V1TransactionError("unsupported_chain", `wallet must use chain ${ROBINHOOD_CHAIN_ID}`);
    const connected = accountAddress(this.clients.walletClient.account);
    if (!connected || !sameAddress(connected, input.expectedAccount)) throw new V1TransactionError("wrong_account", "connected wallet does not match the expected account");
    if (input.snapshot.executionSpecId !== V1_EXECUTION_SPEC_ID) throw new V1TransactionError("stale_snapshot", "snapshot execution spec does not match the generated ABI");
    if (input.snapshot.authority === "direct-chain" && (!input.currentRevision || !input.verifyWalletContext)) throw new V1TransactionError("stale_snapshot", "Direct transactions require live state and wallet checks");
    if (input.snapshot.authority !== "direct-chain" && input.snapshot.syncStatus === "lagging") throw new V1TransactionError("indexer_lagging", "Indexer snapshot is lagging");
    if (input.snapshot.authority !== "direct-chain" && input.snapshot.syncStatus === "unavailable") throw new V1TransactionError("indexer_unavailable", "Indexer snapshot is unavailable");
    if (!input.snapshot.revision) throw new V1TransactionError("stale_snapshot", "snapshot revision is required");
    if (input.quoteExpiresAtMs !== undefined && (input.now ?? Date.now)() >= input.quoteExpiresAtMs) {
      throw new V1TransactionError("stale_quote", "quote expired before simulation");
    }
  }

  async #assertFresh<T>(input: ExecuteV1Transaction<T>, phase: string): Promise<void> {
    this.#assertPreflight(input);
    await this.#verifyWalletContext(input);
    if (input.currentRevision && await input.currentRevision() !== input.snapshot.revision) {
      throw new V1TransactionError("stale_snapshot", `the reconciled read snapshot changed ${phase}`);
    }
    // Both the canonical-state check above and the wallet provider are asynchronous.
    // Recheck after them so an accountsChanged/chainChanged event cannot race signing.
    this.#assertPreflight(input);
    await this.#verifyWalletContext(input);
  }

  async #verifyWalletContext<T>(input: ExecuteV1Transaction<T>): Promise<void> {
    if (!input.verifyWalletContext) return;
    try {
      await input.verifyWalletContext();
    } catch (error) {
      if (error instanceof V1TransactionError) throw error;
      throw new V1TransactionError("wrong_account", "live wallet context no longer matches this transaction", error);
    }
  }

  async #sendAndConfirm<T>(
    request: ContractWriteRequest,
    input: ExecuteV1Transaction<T>,
    emit: (update: Omit<TransactionUpdate, "operationKey">) => void,
    approval: boolean,
  ): Promise<{ readonly receipt: TransactionReceipt; readonly hash: Hash }> {
    const account = accountAddress(this.clients.walletClient.account)!;
    const key = this.#journalKey(input.expectedAccount);
    const scope = input.scope ?? transactionScopeForOperation(input.operationKey);
    const pending = this.pending(input.expectedAccount).find(record => record.operationKey === input.operationKey)
      ?? this.pending(input.expectedAccount).find(record => record.intent === transactionIntent(input.request));
    const recordOperationKey = pending?.operationKey ?? input.operationKey;
    let hash: Hash;
    if (pending) {
      hash = pending.hash;
    } else {
      // Probe persistence before asking the wallet to broadcast.
      this.journal.setItem(`${key}:probe`, "1");
      this.journal.removeItem(`${key}:probe`);
      emit({ stage: approval ? "simulating_approval" : "simulating" });
      let simulation: SimulatedRequest;
      try {
        simulation = await this.clients.publicClient.simulateContract({ ...request, account });
      } catch (error) {
        throw new V1TransactionError("simulation_failed", approval ? "approval simulation failed" : "transaction simulation failed", error);
      }
      await this.#assertFresh(input, approval ? "after approval simulation" : "after transaction simulation");
      emit({ stage: approval ? "awaiting_approval_signature" : "awaiting_signature" });
      try {
        hash = await this.clients.walletClient.writeContract(simulation.request);
      } catch (error) {
        if (isUserRejected(error)) throw new V1TransactionError("user_rejected", "wallet signature was rejected", error);
        throw new V1TransactionError("submission_failed", approval ? "approval submission failed" : "transaction submission failed", error);
      }
      const now = (input.now ?? Date.now)();
      const record: PendingTransaction = { intent: transactionIntent(input.request), hash, approval, operationKey: input.operationKey, ...scope, createdAt: now, updatedAt: now, stage: "pending" };
      this.#replacePending(input.expectedAccount, record);
      if (this.clients.publicClient.getTransaction) {
        try {
          const transaction = await this.clients.publicClient.getTransaction({ hash });
          this.#replacePending(input.expectedAccount, { ...record, nonce: transaction.nonce, updatedAt: (input.now ?? Date.now)() });
        } catch { /* A nonce hint is optional; the hash remains recoverable. */ }
      }
    }
    emit({ stage: approval ? "approval_submitted" : "submitted", hash });
    if (!approval) emit({ stage: "pending", hash });
    let finalHash = hash;
    let cancelled = pending?.cancelled ?? false;
    let receipt: TransactionReceipt;
    try {
      receipt = await this.clients.publicClient.waitForTransactionReceipt({
        hash,
        ...(input.confirmations === undefined ? {} : { confirmations: input.confirmations }),
        onReplaced: (replacement) => {
          finalHash = replacement.transaction.hash;
          cancelled = replacement.reason === "cancelled";
          const existing = this.pending(input.expectedAccount).find(record => record.operationKey === recordOperationKey);
          const now = (input.now ?? Date.now)();
          this.#replacePending(input.expectedAccount, { ...(existing ?? { intent: transactionIntent(input.request), approval, operationKey: recordOperationKey, ...scope, createdAt: now }), hash: finalHash, cancelled, stage: "replaced", replacementReason: replacement.reason, updatedAt: now });
          emit({ stage: "replaced", hash: finalHash, replacementReason: replacement.reason });
        },
      });
    } catch (error) {
      const existing=this.pending(input.expectedAccount).find(record=>record.operationKey===recordOperationKey);
      if(existing&&existing.stage!=="replaced")this.#replacePending(input.expectedAccount,{...existing,stage:"unknown",updatedAt:(input.now??Date.now)()});
      if (isReceiptTimeout(error)) throw new V1TransactionError("receipt_timeout", "timed out waiting for a canonical receipt", error);
      throw new V1TransactionError("pending_transaction", `Transaction outcome is unknown; check ${finalHash} before retrying`, error);
    }
    if (cancelled || receipt.status !== "success" || approval) this.#removePending(input.expectedAccount, recordOperationKey);
    if (cancelled) throw new V1TransactionError("replacement_cancelled", "transaction was replaced by a cancellation");
    if (receipt.status !== "success") {
      throw new V1TransactionError(approval ? "approval_reverted" : "transaction_reverted", approval ? "approval reverted" : "transaction reverted");
    }
    if (approval) emit({ stage: "approval_confirmed", hash: finalHash });
    return { receipt, hash: finalHash };
  }
}
