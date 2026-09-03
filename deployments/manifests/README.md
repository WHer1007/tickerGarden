# V1 deployment manifests

> **Current manifest rule (2026-09-04):** a production manifest must describe permanently autonomous deployed markets, with no market-level status-management or Recovery authority. Asset/configuration pause/retire remains distinct. Until schema, source, generated artifacts, and live evidence are synchronized, the manifest is not deployment evidence.

Production candidates must use the suffix `*.production.json`. Every such file
is scanned fail-closed for null/empty values, synthetic addresses or hashes,
draft/example tags, and copied reference fixtures before any RPC write.

Do not add a production manifest until V1-E-104-A freezes the complete schema.
The absence of a manifest is not readiness evidence. The central state is
`IMPLEMENTATION_ALLOWED`, but deployment remains fail-closed until every
deployment gate and the final manifest are complete.

Official-stock evidence retains the registration calldata fingerprint and
immutable beacon binding. An implementation upgrade follows immediate guardian
`pauseAsset`, 48-hour-governance `acceptAssetImplementation`, then delayed
`unpauseAsset`, in that order.
