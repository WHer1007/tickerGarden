// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Evidence anchor for synthetic Robinhood testnet economics, not a TickerGarden factory.
contract RobinhoodTestnetBaselineFixture {
    string public constant PURPOSE = "TICKERGARDEN_ROBINHOOD_TESTNET_BASELINE";

    constructor() {
        require(block.chainid == 46630, "TEST_CHAIN_ONLY");
    }
}
