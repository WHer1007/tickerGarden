// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {IAllocationManager, IUserStockVault, PositionView} from "../../../src/v2/interfaces/IV2Protocol.sol";
import {UserStockVault} from "../../../src/v2/modules/UserStockVault.sol";
import {AllocationManagerDeposits} from "../../../src/v2/shared/AllocationManagerDeposits.sol";
import {AllocationManagerIncreases} from "../../../src/v2/shared/AllocationManagerIncreases.sol";
import {UserStockVaultDeposits} from "../../../src/v2/shared/UserStockVaultDeposits.sol";
import {
    MockIncreaseGauge,
    MockIncreaseMarketRegistry,
    MockIncreaseOfficialStockRegistry
} from "./AllocationManagerIncreases.t.sol";
import {MockExactQuoteToken} from "../mocks/MockV2QuoteAssets.sol";

contract AllocationManagerDepositsHarness is AllocationManagerDeposits {
    constructor(address officialStockRegistry, address marketRegistry)
        AllocationManagerDeposits(officialStockRegistry, marketRegistry)
    {}

    function allocate(bytes32 marketId, uint256 amount) external {
        _increaseAllocation(msg.sender, marketId, amount);
    }

    function depositAndAllocate(bytes32 marketId, uint256 depositAmount, uint256 allocationAmount) external {
        _depositAndAllocate(msg.sender, marketId, depositAmount, allocationAmount);
    }
}

contract MockReentrantDepositToken is MockExactQuoteToken {
    IAllocationManager private _manager;
    bytes32 private _marketId;
    bool private _attack;

    constructor() MockExactQuoteToken(18) {}

    function configureAttack(IAllocationManager manager, bytes32 marketId, bool attack) external {
        _manager = manager;
        _marketId = marketId;
        _attack = attack;
    }

    function transferFrom(address owner, address recipient, uint256 amount) external override returns (bool) {
        if (_attack) _manager.depositAndAllocate(_marketId, 1, 1);
        uint256 currentAllowance = allowance[owner][msg.sender];
        if (currentAllowance != type(uint256).max) allowance[owner][msg.sender] = currentAllowance - amount;
        _transfer(owner, recipient, amount);
        return true;
    }
}

