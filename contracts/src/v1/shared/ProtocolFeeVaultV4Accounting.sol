// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IMemeStockGauge, MarketView} from "../interfaces/IV1Protocol.sol";
import {MarketFeeAccounting} from "../libraries/MarketFeeAccounting.sol";
import {ProtocolFeeVaultLiabilities} from "./ProtocolFeeVaultLiabilities.sol";
import {V1MarketEconomics} from "./V1MarketEconomics.sol";

/// @notice Canonical v4 fee identity, active-STOCK snapshot and fixed attribution when active stake exists.
abstract contract ProtocolFeeVaultV4Accounting is ProtocolFeeVaultLiabilities {
    bytes32 private constant V4_FEE_DOMAIN = keccak256("TICKERGARDEN_V1_V4_FEE");
    uint256 private constant V4_FEE_SCHEMA_VERSION = 1;
    bytes32 private constant EXECUTION_SPEC_ID = keccak256("V1-EXEC-6");
    uint256 private constant FEE_PIPS_DENOMINATOR = 1_000_000;
    uint24 private constant FEE_PIPS = 10_000;
    uint16 private constant LP_SHARE_BPS = 2_000;
    uint24 private constant POOL_KEY_FEE = 0;
    uint160 private constant HOOK_PERMISSION_MASK = 0x2044;
    uint8 private constant FEE_ASSET_MODE_UNSPECIFIED_CORE_SWAP_DELTA = 1;
    uint16 private constant STAKER_NON_LP_SHARE_BPS = 5_000;

    bytes32 private immutable _feePolicyId;
    bytes32 private immutable _feePolicyHash;
    mapping(bytes32 poolId => uint64 nonce) private _lastV4FeeNonces;

    error InvalidV4FeePolicy(bytes32 feePolicyId);
    error InvalidV4FeeAmounts(uint256 base, uint256 totalFee, uint256 expectedTotalFee);
    error InvalidV4MarketPolicy(bytes32 marketId, bytes32 feePolicyId, bytes32 executionSpecId);
    error CreatorEpochUnavailableForV4(bytes32 marketId, uint32 creatorEpoch);

    constructor(
        address marketRegistry_,
        address poolManager_,
        address creatorRevenueRegistry_,
        address platformTreasury_,
        bytes32 feePolicyId_
    ) ProtocolFeeVaultLiabilities(marketRegistry_, poolManager_, creatorRevenueRegistry_, platformTreasury_) {
        if (feePolicyId_ == bytes32(0)) revert InvalidV4FeePolicy(feePolicyId_);
        _feePolicyId = feePolicyId_;
        _feePolicyHash = V1MarketEconomics.hashFeePolicy(
            V1MarketEconomics.FeePolicyInput({
                executionSpecId: EXECUTION_SPEC_ID,
                feePips: FEE_PIPS,
                lpShareBps: LP_SHARE_BPS,
                poolKeyFee: POOL_KEY_FEE,
                hookPermissionMask: HOOK_PERMISSION_MASK,
                feeAssetMode: FEE_ASSET_MODE_UNSPECIFIED_CORE_SWAP_DELTA,
                stakerNonLpShareBps: STAKER_NON_LP_SHARE_BPS
            })
        );
    }

    function _recordExactV4Credit(V4CreditRecord memory record) internal virtual override {
        MarketView memory value = _feeMarketRegistry.market(record.marketId);
        _validateV4Record(record, value);
        _settleV4Attribution(record, value.config.gauge);
        _lastV4FeeNonces[value.runtime.poolId] = record.feeNonce;
    }

    function _validateV4Record(V4CreditRecord memory record, MarketView memory value) private view {
        if (value.config.feePolicyId != _feePolicyId || value.config.executionSpecId != EXECUTION_SPEC_ID) {
            revert InvalidV4MarketPolicy(record.marketId, value.config.feePolicyId, value.config.executionSpecId);
        }

        uint256 expectedTotalFee = Math.mulDiv(record.base, FEE_PIPS, FEE_PIPS_DENOMINATOR);
        if (record.totalFee == 0 || record.totalFee != expectedTotalFee) {
            revert InvalidV4FeeAmounts(record.base, record.totalFee, expectedTotalFee);
        }

        bytes32 expectedFeeId = _expectedV4FeeId(record, value.runtime.poolId);
        uint64 expectedNonce = _lastV4FeeNonces[value.runtime.poolId] + 1;
        if (record.feeId != expectedFeeId || record.feeNonce != expectedNonce) {
            revert FeeCreditNotPrepared(record.feeId);
        }
    }

    function _settleV4Attribution(V4CreditRecord memory record, address gaugeAddress) private {
        IMemeStockGauge gauge = IMemeStockGauge(gaugeAddress);
        gauge.checkpointActivations();
        uint256 activeStock = gauge.storedTotalActiveStock();
        MarketFeeAccounting.V4Buckets memory buckets =
            MarketFeeAccounting.splitV4(record.totalFee, record.lpAmount, record.nonLpAmount, activeStock);

        uint32 creatorEpoch = _feeCreatorRevenueRegistry.currentCreatorEpoch(record.marketId);
        if (
            creatorEpoch == 0
                || _feeCreatorRevenueRegistry.creatorBeneficiaryAt(record.marketId, creatorEpoch) == address(0)
        ) {
            revert CreatorEpochUnavailableForV4(record.marketId, creatorEpoch);
        }

        if (buckets.stakerAmount != 0) {
            gauge.creditStakerFee(record.feeAsset, buckets.stakerAmount, record.feeId);
        }
        _creditFeeLiabilities(
            record.marketId,
            creatorEpoch,
            record.feeAsset,
            record.nonLpAmount,
            buckets.creatorAmount,
            buckets.stakerAmount,
            buckets.platformAmount
        );

        emit FeeBucketsCredited(
            record.marketId,
            creatorEpoch,
            record.feeAsset,
            record.feeId,
            buckets.creatorAmount,
            buckets.stakerAmount,
            buckets.platformAmount,
            activeStock
        );
    }

    function _expectedV4FeeId(V4CreditRecord memory record, bytes32 poolId) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                V4_FEE_DOMAIN,
                V4_FEE_SCHEMA_VERSION,
                block.chainid,
                address(this),
                _feePoolManager,
                poolId,
                record.marketId,
                record.sourceVersion,
                record.feeNonce,
                record.feeAsset,
                record.base,
                record.totalFee,
                _feePolicyHash
            )
        );
    }

    function _v4FeePolicyHash() internal view returns (bytes32) {
        return _feePolicyHash;
    }

    function _lastV4FeeNonce(bytes32 poolId) internal view returns (uint64) {
        return _lastV4FeeNonces[poolId];
    }
}
