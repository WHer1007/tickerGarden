// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IApprovedQuoteRegistry, QuoteAssetConfig} from "../interfaces/IV1Protocol.sol";
import {DelayedUnpause} from "../shared/DelayedUnpause.sol";
import {ImmutableAccessManaged} from "../shared/ImmutableAccessManaged.sol";

/// @notice Append-only, content-addressed Quote economics approved for new V1 markets.
/// @dev V1 admits only native Quote or direct ERC-20 runtime code. Delegate proxies, CALLCODE and SELFDESTRUCT are
///      rejected at admission; the observed runtime code hash and decimals are rechecked before future market creation.
contract ApprovedQuoteRegistry is IApprovedQuoteRegistry, ImmutableAccessManaged, DelayedUnpause {
    uint8 internal constant QUOTE_STATUS_UNSET = 0;
    uint8 internal constant QUOTE_STATUS_ACTIVE = 1;
    uint8 internal constant QUOTE_STATUS_PAUSED = 2;
    uint8 internal constant QUOTE_STATUS_RETIRED = 3;
    uint8 internal constant MIN_QUOTE_DECIMALS = 6;
    uint8 internal constant MAX_QUOTE_DECIMALS = 18;
    uint256 internal constant QUOTE_ECONOMICS_SCHEMA_VERSION = 1;
    uint256 internal constant MAX_GRADUATION_AMOUNT = uint256(uint128(type(int128).max));
    bytes32 internal constant QUOTE_ECONOMICS_DOMAIN = keccak256("TICKERGARDEN_V1_QUOTE_ECONOMICS");
    bytes4 private constant DECIMALS_SELECTOR = 0x313ce567;

    mapping(bytes32 configId => QuoteAssetConfig value) private _quoteConfigs;
    mapping(bytes32 configId => bytes32 runtimeCodeHash) private _quoteRuntimeCodeHashes;

    error InvalidQuoteConfig(bytes32 configId);
    error QuoteConfigAlreadyExists(bytes32 configId);
    error InvalidQuoteAsset(address quoteAsset, uint8 quoteDecimals);
    error ForbiddenQuoteOpcode(address quoteAsset, bytes1 opcode);
    error QuoteAssetIdentityDrift(bytes32 configId);
    error InvalidEconomicsHash(bytes32 configId, bytes32 suppliedHash, bytes32 expectedHash);
    error InvalidStateTransition(uint8 currentState, uint8 requestedState);

    constructor(address authority_) ImmutableAccessManaged(authority_) {}

    function addQuoteConfig(bytes32 configId, QuoteAssetConfig calldata config) external override restricted {
        if (
            configId == bytes32(0) || config.ponsBaselineId == bytes32(0) || config.status != QUOTE_STATUS_ACTIVE
                || config.quoteDecimals < MIN_QUOTE_DECIMALS || config.quoteDecimals > MAX_QUOTE_DECIMALS
                || config.phantomQuote == 0 || config.graduationThreshold == 0
                || config.phantomQuote > MAX_GRADUATION_AMOUNT || config.graduationThreshold > MAX_GRADUATION_AMOUNT
                || config.phantomQuote > type(uint256).max - config.graduationThreshold
        ) revert InvalidQuoteConfig(configId);
        if (_quoteConfigs[configId].status != QUOTE_STATUS_UNSET) revert QuoteConfigAlreadyExists(configId);

        bytes32 runtimeCodeHash = _observeQuoteAsset(config.quoteAsset, config.quoteDecimals);
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
        _quoteRuntimeCodeHashes[configId] = runtimeCodeHash;
        emit QuoteAssetConfigAdded(configId, config.quoteAsset, config.ponsBaselineId, config.economicsHash);
        emit QuoteAssetIdentityPinned(configId, config.quoteAsset, runtimeCodeHash);
    }

    function pauseQuote(bytes32 configId, bytes32 reasonHash) external override restricted {
        QuoteAssetConfig storage config = _quoteConfigs[configId];
        if (config.status != QUOTE_STATUS_ACTIVE) {
            revert InvalidStateTransition(config.status, QUOTE_STATUS_PAUSED);
        }
        config.status = QUOTE_STATUS_PAUSED;
        _recordPause(configId);
        emit QuoteAssetStatusChanged(configId, QUOTE_STATUS_ACTIVE, QUOTE_STATUS_PAUSED, reasonHash);
    }

    function unpauseQuote(bytes32 configId) external override restricted {
        QuoteAssetConfig storage config = _quoteConfigs[configId];
        if (config.status != QUOTE_STATUS_PAUSED) {
            revert InvalidStateTransition(config.status, QUOTE_STATUS_ACTIVE);
        }
        _requireUnpauseReady(configId);
        if (!_quoteIdentityCurrent(configId, config)) revert QuoteAssetIdentityDrift(configId);
        config.status = QUOTE_STATUS_ACTIVE;
        _clearPauseTimestamp(configId);
        emit QuoteAssetStatusChanged(configId, QUOTE_STATUS_PAUSED, QUOTE_STATUS_ACTIVE, bytes32(0));
    }

    function retireQuote(bytes32 configId, bytes32 reasonHash) external override restricted {
        QuoteAssetConfig storage config = _quoteConfigs[configId];
        uint8 oldStatus = config.status;
        if (oldStatus != QUOTE_STATUS_ACTIVE && oldStatus != QUOTE_STATUS_PAUSED) {
            revert InvalidStateTransition(oldStatus, QUOTE_STATUS_RETIRED);
        }
        config.status = QUOTE_STATUS_RETIRED;
        _clearPauseTimestamp(configId);
        emit QuoteAssetStatusChanged(configId, oldStatus, QUOTE_STATUS_RETIRED, reasonHash);
    }

    function quoteConfig(bytes32 configId) external view override returns (QuoteAssetConfig memory) {
        return _quoteConfigs[configId];
    }

    function quoteRuntimeCodeHash(bytes32 configId) external view override returns (bytes32) {
        return _quoteRuntimeCodeHashes[configId];
    }

    function quoteIdentityCurrent(bytes32 configId) external view override returns (bool) {
        QuoteAssetConfig storage config = _quoteConfigs[configId];
        return _quoteIdentityCurrent(configId, config);
    }

    function _observeQuoteAsset(address quoteAsset, uint8 quoteDecimals) private view returns (bytes32 runtimeCodeHash) {
        if (quoteAsset == address(0)) {
            if (quoteDecimals != 18) revert InvalidQuoteAsset(quoteAsset, quoteDecimals);
            return bytes32(0);
        }
        if (quoteAsset.code.length == 0) revert InvalidQuoteAsset(quoteAsset, quoteDecimals);

        bytes1 forbiddenOpcode = _forbiddenRuntimeOpcode(quoteAsset);
        if (forbiddenOpcode != bytes1(0)) revert ForbiddenQuoteOpcode(quoteAsset, forbiddenOpcode);

        _requireQuoteDecimals(quoteAsset, quoteDecimals);
        runtimeCodeHash = quoteAsset.codehash;
        if (runtimeCodeHash == bytes32(0)) revert InvalidQuoteAsset(quoteAsset, quoteDecimals);
    }

    function _quoteIdentityCurrent(bytes32 configId, QuoteAssetConfig storage config) private view returns (bool) {
        if (config.status == QUOTE_STATUS_UNSET) return false;
        if (config.quoteAsset == address(0)) {
            return config.quoteDecimals == 18 && _quoteRuntimeCodeHashes[configId] == bytes32(0);
        }
        bytes32 expectedCodeHash = _quoteRuntimeCodeHashes[configId];
        if (expectedCodeHash == bytes32(0) || config.quoteAsset.codehash != expectedCodeHash) return false;

        (bool success, bytes memory result) =
            config.quoteAsset.staticcall(abi.encodeWithSelector(DECIMALS_SELECTOR));
        return success && result.length == 32 && abi.decode(result, (uint256)) == config.quoteDecimals;
    }

    function _requireQuoteDecimals(address quoteAsset, uint8 quoteDecimals) private view {
        (bool success, bytes memory result) = quoteAsset.staticcall(abi.encodeWithSelector(DECIMALS_SELECTOR));
        if (!success || result.length != 32) revert InvalidQuoteAsset(quoteAsset, quoteDecimals);
        uint256 observedDecimals = abi.decode(result, (uint256));
        if (observedDecimals != quoteDecimals) revert InvalidQuoteAsset(quoteAsset, quoteDecimals);
    }

    function _forbiddenRuntimeOpcode(address target) private view returns (bytes1 forbiddenOpcode) {
        uint256 size = target.code.length;
        bytes memory runtime = new bytes(size);
        assembly ("memory-safe") {
            extcodecopy(target, add(runtime, 0x20), 0, size)
        }
        for (uint256 index; index < size;) {
            uint8 opcode = uint8(runtime[index]);
            if (opcode == 0xf2 || opcode == 0xf4 || opcode == 0xff) return bytes1(opcode);
            unchecked {
                index += opcode >= 0x60 && opcode <= 0x7f ? uint256(opcode - 0x5f) + 1 : 1;
            }
        }
    }
}
