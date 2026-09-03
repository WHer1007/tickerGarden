// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AssetView, IOfficialStockRegistryV2, IUserStockVault} from "../interfaces/IV2Protocol.sol";
import {ImmutableAccessManaged} from "../shared/ImmutableAccessManaged.sol";

/// @notice Append-only canonical STOCK identities and admission status for TickerGarden V2.
contract OfficialStockRegistryV2 is IOfficialStockRegistryV2, ImmutableAccessManaged {
    uint8 internal constant ASSET_STATUS_UNSET = 0;
    uint8 internal constant ASSET_STATUS_ACTIVE = 1;
    uint8 internal constant ASSET_STATUS_PAUSED = 2;
    uint8 internal constant ASSET_STATUS_RETIRED = 3;
    uint8 internal constant MIN_TOKEN_DECIMALS = 6;
    uint8 internal constant MAX_TOKEN_DECIMALS = 18;

    mapping(bytes32 assetUid => AssetView value) private _assets;
    mapping(address stockToken => bytes32 assetUid) private _assetUidByStockToken;
    mapping(address userStockVault => bytes32 schemaId) private _vaultSchemaIds;
    mapping(bytes32 schemaId => address userStockVault) private _vaultBySchemaIds;

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
    error InvalidStateTransition(uint8 currentState, uint8 requestedState);

    constructor(address authority_) ImmutableAccessManaged(authority_) {}

    function registerAsset(bytes32 assetUid, address stockToken, uint8 tokenDecimals, address userStockVault)
        external
        override
        restricted
    {
        if (
            assetUid == bytes32(0) || stockToken == address(0) || userStockVault == address(0)
                || stockToken == userStockVault || stockToken.code.length == 0 || userStockVault.code.length == 0
                || tokenDecimals < MIN_TOKEN_DECIMALS || tokenDecimals > MAX_TOKEN_DECIMALS
        ) {
            revert InvalidAssetIdentity(assetUid, stockToken, tokenDecimals, userStockVault);
        }
        if (_assets[assetUid].status != ASSET_STATUS_UNSET) revert AssetAlreadyRegistered(assetUid);

        bytes32 tokenAssetUid = _assetUidByStockToken[stockToken];
        if (tokenAssetUid != bytes32(0)) revert StockTokenAlreadyRegistered(stockToken, tokenAssetUid);

        _registerVaultIdentityIfNeeded(userStockVault);

        _assets[assetUid] = AssetView({
            stockToken: stockToken,
            userStockVault: userStockVault,
            tokenDecimals: tokenDecimals,
            status: ASSET_STATUS_ACTIVE
        });
        _assetUidByStockToken[stockToken] = assetUid;

        emit AssetRegistered(assetUid, stockToken, userStockVault, tokenDecimals);
    }

    function pauseAsset(bytes32 assetUid, bytes32 reasonHash) external override restricted {
        AssetView storage value = _assets[assetUid];
        if (value.status != ASSET_STATUS_ACTIVE) {
            revert InvalidStateTransition(value.status, ASSET_STATUS_PAUSED);
        }
        value.status = ASSET_STATUS_PAUSED;
        emit AssetStatusChanged(assetUid, ASSET_STATUS_ACTIVE, ASSET_STATUS_PAUSED, reasonHash);
    }

    function unpauseAsset(bytes32 assetUid) external override restricted {
        AssetView storage value = _assets[assetUid];
        if (value.status != ASSET_STATUS_PAUSED) {
            revert InvalidStateTransition(value.status, ASSET_STATUS_ACTIVE);
        }
        value.status = ASSET_STATUS_ACTIVE;
        emit AssetStatusChanged(assetUid, ASSET_STATUS_PAUSED, ASSET_STATUS_ACTIVE, bytes32(0));
    }

    function retireAsset(bytes32 assetUid, bytes32 reasonHash) external override restricted {
        AssetView storage value = _assets[assetUid];
        uint8 oldStatus = value.status;
        if (oldStatus != ASSET_STATUS_ACTIVE && oldStatus != ASSET_STATUS_PAUSED) {
            revert InvalidStateTransition(oldStatus, ASSET_STATUS_RETIRED);
        }
        value.status = ASSET_STATUS_RETIRED;
        emit AssetStatusChanged(assetUid, oldStatus, ASSET_STATUS_RETIRED, reasonHash);
    }

    function asset(bytes32 assetUid) external view override returns (AssetView memory) {
        return _assets[assetUid];
    }

    function vaultSchemaId(address userStockVault) external view override returns (bytes32) {
        return _vaultSchemaIds[userStockVault];
    }

    function vaultForSchema(bytes32 schemaId) external view override returns (address) {
        return _vaultBySchemaIds[schemaId];
    }

    function _registerVaultIdentityIfNeeded(address userStockVault) private {
        if (_vaultSchemaIds[userStockVault] != bytes32(0)) return;

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
        emit StockVaultRegistered(userStockVault, schemaId, reportedMarketRegistry, reportedAllocationManager);
    }
}
