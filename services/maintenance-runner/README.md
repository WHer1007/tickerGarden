# TickerGarden V2 maintenance runner

This package is a permissionless maintenance boundary for the V2 public `sweep`, `checkpoint`, `retry`, and `compound` actions. It accepts only a typed operation plus canonical `marketId` and lowercase bytes32 `triggerId`; arbitrary calldata, admin selectors, keys, and user funds are outside the API.

Every submission is preceded by a fresh `simulate`. Simulation can be `ready`, safe `noop`, retryable, or deterministic `fatal`; only RPC/retryable failures are retried. A result is keyed by operation, market, and trigger, so a repeated trigger is coalesced while a later trigger can run again. `runMany` schedules independent single-market calls with a caller-selected concurrency bound (1–16); it does not use an on-chain batch ABI.

Retryability must be explicit (`MaintenanceTransportError(..., true)` or a `retryable` simulation result). Unknown errors fail closed. In particular, a submit exception is never treated as permission to broadcast again.

The transport is injected by the caller and must provide permissionless RPC/transaction submission plus `findSubmission(key)` backed by durable storage. It must atomically bind the idempotency key before broadcasting. The runner checks that source before simulation and after every ambiguous submit result. An explicitly retryable lookup failure before broadcasting may consume another bounded attempt; a lookup failure after a possibly successful broadcast always fails closed and can never cause another submission. This package has no built-in signer, RPC client, dedicated role, or user-asset custody.

The in-process completed-result cache and event buffer are bounded optimizations only (configurable with `completedCacheSize` and `eventBufferSize`); the durable transport lookup is the source of truth across eviction and process restarts.

```bash
npm run build
npm test
```
