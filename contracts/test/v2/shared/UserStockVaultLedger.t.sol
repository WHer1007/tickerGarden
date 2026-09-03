// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import {Test} from "forge-std/Test.sol";

import {IOfficialStockRegistryV2, MarketView} from "../../../src/v2/interfaces/IV2Protocol.sol";
import {OfficialStockRegistryV2} from "../../../src/v2/modules/OfficialStockRegistryV2.sol";
import {UserStockVaultIdentity} from "../../../src/v2/shared/UserStockVaultIdentity.sol";
import {UserStockVaultLedger} from "../../../src/v2/shared/UserStockVaultLedger.sol";
import {MockExactQuoteToken} from "../mocks/MockV2QuoteAssets.sol";

interface IUserStockVaultLedgerHarness {
    function lockAllocation(address user, bytes32 marketId, uint256 amount) external;
    function releaseAllocation(address user, bytes32 marketId, uint256 amount) external;
    function moveAllocation(address user, bytes32 fromMarketId, bytes32 toMarketId, uint256 amount) external;
}

contract MockVaultMarketRegistry {
    mapping(bytes32 marketId => MarketView marketView) private _markets;
    mapping(bytes32 marketId => bool registered) private _registered;

    error MarketNotRegistered(bytes32 marketId);

    function configure(bytes32 marketId, bytes32 assetUid) external {
        _registered[marketId] = true;
        _markets[marketId].config.assetUid = assetUid;
    }

    function market(bytes32 marketId) external view returns (MarketView memory) {
        if (!_registered[marketId]) revert MarketNotRegistered(marketId);
        return _markets[marketId];
    }
}

contract MockVaultLedgerAllocationManager {
    function lock(IUserStockVaultLedgerHarness vault, address user, bytes32 marketId, uint256 amount) external {
        vault.lockAllocation(user, marketId, amount);
    }

    function release(IUserStockVaultLedgerHarness vault, address user, bytes32 marketId, uint256 amount) external {
        vault.releaseAllocation(user, marketId, amount);
    }

    function move(
        IUserStockVaultLedgerHarness vault,
        address user,
        bytes32 fromMarketId,
        bytes32 toMarketId,
        uint256 amount
    ) external {
        vault.moveAllocation(user, fromMarketId, toMarketId, amount);
    }
}

contract UserStockVaultLedgerHarness is UserStockVaultLedger, IUserStockVaultLedgerHarness {
    event StockDeposited(bytes32 indexed assetUid, address indexed user, uint256 amount);
    event AllocationLocked(
        address indexed user,
        bytes32 indexed marketId,
        uint256 amount,
        uint256 userMarketAllocation,
        uint256 userTotalAllocated
    );
    event AllocationReleased(
        address indexed user,
        bytes32 indexed marketId,
        uint256 amount,
        uint256 userMarketAllocation,
        uint256 userTotalAllocated
    );
    event AllocationMoved(
        address indexed user, bytes32 indexed fromMarketId, bytes32 indexed toMarketId, uint256 amount
    );

    constructor(address registry, address marketRegistry, address manager, bytes32 assetUid, address stockToken)
        UserStockVaultLedger(registry, marketRegistry, manager, assetUid, stockToken)
    {}

    function depositStock(uint256 amount) external {
        _depositStock(msg.sender, amount);
        emit StockDeposited(_assetUid, msg.sender, amount);
    }

    function lockAllocation(address user, bytes32 marketId, uint256 amount) external override onlyAllocationManager {
        _lockAllocation(user, marketId, amount);
        emit AllocationLocked(user, marketId, amount, _allocation[user][marketId], _allocated[user]);
    }

    function releaseAllocation(address user, bytes32 marketId, uint256 amount) external override onlyAllocationManager {
        _releaseAllocation(user, marketId, amount);
        emit AllocationReleased(user, marketId, amount, _allocation[user][marketId], _allocated[user]);
    }

    function moveAllocation(address user, bytes32 fromMarketId, bytes32 toMarketId, uint256 amount)
        external
        override
        onlyAllocationManager
    {
        _moveAllocation(user, fromMarketId, toMarketId, amount);
        emit AllocationMoved(user, fromMarketId, toMarketId, amount);
    }

    function deposited(address user) external view returns (uint256) {
        return _deposited[user];
    }

    function allocated(address user) external view returns (uint256) {
        return _allocated[user];
    }

    function allocation(address user, bytes32 marketId) external view returns (uint256) {
        return _allocation[user][marketId];
    }

    function freeBalanceOf(address user) external view returns (uint256) {
        return _freeBalanceOf(user);
    }

    function marketAllocated(bytes32 marketId) external view returns (uint256) {
        return _marketAllocated[marketId];
    }

    function totalDeposited() external view returns (uint256) {
        return _totalDeposited;
    }

    function totalAllocated() external view returns (uint256) {
        return _totalAllocated;
    }
}

