// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {
    AssetView,
    IAllocationManager,
    IMemeStockGauge,
    IUserStockVault,
    MarketView,
    PositionView
} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {UserStockVault} from "../../../src/v1/modules/UserStockVault.sol";
import {AllocationManagerIncreases} from "../../../src/v1/shared/AllocationManagerIncreases.sol";
import {MockExactQuoteToken} from "../mocks/MockV1QuoteAssets.sol";

contract MockIncreaseOfficialStockRegistry {
    mapping(bytes32 assetUid => AssetView assetView) private _assets;
    mapping(bytes32 assetUid => uint256 minimum) private _minimumAllocations;
    bool private _identityCurrent = true;

    function configure(
        bytes32 assetUid,
        address stockToken,
        address vault,
        uint8 decimals,
        uint8 status,
        uint256 minimum
    ) external {
        _assets[assetUid] = AssetView({
            stockToken: stockToken, userStockVault: vault, tokenDecimals: decimals, status: status
        });
        _minimumAllocations[assetUid] = minimum;
    }

    function setStatus(bytes32 assetUid, uint8 status) external {
        _assets[assetUid].status = status;
    }

    function setIdentityCurrent(bool current) external {
        _identityCurrent = current;
    }

    function asset(bytes32 assetUid) external view returns (AssetView memory) {
        return _assets[assetUid];
    }

    /// @dev Test fixture default: identity is stable unless a focused test overrides the registry.
    function assetIdentityCurrent(bytes32) external view returns (bool) {
        return _identityCurrent;
    }

    function minimumAllocation(bytes32 assetUid) external view returns (uint256) {
        return _minimumAllocations[assetUid];
    }
}

contract MockIncreaseMarketRegistry {
    mapping(bytes32 marketId => MarketView marketView) private _markets;
    mapping(bytes32 marketId => bool registered) private _registered;

    error MarketNotRegistered(bytes32 marketId);

    function configure(bytes32 marketId, bytes32 assetUid, address gauge, uint8 launchPhase) external {
        _registered[marketId] = true;
        _markets[marketId].config.assetUid = assetUid;
        _markets[marketId].config.gauge = gauge;
        _markets[marketId].runtime.launchPhase = launchPhase;
    }

    function market(bytes32 marketId) external view returns (MarketView memory) {
        if (!_registered[marketId]) revert MarketNotRegistered(marketId);
        return _markets[marketId];
    }
}

contract AllocationManagerIncreasesHarness is AllocationManagerIncreases {
    constructor(address officialStockRegistry, address marketRegistry)
        AllocationManagerIncreases(officialStockRegistry, marketRegistry)
    {}

    function allocate(bytes32 marketId, uint256 amount) external {
        _increaseAllocation(msg.sender, marketId, amount);
    }

    function increaseAllocation(bytes32 marketId, uint256 amount) external {
        _increaseAllocation(msg.sender, marketId, amount);
    }
}

