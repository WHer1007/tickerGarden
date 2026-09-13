// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

library V1HolderModeSelection {
    error HolderModeSelectionRequired(string expected);

    function validate(string memory selected, bool walletSnapshot) internal pure {
        string memory expected = "wallet-snapshot-v1";
        if (!walletSnapshot) revert HolderModeSelectionRequired(expected);
        if (keccak256(bytes(selected)) != keccak256(bytes(expected))) revert HolderModeSelectionRequired(expected);
    }
}
