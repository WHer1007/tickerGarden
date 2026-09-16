// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Creator-selected static v4 LP fee, frozen at market creation; independent of Hook fee allocation.
library StaticLPFee {
    error InvalidLPFee(uint24 feePips);

    function isAllowed(uint24 feePips) internal pure returns (bool) {
        return feePips == 0 || feePips == 1_000 || feePips == 2_000 || feePips == 3_000;
    }

    function validate(uint24 feePips) internal pure {
        if (!isAllowed(feePips)) revert InvalidLPFee(feePips);
    }
}
