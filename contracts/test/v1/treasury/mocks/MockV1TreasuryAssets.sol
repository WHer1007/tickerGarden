// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {MarketConfig, MarketRuntime, MarketView} from "../../../../src/v1/interfaces/IV1Protocol.sol";

contract MockTreasuryMarketRegistryV1 {
    mapping(bytes32 marketId => MarketView value) private _markets;
    mapping(bytes32 marketId => bool registered) private _registered;

    error MarketNotRegistered(bytes32 marketId);

    function setMarket(bytes32 marketId, address memeToken, address quoteToken, uint8 launchPhase) external {
        MarketConfig memory config;
        config.memeToken = memeToken;
        config.quoteAsset = quoteToken;
        _markets[marketId] = MarketView({
            config: config,
            runtime: MarketRuntime({poolId: bytes32(0), sourceVersion: 1, sweptAt: 0, launchPhase: launchPhase})
        });
        _registered[marketId] = true;
    }

    function setLaunchPhase(bytes32 marketId, uint8 launchPhase) external {
        if (!_registered[marketId]) revert MarketNotRegistered(marketId);
        _markets[marketId].runtime.launchPhase = launchPhase;
    }

    function market(bytes32 marketId) external view returns (MarketView memory) {
        if (!_registered[marketId]) revert MarketNotRegistered(marketId);
        return _markets[marketId];
    }
}

contract MockQuoteTokenV1 is ERC20 {
    constructor() ERC20("Mock Quote", "MQUOTE") {}

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }
}

contract MockTaxQuoteTokenV1 is ERC20 {
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

contract MockInvalidMemeTokenV1 is ERC20 {
    constructor() ERC20("Invalid Meme", "INVALID") {
        _mint(msg.sender, 1 ether);
    }
}
