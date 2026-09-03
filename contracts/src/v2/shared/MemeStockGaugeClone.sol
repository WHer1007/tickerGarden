// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

import {GaugeIdentity} from "../interfaces/IV2Protocol.sol";

/// @notice Deterministic immutable-argument clone codec and deployment helpers for MemeStockGauge.
/// @dev Gauge identity is eight static ABI words. The 45-byte OpenZeppelin proxy runtime appends those
///      words verbatim, so every market keeps immutable identity while reward and emergency storage remains
///      isolated at the clone address.
library MemeStockGaugeClone {
    uint256 internal constant ARGS_LENGTH = 8 * 32;
    uint256 internal constant PROXY_RUNTIME_LENGTH = 0x2d;
    uint256 internal constant INSTANCE_RUNTIME_LENGTH = PROXY_RUNTIME_LENGTH + ARGS_LENGTH;

    error InvalidGaugeIdentity(
        bytes32 marketId, bytes32 assetUid, bytes32 quoteAssetConfigId, address quoteAsset, address memeToken
    );
    error InvalidGaugeDependencies(address allocationManager, address protocolFeeVault, address marketController);
    error InvalidGaugeImplementation(address implementation);
    error InvalidGaugeCloneRuntime(address instance, uint256 actualLength, uint256 expectedLength);

    function validate(GaugeIdentity memory identity) internal view {
        _validate(identity, true);
    }

    /// @dev The Meme address is CREATE2-predicted before the Token exists. All other dependencies must
    ///      already be live, while deployDeterministic performs the final Token code check atomically.
    function validatePrediction(GaugeIdentity memory identity) internal view {
        _validate(identity, false);
    }

    function _validate(GaugeIdentity memory identity, bool requireMemeCode) private view {
        if (
            identity.marketId == bytes32(0) || identity.assetUid == bytes32(0)
                || identity.quoteAssetConfigId == bytes32(0) || identity.memeToken == address(0)
                || (requireMemeCode && identity.memeToken.code.length == 0) || identity.quoteAsset == identity.memeToken
                || (identity.quoteAsset != address(0) && identity.quoteAsset.code.length == 0)
        ) {
            revert InvalidGaugeIdentity(
                identity.marketId,
                identity.assetUid,
                identity.quoteAssetConfigId,
                identity.quoteAsset,
                identity.memeToken
            );
        }
        if (
            identity.allocationManager.code.length == 0 || identity.protocolFeeVault.code.length == 0
                || identity.marketController.code.length == 0 || identity.allocationManager == identity.protocolFeeVault
                || identity.allocationManager == identity.marketController
                || identity.protocolFeeVault == identity.marketController
                || identity.allocationManager == identity.memeToken || identity.protocolFeeVault == identity.memeToken
                || identity.marketController == identity.memeToken || identity.allocationManager == identity.quoteAsset
                || identity.protocolFeeVault == identity.quoteAsset || identity.marketController == identity.quoteAsset
        ) {
            revert InvalidGaugeDependencies(
                identity.allocationManager, identity.protocolFeeVault, identity.marketController
            );
        }
    }

    function deployDeterministic(address implementation, bytes32 salt, GaugeIdentity memory identity)
        internal
        returns (address instance)
    {
        if (implementation.code.length == 0) revert InvalidGaugeImplementation(implementation);
        validate(identity);
        instance = Clones.cloneDeterministicWithImmutableArgs(implementation, abi.encode(identity), salt);
        requireInstance(instance);
    }

    function predictDeterministicAddress(
        address implementation,
        bytes32 salt,
        GaugeIdentity memory identity,
        address deployer
    ) internal pure returns (address) {
        return Clones.predictDeterministicAddressWithImmutableArgs(implementation, abi.encode(identity), salt, deployer);
    }

    function read(address instance) internal view returns (GaugeIdentity memory identity) {
        requireInstance(instance);
        bytes memory args = Clones.fetchCloneArgs(instance);
        if (args.length != ARGS_LENGTH) {
            revert InvalidGaugeCloneRuntime(instance, instance.code.length, INSTANCE_RUNTIME_LENGTH);
        }
        identity = abi.decode(args, (GaugeIdentity));
    }

    function requireInstance(address instance) internal view {
        uint256 actualLength = instance.code.length;
        if (actualLength != INSTANCE_RUNTIME_LENGTH) {
            revert InvalidGaugeCloneRuntime(instance, actualLength, INSTANCE_RUNTIME_LENGTH);
        }
    }

    function identityHash(GaugeIdentity memory identity) internal pure returns (bytes32) {
        return keccak256(abi.encode(identity));
    }
}
