# RH mainnet production candidate tools

These tools prepare and verify a chain 4663 candidate. They do not sign or broadcast mainnet transactions. The only transaction sender is a newly spawned, verified, loopback Anvil instance. Mainnet RPC is restricted to read-only methods.

The current evidence directory is `docs/reviews/evidence/production-release-2026-09-15/`. Do not regenerate an approved directory in place: use a new directory, preserve earlier evidence, and review changed commitments.

## Validation and preparation

Run from the repository root. The configured internal RPC is loaded by Node from the ignored environment file; never print it or copy that file into the release archive.

```sh
npm run test:production-release
npm run check:production-release
```

For a new candidate, inspect each script's inputs before executing the sequential pipeline:

1. `snapshot.mjs`: finalized chain/account/dependency/194-asset evidence.
2. `export-runtime.mjs`: read-only Solidity `exportPlan`, independent constructor/address verification, source closure and compiler artifacts.
3. `simulate.mjs`: all runtime and activation transactions, readbacks, local receipts and additional business drills.
4. `native-fees.mjs`: pinned native L1 data-fee quotes for the exact unsigned calldata.
5. `reproduce-build.mjs`: rebuild the archived Solidity source closure and compare all 23 artifacts.
6. `finalize.mjs`: archive contract release inputs, propose gas/fee ceilings, build the unsigned pack and candidate catalog.
7. `control-proofs.mjs`: generate unsigned signer-control challenges; optional supplied proofs are verified without broadcasting.
8. `check.mjs`: verify source/archive hashes, configuration, full transaction regeneration, fee arithmetic and completed evidence.
9. `bundle.mjs`: repeat the candidate check, hash all selected evidence and archived inputs, and create the unsigned candidate archive. Historical failures, local state dumps and private environment files are excluded.

Use `node --env-file=.env.test.local tools/production-release/<script>.mjs <evidence-directory>` for scripts that need RPC. Offline scripts do not need the environment file. Existing Solidity/spec/deployment tests and the separately pinned mainnet Fork suite remain required; this pipeline does not replace them.

## Resuming local drills

`drills-only.mjs` can resume the additional drills after complete initialization has produced `local-checkpoint.json` and `local-initialized-state.hex`. It verifies the checkpoint digest, imports only initialized protocol accounts into a new owned fork, verifies all 22 runtime hashes and final governance state, then reruns the full drill set. The imported checkpoint is local simulation data, never a mainnet state or receipt.

Only synthetic local test balances and locally impersonated accounts are used for these drills. Safe owner signature collection and real Safe transaction execution remain separate external evidence. A transient read may be retried; transaction sends are never blindly retried.

## Scope of readiness

`TECHNICALLY_PREPARED_EXTERNAL_GATES_PENDING_NOT_BROADCAST` is not production authorization. A generated catalog has no activation block and must not be used as a live deployment. Exact fee quotations, nonces, owners and codehashes must be refreshed before signing. See [the execution runbook](../../docs/runbooks/RH_MAINNET_RELEASE_2026-09-15.md) for approval, ordered execution, interrupted-prefix recovery and post-deployment gates.
