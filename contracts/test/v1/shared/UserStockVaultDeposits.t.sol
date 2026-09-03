// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import {Test} from "forge-std/Test.sol";

import {IOfficialStockRegistryV1} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {OfficialStockRegistryV1} from "../../../src/v1/modules/OfficialStockRegistryV1.sol";
import {UserStockVaultDeposits} from "../../../src/v1/shared/UserStockVaultDeposits.sol";
import {
    IV1QuoteTransferCallback,
    MockCallbackQuoteToken,
    MockExactQuoteToken,
    MockFeeOnTransferQuoteToken
} from "../mocks/MockV1QuoteAssets.sol";
import {StockTokenFingerprintTestLib} from "../mocks/StockTokenFingerprintTestLib.sol";

interface IVaultDepositHarness {
    function depositStockFor(bytes32 assetUid, address user, uint256 amount) external;
}

contract MockVaultAllocationManager {
    function depositForCaller(IVaultDepositHarness vault, bytes32 assetUid, uint256 amount) external {
        vault.depositStockFor(assetUid, msg.sender, amount);
    }
}

contract EmptyDepositMarketRegistry {}

contract MockReturnAnomalyStockToken is MockExactQuoteToken {
    enum ReturnMode {
        FALSE,
        NO_DATA,
        MALFORMED_TRUE
    }

    ReturnMode public mode;

    constructor() MockExactQuoteToken(18) {}

    function setMode(ReturnMode mode_) external {
        mode = mode_;
    }

    function transferFrom(address, address, uint256) external view override returns (bool) {
        ReturnMode current = mode;
        assembly ("memory-safe") {
            switch current
            case 0 {
                mstore(0, 0)
                return(0, 32)
            }
            case 1 { return(0, 0) }
            default {
                mstore(0, 2)
                return(0, 32)
            }
        }
    }
}

contract MockPositiveRebaseStockToken is MockExactQuoteToken {
    constructor() MockExactQuoteToken(18) {}

    function transferFrom(address owner, address recipient, uint256 amount) external override returns (bool) {
        uint256 currentAllowance = allowance[owner][msg.sender];
        if (currentAllowance != type(uint256).max) allowance[owner][msg.sender] = currentAllowance - amount;
        _transfer(owner, recipient, amount);
        balanceOf[recipient] += 1;
        return true;
    }
}

contract UserStockVaultDepositsHarness is UserStockVaultDeposits, IV1QuoteTransferCallback, IVaultDepositHarness {
    event StockDeposited(bytes32 indexed assetUid, address indexed user, uint256 amount);

    constructor(address registry, address marketRegistry, address allocationManager)
        UserStockVaultDeposits(registry, marketRegistry, allocationManager)
    {}

    function depositStock(bytes32 assetUid, uint256 amount) external {
        _depositStock(assetUid, msg.sender, amount);
        emit StockDeposited(assetUid, msg.sender, amount);
    }

    function depositStockFor(bytes32 assetUid, address user, uint256 amount) external override onlyAllocationManager {
        _depositStock(assetUid, user, amount);
        emit StockDeposited(assetUid, user, amount);
    }

    function deposited(bytes32 assetUid, address user) external view returns (uint256) {
        return _deposited[assetUid][user];
    }

    function totalDeposited(bytes32 assetUid) external view returns (uint256) {
        return _totalDeposited[assetUid];
    }

    function vaultIdentity()
        external
        view
        returns (address registry, address marketRegistry, address allocationManager, bytes32 schemaId)
    {
        return (
            address(_officialStockRegistry),
            address(_marketRegistry),
            _allocationManager,
            keccak256("TickerGarden.UserStockVault.MultiAsset.v4")
        );
    }

    function onV1QuoteTransfer(address, address, uint256) external {
        this.depositStock(keccak256("callback"), 1);
    }
}

