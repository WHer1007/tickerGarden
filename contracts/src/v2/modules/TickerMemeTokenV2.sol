// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {ITickerMemeTokenV2} from "../interfaces/ITreasuryV2.sol";

/// @notice Future V2 market token: fixed mint, standard transfers, and Treasury-only true burn.
/// @dev TWAB roots are reconstructed from canonical Transfer logs, so transfers incur no checkpoint storage writes.
contract TickerMemeTokenV2 is ERC20, ITickerMemeTokenV2 {
    bytes32 private immutable _marketId;
    address private immutable _creator;
    address private immutable _factory;
    address private immutable _treasuryDistributor;
    uint256 private immutable _initialSupply;
    uint64 private immutable _deployedAt;

    string private _metadataURI;

    event TreasuryBurn(address indexed treasuryDistributor, uint256 amount, uint256 totalSupplyAfter);

    error InvalidTokenIdentity();
    error UnauthorizedTreasury(address caller);
    error InvalidBurnAmount();
    error BlockTimestampOverflow(uint256 timestamp);

    constructor(
        bytes32 marketId_,
        address creator_,
        address predictedCurve_,
        address treasuryDistributor_,
        string memory name_,
        string memory symbol_,
        string memory metadataURI_,
        uint256 initialSupply_
    ) ERC20(name_, symbol_) {
        if (
            marketId_ == bytes32(0) || creator_ == address(0) || predictedCurve_ == address(0)
                || treasuryDistributor_ == address(0) || treasuryDistributor_.code.length == 0 || initialSupply_ == 0
        ) revert InvalidTokenIdentity();
        if (block.timestamp > type(uint64).max) revert BlockTimestampOverflow(block.timestamp);

        _marketId = marketId_;
        _creator = creator_;
        _factory = msg.sender;
        _treasuryDistributor = treasuryDistributor_;
        _metadataURI = metadataURI_;
        _initialSupply = initialSupply_;
        _deployedAt = uint64(block.timestamp);

        _mint(predictedCurve_, initialSupply_);
    }

    function marketId() external view override returns (bytes32) {
        return _marketId;
    }

    function creator() external view override returns (address) {
        return _creator;
    }

    function factory() external view override returns (address) {
        return _factory;
    }

    function treasuryDistributor() external view override returns (address) {
        return _treasuryDistributor;
    }

    function metadataURI() external view override returns (string memory) {
        return _metadataURI;
    }

    function initialSupply() external view override returns (uint256) {
        return _initialSupply;
    }

    function deployedAt() external view override returns (uint64) {
        return _deployedAt;
    }

    function burnTreasury(uint256 amount) external override {
        if (msg.sender != _treasuryDistributor) revert UnauthorizedTreasury(msg.sender);
        if (amount == 0) revert InvalidBurnAmount();
        _burn(msg.sender, amount);
        emit TreasuryBurn(msg.sender, amount, totalSupply());
    }
}
