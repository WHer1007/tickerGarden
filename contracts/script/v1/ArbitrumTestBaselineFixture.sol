// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Evidence anchor for synthetic test economics, NOT a TickerGarden factory.
contract ArbitrumTestBaselineFixture {
    string public constant PURPOSE = "TICKERGARDEN_ARBITRUM_TICKERGARDEN_TEST_BASELINE";

    constructor() {
        require(block.chainid == 421614, "TEST_CHAIN_ONLY");
    }
}
