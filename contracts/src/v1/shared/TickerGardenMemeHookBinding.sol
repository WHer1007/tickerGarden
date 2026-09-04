// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    IMarketRegistryV1,
    ITickerGardenMemeHook,
    MarketView,
    PoolBinding,
    PoolKey
} from "../interfaces/IV1Protocol.sol";

/// @notice Immutable Hook identity and canonical PoolKey binding shared by the final v4 Hook.
abstract contract TickerGardenMemeHookBinding is ITickerGardenMemeHook {
    uint160 internal constant HOOK_PERMISSION_MASK = 0x2044;
    uint160 private constant ALL_HOOK_PERMISSION_BITS = (1 << 14) - 1;
    uint8 internal constant LAUNCH_PHASE_NOT_GRADUATED = 0;
    uint8 internal constant LAUNCH_PHASE_POOL_CREATED = 1;
    uint8 internal constant BINDING_NONE = 0;
    uint8 internal constant BINDING_EXPECTED = 1;
    uint8 internal constant BINDING_INITIALIZE_SEEN = 2;
    uint8 internal constant BINDING_ACTIVE = 3;

    IMarketRegistryV1 internal immutable _hookMarketRegistry;
    address internal immutable _hookPoolManager;
    address internal immutable _hookProtocolFeeVault;
    address internal immutable _hookGraduationExecutor;

    mapping(bytes32 poolId => bytes32 marketId) internal _marketIdsByPool;
    mapping(bytes32 poolId => PoolBinding binding) internal _poolBindings;

    error InvalidHookDependencies(
        address marketRegistry, address poolManager, address protocolFeeVault, address graduationExecutor
    );
    error GraduationExecutorBindingMismatch(address supplied, address registered);
    error UnauthorizedHookCaller(address caller, address expected);
    error InvalidCanonicalPoolKey();
    error InvalidHookPermissionMask();
    error PoolNotExpected(bytes32 poolId);
    error PoolBindingNotActive(bytes32 poolId);
    error InactiveFeeSource(bytes32 marketId, uint32 sourceVersion);
    error HookSourceVersionOverflow(bytes32 marketId, uint32 sourceVersion);

    constructor(address marketRegistry_, address poolManager_, address protocolFeeVault_, address graduationExecutor_) {
        if ((uint160(address(this)) & ALL_HOOK_PERMISSION_BITS) != HOOK_PERMISSION_MASK) {
            revert InvalidHookPermissionMask();
        }
        if (
            !_isContract(marketRegistry_) || !_isContract(poolManager_) || !_isContract(protocolFeeVault_)
                || graduationExecutor_ == address(0) || marketRegistry_ == poolManager_
                || marketRegistry_ == protocolFeeVault_ || marketRegistry_ == graduationExecutor_
                || poolManager_ == protocolFeeVault_ || poolManager_ == graduationExecutor_
                || protocolFeeVault_ == graduationExecutor_
        ) {
            revert InvalidHookDependencies(marketRegistry_, poolManager_, protocolFeeVault_, graduationExecutor_);
        }

        address registeredExecutor;
        try IMarketRegistryV1(marketRegistry_).graduationExecutor() returns (address value) {
            registeredExecutor = value;
        } catch {
            revert GraduationExecutorBindingMismatch(graduationExecutor_, address(0));
        }
        if (registeredExecutor != graduationExecutor_) {
            revert GraduationExecutorBindingMismatch(graduationExecutor_, registeredExecutor);
        }

        _hookMarketRegistry = IMarketRegistryV1(marketRegistry_);
        _hookPoolManager = poolManager_;
        _hookProtocolFeeVault = protocolFeeVault_;
        _hookGraduationExecutor = graduationExecutor_;
    }

    function registerExpectedPool(bytes32 marketId, PoolKey calldata key, uint32 sourceVersion)
        external
        virtual
        override
        returns (bytes32 poolId)
    {
        _requireHookCaller(_hookGraduationExecutor);
        MarketView memory value = _hookMarketRegistry.market(marketId);
        if (
            marketId == bytes32(0) || value.runtime.launchPhase != LAUNCH_PHASE_NOT_GRADUATED
                || value.runtime.poolId != bytes32(0)
        ) {
            revert InactiveFeeSource(marketId, value.runtime.sourceVersion);
        }
        uint32 expectedSourceVersion = _nextSourceVersion(marketId, value.runtime.sourceVersion);
        if (sourceVersion != expectedSourceVersion) revert InactiveFeeSource(marketId, sourceVersion);

        bytes32 keyHash = _validateCanonicalPoolKey(marketId, key, value);
        poolId = keyHash;
        if (_poolBindings[poolId].status != BINDING_NONE || _marketIdsByPool[poolId] != bytes32(0)) {
            revert PoolNotExpected(poolId);
        }

        _marketIdsByPool[poolId] = marketId;
        _poolBindings[poolId] = PoolBinding({
            marketId: marketId, keyHash: keyHash, sourceVersion: sourceVersion, feeNonce: 0, status: BINDING_EXPECTED
        });
        emit ExpectedPoolRegistered(marketId, poolId, keyHash, sourceVersion);
    }

    function marketOfPool(bytes32 poolId) external view virtual override returns (bytes32) {
        return _marketIdsByPool[poolId];
    }

    function poolBinding(bytes32 poolId) external view virtual override returns (PoolBinding memory) {
        return _poolBindings[poolId];
    }

    function hookPermissionMask() external pure virtual override returns (uint160) {
        return HOOK_PERMISSION_MASK;
    }

    function marketRegistry() external view virtual override returns (address) {
        return address(_hookMarketRegistry);
    }

    function poolManager() external view virtual override returns (address) {
        return _hookPoolManager;
    }

    function protocolFeeVault() external view virtual override returns (address) {
        return _hookProtocolFeeVault;
    }

    function graduationExecutor() external view virtual override returns (address) {
        return _hookGraduationExecutor;
    }

    function _validateActivePool(PoolKey calldata key)
        internal
        view
        returns (bytes32 poolId, PoolBinding storage binding, MarketView memory value)
    {
        _requireHookCaller(_hookPoolManager);
        poolId = keccak256(abi.encode(key));
        binding = _poolBindings[poolId];
        if (binding.status != BINDING_ACTIVE || binding.marketId == bytes32(0) || binding.keyHash != poolId) {
            revert PoolBindingNotActive(poolId);
        }

        value = _hookMarketRegistry.market(binding.marketId);
        if (
            value.runtime.launchPhase != LAUNCH_PHASE_POOL_CREATED || value.runtime.poolId != poolId
                || value.runtime.sourceVersion != binding.sourceVersion || value.config.graduatedHook != address(this)
                || keccak256(abi.encode(_hookMarketRegistry.canonicalPoolKey(binding.marketId))) != binding.keyHash
        ) {
            revert InactiveFeeSource(binding.marketId, binding.sourceVersion);
        }
    }

    function _validateCanonicalPoolKey(bytes32 marketId, PoolKey calldata key, MarketView memory value)
        internal
        view
        returns (bytes32 keyHash)
    {
        if (
            key.currency0 >= key.currency1 || key.fee != 0 || key.tickSpacing < 1 || key.tickSpacing > 32_767
                || key.hooks != address(this) || value.config.graduatedHook != address(this)
        ) revert InvalidCanonicalPoolKey();

        (address expectedCurrency0, address expectedCurrency1) = value.config.quoteAsset < value.config.memeToken
            ? (value.config.quoteAsset, value.config.memeToken)
            : (value.config.memeToken, value.config.quoteAsset);
        if (key.currency0 != expectedCurrency0 || key.currency1 != expectedCurrency1) {
            revert InvalidCanonicalPoolKey();
        }

        keyHash = keccak256(abi.encode(key));
        if (keyHash != keccak256(abi.encode(_hookMarketRegistry.canonicalPoolKey(marketId)))) {
            revert InvalidCanonicalPoolKey();
        }
    }

    function _requireHookCaller(address expected) internal view {
        if (msg.sender != expected) revert UnauthorizedHookCaller(msg.sender, expected);
    }

    function _nextSourceVersion(bytes32 marketId, uint32 sourceVersion) internal pure returns (uint32) {
        if (sourceVersion == type(uint32).max) revert HookSourceVersionOverflow(marketId, sourceVersion);
        return sourceVersion + 1;
    }

    function _isContract(address account) private view returns (bool) {
        return account.code.length != 0;
    }
}
