// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {UserStockVaultTest, MockMutableWithdrawalStockToken} from "../product/UserStockVault.t.sol";
import {OfficialStockRegistryV1} from "../../../src/v1/modules/OfficialStockRegistryV1.sol";
import {UserStockVaultDeposits} from "../../../src/v1/shared/UserStockVaultDeposits.sol";
import {UserStockVaultExits} from "../../../src/v1/shared/UserStockVaultExits.sol";

contract VaultOpcodeCostProbe is OfficialStockRegistryV1 {
    constructor(address authority) OfficialStockRegistryV1(authority) {}

    function scan(address target) external view returns (bool) {
        return _containsForbiddenVaultOpcode(target);
    }
}

/// @notice Conditional custody trust-boundary reproductions, not proof that a
///         currently admitted real STOCK token exposes these behaviours.
contract StockVaultCustodyBoundaryTest is UserStockVaultTest {
    function _auditDeposit(address user, uint256 amount) private {
        stockToken.mint(user, amount);
        vm.startPrank(user);
        stockToken.approve(address(vault), amount);
        vault.depositStock(ASSET_UID, amount);
        vm.stopPrank();
    }

    function testAudit_measureRepeatedRuntimeScanCost() public {
        VaultOpcodeCostProbe probe = new VaultOpcodeCostProbe(address(accessManager));
        uint256 beforeScan = gasleft();
        assertFalse(probe.scan(address(vault)));
        uint256 scanGas = beforeScan - gasleft();
        uint256 beforeIdentity = gasleft();
        assertTrue(registry.assetIdentityCurrent(ASSET_UID));
        uint256 identityGas = beforeIdentity - gasleft();
        stockToken.mint(ALICE, 100);
        vm.prank(ALICE);
        stockToken.approve(address(vault), 100);
        vm.prank(ALICE);
        uint256 beforeDeposit = gasleft();
        vault.depositStock(ASSET_UID, 100);
        uint256 depositGas = beforeDeposit - gasleft();
        emit log_named_uint("vault runtime bytes", address(vault).code.length);
        emit log_named_uint("opcode scan gas", scanGas);
        emit log_named_uint("asset identity gas", identityGas);
        emit log_named_uint("deposit call gas", depositGas);
        assertGt(scanGas, 100_000);
        assertLt(identityGas, 150_000, "identity checks must not rescan pinned runtime");
        assertLt(depositGas, 300_000, "deposit must not rescan pinned runtime");
    }

    function testAudit_externalBalanceLossRejectsBothDepositEntrypointsBeforeTransfer() public {
        _auditDeposit(ALICE, 100);
        _auditDeposit(BOB, 100);
        deal(address(stockToken), address(vault), 150);
        assertTrue(registry.assetIdentityCurrent(ASSET_UID));
        address lateUser = address(0xCA11);
        stockToken.mint(lateUser, 100);
        vm.prank(lateUser);
        stockToken.approve(address(vault), 100);
        vm.expectCall(
            address(stockToken),
            abi.encodeWithSignature("transferFrom(address,address,uint256)", lateUser, address(vault), 100),
            uint64(0)
        );
        bytes memory expected =
            abi.encodeWithSelector(UserStockVaultDeposits.StockPrincipalDeficit.selector, ASSET_UID, 150, 200);
        vm.expectRevert(expected);
        vm.prank(lateUser);
        vault.depositStock(ASSET_UID, 100);
        vm.expectRevert(expected);
        vm.prank(address(manager));
        vault.depositStockFor(ASSET_UID, lateUser, 100);
        assertEq(vault.totalDeposited(ASSET_UID), 200);
        assertEq(vault.deposited(ASSET_UID, lateUser), 0);
        assertEq(stockToken.balanceOf(address(vault)), 150);
        assertEq(stockToken.balanceOf(lateUser), 100);
        assertEq(stockToken.allowance(lateUser, address(vault)), 100);
    }

    function testAudit_deficitDoesNotBlockRemainingFreePrincipalOrRageQuit() public {
        _auditDeposit(ALICE, 200);
        _auditDeposit(BOB, 100);
        manager.lock(vault, ASSET_UID, ALICE, MARKET_ID, 100);
        deal(address(stockToken), address(vault), 250);
        vm.startPrank(ALICE);
        vault.withdrawFreeStock(ASSET_UID, 100);
        vault.rageQuit(ASSET_UID, MARKET_ID);
        vm.stopPrank();
        assertEq(stockToken.balanceOf(ALICE), 200);
        assertEq(vault.deposited(ASSET_UID, ALICE), 0);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 0);
        assertEq(stockToken.balanceOf(address(vault)), 50);
        assertEq(vault.totalDeposited(ASSET_UID), 100);
    }

    function testAudit_deficitIsAssetLocalAndDepositsResumeAfterFullCoverage() public {
        _auditDeposit(ALICE, 100);
        deal(address(stockToken), address(vault), 99);
        otherStockToken.mint(BOB, 50);
        vm.startPrank(BOB);
        otherStockToken.approve(address(vault), 50);
        vault.depositStock(OTHER_ASSET_UID, 50);
        vm.stopPrank();
        assertEq(vault.deposited(OTHER_ASSET_UID, BOB), 50);
        // External replenishment restores coverage without inventing user credit.
        stockToken.mint(address(vault), 1);
        _auditDeposit(BOB, 20);
        assertEq(vault.totalDeposited(ASSET_UID), 120);
        assertEq(stockToken.balanceOf(address(vault)), 120);
        stockToken.mint(address(vault), 5);
        _auditDeposit(BOB, 10);
        assertEq(vault.totalDeposited(ASSET_UID), 130);
        assertEq(stockToken.balanceOf(address(vault)), 135);
    }

    function testAudit_directTransferCreatesUncreditedSurplus() public {
        stockToken.mint(ALICE, 100);
        vm.prank(ALICE);
        stockToken.transfer(address(vault), 100);
        assertEq(stockToken.balanceOf(address(vault)), 100);
        assertEq(vault.totalDeposited(ASSET_UID), 0);
        assertEq(vault.freeBalanceOf(ASSET_UID, ALICE), 0);
        vm.expectRevert(abi.encodeWithSelector(UserStockVaultExits.InsufficientFreeBalance.selector, 100, 0));
        vm.prank(ALICE);
        vault.withdrawFreeStock(ASSET_UID, 100);
    }

    function testAudit_changedTransferReturnBlocksBothExitsWithoutLosingLedger() public {
        _auditDeposit(ALICE, 200);
        manager.lock(vault, ASSET_UID, ALICE, MARKET_ID, 100);
        stockToken.setTransferMode(MockMutableWithdrawalStockToken.TransferMode.NO_DATA);
        assertTrue(registry.assetIdentityCurrent(ASSET_UID));
        vm.expectRevert(
            abi.encodeWithSelector(UserStockVaultExits.InvalidStockWithdrawalReturn.selector, address(stockToken))
        );
        vm.prank(ALICE);
        vault.withdrawFreeStock(ASSET_UID, 100);
        vm.expectRevert(
            abi.encodeWithSelector(UserStockVaultExits.InvalidStockWithdrawalReturn.selector, address(stockToken))
        );
        vm.prank(ALICE);
        vault.rageQuit(ASSET_UID, MARKET_ID);
        assertEq(vault.deposited(ASSET_UID, ALICE), 200);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 100);
        assertEq(vault.rageQuitSettlementPrincipal(ASSET_UID, ALICE, MARKET_ID), 0);
    }
}
