// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";


/// @notice Single-owner revenue receiver exclusively for Robinhood Chain testnet rehearsal.
contract RobinhoodTestnetTreasury {
    using SafeERC20 for IERC20;

    address public immutable owner;

    error Unauthorized();
    error InvalidDeployment();
    error TransferFailed();


    constructor(address owner_) {
        if (block.chainid != 46630 || owner_ == address(0)) revert InvalidDeployment();
        owner = owner_;
    }

    receive() external payable {}

    /// @notice Configure only a vault whose immutable revenue receiver is this contract.


    function withdraw(address asset, uint256 amount) external {
        if (msg.sender != owner) revert Unauthorized();
        if (asset == address(0)) {
            (bool ok,) = payable(owner).call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(asset).safeTransfer(owner, amount);
        }
    }
}
