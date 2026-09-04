// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {LaunchLockerCustody} from "../shared/LaunchLockerCustody.sol";

/// @notice Canonical per-market permanent Position NFT custody with no fee collection or compounding entrypoint.
contract LaunchLocker is LaunchLockerCustody {
    constructor(bytes32 marketId_, address marketRegistry_, address positionManager_)
        LaunchLockerCustody(marketId_, marketRegistry_, positionManager_)
    {}
}