contract MockIncreaseGauge {
    uint8 internal constant FAIL_CHECKPOINT = 1;
    uint8 internal constant FAIL_SETTLE = 2;
    uint8 internal constant FAIL_ADD = 3;
    uint8 internal constant NOOP_ADD = 4;
    uint8 internal constant REENTER_CHECKPOINT = 5;

    address public manager;
    IUserStockVault public vault;
    bytes32 public assetUid;
    bytes32 public marketId;
    uint8 public failureMode;
    uint256 public checkpointCalls;
    uint256 public settleCalls;
    mapping(address user => PositionView position) private _positions;

    error InjectedGaugeFailure(uint8 stage);
    error InvalidManager(address caller);
    error InvalidCallOrder();
    error VaultNotLockedFirst(uint256 expected, uint256 actual);

    function configure(address manager_, IUserStockVault vault_, bytes32 assetUid_, bytes32 marketId_) external {
        manager = manager_;
        vault = vault_;
        assetUid = assetUid_;
        marketId = marketId_;
    }

    function setFailureMode(uint8 mode) external {
        failureMode = mode;
    }

    function setPosition(address user, uint256 activeAmount, uint256 pendingAmount) external {
        _positions[user].activeAmount = activeAmount;
        _positions[user].pendingAmount = pendingAmount;
    }

    function checkpointActivations() external returns (uint256, uint256) {
        if (msg.sender != manager) revert InvalidManager(msg.sender);
        if (failureMode == FAIL_CHECKPOINT) revert InjectedGaugeFailure(FAIL_CHECKPOINT);
        if (failureMode == REENTER_CHECKPOINT) {
            IAllocationManager(manager).allocate(marketId, 1);
        }
        ++checkpointCalls;
        return (0, 0);
    }

    function settle(address) external {
        if (msg.sender != manager) revert InvalidManager(msg.sender);
        if (checkpointCalls != settleCalls + 1) revert InvalidCallOrder();
        if (failureMode == FAIL_SETTLE) revert InjectedGaugeFailure(FAIL_SETTLE);
        ++settleCalls;
    }

    function addPending(address user, uint256 amount, uint64 activationAt, uint64 unlockAt) external {
        if (msg.sender != manager) revert InvalidManager(msg.sender);
        if (checkpointCalls != settleCalls) revert InvalidCallOrder();
        if (failureMode == FAIL_ADD) revert InjectedGaugeFailure(FAIL_ADD);

        PositionView storage position = _positions[user];
        uint256 expected = position.activeAmount + position.pendingAmount + amount;
        uint256 actual = vault.allocation(assetUid, user, marketId);
        if (actual != expected) revert VaultNotLockedFirst(expected, actual);
        if (failureMode == NOOP_ADD) return;

        position.pendingAmount += amount;
        position.pendingGeneration = activationAt;
        position.unlockAt = unlockAt;
    }

    function positionOf(address user) external view returns (PositionView memory) {
        return _positions[user];
    }
}

contract EmptyIncreaseDependency {}

