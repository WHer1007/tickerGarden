// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPonsBaselineRegistry, PonsBaseline} from "../interfaces/IV1Protocol.sol";
import {DelayedUnpause} from "../shared/DelayedUnpause.sol";
import {ImmutableAccessManaged} from "../shared/ImmutableAccessManaged.sol";

/// @notice Append-only snapshots of independently verified Pons behavior baselines.
contract PonsBaselineRegistry is IPonsBaselineRegistry, ImmutableAccessManaged, DelayedUnpause {
    uint8 internal constant BASELINE_STATUS_UNSET = 0;
    uint8 internal constant BASELINE_STATUS_ACTIVE = 1;
    uint8 internal constant BASELINE_STATUS_PAUSED = 2;
    uint8 internal constant BASELINE_STATUS_RETIRED = 3;
    uint256 internal constant BPS_DENOMINATOR = 10_000;

    mapping(bytes32 baselineId => PonsBaseline value) private _baselines;

    error InvalidPonsBaseline(bytes32 baselineId);
    error PonsBaselineAlreadyExists(bytes32 baselineId);
    error ReferenceFactoryCodeHashMismatch(address factory, bytes32 suppliedHash, bytes32 observedHash);
    error InvalidStateTransition(uint8 currentState, uint8 requestedState);

    constructor(address authority_) ImmutableAccessManaged(authority_) {}

    function addBaseline(bytes32 baselineId, PonsBaseline calldata value) external override restricted {
        if (
            baselineId == bytes32(0) || value.referenceChainId == 0 || value.referenceFactory == address(0)
                || value.referenceFactoryCodeHash == bytes32(0) || value.supply == 0
                || value.curveFeeBps >= BPS_DENOMINATOR || value.poolFee != 0 || value.tickSpacing < 1
                || value.tickSpacing > 32_767 || value.behaviorVectorRoot == bytes32(0)
                || value.status != BASELINE_STATUS_ACTIVE
        ) revert InvalidPonsBaseline(baselineId);
        if (_baselines[baselineId].status != BASELINE_STATUS_UNSET) revert PonsBaselineAlreadyExists(baselineId);

        address referenceFactory = value.referenceFactory;
        bytes32 observedHash = referenceFactory.codehash;
        if (referenceFactory.code.length == 0 || observedHash != value.referenceFactoryCodeHash) {
            revert ReferenceFactoryCodeHashMismatch(referenceFactory, value.referenceFactoryCodeHash, observedHash);
        }

        _baselines[baselineId] = value;
        emit PonsBaselineAdded(baselineId, value.behaviorVectorRoot, value.referenceFactoryCodeHash);
    }

    function pauseBaseline(bytes32 baselineId, bytes32 reasonHash) external override restricted {
        PonsBaseline storage value = _baselines[baselineId];
        if (value.status != BASELINE_STATUS_ACTIVE) {
            revert InvalidStateTransition(value.status, BASELINE_STATUS_PAUSED);
        }
        value.status = BASELINE_STATUS_PAUSED;
        _recordPause(baselineId);
        emit PonsBaselineStatusChanged(baselineId, BASELINE_STATUS_ACTIVE, BASELINE_STATUS_PAUSED, reasonHash);
    }

    function unpauseBaseline(bytes32 baselineId) external override restricted {
        PonsBaseline storage value = _baselines[baselineId];
        if (value.status != BASELINE_STATUS_PAUSED) {
            revert InvalidStateTransition(value.status, BASELINE_STATUS_ACTIVE);
        }
        _requireUnpauseReady(baselineId);
        value.status = BASELINE_STATUS_ACTIVE;
        _clearPauseTimestamp(baselineId);
        emit PonsBaselineStatusChanged(baselineId, BASELINE_STATUS_PAUSED, BASELINE_STATUS_ACTIVE, bytes32(0));
    }

    function retireBaseline(bytes32 baselineId, bytes32 reasonHash) external override restricted {
        PonsBaseline storage value = _baselines[baselineId];
        uint8 oldStatus = value.status;
        if (oldStatus != BASELINE_STATUS_ACTIVE && oldStatus != BASELINE_STATUS_PAUSED) {
            revert InvalidStateTransition(oldStatus, BASELINE_STATUS_RETIRED);
        }
        value.status = BASELINE_STATUS_RETIRED;
        _clearPauseTimestamp(baselineId);
        emit PonsBaselineStatusChanged(baselineId, oldStatus, BASELINE_STATUS_RETIRED, reasonHash);
    }

    function baseline(bytes32 baselineId) external view override returns (PonsBaseline memory) {
        return _baselines[baselineId];
    }
}
