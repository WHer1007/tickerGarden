// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {LaunchLockerCompounding} from "../shared/LaunchLockerCompounding.sol";

/// @notice Canonical per-market permanent custody and permissionless compounding instance.
contract LaunchLocker is LaunchLockerCompounding {
    constructor(bytes32 marketId_, address marketRegistry_, address positionManager_)
        LaunchLockerCompounding(marketId_, marketRegistry_, positionManager_)
    {}
}
