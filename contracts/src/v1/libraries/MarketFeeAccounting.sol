// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Pure, asset-agnostic fee partitioning used only inside ProtocolFeeVault.
/// @dev The caller remains responsible for proving that the matching asset arrived before recording liabilities.
library MarketFeeAccounting {
    uint256 internal constant BPS_DENOMINATOR = 10_000;
    uint256 internal constant LP_SHARE_BPS = 0;
    uint256 internal constant STAKER_NON_LP_SHARE_BPS = 3_000;
    uint256 internal constant PLATFORM_NON_LP_SHARE_BPS = 3_000;

    struct V4Buckets {
        uint256 creatorAmount;
        uint256 stakerAmount;
        uint256 platformAmount;
    }

    struct CurveBuckets {
        uint256 creatorAmount;
        uint256 platformAmount;
    }

    error InvalidV4FeePartition(uint256 totalFee, uint256 lpAmount, uint256 nonLpAmount, uint256 expectedLpAmount);

    function splitV4(uint256 totalFee, uint256 lpAmount, uint256 nonLpAmount, uint256 activeStock)
        internal
        pure
        returns (V4Buckets memory buckets)
    {
        uint256 expectedLpAmount = Math.mulDiv(totalFee, LP_SHARE_BPS, BPS_DENOMINATOR);
        if (lpAmount != expectedLpAmount || lpAmount > totalFee || nonLpAmount != totalFee - lpAmount) {
            revert InvalidV4FeePartition(totalFee, lpAmount, nonLpAmount, expectedLpAmount);
        }

        if (activeStock != 0) {
            buckets.stakerAmount = Math.mulDiv(nonLpAmount, STAKER_NON_LP_SHARE_BPS, BPS_DENOMINATOR);
        }
        buckets.platformAmount = Math.mulDiv(nonLpAmount, PLATFORM_NON_LP_SHARE_BPS, BPS_DENOMINATOR);
        // Both fixed beneficiary legs round down. Creator receives the indivisible residual so every fee unit is
        // conserved without allowing either Staker or Platform to exceed its configured 30% ceiling.
        buckets.creatorAmount = nonLpAmount - buckets.stakerAmount - buckets.platformAmount;
    }

    function splitCurve(uint256 amount) internal pure returns (CurveBuckets memory buckets) {
        buckets.platformAmount = Math.mulDiv(amount, PLATFORM_NON_LP_SHARE_BPS, BPS_DENOMINATOR);
        buckets.creatorAmount = amount - buckets.platformAmount;
    }
}
