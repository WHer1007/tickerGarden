// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    ActivationSlot,
    ActivationSnapshot,
    GaugeIdentity,
    IMarketController,
    IProtocolFeeVault,
    PositionView,
    RewardStateView
} from "../interfaces/IV2Protocol.sol";
import {MemeStockGaugeClone} from "../shared/MemeStockGaugeClone.sol";
import {MemeStockGaugeForfeitures} from "../shared/MemeStockGaugeForfeitures.sol";

/// @notice Per-market STOCK reward-weight ledger executed through an immutable-argument clone.
/// @dev The implementation has no market identity or mutable configuration. Each registered clone carries its
///      eight-word GaugeIdentity in deployed bytecode and owns independent reward and emergency storage.
contract MemeStockGauge is MemeStockGaugeForfeitures {
    bool private _emergencyDisabled;
    uint32 private _disabledRecoveryEpoch;
    uint64 private _disabledSnapshotBlock;
    bytes32 private _disabledStateHash;

    error UnauthorizedAllocationModule(address caller, address expected);
    error UnauthorizedFeeVault(address caller, address expected);
    error UnauthorizedSettlementCaller(address caller);
    error UnauthorizedMarketController(address caller, address expected);
    error StockAllocationClosed(bytes32 marketId);
    error UnsupportedRewardAsset(address feeAsset);
    error GaugeEmergencyDisabled(uint32 recoveryEpoch, uint64 snapshotBlock, bytes32 stateHash);
    error GaugeAlreadyEmergencyDisabled(uint32 recoveryEpoch, uint64 snapshotBlock, bytes32 stateHash);
    error InvalidEmergencySnapshot(uint32 recoveryEpoch, uint64 snapshotBlock, bytes32 stateHash);

    modifier whenOperational() {
        if (_emergencyDisabled) {
            revert GaugeEmergencyDisabled(_disabledRecoveryEpoch, _disabledSnapshotBlock, _disabledStateHash);
        }
        _;
    }

    function addPending(address user, uint256 amount, uint64 activationAt, uint64 unlockAt) external whenOperational {
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
        if (!IMarketController(identity.marketController).isStockAllocationOpen(identity.marketId)) {
            revert StockAllocationClosed(identity.marketId);
        }
    }

    function removeAllocation(address user, uint256 amount) external whenOperational {
        GaugeIdentity memory identity = MemeStockGaugeClone.read(address(this));
        if (msg.sender != identity.allocationManager) {
            revert UnauthorizedAllocationModule(msg.sender, identity.allocationManager);
        }
        _removeAllocation(
            user,
            amount,
            identity.marketId,
            _rewardStates[QUOTE_REWARD_INDEX].accFeePerShare,
            _rewardStates[MEME_REWARD_INDEX].accFeePerShare
        );
    }

    function rageQuit(address user)
        external
        whenOperational
        returns (uint256 principal, uint256 quoteForfeited, uint256 memeForfeited, bool redistributed)
    {
        GaugeIdentity memory identity = MemeStockGaugeClone.read(address(this));
        if (msg.sender != identity.allocationManager) {
            revert UnauthorizedAllocationModule(msg.sender, identity.allocationManager);
        }
        (principal, quoteForfeited, memeForfeited, redistributed) =
            _rageQuitPosition(user, identity.marketId, identity.quoteAsset, identity.memeToken);
        if (!redistributed && (quoteForfeited != 0 || memeForfeited != 0)) {
            IProtocolFeeVault(identity.protocolFeeVault)
                .recordForfeiture(identity.marketId, user, quoteForfeited, memeForfeited);
        }
    }

    function checkpointActivations()
        external
        whenOperational
        returns (uint256 activatedAmount, uint256 processedBuckets)
    {
        return _checkpointRewardActivations(MemeStockGaugeClone.read(address(this)).marketId);
    }

    function settle(address user) external whenOperational {
        GaugeIdentity memory identity = MemeStockGaugeClone.read(address(this));
        if (msg.sender != identity.allocationManager && msg.sender != identity.protocolFeeVault) {
            revert UnauthorizedSettlementCaller(msg.sender);
        }
        _settlePosition(user, identity.marketId);
    }

    function creditStakerFee(address feeAsset, uint256 amount, bytes32 feeId)
        external
        whenOperational
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

    function consumeClaimable(address user, address feeAsset) external whenOperational returns (uint256 amount) {
        GaugeIdentity memory identity = MemeStockGaugeClone.read(address(this));
        if (msg.sender != identity.protocolFeeVault) {
            revert UnauthorizedFeeVault(msg.sender, identity.protocolFeeVault);
        }
        GaugePosition storage position = _gaugePositions[user];
        if (position.activeAmount != 0 || position.pendingAmount != 0) {
            if (position.unlockAt == 0) revert InvalidPositionLock(user, position.unlockAt);
            if (block.timestamp < position.unlockAt) revert PositionLockedUntil(position.unlockAt);
        }
        _settlePosition(user, identity.marketId);
        return _consumeClaimable(user, _rewardIndex(feeAsset, identity));
    }

    function disableForEmergency(uint32 recoveryEpoch, uint64 snapshotBlock, bytes32 stateHash) external {
        GaugeIdentity memory identity = MemeStockGaugeClone.read(address(this));
        if (msg.sender != identity.marketController) {
            revert UnauthorizedMarketController(msg.sender, identity.marketController);
        }
        if (_emergencyDisabled) {
            revert GaugeAlreadyEmergencyDisabled(_disabledRecoveryEpoch, _disabledSnapshotBlock, _disabledStateHash);
        }
        if (
            recoveryEpoch == 0 || stateHash == bytes32(0) || block.number == 0 || block.number > type(uint64).max
                || snapshotBlock != uint64(block.number - 1)
        ) {
            revert InvalidEmergencySnapshot(recoveryEpoch, snapshotBlock, stateHash);
        }

        _emergencyDisabled = true;
        _disabledRecoveryEpoch = recoveryEpoch;
        _disabledSnapshotBlock = snapshotBlock;
        _disabledStateHash = stateHash;
    }

    function gaugeIdentity() external view returns (GaugeIdentity memory) {
        return MemeStockGaugeClone.read(address(this));
    }

    function positionOf(address user) external view returns (PositionView memory position) {
        MemeStockGaugeClone.requireInstance(address(this));
        GaugePosition storage stored = _gaugePositions[user];
        position = PositionView({
            activeAmount: stored.activeAmount,
            pendingAmount: stored.pendingAmount,
            pendingGeneration: stored.pendingGeneration,
            unlockAt: stored.unlockAt,
            quoteClaimable: _previewClaimable(user, QUOTE_REWARD_INDEX),
            memeClaimable: _previewClaimable(user, MEME_REWARD_INDEX)
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
        MemeStockGaugeClone.requireInstance(address(this));
        return _effectiveTotalActiveStock();
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

    function _rewardIndex(address feeAsset, GaugeIdentity memory identity) private pure returns (uint8) {
        if (feeAsset == identity.quoteAsset) return QUOTE_REWARD_INDEX;
        if (feeAsset == identity.memeToken) return MEME_REWARD_INDEX;
        revert UnsupportedRewardAsset(feeAsset);
    }
}