contract UserStockVaultDepositsTest is Test {
    bytes32 internal constant ASSET_UID = keccak256("official-stock");
    bytes32 internal constant OTHER_ASSET_UID = keccak256("other-official-stock");
    uint64 internal constant PROTOCOL_ADMIN_ROLE = 1;
    address internal constant USER = address(0xA11CE);

    AccessManager internal accessManager;
    OfficialStockRegistryV1 internal registry;
    MockVaultAllocationManager internal allocationManager;
    EmptyDepositMarketRegistry internal marketRegistry;
    MockExactQuoteToken internal stockToken;
    MockExactQuoteToken internal otherToken;
    UserStockVaultDepositsHarness internal vault;

    event StockDeposited(bytes32 indexed assetUid, address indexed user, uint256 amount);

    function setUp() public {
        accessManager = new AccessManager(address(this));
        registry = new OfficialStockRegistryV1(address(accessManager));
        allocationManager = new MockVaultAllocationManager();
        marketRegistry = new EmptyDepositMarketRegistry();
        stockToken = new MockExactQuoteToken(18);
        otherToken = new MockExactQuoteToken(6);
        stockToken.setUid(ASSET_UID);
        otherToken.setUid(OTHER_ASSET_UID);
        vault =
            new UserStockVaultDepositsHarness(address(registry), address(marketRegistry), address(allocationManager));
        _configureRegisterRole();
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
            address(otherToken),
            6,
            address(vault),
            500_000,
            StockTokenFingerprintTestLib.direct(address(otherToken))
        );
    }

    function test_directDepositPullsFromAndCreditsOnlyTheCaller() public {
        stockToken.mint(USER, 1_000);
        vm.prank(USER);
        stockToken.approve(address(vault), 600);

        vm.expectEmit(true, true, false, true, address(vault));
        emit StockDeposited(ASSET_UID, USER, 600);
        vm.prank(USER);
        vault.depositStock(ASSET_UID, 600);

        assertEq(stockToken.balanceOf(USER), 400);
        assertEq(stockToken.balanceOf(address(vault)), 600);
        assertEq(vault.deposited(ASSET_UID, USER), 600);
        assertEq(vault.deposited(ASSET_UID, address(this)), 0);
        assertEq(vault.totalDeposited(ASSET_UID), 600);
    }

    function test_composedDepositUsesOuterCallerAndOnlyVaultAllowance() public {
        stockToken.mint(USER, 1_000);
        vm.prank(USER);
        stockToken.approve(address(vault), 700);

        vm.prank(USER);
        allocationManager.depositForCaller(vault, ASSET_UID, 700);

        assertEq(vault.deposited(ASSET_UID, USER), 700);
        assertEq(stockToken.balanceOf(address(vault)), 700);
        assertEq(stockToken.balanceOf(address(allocationManager)), 0);
        assertEq(stockToken.allowance(USER, address(allocationManager)), 0);
        assertEq(stockToken.allowance(address(vault), address(allocationManager)), 0);
    }

    function test_publicCannotUseDepositForOrReplaceTheCreditedUser() public {
        vm.expectRevert();
        vm.prank(USER);
        vault.depositStockFor(ASSET_UID, address(0xB0B), 1);
        assertEq(vault.deposited(ASSET_UID, address(0xB0B)), 0);
    }

    function test_zeroAmountAndInvalidComposedAccountsFailBeforeTransfer() public {
        vm.expectRevert(abi.encodeWithSelector(UserStockVaultDeposits.InvalidDepositAmount.selector, uint256(0)));
        vm.prank(USER);
        vault.depositStock(ASSET_UID, 0);

        vm.expectRevert(abi.encodeWithSelector(UserStockVaultDeposits.InvalidDepositAccount.selector, address(0)));
        vm.prank(address(allocationManager));
        vault.depositStockFor(ASSET_UID, address(0), 1);
        vm.expectRevert(abi.encodeWithSelector(UserStockVaultDeposits.InvalidDepositAccount.selector, address(vault)));
        vm.prank(address(allocationManager));
        vault.depositStockFor(ASSET_UID, address(vault), 1);
    }

    function test_pausedAssetRejectsNewDepositsWithoutChangingAccounting() public {
        _configurePauseRole();
        registry.pauseAsset(ASSET_UID, keccak256("pause"));
        stockToken.mint(USER, 100);
        vm.prank(USER);
        stockToken.approve(address(vault), 100);

        vm.expectRevert();
        vm.prank(USER);
        vault.depositStock(ASSET_UID, 100);
        assertEq(vault.deposited(ASSET_UID, USER), 0);
        assertEq(vault.totalDeposited(ASSET_UID), 0);
        assertEq(stockToken.balanceOf(USER), 100);
    }

    function test_feeOnTransferAndPositiveRebaseDeltasAreRejectedAtomically() public {
        MockFeeOnTransferQuoteToken feeToken = new MockFeeOnTransferQuoteToken(18, 100);
        bytes32 feeAsset = keccak256("fee");
        feeToken.setUid(feeAsset);
        UserStockVaultDepositsHarness feeVault = _deployAndRegisterNewAsset(address(feeToken), feeAsset);
        feeToken.mint(USER, 1_000);
        vm.prank(USER);
        feeToken.approve(address(feeVault), 1_000);
        vm.expectRevert(
            abi.encodeWithSelector(
                UserStockVaultDeposits.InexactStockBalanceDelta.selector,
                address(feeToken),
                uint256(1_000),
                uint256(990)
            )
        );
        vm.prank(USER);
        feeVault.depositStock(feeAsset, 1_000);
        assertEq(feeToken.balanceOf(USER), 1_000);
        assertEq(feeVault.totalDeposited(feeAsset), 0);

        MockPositiveRebaseStockToken rebaseToken = new MockPositiveRebaseStockToken();
        bytes32 rebaseAsset = keccak256("rebase");
        rebaseToken.setUid(rebaseAsset);
        UserStockVaultDepositsHarness rebaseVault = _deployAndRegisterNewAsset(address(rebaseToken), rebaseAsset);
        rebaseToken.mint(USER, 1_000);
        vm.prank(USER);
        rebaseToken.approve(address(rebaseVault), 1_000);
        vm.expectRevert(
            abi.encodeWithSelector(
                UserStockVaultDeposits.InexactStockBalanceDelta.selector,
                address(rebaseToken),
                uint256(1_000),
                uint256(1_001)
            )
        );
        vm.prank(USER);
        rebaseVault.depositStock(rebaseAsset, 1_000);
        assertEq(rebaseToken.balanceOf(USER), 1_000);
        assertEq(rebaseVault.totalDeposited(rebaseAsset), 0);
    }

    function test_falseNoDataMalformedAndRevertingTransferFromAreRejected() public {
        MockReturnAnomalyStockToken anomaly = new MockReturnAnomalyStockToken();
        bytes32 anomalyAsset = keccak256("anomaly");
        anomaly.setUid(anomalyAsset);
        UserStockVaultDepositsHarness anomalyVault = _deployAndRegisterNewAsset(address(anomaly), anomalyAsset);

        vm.expectRevert(
            abi.encodeWithSelector(UserStockVaultDeposits.InvalidStockTransferReturn.selector, address(anomaly))
        );
        vm.prank(USER);
        anomalyVault.depositStock(anomalyAsset, 1);
        anomaly.setMode(MockReturnAnomalyStockToken.ReturnMode.NO_DATA);
        vm.expectRevert(
            abi.encodeWithSelector(UserStockVaultDeposits.InvalidStockTransferReturn.selector, address(anomaly))
        );
        vm.prank(USER);
        anomalyVault.depositStock(anomalyAsset, 1);
        anomaly.setMode(MockReturnAnomalyStockToken.ReturnMode.MALFORMED_TRUE);
        vm.expectRevert(
            abi.encodeWithSelector(UserStockVaultDeposits.InvalidStockTransferReturn.selector, address(anomaly))
        );
        vm.prank(USER);
        anomalyVault.depositStock(anomalyAsset, 1);

        vm.expectRevert(
            abi.encodeWithSelector(UserStockVaultDeposits.StockTransferCallFailed.selector, address(stockToken))
        );
        vm.prank(USER);
        vault.depositStock(ASSET_UID, 1);
        assertEq(vault.totalDeposited(ASSET_UID), 0);
    }

    function test_transferCallbackCannotReenterOrLeavePartialCredit() public {
        MockCallbackQuoteToken callbackToken = new MockCallbackQuoteToken(18);
        bytes32 callbackAsset = keccak256("callback");
        UserStockVaultDepositsHarness callbackVault = _deployAndRegisterNewAsset(address(callbackToken), callbackAsset);
        callbackToken.mint(USER, 100);
        vm.prank(USER);
        callbackToken.approve(address(callbackVault), 100);
        callbackToken.setCallbackEnabled(true);

        vm.expectRevert(
            abi.encodeWithSelector(UserStockVaultDeposits.StockTransferCallFailed.selector, address(callbackToken))
        );
        vm.prank(USER);
        callbackVault.depositStock(callbackAsset, 100);
        assertEq(callbackToken.balanceOf(USER), 100);
        assertEq(callbackToken.balanceOf(address(callbackVault)), 0);
        assertEq(callbackVault.totalDeposited(callbackAsset), 0);
    }

    function _deployAndRegisterNewAsset(address token, bytes32 assetUid)
        private
        returns (UserStockVaultDepositsHarness deployedVault)
    {
        deployedVault = vault;
        (bool uidSet,) = token.call(abi.encodeWithSignature("setUid(bytes32)", assetUid));
        assertTrue(uidSet);
        registry.registerAsset(
            assetUid, token, 18, address(vault), 0.5 ether, StockTokenFingerprintTestLib.direct(token)
        );
    }

    function _configureRegisterRole() private {
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = IOfficialStockRegistryV1.registerAsset.selector;
        accessManager.setTargetFunctionRole(address(registry), selectors, PROTOCOL_ADMIN_ROLE);
        accessManager.grantRole(PROTOCOL_ADMIN_ROLE, address(this), 0);
    }

    function _configurePauseRole() private {
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = IOfficialStockRegistryV1.pauseAsset.selector;
        accessManager.setTargetFunctionRole(address(registry), selectors, PROTOCOL_ADMIN_ROLE);
    }
}
