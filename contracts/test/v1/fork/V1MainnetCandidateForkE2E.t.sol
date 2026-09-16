// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {V1ProductForkE2ETest} from "./V1ProductForkE2E.t.sol";

/// @notice Same full business proof against a separately recorded, hash-verified recent mainnet pin.
/// @dev The runner verifies block hash and chain before starting Foundry; missing env fails closed.
contract V1MainnetCandidateForkE2ETest is V1ProductForkE2ETest {
    function _forkBlockNumber() internal view override returns (uint256) {
        return vm.envUint("TG_MAINNET_FORK_BLOCK");
    }

    function _forkBlockHash() internal view override returns (bytes32) {
        return vm.envBytes32("TG_MAINNET_FORK_HASH");
    }

    function _forkL1BlockNumber() internal view override returns (uint256) {
        return vm.envUint("TG_MAINNET_FORK_L1_BLOCK");
    }
}
