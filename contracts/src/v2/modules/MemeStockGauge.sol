// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    ActivationSlot,
    ActivationSnapshot,
    IMarketController,
    PositionView,
    RewardStateView
} from "../interfaces/IV2Protocol.sol";
import {MemeStockGaugeSettlements} from "../shared/MemeStockGaugeSettlements.sol";

struct MemeStockGaugeInit {
    bytes32 marketId;
    bytes32 assetUid;
    bytes32 quoteAssetConfigId;
    address allocationManager;
    address protocolFeeVault;
    address marketController;
    address quoteAsset;
    address memeToken;
}

/// @notice Immutable per-market STOCK reward-weight ledger for canonical Quote and Meme fees.
contract MemeStockGauge is MemeStockGaugeSettlements {
    bytes32 private immutable _marketId;
    bytes32 private immutable _assetUid;
    bytes32 private immutable _quoteAssetConfigId;
    address private immutable _allocationManager;
    address private immutable _protocolFeeVault;
    address private immutable _marketController;
    address private immutable _quoteAsset;
    address private immutable _memeToken;

    bool private _emergencyDisabled;
    uint32 private _disabledRecoveryEpoch;
    uint64 private _disabledSnapshotBlock;
    bytes32 private _disabledStateHash;

    error InvalidGaugeIdentity(
        bytes32 marketId, bytes32 assetUid, bytes32 quoteAssetConfigId, address quoteAsset, address memeToken
    );
    error InvalidGaugeDependencies(address allocationManager, address protocolFeeVault, address marketController);
    error UnauthorizedAllocationModule(address caller, address expected);
    error UnauthorizedFeeVault(address caller, address expected);
    error UnauthorizedSettlementCaller(address caller);
    error UnauthorizedMarketController(address caller, address expected);
    error StockAllocationClosed(bytes32 marketId);
    error UnsupportedRewardAsset(address feeAsset);
    error GaugeEmergencyDisabled(uint32 recoveryEpoch, uint64 snapshotBlock, bytes32 stateHash);
    error GaugeAlreadyEmergencyDisabled(uint32 recoveryEpoch, uint64 snapshotBlock, bytes32 stateHash);
    error InvalidEmergencySnapshot(uint32 recoveryEpoch, uint64 snapshotBlock, bytes32 stateHash);

    constructor(MemeStockGaugeInit memory init) {
        if (
            init.marketId == bytes32(0) || init.assetUid == bytes32(0) || init.quoteAssetConfigId == bytes32(0)
                || init.memeToken.code.length == 0 || init.quoteAsset == init.memeToken
                || (init.quoteAsset != address(0) && init.quoteAsset.code.length == 0)
        ) {
            revert InvalidGaugeIdentity(
                init.marketId, init.assetUid, init.quoteAssetConfigId, init.quoteAsset, init.memeToken
            );
        }
        if (
            init.allocationManager.code.length == 0 || init.protocolFeeVault.code.length == 0
                || init.marketController.code.length == 0 || init.allocationManager == init.protocolFeeVault
                || init.allocationManager == init.marketController || init.protocolFeeVault == init.marketController
                || init.allocationManager == init.memeToken || init.protocolFeeVault == init.memeToken
                || init.marketController == init.memeToken || init.allocationManager == init.quoteAsset
                || init.protocolFeeVault == init.quoteAsset || init.marketController == init.quoteAsset
        ) {
            revert InvalidGaugeDependencies(init.allocationManager, init.protocolFeeVault, init.marketController);
        }

        _marketId = init.marketId;
        _assetUid = init.assetUid;
        _quoteAssetConfigId = init.quoteAssetConfigId;
        _allocationManager = init.allocationManager;
        _protocolFeeVault = init.protocolFeeVault;
        _marketController = init.marketController;
        _quoteAsset = init.quoteAsset;
        _memeToken = init.memeToken;
    }

    modifier onlyAllocationModule() {
        if (msg.sender != _allocationManager) {
            revert UnauthorizedAllocationModule(msg.sender, _allocationManager);
        }
        _;
    }

    modifier onlyFeeVault() {
        if (msg.sender != _protocolFeeVault) revert UnauthorizedFeeVault(msg.sender, _protocolFeeVault);
        _;
    }

    modifier whenOperational() {
        if (_emergencyDisabled) {
            revert GaugeEmergencyDisabled(_disabledRecoveryEpoch, _disabledSnapshotBlock, _disabledStateHash);
        }
        _;
    }

    function addPending(address user, uint256 amount, uint64 activationAt, uint64 unlockAt)
        external
        onlyAllocationModule
        whenOperational
    {
        _addPending(
            user,
            amount,
            activationAt,
            unlockAt,
            _marketId,
            _rewardStates[QUOTE_REWARD_INDEX].accFeePerShare,
            _rewardStates[MEME_REWARD_INDEX].accFeePerShare
        );
        if (!IMarketController(_marketController).isStockAllocationOpen(_marketId)) {
            revert StockAllocationClosed(_marketId);
        }
    }

    function removeAllocation(address user, uint256 amount) external onlyAllocationModule whenOperational {
        _removeAllocation(
            user,
            amount,
            _marketId,
            _rewardStates[QUOTE_REWARD_INDEX].accFeePerShare,
            _rewardStates[MEME_REWARD_INDEX].accFeePerShare
        );
    }

    function checkpointActivations()
        external
        whenOperational
        returns (uint256 activatedAmount, uint256 processedBuckets)
    {
        return _checkpointRewardActivations(_marketId);
    }

    function settle(address user) external whenOperational {
        if (msg.sender != _allocationManager && msg.sender != _protocolFeeVault) {
            revert UnauthorizedSettlementCaller(msg.sender);
        }
        _settlePosition(user, _marketId);
    }

    function creditStakerFee(address feeAsset, uint256 amount, bytes32 feeId)
        external
        onlyFeeVault
        whenOperational
        returns (uint256 accumulatorDelta, uint256 indexRemainder)
    {
        _checkpointRewardActivations(_marketId);
        uint8 rewardIndex = _rewardIndex(feeAsset);
        return _applyStakerFee(rewardIndex, feeAsset, amount, feeId, _marketId);
    }

    function consumeClaimable(address user, address feeAsset)
        external
        onlyFeeVault
        whenOperational
        returns (uint256 amount)
    {
        _settlePosition(user, _marketId);
        return _consumeClaimable(user, _rewardIndex(feeAsset));
    }

    function disableForEmergency(uint32 recoveryEpoch, uint64 snapshotBlock, bytes32 stateHash) external {
        if (msg.sender != _marketController) {
            revert UnauthorizedMarketController(msg.sender, _marketController);
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

    function positionOf(address user) external view returns (PositionView memory position) {
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
        GaugeRewardState storage state = _rewardStates[_rewardIndex(feeAsset)];
        result = RewardStateView({accFeePerShare: state.accFeePerShare, indexRemainder: state.indexRemainder});
    }

    function storedTotalActiveStock() external view returns (uint256) {
        return _storedTotalActiveStock;
    }

    function effectiveTotalActiveStock() external view returns (uint256) {
        return _effectiveTotalActiveStock();
    }

    function totalPendingStock() external view returns (uint256) {
        return _totalPendingStock;
    }

    function activationSlot(uint8 index) external view returns (ActivationSlot memory) {
        return _activationSlot(index);
    }

    function activationSnapshot(uint64 generation) external view returns (ActivationSnapshot memory) {
        return _activationSnapshot(generation);
    }

    function _rewardIndex(address feeAsset) private view returns (uint8) {
        if (feeAsset == _quoteAsset) return QUOTE_REWARD_INDEX;
        if (feeAsset == _memeToken) return MEME_REWARD_INDEX;
        revert UnsupportedRewardAsset(feeAsset);
    }
}
