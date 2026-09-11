// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IMarketRegistryV1, MarketView} from "../interfaces/IV1Protocol.sol";

/// @notice Atomic begin/finalize balance proof shared by the eventual ProtocolFeeVault product module.
/// @dev A canonical Hook must execute both calls in the same PoolManager unlock transaction. Any later failure
///      therefore rolls the pending record, asset transfer, fee-id consumption and downstream accounting back.
abstract contract ProtocolFeeVaultV4Credit {
    uint8 private constant CREDIT_IDLE = 0;
    uint8 private constant CREDIT_PENDING = 1;
    uint8 private constant CREDIT_FINALIZING = 2;
    uint8 private constant LAUNCH_PHASE_POOL_CREATED = 1;

    struct PendingV4Credit {
        bytes32 marketId;
        address feeAsset;
        uint256 amount;
        uint256 balanceBefore;
        uint32 sourceVersion;
        bytes32 feeId;
        address source;
    }

    struct V4CreditRecord {
        bytes32 marketId;
        address feeAsset;
        uint256 base;
        uint256 totalFee;
        uint256 lpAmount;
        uint256 nonLpAmount;
        uint32 sourceVersion;
        uint64 feeNonce;
        bytes32 feeId;
    }

    IMarketRegistryV1 internal immutable _feeMarketRegistry;
    address internal immutable _feePoolManager;

    uint8 internal _creditState;
    PendingV4Credit internal _pendingCredit;
    mapping(bytes32 feeId => bool consumed) internal _consumedFeeIds;

    error InvalidFeeVaultCreditDependency(address dependency);
    error InactiveFeeSource(bytes32 marketId, uint32 sourceVersion);
    error FeeAmountTooLarge(uint256 amount);
    error FeeAssetNotCanonical(address feeAsset);
    error FeeIdAlreadyConsumed(bytes32 feeId);
    error FeeCreditNotPrepared(bytes32 feeId);
    error FeeBalanceDeltaMismatch(address feeAsset, uint256 expected, uint256 actual);
    error FeeAssetBalanceUnavailable(address feeAsset);

    constructor(address marketRegistry_, address poolManager_) {
        if (marketRegistry_.code.length == 0 || poolManager_.code.length == 0 || marketRegistry_ == poolManager_) {
            revert InvalidFeeVaultCreditDependency(marketRegistry_.code.length == 0 ? marketRegistry_ : poolManager_);
        }
        _feeMarketRegistry = IMarketRegistryV1(marketRegistry_);
        _feePoolManager = poolManager_;
    }

    function beginV4Credit(bytes32 marketId, address feeAsset, uint256 amount, uint32 sourceVersion, bytes32 feeId)
        external
    {
        if (_creditState != CREDIT_IDLE || feeId == bytes32(0)) revert FeeCreditNotPrepared(feeId);
        if (amount == 0 || amount > uint256(uint128(type(int128).max))) revert FeeAmountTooLarge(amount);
        if (_consumedFeeIds[feeId]) revert FeeIdAlreadyConsumed(feeId);

        _requireActiveV4Source(marketId, feeAsset, sourceVersion, msg.sender);
        _pendingCredit = PendingV4Credit({
            marketId: marketId,
            feeAsset: feeAsset,
            amount: amount,
            balanceBefore: _assetBalance(feeAsset),
            sourceVersion: sourceVersion,
            feeId: feeId,
            source: msg.sender
        });
        _creditState = CREDIT_PENDING;
    }

    function finalizeV4Credit(
        bytes32 marketId,
        address feeAsset,
        uint256 base,
        uint256 totalFee,
        uint256 lpAmount,
        uint256 nonLpAmount,
        uint64 feeNonce,
        bytes32 feeId
    ) external {
        PendingV4Credit memory pending = _pendingCredit;
        if (
            _creditState != CREDIT_PENDING || pending.marketId != marketId || pending.feeAsset != feeAsset
                || pending.amount != nonLpAmount || pending.feeId != feeId || pending.source != msg.sender
        ) {
            revert FeeCreditNotPrepared(feeId);
        }
        if (_consumedFeeIds[feeId]) revert FeeIdAlreadyConsumed(feeId);
        // Revalidate after the external transfer, then reuse this view only within finalization.
        MarketView memory value = _requireActiveV4Source(marketId, feeAsset, pending.sourceVersion, msg.sender);

        uint256 currentBalance = _assetBalance(feeAsset);
        uint256 actualDelta = currentBalance >= pending.balanceBefore ? currentBalance - pending.balanceBefore : 0;
        if (actualDelta != pending.amount) {
            revert FeeBalanceDeltaMismatch(feeAsset, pending.amount, actualDelta);
        }

        _creditState = CREDIT_FINALIZING;
        _consumedFeeIds[feeId] = true;
        V4CreditRecord memory record;
        record.marketId = marketId;
        record.feeAsset = feeAsset;
        record.base = base;
        record.totalFee = totalFee;
        record.lpAmount = lpAmount;
        record.nonLpAmount = nonLpAmount;
        record.sourceVersion = pending.sourceVersion;
        record.feeNonce = feeNonce;
        record.feeId = feeId;
        _recordExactV4Credit(record, value);
        delete _pendingCredit;
        _creditState = CREDIT_IDLE;
    }

    function _isRewardSettlementPayment() internal view virtual returns (bool) {
        return false;
    }

    receive() external payable {
        if (_isRewardSettlementPayment()) return;
        PendingV4Credit memory pending = _pendingCredit;
        if (
            _creditState != CREDIT_PENDING || pending.feeAsset != address(0) || msg.sender != _feePoolManager
                || msg.value != pending.amount
        ) {
            revert FeeCreditNotPrepared(pending.feeId);
        }
    }

    function _recordExactV4Credit(V4CreditRecord memory record, MarketView memory value) internal virtual;

    function _enterStandaloneCredit(bytes32 feeId) internal {
        if (feeId == bytes32(0)) revert FeeCreditNotPrepared(feeId);
        if (_consumedFeeIds[feeId]) revert FeeIdAlreadyConsumed(feeId);
        _enterStandaloneOperation(feeId);
    }

    function _enterStandaloneOperation(bytes32 operationId) internal {
        if (_creditState != CREDIT_IDLE) revert FeeCreditNotPrepared(operationId);
        _creditState = CREDIT_FINALIZING;
    }

    function _consumeAndExitStandaloneCredit(bytes32 feeId) internal {
        _consumedFeeIds[feeId] = true;
        _exitStandaloneOperation();
    }

    function _exitStandaloneOperation() internal {
        _creditState = CREDIT_IDLE;
    }

    function _requireActiveV4Source(bytes32 marketId, address feeAsset, uint32 sourceVersion, address source)
        private
        view
        returns (MarketView memory value)
    {
        value = _feeMarketRegistry.market(marketId);
        if (
            value.runtime.launchPhase != LAUNCH_PHASE_POOL_CREATED || value.runtime.poolId == bytes32(0)
                || value.runtime.sourceVersion != sourceVersion || value.config.graduatedHook != source
        ) {
            revert InactiveFeeSource(marketId, sourceVersion);
        }
        if (feeAsset != value.config.quoteAsset && feeAsset != value.config.memeToken) {
            revert FeeAssetNotCanonical(feeAsset);
        }
    }

    function _assetBalance(address feeAsset) internal view returns (uint256 balance) {
        if (feeAsset == address(0)) return address(this).balance;
        (bool success, bytes memory result) =
            feeAsset.staticcall(abi.encodeWithSignature("balanceOf(address)", address(this)));
        if (!success || result.length != 32) revert FeeAssetBalanceUnavailable(feeAsset);
        balance = abi.decode(result, (uint256));
    }
}
