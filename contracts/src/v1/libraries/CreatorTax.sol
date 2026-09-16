// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Creation-time surcharge; entirely creator-owned and never part of the base fee split.
library CreatorTax {
    uint16 internal constant MAX_BPS = 500;
    error CreatorTaxTooHigh(uint256 supplied, uint256 maximum);

    function validate(uint256 bps) internal pure {
        if (bps > MAX_BPS) revert CreatorTaxTooHigh(bps, MAX_BPS);
    }

    function amount(uint256 base, uint256 bps) internal pure returns (uint256) {
        validate(bps);
        return Math.mulDiv(base, bps, 10_000);
    }
}
