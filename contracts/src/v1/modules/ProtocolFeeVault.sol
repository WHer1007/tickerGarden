// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ProtocolFeeVaultUserClaims} from "../shared/ProtocolFeeVaultUserClaims.sol";

struct ProtocolFeeVaultInit {
    address marketRegistry;
    address poolManager;
    address creatorRevenueRegistry;
    address platformTreasury;
    bytes32 feePolicyId;
}

/// @notice Canonical V1 fee-accounting and liability vault.
contract ProtocolFeeVault is ProtocolFeeVaultUserClaims {
    constructor(ProtocolFeeVaultInit memory init)
        ProtocolFeeVaultUserClaims(
            init.marketRegistry, init.poolManager, init.creatorRevenueRegistry, init.platformTreasury, init.feePolicyId
        )
    {}

    function marketRegistry() external view returns (address) {
        return address(_feeMarketRegistry);
    }

    function poolManager() external view returns (address) {
        return _feePoolManager;
    }

    function creatorRevenueRegistry() external view returns (address) {
        return address(_feeCreatorRevenueRegistry);
    }

    function platformTreasury() external view returns (address) {
        return _feePlatformTreasury;
    }

    function feePolicyId() external view returns (bytes32) {
        return _feePolicyIdValue();
    }

    function feePolicyHash() external view returns (bytes32) {
        return _v4FeePolicyHash();
    }
}
