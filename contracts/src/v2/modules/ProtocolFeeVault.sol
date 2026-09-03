// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ProtocolFeeVaultRecoveryClaims} from "../shared/ProtocolFeeVaultRecoveryClaims.sol";

struct ProtocolFeeVaultInit {
    address authority;
    address marketRegistry;
    address poolManager;
    address creatorRevenueRegistry;
    address platformTreasury;
    bytes32 feePolicyId;
    address marketController;
}

/// @notice Canonical V2 fee-accounting, liability and Emergency-Recovery vault.
/// @dev The MarketController address may be its precomputed deployment address so the Vault can be
///      deployed first and break the immutable Controller/Vault dependency cycle.
contract ProtocolFeeVault is ProtocolFeeVaultRecoveryClaims {
    constructor(ProtocolFeeVaultInit memory init)
        ProtocolFeeVaultRecoveryClaims(
            init.authority,
            init.marketRegistry,
            init.poolManager,
            init.creatorRevenueRegistry,
            init.platformTreasury,
            init.feePolicyId,
            init.marketController
        )
    {}
}
