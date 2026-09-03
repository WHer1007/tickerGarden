// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AssetView, IMemeStockGauge, IUserStockVault, MarketView, PositionView} from "../interfaces/IV2Protocol.sol";
import {AllocationManagerDeposits} from "./AllocationManagerDeposits.sol";

/// @notice Shared same-asset, no-overlap migration path for the final AllocationManager.
abstract contract AllocationManagerMigrations is AllocationManagerDeposits {
    error InvalidMigrationMarkets(bytes32 fromMarketId, bytes32 toMarketId);
    error MigrationAssetMismatch(bytes32 sourceAssetUid, bytes32 targetAssetUid);
    error MigrationVaultMismatch(address sourceVault, address targetVault);
    error MigrationGaugeAlias(address gauge);
    error SourcePendingNotMaterialized(bytes32 marketId, uint256 pendingAmount);
    error SourceUnlockChanged(uint64 expectedUnlockAt, uint64 actualUnlockAt);
    error TargetScheduleMismatch(
        uint64 expectedPendingGeneration, uint64 actualPendingGeneration, uint64 expectedUnlockAt, uint64 actualUnlockAt
    );

    struct MigrationContext {
        IUserStockVault vault;
        IMemeStockGauge sourceGauge;
        IMemeStockGauge targetGauge;
        uint8 tokenDecimals;
        uint64 activationAt;
        uint64 targetUnlockAt;
    }

    struct MigrationState {
        uint256 sourceRemaining;
        uint256 targetResult;
        uint64 sourceUnlockAt;
    }

    constructor(address officialStockRegistry_, address marketRegistry_)
        AllocationManagerDeposits(officialStockRegistry_, marketRegistry_)
    {}

    function _migrateAllocation(address user, bytes32 fromMarketId, bytes32 toMarketId, uint256 amount)
        internal
        nonReentrant
        returns (uint256, uint64, uint64)
    {
        _validateAllocationRequest(user, amount);
        if (fromMarketId == toMarketId) revert InvalidMigrationMarkets(fromMarketId, toMarketId);

        MigrationContext memory context = _migrationContext(fromMarketId, toMarketId);
        uint256 targetResult = _preflightTarget(context, user, toMarketId, amount);
        MigrationState memory state = _settleSourceAndValidate(context, user, fromMarketId, amount);
        state.targetResult = targetResult;

        // The migrated amount stops earning at the source before it becomes target pending.
        context.sourceGauge.removeAllocation(user, amount);
        _validateReducedSource(context.sourceGauge, user, state.sourceRemaining, state.sourceUnlockAt);

        context.vault.moveAllocation(user, fromMarketId, toMarketId, amount);
        _validateMovedVault(context.vault, user, fromMarketId, toMarketId, state);

        // Target reward settlement still uses its old Gauge weight after the atomic Vault ledger move.
        context.targetGauge.checkpointActivations();
        context.targetGauge.settle(user);
        if (_gaugePosition(context.targetGauge, user) + amount != state.targetResult) {
            revert AllocationLedgerMismatch();
        }

        context.targetGauge.addPending(user, amount, context.activationAt, context.targetUnlockAt);
        PositionView memory increasedTarget = context.targetGauge.positionOf(user);
        if (increasedTarget.activeAmount + increasedTarget.pendingAmount != state.targetResult) {
            revert AllocationLedgerMismatch();
        }
        if (
            increasedTarget.pendingGeneration != context.activationAt
                || increasedTarget.unlockAt != context.targetUnlockAt
        ) {
            revert TargetScheduleMismatch(
                context.activationAt,
                increasedTarget.pendingGeneration,
                context.targetUnlockAt,
                increasedTarget.unlockAt
            );
        }

        if (_checkedPosition(context.sourceGauge, context.vault, user, fromMarketId) != state.sourceRemaining) {
            revert AllocationLedgerMismatch();
        }
        if (_checkedPosition(context.targetGauge, context.vault, user, toMarketId) != state.targetResult) {
            revert AllocationLedgerMismatch();
        }
        return (state.sourceRemaining, increasedTarget.pendingGeneration, increasedTarget.unlockAt);
    }

    function _settleSourceAndValidate(
        MigrationContext memory context,
        address user,
        bytes32 fromMarketId,
        uint256 amount
    ) private returns (MigrationState memory state) {
        // Source reward settlement and pending materialization must precede removal.
        context.sourceGauge.checkpointActivations();
        context.sourceGauge.settle(user);

        PositionView memory sourcePosition = context.sourceGauge.positionOf(user);
        uint256 sourceAmount = sourcePosition.activeAmount + sourcePosition.pendingAmount;
        if (sourceAmount != context.vault.allocation(user, fromMarketId)) revert AllocationLedgerMismatch();
        if (sourceAmount == 0) revert NoAllocationPosition(user, fromMarketId);
        if (block.timestamp < sourcePosition.unlockAt) revert PositionLockedUntil(sourcePosition.unlockAt);
        if (sourcePosition.pendingAmount != 0) {
            revert SourcePendingNotMaterialized(fromMarketId, sourcePosition.pendingAmount);
        }
        if (amount > sourcePosition.activeAmount) revert InsufficientAllocation(amount, sourcePosition.activeAmount);

        state.sourceRemaining = sourcePosition.activeAmount - amount;
        state.sourceUnlockAt = sourcePosition.unlockAt;
        uint256 minimumPosition = 5 * (10 ** (context.tokenDecimals - 1)) + 1;
        if (state.sourceRemaining != 0 && state.sourceRemaining < minimumPosition) {
            revert PositionBelowMinimum(state.sourceRemaining, minimumPosition);
        }
    }

    function _preflightTarget(MigrationContext memory context, address user, bytes32 toMarketId, uint256 amount)
        private
        view
        returns (uint256 targetResult)
    {
        targetResult = _checkedPosition(context.targetGauge, context.vault, user, toMarketId) + amount;
        uint256 minimumPosition = 5 * (10 ** (context.tokenDecimals - 1)) + 1;
        if (targetResult < minimumPosition) revert PositionBelowMinimum(targetResult, minimumPosition);
    }

    function _validateReducedSource(
        IMemeStockGauge sourceGauge,
        address user,
        uint256 sourceRemaining,
        uint64 sourceUnlockAt
    ) private view {
        PositionView memory reducedSource = sourceGauge.positionOf(user);
        if (reducedSource.activeAmount + reducedSource.pendingAmount != sourceRemaining) {
            revert AllocationLedgerMismatch();
        }
        if (sourceRemaining != 0 && reducedSource.unlockAt != sourceUnlockAt) {
            revert SourceUnlockChanged(sourceUnlockAt, reducedSource.unlockAt);
        }
    }

    function _validateMovedVault(
        IUserStockVault vault,
        address user,
        bytes32 fromMarketId,
        bytes32 toMarketId,
        MigrationState memory state
    ) private view {
        if (
            vault.allocation(user, fromMarketId) != state.sourceRemaining
                || vault.allocation(user, toMarketId) != state.targetResult
        ) revert AllocationLedgerMismatch();
    }

    function _migrationContext(bytes32 fromMarketId, bytes32 toMarketId)
        private
        view
        returns (MigrationContext memory context)
    {
        MarketView memory sourceMarket;
        AssetView memory sourceAsset;
        IUserStockVault sourceVault;
        (sourceMarket, sourceAsset, sourceVault, context.sourceGauge) = _allocationComponents(fromMarketId);
        if (
            sourceMarket.runtime.launchPhase != LAUNCH_PHASE_POOL_CREATED
                || sourceMarket.runtime.marketStatus >= MARKET_STATUS_EMERGENCY_EXIT
        ) revert StockAllocationClosed(fromMarketId);

        MarketView memory targetMarket;
        AssetView memory targetAsset;
        (targetMarket, targetAsset, context.vault, context.targetGauge) = _allocationComponents(toMarketId);
        if (
            targetMarket.runtime.launchPhase != LAUNCH_PHASE_POOL_CREATED
                || targetMarket.runtime.marketStatus != MARKET_STATUS_ACTIVE
                || targetAsset.status != ASSET_STATUS_ACTIVE
        ) revert StockAllocationClosed(toMarketId);

        if (sourceMarket.config.assetUid != targetMarket.config.assetUid) {
            revert MigrationAssetMismatch(sourceMarket.config.assetUid, targetMarket.config.assetUid);
        }
        if (address(sourceVault) != address(context.vault)) {
            revert MigrationVaultMismatch(address(sourceVault), address(context.vault));
        }
        if (address(context.sourceGauge) == address(context.targetGauge)) {
            revert MigrationGaugeAlias(address(context.sourceGauge));
        }

        context.tokenDecimals = sourceAsset.tokenDecimals;
        (context.activationAt, context.targetUnlockAt) = _allocationTimes();
    }
}