contract UserStockVaultLedgerTest is Test {
    bytes32 internal constant ASSET_UID = keccak256("official-stock");
    bytes32 internal constant OTHER_ASSET_UID = keccak256("other-stock");
    bytes32 internal constant MARKET_A = keccak256("market-a");
    bytes32 internal constant MARKET_B = keccak256("market-b");
    bytes32 internal constant FOREIGN_MARKET = keccak256("foreign-market");
    bytes32 internal constant UNKNOWN_MARKET = keccak256("unknown-market");
    uint64 internal constant PROTOCOL_ADMIN_ROLE = 1;
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);

    AccessManager internal accessManager;
    OfficialStockRegistryV2 internal registry;
    MockVaultMarketRegistry internal marketRegistry;
    MockVaultLedgerAllocationManager internal manager;
    MockExactQuoteToken internal stockToken;
    UserStockVaultLedgerHarness internal vault;

    event AllocationLocked(
        address indexed user,
        bytes32 indexed marketId,
        uint256 amount,
        uint256 userMarketAllocation,
        uint256 userTotalAllocated
    );
    event AllocationReleased(
        address indexed user,
        bytes32 indexed marketId,
        uint256 amount,
        uint256 userMarketAllocation,
        uint256 userTotalAllocated
    );
    event AllocationMoved(
        address indexed user, bytes32 indexed fromMarketId, bytes32 indexed toMarketId, uint256 amount
    );

    function setUp() public {
        accessManager = new AccessManager(address(this));
        registry = new OfficialStockRegistryV2(address(accessManager));
        marketRegistry = new MockVaultMarketRegistry();
        manager = new MockVaultLedgerAllocationManager();
        stockToken = new MockExactQuoteToken(18);
        vault = new UserStockVaultLedgerHarness(
            address(registry), address(marketRegistry), address(manager), ASSET_UID, address(stockToken)
        );

        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = IOfficialStockRegistryV2.registerAsset.selector;
        accessManager.setTargetFunctionRole(address(registry), selectors, PROTOCOL_ADMIN_ROLE);
        accessManager.grantRole(PROTOCOL_ADMIN_ROLE, address(this), 0);
        registry.registerAsset(ASSET_UID, address(stockToken), 18, address(vault));

        marketRegistry.configure(MARKET_A, ASSET_UID);
        marketRegistry.configure(MARKET_B, ASSET_UID);
        marketRegistry.configure(FOREIGN_MARKET, OTHER_ASSET_UID);
    }

    function test_lockUpdatesEveryLedgerLevelAndEmitsCanonicalPostState() public {
        _deposit(ALICE, 1_000);

        vm.expectEmit(true, true, false, true, address(vault));
        emit AllocationLocked(ALICE, MARKET_A, 400, 400, 400);
        manager.lock(vault, ALICE, MARKET_A, 400);

        _assertUser(ALICE, 1_000, 400, 600);
        assertEq(vault.allocation(ALICE, MARKET_A), 400);
        assertEq(vault.marketAllocated(MARKET_A), 400);
        assertEq(vault.totalAllocated(), 400);
    }

    function test_multipleUsersAndMarketsPreserveAggregateEquations() public {
        _deposit(ALICE, 1_000);
        _deposit(BOB, 700);
        manager.lock(vault, ALICE, MARKET_A, 300);
        manager.lock(vault, ALICE, MARKET_B, 200);
        manager.lock(vault, BOB, MARKET_A, 600);

        assertEq(vault.allocated(ALICE), vault.allocation(ALICE, MARKET_A) + vault.allocation(ALICE, MARKET_B));
        assertEq(vault.allocated(BOB), vault.allocation(BOB, MARKET_A));
        assertEq(vault.marketAllocated(MARKET_A), 900);
        assertEq(vault.marketAllocated(MARKET_B), 200);
        assertEq(vault.totalAllocated(), vault.allocated(ALICE) + vault.allocated(BOB));
        assertEq(vault.totalAllocated(), vault.marketAllocated(MARKET_A) + vault.marketAllocated(MARKET_B));
        assertLe(vault.totalAllocated(), vault.totalDeposited());
    }

    function test_onlyManagerCanMutateAndOverFreeOrInvalidInputsRollback() public {
        _deposit(ALICE, 100);
        vm.expectRevert(
            abi.encodeWithSelector(
                UserStockVaultIdentity.UnauthorizedAllocationManager.selector, address(this), address(manager)
            )
        );
        vault.lockAllocation(ALICE, MARKET_A, 1);

        vm.expectRevert(abi.encodeWithSelector(UserStockVaultLedger.InvalidAllocationAmount.selector, uint256(0)));
        manager.lock(vault, ALICE, MARKET_A, 0);
        vm.expectRevert(abi.encodeWithSelector(UserStockVaultLedger.InvalidAllocationAccount.selector, address(0)));
        manager.lock(vault, address(0), MARKET_A, 1);
        vm.expectRevert(
            abi.encodeWithSelector(UserStockVaultLedger.AllocationExceedsDeposit.selector, uint256(101), uint256(100))
        );
        manager.lock(vault, ALICE, MARKET_A, 101);

        _assertUser(ALICE, 100, 0, 100);
        assertEq(vault.totalAllocated(), 0);
    }

    function test_unknownAndCrossAssetMarketsFailClosedWithoutLedgerChanges() public {
        _deposit(ALICE, 100);
        vm.expectRevert(abi.encodeWithSelector(MockVaultMarketRegistry.MarketNotRegistered.selector, UNKNOWN_MARKET));
        manager.lock(vault, ALICE, UNKNOWN_MARKET, 10);
        vm.expectRevert(
            abi.encodeWithSelector(
                UserStockVaultIdentity.MarketAssetMismatch.selector, FOREIGN_MARKET, ASSET_UID, OTHER_ASSET_UID
            )
        );
        manager.lock(vault, ALICE, FOREIGN_MARKET, 10);

        _assertUser(ALICE, 100, 0, 100);
        assertEq(vault.totalAllocated(), 0);
    }

    function test_releaseUpdatesEveryLedgerLevelAndEmitsCanonicalPostState() public {
        _deposit(ALICE, 500);
        manager.lock(vault, ALICE, MARKET_A, 400);

        vm.expectEmit(true, true, false, true, address(vault));
        emit AllocationReleased(ALICE, MARKET_A, 150, 250, 250);
        manager.release(vault, ALICE, MARKET_A, 150);

        _assertUser(ALICE, 500, 250, 250);
        assertEq(vault.allocation(ALICE, MARKET_A), 250);
        assertEq(vault.marketAllocated(MARKET_A), 250);
        assertEq(vault.totalAllocated(), 250);
    }

    function test_releaseAndMoveRejectInsufficientSourceAtomically() public {
        _deposit(ALICE, 500);
        manager.lock(vault, ALICE, MARKET_A, 200);

        vm.expectRevert(
            abi.encodeWithSelector(
                UserStockVaultLedger.InsufficientMarketAllocation.selector, MARKET_A, uint256(201), uint256(200)
            )
        );
        manager.release(vault, ALICE, MARKET_A, 201);
        vm.expectRevert(
            abi.encodeWithSelector(
                UserStockVaultLedger.InsufficientMarketAllocation.selector, MARKET_A, uint256(201), uint256(200)
            )
        );
        manager.move(vault, ALICE, MARKET_A, MARKET_B, 201);

        assertEq(vault.allocation(ALICE, MARKET_A), 200);
        assertEq(vault.allocation(ALICE, MARKET_B), 0);
        assertEq(vault.allocated(ALICE), 200);
        assertEq(vault.totalAllocated(), 200);
    }

    function test_movePreservesUserAndGlobalTotalsWhileMovingMarketOccupancy() public {
        _deposit(ALICE, 1_000);
        manager.lock(vault, ALICE, MARKET_A, 700);

        vm.expectEmit(true, true, true, true, address(vault));
        emit AllocationMoved(ALICE, MARKET_A, MARKET_B, 275);
        manager.move(vault, ALICE, MARKET_A, MARKET_B, 275);

        _assertUser(ALICE, 1_000, 700, 300);
        assertEq(vault.allocation(ALICE, MARKET_A), 425);
        assertEq(vault.allocation(ALICE, MARKET_B), 275);
        assertEq(vault.marketAllocated(MARKET_A), 425);
        assertEq(vault.marketAllocated(MARKET_B), 275);
        assertEq(vault.totalAllocated(), 700);
    }

    function test_moveRejectsZeroAndSameMarket() public {
        _deposit(ALICE, 100);
        manager.lock(vault, ALICE, MARKET_A, 50);
        vm.expectRevert(abi.encodeWithSelector(UserStockVaultLedger.InvalidAllocationAmount.selector, uint256(0)));
        manager.move(vault, ALICE, MARKET_A, MARKET_B, 0);
        vm.expectRevert(abi.encodeWithSelector(UserStockVaultLedger.SameAllocationMarket.selector, MARKET_A));
        manager.move(vault, ALICE, MARKET_A, MARKET_A, 1);

        assertEq(vault.allocation(ALICE, MARKET_A), 50);
        assertEq(vault.totalAllocated(), 50);
    }

    function testFuzz_lockReleaseMovePreserveAllEquations(uint96 first, uint96 second, uint96 released, uint96 moved)
        public
    {
        uint256 depositAmount = 1e24;
        first = uint96(bound(first, 1, depositAmount / 2));
        second = uint96(bound(second, 1, depositAmount - first));
        released = uint96(bound(released, 0, first));
        moved = uint96(bound(moved, 0, uint256(first) - released));
        _deposit(ALICE, depositAmount);

        manager.lock(vault, ALICE, MARKET_A, first);
        manager.lock(vault, ALICE, MARKET_B, second);
        if (released != 0) manager.release(vault, ALICE, MARKET_A, released);
        if (moved != 0) manager.move(vault, ALICE, MARKET_A, MARKET_B, moved);

        uint256 marketA = uint256(first) - released - moved;
        uint256 marketB = uint256(second) + moved;
        uint256 expectedAllocated = marketA + marketB;
        assertEq(vault.allocation(ALICE, MARKET_A), marketA);
        assertEq(vault.allocation(ALICE, MARKET_B), marketB);
        assertEq(vault.allocated(ALICE), expectedAllocated);
        assertEq(vault.marketAllocated(MARKET_A), marketA);
        assertEq(vault.marketAllocated(MARKET_B), marketB);
        assertEq(vault.totalAllocated(), expectedAllocated);
        assertEq(vault.freeBalanceOf(ALICE), depositAmount - expectedAllocated);
        assertLe(vault.totalAllocated(), vault.totalDeposited());
    }

    function _deposit(address user, uint256 amount) private {
        stockToken.mint(user, amount);
        vm.startPrank(user);
        stockToken.approve(address(vault), amount);
        vault.depositStock(amount);
        vm.stopPrank();
    }

    function _assertUser(address user, uint256 depositedAmount, uint256 allocatedAmount, uint256 freeAmount)
        private
        view
    {
        assertEq(vault.deposited(user), depositedAmount);
        assertEq(vault.allocated(user), allocatedAmount);
        assertEq(vault.freeBalanceOf(user), freeAmount);
    }
}
