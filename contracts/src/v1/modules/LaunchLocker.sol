// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {LaunchLockerCompounding} from "../shared/LaunchLockerCompounding.sol";

/// @notice Permanent Position NFT custody with public fee collection and Keeper-bounded compounding.
contract LaunchLocker is LaunchLockerCompounding {
    constructor(bytes32 marketId_, address marketRegistry_, address positionManager_)
        LaunchLockerCompounding(marketId_, marketRegistry_, positionManager_)
    {}
}
