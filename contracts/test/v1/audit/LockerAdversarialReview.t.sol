// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {LaunchLockerCompoundingTest} from "../product/LaunchLockerCompounding.t.sol";
import {LaunchLockerToken} from "../product/LaunchLocker.t.sol";
import {LaunchLockerCompounding} from "../../../src/v1/shared/LaunchLockerCompounding.sol";

/// Regression coverage for external balances and fee-funded deficit recovery.
contract LockerAdversarialReviewTest is LaunchLockerCompoundingTest {
    function test_reviewForeignErc20BalancesAreIsolatedAcrossRepeatedCompounds() public {
        _setup(false);
        donor.donate(key, 100 ether, 100 ether, bytes(""));
        LaunchLockerToken(c0).mint(address(positions), 100 ether);
        LaunchLockerToken(c1).mint(address(positions), 1);
        for (uint256 i; i < 2; i++) {
            vm.prank(compoundKeeper);
            locker.compoundLockedFees(25 ether, 30 ether, 30 ether, block.timestamp + 60);
            assertEq(positions.getPositionLiquidity(1), INITIAL + uint128((i + 1) * 25 ether));
            assertEq(LaunchLockerToken(c0).balanceOf(address(positions)), 0);
            (uint256 f0, uint256 f1) = locker.pendingCompoundFees();
            assertEq(LaunchLockerToken(c0).balanceOf(address(locker)), 100 ether + f0);
            assertEq(LaunchLockerToken(c1).balanceOf(address(locker)), 1 + f1);
        }
    }

    function test_reviewForeignNativeBalanceIsIsolatedBeforeSendingBudget() public {
        _setup(true);
        donor.donate{value: 100 ether}(key, 100 ether, 100 ether, bytes(""));
        vm.deal(address(positions), 100 ether);
        vm.prank(compoundKeeper);
        locker.compoundLockedFees(50 ether, 60 ether, 60 ether, block.timestamp + 60);
        assertEq(address(positions).balance, 0);
        (uint256 f0,) = locker.pendingCompoundFees();
        assertEq(address(locker).balance, 100 ether + f0);
        assertEq(positions.getPositionLiquidity(1), INITIAL + 50 ether);
    }

    function test_reviewNewFeesRestoreDeficitBeforeIncreasingSpendableFees() public {
        _setup(false);
        donor.donate(key, 100 ether, 100 ether, bytes(""));
        locker.collectLockedFees();
        (uint256 old0,) = locker.pendingCompoundFees();
        deal(c0, address(locker), LaunchLockerToken(c0).balanceOf(address(locker)) - 1 ether);
        donor.donate(key, 10 ether, 10 ether, bytes(""));
        (uint256 amount0,) = locker.collectLockedFees();
        assertGt(amount0, 9 ether);
        (uint256 new0,) = locker.pendingCompoundFees();
        assertEq(new0, old0 + amount0 - 1 ether);
        assertEq(LaunchLockerToken(c0).balanceOf(address(locker)), new0);
        vm.prank(compoundKeeper);
        locker.compoundLockedFees(50 ether, 60 ether, 60 ether, block.timestamp + 60);
        assertEq(positions.getPositionLiquidity(1), INITIAL + 50 ether);
    }

    function test_reviewPartialRecoveryPersistsAndNeitherAssetCanSpendUntilCovered() public {
        _setup(false);
        LaunchLockerToken(c0).mint(address(locker), 777 ether);
        donor.donate(key, 100 ether, 100 ether, bytes(""));
        locker.collectLockedFees();
        (uint256 old0, uint256 old1) = locker.pendingCompoundFees();
        deal(c0, address(locker), LaunchLockerToken(c0).balanceOf(address(locker)) - 150 ether);
        donor.donate(key, 10 ether, 20 ether, bytes(""));
        (uint256 recovered, uint256 collected1) = locker.collectLockedFees();
        (uint256 fees0, uint256 fees1) = locker.pendingCompoundFees();
        assertEq(fees0, old0);
        assertEq(fees1, old1 + collected1);
        assertEq(LaunchLockerToken(c0).balanceOf(address(locker)), 777 ether + old0 - 150 ether + recovered);
        vm.prank(compoundKeeper);
        vm.expectRevert(LaunchLockerCompounding.CompoundBalanceMismatch.selector);
        locker.compoundLockedFees(50 ether, 60 ether, 60 ether, block.timestamp + 60);
        assertEq(positions.getPositionLiquidity(1), INITIAL);
        donor.donate(key, 200 ether, 0, bytes(""));
        (uint256 next,) = locker.collectLockedFees();
        (fees0,) = locker.pendingCompoundFees();
        assertEq(fees0, old0 + recovered + next - 150 ether);
        assertEq(LaunchLockerToken(c0).balanceOf(address(locker)), 777 ether + fees0);
        vm.prank(compoundKeeper);
        locker.compoundLockedFees(50 ether, 60 ether, 60 ether, block.timestamp + 60);
        (fees0,) = locker.pendingCompoundFees();
        assertEq(LaunchLockerToken(c0).balanceOf(address(locker)), 777 ether + fees0);
    }

    function test_reviewFailedCompoundRollsBackPartialRecoveryAndExternalSweep() public {
        _setup(true);
        donor.donate{value: 100 ether}(key, 100 ether, 100 ether, bytes(""));
        locker.collectLockedFees();
        uint256 beforeBalance = address(locker).balance;
        vm.deal(address(locker), beforeBalance - 20 ether);
        donor.donate{value: 5 ether}(key, 5 ether, 0, bytes(""));
        vm.deal(address(positions), 100 ether);
        vm.prank(compoundKeeper);
        vm.expectRevert(LaunchLockerCompounding.CompoundBalanceMismatch.selector);
        locker.compoundLockedFees(50 ether, 60 ether, 60 ether, block.timestamp + 60);
        assertEq(address(locker).balance, beforeBalance - 20 ether);
        assertEq(address(positions).balance, 100 ether);
        (uint256 recovered,) = locker.collectLockedFees();
        assertGt(recovered, 4 ether);
        assertEq(address(locker).balance, beforeBalance - 20 ether + recovered);
    }

    function testFuzz_reviewRecoveryConservesHistoricalIsolation(uint128 lossInput, uint128 incomeInput) public {
        _setup(false);
        uint256 loss = bound(uint256(lossInput), 1, 500 ether);
        uint256 income = bound(uint256(incomeInput), 1, 600 ether);
        LaunchLockerToken(c0).mint(address(locker), 777 ether);
        donor.donate(key, 100 ether, 100 ether, bytes(""));
        locker.collectLockedFees();
        (uint256 oldFees, uint256 otherFees) = locker.pendingCompoundFees();
        uint256 before = LaunchLockerToken(c0).balanceOf(address(locker));
        deal(c0, address(locker), before - loss);
        donor.donate(key, income, 0, bytes(""));
        (uint256 collected,) = locker.collectLockedFees();
        (uint256 fees, uint256 unchanged) = locker.pendingCompoundFees();
        assertEq(fees, oldFees + (collected > loss ? collected - loss : 0));
        assertEq(unchanged, otherFees);
        uint256 balance = LaunchLockerToken(c0).balanceOf(address(locker));
        assertEq(balance, before - loss + collected);
        if (collected >= loss) assertEq(balance, 777 ether + fees);
        else assertEq(777 ether + fees - balance, loss - collected);
        locker.collectLockedFees(); // No double credit or implicit write-down on repeated zero collection.
        (uint256 again,) = locker.pendingCompoundFees();
        assertEq(again, fees);
        assertEq(positions.getPositionLiquidity(1), INITIAL);
    }
}
