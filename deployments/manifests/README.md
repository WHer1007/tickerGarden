# V1 deployment manifests

> **Current manifest rule (2026-09-05):** a production manifest must describe permanently autonomous deployed markets, with no market-level status-management or Recovery authority. Asset/configuration pause/retire remains distinct. The checked testnet plan and deployment-gate evidence establish technical eligibility, but do not claim that any transaction was broadcast.

Production candidates must use the suffix `*.production.json`. Every such file
is scanned fail-closed for null/empty values, synthetic addresses or hashes,
draft/example tags, and copied reference fixtures before any RPC write.

`robinhood-testnet-46630.v1.plan.json` freezes the non-broadcast rehearsal chain,
external dependency identities, deterministic deployment contract, exact 27
configuration inputs, Fork pin and seven evidence references. It is a plan, not
a deployed-address manifest. Before broadcast, operators must explicitly accept
the project-pinned test-only v4 dependencies and freeze every Safe, treasury,
service and economic input. After broadcast, a receipt-bound deployed manifest
must be produced and verified; no production manifest exists yet.

The central state is `DEPLOYMENT_ELIGIBLE`, while `productionReady` and
`broadcastAuthorized` remain false. The gate report is
`../evidence/v1-deployment-gates.json`.

Official-stock evidence retains the registration calldata fingerprint and
immutable beacon binding. An implementation upgrade follows immediate guardian
`pauseAsset`, 48-hour-governance `acceptAssetImplementation`, then delayed
`unpauseAsset`, in that order.

## Reusable RH testnet Stock swap routes

`robinhood-testnet-46630.stock-swap-routes.json` records the five successfully executed Synthra V3 purchase routes. Read this configuration first for future ETH-to-Stock funding. Use the saved pool and fee directly; refresh only the requested amount quote and transaction state. Do not repeat address discovery or historical scans. See [the runbook](../../docs/runbooks/robinhood-testnet-stock-purchases.md).
