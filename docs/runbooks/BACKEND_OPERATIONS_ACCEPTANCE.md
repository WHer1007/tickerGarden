# Backend operations acceptance

Scope: local `test` source. This runbook does not authorize production deployment. Production source must be accepted on `test`, promoted to `master`, and separately authorized; Vercel runtime functions must all verify in `sin1`.

## Resident chain execution

The resident consumer processes persistent jobs directly. HTTP ingress still authenticates and journals events; content remains on its existing delivery lane. Do not ACK an unjournaled event or increase only the callback timeout.

1. Build/test the accepted backend tree and apply its migration manifest, including `0018_principal_work`, to the target **test** database. Apply the updated permissions. Record commit/tree, release directory and migration digests; do not overwrite the currently running release in place.
2. Size every process pool against one server-wide budget. Include preview/production services sharing that PostgreSQL server, both old/new deployment instances, the advisory-lock control connection, queue and chain relays. The example is **one environment only**: 52 business connections + 20 reserved, 28 headroom. It is not evidence of Vercel autoscaling limits. DB role caps are the final connection boundary; excess requests must fail/retry rather than exhaust admin connections.
3. `check-connection-budget.ts policy.json --plan` produces reviewable `ALTER ROLE` SQL. Apply it with the DBA role after matching live role names; run the same command with `--check`. Unlisted login roles, superuser business roles, unlimited/mismatched caps or a changed server maximum fail acceptance. Configure relay pool envs too: `TG_DB_POOL_MAX_QUEUE_RELAY`, `TG_DB_POOL_MAX_CHAIN_RELAY`, `TG_DB_POOL_MAX_CHAIN_RELAY_SOURCE`. For shared multi-environment policy names, use `TG_DB_BUDGET_SERVICE_PREFIX` in the backend processes.
4. Populate the protected resident EnvironmentFile using existing target credentials; use direct/session pooling for control, never transaction pooling. Match `TG_PIPELINE_GENERATION` to the live chain queue generation, not the example's `0`.
5. Drain chain job/outbox leases, then run `resident-worker.ts --activate`. The database refuses a switch with active leases. Start the resident service from the accepted release. Existing callbacks cannot claim resident-mode jobs.
6. Run `scripts/check-resident-worker.ts`; inspect queue age, successes, retries and dead jobs for a representative period. Confirm a real test job exceeding 20 seconds completes once; test control-connection loss, restart, lease recovery, and old-callback fencing. Local tests cover these mechanisms, but are not VPS cutover evidence.
7. Rollback: stop/drain the worker, retain the database, invoke `resident-worker.ts --rollback`, resume the callback scheduler, verify pending jobs. No dead-letter replay without operation-ID reconciliation. Keep a single scheduler per environment.

The current chain processor/relay remain bound to their existing Robinhood **testnet** deployment identity. These changes do not make that processor a mainnet deployment.

## Principal projection

`0018_principal_work` adds a generation-isolated ledger, event cursor, verification work and temporal account/position records. A job consumes bounded pages; continuation identities include durable progress. The worker resumes the oldest candidate even when it contains no market observations. Old-generation work cannot publish after reorg. Initial bootstrap/reorg rebuild scans canonical finalized history using keyset pages; normal runs start after the last completed anchor.

Vault changes verify the affected account and its displayed positions; Gauge changes verify affected users/markets. Pending activation and lock boundaries also refresh without a principal event. All getters require two providers to agree at the same target block; event checkpoints, allocation sums, Vault/Gauge totals and settlement checks remain enforced. Every 10,000 blocks, all known accounts/allocations receive a paged RPC audit. This interval is a code default and can be tuned only with workload evidence. It is a full getter audit, not an independent second implementation of event replay.

Both publications commit atomically after all work finishes. Readers retain the previous complete revision throughout continuation/failure. Unchanged records reuse immutable versions. Completed verification work rows are reclaimed in the same publication transaction; each publication retains its verified-record count and the candidate evidence commitment. A same-height existing legacy publication is never silently overwritten; rollout must build at the next finalized anchor.

