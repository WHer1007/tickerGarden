// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IGraduationExecutor, ITickerGardenMemeHook} from "../../src/v1/interfaces/IV1Protocol.sol";

/// @notice One-shot deployment bridge for the immutable Hook/GraduationExecutor binding cycle.
/// @dev Deploy this helper with CREATE2 after mining a salt whose first child address has the required Hook bits.
///      The Hook is CREATE nonce 1 and may therefore bind the not-yet-deployed Executor at nonce 2. If either
///      constructor or the reciprocal post-deployment check fails, the complete transaction (including the Hook)
///      reverts and the same helper may be retried with corrected init code.
contract V1HookExecutorDeployer {
    uint160 internal constant REQUIRED_HOOK_PERMISSION_MASK = 0x2044;
    uint160 internal constant ALL_HOOK_PERMISSION_BITS = 0x3fff;

    address public immutable authorizer;
    address public immutable predictedHook;
    address public immutable predictedExecutor;
    bool public completed;

    error InvalidAuthorizer(address authorizer);
    error InvalidPredictedHookPermissionMask(address predictedHook);
    error UnauthorizedDeployer(address caller, address authorizer);
    error DeploymentAlreadyCompleted();
    error EmptyInitCode();
    error ComponentDeploymentFailed(address predictedComponent);
    error InvalidReciprocalBindings(address hook, address executor);

    event HookExecutorDeployed(address indexed hook, address indexed executor);

    constructor(address authorizer_) {
        if (authorizer_ == address(0)) revert InvalidAuthorizer(authorizer_);
        address hook_ = _predictCreateAddress(address(this), 1);
        if ((uint160(hook_) & ALL_HOOK_PERMISSION_BITS) != REQUIRED_HOOK_PERMISSION_MASK) {
            revert InvalidPredictedHookPermissionMask(hook_);
        }
        authorizer = authorizer_;
        predictedHook = hook_;
        predictedExecutor = _predictCreateAddress(address(this), 2);
    }

    function deploy(bytes calldata hookInitCode, bytes calldata executorInitCode)
        external
        returns (address hook, address executor)
    {
        if (msg.sender != authorizer) revert UnauthorizedDeployer(msg.sender, authorizer);
        if (completed) revert DeploymentAlreadyCompleted();
        if (hookInitCode.length == 0 || executorInitCode.length == 0) revert EmptyInitCode();

        bytes memory hookCode = hookInitCode;
        assembly ("memory-safe") {
            hook := create(0, add(hookCode, 0x20), mload(hookCode))
        }
        if (hook != predictedHook || hook.code.length == 0) revert ComponentDeploymentFailed(predictedHook);

        bytes memory executorCode = executorInitCode;
        assembly ("memory-safe") {
            executor := create(0, add(executorCode, 0x20), mload(executorCode))
        }
        if (executor != predictedExecutor || executor.code.length == 0) {
            revert ComponentDeploymentFailed(predictedExecutor);
        }

        ITickerGardenMemeHook hookComponent = ITickerGardenMemeHook(hook);
        IGraduationExecutor executorComponent = IGraduationExecutor(executor);
        if (
            hookComponent.graduationExecutor() != executor || executorComponent.hook() != hook
                || hookComponent.marketRegistry() != executorComponent.marketRegistry()
                || hookComponent.poolManager() != executorComponent.poolManager()
        ) revert InvalidReciprocalBindings(hook, executor);

        completed = true;
        emit HookExecutorDeployed(hook, executor);
    }

    function predictCreateAddress(address deployer, uint8 nonce) external pure returns (address) {
        if (nonce != 1 && nonce != 2) return address(0);
        return _predictCreateAddress(deployer, nonce);
    }

    function _predictCreateAddress(address deployer, uint8 nonce) private pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(hex"d694", deployer, bytes1(nonce))))));
    }
}
