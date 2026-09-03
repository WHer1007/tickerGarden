// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AuthorityUtils} from "@openzeppelin/contracts/access/manager/AuthorityUtils.sol";

/// @notice Immutable AccessManager adapter for the isolated V2 Treasury preview.
abstract contract ImmutableAccessManagedV2 {
    address public immutable authority;

    error InvalidAuthority(address authority);
    error AccessManagedUnauthorized(address caller, bytes4 selector);

    constructor(address authority_) {
        if (authority_ == address(0) || authority_.code.length == 0) revert InvalidAuthority(authority_);
        authority = authority_;
    }

    modifier restricted() {
        _checkRestricted();
        _;
    }

    function _checkRestricted() private view {
        (bool immediate,) = AuthorityUtils.canCallWithDelay(authority, msg.sender, address(this), msg.sig);
        if (!immediate) revert AccessManagedUnauthorized(msg.sender, msg.sig);
    }
}
