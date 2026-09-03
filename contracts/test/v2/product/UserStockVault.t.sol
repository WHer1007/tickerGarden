// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import {Test} from "forge-std/Test.sol";

import {IOfficialStockRegistryV2, MarketView} from "../../../src/v2/interfaces/IV2Protocol.sol";
import {OfficialStockRegistryV2} from "../../../src/v2/modules/OfficialStockRegistryV2.sol";
import {UserStockVault} from "../../../src/v2/modules/UserStockVault.sol";
import {UserStockVaultExits} from "../../../src/v2/shared/UserStockVaultExits.sol";
import {UserStockVaultIdentity} from "../../../src/v2/shared/UserStockVaultIdentity.sol";
import {MockExactQuoteToken} from "../mocks/MockV2QuoteAssets.sol";

contract MockProductVaultMarketRegistry {
    mapping(bytes32 marketId => MarketView marketView) private _markets;
    mapping(bytes32 marketId => bool registered) private _registered;

    error MarketNotRegistered(bytes32 marketId);

    function configure(bytes32 marketId, bytes32 assetUid, uint8 status, uint32 recoveryEpoch) external {
        _registered[marketId] = true;
        _markets[marketId].config.assetUid = assetUid;
        _markets[marketId].runtime.marketStatus = status;
        _markets[marketId].runtime.recoveryEpoch = recoveryEpoch;
    }

    function setStatus(bytes32 marketId, uint8 status, uint32 recoveryEpoch) external {
        if (!_registered[marketId]) revert MarketNotRegistered(marketId);
        _markets[marketId].runtime.marketStatus = status;
        _markets[marketId].runtime.recoveryEpoch = recoveryEpoch;
    }

    function market(bytes32 marketId) external view returns (MarketView memory) {
        if (!_registered[marketId]) revert MarketNotRegistered(marketId);
        return _markets[marketId];
    }
}

contract MockProductVaultAllocationManager {
    function lock(UserStockVault vault, bytes32 assetUid, address user, bytes32 marketId, uint256 amount) external {
        vault.lockAllocation(assetUid, user, marketId, amount);
    }

    function release(UserStockVault vault, bytes32 assetUid, address user, bytes32 marketId, uint256 amount) external {
        vault.releaseAllocation(assetUid, user, marketId, amount);
    }
}

interface IProductVaultWithdrawalCallback {
    function onProductVaultStockTransfer() external;
}

contract MockMutableWithdrawalStockToken is MockExactQuoteToken {
    enum TransferMode {
        EXACT,
        FALSE,
        NO_DATA,
        MALFORMED_TRUE,
        REVERTING,
        FEE_ON_TRANSFER,
        POSITIVE_DRIFT,
        CALLBACK
    }

    TransferMode public transferMode;

    constructor() MockExactQuoteToken(18) {}

    function setTransferMode(TransferMode mode) external {
        transferMode = mode;
    }

    function transfer(address recipient, uint256 amount) external override returns (bool) {
        TransferMode mode = transferMode;
        if (mode == TransferMode.REVERTING) revert("transfer failed");
        if (mode == TransferMode.FALSE) return false;
        if (mode == TransferMode.NO_DATA) {
            assembly ("memory-safe") {
                return(0, 0)
            }
        }
        if (mode == TransferMode.MALFORMED_TRUE) {
            assembly ("memory-safe") {
                mstore(0, 2)
                return(0, 32)
            }
        }

        if (mode == TransferMode.FEE_ON_TRANSFER) {
            balanceOf[msg.sender] -= amount;
            balanceOf[recipient] += amount - 1;
            return true;
        }

        _transfer(msg.sender, recipient, amount);
        if (mode == TransferMode.POSITIVE_DRIFT) balanceOf[recipient] += 1;
        if (mode == TransferMode.CALLBACK) {
            IProductVaultWithdrawalCallback(recipient).onProductVaultStockTransfer();
        }
        return true;
    }
}

contract ProductVaultWithdrawalActor is IProductVaultWithdrawalCallback {
    UserStockVault private immutable _vault;
    MockMutableWithdrawalStockToken private immutable _token;
    bytes32 private immutable _assetUid;

    constructor(UserStockVault vault, MockMutableWithdrawalStockToken token, bytes32 assetUid) {
        _vault = vault;
        _token = token;
        _assetUid = assetUid;
    }

    function deposit(uint256 amount) external {
        _token.approve(address(_vault), amount);
        _vault.depositStock(_assetUid, amount);
    }

    function withdraw(uint256 amount) external {
        _vault.withdrawFreeStock(_assetUid, amount);
    }

    function onProductVaultStockTransfer() external {
        require(msg.sender == address(_token));
        _vault.withdrawFreeStock(_assetUid, 1);
    }
}

