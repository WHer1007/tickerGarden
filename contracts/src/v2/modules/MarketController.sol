// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    AssetView,
    IMarketController,
    IMarketRegistryV2,
    IMemeStockGauge,
    IOfficialStockRegistryV2,
    IProtocolFeeVault,
    ITickerGardenMemeHook,
    MarketView
} from "../interfaces/IV2Protocol.sol";
import {ImmutableAccessManaged} from "../shared/ImmutableAccessManaged.sol";

struct MarketControllerInit {
    address authority;
    address marketRegistry;
    address officialStockRegistry;
    address protocolFeeVault;
}

struct EmergencySnapshot {
    uint32 recoveryEpoch;
    uint64 snapshotBlock;
    uint32 sourceVersion;
    address gauge;
    address quoteAsset;
    address memeToken;
    uint256 quoteCap;
    uint256 memeCap;
    uint256 storedTotalActive;
    uint256 totalPending;
}

/// @notice Selector-authorized market lifecycle controller and canonical allocation gate.
contract MarketController is IMarketController, ImmutableAccessManaged {
    uint8 internal constant LAUNCH_PHASE_POOL_CREATED = 2;
    uint8 internal constant MARKET_STATUS_ACTIVE = 0;
    uint8 internal constant MARKET_STATUS_PAUSED = 1;
    uint8 internal constant MARKET_STATUS_RETIRED = 2;
    uint8 internal constant MARKET_STATUS_EMERGENCY_EXIT = 3;
    uint8 internal constant ASSET_STATUS_ACTIVE = 1;
    uint8 internal constant STAKER_REWARD_BUCKET = 1;

    bytes32 internal constant EMERGENCY_STATE_DOMAIN = keccak256("TICKERGARDEN_V2_EMERGENCY_STATE_V1");
    uint256 internal constant EMERGENCY_STATE_SCHEMA_VERSION = 1;

    address public immutable marketRegistry;
    address public immutable officialStockRegistry;
    address public immutable protocolFeeVault;

    error InvalidControllerDependency(address dependency);
    error AliasedControllerDependency(address dependency);
    error InvalidEmergencyBlock(uint256 blockNumber);
    error RecoveryCapSnapshotMismatch(bytes32 marketId, uint32 recoveryEpoch);
    error EmergencyStateHashMismatch(bytes32 expected, bytes32 observed);
    error EmergencyCommitMismatch(uint32 expectedEpoch, uint32 committedEpoch);

    constructor(MarketControllerInit memory init) ImmutableAccessManaged(init.authority) {
        _requireDependency(init.marketRegistry);
        _requireDependency(init.officialStockRegistry);
        _requireDependency(init.protocolFeeVault);
        if (
            init.marketRegistry == init.officialStockRegistry || init.marketRegistry == init.protocolFeeVault
                || init.officialStockRegistry == init.protocolFeeVault || init.authority == init.marketRegistry
                || init.authority == init.officialStockRegistry || init.authority == init.protocolFeeVault
        ) revert AliasedControllerDependency(init.marketRegistry);

        marketRegistry = init.marketRegistry;
        officialStockRegistry = init.officialStockRegistry;
        protocolFeeVault = init.protocolFeeVault;
    }

    function pauseMarket(bytes32 marketId, bytes32 reasonHash) external override restricted {
        IMarketRegistryV2(marketRegistry).setMarketPaused(marketId, reasonHash);
        emit MarketStatusChanged(marketId, MARKET_STATUS_ACTIVE, MARKET_STATUS_PAUSED, reasonHash);
    }

    function unpauseMarket(bytes32 marketId) external override restricted {
        IMarketRegistryV2(marketRegistry).setMarketActive(marketId);
        emit MarketStatusChanged(marketId, MARKET_STATUS_PAUSED, MARKET_STATUS_ACTIVE, bytes32(0));
    }

    function retireMarket(bytes32 marketId, bytes32 reasonHash) external override restricted {
        uint8 oldStatus = IMarketRegistryV2(marketRegistry).market(marketId).runtime.marketStatus;
        IMarketRegistryV2(marketRegistry).setMarketRetired(marketId, reasonHash);
        emit MarketStatusChanged(marketId, oldStatus, MARKET_STATUS_RETIRED, reasonHash);
    }

    function activateEmergencyExit(bytes32 marketId)
        external
        override
        restricted
        returns (uint32 recoveryEpoch, uint64 snapshotBlock, bytes32 stateHash)
    {
        if (block.number == 0 || block.number > type(uint64).max) revert InvalidEmergencyBlock(block.number);

        MarketView memory value = IMarketRegistryV2(marketRegistry).market(marketId);
        EmergencySnapshot memory snapshot;
        snapshot.recoveryEpoch = value.runtime.recoveryEpoch + 1;
        snapshot.snapshotBlock = uint64(block.number - 1);
        snapshot.sourceVersion = value.runtime.sourceVersion;
        snapshot.gauge = value.config.gauge;
        snapshot.quoteAsset = value.config.quoteAsset;
        snapshot.memeToken = value.config.memeToken;
        snapshot.quoteCap =
            IProtocolFeeVault(protocolFeeVault).liability(marketId, value.config.quoteAsset, STAKER_REWARD_BUCKET);
        snapshot.memeCap =
            IProtocolFeeVault(protocolFeeVault).liability(marketId, value.config.memeToken, STAKER_REWARD_BUCKET);
        snapshot.storedTotalActive = IMemeStockGauge(value.config.gauge).storedTotalActiveStock();
        snapshot.totalPending = IMemeStockGauge(value.config.gauge).totalPendingStock();

        recoveryEpoch = snapshot.recoveryEpoch;
        snapshotBlock = snapshot.snapshotBlock;
        stateHash = _stateHash(marketId, snapshot);

        (uint256 frozenQuoteCap, uint256 frozenMemeCap) =
            IProtocolFeeVault(protocolFeeVault).freezeRecoveryCaps(marketId, recoveryEpoch, snapshotBlock, stateHash);
        if (frozenQuoteCap != snapshot.quoteCap || frozenMemeCap != snapshot.memeCap) {
            revert RecoveryCapSnapshotMismatch(marketId, recoveryEpoch);
        }

        IMemeStockGauge(value.config.gauge).disableForEmergency(recoveryEpoch, snapshotBlock, stateHash);
        if (value.runtime.launchPhase == LAUNCH_PHASE_POOL_CREATED) {
            ITickerGardenMemeHook(value.config.graduatedHook).disablePool(value.runtime.poolId);
        }

        uint32 committedEpoch =
            IMarketRegistryV2(marketRegistry).commitEmergencyExit(marketId, snapshotBlock, stateHash);
        if (committedEpoch != recoveryEpoch) revert EmergencyCommitMismatch(recoveryEpoch, committedEpoch);

        emit EmergencyExitActivated(
            marketId, recoveryEpoch, snapshotBlock, stateHash, snapshot.quoteCap, snapshot.memeCap
        );
    }

    function marketStatus(bytes32 marketId) external view override returns (uint8) {
        return IMarketRegistryV2(marketRegistry).market(marketId).runtime.marketStatus;
    }

    function launchPhase(bytes32 marketId) external view override returns (uint8) {
        return IMarketRegistryV2(marketRegistry).market(marketId).runtime.launchPhase;
    }

    function isStockAllocationOpen(bytes32 marketId) external view override returns (bool) {
        MarketView memory value = IMarketRegistryV2(marketRegistry).market(marketId);
        if (
            value.runtime.launchPhase != LAUNCH_PHASE_POOL_CREATED || value.runtime.marketStatus != MARKET_STATUS_ACTIVE
        ) return false;

        AssetView memory asset = IOfficialStockRegistryV2(officialStockRegistry).asset(value.config.assetUid);
        return asset.status == ASSET_STATUS_ACTIVE;
    }

    function _requireDependency(address dependency) private view {
        if (dependency == address(0) || dependency.code.length == 0) {
            revert InvalidControllerDependency(dependency);
        }
    }

    function _stateHash(bytes32 marketId, EmergencySnapshot memory snapshot) private view returns (bytes32) {
        bytes32[16] memory words;
        words[0] = EMERGENCY_STATE_DOMAIN;
        words[1] = bytes32(EMERGENCY_STATE_SCHEMA_VERSION);
        words[2] = bytes32(block.chainid);
        words[3] = bytes32(uint256(uint160(marketRegistry)));
        words[4] = bytes32(uint256(uint160(protocolFeeVault)));
        words[5] = marketId;
        words[6] = bytes32(uint256(snapshot.recoveryEpoch));
        words[7] = bytes32(uint256(snapshot.snapshotBlock));
        words[8] = bytes32(uint256(uint160(snapshot.gauge)));
        words[9] = bytes32(uint256(snapshot.sourceVersion));
        words[10] = bytes32(uint256(uint160(snapshot.quoteAsset)));
        words[11] = bytes32(uint256(uint160(snapshot.memeToken)));
        words[12] = bytes32(snapshot.quoteCap);
        words[13] = bytes32(snapshot.memeCap);
        words[14] = bytes32(snapshot.storedTotalActive);
        words[15] = bytes32(snapshot.totalPending);
        return keccak256(abi.encodePacked(words));
    }
}
