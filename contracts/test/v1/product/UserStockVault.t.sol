// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import {Test} from "forge-std/Test.sol";

import {IOfficialStockRegistryV1, MarketView} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {OfficialStockRegistryV1} from "../../../src/v1/modules/OfficialStockRegistryV1.sol";
import {UserStockVault} from "../../../src/v1/modules/UserStockVault.sol";
import {UserStockVaultExits} from "../../../src/v1/shared/UserStockVaultExits.sol";
import {UserStockVaultIdentity} from "../../../src/v1/shared/UserStockVaultIdentity.sol";
import {UserStockVaultLedger} from "../../../src/v1/shared/UserStockVaultLedger.sol";
import {UserStockVaultRewardAccounting} from "../../../src/v1/shared/UserStockVaultRewardAccounting.sol";
import {MockExactQuoteToken} from "../mocks/MockV1QuoteAssets.sol";
import {StockTokenFingerprintTestLib} from "../mocks/StockTokenFingerprintTestLib.sol";

contract MockProductVaultMarketRegistry {
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

contract MockProductVaultAllocationManager {
    function lock(UserStockVault vault, bytes32 assetUid, address user, bytes32 marketId, uint256 amount) external {
        vault.lockAllocation(assetUid, user, marketId, amount);
    }

    function release(UserStockVault vault, bytes32 assetUid, address user, bytes32 marketId)
        external
        returns (uint256)
    {
        return vault.releaseAllocation(assetUid, user, marketId);
    }

    function completeRageQuitRewardSettlement(UserStockVault vault, bytes32 assetUid, address user, bytes32 marketId)
        external
        returns (uint256)
    {
        return vault.completeRageQuitRewardSettlement(assetUid, user, marketId);
    }

    function recordGaugeRewardState(
        UserStockVault vault,
        bytes32 assetUid,
        bytes32 marketId,
        uint256 quoteAccumulator,
        uint256 memeAccumulator
    ) external {
        vault.recordGaugeRewardState(assetUid, marketId, quoteAccumulator, memeAccumulator);
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

contract ProductVaultRageQuitActor is IProductVaultWithdrawalCallback {
    UserStockVault private immutable _vault;
    MockProductVaultAllocationManager private immutable _manager;
    MockMutableWithdrawalStockToken private immutable _token;
    bytes32 private immutable _assetUid;
    bytes32 private immutable _marketId;

    bool public settlementCompletedDuringTransfer;

    constructor(
        UserStockVault vault,
        MockProductVaultAllocationManager manager,
        MockMutableWithdrawalStockToken token,
        bytes32 assetUid,
        bytes32 marketId
    ) {
        _vault = vault;
        _manager = manager;
        _token = token;
        _assetUid = assetUid;
        _marketId = marketId;
    }

    function deposit(uint256 amount) external {
        _token.approve(address(_vault), amount);
        _vault.depositStock(_assetUid, amount);
    }

    function rageQuit() external {
        _vault.rageQuit(_assetUid, _marketId);
    }

    function onProductVaultStockTransfer() external {
        require(msg.sender == address(_token));
        try _manager.completeRageQuitRewardSettlement(_vault, _assetUid, address(this), _marketId) returns (uint256) {
            settlementCompletedDuringTransfer = true;
        } catch {}
    }
}

contract UserStockVaultTest is Test {
    bytes32 internal constant ASSET_UID = keccak256("official-stock");
    bytes32 internal constant OTHER_ASSET_UID = keccak256("other-stock");
    bytes32 internal constant MARKET_ID = keccak256("market");
    bytes32 internal constant OTHER_MARKET_ID = keccak256("other-market");
    bytes32 internal constant SAME_ASSET_OTHER_MARKET_ID = keccak256("same-asset-other-market");
    bytes32 internal constant FOREIGN_MARKET_ID = keccak256("foreign-market");
    bytes32 internal constant UNKNOWN_MARKET_ID = keccak256("unknown-market");
    uint64 internal constant PROTOCOL_ADMIN_ROLE = 1;
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);

    AccessManager internal accessManager;
    OfficialStockRegistryV1 internal registry;
    MockProductVaultMarketRegistry internal marketRegistry;
    MockProductVaultAllocationManager internal manager;
    MockMutableWithdrawalStockToken internal stockToken;
    MockExactQuoteToken internal otherStockToken;
    UserStockVault internal vault;

    event StockWithdrawn(bytes32 indexed assetUid, address indexed user, uint256 amount);

    function setUp() public {
        accessManager = new AccessManager(address(this));
        registry = new OfficialStockRegistryV1(address(accessManager));
        marketRegistry = new MockProductVaultMarketRegistry();
        manager = new MockProductVaultAllocationManager();
        stockToken = new MockMutableWithdrawalStockToken();
        otherStockToken = new MockExactQuoteToken(18);
        stockToken.setUid(ASSET_UID);
        otherStockToken.setUid(OTHER_ASSET_UID);
        vault = new UserStockVault(address(registry), address(marketRegistry), address(manager));

        bytes4[] memory registerSelector = new bytes4[](1);
        registerSelector[0] = IOfficialStockRegistryV1.registerAsset.selector;
        accessManager.setTargetFunctionRole(address(registry), registerSelector, PROTOCOL_ADMIN_ROLE);
        accessManager.grantRole(PROTOCOL_ADMIN_ROLE, address(this), 0);
        registry.registerAsset(
            ASSET_UID,
            address(stockToken),
            18,
            address(vault),
            0.5 ether,
            StockTokenFingerprintTestLib.direct(address(stockToken))
        );
        registry.registerAsset(
            OTHER_ASSET_UID,
            address(otherStockToken),
            18,
            address(vault),
            0.5 ether,
            StockTokenFingerprintTestLib.direct(address(otherStockToken))
        );

        marketRegistry.configure(MARKET_ID, ASSET_UID);
        marketRegistry.configure(OTHER_MARKET_ID, OTHER_ASSET_UID);
        marketRegistry.configure(SAME_ASSET_OTHER_MARKET_ID, ASSET_UID);
        marketRegistry.configure(FOREIGN_MARKET_ID, OTHER_ASSET_UID);
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

        assertEq(manager.release(vault, ASSET_UID, ALICE, MARKET_ID), 700);
        vm.prank(ALICE);
        vault.withdrawFreeStock(ASSET_UID, 1_000);
        assertEq(vault.deposited(ASSET_UID, ALICE), 0);
        assertEq(vault.allocated(ASSET_UID, ALICE), 0);
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

    function test_directRageQuitImmediatelyReturnsAllocatedPrincipalWithoutManagerOrMarketState() public {
        _deposit(ALICE, 1_000);
        manager.lock(vault, ASSET_UID, ALICE, MARKET_ID, 600);

        // The escape is caller-only and independent of platform market state. The 0.5 STOCK
        // registry minimum is irrelevant to a full exit.
        uint256 aliceBalanceBefore = stockToken.balanceOf(ALICE);

        vm.prank(ALICE);
        uint256 returned = vault.rageQuit(ASSET_UID, MARKET_ID);

        assertEq(returned, 600);
        assertEq(stockToken.balanceOf(ALICE) - aliceBalanceBefore, 600);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 0);
        assertEq(vault.allocated(ASSET_UID, ALICE), 0);
        assertEq(vault.deposited(ASSET_UID, ALICE), 400);
        assertEq(vault.freeBalanceOf(ASSET_UID, ALICE), 400);
        assertEq(vault.rageQuitSettlementPrincipal(ASSET_UID, ALICE, MARKET_ID), 600);
    }

    function test_rewardEligibilityAndRageQuitCutoffRemainVaultAuthoritative() public {
        _deposit(ALICE, 1_000);
        manager.lock(vault, ASSET_UID, ALICE, MARKET_ID, 600);

        assertEq(vault.marketRewardEligible(ASSET_UID, MARKET_ID), 0);
        manager.recordGaugeRewardState(vault, ASSET_UID, MARKET_ID, 100, 200);
        vm.warp(block.timestamp + 30 seconds);
        assertEq(vault.marketRewardEligible(ASSET_UID, MARKET_ID), 600);

        vm.prank(ALICE);
        vault.rageQuit(ASSET_UID, MARKET_ID);
        assertEq(vault.marketRewardEligible(ASSET_UID, MARKET_ID), 0);

        (uint256 principal, uint256 quoteCutoff, uint256 memeCutoff) =
            vault.rageQuitRewardCutoff(ASSET_UID, ALICE, MARKET_ID);
        assertEq(principal, 600);
        assertEq(quoteCutoff, 100);
        assertEq(memeCutoff, 200);

        manager.recordGaugeRewardState(vault, ASSET_UID, MARKET_ID, 150, 250);
        (, quoteCutoff, memeCutoff) = vault.rageQuitRewardCutoff(ASSET_UID, ALICE, MARKET_ID);
        assertEq(quoteCutoff, 100);
        assertEq(memeCutoff, 200);

        vm.expectRevert(
            abi.encodeWithSelector(
                UserStockVaultRewardAccounting.RewardAccumulatorRegression.selector, 150, 149, 250, 250
            )
        );
        manager.recordGaugeRewardState(vault, ASSET_UID, MARKET_ID, 149, 250);

        manager.completeRageQuitRewardSettlement(vault, ASSET_UID, ALICE, MARKET_ID);
        (principal, quoteCutoff, memeCutoff) = vault.rageQuitRewardCutoff(ASSET_UID, ALICE, MARKET_ID);
        assertEq(principal, 0);
        assertEq(quoteCutoff, 0);
        assertEq(memeCutoff, 0);
    }

    function test_rageQuitForfeitureIsNeverRedistributableRegardlessOfExitCohort() public {
        _deposit(ALICE, 600);
        _deposit(BOB, 500);
        manager.lock(vault, ASSET_UID, ALICE, MARKET_ID, 600);
        manager.lock(vault, ASSET_UID, BOB, MARKET_ID, 400);
        vm.warp(block.timestamp + 30 seconds);

        vm.prank(ALICE);
        vault.rageQuit(ASSET_UID, MARKET_ID);

        vault.rageQuitRewardCutoff(ASSET_UID, ALICE, MARKET_ID);
        assertEq(vault.marketRewardEligible(ASSET_UID, MARKET_ID), 400);

        // Cohort mutations do not change the platform-only forfeiture policy.
        manager.lock(vault, ASSET_UID, BOB, MARKET_ID, 1);
        vault.rageQuitRewardCutoff(ASSET_UID, ALICE, MARKET_ID);
    }

    function test_directRageQuitStillReturnsPrincipalAfterAdmissionIdentityDrift() public {
        _deposit(ALICE, 700);
        manager.lock(vault, ASSET_UID, ALICE, MARKET_ID, 500);
        stockToken.setUid(OTHER_ASSET_UID);
        assertFalse(registry.assetIdentityCurrent(ASSET_UID));

        vm.prank(ALICE);
        assertEq(vault.rageQuit(ASSET_UID, MARKET_ID), 500);
        assertEq(stockToken.balanceOf(ALICE), 500);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 0);
        assertEq(vault.deposited(ASSET_UID, ALICE), 200);
        assertEq(vault.totalDeposited(ASSET_UID), 200);
    }

    function test_directRageQuitOnlyClearsCallerTargetMarketAndCannotRepeat() public {
        _deposit(ALICE, 1_000);
        _deposit(BOB, 700);
        manager.lock(vault, ASSET_UID, ALICE, MARKET_ID, 600);
        manager.lock(vault, ASSET_UID, ALICE, SAME_ASSET_OTHER_MARKET_ID, 200);
        manager.lock(vault, ASSET_UID, BOB, MARKET_ID, 300);

        vm.prank(ALICE);
        vault.rageQuit(ASSET_UID, MARKET_ID);

        // No other user's position, no other market position, and no aggregate ledger
        // belonging to another market is touched by the caller's escape.
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 0);
        assertEq(vault.allocation(ASSET_UID, ALICE, SAME_ASSET_OTHER_MARKET_ID), 200);
        assertEq(vault.allocation(ASSET_UID, BOB, MARKET_ID), 300);
        assertEq(vault.allocated(ASSET_UID, ALICE), 200);
        assertEq(vault.allocated(ASSET_UID, BOB), 300);
        assertEq(vault.marketAllocated(ASSET_UID, MARKET_ID), 300);
        assertEq(vault.marketAllocated(ASSET_UID, SAME_ASSET_OTHER_MARKET_ID), 200);
        assertEq(vault.totalAllocated(ASSET_UID), 500);
        assertEq(stockToken.balanceOf(ALICE), 600);
        assertEq(stockToken.balanceOf(BOB), 0);

        vm.expectRevert(abi.encodeWithSelector(UserStockVaultLedger.NoMarketAllocation.selector, ALICE, MARKET_ID));
        vm.prank(ALICE);
        vault.rageQuit(ASSET_UID, MARKET_ID);
    }

    function test_rageQuitRewardSettlementIsManagerOnlyAndClearsTombstone() public {
        _deposit(ALICE, 1_000);
        manager.lock(vault, ASSET_UID, ALICE, MARKET_ID, 600);
        vm.prank(ALICE);
        vault.rageQuit(ASSET_UID, MARKET_ID);

        vm.expectRevert(
            abi.encodeWithSelector(
                UserStockVaultIdentity.UnauthorizedAllocationManager.selector, ALICE, address(manager)
            )
        );
        vm.prank(ALICE);
        vault.completeRageQuitRewardSettlement(ASSET_UID, ALICE, MARKET_ID);

        assertEq(vault.rageQuitSettlementPrincipal(ASSET_UID, ALICE, MARKET_ID), 600);
        vm.expectRevert(
            abi.encodeWithSelector(UserStockVaultLedger.RageQuitRewardSettlementPending.selector, ALICE, MARKET_ID, 600)
        );
        manager.lock(vault, ASSET_UID, ALICE, MARKET_ID, 1);
        assertEq(manager.completeRageQuitRewardSettlement(vault, ASSET_UID, ALICE, MARKET_ID), 600);
        assertEq(vault.rageQuitSettlementPrincipal(ASSET_UID, ALICE, MARKET_ID), 0);

        vm.expectRevert(
            abi.encodeWithSelector(UserStockVaultLedger.NoRageQuitRewardSettlement.selector, ALICE, MARKET_ID)
        );
        manager.completeRageQuitRewardSettlement(vault, ASSET_UID, ALICE, MARKET_ID);
    }

    function test_rageQuitTransferCallbackCannotClearTombstoneBeforeExactTransferCompletes() public {
        ProductVaultRageQuitActor actor =
            new ProductVaultRageQuitActor(vault, manager, stockToken, ASSET_UID, MARKET_ID);
        stockToken.mint(address(actor), 100);
        actor.deposit(100);
        manager.lock(vault, ASSET_UID, address(actor), MARKET_ID, 100);
        stockToken.setTransferMode(MockMutableWithdrawalStockToken.TransferMode.CALLBACK);

        actor.rageQuit();

        assertFalse(actor.settlementCompletedDuringTransfer());
        assertEq(stockToken.balanceOf(address(actor)), 100);
        assertEq(vault.allocation(ASSET_UID, address(actor), MARKET_ID), 0);
        assertEq(vault.rageQuitSettlementPrincipal(ASSET_UID, address(actor), MARKET_ID), 100);
    }

    function test_canonicalSelectorsMatchInterfaceAndNoRecipientOverloadsExist() public {
        assertEq(UserStockVault.depositStock.selector, bytes4(keccak256("depositStock(bytes32,uint256)")));
        assertEq(UserStockVault.depositStockFor.selector, bytes4(keccak256("depositStockFor(bytes32,address,uint256)")));
        assertEq(UserStockVault.withdrawFreeStock.selector, bytes4(keccak256("withdrawFreeStock(bytes32,uint256)")));
        assertEq(UserStockVault.rageQuit.selector, bytes4(keccak256("rageQuit(bytes32,bytes32)")));
        assertEq(
            UserStockVault.lockAllocation.selector, bytes4(keccak256("lockAllocation(bytes32,address,bytes32,uint256)"))
        );
        assertEq(
            UserStockVault.releaseAllocation.selector, bytes4(keccak256("releaseAllocation(bytes32,address,bytes32)"))
        );
        assertEq(
            UserStockVault.rageQuitAllocation.selector, bytes4(keccak256("rageQuitAllocation(bytes32,address,bytes32)"))
        );
        assertEq(
            UserStockVault.completeRageQuitRewardSettlement.selector,
            bytes4(keccak256("completeRageQuitRewardSettlement(bytes32,address,bytes32)"))
        );
        assertEq(
            UserStockVault.recordGaugeRewardState.selector,
            bytes4(keccak256("recordGaugeRewardState(bytes32,bytes32,uint256,uint256)"))
        );
        assertEq(
            UserStockVault.rageQuitRewardCutoff.selector,
            bytes4(keccak256("rageQuitRewardCutoff(bytes32,address,bytes32)"))
        );
        assertEq(
            UserStockVault.marketRewardEligible.selector, bytes4(keccak256("marketRewardEligible(bytes32,bytes32)"))
        );

        (bool withdrawFor,) = address(vault)
            .call(abi.encodeWithSignature("withdrawFreeStock(bytes32,address,uint256)", ASSET_UID, BOB, 1));
        assertFalse(withdrawFor);
        (bool forceFor,) = address(vault)
            .call(abi.encodeWithSignature("forceReleaseAllocation(bytes32,address,bytes32)", ASSET_UID, BOB, MARKET_ID));
        (bool oldForceRelease,) = address(vault)
            .call(abi.encodeWithSignature("forceReleaseAllocation(bytes32,bytes32)", ASSET_UID, MARKET_ID));
        assertFalse(forceFor);
        (bool partialRelease,) = address(vault)
            .call(
                abi.encodeWithSignature(
                    "releaseAllocation(bytes32,address,bytes32,uint256)", ASSET_UID, ALICE, MARKET_ID, 1
                )
            );
        (bool move,) = address(vault)
            .call(
                abi.encodeWithSignature(
                    "moveAllocation(bytes32,address,bytes32,bytes32,uint256)",
                    ASSET_UID,
                    ALICE,
                    MARKET_ID,
                    OTHER_MARKET_ID,
                    1
                )
            );
        assertFalse(partialRelease);
        assertFalse(move);
        assertFalse(oldForceRelease);
    }

    function testFuzz_freeWithdrawThenRageQuitReturnsOnlyCallerPrincipal(uint96 rawDeposit, uint96 rawLocked) public {
        uint256 depositAmount = bound(rawDeposit, 1, 1e24);
        uint256 lockedAmount = bound(rawLocked, 1, depositAmount);
        _deposit(ALICE, depositAmount);
        manager.lock(vault, ASSET_UID, ALICE, MARKET_ID, lockedAmount);

        uint256 initiallyFree = depositAmount - lockedAmount;
        if (initiallyFree != 0) {
            vm.prank(ALICE);
            vault.withdrawFreeStock(ASSET_UID, initiallyFree);
        }
        vm.prank(ALICE);
        assertEq(vault.rageQuit(ASSET_UID, MARKET_ID), lockedAmount);

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
        selectors[0] = IOfficialStockRegistryV1.pauseAsset.selector;
        selectors[1] = IOfficialStockRegistryV1.retireAsset.selector;
        accessManager.setTargetFunctionRole(address(registry), selectors, PROTOCOL_ADMIN_ROLE);
    }
}
