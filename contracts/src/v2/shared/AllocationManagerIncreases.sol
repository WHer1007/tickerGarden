// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {
    AssetView,
    IMarketRegistryV2,
    IMemeStockGauge,
    IOfficialStockRegistryV2,
    IUserStockVault,
    MarketView,
    PositionView
} from "../interfaces/IV2Protocol.sol";

/// @notice Shared allocate/increase path for the final AllocationManager.
/// @dev Quote status intentionally does not gate an existing PoolCreated market: V2-EXEC-4 limits later Quote
///      status changes to new-market admission, while Market status is the explicit historical-market control.
abstract contract AllocationManagerIncreases is ReentrancyGuard {
    uint8 internal constant ASSET_STATUS_ACTIVE = 1;
    uint8 internal constant LAUNCH_PHASE_POOL_CREATED = 2;
    uint8 internal constant MARKET_STATUS_ACTIVE = 0;
    uint64 internal constant ACTIVATION_DELAY = 30 seconds;
    uint64 internal constant MINIMUM_LOCK = 24 hours;

    IOfficialStockRegistryV2 internal immutable _officialStockRegistry;
    IMarketRegistryV2 internal immutable _marketRegistry;

    struct IncreaseContext {
        IUserStockVault vault;
        IMemeStockGauge gauge;
        bytes32 assetUid;
        uint256 minimumAllocation;
        uint64 activationAt;
        uint64 unlockAt;
    }

    error InvalidAllocationManagerDependencies(address officialStockRegistry, address marketRegistry);
    error InvalidAllocationUser(address user);
    error InvalidAllocationAmount(uint256 amount);
    error StockAllocationClosed(bytes32 marketId);
    error InvalidAllocationComponents(bytes32 marketId, address vault, address gauge);
    error InvalidAssetMinimumAllocation(bytes32 assetUid, uint256 minimumAllocation);
    error PositionBelowMinimum(uint256 position, uint256 minimumPosition);
    error AllocationLedgerMismatch();
    error AllocationTimestampOverflow(uint256 timestamp);

    constructor(address officialStockRegistry_, address marketRegistry_) {
        if (
            officialStockRegistry_.code.length == 0 || marketRegistry_.code.length == 0
                || officialStockRegistry_ == marketRegistry_
        ) {
            revert InvalidAllocationManagerDependencies(officialStockRegistry_, marketRegistry_);
        }
        _officialStockRegistry = IOfficialStockRegistryV2(officialStockRegistry_);
        _marketRegistry = IMarketRegistryV2(marketRegistry_);
    }

    function _increaseAllocation(address user, bytes32 marketId, uint256 amount) internal nonReentrant {
        _validateAllocationRequest(user, amount);

        IncreaseContext memory context = _openAllocationMarket(marketId);
        (context.activationAt, context.unlockAt) = _allocationTimes();

        _executeIncrease(user, marketId, amount, context);
    }

    function _executeIncrease(address user, bytes32 marketId, uint256 amount, IncreaseContext memory context) internal {
        context.gauge.checkpointActivations();
        context.gauge.settle(user);

        uint256 currentPosition = _checkedPosition(context.gauge, context.vault, context.assetUid, user, marketId);

        uint256 resultingPosition = currentPosition + amount;
        if (resultingPosition < context.minimumAllocation) {
            revert PositionBelowMinimum(resultingPosition, context.minimumAllocation);
        }

        context.vault.lockAllocation(context.assetUid, user, marketId, amount);
        context.gauge.addPending(user, amount, context.activationAt, context.unlockAt);
        if (_checkedPosition(context.gauge, context.vault, context.assetUid, user, marketId) != resultingPosition) {
            revert AllocationLedgerMismatch();
        }
    }

    function _openAllocationMarket(bytes32 marketId) internal view returns (IncreaseContext memory context) {
        MarketView memory marketView;
        AssetView memory assetView;
        (marketView, assetView, context.vault, context.gauge) = _allocationComponents(marketId);
        if (
            marketView.runtime.launchPhase != LAUNCH_PHASE_POOL_CREATED
                || marketView.runtime.marketStatus != MARKET_STATUS_ACTIVE || assetView.status != ASSET_STATUS_ACTIVE
        ) {
            revert StockAllocationClosed(marketId);
        }
        context.assetUid = marketView.config.assetUid;
        context.minimumAllocation = _minimumAllocation(context.assetUid);
    }

    function _allocationComponents(bytes32 marketId)
        internal
        view
        returns (MarketView memory marketView, AssetView memory assetView, IUserStockVault vault, IMemeStockGauge gauge)
    {
        if (marketId == bytes32(0)) revert StockAllocationClosed(marketId);
        marketView = _marketRegistry.market(marketId);
        assetView = _officialStockRegistry.asset(marketView.config.assetUid);
        if (
            assetView.status == 0 || assetView.status > 3 || assetView.tokenDecimals < 6 || assetView.tokenDecimals > 18
                || assetView.stockToken.code.length == 0 || assetView.userStockVault.code.length == 0
                || marketView.config.gauge.code.length == 0 || assetView.stockToken == assetView.userStockVault
                || assetView.stockToken == marketView.config.gauge
                || assetView.userStockVault == marketView.config.gauge
        ) {
            revert InvalidAllocationComponents(marketId, assetView.userStockVault, marketView.config.gauge);
        }
        vault = IUserStockVault(assetView.userStockVault);
        gauge = IMemeStockGauge(marketView.config.gauge);
    }

    function _checkedPosition(
        IMemeStockGauge gauge,
        IUserStockVault vault,
        bytes32 assetUid,
        address user,
        bytes32 marketId
    ) internal view returns (uint256 amount) {
        PositionView memory position = gauge.positionOf(user);
        amount = position.activeAmount + position.pendingAmount;
        if (amount != vault.allocation(assetUid, user, marketId)) revert AllocationLedgerMismatch();
    }

    function _minimumAllocation(bytes32 assetUid) internal view returns (uint256 minimum) {
        minimum = _officialStockRegistry.minimumAllocation(assetUid);
        if (minimum == 0) revert InvalidAssetMinimumAllocation(assetUid, minimum);
    }

    function _validateAllocationRequest(address user, uint256 amount) internal view {
        if (user == address(0) || user == address(this)) revert InvalidAllocationUser(user);
        if (amount == 0) revert InvalidAllocationAmount(amount);
    }

    function _allocationTimes() internal view returns (uint64 activationAt, uint64 unlockAt) {
        if (block.timestamp > type(uint64).max - MINIMUM_LOCK) {
            revert AllocationTimestampOverflow(block.timestamp);
        }
        activationAt = uint64(block.timestamp + ACTIVATION_DELAY);
        unlockAt = uint64(block.timestamp + MINIMUM_LOCK);
    }
}