contract AllocationManagerIncreasesTest is Test {
    bytes32 internal constant ASSET_UID = keccak256("official-stock");
    bytes32 internal constant MARKET_ID = keccak256("market");
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);

    MockIncreaseOfficialStockRegistry internal officialRegistry;
    MockIncreaseMarketRegistry internal marketRegistry;
    AllocationManagerIncreasesHarness internal manager;
    MockIncreaseGauge internal gauge;
    MockExactQuoteToken internal stockToken;
    UserStockVault internal vault;

    function setUp() public {
        officialRegistry = new MockIncreaseOfficialStockRegistry();
        marketRegistry = new MockIncreaseMarketRegistry();
        manager = new AllocationManagerIncreasesHarness(address(officialRegistry), address(marketRegistry));
        gauge = new MockIncreaseGauge();
        stockToken = new MockExactQuoteToken(18);
        vault = new UserStockVault(address(officialRegistry), address(marketRegistry), address(manager));
        officialRegistry.configure(ASSET_UID, address(stockToken), address(vault), 18, 1, 0.5 ether);
        marketRegistry.configure(MARKET_ID, ASSET_UID, address(gauge), 2);
        gauge.configure(address(manager), vault, ASSET_UID, MARKET_ID);
    }

    function test_allocateUsesCanonicalOrderAndSchedulesExactDelays() public {
        _deposit(ALICE, 2 ether);
        vm.warp(1_000_000);

        vm.prank(ALICE);
        manager.allocate(MARKET_ID, 0.5 ether + 1);

        PositionView memory position = gauge.positionOf(ALICE);
        assertEq(gauge.checkpointCalls(), 1);
        assertEq(gauge.settleCalls(), 1);
        assertEq(position.activeAmount, 0);
        assertEq(position.pendingAmount, 0.5 ether + 1);
        assertEq(position.pendingGeneration, block.timestamp + 30 seconds);
        assertEq(position.unlockAt, block.timestamp + 24 hours);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), position.pendingAmount);
        assertEq(vault.freeBalanceOf(ASSET_UID, ALICE), 1.5 ether - 1);
        assertEq(stockToken.balanceOf(address(manager)), 0);
        assertEq(stockToken.allowance(address(vault), address(manager)), 0);
    }

    function test_increaseCombinesPositionAndResetsBothTimersFromLatestCall() public {
        _deposit(ALICE, 2 ether);
        vm.warp(2_000_000);
        vm.prank(ALICE);
        manager.allocate(MARKET_ID, 0.6 ether);
        PositionView memory first = gauge.positionOf(ALICE);

        vm.warp(block.timestamp + 17);
        vm.prank(ALICE);
        manager.increaseAllocation(MARKET_ID, 0.1 ether);
        PositionView memory increased = gauge.positionOf(ALICE);

        assertEq(increased.pendingAmount, 0.7 ether);
        assertEq(increased.pendingGeneration, block.timestamp + 30 seconds);
        assertEq(increased.unlockAt, block.timestamp + 24 hours);
        assertGt(increased.pendingGeneration, first.pendingGeneration);
        assertGt(increased.unlockAt, first.unlockAt);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 0.7 ether);
    }

    function test_nonPoolCreatedMarketsRejectBeforeGaugeCalls() public {
        _deposit(ALICE, 2 ether);
        for (uint8 phase; phase < 4; ++phase) {
            if (phase == 2) continue;
            marketRegistry.configure(MARKET_ID, ASSET_UID, address(gauge), phase);
            vm.expectRevert(
                abi.encodeWithSelector(AllocationManagerIncreases.StockAllocationClosed.selector, MARKET_ID)
            );
            vm.prank(ALICE);
            manager.allocate(MARKET_ID, 1 ether);
        }
        assertEq(gauge.checkpointCalls(), 0);
        assertEq(gauge.settleCalls(), 0);
    }

    function test_assetMustRemainActiveForEveryIncrease() public {
        _deposit(ALICE, 2 ether);
        for (uint8 status = 2; status <= 3; ++status) {
            officialRegistry.setStatus(ASSET_UID, status);
            vm.expectRevert(
                abi.encodeWithSelector(AllocationManagerIncreases.StockAllocationClosed.selector, MARKET_ID)
            );
            vm.prank(ALICE);
            manager.allocate(MARKET_ID, 1 ether);
        }
        assertEq(gauge.checkpointCalls(), 0);
    }

    function test_identityDriftBlocksNewAllocationBeforeGaugeOrVaultMutation() public {
        _deposit(ALICE, 2 ether);
        officialRegistry.setIdentityCurrent(false);

        vm.expectRevert(abi.encodeWithSelector(AllocationManagerIncreases.AssetIdentityDrift.selector, ASSET_UID));
        vm.prank(ALICE);
        manager.allocate(MARKET_ID, 1 ether);

        assertEq(gauge.checkpointCalls(), 0);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 0);
        assertEq(vault.freeBalanceOf(ASSET_UID, ALICE), 2 ether);
    }

    function test_positionMustMeetConfiguredMinimumAndExactBoundarySucceeds() public {
        _deposit(ALICE, 2 ether);
        vm.expectRevert(
            abi.encodeWithSelector(
                AllocationManagerIncreases.PositionBelowMinimum.selector, uint256(0.5 ether - 1), uint256(0.5 ether)
            )
        );
        vm.prank(ALICE);
        manager.allocate(MARKET_ID, 0.5 ether - 1);

        vm.prank(ALICE);
        manager.allocate(MARKET_ID, 0.5 ether);
        vm.prank(ALICE);
        manager.increaseAllocation(MARKET_ID, 1);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 0.5 ether + 1);
    }

    function test_decimalDomainAndSixDecimalRawUnitBoundaryFailClosed() public {
        officialRegistry.configure(ASSET_UID, address(stockToken), address(vault), 6, 1, 500_000);
        _deposit(ALICE, 1_000_000);
        vm.expectRevert(
            abi.encodeWithSelector(
                AllocationManagerIncreases.PositionBelowMinimum.selector, uint256(499_999), uint256(500_000)
            )
        );
        vm.prank(ALICE);
        manager.allocate(MARKET_ID, 499_999);

        vm.prank(ALICE);
        manager.allocate(MARKET_ID, 500_000);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 500_000);

        officialRegistry.configure(ASSET_UID, address(stockToken), address(vault), 5, 1, 50_000);
        vm.expectRevert(
            abi.encodeWithSelector(
                AllocationManagerIncreases.InvalidAllocationComponents.selector,
                MARKET_ID,
                address(vault),
                address(gauge)
            )
        );
        vm.prank(ALICE);
        manager.increaseAllocation(MARKET_ID, 1);

        officialRegistry.configure(ASSET_UID, address(stockToken), address(vault), 19, 1, 500_000_000_000_000_000);
        vm.expectRevert(
            abi.encodeWithSelector(
                AllocationManagerIncreases.InvalidAllocationComponents.selector,
                MARKET_ID,
                address(vault),
                address(gauge)
            )
        );
        vm.prank(ALICE);
        manager.increaseAllocation(MARKET_ID, 1);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 500_000);
    }

    function test_zeroAmountAndTimestampOverflowFailBeforeExternalEffects() public {
        _deposit(ALICE, 2 ether);
        vm.expectRevert(abi.encodeWithSelector(AllocationManagerIncreases.InvalidAllocationAmount.selector, uint256(0)));
        vm.prank(ALICE);
        manager.allocate(MARKET_ID, 0);

        vm.warp(uint256(type(uint64).max) - 24 hours + 1);
        vm.expectRevert(
            abi.encodeWithSelector(AllocationManagerIncreases.AllocationTimestampOverflow.selector, block.timestamp)
        );
        vm.prank(ALICE);
        manager.allocate(MARKET_ID, 1 ether);
        assertEq(gauge.checkpointCalls(), 0);
    }

    function test_vaultFreeBalanceFailureRollsBackCheckpointAndSettlement() public {
        _deposit(ALICE, 0.75 ether);
        vm.expectRevert();
        vm.prank(ALICE);
        manager.allocate(MARKET_ID, 1 ether);

        assertEq(gauge.checkpointCalls(), 0);
        assertEq(gauge.settleCalls(), 0);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 0);
        assertEq(vault.freeBalanceOf(ASSET_UID, ALICE), 0.75 ether);
    }

    function test_everyGaugeFailureAndNoopRollsBackVaultAndGauge() public {
        _deposit(ALICE, 4 ether);
        for (uint8 mode = 1; mode <= 4; ++mode) {
            gauge.setFailureMode(mode);
            vm.expectRevert();
            vm.prank(ALICE);
            manager.allocate(MARKET_ID, 1 ether);
            assertEq(gauge.checkpointCalls(), 0);
            assertEq(gauge.settleCalls(), 0);
            assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 0);
        }
    }

    function test_preexistingGaugeVaultMismatchFailsClosedAndRollsBackSettlement() public {
        _deposit(ALICE, 2 ether);
        gauge.setPosition(ALICE, 1 ether, 0);
        vm.expectRevert(AllocationManagerIncreases.AllocationLedgerMismatch.selector);
        vm.prank(ALICE);
        manager.allocate(MARKET_ID, 1 ether);

        assertEq(gauge.checkpointCalls(), 0);
        assertEq(gauge.settleCalls(), 0);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 0);
    }

    function test_reentrantGaugeCannotEnterManagerOrLeavePartialState() public {
        _deposit(ALICE, 2 ether);
        gauge.setFailureMode(5);
        vm.expectRevert();
        vm.prank(ALICE);
        manager.allocate(MARKET_ID, 1 ether);

        assertEq(gauge.checkpointCalls(), 0);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 0);
        assertEq(vault.allocated(ASSET_UID, ALICE), 0);
    }

    function test_constructorRejectsMissingOrAliasedRegistries() public {
        EmptyIncreaseDependency dependency = new EmptyIncreaseDependency();
        vm.expectRevert();
        new AllocationManagerIncreasesHarness(address(0), address(marketRegistry));
        vm.expectRevert();
        new AllocationManagerIncreasesHarness(address(officialRegistry), address(0x1234));
        vm.expectRevert();
        new AllocationManagerIncreasesHarness(address(dependency), address(dependency));
    }

    function test_noAllocateForOrRecipientMutationSurfaceExists() public {
        (bool allocateFor,) = address(manager)
            .call(abi.encodeWithSignature("allocateFor(address,bytes32,uint256)", ALICE, MARKET_ID, 1 ether));
        assertFalse(allocateFor);
        (bool increaseFor,) = address(manager)
            .call(abi.encodeWithSignature("increaseAllocationFor(address,bytes32,uint256)", ALICE, MARKET_ID, 1 ether));
        assertFalse(increaseFor);

        _deposit(ALICE, 1 ether);
        vm.prank(BOB);
        vm.expectRevert();
        manager.allocate(MARKET_ID, 0.5 ether + 1);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 0);
    }

    function _deposit(address user, uint256 amount) private {
        stockToken.mint(user, amount);
        vm.startPrank(user);
        stockToken.approve(address(vault), amount);
        vault.depositStock(ASSET_UID, amount);
        vm.stopPrank();
    }
}
