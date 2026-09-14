# Git repository policy

The Git repository contains source code, contracts, migrations, interface specifications, reproducible tests, deployment manifests, operational runbooks and final runtime assets.

Generated build output, raw test logs, browser captures, compiler dumps, bulk chain-data exports and intermediate design explorations belong in local or CI artifact storage. They must not be committed merely as proof that a command ran. A concise report should record the command, result, source revision and any immutable external reference needed to reproduce the evidence.

The following paths are excluded from new commits:

- `outputs/`
- `brand/`
- `apps/web/qa-captures/`
- `docs/reviews/evidence/`
- `docs/references/data/`

Final Web assets remain under `apps/web/assets/`. Required deterministic test fixtures remain next to their tests. Before pushing a branch, inspect prospective files for credentials and unexpectedly large blobs.

Canonical branch flow is `codex/*` to `test` to `master`. Feature branches do not deploy. Test deployments use `test`; production deployments use `master` and retain the explicit production authorization gate.
