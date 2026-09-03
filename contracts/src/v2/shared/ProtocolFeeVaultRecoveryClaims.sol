// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

import {RecoveryRootView} from "../interfaces/IV2Protocol.sol";
import {ProtocolFeeVaultRecoveryRoots} from "./ProtocolFeeVaultRecoveryRoots.sol";

/// @notice Domain-separated, capped and caller-bound Recovery claims.
abstract contract ProtocolFeeVaultRecoveryClaims is ProtocolFeeVaultRecoveryRoots {
    bytes32 private constant RECOVERY_LEAF_DOMAIN = keccak256("TICKERGARDEN_V2_RECOVERY_LEAF_V1");
    uint256 private constant RECOVERY_LEAF_SCHEMA_VERSION = 1;
    bytes32 private constant EXECUTION_SPEC_ID = keccak256("V2-EXEC-3");

    mapping(bytes32 marketId => mapping(uint32 epoch => mapping(address asset => mapping(address user => bool))))
        private _recoveryClaimed;

    event RecoveryClaimed(
        bytes32 indexed marketId, uint32 indexed recoveryEpoch, address indexed feeAsset, address user, uint256 amount
    );

    error RecoveryAlreadyClaimed(address user, address feeAsset);
    error InvalidRecoveryProof();

    constructor(
        address authority_,
        address marketRegistry_,
        address poolManager_,
        address creatorRevenueRegistry_,
        address platformTreasury_,
        bytes32 feePolicyId_,
        address marketController_
    )
        ProtocolFeeVaultRecoveryRoots(
            authority_,
            marketRegistry_,
            poolManager_,
            creatorRevenueRegistry_,
            platformTreasury_,
            feePolicyId_,
            marketController_
        )
    {}

    function claimRecovery(
        bytes32 marketId,
        uint32 recoveryEpoch,
        address feeAsset,
        uint256 amount,
        bytes32[] calldata proof
    ) external {
        _enterStandaloneOperation(bytes32("CLAIM_RECOVERY"));
        _requireEmergencyEpoch(marketId, recoveryEpoch);
        RecoveryRootView storage value = _recoveryRoots[marketId][recoveryEpoch][feeAsset];
        if (value.status != RECOVERY_ROOT_ACTIVE) {
            revert InvalidRecoveryRootState(value.status, RECOVERY_ROOT_ACTIVE);
        }
        if (_recoveryClaimed[marketId][recoveryEpoch][feeAsset][msg.sender]) {
            revert RecoveryAlreadyClaimed(msg.sender, feeAsset);
        }
        bytes32 inner = keccak256(
            abi.encode(
                RECOVERY_LEAF_DOMAIN,
                RECOVERY_LEAF_SCHEMA_VERSION,
                block.chainid,
                address(this),
                EXECUTION_SPEC_ID,
                marketId,
                recoveryEpoch,
                feeAsset,
                msg.sender,
                amount
            )
        );
        bytes32 leaf = keccak256(bytes.concat(inner));
        if (amount == 0 || !MerkleProof.verifyCalldata(proof, value.root, leaf)) revert InvalidRecoveryProof();

        uint256 nextClaimed = value.claimedTotal + amount;
        uint256 cap = _canonicalRecoveryCap(marketId, recoveryEpoch, feeAsset);
        if (nextClaimed > value.declaredTotal || nextClaimed > cap) {
            revert RecoveryCapExceeded(feeAsset, nextClaimed, cap);
        }
        _recoveryClaimed[marketId][recoveryEpoch][feeAsset][msg.sender] = true;
        value.claimedTotal = nextClaimed;
        _debitLiability(marketId, feeAsset, BUCKET_STAKER_REWARD, amount);
        _payFeeAsset(feeAsset, msg.sender, amount);
        emit RecoveryClaimed(marketId, recoveryEpoch, feeAsset, msg.sender, amount);
        _exitStandaloneOperation();
    }
}
