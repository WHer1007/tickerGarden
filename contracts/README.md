# TickerGarden V2 contracts

The Foundry project now has an isolated `v2` profile. The default profile points at the same fresh source tree, while the explicit profile writes artifacts to `out-v2/` and cache data to `cache-v2/`.

This is infrastructure only. It does not contain launch, curve, fee, staking, graduation, or recovery runtime logic.

```bash
node scripts/sync-dependencies.mjs --check
FOUNDRY_PROFILE=v2 forge fmt --check src/v2 test/v2
FOUNDRY_PROFILE=v2 forge build
FOUNDRY_PROFILE=v2 forge test
```
