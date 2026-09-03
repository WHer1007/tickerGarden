// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {GraduationExecutorRetryAndRescue} from "../shared/GraduationExecutorRetryAndRescue.sol";
import {LaunchLocker} from "./LaunchLocker.sol";

/// @dev Runtime bytecode is the exact LaunchLocker creation code and exposes no callable ABI or mutable state.
contract LaunchLockerCreationCodeStore {
    constructor(bytes memory creationCode) {
        assembly ("memory-safe") {
            return(add(creationCode, 0x20), mload(creationCode))
        }
    }
}

/// @notice Canonical V1 graduation, retry, rescue, v4 pool creation, and permanent Locker deployment module.
contract GraduationExecutor is GraduationExecutorRetryAndRescue {
    address private immutable _lockerCreationCodeStore;

    constructor(
        address marketRegistry_,
        address quoteRegistry_,
        address poolManager_,
        address positionManager_,
        address hook_,
        address quoteDustRecipient_,
        address rescueRecipient_
    )
        GraduationExecutorRetryAndRescue(
            marketRegistry_,
            quoteRegistry_,
            poolManager_,
            positionManager_,
            hook_,
            quoteDustRecipient_,
            rescueRecipient_
        )
    {
        _lockerCreationCodeStore = address(new LaunchLockerCreationCodeStore(type(LaunchLocker).creationCode));
    }

    function _launchLockerCreationCode() internal view override returns (bytes memory creationCode) {
        address store = _lockerCreationCodeStore;
        uint256 size = store.code.length;
        creationCode = new bytes(size);
        assembly ("memory-safe") {
            extcodecopy(store, add(creationCode, 0x20), 0, size)
        }
    }
}
