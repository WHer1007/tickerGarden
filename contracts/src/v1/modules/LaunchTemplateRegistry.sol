// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    IGraduationExecutor,
    ILaunchTemplateRegistry,
    IMarketRegistryV1,
    IProtocolFeeVault,
    ITickerGardenMemeHook,
    LaunchTemplate
} from "../interfaces/IV1Protocol.sol";
import {DelayedUnpause} from "../shared/DelayedUnpause.sol";
import {ImmutableAccessManaged} from "../shared/ImmutableAccessManaged.sol";

/// @notice Append-only, code-identity-bound component templates for V1 market launches.
contract LaunchTemplateRegistry is ILaunchTemplateRegistry, ImmutableAccessManaged, DelayedUnpause {
    uint8 internal constant TEMPLATE_STATUS_UNSET = 0;
    uint8 internal constant TEMPLATE_STATUS_ACTIVE = 1;
    uint8 internal constant TEMPLATE_STATUS_PAUSED = 2;
    uint8 internal constant TEMPLATE_STATUS_RETIRED = 3;
    uint160 internal constant REQUIRED_HOOK_PERMISSION_MASK = 0x2044;
    uint160 internal constant ALL_HOOK_PERMISSION_BITS = 0x3fff;
    uint256 internal constant LAUNCH_TEMPLATE_SCHEMA_VERSION = 2;
    bytes32 internal constant LAUNCH_TEMPLATE_DOMAIN = keccak256("TICKERGARDEN_V1_LAUNCH_TEMPLATE");
    bytes32 public constant EXECUTION_SPEC_ID = keccak256("V1-EXEC-11");

    mapping(bytes32 launchTemplateId => LaunchTemplate value) private _launchTemplates;
    mapping(bytes32 launchTemplateId => bytes32 value) private _launchTemplateHashes;

    error InvalidLaunchTemplate(bytes32 launchTemplateId);
    error LaunchTemplateAlreadyExists(bytes32 launchTemplateId);
    error CodeIdentityMismatch(address component, bytes32 suppliedHash, bytes32 observedHash);
    error UnsafeTemplateRuntime(address component, uint8 opcode);
    error InvalidLaunchTemplateBindings(address hook, address executor);
    error InvalidStateTransition(uint8 currentState, uint8 requestedState);

    constructor(address authority_) ImmutableAccessManaged(authority_) {}

    function addLaunchTemplate(bytes32 launchTemplateId, LaunchTemplate calldata value) external override restricted {
        if (
            launchTemplateId == bytes32(0) || value.memeTokenImplementation == address(0)
                || value.memeTokenCodeHash == bytes32(0) || value.curveImplementation == address(0)
                || value.curveCodeHash == bytes32(0) || value.gaugeImplementation == address(0)
                || value.gaugeCodeHash == bytes32(0) || value.graduatedHook == address(0)
                || value.hookCodeHash == bytes32(0) || value.graduationExecutor == address(0)
                || value.graduationExecutorCodeHash == bytes32(0) || value.feePolicyId == bytes32(0)
                || value.executionSpecId != EXECUTION_SPEC_ID || value.status != TEMPLATE_STATUS_ACTIVE
                || (uint160(value.graduatedHook) & ALL_HOOK_PERMISSION_BITS) != REQUIRED_HOOK_PERMISSION_MASK
        ) revert InvalidLaunchTemplate(launchTemplateId);
        if (_launchTemplates[launchTemplateId].status != TEMPLATE_STATUS_UNSET) {
            revert LaunchTemplateAlreadyExists(launchTemplateId);
        }

        _validateCodeIdentity(value.memeTokenImplementation, value.memeTokenCodeHash);
        _validateCodeIdentity(value.curveImplementation, value.curveCodeHash);
        _validateCodeIdentity(value.gaugeImplementation, value.gaugeCodeHash);
        _validateCodeIdentity(value.graduatedHook, value.hookCodeHash);
        _validateCodeIdentity(value.graduationExecutor, value.graduationExecutorCodeHash);
        _validateDirectRuntime(value.graduatedHook);
        _validateDirectRuntime(value.graduationExecutor);
        _validateBindingGraph(value);

        bytes32 templateHash = _computeTemplateHash(value);
        _launchTemplates[launchTemplateId] = value;
        _launchTemplateHashes[launchTemplateId] = templateHash;
        emit LaunchTemplateAdded(launchTemplateId, templateHash, value.executionSpecId);
    }

    function pauseLaunchTemplate(bytes32 launchTemplateId, bytes32 reasonHash) external override restricted {
        LaunchTemplate storage value = _launchTemplates[launchTemplateId];
        if (value.status != TEMPLATE_STATUS_ACTIVE) {
            revert InvalidStateTransition(value.status, TEMPLATE_STATUS_PAUSED);
        }
        value.status = TEMPLATE_STATUS_PAUSED;
        _recordPause(launchTemplateId);
        emit LaunchTemplateStatusChanged(launchTemplateId, TEMPLATE_STATUS_ACTIVE, TEMPLATE_STATUS_PAUSED, reasonHash);
    }

    function unpauseLaunchTemplate(bytes32 launchTemplateId) external override restricted {
        LaunchTemplate storage value = _launchTemplates[launchTemplateId];
        if (value.status != TEMPLATE_STATUS_PAUSED) {
            revert InvalidStateTransition(value.status, TEMPLATE_STATUS_ACTIVE);
        }
        _requireUnpauseReady(launchTemplateId);
        value.status = TEMPLATE_STATUS_ACTIVE;
        _clearPauseTimestamp(launchTemplateId);
        emit LaunchTemplateStatusChanged(launchTemplateId, TEMPLATE_STATUS_PAUSED, TEMPLATE_STATUS_ACTIVE, bytes32(0));
    }

    function retireLaunchTemplate(bytes32 launchTemplateId, bytes32 reasonHash) external override restricted {
        LaunchTemplate storage value = _launchTemplates[launchTemplateId];
        uint8 oldStatus = value.status;
        if (oldStatus != TEMPLATE_STATUS_ACTIVE && oldStatus != TEMPLATE_STATUS_PAUSED) {
            revert InvalidStateTransition(oldStatus, TEMPLATE_STATUS_RETIRED);
        }
        value.status = TEMPLATE_STATUS_RETIRED;
        _clearPauseTimestamp(launchTemplateId);
        emit LaunchTemplateStatusChanged(launchTemplateId, oldStatus, TEMPLATE_STATUS_RETIRED, reasonHash);
    }

    function launchTemplate(bytes32 launchTemplateId) external view override returns (LaunchTemplate memory) {
        return _launchTemplates[launchTemplateId];
    }

    function launchTemplateHash(bytes32 launchTemplateId) external view override returns (bytes32) {
        return _launchTemplateHashes[launchTemplateId];
    }

    function _validateCodeIdentity(address component, bytes32 suppliedHash) private view {
        bytes32 observedHash = component.codehash;
        if (component.code.length == 0 || observedHash != suppliedHash) {
            revert CodeIdentityMismatch(component, suppliedHash, observedHash);
        }
    }

    /// @dev Every encoded item is a static 32-byte ABI word, so concatenating the two chunks is byte-for-byte
    ///      identical to one abi.encode call while avoiding a legacy-codegen stack limit.
    function _computeTemplateHash(LaunchTemplate calldata value) private pure returns (bytes32) {
        bytes memory first = abi.encode(
            LAUNCH_TEMPLATE_DOMAIN,
            LAUNCH_TEMPLATE_SCHEMA_VERSION,
            value.memeTokenImplementation,
            value.memeTokenCodeHash,
            value.curveImplementation,
            value.curveCodeHash,
            value.gaugeImplementation,
            value.gaugeCodeHash
        );
        bytes memory second = abi.encode(
            value.graduatedHook,
            value.hookCodeHash,
            value.graduationExecutor,
            value.graduationExecutorCodeHash,
            value.feePolicyId,
            value.executionSpecId
        );
        return keccak256(bytes.concat(first, second));
    }

    function _validateBindingGraph(LaunchTemplate calldata value) private view {
        ITickerGardenMemeHook hook = ITickerGardenMemeHook(value.graduatedHook);
        IGraduationExecutor executor = IGraduationExecutor(value.graduationExecutor);
        address marketRegistryAddress = hook.marketRegistry();
        IMarketRegistryV1 marketRegistry = IMarketRegistryV1(marketRegistryAddress);
        address poolManagerAddress = hook.poolManager();
        address feeVaultAddress = hook.protocolFeeVault();
        IProtocolFeeVault feeVault = IProtocolFeeVault(feeVaultAddress);

        if (
            marketRegistryAddress.code.length == 0 || poolManagerAddress.code.length == 0
                || feeVaultAddress.code.length == 0 || hook.graduationExecutor() != value.graduationExecutor
                || executor.hook() != value.graduatedHook || executor.marketRegistry() != marketRegistryAddress
                || executor.poolManager() != poolManagerAddress
                || executor.approvedQuoteRegistry() != marketRegistry.approvedQuoteRegistry()
                || executor.factory() != marketRegistry.factory()
                || marketRegistry.graduationExecutor() != value.graduationExecutor
                || feeVault.marketRegistry() != marketRegistryAddress || feeVault.poolManager() != poolManagerAddress
                || feeVault.feePolicyId() != value.feePolicyId || executor.launchLockerCreationCodeHash() == bytes32(0)
        ) revert InvalidLaunchTemplateBindings(value.graduatedHook, value.graduationExecutor);
    }

    function _validateDirectRuntime(address component) private view {
        bytes memory runtime = component.code;
        for (uint256 offset; offset < runtime.length; ++offset) {
            uint8 opcode = uint8(runtime[offset]);
            if (opcode == 0xf2 || opcode == 0xf4 || opcode == 0xff) {
                revert UnsafeTemplateRuntime(component, opcode);
            }
            if (opcode >= 0x60 && opcode <= 0x7f) offset += opcode - 0x5f;
        }
    }
}
