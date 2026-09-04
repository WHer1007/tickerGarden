// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {GraduationExecutorPoolExecution} from "../shared/GraduationExecutorPoolExecution.sol";
import {LaunchLocker} from "./LaunchLocker.sol";

/// @dev Runtime bytecode is the exact LaunchLocker creation code and exposes no callable ABI or mutable state.
contract LaunchLockerCreationCodeStore {
    constructor(bytes memory creationCode) {
        assembly ("memory-safe") {
            return(add(creationCode, 0x20), mload(creationCode))
        }
    }
}

/// @notice Canonical atomic V1 graduation, v4 pool creation, and permanent Locker deployment module.
contract GraduationExecutor is GraduationExecutorPoolExecution {
    address private immutable _lockerCreationCodeStore;

    constructor(
        address marketRegistry_,
        address quoteRegistry_,
        address poolManager_,
        address positionManager_,
        address hook_
    ) GraduationExecutorPoolExecution(marketRegistry_, quoteRegistry_, poolManager_, positionManager_, hook_) {
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
