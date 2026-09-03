// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {MarketConfig, MarketRuntime, MarketView} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {GraduationExecutorEntry} from "../../../src/v1/shared/GraduationExecutorEntry.sol";

contract GraduationEntryRegistryMock {
    mapping(bytes32 marketId => MarketView value) private _markets;
    address public executor;

    error UnauthorizedExecutor(address caller);

    function setExecutor(address value) external {
        require(executor == address(0));
        executor = value;
    }

    function configure(bytes32 marketId, address curve, uint8 launchPhase, uint32 sourceVersion, uint64 sweptAt)
        external
    {
        MarketConfig memory config;
        config.curve = curve;
        MarketRuntime memory runtime;
        runtime.launchPhase = launchPhase;
        runtime.sourceVersion = sourceVersion;
        runtime.sweptAt = sweptAt;
        _markets[marketId] = MarketView({config: config, runtime: runtime});
    }

    function commitPool(bytes32 marketId, bytes32 poolId) external {
        if (msg.sender != executor) revert UnauthorizedExecutor(msg.sender);
        MarketRuntime storage runtime = _markets[marketId].runtime;
        runtime.launchPhase = 2;
        runtime.poolId = poolId;
        runtime.sourceVersion += 1;
    }

    function market(bytes32 marketId) external view returns (MarketView memory) {
        return _markets[marketId];
    }
}

contract GraduationEntryCurveCaller {
    function graduate(GraduationExecutorEntry executor, bytes32 marketId) external {
        executor.graduateFromCurve(marketId);
    }
}

contract GraduationExecutorEntryHarness is GraduationExecutorEntry {
    enum Mode {
        COMMIT,
        REVERT,
        RETURN_WITHOUT_COMMIT
    }

    GraduationEntryRegistryMock private immutable _registry;
    Mode public mode;
    uint256 public attemptCount;
    bytes32 public lastMarketId;
    uint64 public lastSweptAt;

    error ForcedGraduationFailure();

    constructor(address registry) GraduationExecutorEntry(registry) {
        _registry = GraduationEntryRegistryMock(registry);
    }

    function setMode(Mode value) external {
        mode = value;
    }

    function _graduateSweptMarket(bytes32 marketId, MarketView memory sweptMarket) internal override {
        attemptCount += 1;
        lastMarketId = marketId;
        lastSweptAt = sweptMarket.runtime.sweptAt;
        if (mode == Mode.REVERT) revert ForcedGraduationFailure();
        if (mode == Mode.COMMIT) _registry.commitPool(marketId, keccak256("canonical-pool"));
    }
}

contract GraduationExecutorEntryTest is Test {
    bytes32 private constant MARKET_ID = keccak256("graduation-entry-market");
    uint64 private constant SWEPT_AT = 1_000;

    GraduationEntryRegistryMock private registry;
    GraduationEntryCurveCaller private curve;
    GraduationExecutorEntryHarness private executor;

    function setUp() public {
        registry = new GraduationEntryRegistryMock();
        curve = new GraduationEntryCurveCaller();
        executor = new GraduationExecutorEntryHarness(address(registry));
        registry.setExecutor(address(executor));
        registry.configure(MARKET_ID, address(curve), 1, 7, SWEPT_AT);
    }

    function test_exactRegisteredCurveCanCommitOneCompleteGraduation() public {
        curve.graduate(executor, MARKET_ID);

        MarketView memory value = registry.market(MARKET_ID);
        assertEq(value.runtime.launchPhase, 2);
        assertEq(value.runtime.poolId, keccak256("canonical-pool"));
        assertEq(value.runtime.sourceVersion, 8);
        assertEq(value.runtime.sweptAt, SWEPT_AT);
        assertEq(executor.attemptCount(), 1);
        assertEq(executor.lastMarketId(), MARKET_ID);
        assertEq(executor.lastSweptAt(), SWEPT_AT);
    }

    function test_nonRegisteredCurveCannotEnterAutomaticGraduation() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                GraduationExecutorEntry.UnauthorizedGraduationCurve.selector, address(this), address(curve)
            )
        );
        executor.graduateFromCurve(MARKET_ID);
        assertEq(executor.attemptCount(), 0);
    }

    function test_onlySweptMarketCanReachGraduationAlgorithm() public {
        registry.configure(MARKET_ID, address(curve), 0, 7, 0);
        vm.expectRevert(
            abi.encodeWithSelector(GraduationExecutorEntry.GraduationNotRetryable.selector, MARKET_ID, uint8(0))
        );
        curve.graduate(executor, MARKET_ID);

        assertEq(executor.attemptCount(), 0);
    }

    function test_downstreamFailureRollsBackEveryEntrySideEffect() public {
        executor.setMode(GraduationExecutorEntryHarness.Mode.REVERT);
        vm.expectRevert(GraduationExecutorEntryHarness.ForcedGraduationFailure.selector);
        curve.graduate(executor, MARKET_ID);

        MarketView memory value = registry.market(MARKET_ID);
        assertEq(value.runtime.launchPhase, 1);
        assertEq(value.runtime.sourceVersion, 7);
        assertEq(value.runtime.sweptAt, SWEPT_AT);
        assertEq(executor.attemptCount(), 0);
        assertEq(executor.lastMarketId(), bytes32(0));
    }

    function test_silentReturnWithoutPoolCreatedCommitFailsAndRollsBack() public {
        executor.setMode(GraduationExecutorEntryHarness.Mode.RETURN_WITHOUT_COMMIT);
        vm.expectRevert(
            abi.encodeWithSelector(
                GraduationExecutorEntry.GraduationNotCommitted.selector,
                MARKET_ID,
                uint8(1),
                bytes32(0),
                uint32(7),
                SWEPT_AT
            )
        );
        curve.graduate(executor, MARKET_ID);

        assertEq(executor.attemptCount(), 0);
        assertEq(registry.market(MARKET_ID).runtime.launchPhase, 1);
    }
}
