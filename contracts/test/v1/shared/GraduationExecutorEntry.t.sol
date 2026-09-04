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

    function configure(bytes32 marketId, address curve, uint8 launchPhase, uint32 sourceVersion) external {
        MarketConfig memory config;
        config.curve = curve;
        MarketRuntime memory runtime;
        runtime.launchPhase = launchPhase;
        runtime.sourceVersion = sourceVersion;
        _markets[marketId] = MarketView({config: config, runtime: runtime});
    }

    function commitPool(bytes32 marketId, bytes32 poolId) external {
        if (msg.sender != executor) revert UnauthorizedExecutor(msg.sender);
        MarketRuntime storage runtime = _markets[marketId].runtime;
        runtime.launchPhase = 1;
        runtime.poolId = poolId;
        runtime.sourceVersion += 1;
    }

    function market(bytes32 marketId) external view returns (MarketView memory) {
        return _markets[marketId];
    }
}

contract GraduationEntryCurveCaller {
    function graduate(GraduationExecutorEntry executor, bytes32 marketId, uint256 quoteAmount, uint256 memeAmount)
        external
        payable
    {
        executor.graduateFromCurve{value: msg.value}(marketId, quoteAmount, memeAmount);
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
    uint256 public lastQuoteAmount;
    uint256 public lastMemeAmount;

    error ForcedGraduationFailure();

    constructor(address registry) GraduationExecutorEntry(registry) {
        _registry = GraduationEntryRegistryMock(registry);
    }

    function setMode(Mode value) external {
        mode = value;
    }

    function _graduateMarket(bytes32 marketId, MarketView memory, uint256 quoteAmount, uint256 memeAmount)
        internal
        override
    {
        attemptCount += 1;
        lastMarketId = marketId;
        lastQuoteAmount = quoteAmount;
        lastMemeAmount = memeAmount;
        if (mode == Mode.REVERT) revert ForcedGraduationFailure();
        if (mode == Mode.COMMIT) _registry.commitPool(marketId, keccak256("canonical-pool"));
    }
}

contract GraduationExecutorEntryTest is Test {
    bytes32 private constant MARKET_ID = keccak256("graduation-entry-market");
    uint256 private constant QUOTE_AMOUNT = 11;
    uint256 private constant MEME_AMOUNT = 22;

    GraduationEntryRegistryMock private registry;
    GraduationEntryCurveCaller private curve;
    GraduationExecutorEntryHarness private executor;

    function setUp() public {
        registry = new GraduationEntryRegistryMock();
        curve = new GraduationEntryCurveCaller();
        executor = new GraduationExecutorEntryHarness(address(registry));
        registry.setExecutor(address(executor));
        registry.configure(MARKET_ID, address(curve), 0, 7);
    }

    function test_exactRegisteredCurveCanCommitOneCompleteGraduation() public {
        curve.graduate(executor, MARKET_ID, QUOTE_AMOUNT, MEME_AMOUNT);

        MarketView memory value = registry.market(MARKET_ID);
        assertEq(value.runtime.launchPhase, 1);
        assertEq(value.runtime.poolId, keccak256("canonical-pool"));
        assertEq(value.runtime.sourceVersion, 8);
        assertEq(executor.attemptCount(), 1);
        assertEq(executor.lastMarketId(), MARKET_ID);
        assertEq(executor.lastQuoteAmount(), QUOTE_AMOUNT);
        assertEq(executor.lastMemeAmount(), MEME_AMOUNT);
    }

    function test_nonRegisteredCurveCannotEnterAutomaticGraduation() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                GraduationExecutorEntry.UnauthorizedGraduationCurve.selector, address(this), address(curve)
            )
        );
        executor.graduateFromCurve(MARKET_ID, QUOTE_AMOUNT, MEME_AMOUNT);
        assertEq(executor.attemptCount(), 0);
    }

    function test_onlyNotGraduatedMarketCanReachGraduationAlgorithm() public {
        registry.configure(MARKET_ID, address(curve), 1, 7);
        vm.expectRevert(
            abi.encodeWithSelector(GraduationExecutorEntry.GraduationNotReady.selector, MARKET_ID, uint8(1))
        );
        curve.graduate(executor, MARKET_ID, QUOTE_AMOUNT, MEME_AMOUNT);

        assertEq(executor.attemptCount(), 0);
    }

    function test_downstreamFailureRollsBackEveryEntrySideEffect() public {
        executor.setMode(GraduationExecutorEntryHarness.Mode.REVERT);
        vm.expectRevert(GraduationExecutorEntryHarness.ForcedGraduationFailure.selector);
        curve.graduate(executor, MARKET_ID, QUOTE_AMOUNT, MEME_AMOUNT);

        MarketView memory value = registry.market(MARKET_ID);
        assertEq(value.runtime.launchPhase, 0);
        assertEq(value.runtime.sourceVersion, 7);
        assertEq(executor.attemptCount(), 0);
        assertEq(executor.lastMarketId(), bytes32(0));
    }

    function test_silentReturnWithoutPoolCreatedCommitFailsAndRollsBack() public {
        executor.setMode(GraduationExecutorEntryHarness.Mode.RETURN_WITHOUT_COMMIT);
        vm.expectRevert(
            abi.encodeWithSelector(
                GraduationExecutorEntry.GraduationNotCommitted.selector, MARKET_ID, uint8(0), bytes32(0), uint32(7)
            )
        );
        curve.graduate(executor, MARKET_ID, QUOTE_AMOUNT, MEME_AMOUNT);

        assertEq(executor.attemptCount(), 0);
        assertEq(registry.market(MARKET_ID).runtime.launchPhase, 0);
    }
}
