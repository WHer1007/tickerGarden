// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {LockerAdversarialReviewTest} from "../audit/LockerAdversarialReview.t.sol";

/// @notice Current Locker with real v4 contracts and the deployed, codehash-pinned RH Permit2.
/// @dev Test tokens and local pools isolate recovery semantics; this does not certify real Stock assets.
contract LockerRecoveryForkTest is LockerAdversarialReviewTest {
    function _deployPermit2() internal override returns (address) {
        assertEq(block.chainid, 4663);
        address deployed = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
        assertEq(deployed.codehash, 0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca);
        return deployed;
    }
}
