# TickerGarden V1 maintenance runner

> **Current boundary (2026-09-04):** the runner has no deployed-market administration path and remains permissionless. It may perform rageQuit reward settlement, forfeiture flushing, sweeping, checkpointing, and Treasury market activation. Graduation is atomic with the final curve buy, so there is no retry or rescue action. LaunchLocker compounding has been removed. The local action catalog is synchronized to `V1-EXEC-9`; live-chain operation remains unverified.

This package is a permissionless maintenance boundary for the V1 public `sweep`, `checkpoint`, deferred-forfeiture `flush`, rage-quit reward `settle`, and Treasury market `treasury-activate` actions. Graduation is not exposed here: the final curve buy performs pool creation, LP locking, and hook activation in one transaction, and any failure reverts the entire buy. It accepts only a typed operation plus canonical `marketId` and lowercase bytes32 `triggerId`; `settle-rage-quit` additionally requires the exact lowercase user address from the indexed Vault tombstone. Arbitrary calldata, admin selectors, keys, graduation rescue, and user funds are outside the API.

Every submission is preceded by a fresh `simulate`. Simulation can be `ready`, safe `noop`, retryable, or deterministic `fatal`; only RPC/retryable failures are retried. A result is keyed by operation, market, and trigger, so a repeated trigger is coalesced while a later trigger can run again. `runMany` schedules independent single-market calls with a caller-selected concurrency bound (1–16); it does not use an on-chain batch ABI. `treasury-activate` uses the same trigger-idempotency and simulation-first boundary as all other operations; the transport is responsible for resolving the chain precondition and submitting the zero-value fixed-selector call.

Retryability must be explicit (`MaintenanceTransportError(..., true)` or a `retryable` simulation result). Unknown errors fail closed. In particular, a submit exception is never treated as permission to broadcast again.

The transport is injected by the caller and must provide permissionless RPC/transaction submission plus `findSubmission(key)` backed by durable storage. It must atomically bind the idempotency key before broadcasting. The runner checks that source before simulation and after every ambiguous submit result. An explicitly retryable lookup failure before broadcasting may consume another bounded attempt; a lookup failure after a possibly successful broadcast always fails closed and can never cause another submission. This package has no built-in signer, RPC client, dedicated role, or user-asset custody.

The in-process completed-result cache and event buffer are bounded optimizations only (configurable with `completedCacheSize` and `eventBufferSize`); the durable transport lookup is the source of truth across eviction and process restarts.

```bash
npm run build
npm test
```
