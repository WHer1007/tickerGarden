// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IContinuousHolderRewards {
    function checkpointTransfer(bytes32 marketId, address from, address to, uint256 amount) external;
}

interface IContinuousRewardToken {
    function enableContinuousRewards() external;
}
