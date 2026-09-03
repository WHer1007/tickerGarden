// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Canonical double-hashed leaf used by the V2 TWAB Merkle distributor.
library TreasuryClaimLeafV2 {
    bytes32 internal constant CLAIM_LEAF_DOMAIN = keccak256("TICKERGARDEN_V2_TREASURY_CLAIM_V1");
    bytes32 internal constant TWAB_SCHEMA = keccak256("TRANSFER_LOG_TWAB_30D_V1");

    struct Context {
        uint256 chainId;
        address distributor;
        bytes32 marketId;
        uint32 epochId;
        address memeToken;
        address quoteToken;
        bytes32 eligibilityPolicyHash;
        uint64 windowStart;
        uint64 windowEnd;
        uint64 sourceBlockNumber;
        bytes32 sourceBlockHash;
    }

    function hash(Context memory context, uint256 leafIndex, address account, uint256 twab, uint256 amount)
        internal
        pure
        returns (bytes32)
    {
        bytes32 inner = keccak256(abi.encode(CLAIM_LEAF_DOMAIN, TWAB_SCHEMA, context, leafIndex, account, twab, amount));
        return keccak256(bytes.concat(inner));
    }
}
