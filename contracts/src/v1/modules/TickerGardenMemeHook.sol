// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TickerGardenRewardConversion} from "../shared/TickerGardenRewardConversion.sol";

/// @notice Canonical V1 Uniswap v4 Hook for pool binding, lifecycle and atomic fee execution.
contract TickerGardenMemeHook is TickerGardenRewardConversion {
    constructor(address marketRegistry_, address poolManager_, address protocolFeeVault_, address graduationExecutor_)
        TickerGardenRewardConversion(marketRegistry_, poolManager_, protocolFeeVault_, graduationExecutor_)
    {}
}