Default quantum: 8 records/page, up to 20 pages or 90 seconds between pages. One in-flight RPC page can finish beyond that soft budget; resident's hard execution fence remains. No 10,000-population or million-event release cutoff remains. Per-query page sizes stay bounded.

## Backup and recovery gate

**No independent backup destination exists yet.** Do not mark recovery production-ready from local rehearsal. The hourly timer is a provisional cadence, not an agreed or achieved RPO/RTO.

- Provision an independently administered host or encrypted restic repository in an independent failure domain; choose same-region managed PostgreSQL only after confirming extensions, session locks, migrations and connection behavior. No provider resource was purchased or migrated.
- `backup-postgres.sh` uses a protected PostgreSQL service file and a restic password file. Run it for both application and queue databases. Preserve role/grant configuration in the protected infrastructure configuration; dumps omit passwords/ACLs. Capture and retain snapshot IDs, age, duration, failures and external repository checks. Independent dumps are not one cross-database snapshot: recovery must reconcile operation IDs before replaying queue jobs.
- For MinIO, provision version-aware independent replication as the normal production design. The supplied `backup-minio-volume.sh` is a **cold fallback requiring an explicitly approved maintenance window**. It stops MinIO cleanly, archives its complete data volume (including historical versions), checks the repository and restarts it. It was syntax-checked only, not executed on the VPS. Do not use an ordinary latest-object mirror as a version-preserving backup.
- Restore a selected remote snapshot to isolated storage. Create an empty `tg_restore_*` database and use `restore-postgres-drill.sh`. It verifies the archive checksum, exact destination database and emptiness; it refuses to overwrite an existing database. Then verify migration digests, publications/checkpoints, user balances, job dedup identities, and referenced object bytes/versions. Restore MinIO into an empty isolated volume with the recorded exact server image, and confirm object versions before workers start.
- Measure backup loss window and recovery wall time. Record actual RPO/RTO and exercise source-host loss; local dump/restore is only a script regression. Never enable automatic pruning until off-host retrieval and application/object recovery have passed.

## Retention

Default candidate window: older than 90 days AND outside a minimum 1,000-block reorg window. `export-retention-archive.ts` exports immutable historical projection rows or attempts belonging to succeeded jobs, in keyset pages, with record counts and SHA-256 manifests. It excludes current publication pointers, recent/reorg-window rows, pending/retry/dead jobs. A consistent read snapshot fixes export membership. Use a quiet period/read replica for large exports because a long snapshot delays vacuum.

No source rows are deleted by this script. Immutable event/publication proofs, dedup identifiers and unresolved dead letters remain authoritative. After independent archives and recovery are accepted, a separately tested cold-read/pruning migration can shrink old full-snapshot tables. The new principal temporal storage already prevents unchanged account/position payloads from being duplicated at every revision. Do not disable immutability triggers to purge history.

## Release identity

Both relay health responses expose `release.commit`, `imageDigest`, and a digest computed from live required table columns. Unknown values remain null. Build with `TG_RELEASE_COMMIT`, pin the registry image by digest, and inject the resolved `TG_IMAGE_DIGEST`; both are checked against actual Docker image metadata, not just environment declarations.

`infra/vps/operations/check-release.mjs expected.json observed.json` fails closed on missing/mismatched health, commit, actual repository digest or schema digest. `observed` combines health JSON, **selected** `docker inspect` container/image fields and their actual labels/RepoDigests; do not export container environment secrets. Backend migrations are separately verified by their full source digests through the resident gate. Schema column digest does not replace migration checks or constraints review.

For a VPS-built image without a registry, explicitly set `digestKind: image-config`: the gate requires the actual image `Id`, running container `Image`, and both source labels to match. This is the immutable Docker image configuration digest, not a registry manifest digest. Retain the release source and image for rollback; do not invent RepoDigests. Registry releases retain the original manifest gate.

Before any alias/promotion: verify source branch and deployment boundary, service identity, image digest, migration digests, health and queue behavior. Run the existing Vercel region gate for all deployed functions.
