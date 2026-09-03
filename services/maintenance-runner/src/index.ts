/** Permissionless V2 maintenance boundary; no keys, admin selectors, or calldata. */
export const EXECUTION_SPEC_ID = "V2-EXEC-3" as const;
export const MAINTENANCE_OPERATIONS = Object.freeze([
  "sweep",
  "checkpoint",
  "retry",
  "compound",
] as const);
export type MaintenanceOperation = (typeof MAINTENANCE_OPERATIONS)[number];
export type MaintenanceRequest = Readonly<{ operation: MaintenanceOperation; marketId: string; triggerId: string }>;
export type MaintenanceAction = Readonly<MaintenanceRequest & {
  targetModule: "PonsCompatibleCurve" | "MemeStockGauge" | "GraduationExecutor" | "LaunchLocker";
  signature:
    | "sweepCurveFees()"
    | "checkpointActivations()"
    | "retryGraduation(bytes32)"
    | "compoundLockedFees()";
}>;
export type SimulationResult = Readonly<
  | { status: "ready" }
  | { status: "noop"; reason?: string }
  | { status: "retryable"; reason?: string }
  | { status: "fatal"; reason?: string }
>;
export type SubmissionResult = Readonly<{ txHash: string }>;

export class MaintenanceTransportError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable = true) {
    super(message);
    this.name = "MaintenanceTransportError";
    this.retryable = retryable;
  }
}

export interface MaintenanceTransport {
  /** Durable source of truth. Implementations must atomically bind this key before broadcasting. */
  findSubmission(idempotencyKey: string): Promise<SubmissionResult | null>;
  simulate(action: MaintenanceAction, idempotencyKey: string): Promise<SimulationResult>;
  submit(action: MaintenanceAction, idempotencyKey: string): Promise<SubmissionResult>;
}

export type RunnerEvent = Readonly<{
  kind: "simulated" | "submitted" | "recovered" | "skipped" | "retrying" | "failed";
  key: string;
  operation: MaintenanceOperation;
  marketId: string;
  triggerId: string;
  attempt: number;
  txHash?: string;
  reason?: string;
}>;
export type RunResult = Readonly<{
  status: "submitted" | "skipped" | "failed";
  key: string;
  attempt: number;
  txHash?: string;
  reason?: string;
}>;

type PreBroadcastLookupRetry = Readonly<{ kind: "retryable-lookup"; reason: string }>;
type SubmissionLookupResult = RunResult | PreBroadcastLookupRetry | undefined;

function isPreBroadcastLookupRetry(value: SubmissionLookupResult): value is PreBroadcastLookupRetry {
  return value !== undefined && "kind" in value && value.kind === "retryable-lookup";
}

export const MAINTENANCE_RUNNER_DESCRIPTOR = Object.freeze({
  executionSpecId: EXECUTION_SPEC_ID,
  status: "active" as const,
  privileged: false as const,
  transactionSubmissionImplemented: true as const,
  transportInjected: true as const,
  signerProvided: false as const,
  rpcProvided: false as const,
  userAssetCustody: false as const,
  simulateFirst: true as const,
  durableIdempotencyLookupRequired: true as const,
  ambiguousSubmissionRetry: false as const,
  operations: MAINTENANCE_OPERATIONS,
  actions: "sweep/checkpoint/retry/compound -> fixed module/signature mapping",
});

const MARKET_ID = /^0x[0-9a-f]{64}$/;
const TX_HASH = /^0x[0-9a-f]{64}$/;
export const MAINTENANCE_ACTIONS = Object.freeze({
  sweep: Object.freeze({ targetModule: "PonsCompatibleCurve", signature: "sweepCurveFees()" as const }),
  checkpoint: Object.freeze({ targetModule: "MemeStockGauge", signature: "checkpointActivations()" as const }),
  retry: Object.freeze({ targetModule: "GraduationExecutor", signature: "retryGraduation(bytes32)" as const }),
  compound: Object.freeze({ targetModule: "LaunchLocker", signature: "compoundLockedFees()" as const }),
} as const);

