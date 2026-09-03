// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ActivationSnapshot} from "../interfaces/IV2Protocol.sol";
import {MemeStockGaugeActivationWheel} from "./MemeStockGaugeActivationWheel.sol";

/// @notice Absolute-generation snapshots and lazy user materialization for MemeStockGauge.
/// @dev Concrete reward arithmetic is supplied by the dual-asset accumulator layer.
abstract contract MemeStockGaugeActivationSnapshots is MemeStockGaugeActivationWheel {
    struct GaugeUserReward {
        uint256 accumulatorPaid;
        uint256 pendingFee;
        uint256 userRemainder;
    }

    struct GaugePosition {
        uint256 activeAmount;
        uint256 pendingAmount;
        uint64 pendingGeneration;
        uint64 unlockAt;
        GaugeUserReward[2] rewards;
    }

    mapping(uint64 generation => ActivationSnapshot snapshot) internal _activationSnapshots;
    mapping(address user => GaugePosition position) internal _gaugePositions;

    event ActivationBucketProcessed(
        bytes32 indexed marketId,
        uint64 indexed generation,
        uint256 amount,
        uint256 quoteAccumulator,
        uint256 memeAccumulator,
        uint256 refs
    );
    event PendingMaterialized(
        address indexed user, bytes32 indexed marketId, uint64 indexed generation, uint256 amount
    );

    error ActivationSnapshotAlreadyProcessed(uint64 generation);
    error InvalidActivationSnapshot(uint64 generation, uint256 refs, bool processed);
    error InvalidGaugePosition(address user, uint256 pendingAmount, uint64 pendingGeneration);

    function _recordActivationSnapshot(
        bytes32 marketId,
        uint64 generation,
        uint256 amount,
        uint256 quoteAccumulator,
        uint256 memeAccumulator,
        uint256 refs
    ) internal virtual override {
        ActivationSnapshot storage existing = _activationSnapshots[generation];
        if (existing.processed || existing.quoteAccumulator != 0 || existing.memeAccumulator != 0 || existing.refs != 0)
        {
            revert ActivationSnapshotAlreadyProcessed(generation);
        }

        _activationSnapshots[generation] = ActivationSnapshot({
            quoteAccumulator: quoteAccumulator, memeAccumulator: memeAccumulator, refs: refs, processed: true
        });
        emit ActivationBucketProcessed(marketId, generation, amount, quoteAccumulator, memeAccumulator, refs);
    }

    function _materializePending(
        address user,
        bytes32 marketId,
        uint256 currentQuoteAccumulator,
        uint256 currentMemeAccumulator
    ) internal returns (uint256 amount, uint64 generation, bool materialized) {
        GaugePosition storage position = _gaugePositions[user];
        amount = position.pendingAmount;
        generation = position.pendingGeneration;

        if (amount == 0) {
            if (generation != 0) revert InvalidGaugePosition(user, amount, generation);
            return (0, 0, false);
        }
        if (generation == 0) revert InvalidGaugePosition(user, amount, generation);

        ActivationSnapshot memory snapshot = _activationSnapshots[generation];
        if (!snapshot.processed) {
            if (generation <= block.timestamp) revert PendingGenerationNotFound(generation);
            return (amount, generation, false);
        }
        if (snapshot.refs == 0) {
            revert InvalidActivationSnapshot(generation, snapshot.refs, snapshot.processed);
        }

        _settleMaterializingPosition(user, position, snapshot, currentQuoteAccumulator, currentMemeAccumulator);

        position.activeAmount += amount;
        position.pendingAmount = 0;
        position.pendingGeneration = 0;

        if (snapshot.refs == 1) {
            delete _activationSnapshots[generation];
        } else {
            _activationSnapshots[generation].refs = snapshot.refs - 1;
        }

        emit PendingMaterialized(user, marketId, generation, amount);
        return (amount, generation, true);
    }

    function _activationSnapshot(uint64 generation) internal view returns (ActivationSnapshot memory) {
        return _activationSnapshots[generation];
    }

    function _effectiveUserActiveStock(address user) internal view returns (uint256 amount) {
        GaugePosition storage position = _gaugePositions[user];
        amount = position.activeAmount;
        if (position.pendingAmount != 0 && _activationSnapshots[position.pendingGeneration].processed) {
            amount += position.pendingAmount;
        }
    }

    /// @dev Must settle old active weight from its paid indices and pending weight from snapshot indices,
    ///      then advance both paid indices to the supplied current accumulators.
    function _settleMaterializingPosition(
        address user,
        GaugePosition storage position,
        ActivationSnapshot memory snapshot,
        uint256 currentQuoteAccumulator,
        uint256 currentMemeAccumulator
    ) internal virtual;
}
