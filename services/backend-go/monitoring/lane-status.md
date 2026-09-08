# Lane status

`cmd/lane-status` emits one JSON snapshot for the event projection and user activity lanes. Configure `TG_STATUS_DATABASE_URL`, `TG_CHAIN_ID`, `TG_ACTIVITY_START_BLOCK` (or `TG_CHAIN_START_BLOCK`/`TG_START_BLOCK`), `TG_MANIFEST_HASH`, and `TG_PROJECTOR_VERSION` (`event-facts-v1`).

The result is coverage-only operational evidence. It is not financial readiness, publication approval, or a broadcast gate. Both lanes must match the configured manifest and finalized canonical chain; gaps, stale/ahead checkpoints, wrong hashes, and noncanonical or unverified blocks make the result unavailable.

Coverage scans the configured start through finalized height with a bounded five-second read-only transaction timeout. Cost is proportional to that full range; do not treat a high block number as proof of completeness.

Tests require `TG_TEST_LANE_STATUS=1` and `TG_TEST_DATABASE_URL` and create an isolated migrated PostgreSQL database.
