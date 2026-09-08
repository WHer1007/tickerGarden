// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
interface IContinuousTestCurve { function buy(uint256,uint256,address) external payable; function sweepCurveFees() external; }
interface IContinuousTestVault { function fundHolderRewards(bytes32,uint32) external returns(uint256); }
/// @notice Testnet-only transaction driver for the real curve -> FeeVault -> distributor path.
/// A separate transaction/timestamp is required for each distinct funding stream.
contract ArbitrumContinuousTestDriver {
    address public immutable feeVault;
    constructor(address vault) { require(block.chainid == 421614 && vault.code.length != 0); feeVault = vault; }
    function cycle(address curve, bytes32 marketId) external payable {
        require(msg.value > 0);
        IContinuousTestCurve(curve).buy{value:msg.value}(msg.value,1,msg.sender);
        IContinuousTestCurve(curve).sweepCurveFees();
        IContinuousTestVault(feeVault).fundHolderRewards(marketId,1);
    }
}
