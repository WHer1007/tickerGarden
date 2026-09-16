// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IContinuousHolderRewards} from "../interfaces/IContinuousHolderRewards.sol";

/// @notice Fixed-supply ERC-20 with holder reward checkpoints before balance changes.
contract TickerMemeTokenV1 is ERC20 {
    bytes32 private immutable _marketId;
    address private immutable _creator;
    address private immutable _factory;
    address private immutable _holderRewardsDistributor;
    uint256 private immutable _initialSupply;
    uint64 private immutable _deployedAt;

    string private _metadataURI;
    bool public continuousRewardsEnabled;

    error InvalidTokenIdentity();
    error UnauthorizedHolderDistributor(address caller);
    error BlockTimestampOverflow(uint256 timestamp);
    error RewardsAlreadyEnabled();

    /// @notice One-time opt-in by the immutable distributor after canonical market registration.
    function enableContinuousRewards() external {
        if (msg.sender != _holderRewardsDistributor) revert UnauthorizedHolderDistributor(msg.sender);
        if (continuousRewardsEnabled) revert RewardsAlreadyEnabled();
        continuousRewardsEnabled = true;
    }

    function _update(address from, address to, uint256 amount) internal override {
        if (continuousRewardsEnabled) {
            IContinuousHolderRewards(_holderRewardsDistributor).checkpointTransfer(_marketId, from, to, amount);
        }
        super._update(from, to, amount);
    }

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
