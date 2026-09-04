# TickerGarden V1 indexer runtime core

> **Current projection boundary (2026-09-04):** index permanent post-deployment autonomy plus one-way `launchPhase` (`0=NotGraduated`, `1=PoolCreated`); no deployed-market administration or management-recovery state is projected. Asset/configuration status and user rageQuit/async reward settlement remain. Generated handlers are synchronized to `V1-EXEC-10`; live-chain replay evidence remains a deployment gate.

This package contains the V1 event schema and deterministic projection handlers for
config, market, Curve, Pool, allocation, activation, fee, claim, and rage-quit/forfeiture facts.
Every raw fact and materialized row carries `chainId`, block number/hash,
transaction hash/index, and log index provenance.

The event catalog in `src/generated/v1-events.ts` is generated from the compiled
V1 interface artifacts plus the vendored canonical Uniswap v4 `IPoolManager`
`Swap`/`Donate` events. Run `npm run generate:events` after an ABI change and
`npm run check:events` in verification. `Donate` remains only as a generic
PoolManager observation for third-party activity; TickerGarden's Hook does not
call it or route any protocol fee to LPs.

Handlers accept already decoded, emitter-allowlisted events. `Swap` is paired with
the next matching `V4FeeAccrued` in the same transaction and pool; a fee without a
preceding unpaired swap fails closed. The projector never estimates balances or
rewards. Values absent from events may only enter through block-tagged
`ChainObservation` results, preserving their chain provenance.

`CanonicalReplayEngine` accepts complete canonical blocks, persists a bigint-safe
JSON journal atomically, restores it after restart, and replaces an orphan branch
only when the new branch connects to a retained common ancestor. Every branch is
rebuilt transactionally before publication, so orphan observations, fee credits,
and Swap/Hook pairings disappear together. `canonicalStateBytes()` sorts every
projection map for byte-level empty-database rebuild comparisons.

`reconcileAtTip` compares block-tagged Vault principal, Gauge position, FeeVault
liability/solvency, sourceVersion, and Pool binding probes and returns alerts with
the indexed tip hash. Equality and `onchain >= projected liability` checks are
explicit; missing projected fields alert rather than being filled with estimates.

RPC transport and scheduling remain adapter concerns: callers must decode only
emitter-allowlisted receipts and execute `requiredObservations` at the event's
block tag. The checkpoint intentionally stores the canonical event/observation
journal instead of trusting serialized materialized balances.

The CLI prints the descriptor as one JSON line:

```text
{"chainId":4663,"executionSpecId":"V1-EXEC-10","status":"reorg-replay-and-reconciliation","handlersImplemented":true}
```

Run `npm run build`, `npm test`, or `npm start` from this directory.
