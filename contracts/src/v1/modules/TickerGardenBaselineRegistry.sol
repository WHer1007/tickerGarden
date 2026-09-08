// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ITickerGardenBaselineRegistry, TickerGardenBaseline} from "../interfaces/IV1Protocol.sol";
import {DelayedUnpause} from "../shared/DelayedUnpause.sol";
import {ImmutableAccessManaged} from "../shared/ImmutableAccessManaged.sol";

/// @notice Append-only snapshots of independently verified TickerGarden behavior baselines.
contract TickerGardenBaselineRegistry is ITickerGardenBaselineRegistry, ImmutableAccessManaged, DelayedUnpause {
    uint8 internal constant BASELINE_STATUS_UNSET = 0;
    uint8 internal constant BASELINE_STATUS_ACTIVE = 1;
    uint8 internal constant BASELINE_STATUS_PAUSED = 2;
    uint8 internal constant BASELINE_STATUS_RETIRED = 3;
    uint256 internal constant BPS_DENOMINATOR = 10_000;
    uint256 internal constant MAX_CURVE_FEE_BPS = 9_900;
    uint256 internal constant MAX_GRADUATION_AMOUNT = uint256(uint128(type(int128).max));

    mapping(bytes32 baselineId => TickerGardenBaseline value) private _baselines;

    error InvalidTickerGardenBaseline(bytes32 baselineId);
    error TickerGardenBaselineAlreadyExists(bytes32 baselineId);
    error ReferenceFactoryCodeHashMismatch(address factory, bytes32 suppliedHash, bytes32 observedHash);
    error InvalidStateTransition(uint8 currentState, uint8 requestedState);

    constructor(address authority_) ImmutableAccessManaged(authority_) {}

    function addBaseline(bytes32 baselineId, TickerGardenBaseline calldata value) external override restricted {
        if (
            baselineId == bytes32(0) || value.referenceChainId == 0 || value.referenceFactory == address(0)
                || value.referenceFactoryCodeHash == bytes32(0) || value.supply == 0
                || value.supply > MAX_GRADUATION_AMOUNT || value.curveFeeBps > MAX_CURVE_FEE_BPS || value.poolFee != 0
                || value.tickSpacing < 1 || value.tickSpacing > 32_767 || value.behaviorVectorRoot == bytes32(0)
                || value.status != BASELINE_STATUS_ACTIVE
        ) revert InvalidTickerGardenBaseline(baselineId);
        if (_baselines[baselineId].status != BASELINE_STATUS_UNSET) revert TickerGardenBaselineAlreadyExists(baselineId);

        address referenceFactory = value.referenceFactory;
        bytes32 observedHash = referenceFactory.codehash;
        if (referenceFactory.code.length == 0 || observedHash != value.referenceFactoryCodeHash) {
            revert ReferenceFactoryCodeHashMismatch(referenceFactory, value.referenceFactoryCodeHash, observedHash);
        }

        _baselines[baselineId] = value;
        emit TickerGardenBaselineAdded(baselineId, value.behaviorVectorRoot, value.referenceFactoryCodeHash);
    }

    function pauseBaseline(bytes32 baselineId, bytes32 reasonHash) external override restricted {
        TickerGardenBaseline storage value = _baselines[baselineId];
        if (value.status != BASELINE_STATUS_ACTIVE) {
            revert InvalidStateTransition(value.status, BASELINE_STATUS_PAUSED);
        }
        value.status = BASELINE_STATUS_PAUSED;
        _recordPause(baselineId);
        emit TickerGardenBaselineStatusChanged(baselineId, BASELINE_STATUS_ACTIVE, BASELINE_STATUS_PAUSED, reasonHash);
    }

    function unpauseBaseline(bytes32 baselineId) external override restricted {
        TickerGardenBaseline storage value = _baselines[baselineId];
        if (value.status != BASELINE_STATUS_PAUSED) {
            revert InvalidStateTransition(value.status, BASELINE_STATUS_ACTIVE);
        }
        _requireUnpauseReady(baselineId);
        value.status = BASELINE_STATUS_ACTIVE;
        _clearPauseTimestamp(baselineId);
        emit TickerGardenBaselineStatusChanged(baselineId, BASELINE_STATUS_PAUSED, BASELINE_STATUS_ACTIVE, bytes32(0));
    }

    function retireBaseline(bytes32 baselineId, bytes32 reasonHash) external override restricted {
        TickerGardenBaseline storage value = _baselines[baselineId];
        uint8 oldStatus = value.status;
        if (oldStatus != BASELINE_STATUS_ACTIVE && oldStatus != BASELINE_STATUS_PAUSED) {
            revert InvalidStateTransition(oldStatus, BASELINE_STATUS_RETIRED);
        }
        value.status = BASELINE_STATUS_RETIRED;
        _clearPauseTimestamp(baselineId);
        emit TickerGardenBaselineStatusChanged(baselineId, oldStatus, BASELINE_STATUS_RETIRED, reasonHash);
    }

    function baseline(bytes32 baselineId) external view override returns (TickerGardenBaseline memory) {
        return _baselines[baselineId];
    }
}
