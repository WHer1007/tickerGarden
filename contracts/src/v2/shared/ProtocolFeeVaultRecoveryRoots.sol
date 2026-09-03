// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MarketView, RecoveryRootView} from "../interfaces/IV2Protocol.sol";
import {ImmutableAccessManaged} from "./ImmutableAccessManaged.sol";
import {ProtocolFeeVaultRecoveryCaps} from "./ProtocolFeeVaultRecoveryCaps.sol";

/// @notice Delayed, challengeable and terminal Recovery-root lifecycle.
abstract contract ProtocolFeeVaultRecoveryRoots is ProtocolFeeVaultRecoveryCaps, ImmutableAccessManaged {
    uint8 internal constant RECOVERY_ROOT_NONE = 0;
    uint8 internal constant RECOVERY_ROOT_PENDING = 1;
    uint8 internal constant RECOVERY_ROOT_ACTIVE = 2;
    uint8 internal constant RECOVERY_ROOT_CANCELLED = 3;
    uint8 private constant MARKET_STATUS_EMERGENCY_EXIT = 3;
    uint64 private constant ROOT_CHALLENGE_SECONDS = 2 days;

    mapping(
        bytes32 marketId => mapping(uint32 recoveryEpoch => mapping(address feeAsset => RecoveryRootView value))
    ) internal _recoveryRoots;

    event RecoveryRootProposed(
        bytes32 indexed marketId,
        uint32 indexed recoveryEpoch,
        address indexed feeAsset,
        uint32 proposalNonce,
        bytes32 root,
        uint256 declaredTotal,
        uint64 finalizableAt
    );
    event RecoveryRootCancelled(
        bytes32 indexed marketId, uint32 indexed recoveryEpoch, address indexed feeAsset, uint32 proposalNonce
    );
    event RecoveryRootFinalized(
        bytes32 indexed marketId,
        uint32 indexed recoveryEpoch,
        address indexed feeAsset,
        uint32 proposalNonce,
        bytes32 root,
        uint256 declaredTotal
    );

    error InvalidRecoveryRoot(bytes32 root, uint256 declaredTotal);
    error RecoveryCapExceeded(address feeAsset, uint256 requested, uint256 cap);
    error InvalidRecoveryRootState(uint8 currentState, uint8 requiredState);
    error InvalidRecoveryProposalNonce(uint32 supplied, uint32 expected);
    error RecoveryRootNotFinalizable(uint64 finalizableAt);
    error RecoveryTimestampOverflow(uint256 timestamp);

    constructor(
        address authority_,
        address marketRegistry_,
        address poolManager_,
        address creatorRevenueRegistry_,
        address platformTreasury_,
        bytes32 feePolicyId_,
        address marketController_
    )
        ProtocolFeeVaultRecoveryCaps(
            marketRegistry_, poolManager_, creatorRevenueRegistry_, platformTreasury_, feePolicyId_, marketController_
        )
        ImmutableAccessManaged(authority_)
    {}

    function proposeRecoveryRoot(
        bytes32 marketId,
        uint32 recoveryEpoch,
        address feeAsset,
        bytes32 root,
        uint256 declaredTotal
    ) external restricted returns (uint32 proposalNonce, uint64 finalizableAt) {
        if (root == bytes32(0) || declaredTotal == 0) revert InvalidRecoveryRoot(root, declaredTotal);
        _requireEmergencyEpoch(marketId, recoveryEpoch);
        uint256 cap = _canonicalRecoveryCap(marketId, recoveryEpoch, feeAsset);
        if (declaredTotal > cap) revert RecoveryCapExceeded(feeAsset, declaredTotal, cap);

        RecoveryRootView storage value = _recoveryRoots[marketId][recoveryEpoch][feeAsset];
        if (value.status != RECOVERY_ROOT_NONE && value.status != RECOVERY_ROOT_CANCELLED) {
            revert InvalidRecoveryRootState(value.status, RECOVERY_ROOT_CANCELLED);
        }
        proposalNonce = value.proposalNonce + 1;
        uint256 finalizable = block.timestamp + ROOT_CHALLENGE_SECONDS;
        if (block.timestamp > type(uint64).max || finalizable > type(uint64).max) {
            revert RecoveryTimestampOverflow(finalizable);
        }
        finalizableAt = uint64(finalizable);
        value.root = root;
        value.declaredTotal = declaredTotal;
        value.claimedTotal = 0;
        value.proposedAt = uint64(block.timestamp);
        value.finalizableAt = finalizableAt;
        value.proposalNonce = proposalNonce;
        value.status = RECOVERY_ROOT_PENDING;
        emit RecoveryRootProposed(marketId, recoveryEpoch, feeAsset, proposalNonce, root, declaredTotal, finalizableAt);
    }

    function cancelRecoveryRoot(bytes32 marketId, uint32 recoveryEpoch, address feeAsset, uint32 proposalNonce)
        external
        restricted
    {
        RecoveryRootView storage value = _recoveryRoots[marketId][recoveryEpoch][feeAsset];
        if (value.status != RECOVERY_ROOT_PENDING) {
            revert InvalidRecoveryRootState(value.status, RECOVERY_ROOT_PENDING);
        }
        if (proposalNonce != value.proposalNonce) {
            revert InvalidRecoveryProposalNonce(proposalNonce, value.proposalNonce);
        }
        value.status = RECOVERY_ROOT_CANCELLED;
        emit RecoveryRootCancelled(marketId, recoveryEpoch, feeAsset, proposalNonce);
    }

    function finalizeRecoveryRoot(bytes32 marketId, uint32 recoveryEpoch, address feeAsset, uint32 proposalNonce)
        external
    {
        RecoveryRootView storage value = _recoveryRoots[marketId][recoveryEpoch][feeAsset];
        if (value.status != RECOVERY_ROOT_PENDING) {
            revert InvalidRecoveryRootState(value.status, RECOVERY_ROOT_PENDING);
        }
        if (proposalNonce != value.proposalNonce) {
            revert InvalidRecoveryProposalNonce(proposalNonce, value.proposalNonce);
        }
        if (block.timestamp < value.finalizableAt) revert RecoveryRootNotFinalizable(value.finalizableAt);
        _requireEmergencyEpoch(marketId, recoveryEpoch);
        value.status = RECOVERY_ROOT_ACTIVE;
        emit RecoveryRootFinalized(marketId, recoveryEpoch, feeAsset, proposalNonce, value.root, value.declaredTotal);
    }

    function recoveryRoot(bytes32 marketId, uint32 recoveryEpoch, address feeAsset)
        external
        view
        returns (RecoveryRootView memory)
    {
        return _recoveryRoots[marketId][recoveryEpoch][feeAsset];
    }

    function _requireEmergencyEpoch(bytes32 marketId, uint32 recoveryEpoch) internal view {
        MarketView memory marketValue = _feeMarketRegistry.market(marketId);
        FrozenRecoverySnapshot storage snapshot = _frozenRecoverySnapshot(marketId, recoveryEpoch);
        if (
            marketValue.runtime.marketStatus != MARKET_STATUS_EMERGENCY_EXIT
                || marketValue.runtime.recoveryEpoch != recoveryEpoch || snapshot.stateHash == bytes32(0)
        ) revert InvalidRecoveryRoot(bytes32(0), 0);
    }

    function _canonicalRecoveryCap(bytes32 marketId, uint32 recoveryEpoch, address feeAsset)
        internal
        view
        returns (uint256 cap)
    {
        FrozenRecoverySnapshot storage snapshot = _frozenRecoverySnapshot(marketId, recoveryEpoch);
        if (feeAsset == snapshot.quoteAsset) return snapshot.quoteCap;
        if (feeAsset == snapshot.memeAsset) return snapshot.memeCap;
        revert FeeAssetNotCanonical(feeAsset);
    }
}
