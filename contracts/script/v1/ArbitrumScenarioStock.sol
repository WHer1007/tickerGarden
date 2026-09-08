// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Clearly synthetic stock used only for public Arbitrum Sepolia integration tests.
contract ArbitrumScenarioStock is ERC20 {
    bytes32 public constant uid = keccak256("TICKERGARDEN_SYNTHETIC_TEST_STOCK_R3");

    constructor(address recipient) ERC20("TickerGarden Synthetic Test Stock", "tgTESTSTOCK") {
        require(block.chainid == 421614, "TEST_CHAIN_ONLY");
        _mint(recipient, 1_000_000 ether);
    }
}
