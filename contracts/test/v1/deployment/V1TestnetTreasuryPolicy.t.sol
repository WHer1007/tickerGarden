// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {DeployV1Deterministic} from "../../../script/v1/DeployV1Deterministic.s.sol";

contract TreasuryPolicyHarness is DeployV1Deterministic {
    function validate(address treasury, address admin, bytes32 expected) external view {
        _validatePlatformTreasury(treasury, admin, expected);
    }
}

contract V1TestnetTreasuryPolicyTest is Test {
    TreasuryPolicyHarness private harness;
    address private operator;

    function setUp() public {
        harness = new TreasuryPolicyHarness();
        operator = makeAddr("testnet operator");
        vm.deal(operator, 1 ether);
    }

    function test_allNetworksRejectEOA() public {
        vm.chainId(421614);
        vm.expectRevert();
        harness.validate(operator, operator, operator.codehash);
        vm.expectRevert();
        harness.validate(operator, address(this), operator.codehash);
        vm.chainId(4663);
        vm.expectRevert();
        harness.validate(operator, operator, operator.codehash);
        vm.chainId(46630);
        vm.expectRevert();
        harness.validate(operator, operator, operator.codehash);
    }

    function test_testnetEOAStillRejectsCodeHashDrift() public {
        vm.chainId(421614);
        vm.expectRevert();
        harness.validate(operator, operator, bytes32(uint256(1)));
    }

    function test_contractTreasuryKeepsExactHashChecks() public {
        vm.chainId(4663);
        harness.validate(address(this), operator, address(this).codehash);
        vm.expectRevert();
        harness.validate(address(this), operator, bytes32(uint256(1)));
    }
}
