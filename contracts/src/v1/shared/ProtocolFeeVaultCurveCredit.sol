// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ICreatorRevenueRegistry, MarketView} from "../interfaces/IV1Protocol.sol";
import {MarketFeeAccounting} from "../libraries/MarketFeeAccounting.sol";
import {ProtocolFeeVaultV4Credit} from "./ProtocolFeeVaultV4Credit.sol";

/// @notice Exact registered-Curve credit and creator-epoch binding for the eventual ProtocolFeeVault.
abstract contract ProtocolFeeVaultCurveCredit is ProtocolFeeVaultV4Credit {
    struct CurveCreditRecord {
        bytes32 marketId;
        uint32 creatorEpoch;
        address quoteAsset;
        uint256 amount;
        uint256 creatorAmount;
        uint256 platformAmount;
        uint256 currentBalance;
        uint32 sourceVersion;
        uint64 sweepNonce;
        bytes32 feeId;
    }

    bytes32 private constant CURVE_SWEEP_DOMAIN = keccak256("TICKERGARDEN_V1_CURVE_SWEEP");
    uint256 private constant CURVE_SWEEP_SCHEMA_VERSION = 1;
    uint8 private constant LAUNCH_PHASE_NOT_GRADUATED = 0;

    ICreatorRevenueRegistry internal immutable _feeCreatorRevenueRegistry;
    mapping(bytes32 marketId => uint64 nonce) private _lastCurveSweepNonces;

    error InvalidCreatorRevenueRegistry(address registry);
    error UnauthorizedMarketCurve(address caller, address expected);
    error CurveFeeSweepAfterClose(bytes32 marketId);
    error CreatorEpochUnavailable(bytes32 marketId, uint32 creatorEpoch);

    constructor(address marketRegistry_, address poolManager_, address creatorRevenueRegistry_)
        ProtocolFeeVaultV4Credit(marketRegistry_, poolManager_)
    {
        if (creatorRevenueRegistry_.code.length == 0) {
            revert InvalidCreatorRevenueRegistry(creatorRevenueRegistry_);
        }
        _feeCreatorRevenueRegistry = ICreatorRevenueRegistry(creatorRevenueRegistry_);
    }

    function creditCurveSweep(
        bytes32 marketId,
        address quoteAsset,
        uint256 amount,
        uint32 sourceVersion,
        uint64 sweepNonce,
        bytes32 feeId
    ) external payable {
        _enterStandaloneCredit(feeId);
        if (amount == 0 || amount > uint256(uint128(type(int128).max))) revert FeeAmountTooLarge(amount);

        MarketView memory value = _feeMarketRegistry.market(marketId);
        if (value.config.curve != msg.sender) revert UnauthorizedMarketCurve(msg.sender, value.config.curve);
        if (value.runtime.launchPhase != LAUNCH_PHASE_NOT_GRADUATED || value.runtime.sourceVersion != sourceVersion) {
            revert CurveFeeSweepAfterClose(marketId);
        }
        if (quoteAsset != value.config.quoteAsset) revert FeeAssetNotCanonical(quoteAsset);

        bytes32 expectedFeeId = keccak256(
            abi.encode(
                CURVE_SWEEP_DOMAIN,
                CURVE_SWEEP_SCHEMA_VERSION,
                block.chainid,
                address(this),
                msg.sender,
                marketId,
                sourceVersion,
                sweepNonce,
                quoteAsset,
                amount
            )
        );
        uint64 expectedNonce = _lastCurveSweepNonces[marketId] + 1;
        if (feeId != expectedFeeId || sweepNonce != expectedNonce) revert FeeCreditNotPrepared(feeId);

        uint32 creatorEpoch = _feeCreatorRevenueRegistry.currentCreatorEpoch(marketId);
        if (creatorEpoch == 0 || _feeCreatorRevenueRegistry.creatorBeneficiaryAt(marketId, creatorEpoch) == address(0))
        {
            revert CreatorEpochUnavailable(marketId, creatorEpoch);
        }

        if (quoteAsset == address(0)) {
            if (msg.value != amount) revert FeeBalanceDeltaMismatch(quoteAsset, amount, msg.value);
        } else if (msg.value != 0) {
            revert FeeBalanceDeltaMismatch(quoteAsset, 0, msg.value);
        }
        uint256 currentBalance = _assetBalance(quoteAsset);
        if (currentBalance < amount) revert FeeBalanceDeltaMismatch(quoteAsset, amount, currentBalance);

        MarketFeeAccounting.CurveBuckets memory buckets = MarketFeeAccounting.splitCurve(amount);
        _lastCurveSweepNonces[marketId] = sweepNonce;
        CurveCreditRecord memory record;
        record.marketId = marketId;
        record.creatorEpoch = creatorEpoch;
        record.quoteAsset = quoteAsset;
        record.amount = amount;
        record.creatorAmount = buckets.creatorAmount;
        record.platformAmount = buckets.platformAmount;
        record.currentBalance = currentBalance;
        record.sourceVersion = sourceVersion;
        record.sweepNonce = sweepNonce;
        record.feeId = feeId;
        _recordExactCurveCredit(record);
        _consumeAndExitStandaloneCredit(feeId);
    }

    function _lastCurveSweepNonce(bytes32 marketId) internal view returns (uint64) {
        return _lastCurveSweepNonces[marketId];
    }

    function _recordExactCurveCredit(CurveCreditRecord memory record) internal virtual;
}
