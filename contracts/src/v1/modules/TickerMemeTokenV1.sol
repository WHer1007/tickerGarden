// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Non-mintable ERC-20 with voluntary own-balance burning. Holder snapshots never participate in token transfers.
contract TickerMemeTokenV1 is ERC20 {
    bytes32 private immutable _marketId;
    address private immutable _creator;
    address private immutable _factory;
    address private immutable _holderRewardsDistributor;
    uint256 private immutable _initialSupply;
    uint64 private immutable _deployedAt;

    string private _metadataURI;

    error InvalidTokenIdentity();
    error BlockTimestampOverflow(uint256 timestamp);

    constructor(
        bytes32 marketId_,
        address creator_,
        address predictedCurve_,
        address holderRewardsDistributor_,
        string memory name_,
        string memory symbol_,
        string memory metadataURI_,
        uint256 initialSupply_
    ) ERC20(name_, symbol_) {
        if (
            marketId_ == bytes32(0) || creator_ == address(0) || predictedCurve_ == address(0)
                || holderRewardsDistributor_ == address(0) || holderRewardsDistributor_.code.length == 0
                || initialSupply_ == 0
        ) revert InvalidTokenIdentity();
        if (block.timestamp > type(uint64).max) revert BlockTimestampOverflow(block.timestamp);

        _marketId = marketId_;
        _creator = creator_;
        _factory = msg.sender;
        _holderRewardsDistributor = holderRewardsDistributor_;
        _metadataURI = metadataURI_;
        _initialSupply = initialSupply_;
        _deployedAt = uint64(block.timestamp);

        _mint(predictedCurve_, initialSupply_);
    }

    /// @notice Destroy only the caller's own tokens; transfers never invoke reward settlement.
    function burn(uint256 amount) external { _burn(msg.sender, amount); }

    function marketId() external view returns (bytes32) {
        return _marketId;
    }

    function creator() external view returns (address) {
        return _creator;
    }

    function factory() external view returns (address) {
        return _factory;
    }

    function holderRewardsDistributor() external view returns (address) {
        return _holderRewardsDistributor;
    }

    function metadataURI() external view returns (string memory) {
        return _metadataURI;
    }

    function initialSupply() external view returns (uint256) {
        return _initialSupply;
    }

    function deployedAt() external view returns (uint64) {
        return _deployedAt;
    }
}
