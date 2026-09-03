// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ITickerGardenMemeHook, MarketView, PoolBinding, PoolKey} from "../interfaces/IV1Protocol.sol";
import {TickerGardenMemeHookBinding} from "./TickerGardenMemeHookBinding.sol";

/// @notice One-way pool initialization and activation lifecycle for the v4 Hook.
abstract contract TickerGardenMemeHookLifecycle is TickerGardenMemeHookBinding {
    error InvalidPoolBindingTransition(bytes32 poolId, uint8 currentStatus, uint8 requiredStatus);

    constructor(address marketRegistry_, address poolManager_, address protocolFeeVault_, address graduationExecutor_)
        TickerGardenMemeHookBinding(marketRegistry_, poolManager_, protocolFeeVault_, graduationExecutor_)
    {}

    function beforeInitialize(address, PoolKey calldata key, uint160) external virtual override returns (bytes4) {
        _requireHookCaller(_hookPoolManager);
        bytes32 poolId = keccak256(abi.encode(key));
        PoolBinding storage binding = _poolBindings[poolId];
        if (
            binding.status != BINDING_EXPECTED || binding.marketId == bytes32(0) || binding.keyHash != poolId
                || _marketIdsByPool[poolId] != binding.marketId
        ) revert PoolNotExpected(poolId);

        MarketView memory value = _hookMarketRegistry.market(binding.marketId);
        _validatePreCommitSource(binding, poolId, value);
        _validateCanonicalPoolKey(binding.marketId, key, value);

        binding.status = BINDING_INITIALIZE_SEEN;
        return ITickerGardenMemeHook.beforeInitialize.selector;
    }

    function activatePool(bytes32 poolId) external virtual override {
        _requireHookCaller(_hookGraduationExecutor);
        PoolBinding storage binding = _poolBindings[poolId];
        if (binding.status != BINDING_INITIALIZE_SEEN) {
            revert InvalidPoolBindingTransition(poolId, binding.status, BINDING_INITIALIZE_SEEN);
        }

        MarketView memory value = _hookMarketRegistry.market(binding.marketId);
        _validatePreCommitSource(binding, poolId, value);
        _validateStoredCanonicalPool(binding, poolId, value);

        binding.status = BINDING_ACTIVE;
        emit PoolBindingActivated(binding.marketId, poolId, binding.sourceVersion);
    }

    function _validatePreCommitSource(PoolBinding storage binding, bytes32 poolId, MarketView memory value)
        private
        view
    {
        if (
            value.runtime.launchPhase != LAUNCH_PHASE_SWEPT || value.runtime.poolId != bytes32(0)
                || _nextSourceVersion(binding.marketId, value.runtime.sourceVersion) != binding.sourceVersion
                || binding.keyHash != poolId
        ) revert InactiveFeeSource(binding.marketId, binding.sourceVersion);
    }

    function _validateStoredCanonicalPool(PoolBinding storage binding, bytes32 poolId, MarketView memory value)
        private
        view
    {
        if (
            binding.marketId == bytes32(0) || binding.keyHash != poolId || value.config.graduatedHook != address(this)
                || keccak256(abi.encode(_hookMarketRegistry.canonicalPoolKey(binding.marketId))) != binding.keyHash
        ) revert InactiveFeeSource(binding.marketId, binding.sourceVersion);
    }
}
