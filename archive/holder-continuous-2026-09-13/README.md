# Retired continuous Holder model

These `.txt` copies preserve the former continuous-release implementation and its dedicated checkpoint, stream, admission-window and transfer-failure tests. They are historical evidence, not active Solidity compilation inputs.

The approved replacement uses wallet-balance Merkle snapshots with no token callback. Old tests that require transfer checkpoints or 24-hour streaming cannot validate the new model. Replacement coverage is in:

- `contracts/test/v1/treasury/product/HolderSnapshotRewards.t.sol`: publisher authorization/delay/rotation, funded budgets, per-market isolation, domain-separated proofs, independent asset claims, replay, recipient/reentrancy failure rollback, wallet eligibility, RH canonical block identities, and transfer independence.
- `contracts/test/v1/shared/HolderPoolFlow.t.sol`: actual local Uniswap v4 pool trading continues with all distributor calls forced to fail; snapshot claim integration.
- `contracts/test/v1/shared/ContinuousHolderFeeFlow.t.sol`: historical filename retained; current tests exercise FeeVault funding and snapshot payout, fee splits and fragmented funding.
- `contracts/test/v1/shared/SelectedRewardClaims.t.sol`: Creator/Staker selected-asset coverage remains active.
- Deployment graph and fork fixtures now use the snapshot distributor. Compilation is not evidence of a successful live fork.

Do not count archived tests as passing tests for the snapshot release. Historical immutable deployments continue to run their deployed bytecode and are not migrated by these local edits.