contract AllocationManagerDepositsTest is Test {
    bytes32 internal constant ASSET_UID = keccak256("official-stock");
    bytes32 internal constant MARKET_ID = keccak256("market");
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);

    MockIncreaseOfficialStockRegistry internal officialRegistry;
    MockIncreaseMarketRegistry internal marketRegistry;
    AllocationManagerDepositsHarness internal manager;
    MockIncreaseGauge internal gauge;
    MockExactQuoteToken internal stockToken;
    UserStockVault internal vault;

    event StockDeposited(bytes32 indexed assetUid, address indexed user, uint256 amount);
    event AllocationLocked(
        bytes32 indexed assetUid,
        address indexed user,
        bytes32 indexed marketId,
        uint256 amount,
        uint256 userMarketAllocation,
        uint256 userTotalAllocated
    );

    function setUp() public {
        officialRegistry = new MockIncreaseOfficialStockRegistry();
        marketRegistry = new MockIncreaseMarketRegistry();
        manager = new AllocationManagerDepositsHarness(address(officialRegistry), address(marketRegistry));
        gauge = new MockIncreaseGauge();
        stockToken = new MockExactQuoteToken(18);
        vault = new UserStockVault(address(officialRegistry), address(marketRegistry), address(manager));
        officialRegistry.configure(ASSET_UID, address(stockToken), address(vault), 18, 1, 0.5 ether);
        marketRegistry.configure(MARKET_ID, ASSET_UID, address(gauge), 2, 0);
        gauge.configure(address(manager), vault, ASSET_UID, MARKET_ID);
    }

    function test_depositAndAllocateBindsCallerAndUsesOnlyVaultAllowance() public {
        _fundAndApprove(ALICE, 2 ether);
        vm.warp(1_000_000);

        vm.expectEmit(true, true, false, true, address(vault));
        emit StockDeposited(ASSET_UID, ALICE, 2 ether);
        vm.expectEmit(true, true, false, true, address(vault));
        emit AllocationLocked(ASSET_UID, ALICE, MARKET_ID, 1 ether, 1 ether, 1 ether);
        vm.prank(ALICE);
        manager.depositAndAllocate(MARKET_ID, 2 ether, 1 ether);

        PositionView memory position = gauge.positionOf(ALICE);
        assertEq(vault.deposited(ASSET_UID, ALICE), 2 ether);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 1 ether);
        assertEq(vault.freeBalanceOf(ASSET_UID, ALICE), 1 ether);
        assertEq(position.activeAmount, 0);
        assertEq(position.pendingAmount, 1 ether);
        assertEq(position.pendingGeneration, block.timestamp + 30 seconds);
        assertEq(position.unlockAt, block.timestamp + 24 hours);
        assertEq(stockToken.balanceOf(address(vault)), 2 ether);
        assertEq(stockToken.balanceOf(address(manager)), 0);
        assertEq(stockToken.allowance(ALICE, address(manager)), 0);
        assertEq(stockToken.allowance(address(vault), address(manager)), 0);
    }

    function test_depositAmountMayBeSmallerOrLargerThanAllocationAmount() public {
        _directDeposit(ALICE, 0.6 ether);
        _fundAndApprove(ALICE, 0.2 ether);
        vm.prank(ALICE);
        manager.depositAndAllocate(MARKET_ID, 0.2 ether, 0.7 ether);
        assertEq(vault.deposited(ASSET_UID, ALICE), 0.8 ether);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 0.7 ether);
        assertEq(vault.freeBalanceOf(ASSET_UID, ALICE), 0.1 ether);

        _fundAndApprove(BOB, 2 ether);
        vm.prank(BOB);
        manager.depositAndAllocate(MARKET_ID, 2 ether, 0.5 ether);
        assertEq(vault.deposited(ASSET_UID, BOB), 2 ether);
        assertEq(vault.allocation(ASSET_UID, BOB, MARKET_ID), 0.5 ether);
        assertEq(vault.freeBalanceOf(ASSET_UID, BOB), 1.5 ether);
    }

    function test_marketAndAssetGatesRunBeforeTheVaultPull() public {
        _fundAndApprove(ALICE, 2 ether);
        marketRegistry.configure(MARKET_ID, ASSET_UID, address(gauge), 1, 0);
        vm.expectRevert(abi.encodeWithSelector(AllocationManagerIncreases.StockAllocationClosed.selector, MARKET_ID));
        vm.prank(ALICE);
        manager.depositAndAllocate(MARKET_ID, 1 ether, 1 ether);

        marketRegistry.configure(MARKET_ID, ASSET_UID, address(gauge), 2, 0);
        officialRegistry.setStatus(ASSET_UID, 2);
        vm.expectRevert(abi.encodeWithSelector(AllocationManagerIncreases.StockAllocationClosed.selector, MARKET_ID));
        vm.prank(ALICE);
        manager.depositAndAllocate(MARKET_ID, 1 ether, 1 ether);

        assertEq(stockToken.balanceOf(ALICE), 2 ether);
        assertEq(stockToken.allowance(ALICE, address(vault)), 2 ether);
        assertEq(vault.totalDeposited(ASSET_UID), 0);
        assertEq(gauge.checkpointCalls(), 0);
    }

    function test_zeroDepositOrAllocationRejectsWithoutPartialState() public {
        _fundAndApprove(ALICE, 2 ether);
        vm.expectRevert(abi.encodeWithSelector(UserStockVaultDeposits.InvalidDepositAmount.selector, uint256(0)));
        vm.prank(ALICE);
        manager.depositAndAllocate(MARKET_ID, 0, 1 ether);

        vm.expectRevert(abi.encodeWithSelector(AllocationManagerIncreases.InvalidAllocationAmount.selector, uint256(0)));
        vm.prank(ALICE);
        manager.depositAndAllocate(MARKET_ID, 1 ether, 0);

        assertEq(stockToken.balanceOf(ALICE), 2 ether);
        assertEq(vault.totalDeposited(ASSET_UID), 0);
        assertEq(gauge.checkpointCalls(), 0);
    }

    function test_insufficientCombinedFreeBalanceRollsBackDepositAndSettlement() public {
        _fundAndApprove(ALICE, 0.2 ether);
        vm.expectRevert();
        vm.prank(ALICE);
        manager.depositAndAllocate(MARKET_ID, 0.2 ether, 1 ether);

        assertEq(stockToken.balanceOf(ALICE), 0.2 ether);
        assertEq(stockToken.balanceOf(address(vault)), 0);
        assertEq(stockToken.allowance(ALICE, address(vault)), 0.2 ether);
        assertEq(vault.deposited(ASSET_UID, ALICE), 0);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 0);
        assertEq(gauge.checkpointCalls(), 0);
        assertEq(gauge.settleCalls(), 0);
    }

    function test_minimumFailureRollsBackDepositAndExactRawUnitBoundarySucceeds() public {
        _fundAndApprove(ALICE, 1 ether);
        vm.expectRevert(
            abi.encodeWithSelector(
                AllocationManagerIncreases.PositionBelowMinimum.selector, uint256(0.5 ether - 1), uint256(0.5 ether)
            )
        );
        vm.prank(ALICE);
        manager.depositAndAllocate(MARKET_ID, 0.5 ether - 1, 0.5 ether - 1);

        assertEq(stockToken.balanceOf(ALICE), 1 ether);
        assertEq(stockToken.allowance(ALICE, address(vault)), 1 ether);
        assertEq(vault.totalDeposited(ASSET_UID), 0);
        assertEq(gauge.checkpointCalls(), 0);

        vm.prank(ALICE);
        manager.depositAndAllocate(MARKET_ID, 0.5 ether, 0.5 ether);
        assertEq(vault.deposited(ASSET_UID, ALICE), 0.5 ether);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 0.5 ether);
    }

    function test_preexistingLedgerMismatchRollsBackTheNewDeposit() public {
        _fundAndApprove(ALICE, 2 ether);
        gauge.setPosition(ALICE, 1 ether, 0);

        vm.expectRevert(AllocationManagerIncreases.AllocationLedgerMismatch.selector);
        vm.prank(ALICE);
        manager.depositAndAllocate(MARKET_ID, 1 ether, 1 ether);

        assertEq(stockToken.balanceOf(ALICE), 2 ether);
        assertEq(stockToken.balanceOf(address(vault)), 0);
        assertEq(stockToken.allowance(ALICE, address(vault)), 2 ether);
        assertEq(vault.totalDeposited(ASSET_UID), 0);
        assertEq(gauge.checkpointCalls(), 0);
        assertEq(gauge.settleCalls(), 0);
    }

    function test_timestampOverflowRejectsBeforeTheVaultPull() public {
        _fundAndApprove(ALICE, 2 ether);
        vm.warp(uint256(type(uint64).max) - 24 hours + 1);

        vm.expectRevert(
            abi.encodeWithSelector(AllocationManagerIncreases.AllocationTimestampOverflow.selector, block.timestamp)
        );
        vm.prank(ALICE);
        manager.depositAndAllocate(MARKET_ID, 1 ether, 1 ether);

        assertEq(stockToken.balanceOf(ALICE), 2 ether);
        assertEq(stockToken.allowance(ALICE, address(vault)), 2 ether);
        assertEq(vault.totalDeposited(ASSET_UID), 0);
        assertEq(gauge.checkpointCalls(), 0);
    }

    function test_everyGaugeFailureAndNoopRollsBackDepositTokenAndAllLedgers() public {
        _fundAndApprove(ALICE, 4 ether);
        for (uint8 mode = 1; mode <= 4; ++mode) {
            gauge.setFailureMode(mode);
            vm.expectRevert();
            vm.prank(ALICE);
            manager.depositAndAllocate(MARKET_ID, 1 ether, 1 ether);

            assertEq(stockToken.balanceOf(ALICE), 4 ether);
            assertEq(stockToken.balanceOf(address(vault)), 0);
            assertEq(stockToken.allowance(ALICE, address(vault)), 4 ether);
            assertEq(vault.deposited(ASSET_UID, ALICE), 0);
            assertEq(vault.allocated(ASSET_UID, ALICE), 0);
            assertEq(gauge.checkpointCalls(), 0);
            assertEq(gauge.settleCalls(), 0);
        }
    }

    function test_tokenCallbackCannotReenterManagerOrLeavePartialState() public {
        bytes32 callbackAssetUid = keccak256("callback-stock");
        bytes32 callbackMarketId = keccak256("callback-market");
        MockReentrantDepositToken callbackToken = new MockReentrantDepositToken();
        MockIncreaseGauge callbackGauge = new MockIncreaseGauge();
        UserStockVault callbackVault =
            new UserStockVault(address(officialRegistry), address(marketRegistry), address(manager));
        officialRegistry.configure(callbackAssetUid, address(callbackToken), address(callbackVault), 18, 1, 0.5 ether);
        marketRegistry.configure(callbackMarketId, callbackAssetUid, address(callbackGauge), 2, 0);
        callbackGauge.configure(address(manager), callbackVault, callbackAssetUid, callbackMarketId);
        callbackToken.configureAttack(IAllocationManager(address(manager)), callbackMarketId, true);
        callbackToken.mint(ALICE, 1 ether);
        vm.prank(ALICE);
        callbackToken.approve(address(callbackVault), 1 ether);

        vm.expectRevert(
            abi.encodeWithSelector(UserStockVaultDeposits.StockTransferCallFailed.selector, address(callbackToken))
        );
        vm.prank(ALICE);
        manager.depositAndAllocate(callbackMarketId, 1 ether, 1 ether);

        assertEq(callbackToken.balanceOf(ALICE), 1 ether);
        assertEq(callbackToken.balanceOf(address(callbackVault)), 0);
        assertEq(callbackVault.totalDeposited(callbackAssetUid), 0);
        assertEq(callbackGauge.checkpointCalls(), 0);
    }

    function test_noForOrRecipientSurfaceAndBobCannotConsumeAliceAllowance() public {
        (bool forCall,) = address(manager)
            .call(
                abi.encodeWithSignature(
                    "depositAndAllocateFor(address,bytes32,uint256,uint256)", ALICE, MARKET_ID, 1 ether, 1 ether
                )
            );
        assertFalse(forCall);
        (bool recipientCall,) = address(manager)
            .call(
                abi.encodeWithSignature(
                    "depositAndAllocate(bytes32,uint256,uint256,address)", MARKET_ID, 1 ether, 1 ether, BOB
                )
            );
        assertFalse(recipientCall);

        _fundAndApprove(ALICE, 1 ether);
        vm.expectRevert();
        vm.prank(BOB);
        manager.depositAndAllocate(MARKET_ID, 1 ether, 1 ether);
        assertEq(vault.deposited(ASSET_UID, ALICE), 0);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 0);
        assertEq(stockToken.balanceOf(ALICE), 1 ether);
    }

    function testFuzz_successCommitsExactDepositAndAllocation(uint96 depositSeed, uint96 allocationSeed) public {
        uint256 allocationAmount = bound(uint256(allocationSeed), 0.5 ether + 1, 1_000_000 ether);
        uint256 depositAmount = bound(uint256(depositSeed), allocationAmount, 1_000_000 ether);
        _fundAndApprove(ALICE, depositAmount);

        vm.prank(ALICE);
        manager.depositAndAllocate(MARKET_ID, depositAmount, allocationAmount);

        assertEq(vault.deposited(ASSET_UID, ALICE), depositAmount);
        assertEq(vault.allocated(ASSET_UID, ALICE), allocationAmount);
        assertEq(vault.freeBalanceOf(ASSET_UID, ALICE), depositAmount - allocationAmount);
        assertEq(gauge.positionOf(ALICE).pendingAmount, allocationAmount);
        assertEq(stockToken.balanceOf(address(manager)), 0);
    }

    function _fundAndApprove(address user, uint256 amount) private {
        stockToken.mint(user, amount);
        vm.prank(user);
        stockToken.approve(address(vault), amount);
    }

    function _directDeposit(address user, uint256 amount) private {
        _fundAndApprove(user, amount);
        vm.prank(user);
        vault.depositStock(ASSET_UID, amount);
    }
}
