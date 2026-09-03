// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MarketView} from "../interfaces/IV2Protocol.sol";
import {ProtocolFeeVaultV4Accounting} from "./ProtocolFeeVaultV4Accounting.sol";

/// @notice Exact dual-asset recovery-cap freeze for the atomic Emergency transition.
abstract contract ProtocolFeeVaultRecoveryCaps is ProtocolFeeVaultV4Accounting {
    uint8 private constant MARKET_STATUS_PAUSED = 1;
    uint8 private constant MARKET_STATUS_RETIRED = 2;

    struct FrozenRecoverySnapshot {
        uint64 snapshotBlock;
        bytes32 stateHash;
        address quoteAsset;
        address memeAsset;
        uint256 quoteCap;
        uint256 memeCap;
    }

    address internal immutable _feeMarketController;
    mapping(bytes32 marketId => mapping(uint32 recoveryEpoch => FrozenRecoverySnapshot value)) private
        _recoverySnapshots;

    event RecoveryCapsFrozen(
        bytes32 indexed marketId,
        uint32 indexed recoveryEpoch,
        uint64 snapshotBlock,
        bytes32 stateHash,
        address quoteAsset,
        uint256 quoteCap,
        address memeAsset,
        uint256 memeCap
    );

    error InvalidRecoveryController(address controller);
    error UnauthorizedMarketController(address caller, address expected);
    error InvalidRecoverySnapshot(bytes32 marketId, uint32 recoveryEpoch, uint64 snapshotBlock, bytes32 stateHash);
    error RecoveryCapsAlreadyFrozen(bytes32 marketId, uint32 recoveryEpoch);
    error RecoveryCapSnapshotMismatch(bytes32 marketId, uint32 recoveryEpoch);

    constructor(
        address marketRegistry_,
        address poolManager_,
        address creatorRevenueRegistry_,
        address platformTreasury_,
        bytes32 feePolicyId_,
        address marketController_
    )
        ProtocolFeeVaultV4Accounting(
            marketRegistry_, poolManager_, creatorRevenueRegistry_, platformTreasury_, feePolicyId_
        )
    {
        if (
            marketController_ == address(0) || marketController_ == address(this)
                || marketController_ == marketRegistry_ || marketController_ == poolManager_
                || marketController_ == creatorRevenueRegistry_ || marketController_ == platformTreasury_
        ) revert InvalidRecoveryController(marketController_);
        _feeMarketController = marketController_;
    }

    function freezeRecoveryCaps(bytes32 marketId, uint32 recoveryEpoch, uint64 snapshotBlock, bytes32 stateHash)
        external
        returns (uint256 quoteCap, uint256 memeCap)
    {
        if (msg.sender != _feeMarketController) {
            revert UnauthorizedMarketController(msg.sender, _feeMarketController);
        }
        MarketView memory value = _feeMarketRegistry.market(marketId);
        if (
            marketId == bytes32(0) || recoveryEpoch == 0 || recoveryEpoch != value.runtime.recoveryEpoch + 1
                || stateHash == bytes32(0) || block.number == 0 || block.number > type(uint64).max
                || snapshotBlock != uint64(block.number - 1)
                || (value.runtime.marketStatus != MARKET_STATUS_PAUSED
                    && value.runtime.marketStatus != MARKET_STATUS_RETIRED)
                || value.config.marketController != _feeMarketController || value.config.gauge == address(0)
                || value.config.memeToken == address(0) || value.config.quoteAsset == value.config.memeToken
        ) revert InvalidRecoverySnapshot(marketId, recoveryEpoch, snapshotBlock, stateHash);

        FrozenRecoverySnapshot storage stored = _recoverySnapshots[marketId][recoveryEpoch];
        if (stored.stateHash != bytes32(0)) revert RecoveryCapsAlreadyFrozen(marketId, recoveryEpoch);

        quoteCap = _bucketLiability(marketId, value.config.quoteAsset, BUCKET_STAKER_REWARD);
        memeCap = _bucketLiability(marketId, value.config.memeToken, BUCKET_STAKER_REWARD);
        stored.snapshotBlock = snapshotBlock;
        stored.stateHash = stateHash;
        stored.quoteAsset = value.config.quoteAsset;
        stored.memeAsset = value.config.memeToken;
        stored.quoteCap = quoteCap;
        stored.memeCap = memeCap;

        emit RecoveryCapsFrozen(
            marketId,
            recoveryEpoch,
            snapshotBlock,
            stateHash,
            value.config.quoteAsset,
            quoteCap,
            value.config.memeToken,
            memeCap
        );
    }

    function recoverySnapshot(bytes32 marketId, uint32 recoveryEpoch)
        external
        view
        returns (uint64 snapshotBlock, bytes32 stateHash)
    {
        FrozenRecoverySnapshot storage stored = _recoverySnapshots[marketId][recoveryEpoch];
        return (stored.snapshotBlock, stored.stateHash);
    }

    function recoveryCap(bytes32 marketId, uint32 recoveryEpoch, address feeAsset) external view returns (uint256) {
        FrozenRecoverySnapshot storage stored = _recoverySnapshots[marketId][recoveryEpoch];
        if (feeAsset == stored.quoteAsset) return stored.quoteCap;
        if (feeAsset == stored.memeAsset) return stored.memeCap;
        return 0;
    }

    function _frozenRecoverySnapshot(bytes32 marketId, uint32 recoveryEpoch)
        internal
        view
        returns (FrozenRecoverySnapshot storage)
    {
        return _recoverySnapshots[marketId][recoveryEpoch];
    }
}
