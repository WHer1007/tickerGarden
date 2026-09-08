# V1 service integration runbook

This runbook describes the currently available, operator-driven path. It is an integration procedure, not evidence that the public-chain run has passed. Keep every RPC URL, database DSN, deployment manifest, policy file, and journal from one profile and one chain.

## Boundaries

The Go services are the persistent path:

```text
public finalized RPC
  -> indexer (chain journal, receipts, timestamps)
  -> discovery-worker (canonical markets)
  ├─> projection-worker (business facts and observations; separate read-model branch)
  └─> treasury-jobs / treasury-worker (candidate dataset from Treasury journal)
  -> independent reviewer (approved review record)
  -> treasury-review --prepare-publication (unsigned publication)
  -> treasury-lifecycle --action finalize (unsigned finalization after review delay)
  -> external signer and controlled broadcaster
  -> TreasuryDistributor
  -> Go proof API -> wallet claim
```

`publish-snapshot` imports a trusted `VerifiedReadModelSnapshot` for the read API. It is not Treasury root publication. The Go publisher and lifecycle commands do not hold keys and do not broadcast. `receiptRootVerified=false` remains the expected boundary: receipt and log consistency is checked against the configured journal, but no independent receipt-root proof is supplied.

The projection workers do not yet produce a complete independently reconciled read model. `fullReconciliation=false` and `historyVerified=false` must be treated as blocking evidence, not as successful completion.

## Profile isolation

The formal production-shaped profile uses the current V1 seven-day TWAB schema and the formal source tree, including the current block-clock fixes. It must not be confused with an already deployed R5 artifact or manifest; the default R5 deployment is not automatically migrated or replaced.

R6 fast testing is a separate one-hour test profile on Arbitrum Sepolia (421614). Its isolated checkout is `.codex_tmp/r6-fast-test`; its journal, contracts, tools, manifest, RPC, DSNs, and frontend environment must come from that checkout as a set. Do not combine it with the formal seven-day profile, default R5 data, or a main-worktree journal. See `deployments/test-profiles/r6-fast/README.md` and `docs/testing/R6_FAST_TEST_PROFILE.md`.

## Read-only preparation

```sh
cd /Users/dear/Documents/code/TickerGarden/services/backend-go
test -e .env || cp .env.example .env
make build
make migrate-up
./bin/verify-deployment --core-bindings /absolute/path/runtime-identities.json
```

Use a deployment manifest whose chain, genesis, addresses, and runtime hashes match the selected profile. Do not put private keys in `.env`, JSON inputs, or command lines.

The discovery RPC must support historical state (`eth_getCode` and `eth_call` with EIP-1898 block hashes) at the oldest market-creation block being replayed. Availability of historical headers/logs alone is insufficient. The public run encountered `historical state ... is not available` / `metadata is not found` despite successful receipt ingestion. Verify archive capability and chain/genesis/header/code identity before backfilling; preserve the failed checkpoint and resume using the verified archive source. Never replace a historical query with `latest`.

## Persistent ingestion and projection

Configure separate least-privilege DSNs for indexer, discovery, projection, API, candidate store, jobs, reviewer, and publisher. Then run:

```sh
make index-once                 # repeat until the required finalized range is present
./bin/discovery-worker --once
./bin/projection-worker --once
```

Use `--run` for long-lived processes. The indexer commits one block atomically and does not advance on RPC, receipt, timestamp, or reorg failure. Discovery and projection use checkpoints and the chain lock; consumers must use canonical views.

For discovery backfills, `TG_DISCOVERY_EMPTY_BATCH_SIZE=256` enables the bounded event-free batch path (accepted range 2–256; unset retains single-block behavior). It checks every block's header, receipt/log observation, journal correspondence and continuity. It stops before a factory creation event so that the normal full discovery path processes that event. Core runtime and binding checks run at the two batch boundaries; discovery markers and the checkpoint commit atomically. This is an explicit optimization boundary, not independent verification of every intermediate contract state.

