// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Enforces an unpause delay measured from the actual pause transition.
/// @dev AccessManager delays are measured from scheduling time, so they cannot by themselves prevent
///      an unpause operation from being scheduled before the protected object is paused.
abstract contract DelayedUnpause {
    uint64 internal constant UNPAUSE_STATE_DELAY = 20 minutes;

    mapping(bytes32 objectId => uint64 timestamp) private _pausedAt;

    error UnpauseStateDelayNotElapsed(bytes32 objectId, uint64 readyAt);
    error UnpauseTimestampOverflow(uint256 timestamp);

    function _recordPause(bytes32 objectId) internal {
        if (block.timestamp > type(uint64).max - UNPAUSE_STATE_DELAY) {
            revert UnpauseTimestampOverflow(block.timestamp);
        }
        _pausedAt[objectId] = uint64(block.timestamp);
    }

    function _requireUnpauseReady(bytes32 objectId) internal view {
        uint64 readyAt = _pausedAt[objectId] + UNPAUSE_STATE_DELAY;
        if (block.timestamp < readyAt) revert UnpauseStateDelayNotElapsed(objectId, readyAt);
    }

    function _clearPauseTimestamp(bytes32 objectId) internal {
        delete _pausedAt[objectId];
    }
}
