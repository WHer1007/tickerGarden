// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ICreatorRevenueRegistry, MarketView} from "../interfaces/IV1Protocol.sol";
import {MarketFeeAccounting} from "../libraries/MarketFeeAccounting.sol";
import {ProtocolFeeVaultV4Credit} from "./ProtocolFeeVaultV4Credit.sol";

/// @notice Exact registered-Curve credit and creator-epoch binding for the eventual ProtocolFeeVault.
abstract contract ProtocolFeeVaultCurveCredit is ProtocolFeeVaultV4Credit {
    struct PendingCurveCredit {
        bytes32 marketId;
        uint32 creatorEpoch;
        address quoteAsset;
        uint256 amount;
        uint256 balanceBefore;
        uint32 sourceVersion;
        uint64 sweepNonce;
        bytes32 feeId;
        address source;
    }

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
    PendingCurveCredit private _pendingCurveCredit;

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

    /// @notice Starts an atomic balance-delta proof for a registered Curve fee sweep.
    /// @dev The canonical Curve immediately transfers the asset and finalizes in the same transaction. Keeping the
    ///      credit lock open between both calls prevents unrelated credits or claims from changing the observed balance.
    function beginCurveCredit(
        bytes32 marketId,
        address quoteAsset,
        uint256 amount,
        uint32 sourceVersion,
        uint64 sweepNonce,
        bytes32 feeId
    ) external {
        _enterStandaloneCredit(feeId);
        if (amount == 0 || amount > uint256(uint128(type(int128).max))) revert FeeAmountTooLarge(amount);

        PendingCurveCredit memory pending = PendingCurveCredit({
            marketId: marketId,
            creatorEpoch: 0,
            quoteAsset: quoteAsset,
            amount: amount,
            balanceBefore: 0,
            sourceVersion: sourceVersion,
            sweepNonce: sweepNonce,
            feeId: feeId,
            source: msg.sender
        });
        pending.creatorEpoch = _validateCurveCredit(pending);
        pending.balanceBefore = _assetBalance(quoteAsset);
        _pendingCurveCredit = pending;
    }

    /// @notice Finalizes a registered Curve sweep only when exactly `amount` arrived after `beginCurveCredit`.
    function finalizeCurveCredit(
        bytes32 marketId,
        address quoteAsset,
        uint256 amount,
        uint32 sourceVersion,
        uint64 sweepNonce,
        bytes32 feeId
    ) external payable {
        PendingCurveCredit memory pending = _pendingCurveCredit;
        if (
            pending.marketId != marketId || pending.quoteAsset != quoteAsset || pending.amount != amount
                || pending.sourceVersion != sourceVersion || pending.sweepNonce != sweepNonce || pending.feeId != feeId
                || pending.source != msg.sender
        ) revert FeeCreditNotPrepared(feeId);

        uint32 currentCreatorEpoch = _validateCurveCredit(pending);
        if (currentCreatorEpoch != pending.creatorEpoch) revert FeeCreditNotPrepared(feeId);
        if (quoteAsset == address(0)) {
            if (msg.value != amount) revert FeeBalanceDeltaMismatch(quoteAsset, amount, msg.value);
        } else if (msg.value != 0) {
            revert FeeBalanceDeltaMismatch(quoteAsset, 0, msg.value);
        }

        uint256 currentBalance = _assetBalance(quoteAsset);
        uint256 actualDelta =
            currentBalance >= pending.balanceBefore ? currentBalance - pending.balanceBefore : type(uint256).max;
        if (actualDelta != amount) revert FeeBalanceDeltaMismatch(quoteAsset, amount, actualDelta);

        MarketFeeAccounting.CurveBuckets memory buckets = MarketFeeAccounting.splitCurve(amount);
        _lastCurveSweepNonces[marketId] = sweepNonce;
        CurveCreditRecord memory record;
        record.marketId = marketId;
        record.creatorEpoch = pending.creatorEpoch;
        record.quoteAsset = quoteAsset;
        record.amount = amount;
        record.creatorAmount = buckets.creatorAmount;
        record.platformAmount = buckets.platformAmount;
        record.currentBalance = currentBalance;
        record.sourceVersion = sourceVersion;
        record.sweepNonce = sweepNonce;
        record.feeId = feeId;
        _recordExactCurveCredit(record);
        delete _pendingCurveCredit;
        _consumeAndExitStandaloneCredit(feeId);
    }

    function _validateCurveCredit(PendingCurveCredit memory pending) private view returns (uint32 creatorEpoch) {
        MarketView memory value = _feeMarketRegistry.market(pending.marketId);
        if (value.config.curve != pending.source) {
            revert UnauthorizedMarketCurve(pending.source, value.config.curve);
        }
        if (
            value.runtime.launchPhase != LAUNCH_PHASE_NOT_GRADUATED
                || value.runtime.sourceVersion != pending.sourceVersion
        ) revert CurveFeeSweepAfterClose(pending.marketId);
        if (pending.quoteAsset != value.config.quoteAsset) revert FeeAssetNotCanonical(pending.quoteAsset);

        bytes32 expectedFeeId = keccak256(
            abi.encode(
                CURVE_SWEEP_DOMAIN,
                CURVE_SWEEP_SCHEMA_VERSION,
                block.chainid,
                address(this),
                pending.source,
                pending.marketId,
                pending.sourceVersion,
                pending.sweepNonce,
                pending.quoteAsset,
                pending.amount
            )
        );
        uint64 expectedNonce = _lastCurveSweepNonces[pending.marketId] + 1;
        if (pending.feeId != expectedFeeId || pending.sweepNonce != expectedNonce) {
            revert FeeCreditNotPrepared(pending.feeId);
        }

        creatorEpoch = _feeCreatorRevenueRegistry.currentCreatorEpoch(pending.marketId);
        if (
            creatorEpoch == 0
                || _feeCreatorRevenueRegistry.creatorBeneficiaryAt(pending.marketId, creatorEpoch) == address(0)
        ) revert CreatorEpochUnavailable(pending.marketId, creatorEpoch);
    }

    function _lastCurveSweepNonce(bytes32 marketId) internal view returns (uint64) {
        return _lastCurveSweepNonces[marketId];
    }

    function _recordExactCurveCredit(CurveCreditRecord memory record) internal virtual;
}
