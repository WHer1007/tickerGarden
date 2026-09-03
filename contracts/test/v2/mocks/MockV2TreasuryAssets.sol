// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockQuoteTokenV2 is ERC20 {
    constructor() ERC20("Mock Quote", "MQUOTE") {}

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }
}

contract MockTaxQuoteTokenV2 is ERC20 {
    address private immutable _collector;
    bool public taxEnabled = true;

    constructor(address collector_) ERC20("Tax Quote", "TQUOTE") {
        _collector = collector_;
    }

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }

    function setTaxEnabled(bool enabled) external {
        taxEnabled = enabled;
    }

    function _update(address from, address to, uint256 amount) internal override {
        if (!taxEnabled || from == address(0) || to == address(0) || amount < 100) {
            super._update(from, to, amount);
            return;
        }
        uint256 tax = amount / 100;
        super._update(from, _collector, tax);
        super._update(from, to, amount - tax);
    }
}

contract MockInvalidMemeTokenV2 is ERC20 {
    constructor() ERC20("Invalid Meme", "INVALID") {
        _mint(msg.sender, 1 ether);
    }
}
