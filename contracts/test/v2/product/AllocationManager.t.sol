// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {
    AssetView,
    IAllocationManager,
    IUserStockVault,
    MarketView,
    PositionView
} from "../../../src/v2/interfaces/IV2Protocol.sol";
import {AllocationManager} from "../../../src/v2/modules/AllocationManager.sol";
import {UserStockVault} from "../../../src/v2/modules/UserStockVault.sol";
import {AllocationManagerExits} from "../../../src/v2/shared/AllocationManagerExits.sol";
import {AllocationManagerIncreases} from "../../../src/v2/shared/AllocationManagerIncreases.sol";
import {MockExactQuoteToken} from "../mocks/MockV2QuoteAssets.sol";

contract MockAllocationOfficialStockRegistry {
    mapping(bytes32 assetUid => AssetView assetView) private _assets;
    mapping(bytes32 assetUid => uint256 minimum) private _minimumAllocations;

    function configure(bytes32 assetUid, address token, address vault, uint8 status, uint256 minimum) external {
        _assets[assetUid] = AssetView(token, vault, 18, status);
        _minimumAllocations[assetUid] = minimum;
    }

    function setStatus(bytes32 assetUid, uint8 status) external {
        _assets[assetUid].status = status;
    }

    function asset(bytes32 assetUid) external view returns (AssetView memory) {
        return _assets[assetUid];
    }

    function minimumAllocation(bytes32 assetUid) external view returns (uint256) {
        return _minimumAllocations[assetUid];
    }
}

contract MockAllocationMarketRegistry {
    mapping(bytes32 marketId => MarketView marketView) private _markets;

    function configure(bytes32 marketId, bytes32 assetUid, address gauge, uint8 marketStatus) external {
        _markets[marketId].config.assetUid = assetUid;
        _markets[marketId].config.gauge = gauge;
        _markets[marketId].runtime.launchPhase = 2;
        _markets[marketId].runtime.marketStatus = marketStatus;
    }

    function market(bytes32 marketId) external view returns (MarketView memory) {
        return _markets[marketId];
    }
}

contract MockFullExitGauge {
    address public manager;
    IUserStockVault public vault;
    bytes32 public assetUid;
    bytes32 public marketId;
    uint8 public failureMode;
    mapping(address user => PositionView position) private _positions;

    uint8 internal constant FAIL_REMOVE = 1;
    uint8 internal constant NOOP_REMOVE = 2;
    uint8 internal constant WRONG_REMOVE_RETURN = 3;
    uint8 internal constant REENTER_REMOVE = 4;

    error InvalidManager(address caller);
    error InjectedFailure();
    error InvalidVaultOrder(uint256 expected, uint256 actual);

    function configure(address manager_, IUserStockVault vault_, bytes32 assetUid_, bytes32 marketId_) external {
        manager = manager_;
        vault = vault_;
        assetUid = assetUid_;
        marketId = marketId_;
    }

    function setFailureMode(uint8 mode) external {
        failureMode = mode;
    }

    function checkpointActivations() external returns (uint256, uint256) {
        _onlyManager();
        return (0, 0);
    }

    function settle(address user) external {
        _onlyManager();
        _materialize(user);
    }

    function addPending(address user, uint256 amount, uint64 activationAt, uint64 unlockAt) external {
        _onlyManager();
        PositionView storage position = _positions[user];
        uint256 expected = position.activeAmount + position.pendingAmount + amount;
        uint256 actual = vault.allocation(assetUid, user, marketId);
        if (actual != expected) revert InvalidVaultOrder(expected, actual);
        position.pendingAmount += amount;
        position.pendingGeneration = activationAt;
        position.unlockAt = unlockAt;
    }

    function removeAllocation(address user) external returns (uint256 amount) {
        _onlyManager();
        if (failureMode == FAIL_REMOVE) revert InjectedFailure();
        _materialize(user);
        PositionView storage position = _positions[user];
        amount = position.activeAmount + position.pendingAmount;
        uint256 vaultAmount = vault.allocation(assetUid, user, marketId);
        if (vaultAmount != amount) revert InvalidVaultOrder(amount, vaultAmount);
        if (failureMode == REENTER_REMOVE) IAllocationManager(manager).closeAllocation(marketId);
        if (failureMode == NOOP_REMOVE) return amount;
        position.activeAmount = 0;
        position.pendingAmount = 0;
        position.pendingGeneration = 0;
        position.unlockAt = 0;
        if (failureMode == WRONG_REMOVE_RETURN) return amount + 1;
    }

    function rageQuit(address user) external returns (uint256 principal, uint256, uint256, bool) {
        _onlyManager();
        PositionView storage position = _positions[user];
        principal = position.activeAmount + position.pendingAmount;
        position.activeAmount = 0;
        position.pendingAmount = 0;
        position.pendingGeneration = 0;
        position.unlockAt = 0;
        return (principal, 0, 0, false);
    }

    function positionOf(address user) external view returns (PositionView memory) {
        return _positions[user];
    }

    function _materialize(address user) private {
        PositionView storage position = _positions[user];
        if (position.pendingAmount != 0 && block.timestamp >= position.pendingGeneration) {
            position.activeAmount += position.pendingAmount;
            position.pendingAmount = 0;
            position.pendingGeneration = 0;
        }
    }

    function _onlyManager() private view {
        if (msg.sender != manager) revert InvalidManager(msg.sender);
    }
}

