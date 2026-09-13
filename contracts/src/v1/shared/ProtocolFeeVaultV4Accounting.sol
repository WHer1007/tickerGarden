// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {CreatorTax} from "../libraries/CreatorTax.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IMemeStockGauge, MarketView} from "../interfaces/IV1Protocol.sol";
import {MarketFeeAccounting} from "../libraries/MarketFeeAccounting.sol";
import {ProtocolFeeVaultLiabilities} from "./ProtocolFeeVaultLiabilities.sol";
import {V1MarketEconomics} from "./V1MarketEconomics.sol";

/// @notice Canonical v4 fee identity, active-STOCK snapshot and fixed attribution when active stake exists.
abstract contract ProtocolFeeVaultV4Accounting is ProtocolFeeVaultLiabilities {
    bytes32 private constant V4_FEE_DOMAIN = keccak256("TICKERGARDEN_V1_V4_FEE");
    uint256 private constant V4_FEE_SCHEMA_VERSION = 1;
    bytes32 private constant EXECUTION_SPEC_ID = keccak256("V1-EXEC-11");
    uint256 private constant FEE_PIPS_DENOMINATOR = 1_000_000;
    uint24 private constant FEE_PIPS = 10_000;
    uint16 private constant LP_SHARE_BPS = 0;
    uint24 private constant POOL_KEY_FEE = 0;
    uint160 private constant HOOK_PERMISSION_MASK = 0x2044;
    uint8 private constant FEE_ASSET_MODE_UNSPECIFIED_CORE_SWAP_DELTA = 1;
    uint16 private constant STAKER_NON_LP_SHARE_BPS = 3_000;
    uint16 private constant PLATFORM_NON_LP_SHARE_BPS = 3_000;

    bytes32 private immutable _feePolicyId;
    bytes32 private immutable _feePolicyHash;
    mapping(bytes32 poolId => uint64 nonce) internal _lastV4FeeNonces;

    struct StakerAttempt {
        uint256 activeStock;
        bool abandoned;
        bytes4 errorSelector;
    }
    uint256 public constant STAKER_SETTLEMENT_GAS = 4_000_000;
    uint256 public constant STAKER_SETTLEMENT_RESERVE = 300_000;
    error InsufficientStakerSettlementGas();
    error OnlyStakerSettlementSelf();
    event StakerFeeAbandoned(
        bytes32 indexed marketId, bytes32 indexed feeId, address indexed feeAsset, uint256 amount, bytes4 errorSelector
    );

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
                stakerNonLpShareBps: STAKER_NON_LP_SHARE_BPS,
                platformNonLpShareBps: PLATFORM_NON_LP_SHARE_BPS
            })
        );
    }

    function _recordExactV4Credit(V4CreditRecord memory record, MarketView memory value) internal virtual override {
        _validateV4Record(record, value);
        _settleV4Attribution(record, value);
        _lastV4FeeNonces[value.runtime.poolId] = record.feeNonce;
    }

    function _validateV4Record(V4CreditRecord memory record, MarketView memory value) private view {
        if (value.config.feePolicyId != _feePolicyId || value.config.executionSpecId != EXECUTION_SPEC_ID) {
            revert InvalidV4MarketPolicy(record.marketId, value.config.feePolicyId, value.config.executionSpecId);
        }

        uint256 expectedTotalFee = Math.mulDiv(record.base, FEE_PIPS, FEE_PIPS_DENOMINATOR)
            + CreatorTax.amount(record.base, value.config.creatorTaxBps);
        if (record.totalFee == 0 || record.totalFee != expectedTotalFee) {
            revert InvalidV4FeeAmounts(record.base, record.totalFee, expectedTotalFee);
        }

        bytes32 expectedFeeId = _expectedV4FeeId(record, value.runtime.poolId);
        uint64 expectedNonce = _lastV4FeeNonces[value.runtime.poolId] + 1;
        if (record.feeId != expectedFeeId || record.feeNonce != expectedNonce) {
            revert FeeCreditNotPrepared(record.feeId);
        }
    }

    function _settleV4Attribution(V4CreditRecord memory record, MarketView memory value) private {
        uint256 tax = CreatorTax.amount(record.base, value.config.creatorTaxBps);
        StakerAttempt memory attempt;
        if (value.config.stakingEnabled) {
            (attempt.activeStock, attempt.abandoned, attempt.errorSelector) = _tryStakerSettlement(
                value.config.gauge,
                record.feeAsset,
                Math.mulDiv(record.nonLpAmount - tax, STAKER_NON_LP_SHARE_BPS, 10_000),
                record.feeId
            );
        }
        MarketFeeAccounting.V4Buckets memory buckets = MarketFeeAccounting.splitV4(
            record.totalFee - tax,
            record.lpAmount,
            record.nonLpAmount - tax,
            attempt.abandoned ? 1 : attempt.activeStock
        );
        buckets.creatorAmount += tax;

        uint32 creatorEpoch = _feeCreatorRevenueRegistry.currentCreatorEpoch(record.marketId);
        if (
            creatorEpoch == 0
                || _feeCreatorRevenueRegistry.creatorBeneficiaryAt(record.marketId, creatorEpoch) == address(0)
        ) {
            revert CreatorEpochUnavailableForV4(record.marketId, creatorEpoch);
        }

        uint256 holderAmount = _creditTradingFeeLiabilities(
            record.marketId,
            creatorEpoch,
            record.feeAsset,
            record.nonLpAmount,
            buckets.creatorAmount,
            buckets.stakerAmount,
            buckets.platformAmount,
            tax,
            value
        );

        if (attempt.abandoned && buckets.stakerAmount != 0) {
            // New failed fees only. Never replay against a later cohort or touch already-earned rewards.
            _reserveForfeiture(record.marketId, address(this), record.feeAsset, buckets.stakerAmount);
            emit StakerFeeAbandoned(
                record.marketId, record.feeId, record.feeAsset, buckets.stakerAmount, attempt.errorSelector
            );
        }
        emit FeeBucketsCredited(
            record.marketId,
            creatorEpoch,
            record.feeAsset,
            record.feeId,
            buckets.creatorAmount - holderAmount,
            buckets.stakerAmount,
            buckets.platformAmount,
            attempt.activeStock
        );
    }

    /// @dev Fixed self-call creates a rollback boundary around both weight lookup and Gauge mutation.
    /// The caller cannot underfund this attempt to deliberately redirect a healthy reward.
    function _tryStakerSettlement(address gauge, address asset, uint256 amount, bytes32 feeId)
        private
        returns (uint256 activeStock, bool abandoned, bytes4 errorSelector)
    {
        bytes memory data = abi.encodeCall(this.settleV4StakerFee, (gauge, asset, amount, feeId));
        uint256 budget = STAKER_SETTLEMENT_GAS;
        if (gasleft() < budget + budget / 63 + STAKER_SETTLEMENT_RESERVE) revert InsufficientStakerSettlementGas();
        bool ok;
        uint256 size;
        bytes32 result;
        assembly ("memory-safe") {
            let out := mload(0x40)
            mstore(out, 0)
            ok := call(budget, address(), 0, add(data, 32), mload(data), out, 32)
            size := returndatasize()
            result := mload(out)
        }
        if (ok && size == 32) return (uint256(result), false, bytes4(0));
        return (0, true, bytes4(result));
    }

    /// @notice Internal transaction subcall only; no permissionless reward-credit entry.
    function settleV4StakerFee(address gauge, address asset, uint256 amount, bytes32 feeId)
        external
        returns (uint256 activeStock)
    {
        if (msg.sender != address(this) || _creditState != 2) revert OnlyStakerSettlementSelf();
        activeStock = IMemeStockGauge(gauge).effectiveTotalActiveStock();
        if (activeStock != 0 && amount != 0) IMemeStockGauge(gauge).creditStakerFee(asset, amount, feeId);
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

    function _feePolicyIdValue() internal view returns (bytes32) {
        return _feePolicyId;
    }
}
