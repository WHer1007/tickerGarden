// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {AssetView, IMarketRegistryV2, IOfficialStockRegistryV2, MarketView} from "../interfaces/IV2Protocol.sol";

/// @notice Immutable identity and authorization boundary shared by the per-asset UserStockVault implementation.
/// @dev The Vault must exist before OfficialStockRegistryV2 can bind it, so construction freezes the intended
///      identity and every later state-changing path revalidates the registry's write-once canonical binding.
abstract contract UserStockVaultIdentity {
    uint8 internal constant ASSET_STATUS_ACTIVE = 1;

    IOfficialStockRegistryV2 internal immutable _officialStockRegistry;
    IMarketRegistryV2 internal immutable _marketRegistry;
    IERC20 internal immutable _stockToken;
    address internal immutable _allocationManager;
    bytes32 internal immutable _assetUid;

    error InvalidVaultIdentity(
        address officialStockRegistry,
        address marketRegistry,
        address allocationManager,
        bytes32 assetUid,
        address stockToken
    );
    error NonCanonicalVaultBinding(
        bytes32 assetUid,
        address expectedStockToken,
        address actualStockToken,
        address expectedVault,
        address actualVault
    );
    error AssetNotActive(bytes32 assetUid, uint8 status);
    error InvalidMarketId(bytes32 marketId);
    error MarketAssetMismatch(bytes32 marketId, bytes32 expectedAssetUid, bytes32 actualAssetUid);
    error UnauthorizedAllocationManager(address caller, address expectedAllocationManager);

    constructor(
        address officialStockRegistry_,
        address marketRegistry_,
        address allocationManager_,
        bytes32 assetUid_,
        address stockToken_
    ) {
        if (
            officialStockRegistry_.code.length == 0 || marketRegistry_.code.length == 0
                || allocationManager_.code.length == 0 || stockToken_.code.length == 0 || assetUid_ == bytes32(0)
                || officialStockRegistry_ == marketRegistry_ || officialStockRegistry_ == allocationManager_
                || officialStockRegistry_ == stockToken_ || marketRegistry_ == allocationManager_
                || marketRegistry_ == stockToken_ || allocationManager_ == stockToken_
        ) {
            revert InvalidVaultIdentity(
                officialStockRegistry_, marketRegistry_, allocationManager_, assetUid_, stockToken_
            );
        }

        _officialStockRegistry = IOfficialStockRegistryV2(officialStockRegistry_);
        _marketRegistry = IMarketRegistryV2(marketRegistry_);
        _allocationManager = allocationManager_;
        _assetUid = assetUid_;
        _stockToken = IERC20(stockToken_);
    }

    modifier onlyAllocationManager() {
        if (msg.sender != _allocationManager) {
            revert UnauthorizedAllocationManager(msg.sender, _allocationManager);
        }
        _;
    }

    function _canonicalAsset() internal view returns (AssetView memory assetView) {
        assetView = _officialStockRegistry.asset(_assetUid);
        if (assetView.stockToken != address(_stockToken) || assetView.userStockVault != address(this)) {
            revert NonCanonicalVaultBinding(
                _assetUid, address(_stockToken), assetView.stockToken, address(this), assetView.userStockVault
            );
        }
    }

    function _activeCanonicalAsset() internal view returns (AssetView memory assetView) {
        assetView = _canonicalAsset();
        if (assetView.status != ASSET_STATUS_ACTIVE) revert AssetNotActive(_assetUid, assetView.status);
    }

    function _canonicalMarket(bytes32 marketId) internal view returns (MarketView memory marketView) {
        if (marketId == bytes32(0)) revert InvalidMarketId(marketId);
        _canonicalAsset();
        marketView = _marketRegistry.market(marketId);
        if (marketView.config.assetUid != _assetUid) {
            revert MarketAssetMismatch(marketId, _assetUid, marketView.config.assetUid);
        }
    }
}
