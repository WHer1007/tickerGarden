// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Independent synthetic fixture so pause tests cannot contaminate active-staker tests.
contract ArbitrumActiveScenarioStock is ERC20 {
    bytes32 public constant uid = keccak256("TICKERGARDEN_SYNTHETIC_ACTIVE_STOCK_R3");

    constructor(address recipient) ERC20("TickerGarden Active Test Stock", "tgACTIVESTOCK") {
        require(block.chainid == 421614, "TEST_CHAIN_ONLY");
        _mint(recipient, 1_000_000 ether);
    }
}
