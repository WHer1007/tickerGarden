# Holder scope planning

`holder-scope-plan` derives replay scopes and authenticated seed requests for continuous `HolderRewardsDistributorV1` markets already present in the current candidate. It is a read-only planning command: it does not initialize a checkpoint, persist a seed, publish a snapshot, sign, or submit a transaction.

## Environment

The command requires:

- `TG_PROJECTION_START_BLOCK`: canonical non-negative decimal start height used to load the candidate.
- `TG_DEPLOYMENT_MANIFEST`: deployment manifest containing exactly one `TickerGardenFactoryV1`, `ProtocolFeeVault`, and `HolderRewardsDistributorV1` entry with runtime code hashes.
- `TG_HOLDER_PLAN_DATABASE_URL`, or the fallback `TG_CANDIDATE_DATABASE_URL`: read-only candidate database connection.
- `TG_HOLDER_PLAN_RPC_URL`, or the fallback `TG_RPC_URL`: RPC used for chain identity, finalized/head checks, market source anchors, and code reads.
- `TG_HOLDER_MAX_ACCOUNTS`: optional canonical integer from `1` to `10000`; default `10000`.

The command opens a bounded 90-second context. It does not print DSNs, RPC endpoints, signer material, or secrets.

## Commands

```sh
./bin/holder-scope-plan --describe
./bin/holder-scope-plan --once
./bin/holder-scope-plan --scopes
./bin/holder-scope-plan --seed-request MARKET_ID
```

`--describe` needs no configuration and reports the read-only outputs. `--once` emits the complete versioned plan. `--scopes` emits only the ordered `CheckpointScope` objects. `--seed-request MARKET_ID` emits one `SeedRequest` for the selected continuous market and fails if that market is absent.

The plan contains `version`, `chainId`, `candidateBlockNumber`, `candidateBlockHash`, and sorted `items`. Each item contains `marketId`, a scope bound to chain/genesis, quote, distributor/vault addresses, distributor and token runtime hashes, and the account limit, plus a seed request containing the scope, factory address/code hash, and the market source block number.

## Fail-closed checks

`holderplan.Build` rejects a missing or inconsistent candidate, chain ID or genesis mismatch, non-finalized candidate, candidate block hash drift, duplicate markets, missing static manifest bindings, wrong distributor/token/quote identity, malformed or non-canonical market source numbers, source blocks after the candidate, and source hash or parent hash mismatch.

For every continuous market it checks that the token had no code at the source parent and has code at the source block. It reads factory, vault, distributor, and token code at the source block, requiring non-empty code and exact manifest/runtime hash matches for the three protocol bindings. It computes and validates the scope digest. After all reads it rechecks chain ID, genesis, finalized header, and candidate header so a moving endpoint cannot silently produce a plan from mixed anchors.

The resulting `SeedRequest` is still an operator input. Pass the selected request to the authenticated `holder-seed` flow, which repeats the full deployment-block seed authentication before writing revision 0. Pass the scopes to `holder-replay-worker` only after the corresponding authenticated checkpoint exists. `candidate-inspect --publish` either loads an explicitly configured exact scope inventory or derives it again from its current candidate and RPC, then audits the persisted history and performs fresh same-block reconciliation against both RPCs; it does not trust an earlier plan as publication evidence.

## What the plan does not prove

The plan does not prove complete transfer/call history, receipt or trace consensus, independent provider authenticity, account inventory completeness, solvency, or publication eligibility. It does not authenticate a seed, create a checkpoint, verify all Nitro transaction types, or establish a production retention/recovery process. `HistoryVerified` and `PublicationEligible` remain false until the separate seed, replay, audit, and publication gates pass.

The opt-in `holder-scope-public-check` derives scopes, completes pristine seed authentication, persists revision 0 in a disposable PostgreSQL database, and audits the retained evidence for three already-published markets against the active Arbitrum Sepolia test-only continuous release. This is read-only release evidence for those exact market creation blocks; it is not a full-range replay, independent-provider history proof, or production acceptance. The RH production deployment has not been connected or accepted.

```sh
ARBITRUM_SEPOLIA_RPC_URL='https://…' \
TG_TEST_DATABASE_URL='postgres://…/postgres' \
make holder-scope-public-check
```

`holder-replay-public-check` additionally advances and audits the first child block for every scope. It requires an RPC plan that supports `debug_traceTransaction`; an endpoint that omits this method must fail closed.
