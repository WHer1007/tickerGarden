// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {V1HookExecutorDeployer} from "./V1HookExecutorDeployer.sol";

/// @notice Calldata-only deployment recipe for one immutable V1 runtime graph.
/// @dev The ordinary component order is frozen by V1DeterministicDeploymentBuilder. Every deployment happens in
///      one call, so a failed constructor, address check, Hook/Executor binding, or Factory graph validation rolls
///      the complete runtime back. The authorizer may then retry the exact same addresses with corrected calldata.
struct V1DeploymentPayload {
    bytes[] ordinaryInitCodes;
    bytes32 helperSalt;
    bytes helperInitCode;
    bytes hookInitCode;
    bytes executorInitCode;
    bytes32 factorySalt;
    bytes factoryInitCode;
}

contract V1DeterministicDeploymentOrchestrator {
    uint8 public constant ORDINARY_COMPONENT_COUNT = 16;

    address public immutable authorizer;
    bytes32 public immutable releaseId;

    bool public completed;
    bytes32 public deploymentPayloadHash;
    address public helper;
    address public hook;
    address public executor;
    address public factory;

    address[ORDINARY_COMPONENT_COUNT] private _ordinaryComponents;

    error InvalidAuthorizer(address authorizer);
    error InvalidReleaseId();
    error UnauthorizedDeployment(address caller, address expected);
    error DeploymentAlreadyCompleted();
    error InvalidPayloadHash(bytes32 supplied, bytes32 computed);
    error InvalidOrdinaryComponentCount(uint256 supplied, uint256 expected);
    error EmptyInitCode(uint256 componentIndex);
    error ComponentDeploymentFailed(uint256 componentIndex, address predicted);
    error DeterministicDeploymentFailed(bytes32 salt, address predicted);
    error InvalidHookExecutorHelper(address helper, address expectedAuthorizer);

    event OrdinaryComponentDeployed(uint8 indexed componentIndex, address indexed component, bytes32 initCodeHash);
    event V1RuntimeDeployed(
        bytes32 indexed releaseId,
        bytes32 indexed deploymentPayloadHash,
        address indexed factory,
        address hook,
        address executor,
        address helper
    );

    constructor(address authorizer_, bytes32 releaseId_) {
        if (authorizer_ == address(0)) revert InvalidAuthorizer(authorizer_);
        if (releaseId_ == bytes32(0)) revert InvalidReleaseId();
        authorizer = authorizer_;
        releaseId = releaseId_;
    }

    function deploy(V1DeploymentPayload calldata payload, bytes32 expectedPayloadHash)
        external
        returns (address deployedFactory, address deployedHook, address deployedExecutor)
    {
        if (msg.sender != authorizer) revert UnauthorizedDeployment(msg.sender, authorizer);
        if (completed) revert DeploymentAlreadyCompleted();

        bytes32 computedPayloadHash = keccak256(abi.encode(payload));
        if (computedPayloadHash != expectedPayloadHash) {
            revert InvalidPayloadHash(expectedPayloadHash, computedPayloadHash);
        }
        if (payload.ordinaryInitCodes.length != ORDINARY_COMPONENT_COUNT) {
            revert InvalidOrdinaryComponentCount(payload.ordinaryInitCodes.length, ORDINARY_COMPONENT_COUNT);
        }

        _deployOrdinaryComponents(payload.ordinaryInitCodes);

        address deployedHelper = _deployCreate2(payload.helperSalt, payload.helperInitCode);
        V1HookExecutorDeployer bridge = V1HookExecutorDeployer(deployedHelper);
        if (bridge.authorizer() != address(this)) {
            revert InvalidHookExecutorHelper(deployedHelper, address(this));
        }
        (deployedHook, deployedExecutor) = bridge.deploy(payload.hookInitCode, payload.executorInitCode);

        deployedFactory = _deployCreate2(payload.factorySalt, payload.factoryInitCode);

        deploymentPayloadHash = computedPayloadHash;
        helper = deployedHelper;
        hook = deployedHook;
        executor = deployedExecutor;
        factory = deployedFactory;
        completed = true;

        emit V1RuntimeDeployed(
            releaseId, computedPayloadHash, deployedFactory, deployedHook, deployedExecutor, deployedHelper
        );
    }

    function ordinaryComponents() external view returns (address[ORDINARY_COMPONENT_COUNT] memory) {
        return _ordinaryComponents;
    }

    function predictOrdinaryComponent(uint8 componentIndex) public view returns (address) {
        if (componentIndex >= ORDINARY_COMPONENT_COUNT) return address(0);
        return _predictCreateAddress(address(this), componentIndex + 1);
    }

    function predictCreate2(bytes32 salt, bytes32 initCodeHash) public view returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash)))));
    }

    function _deployOrdinaryComponents(bytes[] calldata initCodes) private {
        for (uint8 i; i < ORDINARY_COMPONENT_COUNT; ++i) {
            bytes calldata initCode = initCodes[i];
            if (initCode.length == 0) revert EmptyInitCode(i);
            address predicted = _predictCreateAddress(address(this), i + 1);
            bytes memory code = initCode;
            address component;
            assembly ("memory-safe") {
                component := create(0, add(code, 0x20), mload(code))
            }
            if (component != predicted || component.code.length == 0) {
                revert ComponentDeploymentFailed(i, predicted);
            }
            _ordinaryComponents[i] = component;
            emit OrdinaryComponentDeployed(i, component, keccak256(initCode));
        }
    }

    function _deployCreate2(bytes32 salt, bytes calldata initCode) private returns (address component) {
        if (initCode.length == 0) revert EmptyInitCode(type(uint8).max);
        address predicted = predictCreate2(salt, keccak256(initCode));
        bytes memory code = initCode;
        assembly ("memory-safe") {
            component := create2(0, add(code, 0x20), mload(code), salt)
        }
        if (component != predicted || component.code.length == 0) {
            revert DeterministicDeploymentFailed(salt, predicted);
        }
    }

    /// @dev RLP(address, nonce) is d6 94 <address> <single-byte nonce> for the frozen nonce range 1..16.
    function _predictCreateAddress(address deployer, uint8 nonce) private pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(hex"d694", deployer, bytes1(nonce))))));
    }
}
