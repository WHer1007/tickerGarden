// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TickerGardenBaseline} from "../interfaces/IV1Protocol.sol";

/// @notice Canonical content hashes used by Factory validation and immutable market snapshots.
library V1MarketEconomics {
    bytes32 internal constant LAUNCH_BASELINE_DOMAIN = keccak256("TICKERGARDEN_V1_LAUNCH_BASELINE");
    bytes32 internal constant EXPECTED_ECONOMICS_DOMAIN = keccak256("TICKERGARDEN_V1_EXPECTED_ECONOMICS");
    bytes32 internal constant FEE_POLICY_DOMAIN = keccak256("TICKERGARDEN_V1_FEE_POLICY");
    uint256 internal constant LAUNCH_BASELINE_SCHEMA_VERSION = 1;
    uint256 internal constant EXPECTED_ECONOMICS_SCHEMA_VERSION = 7;
    uint256 internal constant FEE_POLICY_SCHEMA_VERSION = 4;

    struct FeePolicyInput {
        bytes32 executionSpecId;
        uint24 feePips;
        uint16 lpShareBps;
        uint24 poolKeyFee;
        uint160 hookPermissionMask;
        uint8 feeAssetMode;
        uint16 stakerNonLpShareBps;
        uint16 platformNonLpShareBps;
    }

    struct ExpectedEconomicsInput {
        uint256 chainId;
        address factory;
        bytes32 assetUid;
        address stockToken;
        uint8 stockDecimals;
        bytes32 tickerGardenBaselineId;
        bytes32 tickerGardenBaselineHash;
        bytes32 quoteAssetConfigId;
        bytes32 quoteEconomicsHash;
        bytes32 launchTemplateId;
        bytes32 launchTemplateHash;
        uint256 launchConfigId;
        bytes32 feePolicyId;
        bytes32 feePolicyHash;
        bytes32 executionSpecId;
        uint16 creatorTaxBps;
        bool creatorFeesToHolders;
        bool stakingEnabled;
        bool burnMemeFees;
    }

    function hashTickerGardenBaseline(TickerGardenBaseline memory value) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                LAUNCH_BASELINE_DOMAIN,
                LAUNCH_BASELINE_SCHEMA_VERSION,
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
                value.stakerNonLpShareBps,
                value.platformNonLpShareBps
            )
        );
    }

    /// @dev The all-static tuple encodes inline, byte-for-byte equal to flattened ABI words.
    function hashExpectedEconomics(ExpectedEconomicsInput memory value) internal pure returns (bytes32) {
        return keccak256(abi.encode(EXPECTED_ECONOMICS_DOMAIN, EXPECTED_ECONOMICS_SCHEMA_VERSION, value));
    }
}
