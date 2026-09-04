// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    ActivationSlot,
    ActivationSnapshot,
    GaugeIdentity,
    IAllocationManager,
    IProtocolFeeVault,
    PositionView,
    RewardStateView
} from "../interfaces/IV1Protocol.sol";
import {MemeStockGaugeClone} from "../shared/MemeStockGaugeClone.sol";
import {MemeStockGaugeForfeitures} from "../shared/MemeStockGaugeForfeitures.sol";

/// @notice Per-market STOCK reward-weight ledger executed through an immutable-argument clone.
/// @dev The implementation has no market identity or mutable configuration. Each registered clone carries its
///      seven-word GaugeIdentity in deployed bytecode and owns independent reward storage.
contract MemeStockGauge is MemeStockGaugeForfeitures {
    uint256 private constant FORFEITURE_RECORD_GAS_LIMIT = 500_000;

    uint256 private _deferredQuoteForfeiture;
    uint256 private _deferredMemeForfeiture;

    error UnauthorizedAllocationModule(address caller, address expected);
    error UnauthorizedFeeVault(address caller, address expected);
    error UnauthorizedSettlementCaller(address caller);
    error UnsupportedRewardAsset(address feeAsset);
    error InvalidGaugeMarketId(bytes32 supplied, bytes32 expected);
    error RageQuitRewardSettlementPending(address user, bytes32 marketId, uint256 principal);

    event ForfeitureRecordDeferred(
        bytes32 indexed marketId,
        address indexed user,
        uint256 quoteAmount,
        uint256 memeAmount,
        uint256 totalDeferredQuote,
        uint256 totalDeferredMeme
    );
    event ForfeitureRecordFlushed(bytes32 indexed marketId, uint256 quoteAmount, uint256 memeAmount);

    function addPending(address user, uint256 amount, uint64 activationAt, uint64 unlockAt) external {
        GaugeIdentity memory identity = MemeStockGaugeClone.read(address(this));
        if (msg.sender != identity.allocationManager) {
            revert UnauthorizedAllocationModule(msg.sender, identity.allocationManager);
        }
        _addPending(
            user,
            amount,
            activationAt,
            unlockAt,
            identity.marketId,
            _rewardStates[QUOTE_REWARD_INDEX].accFeePerShare,
            _rewardStates[MEME_REWARD_INDEX].accFeePerShare
        );
    }

    function removeAllocation(address user) external returns (uint256 amount) {
        GaugeIdentity memory identity = MemeStockGaugeClone.read(address(this));
        if (msg.sender != identity.allocationManager) {
            revert UnauthorizedAllocationModule(msg.sender, identity.allocationManager);
        }
        amount = _removeAllocation(
            user,
            identity.marketId,
            _rewardStates[QUOTE_REWARD_INDEX].accFeePerShare,
            _rewardStates[MEME_REWARD_INDEX].accFeePerShare
        );
    }

    function rageQuit(address user)
        external
        returns (uint256 principal, uint256 quoteForfeited, uint256 memeForfeited, bool redistributed)
    {
        GaugeIdentity memory identity = MemeStockGaugeClone.read(address(this));
        if (msg.sender != identity.allocationManager) {
            revert UnauthorizedAllocationModule(msg.sender, identity.allocationManager);
        }
        (
            uint256 expectedPrincipal,
            uint256 quoteAccumulatorCutoff,
            uint256 memeAccumulatorCutoff,
            /* forfeitureRedistributable */
        ) = IAllocationManager(identity.allocationManager).rageQuitRewardCutoff(identity.marketId, user);
        (principal, quoteForfeited, memeForfeited, redistributed) = _rageQuitPosition(
            user,
            RageQuitContext({
                marketId: identity.marketId,
                quoteAccumulatorCutoff: quoteAccumulatorCutoff,
                memeAccumulatorCutoff: memeAccumulatorCutoff
            })
        );
        if (principal != expectedPrincipal) {
            revert RageQuitRewardSettlementPending(user, identity.marketId, expectedPrincipal);
        }
        // Every reward forfeited by an escape is platform-owned.  The FeeVault call is best-effort so a
        // temporary downstream failure cannot roll back the principal escape; the deferred amounts are retried
        // through checkpointActivations/flushDeferredForfeiture and remain unavailable to any staker.
        if (quoteForfeited != 0 || memeForfeited != 0) {
            try IProtocolFeeVault(identity.protocolFeeVault).recordForfeiture{gas: FORFEITURE_RECORD_GAS_LIMIT}(
                identity.marketId, user, quoteForfeited, memeForfeited
            ) {}
            catch {
                _deferredQuoteForfeiture += quoteForfeited;
                _deferredMemeForfeiture += memeForfeited;
                emit ForfeitureRecordDeferred(
                    identity.marketId,
                    user,
                    quoteForfeited,
                    memeForfeited,
                    _deferredQuoteForfeiture,
                    _deferredMemeForfeiture
                );
            }
        }
    }

    function checkpointActivations() external returns (uint256 activatedAmount, uint256 processedBuckets) {
        GaugeIdentity memory identity = MemeStockGaugeClone.read(address(this));
        (activatedAmount, processedBuckets) = _checkpointRewardActivations(identity.marketId);
        _tryFlushDeferredForfeiture(identity);
    }

    function settle(address user) external {
        GaugeIdentity memory identity = MemeStockGaugeClone.read(address(this));
        if (msg.sender != identity.allocationManager && msg.sender != identity.protocolFeeVault) {
            revert UnauthorizedSettlementCaller(msg.sender);
        }
        _requireNoRageQuitSettlement(identity, user);
        _settlePosition(user, identity.marketId);
    }

    function creditStakerFee(address feeAsset, uint256 amount, bytes32 feeId)
        external
        returns (uint256 accumulatorDelta, uint256 indexRemainder)
    {
        GaugeIdentity memory identity = MemeStockGaugeClone.read(address(this));
        if (msg.sender != identity.protocolFeeVault) {
            revert UnauthorizedFeeVault(msg.sender, identity.protocolFeeVault);
        }
        _checkpointRewardActivations(identity.marketId);
        uint8 rewardIndex = _rewardIndex(feeAsset, identity);
        return _applyStakerFee(rewardIndex, feeAsset, amount, feeId, identity.marketId);
    }

    function consumeClaimable(address user, address feeAsset) external returns (uint256 amount) {
        GaugeIdentity memory identity = MemeStockGaugeClone.read(address(this));
        if (msg.sender != identity.protocolFeeVault) {
            revert UnauthorizedFeeVault(msg.sender, identity.protocolFeeVault);
        }
        _requireNoRageQuitSettlement(identity, user);
        GaugePosition storage position = _gaugePositions[user];
        if (position.activeAmount != 0 || position.pendingAmount != 0) {
            if (position.unlockAt == 0) revert InvalidPositionLock(user, position.unlockAt);
            if (block.timestamp < position.unlockAt) revert PositionLockedUntil(position.unlockAt);
        }
        _settlePosition(user, identity.marketId);
        return _consumeClaimable(user, _rewardIndex(feeAsset, identity));
    }

    function _requireNoRageQuitSettlement(GaugeIdentity memory identity, address user) private view {
        (bool pending, uint256 principal) =
            IAllocationManager(identity.allocationManager).rageQuitSettlementPending(identity.marketId, user);
        if (pending) revert RageQuitRewardSettlementPending(user, identity.marketId, principal);
    }

    function gaugeIdentity() external view returns (GaugeIdentity memory) {
        return MemeStockGaugeClone.read(address(this));
    }

    function positionOf(address user) external view returns (PositionView memory position) {
        GaugeIdentity memory identity = MemeStockGaugeClone.read(address(this));
        GaugePosition storage stored = _gaugePositions[user];
        (uint256 rageQuitPrincipal, uint256 quoteAccumulatorCutoff, uint256 memeAccumulatorCutoff,) =
            IAllocationManager(identity.allocationManager).rageQuitRewardCutoff(identity.marketId, user);
        uint256 quoteClaimable = rageQuitPrincipal == 0
            ? _previewClaimable(user, QUOTE_REWARD_INDEX)
            : _previewClaimableAt(user, QUOTE_REWARD_INDEX, quoteAccumulatorCutoff);
        uint256 memeClaimable = rageQuitPrincipal == 0
            ? _previewClaimable(user, MEME_REWARD_INDEX)
            : _previewClaimableAt(user, MEME_REWARD_INDEX, memeAccumulatorCutoff);
        position = PositionView({
            activeAmount: stored.activeAmount,
            pendingAmount: stored.pendingAmount,
            pendingGeneration: stored.pendingGeneration,
            unlockAt: stored.unlockAt,
            quoteClaimable: quoteClaimable,
            memeClaimable: memeClaimable
        });
    }

    function rewardState(address feeAsset) external view returns (RewardStateView memory result) {
        GaugeIdentity memory identity = MemeStockGaugeClone.read(address(this));
        GaugeRewardState storage state = _rewardStates[_rewardIndex(feeAsset, identity)];
        result = RewardStateView({accFeePerShare: state.accFeePerShare, indexRemainder: state.indexRemainder});
    }

    function storedTotalActiveStock() external view returns (uint256) {
        MemeStockGaugeClone.requireInstance(address(this));
        return _storedTotalActiveStock;
    }

    function effectiveTotalActiveStock() external view returns (uint256) {
        GaugeIdentity memory identity = MemeStockGaugeClone.read(address(this));
        return IAllocationManager(identity.allocationManager).rewardEligibleActiveStock(identity.marketId);
    }

    function totalPendingStock() external view returns (uint256) {
        MemeStockGaugeClone.requireInstance(address(this));
        return _totalPendingStock;
    }

    function activationSlot(uint8 index) external view returns (ActivationSlot memory) {
        MemeStockGaugeClone.requireInstance(address(this));
        return _activationSlot(index);
    }

    function activationSnapshot(uint64 generation) external view returns (ActivationSnapshot memory) {
        MemeStockGaugeClone.requireInstance(address(this));
        return _activationSnapshot(generation);
    }

    /// @notice Forfeited rewards awaiting a successful permissionless FeeVault reserve flush.
    function deferredForfeiture() external view returns (uint256 quoteAmount, uint256 memeAmount) {
        MemeStockGaugeClone.requireInstance(address(this));
        return (_deferredQuoteForfeiture, _deferredMemeForfeiture);
    }

    /// @notice Permissionless retry for platform-reserve accounting. It never changes user principal or restores
    ///         forfeited rewards.
    function flushDeferredForfeiture() external {
        GaugeIdentity memory identity = MemeStockGaugeClone.read(address(this));
        _tryFlushDeferredForfeiture(identity);
    }

    function _rewardIndex(address feeAsset, GaugeIdentity memory identity) private pure returns (uint8) {
        if (feeAsset == identity.quoteAsset) return QUOTE_REWARD_INDEX;
        if (feeAsset == identity.memeToken) return MEME_REWARD_INDEX;
        revert UnsupportedRewardAsset(feeAsset);
    }

    function _tryFlushDeferredForfeiture(GaugeIdentity memory identity) private {
        uint256 quoteAmount = _deferredQuoteForfeiture;
        uint256 memeAmount = _deferredMemeForfeiture;
        if (quoteAmount == 0 && memeAmount == 0) return;

        // Checks-effects-interactions: a future FeeVault implementation must not be able to re-enter a public
        // checkpoint and record the same deferred amount twice. A failed call restores the exact pending values.
        _deferredQuoteForfeiture = 0;
        _deferredMemeForfeiture = 0;
        try IProtocolFeeVault(identity.protocolFeeVault).recordForfeiture{gas: FORFEITURE_RECORD_GAS_LIMIT}(
            identity.marketId, address(this), quoteAmount, memeAmount
        ) {
            emit ForfeitureRecordFlushed(identity.marketId, quoteAmount, memeAmount);
        } catch {
            _deferredQuoteForfeiture += quoteAmount;
            _deferredMemeForfeiture += memeAmount;
        }
    }

    function _rewardEligibleActiveStock(bytes32 marketId) internal view override returns (uint256) {
        GaugeIdentity memory identity = MemeStockGaugeClone.read(address(this));
        if (identity.marketId != marketId) revert InvalidGaugeMarketId(marketId, identity.marketId);
        return IAllocationManager(identity.allocationManager).rewardEligibleActiveStock(marketId);
    }

    function _afterRewardAccumulatorUpdate(bytes32 marketId) internal override {
        GaugeIdentity memory identity = MemeStockGaugeClone.read(address(this));
        if (identity.marketId != marketId) revert InvalidGaugeMarketId(marketId, identity.marketId);
        IAllocationManager(identity.allocationManager)
            .recordGaugeRewardState(
                marketId,
                _rewardStates[QUOTE_REWARD_INDEX].accFeePerShare,
                _rewardStates[MEME_REWARD_INDEX].accFeePerShare
            );
    }
}
