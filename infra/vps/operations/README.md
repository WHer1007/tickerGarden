# RH logical backup and recovery

`backup-rh-docker.sh` is installed at `/opt/tickergarden-runtime-ops/backup-rh-docker.sh`; install the accompanying service/timer under `/etc/systemd/system/`. Current timer runs daily at 20:15 UTC, with up to 600 seconds jitter. Use the existing server configuration and Docker admin identity; do not add a second credential file.

Check timer/service status and `/var/backups/tickergarden-rh/last-success`. Confirm both dump files and their SHA-256 files exist for the same timestamp. `roles-<timestamp>.sql` contains role names and NOLOGIN declarations, no passwords or role privilege grants. A failed/partial run must not be counted as a completed backup. Monitor service failure and disk growth; external alert delivery and off-host retention are not configured by this installation.

Recovery drill:

1. Copy the selected complete backup set to a separate private host/directory and verify every hash there.
2. Use a fresh isolated PostgreSQL 17 instance/container. Do not point a drill at a production database. Import role names first, then create empty destination databases.
3. Restore custom archives with `pg_restore --exit-on-error --no-owner --no-privileges`. Configure required extensions separately (`pg_stat_statements` was required by the current database image).
4. Verify tables, application invariants and projection checkpoints. Record dump hashes, restore duration and results; remove only the temporary instance/volume.
5. Actual disaster recovery requires separately provisioning LOGIN credentials, role membership, ownership and grants from the authoritative configuration. NOLOGIN role stubs alone are not a restored production access policy.

On 2026-11-09, five RH/BSC database dumps were restored in a network-disabled, resource-limited container and independently copied to `/Users/dear/Documents/TickerGarden-Backups/2026-11-09/`. `restore-receipt.json` and `local-verification.json` record the results. This local copy is not a recurring off-host backup. Do not automatically delete server backups until independent-copy retention is established.

Rollback: stop/disable only `tickergarden-rh-backup.timer` when needed. Preserve completed archives and checksums. This backup job neither modifies application data nor requires restarting PostgreSQL.
