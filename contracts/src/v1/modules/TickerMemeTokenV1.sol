// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice A market-bound, fixed-supply ERC-20 whose entire supply is created directly in its Curve.
contract TickerMemeTokenV1 is ERC20 {
    bytes32 private immutable _marketId;
    address private immutable _creator;
    address private immutable _factory;
    uint256 private immutable _initialSupply;

    string private _metadataURI;

    error InvalidTokenIdentity();

    constructor(
        bytes32 marketId_,
        address creator_,
        address predictedCurve_,
        string memory name_,
        string memory symbol_,
        string memory metadataURI_,
        uint256 initialSupply_
    ) ERC20(name_, symbol_) {
        if (marketId_ == bytes32(0) || creator_ == address(0) || predictedCurve_ == address(0) || initialSupply_ == 0) revert InvalidTokenIdentity();

        _marketId = marketId_;
        _creator = creator_;
        _factory = msg.sender;
        _metadataURI = metadataURI_;
        _initialSupply = initialSupply_;

        _mint(predictedCurve_, initialSupply_);
    }

    function marketId() external view returns (bytes32) {
        return _marketId;
    }

    function creator() external view returns (address) {
        return _creator;
    }

    function factory() external view returns (address) {
        return _factory;
    }

    function metadataURI() external view returns (string memory) {
        return _metadataURI;
    }

    function initialSupply() external view returns (uint256) {
        return _initialSupply;
    }
}
