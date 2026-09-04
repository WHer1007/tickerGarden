// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AssetView, IMarketRegistryV1, IOfficialStockRegistryV1, MarketView} from "../interfaces/IV1Protocol.sol";

/// @notice Immutable dependency and authorization boundary shared by the multi-asset UserStockVault.
/// @dev Asset identity always comes from OfficialStockRegistryV1. Callers provide an Asset UID, never a token address,
///      and every state-changing path revalidates the write-once Registry binding before touching an asset ledger.
abstract contract UserStockVaultIdentity {
    uint8 internal constant ASSET_STATUS_ACTIVE = 1;
    uint8 internal constant ASSET_STATUS_RETIRED = 3;
    bytes32 internal constant VAULT_SCHEMA_ID = keccak256("TickerGarden.UserStockVault.MultiAsset.v6");

    IOfficialStockRegistryV1 internal immutable _officialStockRegistry;
    IMarketRegistryV1 internal immutable _marketRegistry;
    address internal immutable _allocationManager;

    error InvalidVaultIdentity(address officialStockRegistry, address marketRegistry, address allocationManager);
    error InvalidAssetUid(bytes32 assetUid);
    error NonCanonicalVaultBinding(bytes32 assetUid, address stockToken, address expectedVault, address actualVault);
    error InvalidCanonicalAsset(bytes32 assetUid, address stockToken, uint8 status);
    error AssetNotActive(bytes32 assetUid, uint8 status);
    error AssetIdentityDrift(bytes32 assetUid);
    error InvalidMarketId(bytes32 marketId);
    error MarketAssetMismatch(bytes32 marketId, bytes32 expectedAssetUid, bytes32 actualAssetUid);
    error UnauthorizedAllocationManager(address caller, address expectedAllocationManager);

    constructor(address officialStockRegistry_, address marketRegistry_, address allocationManager_) {
        if (
            officialStockRegistry_.code.length == 0 || marketRegistry_.code.length == 0
                || allocationManager_.code.length == 0 || officialStockRegistry_ == marketRegistry_
                || officialStockRegistry_ == allocationManager_ || marketRegistry_ == allocationManager_
        ) {
            revert InvalidVaultIdentity(officialStockRegistry_, marketRegistry_, allocationManager_);
        }

        _officialStockRegistry = IOfficialStockRegistryV1(officialStockRegistry_);
        _marketRegistry = IMarketRegistryV1(marketRegistry_);
        _allocationManager = allocationManager_;
    }

    modifier onlyAllocationManager() {
        if (msg.sender != _allocationManager) {
            revert UnauthorizedAllocationManager(msg.sender, _allocationManager);
        }
        _;
    }

    function _canonicalAsset(bytes32 assetUid) internal view returns (AssetView memory assetView) {
        if (assetUid == bytes32(0)) revert InvalidAssetUid(assetUid);
        assetView = _officialStockRegistry.asset(assetUid);
        if (
            assetView.stockToken.code.length == 0 || assetView.status < ASSET_STATUS_ACTIVE
                || assetView.status > ASSET_STATUS_RETIRED
        ) {
            revert InvalidCanonicalAsset(assetUid, assetView.stockToken, assetView.status);
        }
        if (assetView.userStockVault != address(this)) {
            revert NonCanonicalVaultBinding(assetUid, assetView.stockToken, address(this), assetView.userStockVault);
        }
    }

    function _activeCanonicalAsset(bytes32 assetUid) internal view returns (AssetView memory assetView) {
        assetView = _canonicalAsset(assetUid);
        if (assetView.status != ASSET_STATUS_ACTIVE) revert AssetNotActive(assetUid, assetView.status);
        if (!_officialStockRegistry.assetIdentityCurrent(assetUid)) revert AssetIdentityDrift(assetUid);
    }

    function _canonicalMarket(bytes32 assetUid, bytes32 marketId) internal view returns (MarketView memory marketView) {
        _canonicalAsset(assetUid);
        return _marketForAsset(assetUid, marketId);
    }

    function _marketForAsset(bytes32 assetUid, bytes32 marketId) internal view returns (MarketView memory marketView) {
        if (marketId == bytes32(0)) revert InvalidMarketId(marketId);
        marketView = _marketRegistry.market(marketId);
        if (marketView.config.assetUid != assetUid) {
            revert MarketAssetMismatch(marketId, assetUid, marketView.config.assetUid);
        }
    }
}
