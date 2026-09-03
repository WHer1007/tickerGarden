// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import {Test} from "forge-std/Test.sol";

import {IOfficialStockRegistryV2, IUserStockVault, MarketView} from "../../../src/v2/interfaces/IV2Protocol.sol";
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
    function lock(IUserStockVault vault, address user, bytes32 marketId, uint256 amount) external {
        vault.lockAllocation(user, marketId, amount);
    }

    function release(IUserStockVault vault, address user, bytes32 marketId, uint256 amount) external {
        vault.releaseAllocation(user, marketId, amount);
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
    IUserStockVault private immutable _vault;
    MockMutableWithdrawalStockToken private immutable _token;

    constructor(IUserStockVault vault, MockMutableWithdrawalStockToken token) {
        _vault = vault;
        _token = token;
    }

    function deposit(uint256 amount) external {
        _token.approve(address(_vault), amount);
        _vault.depositStock(amount);
    }

    function withdraw(uint256 amount) external {
        _vault.withdrawFreeStock(amount);
    }

    function onProductVaultStockTransfer() external {
        require(msg.sender == address(_token));
        _vault.withdrawFreeStock(1);
    }
}

contract UserStockVaultTest is Test {
    bytes32 internal constant ASSET_UID = keccak256("official-stock");
    bytes32 internal constant OTHER_ASSET_UID = keccak256("other-stock");
    bytes32 internal constant MARKET_ID = keccak256("market");
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
    UserStockVault internal vault;

    event StockWithdrawn(bytes32 indexed assetUid, address indexed user, uint256 amount);
    event AllocationForceReleased(address indexed user, bytes32 indexed marketId, uint256 amount, uint32 recoveryEpoch);

    function setUp() public {
        accessManager = new AccessManager(address(this));
        registry = new OfficialStockRegistryV2(address(accessManager));
        marketRegistry = new MockProductVaultMarketRegistry();
        manager = new MockProductVaultAllocationManager();
        stockToken = new MockMutableWithdrawalStockToken();
        vault = new UserStockVault(
            address(registry), address(marketRegistry), address(manager), ASSET_UID, address(stockToken)
        );

        bytes4[] memory registerSelector = new bytes4[](1);
        registerSelector[0] = IOfficialStockRegistryV2.registerAsset.selector;
        accessManager.setTargetFunctionRole(address(registry), registerSelector, PROTOCOL_ADMIN_ROLE);
        accessManager.grantRole(PROTOCOL_ADMIN_ROLE, address(this), 0);
        registry.registerAsset(ASSET_UID, address(stockToken), 18, address(vault));

        marketRegistry.configure(MARKET_ID, ASSET_UID, 0, 0);
        marketRegistry.configure(FOREIGN_MARKET_ID, OTHER_ASSET_UID, 3, 4);
    }

    function test_withdrawTransfersExactFreePrincipalOnlyToCallerAndEmitsEvent() public {
        _deposit(ALICE, 1_000);

        vm.expectEmit(true, true, false, true, address(vault));
        emit StockWithdrawn(ASSET_UID, ALICE, 350);
        vm.prank(ALICE);
        vault.withdrawFreeStock(350);

        assertEq(stockToken.balanceOf(ALICE), 350);
        assertEq(stockToken.balanceOf(address(vault)), 650);
        assertEq(vault.deposited(ALICE), 650);
        assertEq(vault.freeBalanceOf(ALICE), 650);
        assertEq(vault.totalDeposited(), 650);
    }

    function test_allocatedPrincipalCannotBeWithdrawnUntilManagerReleasesIt() public {
        _deposit(ALICE, 1_000);
        manager.lock(vault, ALICE, MARKET_ID, 700);

        vm.expectRevert(
            abi.encodeWithSelector(UserStockVaultExits.InsufficientFreeBalance.selector, uint256(301), uint256(300))
        );
        vm.prank(ALICE);
        vault.withdrawFreeStock(301);

        manager.release(vault, ALICE, MARKET_ID, 250);
        vm.prank(ALICE);
        vault.withdrawFreeStock(550);
        assertEq(vault.deposited(ALICE), 450);
        assertEq(vault.allocated(ALICE), 450);
        assertEq(vault.freeBalanceOf(ALICE), 0);
    }

    function test_withdrawRemainsAvailableWhenAssetIsPausedOrRetired() public {
        _deposit(ALICE, 1_000);
        _configureAssetStatusRoles();
        registry.pauseAsset(ASSET_UID, keccak256("pause"));

        vm.prank(ALICE);
        vault.withdrawFreeStock(400);
        registry.retireAsset(ASSET_UID, keccak256("retire"));
        vm.prank(ALICE);
        vault.withdrawFreeStock(600);

        assertEq(vault.deposited(ALICE), 0);
        assertEq(vault.totalDeposited(), 0);
        assertEq(stockToken.balanceOf(ALICE), 1_000);
    }

    function test_zeroAndOverFreeWithdrawalsRollbackAllAccounting() public {
        _deposit(ALICE, 100);
        vm.expectRevert(abi.encodeWithSelector(UserStockVaultExits.InvalidWithdrawalAmount.selector, uint256(0)));
        vm.prank(ALICE);
        vault.withdrawFreeStock(0);
        vm.expectRevert(
            abi.encodeWithSelector(UserStockVaultExits.InsufficientFreeBalance.selector, uint256(101), uint256(100))
        );
        vm.prank(ALICE);
        vault.withdrawFreeStock(101);

        assertEq(vault.deposited(ALICE), 100);
        assertEq(vault.totalDeposited(), 100);
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

        assertEq(vault.deposited(ALICE), 1_000);
        assertEq(vault.totalDeposited(), 1_000);
        assertEq(stockToken.balanceOf(ALICE), 0);
        assertEq(stockToken.balanceOf(address(vault)), 1_000);
    }

    function test_withdrawalCallbackCannotReenterOrLeavePartialDebit() public {
        ProductVaultWithdrawalActor actor = new ProductVaultWithdrawalActor(vault, stockToken);
        stockToken.mint(address(actor), 100);
        actor.deposit(100);
        stockToken.setTransferMode(MockMutableWithdrawalStockToken.TransferMode.CALLBACK);

        vm.expectRevert(
            abi.encodeWithSelector(UserStockVaultExits.StockWithdrawalCallFailed.selector, address(stockToken))
        );
        actor.withdraw(100);

        assertEq(vault.deposited(address(actor)), 100);
        assertEq(stockToken.balanceOf(address(actor)), 0);
        assertEq(stockToken.balanceOf(address(vault)), 100);
    }

    function test_forceReleaseRequiresTerminalEmergencyStatus() public {
        _deposit(ALICE, 500);
        manager.lock(vault, ALICE, MARKET_ID, 400);

        for (uint8 status; status < 3; ++status) {
            marketRegistry.setStatus(MARKET_ID, status, 0);
            vm.expectRevert(
                abi.encodeWithSelector(UserStockVaultExits.MarketNotInEmergencyExit.selector, MARKET_ID, status)
            );
            vm.prank(ALICE);
            vault.forceReleaseAllocation(MARKET_ID);
        }

        assertEq(vault.allocation(ALICE, MARKET_ID), 400);
        assertEq(vault.freeBalanceOf(ALICE), 100);
    }

    function test_forceReleaseClearsOnlyCallerAllocationWithoutGaugeOrTokenTransfer() public {
        _deposit(ALICE, 600);
        _deposit(BOB, 700);
        manager.lock(vault, ALICE, MARKET_ID, 500);
        manager.lock(vault, BOB, MARKET_ID, 300);
        marketRegistry.setStatus(MARKET_ID, 3, 7);
        uint256 vaultTokenBalance = stockToken.balanceOf(address(vault));

        vm.expectEmit(true, true, false, true, address(vault));
        emit AllocationForceReleased(ALICE, MARKET_ID, 500, 7);
        vm.prank(ALICE);
        uint256 released = vault.forceReleaseAllocation(MARKET_ID);

        assertEq(released, 500);
        assertEq(vault.deposited(ALICE), 600);
        assertEq(vault.allocation(ALICE, MARKET_ID), 0);
        assertEq(vault.allocated(ALICE), 0);
        assertEq(vault.freeBalanceOf(ALICE), 600);
        assertEq(vault.allocation(BOB, MARKET_ID), 300);
        assertEq(vault.allocated(BOB), 300);
        assertEq(vault.marketAllocated(MARKET_ID), 300);
        assertEq(vault.totalAllocated(), 300);
        assertEq(stockToken.balanceOf(address(vault)), vaultTokenBalance);
        assertEq(stockToken.balanceOf(ALICE), 0);
    }

    function test_forceReleaseRejectsRepeatUnknownAndCrossAssetMarkets() public {
        _deposit(ALICE, 100);
        manager.lock(vault, ALICE, MARKET_ID, 100);
        marketRegistry.setStatus(MARKET_ID, 3, 2);
        vm.prank(ALICE);
        vault.forceReleaseAllocation(MARKET_ID);

        vm.expectRevert(
            abi.encodeWithSelector(UserStockVaultExits.NoAllocationToForceRelease.selector, ALICE, MARKET_ID)
        );
        vm.prank(ALICE);
        vault.forceReleaseAllocation(MARKET_ID);
        vm.expectRevert(
            abi.encodeWithSelector(MockProductVaultMarketRegistry.MarketNotRegistered.selector, UNKNOWN_MARKET_ID)
        );
        vm.prank(ALICE);
        vault.forceReleaseAllocation(UNKNOWN_MARKET_ID);
        vm.expectRevert(
            abi.encodeWithSelector(
                UserStockVaultIdentity.MarketAssetMismatch.selector, FOREIGN_MARKET_ID, ASSET_UID, OTHER_ASSET_UID
            )
        );
        vm.prank(ALICE);
        vault.forceReleaseAllocation(FOREIGN_MARKET_ID);
    }

    function test_canonicalSelectorsMatchInterfaceAndNoRecipientOverloadsExist() public {
        assertEq(UserStockVault.depositStock.selector, IUserStockVault.depositStock.selector);
        assertEq(UserStockVault.depositStockFor.selector, IUserStockVault.depositStockFor.selector);
        assertEq(UserStockVault.withdrawFreeStock.selector, IUserStockVault.withdrawFreeStock.selector);
        assertEq(UserStockVault.forceReleaseAllocation.selector, IUserStockVault.forceReleaseAllocation.selector);
        assertEq(UserStockVault.lockAllocation.selector, IUserStockVault.lockAllocation.selector);
        assertEq(UserStockVault.releaseAllocation.selector, IUserStockVault.releaseAllocation.selector);
        assertEq(UserStockVault.moveAllocation.selector, IUserStockVault.moveAllocation.selector);

        (bool withdrawFor,) = address(vault).call(abi.encodeWithSignature("withdrawFreeStock(address,uint256)", BOB, 1));
        assertFalse(withdrawFor);
        (bool forceFor,) =
            address(vault).call(abi.encodeWithSignature("forceReleaseAllocation(address,bytes32)", BOB, MARKET_ID));
        assertFalse(forceFor);
    }

    function testFuzz_freeWithdrawThenEmergencyReleaseReturnsOnlyCallerPrincipal(uint96 rawDeposit, uint96 rawLocked)
        public
    {
        uint256 depositAmount = bound(rawDeposit, 1, 1e24);
        uint256 lockedAmount = bound(rawLocked, 1, depositAmount);
        _deposit(ALICE, depositAmount);
        manager.lock(vault, ALICE, MARKET_ID, lockedAmount);

        uint256 initiallyFree = depositAmount - lockedAmount;
        if (initiallyFree != 0) {
            vm.prank(ALICE);
            vault.withdrawFreeStock(initiallyFree);
        }
        marketRegistry.setStatus(MARKET_ID, 3, 11);
        vm.prank(ALICE);
        assertEq(vault.forceReleaseAllocation(MARKET_ID), lockedAmount);
        vm.prank(ALICE);
        vault.withdrawFreeStock(lockedAmount);

        assertEq(vault.deposited(ALICE), 0);
        assertEq(vault.allocated(ALICE), 0);
        assertEq(vault.marketAllocated(MARKET_ID), 0);
        assertEq(vault.totalDeposited(), 0);
        assertEq(vault.totalAllocated(), 0);
        assertEq(stockToken.balanceOf(address(vault)), 0);
        assertEq(stockToken.balanceOf(ALICE), depositAmount);
    }

    function _deposit(address user, uint256 amount) private {
        stockToken.mint(user, amount);
        vm.startPrank(user);
        stockToken.approve(address(vault), amount);
        vault.depositStock(amount);
        vm.stopPrank();
    }

    function _expectFailedWithdrawal(MockMutableWithdrawalStockToken.TransferMode mode) private {
        stockToken.setTransferMode(mode);
        vm.expectRevert();
        vm.prank(ALICE);
        vault.withdrawFreeStock(100);
    }

    function _configureAssetStatusRoles() private {
        bytes4[] memory selectors = new bytes4[](2);
        selectors[0] = IOfficialStockRegistryV2.pauseAsset.selector;
        selectors[1] = IOfficialStockRegistryV2.retireAsset.selector;
        accessManager.setTargetFunctionRole(address(registry), selectors, PROTOCOL_ADMIN_ROLE);
    }
}
