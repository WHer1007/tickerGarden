// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface ICanonicalArbSys {
    function arbBlockNumber() external view returns (uint256);
    function arbBlockHash(uint256 blockNumber) external view returns (bytes32);
}

/// @notice Use the same block domain as canonical transaction receipts and RPC headers.
/// @dev Arbitrum NUMBER/BLOCKHASH are parent-chain estimates, not L2 receipt identities.
/// Known Nitro chains fail closed if their required precompile is unavailable.
library CanonicalBlockClock {
    ICanonicalArbSys internal constant ARB_SYS = ICanonicalArbSys(address(100));
    function isNitro() internal view returns (bool) {
        return block.chainid == 421614 || block.chainid == 42161 || block.chainid == 4663 || block.chainid == 46630;
    }
    function number() internal view returns (uint256) {
        return isNitro() ? ARB_SYS.arbBlockNumber() : block.number;
    }
    function hash(uint256 height) internal view returns (bytes32) {
        return isNitro() ? ARB_SYS.arbBlockHash(height) : blockhash(height);
    }
}
