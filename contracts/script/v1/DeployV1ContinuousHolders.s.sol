// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {DeployV1Deterministic} from "./DeployV1Deterministic.s.sol";

/// @notice Separate release entrypoint; inherits all chain, dependency, payload and release-certificate gates.
contract DeployV1ContinuousHolders is DeployV1Deterministic {
}