Real RPC clients also parallelize up to four independent code/state reads at one EIP-1898 `requireCanonical` block hash. Existing result validation and canonical-header rechecks remain in place; a failed read does not return a partial batch. The proof API's ten-second timeout is unchanged.

Measure the selected RPC's `latest` versus `finalized` timestamp lag before compressing test timing. A root request must enter the finalized journal before automatic discovery. A twenty-minute test publication window can expire while an L2 request is waiting for finality; do not substitute `latest`, synthesize a checkpoint, or bypass review to make the test pass. Formal publication windows must retain enough finality, indexing and review margin.

## Candidate, review, and unsigned lifecycle

`request.json` must explicitly contain the market, epoch, seven-day window, source block, Quote amount, and exclusions. For automatic RootRequested discovery, exclusions are supplied separately in `policies.json`.

```sh
./bin/treasury-jobs --discover \
  --manifest /absolute/path/deployment.json \
  --policies /absolute/path/policies.json
./bin/treasury-jobs --enqueue /absolute/path/request.json \
  --manifest /absolute/path/deployment.json
./bin/treasury-jobs --once --manifest /absolute/path/deployment.json \
  --policies /absolute/path/policies.json
./bin/treasury-jobs --status 0xJOB_ID
./bin/treasury-worker --journal --input /absolute/path/request.json \
  --request-manifest /absolute/path/deployment.json --store
```

A successful job means only that an immutable candidate was saved. An independent reviewer must inspect the candidate, an independently generated reference dataset, the history report, and current request evidence using a different database login. Only then may the publication command prepare unsigned calldata:

```sh
export TG_TREASURY_REVIEW_DATABASE_URL='postgres://reviewer@127.0.0.1/tickergarden'
export TG_TREASURY_REVIEW_JOURNAL_URL='postgres://journal_reader@127.0.0.1/tickergarden'
export TG_TREASURY_REVIEW_RPC_URL='https://rpc.example'
./bin/treasury-review --export-input 0xCANDIDATE_ID
./bin/treasury-review --report-template 0xCANDIDATE_ID > /absolute/path/history-report.json
# Independently run the TS generator or another approved implementation on the exported input.
./bin/treasury-review --candidate 0xCANDIDATE_ID \
  --operation-id 0xREVIEW_OPERATION_ID \
  --decision approved --reason 'independent history and dataset review' \
  --history-report /absolute/path/history-report.json \
  --reference /absolute/path/reference-dataset.json \
  --manifest /absolute/path/deployment.json

export TG_TREASURY_PUBLISH_DATABASE_URL='postgres://publisher@127.0.0.1/tickergarden'
export TG_TREASURY_PUBLISH_RPC_URL='https://rpc.example'
./bin/treasury-review --prepare-publication 0xCANDIDATE_ID \
  --publisher 0xPUBLISHER_ADDRESS \
  --manifest /absolute/path/deployment.json

export TG_TREASURY_LIFECYCLE_DATABASE_URL='postgres://publisher@127.0.0.1/tickergarden'
export TG_TREASURY_LIFECYCLE_RPC_URL='https://rpc.example'
./bin/treasury-lifecycle --action finalize \
  --candidate 0xCANDIDATE_ID --sender 0xPUBLISHER_ADDRESS \
  --manifest /absolute/path/deployment.json
```

The external signer receives the fixed intent or calldata through the approved operational channel. The broadcaster must re-check the manifest, latest review, request state, simulation, nonce, and chain identity immediately before sending. This runbook does not authorize a broadcast. Root publication is prepared by `treasury-review --prepare-publication`; finalization is prepared separately by `treasury-lifecycle --action finalize` after the contract delay.

The candidate queue pins its request observation to the database's finalized checkpoint, verifies that RPC finality covers it, and rechecks its exact canonical hash. It does not assume that a newer RPC finalized head has already been ingested. Candidate creation can use this older confirmed snapshot; review/publication must still check the current request and deadline.

