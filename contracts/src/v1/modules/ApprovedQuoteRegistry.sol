// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    AssetView,
    IApprovedQuoteRegistry,
    IOfficialStockRegistryV1,
    QuoteAssetConfig,
    StockQuoteBinding,
    StockTokenFingerprint
} from "../interfaces/IV1Protocol.sol";
import {DelayedUnpause} from "../shared/DelayedUnpause.sol";
import {ImmutableAccessManaged} from "../shared/ImmutableAccessManaged.sol";

/// @notice Append-only, content-addressed Quote economics approved for new V1 markets.
/// @dev Administrators approve Quote assets after risk review, including upgradeable ERC-20 proxies.
///      The optional Stock binding path retains its explicit fingerprint commitment; it is not mandatory admission.
contract ApprovedQuoteRegistry is IApprovedQuoteRegistry, ImmutableAccessManaged, DelayedUnpause {
    uint8 internal constant QUOTE_STATUS_UNSET = 0;
    uint8 internal constant QUOTE_STATUS_ACTIVE = 1;
    uint8 internal constant QUOTE_STATUS_PAUSED = 2;
    uint8 internal constant QUOTE_STATUS_RETIRED = 3;
    uint8 internal constant MIN_QUOTE_DECIMALS = 6;
    uint8 internal constant MAX_QUOTE_DECIMALS = 18;
    uint256 internal constant QUOTE_ECONOMICS_SCHEMA_VERSION = 1;
    uint256 internal constant STOCK_QUOTE_FINGERPRINT_SCHEMA_VERSION = 1;
    uint256 internal constant STOCK_QUOTE_ECONOMICS_SCHEMA_VERSION = 1;
    uint256 internal constant MAX_GRADUATION_AMOUNT = uint256(uint128(type(int128).max));
    bytes32 internal constant QUOTE_ECONOMICS_DOMAIN = keccak256("TICKERGARDEN_V1_QUOTE_ECONOMICS");
    bytes32 internal constant STOCK_QUOTE_FINGERPRINT_DOMAIN = keccak256("TICKERGARDEN_V1_STOCK_QUOTE_FINGERPRINT");
    bytes32 internal constant STOCK_QUOTE_ECONOMICS_DOMAIN = keccak256("TICKERGARDEN_V1_STOCK_QUOTE_ECONOMICS");
    bytes4 private constant DECIMALS_SELECTOR = 0x313ce567;
    bytes4 private constant AUTHORITY_SELECTOR = 0xbf7e214f;

    address public immutable override officialStockRegistry;

    mapping(bytes32 configId => QuoteAssetConfig value) private _quoteConfigs;
    mapping(bytes32 configId => StockQuoteBinding value) private _stockQuoteBindings;
    mapping(bytes32 configId => bytes32 runtimeCodeHash) private _quoteRuntimeCodeHashes;

    error InvalidQuoteConfig(bytes32 configId);
    error QuoteConfigAlreadyExists(bytes32 configId);
    error InvalidQuoteAsset(address quoteAsset, uint8 quoteDecimals);
    error InvalidOfficialStockRegistry(address registry, address expectedAuthority, address observedAuthority);
    error InvalidStockQuoteBinding(bytes32 configId, bytes32 assetUid);
    error StockQuoteAssetNotActive(bytes32 assetUid, uint8 status);
    error StockQuoteAssetMismatch(
        bytes32 assetUid, address expectedToken, address suppliedToken, uint8 expectedDecimals, uint8 suppliedDecimals
    );
    error StockQuoteRequiresImmutableBeacon(bytes32 assetUid, address quoteAsset);
    error StockQuoteAssetIdentityDrift(bytes32 assetUid);
    error InvalidStockQuoteFingerprint(bytes32 assetUid, bytes32 suppliedHash, bytes32 expectedHash);
    error ForbiddenQuoteOpcode(address quoteAsset, bytes1 opcode);
    error QuoteAssetIdentityDrift(bytes32 configId);
    error InvalidEconomicsHash(bytes32 configId, bytes32 suppliedHash, bytes32 expectedHash);
    error InvalidStateTransition(uint8 currentState, uint8 requestedState);

    constructor(address authority_, address officialStockRegistry_) ImmutableAccessManaged(authority_) {
        address observedAuthority = _registryAuthority(officialStockRegistry_);
        if (officialStockRegistry_.code.length == 0 || observedAuthority != authority_) {
            revert InvalidOfficialStockRegistry(officialStockRegistry_, authority_, observedAuthority);
        }
        officialStockRegistry = officialStockRegistry_;
    }

    function addQuoteConfig(bytes32 configId, QuoteAssetConfig calldata config) external override restricted {
        _validateConfigShape(configId, config);

        bytes32 runtimeCodeHash = _observeQuoteAsset(config.quoteAsset, config.quoteDecimals);
        bytes32 expectedHash = keccak256(
            abi.encode(
                QUOTE_ECONOMICS_DOMAIN,
                QUOTE_ECONOMICS_SCHEMA_VERSION,
                block.chainid,
                config.ponsBaselineId,
                config.quoteAsset,
                config.quoteDecimals,
                config.phantomQuote,
                config.graduationThreshold
            )
        );
        if (configId != expectedHash || config.economicsHash != expectedHash) {
            revert InvalidEconomicsHash(configId, config.economicsHash, expectedHash);
        }

        _storeQuoteConfig(configId, config, runtimeCodeHash);
    }

    function addStockQuoteConfig(bytes32 configId, QuoteAssetConfig calldata config, StockQuoteBinding calldata binding)
        external
        override
        restricted
    {
        _validateConfigShape(configId, config);
        if (
            binding.assetUid == bytes32(0) || binding.stockTokenFingerprintHash == bytes32(0)
                || binding.referenceEvidenceHash == bytes32(0) || binding.generatorPolicyId == bytes32(0)
                || config.quoteAsset == address(0)
        ) revert InvalidStockQuoteBinding(configId, binding.assetUid);

        IOfficialStockRegistryV1 stockRegistry = IOfficialStockRegistryV1(officialStockRegistry);
        AssetView memory asset = stockRegistry.asset(binding.assetUid);
        if (asset.status != QUOTE_STATUS_ACTIVE) revert StockQuoteAssetNotActive(binding.assetUid, asset.status);
        if (asset.stockToken != config.quoteAsset || asset.tokenDecimals != config.quoteDecimals) {
            revert StockQuoteAssetMismatch(
                binding.assetUid, asset.stockToken, config.quoteAsset, asset.tokenDecimals, config.quoteDecimals
            );
        }
        if (!stockRegistry.assetIdentityCurrent(binding.assetUid)) {
            revert StockQuoteAssetIdentityDrift(binding.assetUid);
        }

        StockTokenFingerprint memory fingerprint = stockRegistry.assetFingerprint(binding.assetUid);
        if (fingerprint.beacon == address(0)) {
            revert StockQuoteRequiresImmutableBeacon(binding.assetUid, config.quoteAsset);
        }
        bytes32 expectedFingerprintHash = _stockQuoteFingerprintHash(binding.assetUid, asset, fingerprint);
        if (binding.stockTokenFingerprintHash != expectedFingerprintHash) {
            revert InvalidStockQuoteFingerprint(
                binding.assetUid, binding.stockTokenFingerprintHash, expectedFingerprintHash
            );
        }

        bytes32 expectedHash = _stockQuoteEconomicsHash(config, binding);
        if (configId != expectedHash || config.economicsHash != expectedHash) {
            revert InvalidEconomicsHash(configId, config.economicsHash, expectedHash);
        }

        _stockQuoteBindings[configId] = binding;
        _storeQuoteConfig(configId, config, fingerprint.tokenRuntimeCodeHash);
        emit StockQuoteConfigBound(
            configId,
            binding.assetUid,
            config.quoteAsset,
            binding.stockTokenFingerprintHash,
            binding.referenceEvidenceHash,
            binding.generatorPolicyId
        );
    }

    function pauseQuote(bytes32 configId, bytes32 reasonHash) external override restricted {
        QuoteAssetConfig storage config = _quoteConfigs[configId];
        if (config.status != QUOTE_STATUS_ACTIVE) {
            revert InvalidStateTransition(config.status, QUOTE_STATUS_PAUSED);
        }
        config.status = QUOTE_STATUS_PAUSED;
        _recordPause(configId);
        emit QuoteAssetStatusChanged(configId, QUOTE_STATUS_ACTIVE, QUOTE_STATUS_PAUSED, reasonHash);
    }

    function unpauseQuote(bytes32 configId) external override restricted {
        QuoteAssetConfig storage config = _quoteConfigs[configId];
        if (config.status != QUOTE_STATUS_PAUSED) {
            revert InvalidStateTransition(config.status, QUOTE_STATUS_ACTIVE);
        }
        _requireUnpauseReady(configId);
        if (!_quoteIdentityCurrent(configId, config)) revert QuoteAssetIdentityDrift(configId);
        config.status = QUOTE_STATUS_ACTIVE;
        _clearPauseTimestamp(configId);
        emit QuoteAssetStatusChanged(configId, QUOTE_STATUS_PAUSED, QUOTE_STATUS_ACTIVE, bytes32(0));
    }

    function retireQuote(bytes32 configId, bytes32 reasonHash) external override restricted {
        QuoteAssetConfig storage config = _quoteConfigs[configId];
        uint8 oldStatus = config.status;
        if (oldStatus != QUOTE_STATUS_ACTIVE && oldStatus != QUOTE_STATUS_PAUSED) {
            revert InvalidStateTransition(oldStatus, QUOTE_STATUS_RETIRED);
        }
        config.status = QUOTE_STATUS_RETIRED;
        _clearPauseTimestamp(configId);
        emit QuoteAssetStatusChanged(configId, oldStatus, QUOTE_STATUS_RETIRED, reasonHash);
    }

    function quoteConfig(bytes32 configId) external view override returns (QuoteAssetConfig memory) {
        return _quoteConfigs[configId];
    }

    function stockQuoteBinding(bytes32 configId) external view override returns (StockQuoteBinding memory) {
        return _stockQuoteBindings[configId];
    }

    function quoteRuntimeCodeHash(bytes32 configId) external view override returns (bytes32) {
        return _quoteRuntimeCodeHashes[configId];
    }

    function quoteIdentityCurrent(bytes32 configId) external view override returns (bool) {
        QuoteAssetConfig storage config = _quoteConfigs[configId];
        return _quoteIdentityCurrent(configId, config);
    }

    function _observeQuoteAsset(address quoteAsset, uint8 quoteDecimals)
        private
        view
        returns (bytes32 runtimeCodeHash)
    {
        if (quoteAsset == address(0)) {
            if (quoteDecimals != 18) revert InvalidQuoteAsset(quoteAsset, quoteDecimals);
            return bytes32(0);
        }
        if (quoteAsset.code.length == 0) revert InvalidQuoteAsset(quoteAsset, quoteDecimals);

        _requireQuoteDecimals(quoteAsset, quoteDecimals);
        runtimeCodeHash = quoteAsset.codehash;
        if (runtimeCodeHash == bytes32(0)) revert InvalidQuoteAsset(quoteAsset, quoteDecimals);
    }

    function _quoteIdentityCurrent(bytes32 configId, QuoteAssetConfig storage config) private view returns (bool) {
        if (config.status == QUOTE_STATUS_UNSET) return false;
        StockQuoteBinding storage binding = _stockQuoteBindings[configId];
        if (binding.assetUid != bytes32(0)) return _stockQuoteIdentityCurrent(configId, config, binding);
        if (config.quoteAsset == address(0)) {
            return config.quoteDecimals == 18 && _quoteRuntimeCodeHashes[configId] == bytes32(0);
        }
        bytes32 expectedCodeHash = _quoteRuntimeCodeHashes[configId];
        if (expectedCodeHash == bytes32(0) || config.quoteAsset.codehash != expectedCodeHash) return false;

        (bool success, bytes memory result) = config.quoteAsset.staticcall(abi.encodeWithSelector(DECIMALS_SELECTOR));
        return success && result.length == 32 && abi.decode(result, (uint256)) == config.quoteDecimals;
    }

    function _stockQuoteIdentityCurrent(
        bytes32 configId,
        QuoteAssetConfig storage config,
        StockQuoteBinding storage binding
    ) private view returns (bool) {
        bytes32 expectedRuntimeCodeHash = _quoteRuntimeCodeHashes[configId];
        if (
            expectedRuntimeCodeHash == bytes32(0) || config.quoteAsset.codehash != expectedRuntimeCodeHash
                || !_decimalsMatch(config.quoteAsset, config.quoteDecimals)
        ) return false;

        IOfficialStockRegistryV1 stockRegistry = IOfficialStockRegistryV1(officialStockRegistry);
        AssetView memory asset;
        try stockRegistry.asset(binding.assetUid) returns (AssetView memory value) {
            asset = value;
        } catch {
            return false;
        }
        if (
            asset.status != QUOTE_STATUS_ACTIVE || asset.stockToken != config.quoteAsset
                || asset.tokenDecimals != config.quoteDecimals
        ) return false;
        try stockRegistry.assetIdentityCurrent(binding.assetUid) returns (bool current) {
            if (!current) return false;
        } catch {
            return false;
        }

        StockTokenFingerprint memory fingerprint;
        try stockRegistry.assetFingerprint(binding.assetUid) returns (StockTokenFingerprint memory value) {
            fingerprint = value;
        } catch {
            return false;
        }
        return fingerprint.beacon != address(0)
            && _stockQuoteFingerprintHash(binding.assetUid, asset, fingerprint) == binding.stockTokenFingerprintHash;
    }

    function _validateConfigShape(bytes32 configId, QuoteAssetConfig calldata config) private view {
        if (
            configId == bytes32(0) || config.ponsBaselineId == bytes32(0) || config.status != QUOTE_STATUS_ACTIVE
                || config.quoteDecimals < MIN_QUOTE_DECIMALS || config.quoteDecimals > MAX_QUOTE_DECIMALS
                || config.phantomQuote == 0 || config.graduationThreshold == 0
                || config.phantomQuote > MAX_GRADUATION_AMOUNT || config.graduationThreshold > MAX_GRADUATION_AMOUNT
                || config.phantomQuote > type(uint256).max - config.graduationThreshold
        ) revert InvalidQuoteConfig(configId);
        if (_quoteConfigs[configId].status != QUOTE_STATUS_UNSET) revert QuoteConfigAlreadyExists(configId);
    }

    function _storeQuoteConfig(bytes32 configId, QuoteAssetConfig calldata config, bytes32 runtimeCodeHash) private {
        _quoteConfigs[configId] = config;
        _quoteRuntimeCodeHashes[configId] = runtimeCodeHash;
        emit QuoteAssetConfigAdded(configId, config.quoteAsset, config.ponsBaselineId, config.economicsHash);
        emit QuoteAssetIdentityPinned(configId, config.quoteAsset, runtimeCodeHash);
    }

    function _stockQuoteFingerprintHash(
        bytes32 assetUid,
        AssetView memory asset,
        StockTokenFingerprint memory fingerprint
    ) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                STOCK_QUOTE_FINGERPRINT_DOMAIN,
                STOCK_QUOTE_FINGERPRINT_SCHEMA_VERSION,
                block.chainid,
                assetUid,
                asset.stockToken,
                asset.tokenDecimals,
                fingerprint.tokenRuntimeCodeHash,
                fingerprint.beacon,
                fingerprint.beaconRuntimeCodeHash,
                fingerprint.implementation,
                fingerprint.implementationRuntimeCodeHash
            )
        );
    }

    function _stockQuoteEconomicsHash(QuoteAssetConfig calldata config, StockQuoteBinding calldata binding)
        private
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                STOCK_QUOTE_ECONOMICS_DOMAIN,
                STOCK_QUOTE_ECONOMICS_SCHEMA_VERSION,
                block.chainid,
                config.ponsBaselineId,
                config.quoteAsset,
                config.quoteDecimals,
                config.phantomQuote,
                config.graduationThreshold,
                binding.assetUid,
                binding.stockTokenFingerprintHash,
                binding.referenceEvidenceHash,
                binding.generatorPolicyId
            )
        );
    }

    function _requireQuoteDecimals(address quoteAsset, uint8 quoteDecimals) private view {
        (bool success, bytes memory result) = quoteAsset.staticcall(abi.encodeWithSelector(DECIMALS_SELECTOR));
        if (!success || result.length != 32) revert InvalidQuoteAsset(quoteAsset, quoteDecimals);
        uint256 observedDecimals = abi.decode(result, (uint256));
        if (observedDecimals != quoteDecimals) revert InvalidQuoteAsset(quoteAsset, quoteDecimals);
    }

    function _decimalsMatch(address quoteAsset, uint8 quoteDecimals) private view returns (bool) {
        (bool success, bytes memory result) = quoteAsset.staticcall(abi.encodeWithSelector(DECIMALS_SELECTOR));
        return success && result.length == 32 && abi.decode(result, (uint256)) == quoteDecimals;
    }

    function _registryAuthority(address registry) private view returns (address observedAuthority) {
        if (registry.code.length == 0) return address(0);
        (bool success, bytes memory result) = registry.staticcall(abi.encodeWithSelector(AUTHORITY_SELECTOR));
        if (!success || result.length != 32) return address(0);
        uint256 encoded = abi.decode(result, (uint256));
        if (encoded > type(uint160).max) return address(0);
        observedAuthority = address(uint160(encoded));
    }
}
