// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {RobinhoodTestnetBaselineFixture} from "../../../script/v1/RobinhoodTestnetBaselineFixture.sol";

contract RobinhoodTestnetBaselineFixtureTest is Test {
    function test_deploysOnlyOnRobinhoodTestnet() public {
        vm.chainId(46630);
        RobinhoodTestnetBaselineFixture fixture = new RobinhoodTestnetBaselineFixture();
        assertEq(fixture.PURPOSE(), "TICKERGARDEN_ROBINHOOD_TESTNET_BASELINE");

        vm.chainId(4663);
        vm.expectRevert("TEST_CHAIN_ONLY");
        new RobinhoodTestnetBaselineFixture();
    }
}
