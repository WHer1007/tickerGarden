// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ProtocolFeeVaultV4Accounting} from "../shared/ProtocolFeeVaultV4Accounting.sol";

struct ProtocolFeeVaultInit {
    address marketRegistry;
    address poolManager;
    address creatorRevenueRegistry;
    address platformTreasury;
    bytes32 feePolicyId;
}

/// @notice Canonical V1 fee-accounting and liability vault.
contract ProtocolFeeVault is ProtocolFeeVaultV4Accounting {
    constructor(ProtocolFeeVaultInit memory init)
        ProtocolFeeVaultV4Accounting(
            init.marketRegistry, init.poolManager, init.creatorRevenueRegistry, init.platformTreasury, init.feePolicyId
        )
    {}
}
