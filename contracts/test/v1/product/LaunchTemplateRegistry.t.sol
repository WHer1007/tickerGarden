// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";

import {ILaunchTemplateRegistry, LaunchTemplate} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {LaunchTemplateRegistry} from "../../../src/v1/modules/LaunchTemplateRegistry.sol";
import {ImmutableAccessManaged} from "../../../src/v1/shared/ImmutableAccessManaged.sol";

contract EmptyTemplateComponent {}

contract LaunchTemplateRegistryTest is Test {
    uint64 internal constant PROTOCOL_ADMIN_ROLE = 1;
    uint64 internal constant PAUSE_GUARDIAN_ROLE = 2;
    uint64 internal constant UNPAUSE_ROLE = 3;
    uint32 internal constant ADMIN_DELAY = 2 days;
    uint32 internal constant UNPAUSE_DELAY = 1 days;

    bytes32 internal constant TEMPLATE_ID = keccak256("launch-template-1");
    bytes32 internal constant REASON_HASH = keccak256("template-risk");

    function EXECUTION_SPEC_ID() internal pure returns (bytes32) {
        return keccak256("V1-EXEC-8");
    }
    bytes32 internal constant FEE_POLICY_ID = keccak256("immutable-fee-policy");
    address internal constant HOOK = address(uint160(0x12044));
    address internal constant DELAYED_ADMIN = address(0xA11CE);
    address internal constant FAST_ADMIN = address(0xFA57);
    address internal constant GUARDIAN = address(0x6A7D);
    address internal constant UNPAUSER = address(0xBEEF);

    AccessManager internal manager;
    LaunchTemplateRegistry internal registry;
    address internal memeTokenImplementation;
    address internal curveImplementation;
    address internal gaugeImplementation;
    address internal graduationExecutor;
    address internal launchLockerImplementation;

    event LaunchTemplateAdded(
        bytes32 indexed launchTemplateId, bytes32 indexed templateHash, bytes32 indexed executionSpecId
    );
    event LaunchTemplateStatusChanged(
        bytes32 indexed launchTemplateId, uint8 oldStatus, uint8 newStatus, bytes32 reasonHash
    );

    function setUp() public {
        vm.warp(1_000_000);
        manager = new AccessManager(address(this));
        registry = new LaunchTemplateRegistry(address(manager));
        memeTokenImplementation = address(new EmptyTemplateComponent());
        curveImplementation = address(new EmptyTemplateComponent());
        gaugeImplementation = address(new EmptyTemplateComponent());
        graduationExecutor = address(new EmptyTemplateComponent());
        launchLockerImplementation = address(new EmptyTemplateComponent());
        vm.etch(HOOK, hex"00");

        bytes4[] memory adminSelectors = new bytes4[](2);
        adminSelectors[0] = ILaunchTemplateRegistry.addLaunchTemplate.selector;
        adminSelectors[1] = ILaunchTemplateRegistry.retireLaunchTemplate.selector;
        manager.setTargetFunctionRole(address(registry), adminSelectors, PROTOCOL_ADMIN_ROLE);

        bytes4[] memory pauseSelectors = new bytes4[](1);
        pauseSelectors[0] = ILaunchTemplateRegistry.pauseLaunchTemplate.selector;
        manager.setTargetFunctionRole(address(registry), pauseSelectors, PAUSE_GUARDIAN_ROLE);

        bytes4[] memory unpauseSelectors = new bytes4[](1);
        unpauseSelectors[0] = ILaunchTemplateRegistry.unpauseLaunchTemplate.selector;
        manager.setTargetFunctionRole(address(registry), unpauseSelectors, UNPAUSE_ROLE);

        manager.grantRole(PROTOCOL_ADMIN_ROLE, DELAYED_ADMIN, ADMIN_DELAY);
        manager.grantRole(PROTOCOL_ADMIN_ROLE, FAST_ADMIN, 0);
        manager.grantRole(PAUSE_GUARDIAN_ROLE, GUARDIAN, 0);
        manager.grantRole(UNPAUSE_ROLE, UNPAUSER, UNPAUSE_DELAY);
    }

    function test_constructorRequiresDeployedAuthority() public {
        vm.expectRevert(abi.encodeWithSelector(ImmutableAccessManaged.InvalidAuthority.selector, address(0)));
        new LaunchTemplateRegistry(address(0));

        address noCode = address(0x1234);
        vm.expectRevert(abi.encodeWithSelector(ImmutableAccessManaged.InvalidAuthority.selector, noCode));
        new LaunchTemplateRegistry(noCode);
    }

    function test_selectorsMatchCanonicalInterface() public pure {
        assertEq(LaunchTemplateRegistry.addLaunchTemplate.selector, ILaunchTemplateRegistry.addLaunchTemplate.selector);
        assertEq(
            LaunchTemplateRegistry.pauseLaunchTemplate.selector, ILaunchTemplateRegistry.pauseLaunchTemplate.selector
        );
        assertEq(
            LaunchTemplateRegistry.unpauseLaunchTemplate.selector,
            ILaunchTemplateRegistry.unpauseLaunchTemplate.selector
        );
        assertEq(
            LaunchTemplateRegistry.retireLaunchTemplate.selector, ILaunchTemplateRegistry.retireLaunchTemplate.selector
        );
        assertEq(LaunchTemplateRegistry.launchTemplate.selector, ILaunchTemplateRegistry.launchTemplate.selector);
        assertEq(
            LaunchTemplateRegistry.launchTemplateHash.selector, ILaunchTemplateRegistry.launchTemplateHash.selector
        );
    }

    function test_unknownTemplateIsUnsetWithZeroHash() public view {
        LaunchTemplate memory value = registry.launchTemplate(TEMPLATE_ID);
        assertEq(value.status, 0);
        assertEq(value.memeTokenImplementation, address(0));
        assertEq(registry.launchTemplateHash(TEMPLATE_ID), bytes32(0));
    }

    function test_allMutationsRequireTheirConfiguredSelectorRole() public {
        LaunchTemplate memory value = _validTemplate();
        _expectUnauthorized(ILaunchTemplateRegistry.addLaunchTemplate.selector);
        registry.addLaunchTemplate(TEMPLATE_ID, value);
        _expectUnauthorized(ILaunchTemplateRegistry.pauseLaunchTemplate.selector);
        registry.pauseLaunchTemplate(TEMPLATE_ID, REASON_HASH);
        _expectUnauthorized(ILaunchTemplateRegistry.unpauseLaunchTemplate.selector);
        registry.unpauseLaunchTemplate(TEMPLATE_ID);
        _expectUnauthorized(ILaunchTemplateRegistry.retireLaunchTemplate.selector);
        registry.retireLaunchTemplate(TEMPLATE_ID, REASON_HASH);
    }

    function test_addUsesExactTwoDayAccessManagerDelay() public {
        LaunchTemplate memory value = _validTemplate();
        bytes memory data = abi.encodeCall(ILaunchTemplateRegistry.addLaunchTemplate, (TEMPLATE_ID, value));
        uint48 readyAt = uint48(block.timestamp + ADMIN_DELAY);
        vm.prank(DELAYED_ADMIN);
        manager.schedule(address(registry), data, readyAt);
        vm.warp(readyAt - 1);
        vm.prank(DELAYED_ADMIN);
        vm.expectRevert();
        manager.execute(address(registry), data);

        vm.warp(readyAt);
        bytes32 expectedHash = _templateHash(value);
        vm.expectEmit(true, true, true, true, address(registry));
        emit LaunchTemplateAdded(TEMPLATE_ID, expectedHash, EXECUTION_SPEC_ID());
        vm.prank(DELAYED_ADMIN);
        manager.execute(address(registry), data);
        _assertTemplate(TEMPLATE_ID, value, 1, expectedHash);
    }

    function test_addStoresFrozenComponentsAndCanonicalHash() public {
        LaunchTemplate memory value = _validTemplate();
        bytes32 expectedHash = _templateHash(value);
        vm.expectEmit(true, true, true, true);
        emit LaunchTemplateAdded(TEMPLATE_ID, expectedHash, EXECUTION_SPEC_ID());
        _addFast(TEMPLATE_ID, value);
        _assertTemplate(TEMPLATE_ID, value, 1, expectedHash);
    }

    function test_hashCoversEveryImmutableFieldButNotStatus() public view {
        LaunchTemplate memory value = _validTemplate();
        bytes32 original = _templateHash(value);

        value.memeTokenImplementation = curveImplementation;
        assertNotEq(_templateHash(value), original);
        value = _validTemplate();
        value.memeTokenCodeHash = keccak256("meme");
        assertNotEq(_templateHash(value), original);
        value = _validTemplate();
        value.curveImplementation = memeTokenImplementation;
        assertNotEq(_templateHash(value), original);
        value = _validTemplate();
        value.curveCodeHash = keccak256("curve");
        assertNotEq(_templateHash(value), original);
        value = _validTemplate();
        value.gaugeImplementation = curveImplementation;
        assertNotEq(_templateHash(value), original);
        value = _validTemplate();
        value.gaugeCodeHash = keccak256("gauge");
        assertNotEq(_templateHash(value), original);
        value = _validTemplate();
        value.graduatedHook = address(uint160(0x22044));
        assertNotEq(_templateHash(value), original);
        value = _validTemplate();
        value.hookCodeHash = keccak256("hook");
        assertNotEq(_templateHash(value), original);
        value = _validTemplate();
        value.graduationExecutor = curveImplementation;
        assertNotEq(_templateHash(value), original);
        value = _validTemplate();
        value.launchLockerImplementation = curveImplementation;
        assertNotEq(_templateHash(value), original);
        value = _validTemplate();
        value.launchLockerCodeHash = keccak256("locker");
        assertNotEq(_templateHash(value), original);
        value = _validTemplate();
        value.feePolicyId = keccak256("other-policy");
        assertNotEq(_templateHash(value), original);
        value = _validTemplate();
        value.executionSpecId = keccak256("other-spec");
        assertNotEq(_templateHash(value), original);
        value = _validTemplate();
        value.status = 2;
        assertEq(_templateHash(value), original);
    }

    function test_hashMatchesFrozenAbiEncodeVector() public pure {
        LaunchTemplate memory value = LaunchTemplate({
            memeTokenImplementation: address(bytes20(hex"676127a71afc13be392ce4203e0ec24527c393fe")),
            memeTokenCodeHash: 0xc404df846e70db76a0bd90d7b6ec6284b9d1f45e8d5ad4044c7c92d24338b04a,
            curveImplementation: address(bytes20(hex"4e9fd7f49e143c7394327b8c1ae1d562df99b671")),
            curveCodeHash: 0x02f12d2281b05161dc8e3da270712c93066d5cedee276efd353504d173c09177,
            gaugeImplementation: address(bytes20(hex"63b24e32564a735b06c55b28c755c7f03206bdaf")),
            gaugeCodeHash: 0x63931951b8c7d83fd72454be7557df8e1dffb7226552b32655bbb8cd86a75d7c,
            graduatedHook: address(bytes20(hex"5f65850f5f13f234fdac7207097427c6c928ba69")),
            hookCodeHash: 0xe32ba2f72b276137cb4c02d95fccfe453205a191b7b2ab1bba25e4d86740ce44,
            graduationExecutor: address(bytes20(hex"f5956a1f2c3f696b9fdff4ff7464f850a2ecd7be")),
            launchLockerImplementation: address(bytes20(hex"42545e24576b18fb92b42dce0e0759f5f0e69ea4")),
            launchLockerCodeHash: 0xfb452b0c9a8fbef840d17d6981fe726129c5a8d8dbc532f192a09b6eb35e7b91,
            feePolicyId: 0x21ca6e12a39c5e115bc125098217de03e2bc2d8db30f5fb2b365a0ef284c6f5f,
            executionSpecId: 0x6d778d9fac5729e6943b9bef3a61d68f916469af230e2a521826a553ea0b5bad,
            status: 3
        });
        assertEq(_templateHash(value), 0x431febfd78dbd8a37a9fad82346a849a6675a2efaf2676aa73d93ffd11295956);
    }

    function test_rejectsZeroIdentityPolicySpecAndNonActiveStatus() public {
        LaunchTemplate memory value = _validTemplate();
        _expectInvalid(bytes32(0), value);
        value.memeTokenImplementation = address(0);
        _expectInvalid(TEMPLATE_ID, value);
        value = _validTemplate();
        value.curveCodeHash = bytes32(0);
        _expectInvalid(TEMPLATE_ID, value);
        value = _validTemplate();
        value.graduationExecutor = address(0);
        _expectInvalid(TEMPLATE_ID, value);
        value = _validTemplate();
        value.launchLockerImplementation = address(0);
        _expectInvalid(TEMPLATE_ID, value);
        value = _validTemplate();
        value.launchLockerCodeHash = bytes32(0);
        _expectInvalid(TEMPLATE_ID, value);
        value = _validTemplate();
        value.feePolicyId = bytes32(0);
        _expectInvalid(TEMPLATE_ID, value);
        value = _validTemplate();
        value.executionSpecId = keccak256("V1-EXEC-3");
        _expectInvalid(TEMPLATE_ID, value);
        value = _validTemplate();
        value.status = 0;
        _expectInvalid(TEMPLATE_ID, value);
        value.status = 2;
        _expectInvalid(TEMPLATE_ID, value);
    }

    function test_rejectsWrongHookPermissionBits() public {
        LaunchTemplate memory value = _validTemplate();
        address wrongHook = address(uint160(0x12045));
        vm.etch(wrongHook, hex"00");
        value.graduatedHook = wrongHook;
        value.hookCodeHash = wrongHook.codehash;
        _expectInvalid(TEMPLATE_ID, value);
    }

    function test_rejectsMissingOrMismatchedRuntimeCode() public {
        LaunchTemplate memory value = _validTemplate();
        value.memeTokenImplementation = address(0x1234);
        value.memeTokenCodeHash = keccak256("missing");
        _expectCodeMismatch(value.memeTokenImplementation, value.memeTokenCodeHash, value);

        value = _validTemplate();
        value.curveCodeHash = keccak256("wrong-runtime");
        _expectCodeMismatch(value.curveImplementation, value.curveCodeHash, value);

        value = _validTemplate();
        value.graduationExecutor = address(0x5678);
        vm.expectRevert(
            abi.encodeWithSelector(
                LaunchTemplateRegistry.CodeIdentityMismatch.selector,
                value.graduationExecutor,
                bytes32(0),
                value.graduationExecutor.codehash
            )
        );
        vm.prank(FAST_ADMIN);
        registry.addLaunchTemplate(TEMPLATE_ID, value);
    }

    function test_templateIdIsWriteOnce() public {
        LaunchTemplate memory value = _validTemplate();
        _addFast(TEMPLATE_ID, value);
        vm.expectRevert(
            abi.encodeWithSelector(LaunchTemplateRegistry.LaunchTemplateAlreadyExists.selector, TEMPLATE_ID)
        );
        vm.prank(FAST_ADMIN);
        registry.addLaunchTemplate(TEMPLATE_ID, value);
    }

    function test_pauseAndUnpausePreserveHashAndUseOneDayDelay() public {
        LaunchTemplate memory value = _validTemplate();
        bytes32 expectedHash = _templateHash(value);
        _addFast(TEMPLATE_ID, value);
        vm.expectEmit(true, false, false, true);
        emit LaunchTemplateStatusChanged(TEMPLATE_ID, 1, 2, REASON_HASH);
        vm.prank(GUARDIAN);
        registry.pauseLaunchTemplate(TEMPLATE_ID, REASON_HASH);
        _assertTemplate(TEMPLATE_ID, value, 2, expectedHash);

        bytes memory data = abi.encodeCall(ILaunchTemplateRegistry.unpauseLaunchTemplate, (TEMPLATE_ID));
        uint48 readyAt = uint48(block.timestamp + UNPAUSE_DELAY);
        vm.prank(UNPAUSER);
        manager.schedule(address(registry), data, readyAt);
        vm.warp(readyAt - 1);
        vm.prank(UNPAUSER);
        vm.expectRevert();
        manager.execute(address(registry), data);
        vm.warp(readyAt);
        vm.expectEmit(true, false, false, true, address(registry));
        emit LaunchTemplateStatusChanged(TEMPLATE_ID, 2, 1, bytes32(0));
        vm.prank(UNPAUSER);
        manager.execute(address(registry), data);
        _assertTemplate(TEMPLATE_ID, value, 1, expectedHash);
    }

    function test_unpauseCannotBePreScheduledBeforePause() public {
        LaunchTemplate memory value = _validTemplate();
        _addFast(TEMPLATE_ID, value);
        bytes memory data = abi.encodeCall(ILaunchTemplateRegistry.unpauseLaunchTemplate, (TEMPLATE_ID));
        uint48 scheduledAt = uint48(block.timestamp + UNPAUSE_DELAY);
        vm.prank(UNPAUSER);
        manager.schedule(address(registry), data, scheduledAt);

        vm.warp(block.timestamp + 1);
        uint48 pausedAt = uint48(block.timestamp);
        vm.prank(GUARDIAN);
        registry.pauseLaunchTemplate(TEMPLATE_ID, REASON_HASH);

        vm.warp(uint256(pausedAt) + UNPAUSE_DELAY - 1);
        vm.prank(UNPAUSER);
        vm.expectRevert();
        manager.execute(address(registry), data);

        vm.warp(uint256(pausedAt) + UNPAUSE_DELAY);
        vm.prank(UNPAUSER);
        manager.execute(address(registry), data);
        _assertTemplate(TEMPLATE_ID, value, 1, _templateHash(value));
    }

    function test_invalidPauseAndUnpauseTransitionsFailClosed() public {
        vm.expectRevert(abi.encodeWithSelector(LaunchTemplateRegistry.InvalidStateTransition.selector, 0, 2));
        vm.prank(GUARDIAN);
        registry.pauseLaunchTemplate(TEMPLATE_ID, REASON_HASH);

        LaunchTemplate memory value = _validTemplate();
        _addFast(TEMPLATE_ID, value);
        bytes memory data = abi.encodeCall(ILaunchTemplateRegistry.unpauseLaunchTemplate, (TEMPLATE_ID));
        uint48 readyAt = uint48(block.timestamp + UNPAUSE_DELAY);
        vm.prank(UNPAUSER);
        manager.schedule(address(registry), data, readyAt);
        vm.warp(readyAt);
        vm.expectRevert(abi.encodeWithSelector(LaunchTemplateRegistry.InvalidStateTransition.selector, 1, 1));
        vm.prank(UNPAUSER);
        manager.execute(address(registry), data);
    }

    function test_retireFromActiveUsesTwoDayDelayAndIsTerminal() public {
        LaunchTemplate memory value = _validTemplate();
        bytes32 expectedHash = _templateHash(value);
        _addFast(TEMPLATE_ID, value);
        bytes memory data = abi.encodeCall(ILaunchTemplateRegistry.retireLaunchTemplate, (TEMPLATE_ID, REASON_HASH));
        uint48 readyAt = uint48(block.timestamp + ADMIN_DELAY);
        vm.prank(DELAYED_ADMIN);
        manager.schedule(address(registry), data, readyAt);
        vm.warp(readyAt);
        vm.expectEmit(true, false, false, true, address(registry));
        emit LaunchTemplateStatusChanged(TEMPLATE_ID, 1, 3, REASON_HASH);
        vm.prank(DELAYED_ADMIN);
        manager.execute(address(registry), data);
        _assertTemplate(TEMPLATE_ID, value, 3, expectedHash);

        vm.expectRevert(abi.encodeWithSelector(LaunchTemplateRegistry.InvalidStateTransition.selector, 3, 2));
        vm.prank(GUARDIAN);
        registry.pauseLaunchTemplate(TEMPLATE_ID, REASON_HASH);
    }

    function test_retireFromPausedPreservesAllImmutableFieldsAndHash() public {
        LaunchTemplate memory value = _validTemplate();
        bytes32 expectedHash = _templateHash(value);
        _addFast(TEMPLATE_ID, value);
        vm.prank(GUARDIAN);
        registry.pauseLaunchTemplate(TEMPLATE_ID, REASON_HASH);
        vm.expectEmit(true, false, false, true);
        emit LaunchTemplateStatusChanged(TEMPLATE_ID, 2, 3, REASON_HASH);
        vm.prank(FAST_ADMIN);
        registry.retireLaunchTemplate(TEMPLATE_ID, REASON_HASH);
        _assertTemplate(TEMPLATE_ID, value, 3, expectedHash);
    }

    function _validTemplate() private view returns (LaunchTemplate memory) {
        return LaunchTemplate({
            memeTokenImplementation: memeTokenImplementation,
            memeTokenCodeHash: memeTokenImplementation.codehash,
            curveImplementation: curveImplementation,
            curveCodeHash: curveImplementation.codehash,
            gaugeImplementation: gaugeImplementation,
            gaugeCodeHash: gaugeImplementation.codehash,
            graduatedHook: HOOK,
            hookCodeHash: HOOK.codehash,
            graduationExecutor: graduationExecutor,
            launchLockerImplementation: launchLockerImplementation,
            launchLockerCodeHash: launchLockerImplementation.codehash,
            feePolicyId: FEE_POLICY_ID,
            executionSpecId: EXECUTION_SPEC_ID(),
            status: 1
        });
    }

    function _templateHash(LaunchTemplate memory value) private pure returns (bytes32) {
        bytes memory first = abi.encode(
            keccak256("TICKERGARDEN_V1_LAUNCH_TEMPLATE"),
            uint256(1),
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
            value.launchLockerImplementation,
            value.launchLockerCodeHash,
            value.feePolicyId,
            value.executionSpecId
        );
        return keccak256(bytes.concat(first, second));
    }

    function _addFast(bytes32 templateId, LaunchTemplate memory value) private {
        vm.prank(FAST_ADMIN);
        registry.addLaunchTemplate(templateId, value);
    }

    function _expectInvalid(bytes32 templateId, LaunchTemplate memory value) private {
        vm.expectRevert(abi.encodeWithSelector(LaunchTemplateRegistry.InvalidLaunchTemplate.selector, templateId));
        vm.prank(FAST_ADMIN);
        registry.addLaunchTemplate(templateId, value);
    }

    function _expectCodeMismatch(address component, bytes32 suppliedHash, LaunchTemplate memory value) private {
        vm.expectRevert(
            abi.encodeWithSelector(
                LaunchTemplateRegistry.CodeIdentityMismatch.selector, component, suppliedHash, component.codehash
            )
        );
        vm.prank(FAST_ADMIN);
        registry.addLaunchTemplate(TEMPLATE_ID, value);
    }

    function _expectUnauthorized(bytes4 selector) private {
        vm.expectRevert(
            abi.encodeWithSelector(ImmutableAccessManaged.AccessManagedUnauthorized.selector, address(this), selector)
        );
    }

    function _assertTemplate(
        bytes32 templateId,
        LaunchTemplate memory expected,
        uint8 expectedStatus,
        bytes32 expectedHash
    ) private view {
        LaunchTemplate memory actual = registry.launchTemplate(templateId);
        assertEq(actual.memeTokenImplementation, expected.memeTokenImplementation);
        assertEq(actual.memeTokenCodeHash, expected.memeTokenCodeHash);
        assertEq(actual.curveImplementation, expected.curveImplementation);
        assertEq(actual.curveCodeHash, expected.curveCodeHash);
        assertEq(actual.gaugeImplementation, expected.gaugeImplementation);
        assertEq(actual.gaugeCodeHash, expected.gaugeCodeHash);
        assertEq(actual.graduatedHook, expected.graduatedHook);
        assertEq(actual.hookCodeHash, expected.hookCodeHash);
        assertEq(actual.graduationExecutor, expected.graduationExecutor);
        assertEq(actual.launchLockerImplementation, expected.launchLockerImplementation);
        assertEq(actual.launchLockerCodeHash, expected.launchLockerCodeHash);
        assertEq(actual.feePolicyId, expected.feePolicyId);
        assertEq(actual.executionSpecId, expected.executionSpecId);
        assertEq(actual.status, expectedStatus);
        assertEq(registry.launchTemplateHash(templateId), expectedHash);
    }
}
