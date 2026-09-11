// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ArbitrumTestTreasury} from "../../../script/v1/ArbitrumTestTreasury.sol";

contract TestTreasuryToken is ERC20 {
    constructor(address receiver) ERC20("Test", "TEST") {
        _mint(receiver, 100);
    }
}

contract TestSettlementVault {
    address public immutable platformTreasury;
    address private _settlementOperator;
    bool public reportMismatchedOperator;

    constructor(address treasury) {
        platformTreasury = treasury;
    }

    function setSettlementOperator(address operator) external {
        require(msg.sender == platformTreasury, "only treasury");
        _settlementOperator = operator;
    }

    function settlementOperator() external view returns (address) {
        return reportMismatchedOperator ? address(0xBEEF) : _settlementOperator;
    }

    function setReportMismatchedOperator(bool value) external {
        reportMismatchedOperator = value;
    }
}

contract ArbitrumTestTreasuryTest is Test {
    function test_ownerRecoversNativeAndTokens() public {
        vm.chainId(421614);
        address owner = makeAddr("owner");
        ArbitrumTestTreasury treasury = new ArbitrumTestTreasury(owner);
        vm.deal(address(treasury), 1 ether);
        TestTreasuryToken token = new TestTreasuryToken(address(treasury));
        vm.expectRevert(ArbitrumTestTreasury.Unauthorized.selector);
        treasury.withdraw(address(0), 1 ether);
        vm.expectRevert(ArbitrumTestTreasury.Unauthorized.selector);
        treasury.withdraw(address(token), 100);
        vm.startPrank(owner);
        treasury.withdraw(address(0), 1 ether);
        treasury.withdraw(address(token), 100);
        vm.stopPrank();
        assertEq(owner.balance, 1 ether);
        assertEq(token.balanceOf(owner), 100);
    }

    function test_productionAndZeroOwnerRejected() public {
        vm.chainId(4663);
        vm.expectRevert(ArbitrumTestTreasury.InvalidDeployment.selector);
        new ArbitrumTestTreasury(address(this));
        vm.chainId(421614);
        vm.expectRevert(ArbitrumTestTreasury.InvalidDeployment.selector);
        new ArbitrumTestTreasury(address(0));
    }
}
