// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {LocalPermit2} from "../../script/local/LocalCreatorClaim.s.sol";

contract LocalPermit2Test is Test {
    function testAllowanceMatchesCanonicalPermit2Tuple() external {
        IAllowanceTransfer permit2 = IAllowanceTransfer(address(new LocalPermit2()));
        address token = makeAddr("token");
        address spender = makeAddr("spender");

        permit2.approve(token, spender, 123, 456);

        (uint160 amount, uint48 expiration, uint48 nonce) = permit2.allowance(address(this), token, spender);
        assertEq(amount, 123);
        assertEq(expiration, 456);
        assertEq(nonce, 0);
    }
}
