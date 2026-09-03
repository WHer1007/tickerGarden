// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import {Test} from "forge-std/Test.sol";

import {ImmutableAccessManaged} from "../../../src/v2/shared/ImmutableAccessManaged.sol";

contract AccessManagerConfigurationTarget is ImmutableAccessManaged {
    uint256 public calls;

    constructor(address authority_) ImmutableAccessManaged(authority_) {}

    function protocolAdminAction() external restricted {
        calls += 1;
    }

    function pauseAction() external restricted {
        calls += 1;
    }

    function unpauseAction() external restricted {
        calls += 1;
    }

    function recoveryAction() external restricted {
        calls += 1;
    }
}

contract AccessManagerConfigurationTest is Test {
    uint64 private constant PROTOCOL_ADMIN_ROLE = 1;
    uint64 private constant PAUSE_GUARDIAN_ROLE = 2;
    uint64 private constant UNPAUSE_ROLE = 3;
    uint64 private constant RECOVERY_ROLE = 4;
    uint32 private constant ADMIN_DELAY = 2 days;
    uint32 private constant OPERATIONS_DELAY = 1 days;

    address private constant GOVERNANCE_SAFE = address(0xA001);
    address private constant GUARDIAN_SAFE = address(0xA002);
    address private constant SECURITY_SAFE = address(0xA003);
    address private constant RECOVERY_SAFE = address(0xA004);

    AccessManager private manager;
    AccessManagerConfigurationTarget private target;

    function setUp() public {
        vm.warp(1_000_000);
        manager = new AccessManager(address(this));
        target = new AccessManagerConfigurationTarget(address(manager));

        manager.setRoleGuardian(PROTOCOL_ADMIN_ROLE, PAUSE_GUARDIAN_ROLE);
        manager.setRoleGuardian(UNPAUSE_ROLE, PAUSE_GUARDIAN_ROLE);
        manager.setRoleGuardian(RECOVERY_ROLE, PAUSE_GUARDIAN_ROLE);

        _setTargetRole(AccessManagerConfigurationTarget.protocolAdminAction.selector, PROTOCOL_ADMIN_ROLE);
        _setTargetRole(AccessManagerConfigurationTarget.pauseAction.selector, PAUSE_GUARDIAN_ROLE);
        _setTargetRole(AccessManagerConfigurationTarget.unpauseAction.selector, UNPAUSE_ROLE);
        _setTargetRole(AccessManagerConfigurationTarget.recoveryAction.selector, RECOVERY_ROLE);

        manager.grantRole(PROTOCOL_ADMIN_ROLE, GOVERNANCE_SAFE, ADMIN_DELAY);
        manager.grantRole(PAUSE_GUARDIAN_ROLE, GUARDIAN_SAFE, 0);
        manager.grantRole(UNPAUSE_ROLE, SECURITY_SAFE, OPERATIONS_DELAY);
        manager.grantRole(RECOVERY_ROLE, RECOVERY_SAFE, OPERATIONS_DELAY);

        manager.setRoleAdmin(PROTOCOL_ADMIN_ROLE, PROTOCOL_ADMIN_ROLE);
        manager.setRoleAdmin(PAUSE_GUARDIAN_ROLE, PROTOCOL_ADMIN_ROLE);
        manager.setRoleAdmin(UNPAUSE_ROLE, PROTOCOL_ADMIN_ROLE);
        manager.setRoleAdmin(RECOVERY_ROLE, PROTOCOL_ADMIN_ROLE);
        manager.renounceRole(manager.ADMIN_ROLE(), address(this));
    }

    function test_handoffLeavesOnlyFrozenSafeRolesAndLocksGlobalAdminSurface() public {
        (bool deployerIsAdmin,) = manager.hasRole(manager.ADMIN_ROLE(), address(this));
        assertFalse(deployerIsAdmin);
        _assertRole(PROTOCOL_ADMIN_ROLE, GOVERNANCE_SAFE, ADMIN_DELAY);
        _assertRole(PAUSE_GUARDIAN_ROLE, GUARDIAN_SAFE, 0);
        _assertRole(UNPAUSE_ROLE, SECURITY_SAFE, OPERATIONS_DELAY);
        _assertRole(RECOVERY_ROLE, RECOVERY_SAFE, OPERATIONS_DELAY);

        assertEq(manager.getRoleGuardian(PROTOCOL_ADMIN_ROLE), PAUSE_GUARDIAN_ROLE);
        assertEq(manager.getRoleGuardian(UNPAUSE_ROLE), PAUSE_GUARDIAN_ROLE);
        assertEq(manager.getRoleGuardian(RECOVERY_ROLE), PAUSE_GUARDIAN_ROLE);
        assertEq(manager.getRoleAdmin(PROTOCOL_ADMIN_ROLE), PROTOCOL_ADMIN_ROLE);
        assertEq(manager.getRoleAdmin(PAUSE_GUARDIAN_ROLE), PROTOCOL_ADMIN_ROLE);
        assertEq(manager.getRoleAdmin(UNPAUSE_ROLE), PROTOCOL_ADMIN_ROLE);
        assertEq(manager.getRoleAdmin(RECOVERY_ROLE), PROTOCOL_ADMIN_ROLE);
        assertEq(manager.getTargetFunctionRole(address(manager), manager.grantRole.selector), manager.ADMIN_ROLE());

        vm.expectRevert();
        manager.setRoleGuardian(RECOVERY_ROLE, PROTOCOL_ADMIN_ROLE);
        vm.prank(GOVERNANCE_SAFE);
        vm.expectRevert();
        manager.setRoleGuardian(RECOVERY_ROLE, PROTOCOL_ADMIN_ROLE);

        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = AccessManagerConfigurationTarget.pauseAction.selector;
        vm.prank(GOVERNANCE_SAFE);
        vm.expectRevert();
        manager.setTargetFunctionRole(address(target), selectors, PROTOCOL_ADMIN_ROLE);
    }

    function test_immediateAndDelayedProtocolRolesExecuteWithExactDelays() public {
        vm.prank(GUARDIAN_SAFE);
        target.pauseAction();

        _scheduleAndExecute(GOVERNANCE_SAFE, abi.encodeCall(target.protocolAdminAction, ()), ADMIN_DELAY);
        _scheduleAndExecute(SECURITY_SAFE, abi.encodeCall(target.unpauseAction, ()), OPERATIONS_DELAY);
        assertEq(target.calls(), 3);
    }

    function test_guardianCancelsRecoveryAndGovernanceRetainsOnlyDelayedConfiguration() public {
        bytes memory recoveryData = abi.encodeCall(target.recoveryAction, ());
        uint48 recoveryReadyAt = uint48(block.timestamp + OPERATIONS_DELAY);
        vm.prank(RECOVERY_SAFE);
        manager.schedule(address(target), recoveryData, recoveryReadyAt);
        vm.prank(GUARDIAN_SAFE);
        manager.cancel(RECOVERY_SAFE, address(target), recoveryData);
        vm.warp(recoveryReadyAt);
        vm.prank(RECOVERY_SAFE);
        vm.expectRevert();
        manager.execute(address(target), recoveryData);

        address replacementGuardian = address(0xB001);
        bytes memory grantData = abi.encodeCall(manager.grantRole, (PAUSE_GUARDIAN_ROLE, replacementGuardian, 0));
        _scheduleAndExecuteManager(GOVERNANCE_SAFE, grantData, ADMIN_DELAY);
        _assertRole(PAUSE_GUARDIAN_ROLE, replacementGuardian, 0);
    }

    function _setTargetRole(bytes4 functionSelector, uint64 roleId) private {
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = functionSelector;
        manager.setTargetFunctionRole(address(target), selectors, roleId);
    }

    function _scheduleAndExecute(address actor, bytes memory data, uint32 delay) private {
        vm.prank(actor);
        (bool directSuccess,) = address(target).call(data);
        assertFalse(directSuccess);
        uint48 readyAt = uint48(block.timestamp + delay);
        vm.prank(actor);
        manager.schedule(address(target), data, readyAt);
        vm.warp(readyAt - 1);
        vm.prank(actor);
        vm.expectRevert();
        manager.execute(address(target), data);
        vm.warp(readyAt);
        vm.prank(actor);
        manager.execute(address(target), data);
    }

    function _scheduleAndExecuteManager(address actor, bytes memory data, uint32 delay) private {
        uint48 readyAt = uint48(block.timestamp + delay);
        vm.prank(actor);
        manager.schedule(address(manager), data, readyAt);
        vm.warp(readyAt);
        vm.prank(actor);
        manager.execute(address(manager), data);
    }

    function _assertRole(uint64 roleId, address account, uint32 expectedDelay) private view {
        (bool member, uint32 actualDelay) = manager.hasRole(roleId, account);
        assertTrue(member);
        assertEq(actualDelay, expectedDelay);
    }
}