contract UserStockVaultTest is Test {
    bytes32 internal constant ASSET_UID = keccak256("official-stock");
    bytes32 internal constant OTHER_ASSET_UID = keccak256("other-stock");
    bytes32 internal constant MARKET_ID = keccak256("market");
    bytes32 internal constant OTHER_MARKET_ID = keccak256("other-market");
    bytes32 internal constant FOREIGN_MARKET_ID = keccak256("foreign-market");
    bytes32 internal constant UNKNOWN_MARKET_ID = keccak256("unknown-market");
    uint64 internal constant PROTOCOL_ADMIN_ROLE = 1;
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);

    AccessManager internal accessManager;
    OfficialStockRegistryV2 internal registry;
    MockProductVaultMarketRegistry internal marketRegistry;
    MockProductVaultAllocationManager internal manager;
    MockMutableWithdrawalStockToken internal stockToken;
    MockExactQuoteToken internal otherStockToken;
    UserStockVault internal vault;

    event StockWithdrawn(bytes32 indexed assetUid, address indexed user, uint256 amount);
    event AllocationForceReleased(
        bytes32 indexed assetUid, address indexed user, bytes32 indexed marketId, uint256 amount, uint32 recoveryEpoch
    );

    function setUp() public {
        accessManager = new AccessManager(address(this));
        registry = new OfficialStockRegistryV2(address(accessManager));
        marketRegistry = new MockProductVaultMarketRegistry();
        manager = new MockProductVaultAllocationManager();
        stockToken = new MockMutableWithdrawalStockToken();
        otherStockToken = new MockExactQuoteToken(18);
        vault = new UserStockVault(address(registry), address(marketRegistry), address(manager));

        bytes4[] memory registerSelector = new bytes4[](1);
        registerSelector[0] = IOfficialStockRegistryV2.registerAsset.selector;
        accessManager.setTargetFunctionRole(address(registry), registerSelector, PROTOCOL_ADMIN_ROLE);
        accessManager.grantRole(PROTOCOL_ADMIN_ROLE, address(this), 0);
        registry.registerAsset(ASSET_UID, address(stockToken), 18, address(vault));
        registry.registerAsset(OTHER_ASSET_UID, address(otherStockToken), 18, address(vault));

        marketRegistry.configure(MARKET_ID, ASSET_UID, 0, 0);
        marketRegistry.configure(OTHER_MARKET_ID, OTHER_ASSET_UID, 0, 0);
        marketRegistry.configure(FOREIGN_MARKET_ID, OTHER_ASSET_UID, 3, 4);
    }

    function test_withdrawTransfersExactFreePrincipalOnlyToCallerAndEmitsEvent() public {
        _deposit(ALICE, 1_000);

        vm.expectEmit(true, true, false, true, address(vault));
        emit StockWithdrawn(ASSET_UID, ALICE, 350);
        vm.prank(ALICE);
        vault.withdrawFreeStock(ASSET_UID, 350);

        assertEq(stockToken.balanceOf(ALICE), 350);
        assertEq(stockToken.balanceOf(address(vault)), 650);
        assertEq(vault.deposited(ASSET_UID, ALICE), 650);
        assertEq(vault.freeBalanceOf(ASSET_UID, ALICE), 650);
        assertEq(vault.totalDeposited(ASSET_UID), 650);
    }

    function test_sharedVaultIsolatesSecondAssetCustodyAndAllocationLedgers() public {
        _depositAsset(ALICE, ASSET_UID, stockToken, 600);
        _depositAsset(ALICE, OTHER_ASSET_UID, otherStockToken, 700);
        manager.lock(vault, ASSET_UID, ALICE, MARKET_ID, 400);
        manager.lock(vault, OTHER_ASSET_UID, ALICE, OTHER_MARKET_ID, 300);

        assertEq(stockToken.balanceOf(address(vault)), 600);
        assertEq(otherStockToken.balanceOf(address(vault)), 700);
        assertEq(vault.deposited(ASSET_UID, ALICE), 600);
        assertEq(vault.deposited(OTHER_ASSET_UID, ALICE), 700);
        assertEq(vault.allocated(ASSET_UID, ALICE), 400);
        assertEq(vault.allocated(OTHER_ASSET_UID, ALICE), 300);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 400);
        assertEq(vault.allocation(OTHER_ASSET_UID, ALICE, OTHER_MARKET_ID), 300);
        assertEq(vault.freeBalanceOf(ASSET_UID, ALICE), 200);
        assertEq(vault.freeBalanceOf(OTHER_ASSET_UID, ALICE), 400);
        assertEq(vault.totalDeposited(ASSET_UID), 600);
        assertEq(vault.totalDeposited(OTHER_ASSET_UID), 700);
        assertEq(vault.totalAllocated(ASSET_UID), 400);
        assertEq(vault.totalAllocated(OTHER_ASSET_UID), 300);

        vm.prank(ALICE);
        vault.withdrawFreeStock(OTHER_ASSET_UID, 200);
        assertEq(otherStockToken.balanceOf(ALICE), 200);
        assertEq(stockToken.balanceOf(ALICE), 0);
        assertEq(vault.deposited(ASSET_UID, ALICE), 600);
        assertEq(vault.deposited(OTHER_ASSET_UID, ALICE), 500);
        assertEq(vault.allocated(ASSET_UID, ALICE), 400);
        assertEq(vault.allocated(OTHER_ASSET_UID, ALICE), 300);
    }

    function test_allocatedPrincipalCannotBeWithdrawnUntilManagerReleasesIt() public {
        _deposit(ALICE, 1_000);
        manager.lock(vault, ASSET_UID, ALICE, MARKET_ID, 700);

        vm.expectRevert(
            abi.encodeWithSelector(UserStockVaultExits.InsufficientFreeBalance.selector, uint256(301), uint256(300))
        );
        vm.prank(ALICE);
        vault.withdrawFreeStock(ASSET_UID, 301);

        manager.release(vault, ASSET_UID, ALICE, MARKET_ID, 250);
        vm.prank(ALICE);
        vault.withdrawFreeStock(ASSET_UID, 550);
        assertEq(vault.deposited(ASSET_UID, ALICE), 450);
        assertEq(vault.allocated(ASSET_UID, ALICE), 450);
        assertEq(vault.freeBalanceOf(ASSET_UID, ALICE), 0);
    }

    function test_withdrawRemainsAvailableWhenAssetIsPausedOrRetired() public {
        _deposit(ALICE, 1_000);
        _configureAssetStatusRoles();
        registry.pauseAsset(ASSET_UID, keccak256("pause"));

        vm.prank(ALICE);
        vault.withdrawFreeStock(ASSET_UID, 400);
        registry.retireAsset(ASSET_UID, keccak256("retire"));
        vm.prank(ALICE);
        vault.withdrawFreeStock(ASSET_UID, 600);

        assertEq(vault.deposited(ASSET_UID, ALICE), 0);
        assertEq(vault.totalDeposited(ASSET_UID), 0);
        assertEq(stockToken.balanceOf(ALICE), 1_000);
    }

    function test_zeroAndOverFreeWithdrawalsRollbackAllAccounting() public {
        _deposit(ALICE, 100);
        vm.expectRevert(abi.encodeWithSelector(UserStockVaultExits.InvalidWithdrawalAmount.selector, uint256(0)));
        vm.prank(ALICE);
        vault.withdrawFreeStock(ASSET_UID, 0);
        vm.expectRevert(
            abi.encodeWithSelector(UserStockVaultExits.InsufficientFreeBalance.selector, uint256(101), uint256(100))
        );
        vm.prank(ALICE);
        vault.withdrawFreeStock(ASSET_UID, 101);

        assertEq(vault.deposited(ASSET_UID, ALICE), 100);
        assertEq(vault.totalDeposited(ASSET_UID), 100);
        assertEq(stockToken.balanceOf(address(vault)), 100);
    }

    function test_anomalousWithdrawalReturnsAndBalanceDeltasRollbackEffects() public {
        _deposit(ALICE, 1_000);
        _expectFailedWithdrawal(MockMutableWithdrawalStockToken.TransferMode.FALSE);
        _expectFailedWithdrawal(MockMutableWithdrawalStockToken.TransferMode.NO_DATA);
        _expectFailedWithdrawal(MockMutableWithdrawalStockToken.TransferMode.MALFORMED_TRUE);
        _expectFailedWithdrawal(MockMutableWithdrawalStockToken.TransferMode.REVERTING);
        _expectFailedWithdrawal(MockMutableWithdrawalStockToken.TransferMode.FEE_ON_TRANSFER);
        _expectFailedWithdrawal(MockMutableWithdrawalStockToken.TransferMode.POSITIVE_DRIFT);

        assertEq(vault.deposited(ASSET_UID, ALICE), 1_000);
        assertEq(vault.totalDeposited(ASSET_UID), 1_000);
        assertEq(stockToken.balanceOf(ALICE), 0);
        assertEq(stockToken.balanceOf(address(vault)), 1_000);
    }

    function test_withdrawalCallbackCannotReenterOrLeavePartialDebit() public {
        ProductVaultWithdrawalActor actor = new ProductVaultWithdrawalActor(vault, stockToken, ASSET_UID);
        stockToken.mint(address(actor), 100);
        actor.deposit(100);
        stockToken.setTransferMode(MockMutableWithdrawalStockToken.TransferMode.CALLBACK);

        vm.expectRevert(
            abi.encodeWithSelector(UserStockVaultExits.StockWithdrawalCallFailed.selector, address(stockToken))
        );
        actor.withdraw(100);

        assertEq(vault.deposited(ASSET_UID, address(actor)), 100);
        assertEq(stockToken.balanceOf(address(actor)), 0);
        assertEq(stockToken.balanceOf(address(vault)), 100);
    }

    function test_forceReleaseRequiresTerminalEmergencyStatus() public {
        _deposit(ALICE, 500);
        manager.lock(vault, ASSET_UID, ALICE, MARKET_ID, 400);

        for (uint8 status; status < 3; ++status) {
            marketRegistry.setStatus(MARKET_ID, status, 0);
            vm.expectRevert(
                abi.encodeWithSelector(UserStockVaultExits.MarketNotInEmergencyExit.selector, MARKET_ID, status)
            );
            vm.prank(ALICE);
            vault.forceReleaseAllocation(ASSET_UID, MARKET_ID);
        }

        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 400);
        assertEq(vault.freeBalanceOf(ASSET_UID, ALICE), 100);
    }

    function test_forceReleaseClearsOnlyCallerAllocationWithoutGaugeOrTokenTransfer() public {
        _deposit(ALICE, 600);
        _deposit(BOB, 700);
        manager.lock(vault, ASSET_UID, ALICE, MARKET_ID, 500);
        manager.lock(vault, ASSET_UID, BOB, MARKET_ID, 300);
        marketRegistry.setStatus(MARKET_ID, 3, 7);
        uint256 vaultTokenBalance = stockToken.balanceOf(address(vault));

        vm.expectEmit(true, true, false, true, address(vault));
        emit AllocationForceReleased(ASSET_UID, ALICE, MARKET_ID, 500, 7);
        vm.prank(ALICE);
        uint256 released = vault.forceReleaseAllocation(ASSET_UID, MARKET_ID);

        assertEq(released, 500);
        assertEq(vault.deposited(ASSET_UID, ALICE), 600);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 0);
        assertEq(vault.allocated(ASSET_UID, ALICE), 0);
        assertEq(vault.freeBalanceOf(ASSET_UID, ALICE), 600);
        assertEq(vault.allocation(ASSET_UID, BOB, MARKET_ID), 300);
        assertEq(vault.allocated(ASSET_UID, BOB), 300);
        assertEq(vault.marketAllocated(ASSET_UID, MARKET_ID), 300);
        assertEq(vault.totalAllocated(ASSET_UID), 300);
        assertEq(stockToken.balanceOf(address(vault)), vaultTokenBalance);
        assertEq(stockToken.balanceOf(ALICE), 0);
    }

    function test_forceReleaseRejectsRepeatUnknownAndCrossAssetMarkets() public {
        _deposit(ALICE, 100);
        manager.lock(vault, ASSET_UID, ALICE, MARKET_ID, 100);
        marketRegistry.setStatus(MARKET_ID, 3, 2);
        vm.prank(ALICE);
        vault.forceReleaseAllocation(ASSET_UID, MARKET_ID);

        vm.expectRevert(
            abi.encodeWithSelector(UserStockVaultExits.NoAllocationToForceRelease.selector, ALICE, MARKET_ID)
        );
        vm.prank(ALICE);
        vault.forceReleaseAllocation(ASSET_UID, MARKET_ID);
        vm.expectRevert(
            abi.encodeWithSelector(MockProductVaultMarketRegistry.MarketNotRegistered.selector, UNKNOWN_MARKET_ID)
        );
        vm.prank(ALICE);
        vault.forceReleaseAllocation(ASSET_UID, UNKNOWN_MARKET_ID);
        vm.expectRevert(
            abi.encodeWithSelector(
                UserStockVaultIdentity.MarketAssetMismatch.selector, FOREIGN_MARKET_ID, ASSET_UID, OTHER_ASSET_UID
            )
        );
        vm.prank(ALICE);
        vault.forceReleaseAllocation(ASSET_UID, FOREIGN_MARKET_ID);
    }

    function test_canonicalSelectorsMatchInterfaceAndNoRecipientOverloadsExist() public {
        assertEq(UserStockVault.depositStock.selector, bytes4(keccak256("depositStock(bytes32,uint256)")));
        assertEq(UserStockVault.depositStockFor.selector, bytes4(keccak256("depositStockFor(bytes32,address,uint256)")));
        assertEq(UserStockVault.withdrawFreeStock.selector, bytes4(keccak256("withdrawFreeStock(bytes32,uint256)")));
        assertEq(
            UserStockVault.forceReleaseAllocation.selector, bytes4(keccak256("forceReleaseAllocation(bytes32,bytes32)"))
        );
        assertEq(
            UserStockVault.lockAllocation.selector, bytes4(keccak256("lockAllocation(bytes32,address,bytes32,uint256)"))
        );
        assertEq(
            UserStockVault.releaseAllocation.selector,
            bytes4(keccak256("releaseAllocation(bytes32,address,bytes32,uint256)"))
        );
        assertEq(
            UserStockVault.moveAllocation.selector,
            bytes4(keccak256("moveAllocation(bytes32,address,bytes32,bytes32,uint256)"))
        );

        (bool withdrawFor,) = address(vault)
            .call(abi.encodeWithSignature("withdrawFreeStock(bytes32,address,uint256)", ASSET_UID, BOB, 1));
        assertFalse(withdrawFor);
        (bool forceFor,) = address(vault)
            .call(abi.encodeWithSignature("forceReleaseAllocation(bytes32,address,bytes32)", ASSET_UID, BOB, MARKET_ID));
        assertFalse(forceFor);
    }

    function testFuzz_freeWithdrawThenEmergencyReleaseReturnsOnlyCallerPrincipal(uint96 rawDeposit, uint96 rawLocked)
        public
    {
        uint256 depositAmount = bound(rawDeposit, 1, 1e24);
        uint256 lockedAmount = bound(rawLocked, 1, depositAmount);
        _deposit(ALICE, depositAmount);
        manager.lock(vault, ASSET_UID, ALICE, MARKET_ID, lockedAmount);

        uint256 initiallyFree = depositAmount - lockedAmount;
        if (initiallyFree != 0) {
            vm.prank(ALICE);
            vault.withdrawFreeStock(ASSET_UID, initiallyFree);
        }
        marketRegistry.setStatus(MARKET_ID, 3, 11);
        vm.prank(ALICE);
        assertEq(vault.forceReleaseAllocation(ASSET_UID, MARKET_ID), lockedAmount);
        vm.prank(ALICE);
        vault.withdrawFreeStock(ASSET_UID, lockedAmount);

        assertEq(vault.deposited(ASSET_UID, ALICE), 0);
        assertEq(vault.allocated(ASSET_UID, ALICE), 0);
        assertEq(vault.marketAllocated(ASSET_UID, MARKET_ID), 0);
        assertEq(vault.totalDeposited(ASSET_UID), 0);
        assertEq(vault.totalAllocated(ASSET_UID), 0);
        assertEq(stockToken.balanceOf(address(vault)), 0);
        assertEq(stockToken.balanceOf(ALICE), depositAmount);
    }

    function _deposit(address user, uint256 amount) private {
        _depositAsset(user, ASSET_UID, stockToken, amount);
    }

    function _depositAsset(address user, bytes32 assetUid, MockExactQuoteToken token, uint256 amount) private {
        token.mint(user, amount);
        vm.startPrank(user);
        token.approve(address(vault), amount);
        vault.depositStock(assetUid, amount);
        vm.stopPrank();
    }

    function _expectFailedWithdrawal(MockMutableWithdrawalStockToken.TransferMode mode) private {
        stockToken.setTransferMode(mode);
        vm.expectRevert();
        vm.prank(ALICE);
        vault.withdrawFreeStock(ASSET_UID, 100);
    }

    function _configureAssetStatusRoles() private {
        bytes4[] memory selectors = new bytes4[](2);
        selectors[0] = IOfficialStockRegistryV2.pauseAsset.selector;
        selectors[1] = IOfficialStockRegistryV2.retireAsset.selector;
        accessManager.setTargetFunctionRole(address(registry), selectors, PROTOCOL_ADMIN_ROLE);
    }
}
