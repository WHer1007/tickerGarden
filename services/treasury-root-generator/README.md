# V1 Treasury Root Generator

This package deterministically replays finalized `TickerMemeTokenV1.Transfer` observations and creates the V1 Treasury Distributor's 7-day TWAB Merkle dataset.

This is an offline V1 release component. It does not choose fee percentages, move protocol fees, or modify a V1 market. The fee percentage and automatic-funding trigger, source, and schedule remain unfrozen, so this package does not imply that the V1 Treasury is deployable. The platform service must supply a complete, canonical, reorg-safe Transfer history up to the `sourceBlockNumber/sourceBlockHash` committed by `RootRequested`, plus that block header's timestamp. Generation fails unless the source block timestamp covers the full 7-day window.

TWAB is the exact raw-token balance-seconds numerator over `[windowStart, windowEnd)`. Quote allocation uses largest-remainder rounding, so all leaves sum exactly to the epoch's frozen Quote amount; zero-amount claims are omitted. Eligibility exclusions are sorted, hashed, and checked against the immutable market policy hash. The dataset hash commits the source block timestamp in addition to the on-chain leaf context.

The V1 output schemas are `TICKERGARDEN_V1_TREASURY_ROOT_V1` and `TICKERGARDEN_V1_TREASURY_DATASET_V1`; claim and eligibility hashing use the `TICKERGARDEN_V1_TREASURY_CLAIM_V1` and `TICKERGARDEN_V1_TREASURY_ELIGIBILITY_POLICY_V1` domains.

The resulting root is an **attested and publicly reproducible platform result**, not a trustless validity proof. `TreasuryDistributorV1` adds an on-chain review delay and a separate cancellation role before permissionless finalization. A future zk/fraud-proof verifier can replace that attestation boundary without changing the V1 release boundary.

The Rewards page owns holder-facing request, claim, permissionless finalize, expire, and rollover flows. Root `publish` remains an authorized platform action and `cancel` remains a separate review-role action; neither is an ordinary holder action.

Run:

```bash
npm ci
npm test
npm run build
node dist/cli.js input.json output.json
```
