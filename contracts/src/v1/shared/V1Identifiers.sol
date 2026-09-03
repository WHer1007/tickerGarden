// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Canonical typed hashes for V1 market identity and per-market component namespaces.
library V1Identifiers {
    bytes32 internal constant MARKET_ID_DOMAIN = keccak256("TICKERGARDEN_V1_MARKET_ID");
    bytes32 internal constant COMPONENT_SALT_DOMAIN = keccak256("TICKERGARDEN_V1_COMPONENT_SALT");
    uint256 internal constant MARKET_ID_SCHEMA_VERSION = 1;
    uint256 internal constant COMPONENT_SALT_SCHEMA_VERSION = 1;

    bytes32 internal constant TOKEN_COMPONENT_KIND = keccak256("TOKEN");
    bytes32 internal constant CURVE_COMPONENT_KIND = keccak256("CURVE");
    bytes32 internal constant GAUGE_COMPONENT_KIND = keccak256("GAUGE");
    bytes32 internal constant LOCKER_COMPONENT_KIND = keccak256("LOCKER");

    enum ComponentKind {
        TOKEN,
        CURVE,
        GAUGE,
        LOCKER
    }

    struct MarketIdInput {
        uint256 chainId;
        address factory;
        address creator;
        address creatorRevenueBeneficiaryAtCreation;
        bytes32 creatorSalt;
        bytes32 expectedEconomics;
        bytes32 nameHash;
        bytes32 symbolHash;
        bytes32 metadataUriHash;
    }

    struct MarketIdStringInput {
        uint256 chainId;
        address factory;
        address creator;
        address creatorRevenueBeneficiaryAtCreation;
        bytes32 creatorSalt;
        bytes32 expectedEconomics;
        string name;
        string symbol;
        string metadataURI;
    }

    function hashMarketId(MarketIdInput memory input) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                MARKET_ID_DOMAIN,
                MARKET_ID_SCHEMA_VERSION,
                input.chainId,
                input.factory,
                input.creator,
                input.creatorRevenueBeneficiaryAtCreation,
                input.creatorSalt,
                input.expectedEconomics,
                input.nameHash,
                input.symbolHash,
                input.metadataUriHash
            )
        );
    }

    function hashMarketId(MarketIdStringInput memory input) internal pure returns (bytes32) {
        return hashMarketId(
            MarketIdInput({
                chainId: input.chainId,
                factory: input.factory,
                creator: input.creator,
                creatorRevenueBeneficiaryAtCreation: input.creatorRevenueBeneficiaryAtCreation,
                creatorSalt: input.creatorSalt,
                expectedEconomics: input.expectedEconomics,
                nameHash: keccak256(bytes(input.name)),
                symbolHash: keccak256(bytes(input.symbol)),
                metadataUriHash: keccak256(bytes(input.metadataURI))
            })
        );
    }

    function componentKindHash(ComponentKind kind) internal pure returns (bytes32) {
        if (kind == ComponentKind.TOKEN) return TOKEN_COMPONENT_KIND;
        if (kind == ComponentKind.CURVE) return CURVE_COMPONENT_KIND;
        if (kind == ComponentKind.GAUGE) return GAUGE_COMPONENT_KIND;
        return LOCKER_COMPONENT_KIND;
    }

    function componentSalt(uint256 chainId, address factory, bytes32 marketId, ComponentKind kind)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                COMPONENT_SALT_DOMAIN,
                COMPONENT_SALT_SCHEMA_VERSION,
                chainId,
                factory,
                marketId,
                componentKindHash(kind)
            )
        );
    }
}
