// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PonsBaseline} from "../interfaces/IV1Protocol.sol";

/// @notice Canonical content hashes used by Factory validation and immutable market snapshots.
library V1MarketEconomics {
    bytes32 internal constant PONS_BASELINE_DOMAIN = keccak256("TICKERGARDEN_V1_PONS_BASELINE");
    bytes32 internal constant EXPECTED_ECONOMICS_DOMAIN = keccak256("TICKERGARDEN_V1_EXPECTED_ECONOMICS");
    bytes32 internal constant FEE_POLICY_DOMAIN = keccak256("TICKERGARDEN_V1_FEE_POLICY");
    uint256 internal constant PONS_BASELINE_SCHEMA_VERSION = 1;
    uint256 internal constant EXPECTED_ECONOMICS_SCHEMA_VERSION = 3;
    uint256 internal constant FEE_POLICY_SCHEMA_VERSION = 3;

    struct FeePolicyInput {
        bytes32 executionSpecId;
        uint24 feePips;
        uint16 lpShareBps;
        uint24 poolKeyFee;
        uint160 hookPermissionMask;
        uint8 feeAssetMode;
        uint16 stakerNonLpShareBps;
    }

    struct ExpectedEconomicsInput {
        uint256 chainId;
        address factory;
        bytes32 assetUid;
        address stockToken;
        uint8 stockDecimals;
        bytes32 ponsBaselineId;
        bytes32 ponsBaselineHash;
        bytes32 quoteAssetConfigId;
        bytes32 quoteEconomicsHash;
        bytes32 launchTemplateId;
        bytes32 launchTemplateHash;
        uint256 launchConfigId;
        bytes32 feePolicyId;
        bytes32 feePolicyHash;
        bytes32 executionSpecId;
    }

    function hashPonsBaseline(PonsBaseline memory value) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                PONS_BASELINE_DOMAIN,
                PONS_BASELINE_SCHEMA_VERSION,
                value.referenceChainId,
                value.referenceFactory,
                value.referenceFactoryCodeHash,
                value.launchConfigId,
                value.supply,
                value.curveFeeBps,
                value.poolFee,
                value.tickSpacing,
                value.behaviorVectorRoot
            )
        );
    }

    function hashFeePolicy(FeePolicyInput memory value) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                FEE_POLICY_DOMAIN,
                FEE_POLICY_SCHEMA_VERSION,
                value.executionSpecId,
                value.feePips,
                value.lpShareBps,
                value.poolKeyFee,
                value.hookPermissionMask,
                value.feeAssetMode,
                value.stakerNonLpShareBps
            )
        );
    }

    /// @dev All encoded values are static ABI words. Splitting avoids legacy-codegen stack limits while bytes.concat
    ///      remains byte-for-byte identical to one abi.encode call.
    function hashExpectedEconomics(ExpectedEconomicsInput memory value) internal pure returns (bytes32) {
        bytes memory first = abi.encode(
            EXPECTED_ECONOMICS_DOMAIN,
            EXPECTED_ECONOMICS_SCHEMA_VERSION,
            value.chainId,
            value.factory,
            value.assetUid,
            value.stockToken,
            value.stockDecimals,
            value.ponsBaselineId
        );
        bytes memory second = abi.encode(
            value.ponsBaselineHash,
            value.quoteAssetConfigId,
            value.quoteEconomicsHash,
            value.launchTemplateId,
            value.launchTemplateHash,
            value.launchConfigId,
            value.feePolicyId,
            value.feePolicyHash,
            value.executionSpecId
        );
        return keccak256(bytes.concat(first, second));
    }
}