Receipt validation remains a full streaming scan of the selected journal range. Unrelated receipts count against a separate 4 GiB scan budget, while retained candidate/history data keeps its 64 MiB budget. Every receipt and log provenance check remains active; individual receipts are also bounded to 64 MiB. The existing 1,000,000-block and 100,000-Transfer limits remain. **This is not production-scale seven-day capacity certification**: on a fast L2, a seven-day range or a long-lived market can exceed these limits. Production rollout requires a separately validated incremental history/checkpoint design and load tests; do not keep raising limits as a substitute.

## Proof API and claim

Start the Go API with a pinned Treasury manifest and read-only database access:

```sh
TG_TREASURY_PROOF_MANIFEST=/absolute/path/deployment.json \
TG_RPC_URL=https://rpc.example \
TG_DATABASE_URL='postgres://readonly@127.0.0.1/tickergarden' \
TG_CHAIN_ID=421614 \
./bin/api
```

The proof endpoint is:

```text
GET /v1/treasury/markets/{marketId}/epochs/{epochId}/claims/{account}
```

It revalidates the candidate, Merkle proof, live root, claim status, and canonical observation. It never signs, publishes, or claims. The wallet submits `claim` only after the user verifies the displayed proof and the contract call is simulated by the wallet flow.

## Restart, duplicate, and RPC recovery

1. Stop the affected process and preserve its database and logs. Do not delete checkpoints or recreate a journal to hide an error.
2. Restore RPC access and verify chain ID, finalized block hash, manifest hash, and database connectivity.
3. Restart indexer first, then discovery, projection, and Treasury jobs. Failed block transactions leave the cursor unchanged; reprocessing is expected.
4. For duplicate jobs, use the same normalized request and manifest. The job ID is idempotent; a repeated trigger does not reset a running or succeeded job.
5. For expired leases, restart the worker and let the lease be reclaimed. A stale worker cannot complete a job with an old lease token.
6. For a dead job, inspect `--history`; use `--retry` only with the independent operator DSN, expected recovery count, reason, and a stable operation ID. A dead job is not revived by enqueueing the same payload.
7. If a finalized hash, manifest, source, or request state changes, stop and investigate. Do not force rollback or publish an old candidate.
8. If the proof API returns 503, treat RPC/database/candidate inconsistency as unresolved and retry after repair; do not infer “no claim”.

## Test boundary

`make smoke`, `make smoke-chain`, `make smoke-gauge`, `make smoke-vault`, and `make smoke-holder` use isolated PostgreSQL/Anvil fixtures. They cover transactionality, reorg/restart, idempotency, and selected RPC failures, but do not prove a public deployment, complete Transfer history, independent review, root publication, finalize delay, or a successful claim.

`tools/service-integration/setup-local-db.py` creates test roles as PostgreSQL `SUPERUSER` for convenience. That is not production permission isolation; production must provision separate roles and verify grants independently.

The command and environment names above are taken from `services/backend-go/internal/treasury/review_command.go`, `lifecycle_command.go`, `job_command.go`, `command.go`, and `services/backend-go/internal/app/api.go`. The integration helper is `tools/service-integration/run-service.py`; inspect its profile arguments before use. No command in this document includes a private key.

## Current status

Do not report `PASS`, `DEPLOYMENT_ELIGIBLE`, or `PRODUCTION_READY` from this runbook alone. Public-chain execution remains in progress and requires fresh chain, manifest, receipt, review, signer, and claim evidence.

### Separate live state reads from bulk ingestion

The local integration runner sends API and treasury command state reads directly to the verified archive provider. The read relay routes fresh latest/finalized heads separately from its throttled history batches; it never invents a finalized checkpoint. `SERVICE_RPC_URL` can override the API endpoint for a controlled outage test. The observed API outage returned HTTP 503 without a proof, then HTTP 409 with the correct pending-epoch state after restart and recovery (`service-live/api-rpc-fault.json`).
