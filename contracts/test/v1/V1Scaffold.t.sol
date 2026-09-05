// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {V1Scaffold} from "../../src/v1/shared/V1Scaffold.sol";

contract V1ScaffoldTest is Test {
    function test_executionSpecIdentityIsStable() public pure {
        assertEq(V1Scaffold.executionSpecIdHash(), keccak256("V1-EXEC-11"));
    }

    function test_productRuntimeImplementationIsComplete() public pure {
        assertTrue(V1Scaffold.productRuntimeComplete());
    }
}
