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

    function test_configureSettlementOperator_succeedsAndRotates() public {
        vm.chainId(421614);
        address owner = makeAddr("owner");
        address operatorA = makeAddr("operatorA");
        address operatorB = makeAddr("operatorB");
        ArbitrumTestTreasury treasury = new ArbitrumTestTreasury(owner);
        TestSettlementVault vault = new TestSettlementVault(address(treasury));

        vm.prank(owner);
        treasury.configureSettlementOperator(address(vault), operatorA);
        assertEq(vault.settlementOperator(), operatorA);

        vm.prank(owner);
        treasury.configureSettlementOperator(address(vault), operatorB);
        assertEq(vault.settlementOperator(), operatorB);
    }

    function test_configureSettlementOperator_rejectsUnauthorized() public {
        vm.chainId(421614);
        ArbitrumTestTreasury treasury = new ArbitrumTestTreasury(makeAddr("owner"));
        TestSettlementVault vault = new TestSettlementVault(address(treasury));
        vm.expectRevert(ArbitrumTestTreasury.Unauthorized.selector);
        treasury.configureSettlementOperator(address(vault), makeAddr("operator"));
    }

    function test_configureSettlementOperator_rejectsZeroAndSelfOperator() public {
        vm.chainId(421614);
        address owner = makeAddr("owner");
        ArbitrumTestTreasury treasury = new ArbitrumTestTreasury(owner);
        TestSettlementVault vault = new TestSettlementVault(address(treasury));

        vm.startPrank(owner);
        vm.expectRevert(ArbitrumTestTreasury.InvalidSettlementConfiguration.selector);
        treasury.configureSettlementOperator(address(vault), address(0));
        vm.expectRevert(ArbitrumTestTreasury.InvalidSettlementConfiguration.selector);
        treasury.configureSettlementOperator(address(vault), address(treasury));
        vm.stopPrank();
    }

    function test_configureSettlementOperator_rejectsEOAAndWrongTreasury() public {
        vm.chainId(421614);
        address owner = makeAddr("owner");
        ArbitrumTestTreasury treasury = new ArbitrumTestTreasury(owner);
        address operator = makeAddr("operator");
        TestSettlementVault wrongVault = new TestSettlementVault(makeAddr("otherTreasury"));

        vm.startPrank(owner);
        vm.expectRevert(ArbitrumTestTreasury.InvalidSettlementConfiguration.selector);
        treasury.configureSettlementOperator(address(0x1234), operator);
        vm.expectRevert(ArbitrumTestTreasury.InvalidSettlementConfiguration.selector);
        treasury.configureSettlementOperator(address(wrongVault), operator);
        vm.stopPrank();
    }

    function test_configureSettlementOperator_revertsWhenGetterMismatchesAndRollsBack() public {
        vm.chainId(421614);
        address owner = makeAddr("owner");
        address operator = makeAddr("operator");
        ArbitrumTestTreasury treasury = new ArbitrumTestTreasury(owner);
        TestSettlementVault vault = new TestSettlementVault(address(treasury));
        vault.setReportMismatchedOperator(true);

        vm.prank(owner);
        vm.expectRevert(ArbitrumTestTreasury.InvalidSettlementConfiguration.selector);
        treasury.configureSettlementOperator(address(vault), operator);
        assertEq(vault.settlementOperator(), address(0xBEEF));
        vault.setReportMismatchedOperator(false);
        assertEq(vault.settlementOperator(), address(0));
    }
}
