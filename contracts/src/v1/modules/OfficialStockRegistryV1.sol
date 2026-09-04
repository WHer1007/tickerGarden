// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    AssetView,
    IOfficialStockRegistryV1,
    IUserStockVault,
    StockTokenFingerprint
} from "../interfaces/IV1Protocol.sol";
import {DelayedUnpause} from "../shared/DelayedUnpause.sol";
import {ImmutableAccessManaged} from "../shared/ImmutableAccessManaged.sol";

/// @notice Append-only canonical STOCK identities and admission status for TickerGarden V1.
contract OfficialStockRegistryV1 is IOfficialStockRegistryV1, ImmutableAccessManaged, DelayedUnpause {
    uint8 internal constant ASSET_STATUS_UNSET = 0;
    uint8 internal constant ASSET_STATUS_ACTIVE = 1;
    uint8 internal constant ASSET_STATUS_PAUSED = 2;
    uint8 internal constant ASSET_STATUS_RETIRED = 3;
    uint8 internal constant MIN_TOKEN_DECIMALS = 6;
    uint8 internal constant MAX_TOKEN_DECIMALS = 18;
    bytes4 private constant UID_SELECTOR = 0xf514ce36;
    bytes4 private constant DECIMALS_SELECTOR = 0x313ce567;
    bytes4 private constant IMPLEMENTATION_SELECTOR = 0x5c60da1b;
    bytes14 private constant IMMUTABLE_BEACON_SUFFIX = 0x6001600160a01b0316635c60da1b;
    /// @dev Lowest raw-unit denominator that keeps the documented uint48 lifetime accumulator bound inside uint256.
    uint256 internal constant MINIMUM_SAFE_ALLOCATION_RAW = 414;

    mapping(bytes32 assetUid => AssetView value) private _assets;
    mapping(bytes32 assetUid => StockTokenFingerprint value) private _assetFingerprints;
    mapping(bytes32 assetUid => uint256 amount) private _minimumAllocations;
    mapping(address stockToken => bytes32 assetUid) private _assetUidByStockToken;
    mapping(address userStockVault => bytes32 schemaId) private _vaultSchemaIds;
    mapping(bytes32 schemaId => address userStockVault) private _vaultBySchemaIds;
    mapping(address userStockVault => bytes32 runtimeCodeHash) private _vaultRuntimeCodeHashes;
    mapping(address userStockVault => address marketRegistry) private _vaultMarketRegistries;
    mapping(address userStockVault => address allocationManager) private _vaultAllocationManagers;

    error InvalidAssetIdentity(bytes32 assetUid, address stockToken, uint8 tokenDecimals, address userStockVault);
    error AssetAlreadyRegistered(bytes32 assetUid);
    error StockTokenAlreadyRegistered(address stockToken, bytes32 assetUid);
    error InvalidUserStockVaultIdentity(
        address userStockVault,
        address reportedOfficialStockRegistry,
        address reportedMarketRegistry,
        address reportedAllocationManager,
        bytes32 reportedSchemaId
    );
    error VaultSchemaAlreadyRegistered(bytes32 schemaId, address registeredVault, address attemptedVault);
    error InvalidUserStockVaultCodeIdentity(address userStockVault, bytes32 expectedHash, bytes32 observedHash);
    error UserStockVaultIdentityDrift(address userStockVault);
    error InvalidStateTransition(uint8 currentState, uint8 requestedState);
    error InvalidMinimumAllocation(bytes32 assetUid, uint256 minimumAllocation);
    error AssetNotRegistered(bytes32 assetUid);
    error StockTokenIdentityCallFailed(address stockToken, bytes4 selector);
    error StockTokenUidMismatch(address stockToken, bytes32 expectedUid, bytes32 reportedUid);
    error StockTokenDecimalsMismatch(address stockToken, uint8 expectedDecimals, uint256 reportedDecimals);
    error UnsupportedStockTokenProxy(address stockToken, address expectedBeacon, address embeddedBeacon);
    error StockTokenFingerprintMismatch(bytes32 assetUid, bytes32 expectedHash, bytes32 observedHash);
    error AssetIdentityDrift(bytes32 assetUid);
    error InvalidAssetImplementation(
        bytes32 assetUid,
        address expectedImplementation,
        bytes32 expectedCodeHash,
        address observedImplementation,
        bytes32 observedCodeHash
    );
    error UnmonitoredDelegateProxy(address component);
    error DirectAssetImplementationImmutable(bytes32 assetUid);

    constructor(address authority_) ImmutableAccessManaged(authority_) {}

    function registerAsset(
        bytes32 assetUid,
        address stockToken,
        uint8 tokenDecimals,
        address userStockVault,
        uint256 minimumAllocation_,
        StockTokenFingerprint calldata expectedFingerprint
    ) external override restricted {
        if (
            assetUid == bytes32(0) || stockToken == address(0) || userStockVault == address(0)
                || stockToken == userStockVault || stockToken.code.length == 0 || userStockVault.code.length == 0
                || tokenDecimals < MIN_TOKEN_DECIMALS || tokenDecimals > MAX_TOKEN_DECIMALS
        ) {
            revert InvalidAssetIdentity(assetUid, stockToken, tokenDecimals, userStockVault);
        }
        if (minimumAllocation_ < MINIMUM_SAFE_ALLOCATION_RAW) {
            revert InvalidMinimumAllocation(assetUid, minimumAllocation_);
        }
        if (_assets[assetUid].status != ASSET_STATUS_UNSET) revert AssetAlreadyRegistered(assetUid);

        bytes32 tokenAssetUid = _assetUidByStockToken[stockToken];
        if (tokenAssetUid != bytes32(0)) revert StockTokenAlreadyRegistered(stockToken, tokenAssetUid);

        _validateReportedIdentity(assetUid, stockToken, tokenDecimals);
        StockTokenFingerprint memory observedFingerprint =
            _observeFingerprint(assetUid, stockToken, expectedFingerprint.beacon);
        bytes32 expectedFingerprintHash = keccak256(abi.encode(expectedFingerprint));
        bytes32 observedFingerprintHash = keccak256(abi.encode(observedFingerprint));
        if (expectedFingerprintHash != observedFingerprintHash) {
            revert StockTokenFingerprintMismatch(assetUid, expectedFingerprintHash, observedFingerprintHash);
        }

        _registerVaultIdentityIfNeeded(userStockVault);

        _assets[assetUid] = AssetView({
            stockToken: stockToken,
            userStockVault: userStockVault,
            tokenDecimals: tokenDecimals,
            status: ASSET_STATUS_ACTIVE
        });
        _assetFingerprints[assetUid] = observedFingerprint;
        _minimumAllocations[assetUid] = minimumAllocation_;
        _assetUidByStockToken[stockToken] = assetUid;

        emit AssetRegistered(assetUid, stockToken, userStockVault, tokenDecimals);
        emit StockTokenFingerprintRegistered(
            assetUid,
            observedFingerprint.tokenRuntimeCodeHash,
            observedFingerprint.beacon,
            observedFingerprint.beaconRuntimeCodeHash,
            observedFingerprint.implementation,
            observedFingerprint.implementationRuntimeCodeHash
        );
        emit AssetMinimumAllocationChanged(assetUid, 0, minimumAllocation_, bytes32(0));
    }

    function acceptAssetImplementation(
        bytes32 assetUid,
        address expectedImplementation,
        bytes32 expectedImplementationRuntimeCodeHash,
        bytes32 reasonHash
    ) external override restricted {
        AssetView storage value = _assets[assetUid];
        if (value.status != ASSET_STATUS_PAUSED) {
            revert InvalidStateTransition(value.status, ASSET_STATUS_PAUSED);
        }

        StockTokenFingerprint storage fingerprint = _assetFingerprints[assetUid];
        if (fingerprint.beacon == address(0)) revert DirectAssetImplementationImmutable(assetUid);
        if (!_baseIdentityCurrent(assetUid, value, fingerprint)) revert AssetIdentityDrift(assetUid);

        (bool implementationOk, address observedImplementation) =
            _tryReadAddress(fingerprint.beacon, IMPLEMENTATION_SELECTOR);
        bytes32 observedCodeHash = observedImplementation.codehash;
        if (
            !implementationOk || expectedImplementation == address(0) || expectedImplementation.code.length == 0
                || observedImplementation != expectedImplementation
                || observedCodeHash != expectedImplementationRuntimeCodeHash
                || expectedImplementation == fingerprint.implementation
        ) {
            revert InvalidAssetImplementation(
                assetUid,
                expectedImplementation,
                expectedImplementationRuntimeCodeHash,
                observedImplementation,
                observedCodeHash
            );
        }
        if (_containsDelegateExecution(expectedImplementation)) {
            revert UnmonitoredDelegateProxy(expectedImplementation);
        }

        address oldImplementation = fingerprint.implementation;
        bytes32 oldImplementationRuntimeCodeHash = fingerprint.implementationRuntimeCodeHash;
        fingerprint.implementation = expectedImplementation;
        fingerprint.implementationRuntimeCodeHash = expectedImplementationRuntimeCodeHash;
        emit AssetImplementationAccepted(
            assetUid,
            oldImplementation,
            expectedImplementation,
            oldImplementationRuntimeCodeHash,
            expectedImplementationRuntimeCodeHash,
            reasonHash
        );
    }

    function setMinimumAllocation(bytes32 assetUid, uint256 newMinimum, bytes32 reasonHash)
        external
        override
        restricted
    {
        if (_assets[assetUid].status == ASSET_STATUS_UNSET) revert AssetNotRegistered(assetUid);
        if (newMinimum < MINIMUM_SAFE_ALLOCATION_RAW) revert InvalidMinimumAllocation(assetUid, newMinimum);

        uint256 oldMinimum = _minimumAllocations[assetUid];
        _minimumAllocations[assetUid] = newMinimum;
        emit AssetMinimumAllocationChanged(assetUid, oldMinimum, newMinimum, reasonHash);
    }

    function pauseAsset(bytes32 assetUid, bytes32 reasonHash) external override restricted {
        AssetView storage value = _assets[assetUid];
        if (value.status != ASSET_STATUS_ACTIVE) {
            revert InvalidStateTransition(value.status, ASSET_STATUS_PAUSED);
        }
        value.status = ASSET_STATUS_PAUSED;
        _recordPause(assetUid);
        emit AssetStatusChanged(assetUid, ASSET_STATUS_ACTIVE, ASSET_STATUS_PAUSED, reasonHash);
    }

    function unpauseAsset(bytes32 assetUid) external override restricted {
        AssetView storage value = _assets[assetUid];
        if (value.status != ASSET_STATUS_PAUSED) {
            revert InvalidStateTransition(value.status, ASSET_STATUS_ACTIVE);
        }
        _requireUnpauseReady(assetUid);
        if (!_assetIdentityCurrent(assetUid)) revert AssetIdentityDrift(assetUid);
        value.status = ASSET_STATUS_ACTIVE;
        _clearPauseTimestamp(assetUid);
        emit AssetStatusChanged(assetUid, ASSET_STATUS_PAUSED, ASSET_STATUS_ACTIVE, bytes32(0));
    }

    function retireAsset(bytes32 assetUid, bytes32 reasonHash) external override restricted {
        AssetView storage value = _assets[assetUid];
        uint8 oldStatus = value.status;
        if (oldStatus != ASSET_STATUS_ACTIVE && oldStatus != ASSET_STATUS_PAUSED) {
            revert InvalidStateTransition(oldStatus, ASSET_STATUS_RETIRED);
        }
        value.status = ASSET_STATUS_RETIRED;
        _clearPauseTimestamp(assetUid);
        emit AssetStatusChanged(assetUid, oldStatus, ASSET_STATUS_RETIRED, reasonHash);
    }

    function asset(bytes32 assetUid) external view override returns (AssetView memory) {
        return _assets[assetUid];
    }

    function assetFingerprint(bytes32 assetUid) external view override returns (StockTokenFingerprint memory) {
        return _assetFingerprints[assetUid];
    }

    function assetIdentityCurrent(bytes32 assetUid) external view override returns (bool) {
        return _assetIdentityCurrent(assetUid);
    }

    function minimumAllocation(bytes32 assetUid) external view override returns (uint256) {
        return _minimumAllocations[assetUid];
    }

    function vaultSchemaId(address userStockVault) external view override returns (bytes32) {
        return _vaultSchemaIds[userStockVault];
    }

    function vaultForSchema(bytes32 schemaId) external view override returns (address) {
        return _vaultBySchemaIds[schemaId];
    }

    function vaultRuntimeCodeHash(address userStockVault) external view override returns (bytes32) {
        return _vaultRuntimeCodeHashes[userStockVault];
    }

    function vaultIdentityCurrent(address userStockVault) external view override returns (bool) {
        return _vaultIdentityCurrent(userStockVault);
    }

    function _assetIdentityCurrent(bytes32 assetUid) private view returns (bool) {
        AssetView storage value = _assets[assetUid];
        if (value.status == ASSET_STATUS_UNSET) return false;
        if (!_vaultIdentityCurrent(value.userStockVault)) return false;
        StockTokenFingerprint storage fingerprint = _assetFingerprints[assetUid];
        if (!_baseIdentityCurrent(assetUid, value, fingerprint)) return false;
        if (fingerprint.beacon == address(0)) {
            return fingerprint.implementation == value.stockToken
                && fingerprint.implementationRuntimeCodeHash == fingerprint.tokenRuntimeCodeHash;
        }

        (bool implementationOk, address currentImplementation) =
            _tryReadAddress(fingerprint.beacon, IMPLEMENTATION_SELECTOR);
        return implementationOk && currentImplementation == fingerprint.implementation
            && currentImplementation.codehash == fingerprint.implementationRuntimeCodeHash;
    }

    function _baseIdentityCurrent(bytes32 assetUid, AssetView storage value, StockTokenFingerprint storage fingerprint)
        private
        view
        returns (bool)
    {
        if (
            value.stockToken.code.length == 0 || value.stockToken.codehash != fingerprint.tokenRuntimeCodeHash
                || (fingerprint.beacon != address(0)
                    && (fingerprint.beacon.code.length == 0
                        || fingerprint.beacon.codehash != fingerprint.beaconRuntimeCodeHash))
        ) return false;

        (bool uidOk, bytes32 reportedUid) = _tryReadBytes32(value.stockToken, UID_SELECTOR);
        (bool decimalsOk, uint256 reportedDecimals) = _tryReadUint256(value.stockToken, DECIMALS_SELECTOR);
        return uidOk && reportedUid == assetUid && decimalsOk && reportedDecimals == value.tokenDecimals;
    }

    function _validateReportedIdentity(bytes32 assetUid, address stockToken, uint8 tokenDecimals) private view {
        (bool uidOk, bytes32 reportedUid) = _tryReadBytes32(stockToken, UID_SELECTOR);
        if (!uidOk) revert StockTokenIdentityCallFailed(stockToken, UID_SELECTOR);
        if (reportedUid != assetUid) revert StockTokenUidMismatch(stockToken, assetUid, reportedUid);

        (bool decimalsOk, uint256 reportedDecimals) = _tryReadUint256(stockToken, DECIMALS_SELECTOR);
        if (!decimalsOk) revert StockTokenIdentityCallFailed(stockToken, DECIMALS_SELECTOR);
        if (reportedDecimals != tokenDecimals) {
            revert StockTokenDecimalsMismatch(stockToken, tokenDecimals, reportedDecimals);
        }
    }

    function _observeFingerprint(bytes32 assetUid, address stockToken, address expectedBeacon)
        private
        view
        returns (StockTokenFingerprint memory observed)
    {
        observed.tokenRuntimeCodeHash = stockToken.codehash;
        (address embeddedBeacon, bool unambiguous) = _embeddedImmutableBeacon(stockToken);
        if (!unambiguous || embeddedBeacon != expectedBeacon) {
            revert UnsupportedStockTokenProxy(stockToken, expectedBeacon, embeddedBeacon);
        }

        if (expectedBeacon == address(0)) {
            // A token admitted as direct must not be an unmonitored proxy. Runtime code-hash
            // pinning cannot detect implementation-slot upgrades when DELEGATECALL/CALLCODE
            // remains in otherwise unchanged proxy bytecode.
            if (_containsDelegateExecution(stockToken)) {
                revert UnmonitoredDelegateProxy(stockToken);
            }
            observed.implementation = stockToken;
            observed.implementationRuntimeCodeHash = observed.tokenRuntimeCodeHash;
            return observed;
        }
        if (expectedBeacon.code.length == 0) {
            revert UnsupportedStockTokenProxy(stockToken, expectedBeacon, embeddedBeacon);
        }
        if (_containsDelegateExecution(expectedBeacon)) revert UnmonitoredDelegateProxy(expectedBeacon);

        observed.beacon = expectedBeacon;
        observed.beaconRuntimeCodeHash = expectedBeacon.codehash;
        (bool implementationOk, address implementation) = _tryReadAddress(expectedBeacon, IMPLEMENTATION_SELECTOR);
        if (!implementationOk || implementation.code.length == 0) {
            revert InvalidAssetImplementation(assetUid, address(0), bytes32(0), implementation, implementation.codehash);
        }
        if (_containsDelegateExecution(implementation)) revert UnmonitoredDelegateProxy(implementation);
        observed.implementation = implementation;
        observed.implementationRuntimeCodeHash = implementation.codehash;
    }

    function _embeddedImmutableBeacon(address stockToken) private view returns (address candidate, bool unambiguous) {
        bytes memory runtime = stockToken.code;
        uint256 patternLength = 47;
        if (runtime.length < patternLength) return (address(0), true);

        uint256 limit = runtime.length - patternLength;
        for (uint256 offset; offset <= limit; ++offset) {
            if (uint8(runtime[offset]) != 0x7f) continue;
            bool matches = true;
            for (uint256 index; index < 12; ++index) {
                if (runtime[offset + 1 + index] != bytes1(0)) {
                    matches = false;
                    break;
                }
            }
            if (!matches) continue;
            for (uint256 index; index < 14; ++index) {
                if (runtime[offset + 33 + index] != IMMUTABLE_BEACON_SUFFIX[index]) {
                    matches = false;
                    break;
                }
            }
            if (!matches) continue;

            uint160 rawAddress;
            for (uint256 index; index < 20; ++index) {
                rawAddress = (rawAddress << 8) | uint160(uint8(runtime[offset + 13 + index]));
            }
            address found = address(rawAddress);
            if (found == address(0)) continue;
            if (candidate != address(0) && candidate != found) return (address(0), false);
            candidate = found;
        }
        return (candidate, true);
    }

    function _containsDelegateExecution(address stockToken) private view returns (bool) {
        bytes memory runtime = stockToken.code;
        for (uint256 offset; offset < runtime.length; ++offset) {
            uint8 opcode = uint8(runtime[offset]);
            if (opcode == 0xf2 || opcode == 0xf4) return true; // CALLCODE or DELEGATECALL
            if (opcode >= 0x60 && opcode <= 0x7f) {
                offset += opcode - 0x5f; // Skip PUSH1..PUSH32 immediate data.
            }
        }
        return false;
    }

    function _tryReadBytes32(address target, bytes4 selector) private view returns (bool ok, bytes32 value) {
        bytes memory result;
        (ok, result) = target.staticcall(abi.encodeWithSelector(selector));
        if (!ok || result.length != 32) return (false, bytes32(0));
        value = abi.decode(result, (bytes32));
    }

    function _tryReadUint256(address target, bytes4 selector) private view returns (bool ok, uint256 value) {
        bytes memory result;
        (ok, result) = target.staticcall(abi.encodeWithSelector(selector));
        if (!ok || result.length != 32) return (false, 0);
        value = abi.decode(result, (uint256));
    }

    function _tryReadAddress(address target, bytes4 selector) private view returns (bool ok, address value) {
        bytes memory result;
        (ok, result) = target.staticcall(abi.encodeWithSelector(selector));
        if (!ok || result.length != 32) return (false, address(0));
        uint256 encoded = abi.decode(result, (uint256));
        if (encoded > type(uint160).max) return (false, address(0));
        value = address(uint160(encoded));
        ok = value != address(0);
    }

    function _registerVaultIdentityIfNeeded(address userStockVault) private {
        if (_vaultSchemaIds[userStockVault] != bytes32(0)) {
            if (!_vaultIdentityCurrent(userStockVault)) revert UserStockVaultIdentityDrift(userStockVault);
            return;
        }

        bytes32 observedCodeHash = userStockVault.codehash;
        if (
            userStockVault.code.length == 0 || observedCodeHash == bytes32(0)
                || _containsForbiddenVaultOpcode(userStockVault)
        ) {
            revert InvalidUserStockVaultCodeIdentity(userStockVault, bytes32(0), observedCodeHash);
        }

        try IUserStockVault(userStockVault).vaultIdentity() returns (
            address reportedRegistry,
            address reportedMarketRegistry,
            address reportedAllocationManager,
            bytes32 schemaId
        ) {
            _validateAndRecordVaultIdentity(
                userStockVault, reportedRegistry, reportedMarketRegistry, reportedAllocationManager, schemaId
            );
        } catch {
            revert InvalidUserStockVaultIdentity(userStockVault, address(0), address(0), address(0), bytes32(0));
        }
    }

    function _validateAndRecordVaultIdentity(
        address userStockVault,
        address reportedRegistry,
        address reportedMarketRegistry,
        address reportedAllocationManager,
        bytes32 schemaId
    ) private {
        if (
            reportedRegistry != address(this) || reportedMarketRegistry.code.length == 0
                || reportedAllocationManager.code.length == 0 || schemaId == bytes32(0)
                || reportedMarketRegistry == reportedAllocationManager || reportedMarketRegistry == userStockVault
                || reportedAllocationManager == userStockVault
        ) {
            revert InvalidUserStockVaultIdentity(
                userStockVault, reportedRegistry, reportedMarketRegistry, reportedAllocationManager, schemaId
            );
        }

        address registeredVault = _vaultBySchemaIds[schemaId];
        if (registeredVault != address(0) && registeredVault != userStockVault) {
            revert VaultSchemaAlreadyRegistered(schemaId, registeredVault, userStockVault);
        }

        _vaultSchemaIds[userStockVault] = schemaId;
        _vaultBySchemaIds[schemaId] = userStockVault;
        bytes32 runtimeCodeHash = userStockVault.codehash;
        _vaultRuntimeCodeHashes[userStockVault] = runtimeCodeHash;
        _vaultMarketRegistries[userStockVault] = reportedMarketRegistry;
        _vaultAllocationManagers[userStockVault] = reportedAllocationManager;
        emit StockVaultRegistered(userStockVault, schemaId, reportedMarketRegistry, reportedAllocationManager);
        emit StockVaultCodeIdentityPinned(userStockVault, runtimeCodeHash);
    }

    function _vaultIdentityCurrent(address userStockVault) private view returns (bool) {
        bytes32 schemaId = _vaultSchemaIds[userStockVault];
        bytes32 runtimeCodeHash = _vaultRuntimeCodeHashes[userStockVault];
        if (
            schemaId == bytes32(0) || runtimeCodeHash == bytes32(0) || userStockVault.code.length == 0
                || userStockVault.codehash != runtimeCodeHash || _vaultBySchemaIds[schemaId] != userStockVault
                || _containsForbiddenVaultOpcode(userStockVault)
        ) return false;

        try IUserStockVault(userStockVault).vaultIdentity() returns (
            address reportedRegistry,
            address reportedMarketRegistry,
            address reportedAllocationManager,
            bytes32 reportedSchemaId
        ) {
            return reportedRegistry == address(this) && reportedSchemaId == schemaId
                && reportedMarketRegistry == _vaultMarketRegistries[userStockVault]
                && reportedAllocationManager == _vaultAllocationManagers[userStockVault]
                && reportedMarketRegistry.code.length != 0 && reportedAllocationManager.code.length != 0
                && reportedMarketRegistry != reportedAllocationManager && reportedMarketRegistry != userStockVault
                && reportedAllocationManager != userStockVault;
        } catch {
            return false;
        }
    }

    function _containsForbiddenVaultOpcode(address userStockVault) private view returns (bool) {
        bytes memory runtime = userStockVault.code;
        for (uint256 offset; offset < runtime.length; ++offset) {
            uint8 opcode = uint8(runtime[offset]);
            if (opcode == 0xf2 || opcode == 0xf4 || opcode == 0xff) return true;
            if (opcode >= 0x60 && opcode <= 0x7f) {
                offset += opcode - 0x5f;
            }
        }
        return false;
    }
}