contract AllocationManagerTest is Test {
    bytes32 internal constant ASSET_UID = keccak256("official-stock");
    bytes32 internal constant MARKET_ID = keccak256("market");
    bytes32 internal constant OTHER_MARKET_ID = keccak256("other-market");
    address internal constant ALICE = address(0xA11CE);

    MockAllocationOfficialStockRegistry internal officialRegistry;
    MockAllocationMarketRegistry internal marketRegistry;
    AllocationManager internal manager;
    MockExactQuoteToken internal stockToken;
    UserStockVault internal vault;
    MockFullExitGauge internal gauge;

    function setUp() public {
        officialRegistry = new MockAllocationOfficialStockRegistry();
        marketRegistry = new MockAllocationMarketRegistry();
        manager = new AllocationManager(address(officialRegistry), address(marketRegistry));
        stockToken = new MockExactQuoteToken(18);
        gauge = new MockFullExitGauge();
        vault = new UserStockVault(address(officialRegistry), address(marketRegistry), address(manager));
        officialRegistry.configure(ASSET_UID, address(stockToken), address(vault), 1, 0.5 ether);
        marketRegistry.configure(MARKET_ID, ASSET_UID, address(gauge), 0);
        gauge.configure(address(manager), vault, ASSET_UID, MARKET_ID);
    }

    function test_allDepositPathsOnlyIncreaseOnePosition() public {
        vm.warp(1_000_000);
        stockToken.mint(ALICE, 4 ether);
        vm.startPrank(ALICE);
        stockToken.approve(address(vault), 4 ether);
        vault.depositStock(ASSET_UID, 2 ether);
        manager.allocate(MARKET_ID, 1 ether);
        manager.increaseAllocation(MARKET_ID, 0.5 ether);
        manager.depositAndAllocate(MARKET_ID, 2 ether, 1 ether);
        vm.stopPrank();

        PositionView memory position = gauge.positionOf(ALICE);
        assertEq(position.activeAmount, 0);
        assertEq(position.pendingAmount, 2.5 ether);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 2.5 ether);
        assertEq(vault.freeBalanceOf(ASSET_UID, ALICE), 1.5 ether);
        assertEq(vault.deposited(ASSET_UID, ALICE), 4 ether);
    }

    function test_closeAtUnlockRemovesAndReleasesTheWholePosition() public {
        _seedAllocation(2 ether);
        vm.warp(gauge.positionOf(ALICE).unlockAt);

        vm.prank(ALICE);
        manager.closeAllocation(MARKET_ID);

        assertEq(_positionAmount(ALICE), 0);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 0);
        assertEq(vault.allocated(ASSET_UID, ALICE), 0);
        assertEq(vault.freeBalanceOf(ASSET_UID, ALICE), 2 ether);
        assertEq(vault.totalAllocated(ASSET_UID), 0);
        assertEq(stockToken.balanceOf(address(vault)), 2 ether);
    }

    function test_lockedCloseAndEmergencyCloseFailWithoutChangingPrincipal() public {
        _seedAllocation(1 ether);
        uint64 unlockAt = gauge.positionOf(ALICE).unlockAt;

        vm.expectRevert(abi.encodeWithSelector(AllocationManagerExits.PositionLockedUntil.selector, unlockAt));
        vm.prank(ALICE);
        manager.closeAllocation(MARKET_ID);

        vm.warp(unlockAt);
        marketRegistry.configure(MARKET_ID, ASSET_UID, address(gauge), 3);
        vm.expectRevert(abi.encodeWithSelector(AllocationManagerIncreases.StockAllocationClosed.selector, MARKET_ID));
        vm.prank(ALICE);
        manager.closeAllocation(MARKET_ID);

        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 1 ether);
        assertEq(_positionAmount(ALICE), 1 ether);
    }

    function test_pausedRetiredMarketAndAssetStillAllowWholeClose() public {
        for (uint8 marketStatus = 1; marketStatus <= 2; ++marketStatus) {
            address user = address(uint160(0xCAFE + marketStatus));
            _seedAllocationFor(user, 1 ether);
            vm.warp(gauge.positionOf(user).unlockAt);
            marketRegistry.configure(MARKET_ID, ASSET_UID, address(gauge), marketStatus);
            officialRegistry.setStatus(ASSET_UID, marketStatus + 1);

            vm.prank(user);
            manager.closeAllocation(MARKET_ID);
            assertEq(vault.allocation(ASSET_UID, user, MARKET_ID), 0);

            marketRegistry.configure(MARKET_ID, ASSET_UID, address(gauge), 0);
            officialRegistry.setStatus(ASSET_UID, 1);
        }
    }

    function test_gaugeFailureNoopWrongReturnAndReentrancyRollBackTheWholeClose() public {
        _seedAllocation(1 ether);
        vm.warp(gauge.positionOf(ALICE).unlockAt);

        for (uint8 mode = 1; mode <= 4; ++mode) {
            gauge.setFailureMode(mode);
            vm.expectRevert();
            vm.prank(ALICE);
            manager.closeAllocation(MARKET_ID);
            assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 1 ether);
            assertEq(_positionAmount(ALICE), 1 ether);
        }
    }

    function test_rageQuitStillWithdrawsTheWholePositionDirectly() public {
        _seedAllocation(1 ether);
        uint256 walletBefore = stockToken.balanceOf(ALICE);

        vm.prank(ALICE);
        manager.rageQuit(MARKET_ID);

        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 0);
        assertEq(vault.deposited(ASSET_UID, ALICE), 0);
        assertEq(stockToken.balanceOf(ALICE), walletBefore + 1 ether);
        assertEq(stockToken.balanceOf(address(vault)), 0);
    }

    function test_canonicalSurfaceHasNoDecreaseMigrationOrRecipientBypass() public {
        assertEq(AllocationManager.allocate.selector, IAllocationManager.allocate.selector);
        assertEq(AllocationManager.increaseAllocation.selector, IAllocationManager.increaseAllocation.selector);
        assertEq(AllocationManager.closeAllocation.selector, IAllocationManager.closeAllocation.selector);
        assertEq(AllocationManager.rageQuit.selector, IAllocationManager.rageQuit.selector);
        assertEq(AllocationManager.depositAndAllocate.selector, IAllocationManager.depositAndAllocate.selector);

        (bool partialCall,) =
            address(manager).call(abi.encodeWithSignature("decreaseAllocation(bytes32,uint256)", MARKET_ID, 1));
        (bool migrate,) = address(manager)
            .call(abi.encodeWithSignature("migrateAllocation(bytes32,bytes32,uint256)", MARKET_ID, OTHER_MARKET_ID, 1));
        (bool closeFor,) =
            address(manager).call(abi.encodeWithSignature("closeAllocationFor(address,bytes32)", ALICE, MARKET_ID));
        assertFalse(partialCall);
        assertFalse(migrate);
        assertFalse(closeFor);
    }

    function testFuzz_closeAlwaysReleasesExactlyTheFullAllocation(uint96 seed) public {
        uint256 amount = bound(uint256(seed), 0.5 ether, 1_000_000 ether);
        _seedAllocation(amount);
        vm.warp(gauge.positionOf(ALICE).unlockAt);

        vm.prank(ALICE);
        manager.closeAllocation(MARKET_ID);

        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 0);
        assertEq(vault.freeBalanceOf(ASSET_UID, ALICE), amount);
        assertEq(vault.totalAllocated(ASSET_UID), 0);
        assertEq(stockToken.balanceOf(address(vault)), amount);
    }

    function _seedAllocation(uint256 amount) private {
        _seedAllocationFor(ALICE, amount);
    }

    function _seedAllocationFor(address user, uint256 amount) private {
        vm.warp(2_000_000);
        stockToken.mint(user, amount);
        vm.startPrank(user);
        stockToken.approve(address(vault), amount);
        vault.depositStock(ASSET_UID, amount);
        manager.allocate(MARKET_ID, amount);
        vm.stopPrank();
    }

    function _positionAmount(address user) private view returns (uint256) {
        PositionView memory position = gauge.positionOf(user);
        return position.activeAmount + position.pendingAmount;
    }
}
