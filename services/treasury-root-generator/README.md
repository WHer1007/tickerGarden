# V2 Treasury Root Generator

This package deterministically replays finalized `TickerMemeTokenV2.Transfer` observations and creates the future V2 Treasury Distributor's 30-day TWAB Merkle dataset.

It is intentionally isolated from V1. It does not choose fee percentages, move protocol fees, or modify a V1 market. The platform service must supply a complete, canonical, reorg-safe Transfer history up to the `sourceBlockNumber/sourceBlockHash` committed by `RootRequested`, plus that block header's timestamp. Generation fails unless the source block timestamp covers the full 30-day window.

TWAB is the exact raw-token balance-seconds numerator over `[windowStart, windowEnd)`. Quote allocation uses largest-remainder rounding, so all leaves sum exactly to the epoch's frozen Quote amount; zero-amount claims are omitted. Eligibility exclusions are sorted, hashed, and checked against the immutable market policy hash. The dataset hash commits the source block timestamp in addition to the on-chain leaf context.

The resulting root is an **attested and publicly reproducible platform result**, not a trustless validity proof. `TreasuryDistributorV2` adds an on-chain review delay and a separate cancellation role before permissionless finalization. A future zk/fraud-proof verifier can replace that attestation boundary without changing V1.

Run:

```bash
npm ci
npm test
npm run build
node dist/cli.js input.json output.json
```
