# TickerGarden V1 contracts

> **Current implementation (2026-09-05):** `V1-EXEC-11` lets new markets choose any administrator-approved identity-current `ACTIVE` Quote config and makes the final Curve buy and GraduationExecutor one atomic transaction. A failed pool creation rolls back the buy; the Solidity surface has no `Swept`, graduation retry, terminal rescue, or market-asset recipient. Asset/configuration registries retain object-scoped pause/retire; user `rageQuit` returns principal immediately with rewards settled asynchronously. Runtime, deterministic deployment and fixed-block Fork evidence are complete for `DEPLOYMENT_ELIGIBLE`; no target-chain transaction or production approval is implied.

The Foundry project now has an isolated `v1` profile. The default profile points at the same fresh source tree, while the explicit profile writes artifacts to `out-v1/` and cache data to `cache-v1/`. The shared `TreasuryDistributorV1` is part of the V1 contract surface; its holder-facing claim flows are exposed by the Rewards page.

`ApprovedQuoteRegistry` keeps the ordinary native/direct immutable ERC-20 path intact and exposes a separate delayed-governance path for official Stock Quotes. That path accepts only an ACTIVE canonical Asset UID from the bound `OfficialStockRegistryV1`, pins token/Beacon/implementation identity plus evidence hashes, and makes implementation drift invalidate the config for future market creation. No observed Stock Base is promoted to Quote automatically.

This directory contains the complete 19-module V1 runtime, deterministic deployment scripts, unit/fuzz/invariant suites, and the fixed-block Fork/E2E. It intentionally contains no market-level recovery runtime.

```bash
node scripts/sync-dependencies.mjs --check
FOUNDRY_PROFILE=v1 forge fmt --check src/v1 test/v1
FOUNDRY_PROFILE=v1 forge build
FOUNDRY_PROFILE=v1 forge test
```
