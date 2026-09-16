// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AuthorityUtils} from "@openzeppelin/contracts/access/manager/AuthorityUtils.sol";

interface ICompoundGovernanceAuthority {
    function authority() external view returns (address);
}

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
    address public compoundKeeper;
    error UnauthorizedCompoundGovernance();
    event CompoundKeeperChanged(address indexed previousKeeper, address indexed newKeeper);

    /// @notice Governance rotates the shared automation wallet. Zero disables compounding, never trading.
    function setCompoundKeeper(address keeper) external {
        address stocks = _graduationMarketRegistry.officialStockRegistry();
        address authority = ICompoundGovernanceAuthority(stocks).authority();
        (bool immediate,) = AuthorityUtils.canCallWithDelay(authority, msg.sender, address(this), msg.sig);
        if (!immediate) revert UnauthorizedCompoundGovernance();
        emit CompoundKeeperChanged(compoundKeeper, keeper);
        compoundKeeper = keeper;
    }

    address private immutable _lockerCreationCodeStore;
    bytes32 private immutable _lockerCreationCodeHash;

    constructor(
        address marketRegistry_,
        address quoteRegistry_,
        address poolManager_,
        address positionManager_,
        address hook_
    ) GraduationExecutorPoolExecution(marketRegistry_, quoteRegistry_, poolManager_, positionManager_, hook_) {
        bytes memory creationCode = type(LaunchLocker).creationCode;
        _lockerCreationCodeHash = keccak256(creationCode);
        _lockerCreationCodeStore = address(new LaunchLockerCreationCodeStore(creationCode));
    }

    function launchLockerCreationCodeHash() external view returns (bytes32) {
        return _lockerCreationCodeHash;
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
