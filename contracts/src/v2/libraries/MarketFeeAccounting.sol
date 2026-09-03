// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Pure, asset-agnostic fee partitioning used only inside ProtocolFeeVault.
/// @dev The caller remains responsible for proving that the matching asset arrived before recording liabilities.
library MarketFeeAccounting {
    uint256 internal constant BPS_DENOMINATOR = 10_000;
    uint256 internal constant LP_SHARE_BPS = 2_000;

    struct V4Buckets {
        uint256 creatorAmount;
        uint256 stakerAmount;
        uint256 platformAmount;
        uint256 effectiveActiveStock;
    }

    struct CurveBuckets {
        uint256 creatorAmount;
        uint256 platformAmount;
    }

    error InvalidV4FeePartition(uint256 totalFee, uint256 lpAmount, uint256 nonLpAmount, uint256 expectedLpAmount);
    error InvalidStakeSaturationAmount(uint256 stakeSaturationAmount);

    function splitV4(
        uint256 totalFee,
        uint256 lpAmount,
        uint256 nonLpAmount,
        uint256 activeStock,
        uint256 stakeSaturationAmount
    ) internal pure returns (V4Buckets memory buckets) {
        if (stakeSaturationAmount == 0 || stakeSaturationAmount > type(uint256).max / 2) {
            revert InvalidStakeSaturationAmount(stakeSaturationAmount);
        }

        uint256 expectedLpAmount = Math.mulDiv(totalFee, LP_SHARE_BPS, BPS_DENOMINATOR);
        if (lpAmount != expectedLpAmount || lpAmount > totalFee || nonLpAmount != totalFee - lpAmount) {
            revert InvalidV4FeePartition(totalFee, lpAmount, nonLpAmount, expectedLpAmount);
        }

        buckets.effectiveActiveStock = Math.min(activeStock, stakeSaturationAmount);
        buckets.stakerAmount = Math.mulDiv(nonLpAmount, buckets.effectiveActiveStock, stakeSaturationAmount * 2);
        uint256 nonStakerAmount = nonLpAmount - buckets.stakerAmount;
        buckets.creatorAmount = nonStakerAmount / 2;
        buckets.platformAmount = nonStakerAmount - buckets.creatorAmount;
    }

    function splitCurve(uint256 amount) internal pure returns (CurveBuckets memory buckets) {
        buckets.creatorAmount = amount / 2;
        buckets.platformAmount = amount - buckets.creatorAmount;
    }
}
