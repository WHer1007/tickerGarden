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
import { V1_EXECUTION_SPEC_ID } from "./generated/abis.ts";

export type TransactionFailureCode =
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
}

export interface ContractWriteRequest {
  readonly abi: Abi | readonly unknown[];
  readonly address: Address;
  readonly functionName: string;
  readonly args?: readonly unknown[];
  readonly value?: bigint;
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
    waitForTransactionReceipt(options: {
      readonly hash: Hash;
      readonly confirmations?: number;
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

export class V1TransactionExecutor {
  readonly #inflight = new Map<string, Promise<unknown>>();
  readonly clients: V1TransactionClients;

  constructor(clients: V1TransactionClients) {
    this.clients = clients;
  }

  execute<T>(input: ExecuteV1Transaction<T>): Promise<T> {
    const existing = this.#inflight.get(input.operationKey) as Promise<T> | undefined;
    if (existing) return existing;
    const pending = this.#execute(input).finally(() => this.#inflight.delete(input.operationKey));
    this.#inflight.set(input.operationKey, pending);
    return pending;
  }

  async #execute<T>(input: ExecuteV1Transaction<T>): Promise<T> {
    const emit = (update: Omit<TransactionUpdate, "operationKey">) => input.onUpdate?.({ operationKey: input.operationKey, ...update });
    try {
      emit({ stage: "preflight" });
      await this.#assertFresh(input, "before simulation");

      if (input.approval) {
        await this.#sendAndConfirm(input.approval, input, emit, true);
        await this.#assertFresh(input, "after approval");
      }

      const { receipt, hash } = await this.#sendAndConfirm(input.request, input, emit, false);
      emit({ stage: "confirming", hash });
      try {
        const confirmed = await input.confirm(receipt, hash);
        emit({ stage: "confirmed", hash });
        return confirmed;
      } catch (error) {
        throw new V1TransactionError("confirmation_failed", "transaction receipt could not be reconciled with fresh chain facts", error);
      }
    } catch (error) {
      const typed = error instanceof V1TransactionError ? error : new V1TransactionError("submission_failed", "transaction workflow failed", error);
      emit({ stage: "failed", error: typed });
      throw typed;
    }
  }

  #assertPreflight<T>(input: ExecuteV1Transaction<T>): void {
    const chainId = this.clients.walletClient.chain?.id;
    if (chainId !== ROBINHOOD_CHAIN_ID) throw new V1TransactionError("unsupported_chain", `wallet must use chain ${ROBINHOOD_CHAIN_ID}`);
    const connected = accountAddress(this.clients.walletClient.account);
    if (!connected || !sameAddress(connected, input.expectedAccount)) throw new V1TransactionError("wrong_account", "connected wallet does not match the expected account");
    if (input.snapshot.executionSpecId !== V1_EXECUTION_SPEC_ID) throw new V1TransactionError("stale_snapshot", "snapshot execution spec does not match the generated ABI");
    if (input.snapshot.syncStatus === "lagging") throw new V1TransactionError("indexer_lagging", "Indexer snapshot is lagging");
    if (input.snapshot.syncStatus === "unavailable") throw new V1TransactionError("indexer_unavailable", "Indexer snapshot is unavailable");
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
    emit({ stage: approval ? "simulating_approval" : "simulating" });
    let simulation: SimulatedRequest;
    try {
      simulation = await this.clients.publicClient.simulateContract({ ...request, account });
    } catch (error) {
      throw new V1TransactionError("simulation_failed", approval ? "approval simulation failed" : "transaction simulation failed", error);
    }
    await this.#assertFresh(input, approval ? "after approval simulation" : "after transaction simulation");
    emit({ stage: approval ? "awaiting_approval_signature" : "awaiting_signature" });
    let hash: Hash;
    try {
      hash = await this.clients.walletClient.writeContract(simulation.request);
    } catch (error) {
      if (isUserRejected(error)) throw new V1TransactionError("user_rejected", "wallet signature was rejected", error);
      throw new V1TransactionError("submission_failed", approval ? "approval submission failed" : "transaction submission failed", error);
    }
    emit({ stage: approval ? "approval_submitted" : "submitted", hash });
    if (!approval) emit({ stage: "pending", hash });
    let finalHash = hash;
    let cancelled = false;
    let receipt: TransactionReceipt;
    try {
      receipt = await this.clients.publicClient.waitForTransactionReceipt({
        hash,
        ...(input.confirmations === undefined ? {} : { confirmations: input.confirmations }),
        onReplaced: (replacement) => {
          finalHash = replacement.transaction.hash;
          cancelled = replacement.reason === "cancelled";
          emit({ stage: "replaced", hash: finalHash, replacementReason: replacement.reason });
        },
      });
    } catch (error) {
      if (isReceiptTimeout(error)) throw new V1TransactionError("receipt_timeout", "timed out waiting for a canonical receipt", error);
      throw new V1TransactionError("submission_failed", "receipt wait failed", error);
    }
    if (cancelled) throw new V1TransactionError("replacement_cancelled", "transaction was replaced by a cancellation");
    if (receipt.status !== "success") {
      throw new V1TransactionError(approval ? "approval_reverted" : "transaction_reverted", approval ? "approval reverted" : "transaction reverted");
    }
    if (approval) emit({ stage: "approval_confirmed", hash: finalHash });
    return { receipt, hash: finalHash };
  }
}
