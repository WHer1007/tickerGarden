// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Compile-time marker for the isolated TickerGarden V1 namespace.
/// @dev This library is not a product contract and MUST NOT be deployed.
library V1Scaffold {
    string internal constant EXECUTION_SPEC_ID = "V1-EXEC-8";
    bytes32 internal constant EXECUTION_SPEC_ID_HASH = keccak256(bytes(EXECUTION_SPEC_ID));

    function executionSpecIdHash() internal pure returns (bytes32) {
        return EXECUTION_SPEC_ID_HASH;
    }

    function productRuntimeComplete() internal pure returns (bool) {
        return false;
    }
}
