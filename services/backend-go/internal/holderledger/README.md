# Continuous holder replay kernel

This package independently replays the 24-hour `HolderRewardsDistributorV1`
integer accounting: scaled release rates, stream tails, index remainder, idle
restarts, balances, accrued earnings and claims. It never grants publication
eligibility.

`New` requires authenticated registration state and all initial balances.
`Apply` consumes successful state-changing actions in execution order. `ApplyTrace`
decodes successful distributor calls, including checkpoints and zero claims
which emit no event, and excludes reverted subtrees atomically.

The seed and block-replay adapters authenticate deployed code and bindings,
transaction/receipt roots, canonical/finality fences and the captured call
history for their respective block. They also retain the hash-pinned reads,
transactions, receipt-root inputs and traces needed to repeat those checks.
A provider's callTracer result by itself does not establish complete history.
`holder-scope-plan` derives candidate-bound scopes, and
`candidate-inspect --publish` consumes audited checkpoints plus fresh
same-block reconciliation, while this package's `PublicationEligible` remains
always false.

`View(ts)` returns persisted market/account fields alongside claimable evaluated
at `ClaimableAt=ts`. `UpdatedAt` is the most recent state-changing checkpoint;
viewing does not mutate the ledger or restart idle rewards. This matches querying
Solidity `marketState` and `claimable` at the same block. Serialized views are
audit output, not a trusted restoration format.

Run unit and trace checks:

```sh
go test -race ./internal/holderledger
```

Run the real Solidity comparison from `services/backend-go`:

```sh
FORGE=/absolute/path/to/forge make holder-ledger-solidity-check
```

This executes the local Forge EVM fixture and checks 16 action states, including
overlapping streams, transfers, silent calls, zero supply, idle recovery and
final claims. Seventeen visible state fields are compared at each step. This is
not exhaustive equivalence, asset-solvency proof or authenticated chain-history
coverage; private account storage is indirectly checked through claimable and
actual payouts, not directly proven by this fixture.

`Reconcile` and the read-only `cmd/holder-reconcile` now compare replayed state
with finalized, hash-pinned market/release getters and every known account's
balance/claimable. See `docs/operations/CONTINUOUS_HOLDER_RECONCILIATION.md`.
This comparison still does not authenticate the input history or authorize
publication. Candidate-bound scope planning and the publication binding now
exist, but real deployment execution, complete-range acceptance and production
operations remain open.

`ReplayNextBlock` now verifies and atomically applies all transactions of a
finalized block through `chainrpc.RootVerifiedClient`, including no-log calls.
It checks transaction trie/signatures, receipt roots and trace root identities.
`holder-seed` authenticates the pristine deployment/registration block and
`CheckpointStore` persists its evidence; `holder-replay-worker` advances one
strict finalized child at a time, and `AuditHistory` replays the retained seed
and block evidence. Unsupported Nitro transaction variants, complete-range
coverage, independent consensus provenance and production scheduling remain
open. See docs/operations/HOLDER_REPLAY_CHECKPOINTS.md and
`docs/operations/HOLDER_HISTORY_AUTHENTICATION.md`.

CheckpointStore preserves internal accounting state with versioned canonical encoding; snapshots from View remain unsuitable for restoration. `Initialize` remains an explicitly provisional operator path; production `holder-seed` uses `InitializeAuthenticatedEvidence` and migration 00072. `Advance` invokes ReplayNextBlock and uses an append-only revision plus atomic head update. `AuditHistory` verifies the retained revision/evidence chain, but no eligibility is granted. Run `python3 scripts/verify_holder_checkpoints.py` from the backend directory for isolated PostgreSQL recovery and migration checks.
