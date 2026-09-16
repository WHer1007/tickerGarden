# Graduation failure coverage matrix

This is a read-only coverage review for V1 graduation. Production graduation remains atomic. The primary integration extended the late-activation rollback test to clear the fault and successfully retry the same ordinary path.

## Existing atomic rollback coverage

| Failure point | Existing test | State covered |
| --- | --- | --- |
| Entry-side downstream revert | `contracts/test/v1/shared/GraduationExecutorEntry.t.sol:test_downstreamFailureRollsBackEveryEntrySideEffect` | Curve caller authorization/entry effects and market state |
| Asset accounting postcondition failure | `contracts/test/v1/shared/GraduationExecutorAssetAccounting.t.sol:test_partialConsumptionRevertsPoolCommitAndEveryTransfer` | ERC20 escrow consumption, pool commit, and transfers |
| Late hook activation revert | `contracts/test/v1/shared/GraduationExecutorPoolExecution.t.sol:test_lateActivationFailureRollsBackLockerNftLiquidityDustAndBindings` | CREATE2 locker, NFT counter/position, pool balances, dust, hook binding, and launch phase |
| Prospective NFT counter corruption | `contracts/test/v1/shared/GraduationExecutorPoolExecution.t.sol:test_initializeCannotStealProspectiveTokenIdWithoutAtomicRollback` | Locker deployment, position counter, and market launch phase |
| Hook lifecycle handshake failure | `contracts/test/v1/shared/TickerGardenMemeHookLifecycle.t.sol:test_atomicGraduationFailureRollsBackRegisterInitializeAndActivate` | Register/initialize/activate handshake |
| Initialization downstream revert | `contracts/test/v1/shared/TickerGardenMemeHookLifecycle.t.sol:test_initializeDownstreamRevertRollsHandshakeBackToExpected` | Hook binding status after initialize failure |

The product-level test in `contracts/test/v1/product/GraduationExecutor.t.sol` additionally verifies the successful deterministic locker deployment and committed position, while the shared pool execution suite covers both ERC20 and native quote success paths.

## Gaps identified

The current mocks do not expose independent failure switches for the following late stages, so adding a new product test without modifying an existing fixture would either duplicate an existing assertion or require a new fixture architecture:

- pool-manager `initialize` reverting after hook registration;
- position-manager `modifyLiquidities` reverting after initialization;
- quote or meme ERC20 transfer/approval failure during dust routing;
- native-value forwarding failure at pool settlement;
- a successful retry after the remaining injected failures; the activation failure case now verifies retry on the same fixture.

These are focused candidates for a future fixture extension. They should remain atomic rollback tests and must assert no locker code, no NFT counter advance, no pool balance, no hook binding, no committed pool, and unchanged source/launch state.

## Decision

No isolated `contracts/test/v1/product/GraduationFailureRecoveryCoverage.t.sol` was added: the existing shared fixtures keep all relevant dependencies private, and the available failure injection already has direct, exhaustive rollback assertions. A useful new test requires extending those mocks, which would violate the requested constraint against modifying existing tests/fixtures.
