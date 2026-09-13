# Locker fee compounding implementation — 2026-09-13

Status: candidate implementation complete; NOT_BROADCAST. This is a focused implementation review, not a full production security audit.

## Implemented behavior

- Anyone can call `LaunchLocker.collectLockedFees()`. The only withdrawal from the v4 position uses zero liquidity delta; fees are sent to the same Locker. Position liquidity and identity are checked before and after.
- Only `GraduationExecutor.compoundKeeper()` can call the Locker's bounded `compoundLockedFees(uint128,uint128,uint128,uint256)`. It collects pending fees first, then adds the exact requested liquidity to the original NFT with explicit per-asset maximum inputs and a deadline no more than five minutes ahead.
- Governance sets/rotates the global Keeper through `GraduationExecutor.setCompoundKeeper(address)`. The generated AccessManager plan assigns PROTOCOL_ADMIN_ROLE with the existing 48-hour delay. Default zero; zero disables compounding only.
- Independent fee balances exclude observed graduation excess and direct donations. External asset loss cannot be silently covered by spending those observed isolated balances. Unmatched fee balances remain available for a later compound.
- No swaps, NFT transfers, principal reduction, caller-selected recipient or arbitrary execution. Native surplus returns to Locker; ERC20 and Permit2 allowances are zeroed. Reentrancy guard, exact balance bounds, NFT ownership, pool/range identity, and exact liquidity increase are enforced. Failure rolls back collection, spending and allowances atomically.
- FeeVault accounting and Meme fee burn are unchanged by this LP path. Existing canonical pool fee remains zero; optional creator-selected LP fees are separate pending work.

## Validation

- Full local Solidity: **951 passed**, zero failed/skipped, 89 suites. Live fork tests excluded, as no deployment or broad production audit was requested.
- New real Uniswap v4 PoolManager/PositionManager scenarios cover ERC20/native compounding, isolated donations, unmatched fees, actual liquidity increase, approval cleanup, repeat collection, unauthorized/disabled Keeper, deadlines, slippage rollback/retry, and external asset loss. Only Permit2's allowance adapter is mocked in these tests; actual deployed Permit2/fork verification remains a release gate.
- Governance test covers unauthorized callers, AccessManager schedule delay, successful rotation and disabling.
- Deployment tooling: **67 passed**, TypeScript build passed. Schema/permission counts include the previously added Meme burn entry and the three new LP mutations. Role configuration is tested.
- Specification checks: **66 passed**. Canonical ABI, interfaces, mutation draft and compiled/product artifacts refreshed.
- Web: **384 passed**, TypeScript and build passed. Backend existing unit suite: **54 passed**. This task adds no frontend statistical RPC reads or backend data schema changes.
- Runtime size gates passed. LaunchLocker now **7,981 bytes** (previous custody-only implementation 744 bytes), so per-market deployment cost increases. GraduationExecutor is **17,967 bytes**. Factory remains **23,941 bytes**, close to its internal budget.
- Docs FAQ checked in a real browser at 1440px and 390px; search works and no horizontal overflow. Screenshots in `outputs/reviews/locker-compounding-2026-09-13/`.

## Operational boundary

No contracts were deployed and no Keeper was configured. Existing immutable Lockers cannot acquire this functionality. The Keeper's pricing remains trusted: custody restrictions do not guarantee protection from bad pricing or a compromised Keeper. Production setup needs the chosen operational wallet, governance configuration, verified deployment identities, and separately enabled backend scheduling/signer integration. That automation remains documented TODO; the contracts do not execute themselves or run on swaps.

See [user/operations documentation](../v1/LOCKER_FEE_COMPOUNDING.md).
