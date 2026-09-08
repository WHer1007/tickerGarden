// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface ITestTreasuryFeeVault {
    function platformTreasury() external view returns (address);
    function settlementOperator() external view returns (address);
    function setSettlementOperator(address operator) external;
}

/// @notice Single-owner revenue receiver exclusively for Arbitrum Sepolia testing.
contract ArbitrumTestTreasury {
    using SafeERC20 for IERC20;
    address public immutable owner;
    error Unauthorized();
    error InvalidDeployment();
    error TransferFailed();
    error InvalidSettlementConfiguration();
    event SettlementOperatorConfigured(address indexed feeVault, address indexed operator);

    /// @notice Configure only a vault whose immutable revenue receiver is this contract.
    function configureSettlementOperator(address feeVault, address operator) external {
        if (msg.sender != owner) revert Unauthorized();
        if (feeVault.code.length == 0 || operator == address(0) || operator == address(this)) {
            revert InvalidSettlementConfiguration();
        }
        ITestTreasuryFeeVault vault = ITestTreasuryFeeVault(feeVault);
        if (vault.platformTreasury() != address(this)) revert InvalidSettlementConfiguration();
        vault.setSettlementOperator(operator);
        if (vault.settlementOperator() != operator) revert InvalidSettlementConfiguration();
        emit SettlementOperatorConfigured(feeVault, operator);
    }

    constructor(address owner_) {
        if (block.chainid != 421614 || owner_ == address(0)) revert InvalidDeployment();
        owner = owner_;
    }

    receive() external payable {}

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
