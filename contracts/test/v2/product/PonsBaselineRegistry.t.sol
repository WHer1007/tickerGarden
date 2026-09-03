// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";

import {IPonsBaselineRegistry, PonsBaseline} from "../../../src/v2/interfaces/IV2Protocol.sol";
import {PonsBaselineRegistry} from "../../../src/v2/modules/PonsBaselineRegistry.sol";
import {ImmutableAccessManaged} from "../../../src/v2/shared/ImmutableAccessManaged.sol";

contract PonsFactoryFixture {
    function marker() external pure returns (bytes4) {
        return this.marker.selector;
    }
}

contract PonsBaselineRegistryTest is Test {
    uint64 internal constant PROTOCOL_ADMIN_ROLE = 1;
    uint64 internal constant PAUSE_GUARDIAN_ROLE = 2;
    uint64 internal constant UNPAUSE_ROLE = 3;
    uint32 internal constant ADMIN_DELAY = 2 days;
    uint32 internal constant UNPAUSE_DELAY = 1 days;
    uint256 internal constant TARGET_CHAIN_ID = 4663;

    address internal constant DELAYED_ADMIN = address(0xA11CE);
    address internal constant FAST_ADMIN = address(0xFA57);
    address internal constant GUARDIAN = address(0x6A7D);
    address internal constant UNPAUSER = address(0xBEEF);

    bytes32 internal constant BEHAVIOR_ROOT = 0x78d3fa45758f93f793093e0ea0cd900f9aaade792dc1cb6a1d3567b1dc81881d;
    bytes32 internal constant REASON_HASH = keccak256("baseline-risk");

    AccessManager internal manager;
    PonsBaselineRegistry internal registry;
    PonsFactoryFixture internal factory;

    event PonsBaselineAdded(bytes32 indexed baselineId, bytes32 indexed behaviorVectorRoot, bytes32 factoryCodeHash);
    event PonsBaselineStatusChanged(bytes32 indexed baselineId, uint8 oldStatus, uint8 newStatus, bytes32 reasonHash);

    function setUp() public {
        vm.chainId(TARGET_CHAIN_ID);
        vm.warp(1_000_000);
        manager = new AccessManager(address(this));
        registry = new PonsBaselineRegistry(address(manager));
        factory = new PonsFactoryFixture();

        bytes4[] memory adminSelectors = new bytes4[](2);
        adminSelectors[0] = IPonsBaselineRegistry.addBaseline.selector;
        adminSelectors[1] = IPonsBaselineRegistry.retireBaseline.selector;
        manager.setTargetFunctionRole(address(registry), adminSelectors, PROTOCOL_ADMIN_ROLE);

        bytes4[] memory pauseSelectors = new bytes4[](1);
        pauseSelectors[0] = IPonsBaselineRegistry.pauseBaseline.selector;
        manager.setTargetFunctionRole(address(registry), pauseSelectors, PAUSE_GUARDIAN_ROLE);

        bytes4[] memory unpauseSelectors = new bytes4[](1);
        unpauseSelectors[0] = IPonsBaselineRegistry.unpauseBaseline.selector;
        manager.setTargetFunctionRole(address(registry), unpauseSelectors, UNPAUSE_ROLE);

        manager.grantRole(PROTOCOL_ADMIN_ROLE, DELAYED_ADMIN, ADMIN_DELAY);
        manager.grantRole(PROTOCOL_ADMIN_ROLE, FAST_ADMIN, 0);
        manager.grantRole(PAUSE_GUARDIAN_ROLE, GUARDIAN, 0);
        manager.grantRole(UNPAUSE_ROLE, UNPAUSER, UNPAUSE_DELAY);
    }

    function test_constructorRequiresDeployedAuthority() public {
        vm.expectRevert(abi.encodeWithSelector(ImmutableAccessManaged.InvalidAuthority.selector, address(0)));
        new PonsBaselineRegistry(address(0));

        address noCode = address(0x1234);
        vm.expectRevert(abi.encodeWithSelector(ImmutableAccessManaged.InvalidAuthority.selector, noCode));
        new PonsBaselineRegistry(noCode);
    }

    function test_selectorsMatchCanonicalInterface() public pure {
        assertEq(PonsBaselineRegistry.addBaseline.selector, IPonsBaselineRegistry.addBaseline.selector);
        assertEq(PonsBaselineRegistry.pauseBaseline.selector, IPonsBaselineRegistry.pauseBaseline.selector);
        assertEq(PonsBaselineRegistry.unpauseBaseline.selector, IPonsBaselineRegistry.unpauseBaseline.selector);
        assertEq(PonsBaselineRegistry.retireBaseline.selector, IPonsBaselineRegistry.retireBaseline.selector);
        assertEq(PonsBaselineRegistry.baseline.selector, IPonsBaselineRegistry.baseline.selector);
    }

    function test_unknownBaselineIsUnset() public view {
        PonsBaseline memory value = registry.baseline(keccak256("unknown"));
        assertEq(value.referenceChainId, 0);
        assertEq(value.referenceFactory, address(0));
        assertEq(value.referenceFactoryCodeHash, bytes32(0));
        assertEq(value.launchConfigId, 0);
        assertEq(value.supply, 0);
        assertEq(value.curveFeeBps, 0);
        assertEq(value.poolFee, 0);
        assertEq(value.tickSpacing, 0);
        assertEq(value.behaviorVectorRoot, bytes32(0));
        assertEq(value.status, 0);
    }

    function test_allMutationsRequireConfiguredRoles() public {
        bytes32 id = keccak256("unauthorized");
        PonsBaseline memory value = _validBaseline();
        _expectUnauthorized(IPonsBaselineRegistry.addBaseline.selector);
        registry.addBaseline(id, value);
        _expectUnauthorized(IPonsBaselineRegistry.pauseBaseline.selector);
        registry.pauseBaseline(id, REASON_HASH);
        _expectUnauthorized(IPonsBaselineRegistry.unpauseBaseline.selector);
        registry.unpauseBaseline(id);
        _expectUnauthorized(IPonsBaselineRegistry.retireBaseline.selector);
        registry.retireBaseline(id, REASON_HASH);
    }

    function test_addUsesExact48HourAccessManagerDelay() public {
        bytes32 id = keccak256("delayed-add");
        PonsBaseline memory value = _validBaseline();
        bytes memory data = abi.encodeCall(IPonsBaselineRegistry.addBaseline, (id, value));

        vm.prank(DELAYED_ADMIN);
        vm.expectRevert();
        registry.addBaseline(id, value);

        uint48 readyAt = uint48(block.timestamp + ADMIN_DELAY);
        vm.prank(DELAYED_ADMIN);
        manager.schedule(address(registry), data, readyAt);
        vm.warp(readyAt - 1);
        vm.prank(DELAYED_ADMIN);
        vm.expectRevert();
        manager.execute(address(registry), data);

        vm.warp(readyAt);
        vm.expectEmit(true, true, true, true, address(registry));
        emit PonsBaselineAdded(id, value.behaviorVectorRoot, value.referenceFactoryCodeHash);
        vm.prank(DELAYED_ADMIN);
        manager.execute(address(registry), data);
        _assertBaseline(id, value, 1);
    }

    function test_addsValidBaselineIncludingLaunchConfigZeroAndEmitsEvent() public {
        bytes32 id = keccak256("valid-baseline");
        PonsBaseline memory value = _validBaseline();
        assertEq(value.launchConfigId, 0);
        vm.expectEmit(true, true, true, true, address(registry));
        emit PonsBaselineAdded(id, value.behaviorVectorRoot, value.referenceFactoryCodeHash);
        _addFast(id, value);
        _assertBaseline(id, value, 1);
    }

    function test_validatesFactoryHasCodeAndExactRuntimeHash() public {
        PonsBaseline memory value = _validBaseline();
        bytes32 id = keccak256("factory-check");

        value.referenceFactory = address(0x1234);
        vm.expectRevert();
        _addFast(id, value);

        value = _validBaseline();
        value.referenceFactoryCodeHash = bytes32(uint256(1));
        vm.expectRevert();
        _addFast(id, value);

        value = _validBaseline();
        value.referenceFactoryCodeHash = address(factory).codehash;
        _addFast(id, value);
        _assertBaseline(id, value, 1);
    }

    function test_rejectsInvalidBaselineIdentityAndParameters() public {
        PonsBaseline memory value = _validBaseline();
        _expectInvalid(bytes32(0), value);

        value = _validBaseline();
        value.referenceChainId = 0;
        _expectInvalid(keccak256("zero-chain"), value);
        value = _validBaseline();
        value.referenceFactory = address(0);
        _expectInvalid(keccak256("zero-factory"), value);
        value = _validBaseline();
        value.referenceFactoryCodeHash = bytes32(0);
        _expectInvalid(keccak256("zero-code-hash"), value);
        value = _validBaseline();
        value.supply = 0;
        _expectInvalid(keccak256("zero-supply"), value);
        value = _validBaseline();
        value.behaviorVectorRoot = bytes32(0);
        _expectInvalid(keccak256("zero-behavior-root"), value);
        value = _validBaseline();
        value.curveFeeBps = 10_000;
        _expectInvalid(keccak256("fee-at-bound"), value);
        value = _validBaseline();
        value.poolFee = 1;
        _expectInvalid(keccak256("nonzero-pool-fee"), value);
        value = _validBaseline();
        value.tickSpacing = 0;
        _expectInvalid(keccak256("zero-tick-spacing"), value);
        value = _validBaseline();
        value.tickSpacing = 32_768;
        _expectInvalid(keccak256("large-tick-spacing"), value);
        value = _validBaseline();
        value.status = 0;
        _expectInvalid(keccak256("unset-status"), value);
        value = _validBaseline();
        value.status = 2;
        _expectInvalid(keccak256("paused-status"), value);
        value = _validBaseline();
        value.status = 3;
        _expectInvalid(keccak256("retired-status"), value);
    }

    function test_tickSpacingInclusiveBoundsAreAccepted() public {
        PonsBaseline memory value = _validBaseline();
        value.tickSpacing = 1;
        bytes32 lowId = keccak256("tick-one");
        _addFast(lowId, value);

        value = _validBaseline();
        value.tickSpacing = 32_767;
        bytes32 highId = keccak256("tick-max");
        _addFast(highId, value);
        assertEq(registry.baseline(lowId).status, 1);
        assertEq(registry.baseline(highId).status, 1);
    }

    function test_baselineIdIsWriteOnceAndFieldsRemainFrozen() public {
        bytes32 id = keccak256("write-once");
        PonsBaseline memory value = _validBaseline();
        _addFast(id, value);
        PonsBaseline memory changed = _validBaseline();
        changed.supply += 1;
        vm.expectRevert();
        _addFast(id, changed);
        _assertBaseline(id, value, 1);
    }

    function test_pauseAndUnpauseUseExactStateAndOneDayDelay() public {
        bytes32 id = keccak256("pause-cycle");
        PonsBaseline memory value = _validBaseline();
        _addFast(id, value);

        vm.expectEmit(true, false, false, true, address(registry));
        emit PonsBaselineStatusChanged(id, 1, 2, REASON_HASH);
        vm.prank(GUARDIAN);
        registry.pauseBaseline(id, REASON_HASH);
        assertEq(registry.baseline(id).status, 2);

        bytes memory data = abi.encodeCall(IPonsBaselineRegistry.unpauseBaseline, (id));
        uint48 readyAt = uint48(block.timestamp + UNPAUSE_DELAY);
        vm.prank(UNPAUSER);
        manager.schedule(address(registry), data, readyAt);
        vm.warp(readyAt - 1);
        vm.prank(UNPAUSER);
        vm.expectRevert();
        manager.execute(address(registry), data);

        vm.warp(readyAt);
        vm.expectEmit(true, false, false, true, address(registry));
        emit PonsBaselineStatusChanged(id, 2, 1, bytes32(0));
        vm.prank(UNPAUSER);
        manager.execute(address(registry), data);
        assertEq(registry.baseline(id).status, 1);
    }

    function test_invalidPauseAndUnpauseTransitionsFailClosed() public {
        bytes32 id = keccak256("invalid-transitions");
        vm.expectRevert();
        vm.prank(GUARDIAN);
        registry.pauseBaseline(id, REASON_HASH);

        PonsBaseline memory value = _validBaseline();
        _addFast(id, value);
        bytes memory data = abi.encodeCall(IPonsBaselineRegistry.unpauseBaseline, (id));
        uint48 readyAt = uint48(block.timestamp + UNPAUSE_DELAY);
        vm.prank(UNPAUSER);
        manager.schedule(address(registry), data, readyAt);
        vm.warp(readyAt);
        vm.prank(UNPAUSER);
        vm.expectRevert();
        manager.execute(address(registry), data);
    }

    function test_retireFromActiveUsesTwoDayDelayAndIsTerminal() public {
        bytes32 id = keccak256("retire-active");
        PonsBaseline memory value = _validBaseline();
        _addFast(id, value);
        bytes memory data = abi.encodeCall(IPonsBaselineRegistry.retireBaseline, (id, REASON_HASH));
        uint48 readyAt = uint48(block.timestamp + ADMIN_DELAY);
        vm.prank(DELAYED_ADMIN);
        manager.schedule(address(registry), data, readyAt);
        vm.warp(readyAt - 1);
        vm.prank(DELAYED_ADMIN);
        vm.expectRevert();
        manager.execute(address(registry), data);

        vm.warp(readyAt);
        vm.expectEmit(true, false, false, true, address(registry));
        emit PonsBaselineStatusChanged(id, 1, 3, REASON_HASH);
        vm.prank(DELAYED_ADMIN);
        manager.execute(address(registry), data);
        assertEq(registry.baseline(id).status, 3);

        vm.expectRevert();
        vm.prank(GUARDIAN);
        registry.pauseBaseline(id, REASON_HASH);
        bytes memory unpauseData = abi.encodeCall(IPonsBaselineRegistry.unpauseBaseline, (id));
        uint48 unpauseReadyAt = uint48(block.timestamp + UNPAUSE_DELAY);
        vm.prank(UNPAUSER);
        manager.schedule(address(registry), unpauseData, unpauseReadyAt);
        vm.warp(unpauseReadyAt);
        vm.prank(UNPAUSER);
        vm.expectRevert();
        manager.execute(address(registry), unpauseData);
    }

    function test_retireFromPausedIsAllowedAndPreservesFields() public {
        bytes32 id = keccak256("retire-paused");
        PonsBaseline memory value = _validBaseline();
        _addFast(id, value);
        vm.prank(GUARDIAN);
        registry.pauseBaseline(id, REASON_HASH);
        vm.expectEmit(true, false, false, true, address(registry));
        emit PonsBaselineStatusChanged(id, 2, 3, REASON_HASH);
        vm.prank(FAST_ADMIN);
        registry.retireBaseline(id, REASON_HASH);
        _assertBaseline(id, value, 3);
    }

    function _validBaseline() private view returns (PonsBaseline memory) {
        return PonsBaseline({
            referenceChainId: TARGET_CHAIN_ID,
            referenceFactory: address(factory),
            referenceFactoryCodeHash: address(factory).codehash,
            launchConfigId: 0,
            supply: 1_000_000_000 ether,
            curveFeeBps: 100,
            poolFee: 0,
            tickSpacing: 200,
            behaviorVectorRoot: BEHAVIOR_ROOT,
            status: 1
        });
    }

    function _addFast(bytes32 id, PonsBaseline memory value) private {
        vm.prank(FAST_ADMIN);
        registry.addBaseline(id, value);
    }

    function _expectInvalid(bytes32 id, PonsBaseline memory value) private {
        vm.expectRevert();
        vm.prank(FAST_ADMIN);
        registry.addBaseline(id, value);
    }

    function _expectUnauthorized(bytes4 selector) private {
        vm.expectRevert(
            abi.encodeWithSelector(ImmutableAccessManaged.AccessManagedUnauthorized.selector, address(this), selector)
        );
    }

    function _assertBaseline(bytes32 id, PonsBaseline memory expected, uint8 status) private view {
        PonsBaseline memory actual = registry.baseline(id);
        assertEq(actual.referenceChainId, expected.referenceChainId);
        assertEq(actual.referenceFactory, expected.referenceFactory);
        assertEq(actual.referenceFactoryCodeHash, expected.referenceFactoryCodeHash);
        assertEq(actual.launchConfigId, expected.launchConfigId);
        assertEq(actual.supply, expected.supply);
        assertEq(actual.curveFeeBps, expected.curveFeeBps);
        assertEq(actual.poolFee, expected.poolFee);
        assertEq(actual.tickSpacing, expected.tickSpacing);
        assertEq(actual.behaviorVectorRoot, expected.behaviorVectorRoot);
        assertEq(actual.status, status);
    }
}
