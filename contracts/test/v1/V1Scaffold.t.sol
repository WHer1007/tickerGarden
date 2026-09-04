// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {V1Scaffold} from "../../src/v1/shared/V1Scaffold.sol";

contract V1ScaffoldTest is Test {
    function test_executionSpecIdentityIsStable() public pure {
        assertEq(V1Scaffold.executionSpecIdHash(), keccak256("V1-EXEC-8"));
    }

    function test_completeProductRuntimeRemainsExplicitlyIncomplete() public pure {
        assertFalse(V1Scaffold.productRuntimeComplete());
    }
}
