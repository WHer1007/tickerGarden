// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TickerGardenMemeHookFeeExecution} from "../shared/TickerGardenMemeHookFeeExecution.sol";

/// @notice Canonical V2 Uniswap v4 Hook for pool binding, lifecycle and atomic fee execution.
contract TickerGardenMemeHook is TickerGardenMemeHookFeeExecution {
    constructor(
        address marketRegistry_,
        address poolManager_,
        address protocolFeeVault_,
        address graduationExecutor_,
        address marketController_
    )
        TickerGardenMemeHookFeeExecution(
            marketRegistry_, poolManager_, protocolFeeVault_, graduationExecutor_, marketController_
        )
    {}
}
