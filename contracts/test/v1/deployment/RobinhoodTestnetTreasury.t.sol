// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {RobinhoodTestnetTreasury} from "../../../script/v1/RobinhoodTestnetTreasury.sol";

contract RobinhoodTestToken is ERC20 {
    constructor(address receiver) ERC20("Test", "TEST") {
        _mint(receiver, 100);
    }
}

contract RobinhoodSettlementVault {
    address public immutable platformTreasury;
    address public settlementOperator;

    constructor(address treasury) {
        platformTreasury = treasury;
    }

    function setSettlementOperator(address operator) external {
        require(msg.sender == platformTreasury, "only treasury");
        settlementOperator = operator;
    }
}

contract RobinhoodTestnetTreasuryTest is Test {
    function setUp() public {
        vm.chainId(46630);
    }

    function test_ownerRecoversNativeAndTokens() public {
        address owner = makeAddr("owner");
        RobinhoodTestnetTreasury treasury = new RobinhoodTestnetTreasury(owner);
        vm.deal(address(treasury), 1 ether);
        RobinhoodTestToken token = new RobinhoodTestToken(address(treasury));
        vm.expectRevert(RobinhoodTestnetTreasury.Unauthorized.selector);
        treasury.withdraw(address(0), 1 ether);
        vm.startPrank(owner);
        treasury.withdraw(address(0), 1 ether);
        treasury.withdraw(address(token), 100);
        vm.stopPrank();
        assertEq(owner.balance, 1 ether);
        assertEq(token.balanceOf(owner), 100);
    }

    function test_rejectsWrongChainAndZeroOwner() public {
        vm.chainId(4663);
        vm.expectRevert(RobinhoodTestnetTreasury.InvalidDeployment.selector);
        new RobinhoodTestnetTreasury(address(this));
        vm.chainId(46630);
        vm.expectRevert(RobinhoodTestnetTreasury.InvalidDeployment.selector);
        new RobinhoodTestnetTreasury(address(0));
    }

    function test_configuresAndRotatesSettlementOperator() public {
        address owner = makeAddr("owner");
        RobinhoodTestnetTreasury treasury = new RobinhoodTestnetTreasury(owner);
        RobinhoodSettlementVault vault = new RobinhoodSettlementVault(address(treasury));
        vm.prank(owner);
        treasury.configureSettlementOperator(address(vault), makeAddr("operatorA"));
        address operatorB = makeAddr("operatorB");
        vm.prank(owner);
        treasury.configureSettlementOperator(address(vault), operatorB);
        assertEq(vault.settlementOperator(), operatorB);
    }

    function test_rejectsUnauthorizedAndWrongVault() public {
        address owner = makeAddr("owner");
        RobinhoodTestnetTreasury treasury = new RobinhoodTestnetTreasury(owner);
        RobinhoodSettlementVault wrong = new RobinhoodSettlementVault(makeAddr("wrong"));
        vm.expectRevert(RobinhoodTestnetTreasury.Unauthorized.selector);
        treasury.configureSettlementOperator(address(wrong), makeAddr("operator"));
        vm.prank(owner);
        vm.expectRevert(RobinhoodTestnetTreasury.InvalidSettlementConfiguration.selector);
        treasury.configureSettlementOperator(address(wrong), makeAddr("operator"));
    }
}