function assertRequest(request: MaintenanceRequest): void {
  if (request === null || typeof request !== "object" || Object.getPrototypeOf(request) !== Object.prototype) {
    throw new TypeError("maintenance request must be a plain object");
  }
  const keys = Object.keys(request).sort();
  if (keys.length !== 3 || keys[0] !== "marketId" || keys[1] !== "operation" || keys[2] !== "triggerId") {
    throw new TypeError("maintenance request contains unknown or missing fields");
  }
  if (!MAINTENANCE_OPERATIONS.includes(request.operation)) {
    throw new TypeError("unsupported permissionless maintenance operation");
  }
  if (!MARKET_ID.test(request.marketId)) {
    throw new TypeError("marketId must be a lowercase canonical bytes32");
  }
  if (!MARKET_ID.test(request.triggerId)) {
    throw new TypeError("triggerId must be a lowercase canonical bytes32");
  }
}

function requestKey(request: MaintenanceRequest): string {
  return `${request.operation}:${request.marketId}:${request.triggerId}`;
}

function actionFor(request: MaintenanceRequest): MaintenanceAction {
  const fixed = MAINTENANCE_ACTIONS[request.operation];
  return Object.freeze({
    operation: request.operation,
    marketId: request.marketId,
    triggerId: request.triggerId,
    targetModule: fixed.targetModule,
    signature: fixed.signature,
  });
}

function errorDetails(error: unknown): { reason: string; retryable: boolean } {
  if (error instanceof Error) {
    const retryable = (error as Error & { retryable?: unknown }).retryable;
    return { reason: error.message, retryable: typeof retryable === "boolean" ? retryable : false };
  }
  return { reason: "maintenance transport failed", retryable: false };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isSimulationResult(value: unknown): value is SimulationResult {
  if (!isPlainRecord(value) || !hasOwn(value, "status")) return false;
  const status = value.status;
  if (status !== "ready" && status !== "noop" && status !== "retryable" && status !== "fatal") return false;
  if (Object.keys(value).some((key) => key !== "status" && key !== "reason")) return false;
  const reason = value.reason;
  return reason === undefined || typeof reason === "string";
}

function simulationResponseError(value: unknown): string {
  try {
    if (!isPlainRecord(value)) return "simulation returned an invalid response";
    const status = value.status;
    return status === "ready" || status === "noop" || status === "retryable" || status === "fatal"
      ? "simulation returned an invalid response"
      : "simulation returned an unknown status";
  } catch {
    return "simulation returned an invalid response";
  }
}

function isSubmissionResult(value: unknown): value is SubmissionResult {
  if (!isPlainRecord(value) || Object.keys(value).length !== 1 || !hasOwn(value, "txHash")) return false;
  return typeof value.txHash === "string" && TX_HASH.test(value.txHash);
}

function remember<K, V>(cache: Map<K, V>, key: K, value: V, limit: number): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > limit) cache.delete(cache.keys().next().value!);
}

/** Simulates before every submission and coalesces concurrent/completed trigger runs. */
export class MaintenanceRunner {
  readonly #transport: MaintenanceTransport;
  readonly #maxAttempts: number;
  readonly #completedCacheSize: number;
  readonly #eventBufferSize: number;
  readonly #completed = new Map<string, RunResult>();
  readonly #inFlight = new Map<string, Promise<RunResult>>();
  readonly #events: RunnerEvent[] = [];
  readonly #onEvent: ((event: RunnerEvent) => void) | undefined;

