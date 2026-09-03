# TickerGarden V1 contracts

> **Current local implementation (2026-09-04):** `V1-EXEC-6` removes deployed-market administration and management recovery from the Solidity surface. Asset/configuration registries retain object-scoped pause/retire; user `rageQuit` returns principal immediately with rewards settled asynchronously. Target-chain deployment and production approval remain separate gates.

The Foundry project now has an isolated `v1` profile. The default profile points at the same fresh source tree, while the explicit profile writes artifacts to `out-v1/` and cache data to `cache-v1/`.

This is infrastructure only. It does not contain launch, curve, fee, staking, graduation, or recovery runtime logic.

```bash
node scripts/sync-dependencies.mjs --check
FOUNDRY_PROFILE=v1 forge fmt --check src/v1 test/v1
FOUNDRY_PROFILE=v1 forge build
FOUNDRY_PROFILE=v1 forge test
```
