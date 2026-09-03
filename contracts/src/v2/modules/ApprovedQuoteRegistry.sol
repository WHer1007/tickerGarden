// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IApprovedQuoteRegistry, QuoteAssetConfig} from "../interfaces/IV2Protocol.sol";
import {ImmutableAccessManaged} from "../shared/ImmutableAccessManaged.sol";

/// @notice Append-only, content-addressed Quote economics approved for new V2 markets.
/// @dev ERC-20 behavioral review (exact transfer delta, no rebase/callback dependence, and proxy fingerprints)
///      remains a deployment preflight responsibility. This registry verifies deployed code and decimals at admission.
contract ApprovedQuoteRegistry is IApprovedQuoteRegistry, ImmutableAccessManaged {
    uint8 internal constant QUOTE_STATUS_UNSET = 0;
    uint8 internal constant QUOTE_STATUS_ACTIVE = 1;
    uint8 internal constant QUOTE_STATUS_PAUSED = 2;
    uint8 internal constant QUOTE_STATUS_RETIRED = 3;
    uint8 internal constant MIN_QUOTE_DECIMALS = 6;
    uint8 internal constant MAX_QUOTE_DECIMALS = 18;
    uint256 internal constant QUOTE_ECONOMICS_SCHEMA_VERSION = 1;
    bytes32 internal constant QUOTE_ECONOMICS_DOMAIN = keccak256("TICKERGARDEN_V2_QUOTE_ECONOMICS");
    bytes4 private constant DECIMALS_SELECTOR = 0x313ce567;

    mapping(bytes32 configId => QuoteAssetConfig value) private _quoteConfigs;

    error InvalidQuoteConfig(bytes32 configId);
    error QuoteConfigAlreadyExists(bytes32 configId);
    error InvalidQuoteAsset(address quoteAsset, uint8 quoteDecimals);
    error InvalidEconomicsHash(bytes32 configId, bytes32 suppliedHash, bytes32 expectedHash);
    error InvalidStateTransition(uint8 currentState, uint8 requestedState);

    constructor(address authority_) ImmutableAccessManaged(authority_) {}

    function addQuoteConfig(bytes32 configId, QuoteAssetConfig calldata config) external override restricted {
        if (
            configId == bytes32(0) || config.ponsBaselineId == bytes32(0) || config.status != QUOTE_STATUS_ACTIVE
                || config.quoteDecimals < MIN_QUOTE_DECIMALS || config.quoteDecimals > MAX_QUOTE_DECIMALS
                || config.phantomQuote == 0 || config.graduationThreshold == 0
                || config.phantomQuote > type(uint256).max - config.graduationThreshold
        ) revert InvalidQuoteConfig(configId);
        if (_quoteConfigs[configId].status != QUOTE_STATUS_UNSET) revert QuoteConfigAlreadyExists(configId);

        _validateQuoteAsset(config.quoteAsset, config.quoteDecimals);
        bytes32 expectedHash = keccak256(
            abi.encode(
                QUOTE_ECONOMICS_DOMAIN,
                QUOTE_ECONOMICS_SCHEMA_VERSION,
                block.chainid,
                config.ponsBaselineId,
                config.quoteAsset,
                config.quoteDecimals,
                config.phantomQuote,
                config.graduationThreshold
            )
        );
        if (configId != expectedHash || config.economicsHash != expectedHash) {
            revert InvalidEconomicsHash(configId, config.economicsHash, expectedHash);
        }

        _quoteConfigs[configId] = config;
        emit QuoteAssetConfigAdded(configId, config.quoteAsset, config.ponsBaselineId, config.economicsHash);
    }

    function pauseQuote(bytes32 configId, bytes32 reasonHash) external override restricted {
        QuoteAssetConfig storage config = _quoteConfigs[configId];
        if (config.status != QUOTE_STATUS_ACTIVE) {
            revert InvalidStateTransition(config.status, QUOTE_STATUS_PAUSED);
        }
        config.status = QUOTE_STATUS_PAUSED;
        emit QuoteAssetStatusChanged(configId, QUOTE_STATUS_ACTIVE, QUOTE_STATUS_PAUSED, reasonHash);
    }

    function unpauseQuote(bytes32 configId) external override restricted {
        QuoteAssetConfig storage config = _quoteConfigs[configId];
        if (config.status != QUOTE_STATUS_PAUSED) {
            revert InvalidStateTransition(config.status, QUOTE_STATUS_ACTIVE);
        }
        config.status = QUOTE_STATUS_ACTIVE;
        emit QuoteAssetStatusChanged(configId, QUOTE_STATUS_PAUSED, QUOTE_STATUS_ACTIVE, bytes32(0));
    }

    function retireQuote(bytes32 configId, bytes32 reasonHash) external override restricted {
        QuoteAssetConfig storage config = _quoteConfigs[configId];
        uint8 oldStatus = config.status;
        if (oldStatus != QUOTE_STATUS_ACTIVE && oldStatus != QUOTE_STATUS_PAUSED) {
            revert InvalidStateTransition(oldStatus, QUOTE_STATUS_RETIRED);
        }
        config.status = QUOTE_STATUS_RETIRED;
        emit QuoteAssetStatusChanged(configId, oldStatus, QUOTE_STATUS_RETIRED, reasonHash);
    }

    function quoteConfig(bytes32 configId) external view override returns (QuoteAssetConfig memory) {
        return _quoteConfigs[configId];
    }

    function _validateQuoteAsset(address quoteAsset, uint8 quoteDecimals) private view {
        if (quoteAsset == address(0)) {
            if (quoteDecimals != 18) revert InvalidQuoteAsset(quoteAsset, quoteDecimals);
            return;
        }
        if (quoteAsset.code.length == 0) revert InvalidQuoteAsset(quoteAsset, quoteDecimals);

        (bool success, bytes memory result) = quoteAsset.staticcall(abi.encodeWithSelector(DECIMALS_SELECTOR));
        if (!success || result.length != 32) revert InvalidQuoteAsset(quoteAsset, quoteDecimals);
        uint256 observedDecimals = abi.decode(result, (uint256));
        if (observedDecimals != quoteDecimals) revert InvalidQuoteAsset(quoteAsset, quoteDecimals);
    }
}