  constructor(
    transport: MaintenanceTransport,
    options: Readonly<{
      maxAttempts?: number;
      completedCacheSize?: number;
      eventBufferSize?: number;
      onEvent?: (event: RunnerEvent) => void;
    }> = {},
  ) {
    if (!transport || typeof transport.findSubmission !== "function" || typeof transport.simulate !== "function" || typeof transport.submit !== "function") {
      throw new TypeError("transport must provide durable findSubmission, simulate and submit operations");
    }
    const maxAttempts = options.maxAttempts ?? 3;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
      throw new RangeError("maxAttempts must be an integer from 1 to 10");
    }
    this.#transport = transport;
    this.#maxAttempts = maxAttempts;
    this.#completedCacheSize = options.completedCacheSize ?? 1024;
    this.#eventBufferSize = options.eventBufferSize ?? 4096;
    if (!Number.isInteger(this.#completedCacheSize) || this.#completedCacheSize < 1) {
      throw new RangeError("completedCacheSize must be a positive integer");
    }
    if (!Number.isInteger(this.#eventBufferSize) || this.#eventBufferSize < 1) {
      throw new RangeError("eventBufferSize must be a positive integer");
    }
    this.#onEvent = options.onEvent;
  }

  get events(): readonly RunnerEvent[] {
    return Object.freeze([...this.#events]);
  }

  run(request: MaintenanceRequest): Promise<RunResult> {
    assertRequest(request);
    const key = requestKey(request);
    const previous = this.#completed.get(key);
    if (previous) {
      const event: RunnerEvent = {
        kind: "skipped",
        key,
        ...request,
        attempt: previous.attempt,
        reason: "already completed",
      };
      this.#emit(previous.txHash ? { ...event, txHash: previous.txHash } : event);
      return Promise.resolve(Object.freeze({ ...previous, status: "skipped" as const }));
    }
    const active = this.#inFlight.get(key);
    if (active) return active;
    const activeRun = this.#run(request, actionFor(request), key);
    this.#inFlight.set(key, activeRun);
    void activeRun.finally(() => this.#inFlight.delete(key)).catch(() => undefined);
    return activeRun;
  }

  async runMany(
    requests: readonly MaintenanceRequest[],
    options: Readonly<{ concurrency?: number }> = {},
  ): Promise<readonly RunResult[]> {
    const concurrency = options.concurrency ?? 4;
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
      throw new RangeError("concurrency must be an integer from 1 to 16");
    }
    const results: RunResult[] = new Array(requests.length);
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < requests.length) {
        const index = next;
        next += 1;
        results[index] = await this.run(requests[index]!);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, requests.length) }, () => worker()));
    return results;
  }

  async #run(request: MaintenanceRequest, action: MaintenanceAction, key: string): Promise<RunResult> {
    let reason = "maintenance action failed";
    for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
      const recovered = await this.#findSubmission(key, request, attempt, "before-broadcast");
      if (isPreBroadcastLookupRetry(recovered)) {
        reason = recovered.reason;
        if (attempt < this.#maxAttempts) {
          this.#emit({ kind: "retrying", key, ...request, attempt, reason });
          continue;
        }
        return this.#failure(key, request, attempt, reason);
      }
      if (recovered) return recovered;
      let simulation: unknown;
      try {
        simulation = await this.#transport.simulate(action, key);
      } catch (error) {
        const details = errorDetails(error);
        simulation = { status: details.retryable ? "retryable" : "fatal", reason: details.reason };
      }
      const simulated: RunnerEvent = { kind: "simulated", key, ...request, attempt };
      let validSimulation: SimulationResult | undefined;
      try {
        if (isSimulationResult(simulation)) validSimulation = simulation;
      } catch {
        validSimulation = undefined;
      }
      if (!validSimulation) {
        const responseError = simulationResponseError(simulation);
        this.#emit({ ...simulated, reason: responseError });
        return this.#failure(key, request, attempt, responseError);
      }
      const simulationReason = "reason" in validSimulation ? validSimulation.reason : undefined;
      this.#emit(simulationReason ? { ...simulated, reason: simulationReason } : simulated);
      if (validSimulation.status === "noop") {
        const result = Object.freeze({ status: "skipped" as const, key, attempt, reason: validSimulation.reason ?? "no-op" });
        remember(this.#completed, key, result, this.#completedCacheSize);
        this.#emit({ kind: "skipped", key, ...request, attempt, reason: result.reason });
        return result;
      }
      if (validSimulation.status === "fatal") {
        return this.#failure(key, request, attempt, validSimulation.reason ?? "simulation rejected");
      }
      if (validSimulation.status === "retryable") {
        reason = validSimulation.reason ?? "simulation rejected";
        if (attempt < this.#maxAttempts) {
          this.#emit({ kind: "retrying", key, ...request, attempt, reason });
          continue;
        }
        return this.#failure(key, request, attempt, reason);
      }
      try {
        const submission: unknown = await this.#transport.submit(action, key);
        let validSubmission: SubmissionResult | undefined;
        try {
          if (isSubmissionResult(submission)) validSubmission = submission;
        } catch {
          validSubmission = undefined;
        }
        if (!validSubmission) {
          throw new MaintenanceTransportError(
            "transport returned an invalid submission response",
            false,
          );
        }
        const result: RunResult = Object.freeze({ status: "submitted", key, attempt, txHash: validSubmission.txHash });
        remember(this.#completed, key, result, this.#completedCacheSize);
        this.#emit({ kind: "submitted", key, ...request, attempt, txHash: validSubmission.txHash });
        return result;
      } catch (error) {
        const details = errorDetails(error);
        reason = details.reason;
        // A submission error is ambiguous: broadcasting may have succeeded.
        // Recover the durable key and never blindly submit the same trigger.
        const recoveredAfterError = await this.#findSubmission(key, request, attempt, "after-broadcast");
        if (isPreBroadcastLookupRetry(recoveredAfterError)) {
          return this.#failure(key, request, attempt, recoveredAfterError.reason);
        }
        if (recoveredAfterError) return recoveredAfterError;
        if (details.retryable) reason = `${reason}; durable submission lookup found no transaction`;
        return this.#failure(key, request, attempt, reason);
      }
    }
    return this.#failure(key, request, this.#maxAttempts, reason);
  }

  async #findSubmission(
    key: string,
    request: MaintenanceRequest,
    attempt: number,
    phase: "before-broadcast" | "after-broadcast",
  ): Promise<SubmissionLookupResult> {
    let existing: unknown;
    try {
      existing = await this.#transport.findSubmission(key);
    } catch (error) {
      const details = errorDetails(error);
      const reason = `durable submission lookup failed: ${details.reason}`;
      if (phase === "before-broadcast" && details.retryable) {
        return { kind: "retryable-lookup", reason };
      }
      return this.#failure(key, request, attempt, reason);
    }
    if (existing === null) return undefined;
    let valid: SubmissionResult | undefined;
    try {
      if (isSubmissionResult(existing)) valid = existing;
    } catch {
      valid = undefined;
    }
    if (!valid) return this.#failure(key, request, attempt, "durable submission lookup returned an invalid response");
    const result: RunResult = Object.freeze({ status: "submitted", key, attempt, txHash: valid.txHash });
    remember(this.#completed, key, result, this.#completedCacheSize);
    this.#emit({ kind: "recovered", key, ...request, attempt, txHash: valid.txHash });
    return result;
  }

  #failure(key: string, request: MaintenanceRequest, attempt: number, reason: string): RunResult {
    const result: RunResult = Object.freeze({ status: "failed", key, attempt, reason });
    this.#emit({ kind: "failed", key, ...request, attempt, reason });
    return result;
  }

  #emit(event: RunnerEvent): void {
    const frozen = Object.freeze(event);
    this.#events.push(frozen);
    while (this.#events.length > this.#eventBufferSize) this.#events.shift();
    try {
      this.#onEvent?.(frozen);
    } catch {
      // Observability must never change maintenance execution semantics.
    }
  }
}

export function getMaintenanceRunnerDescriptor(): typeof MAINTENANCE_RUNNER_DESCRIPTOR {
  return MAINTENANCE_RUNNER_DESCRIPTOR;
}

if (process.argv[1]?.endsWith("/index.js") || process.argv[1]?.endsWith("/index.ts")) {
  process.stdout.write(`${JSON.stringify(MAINTENANCE_RUNNER_DESCRIPTOR)}\n`);
}
