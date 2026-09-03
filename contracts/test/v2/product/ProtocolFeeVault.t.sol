// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import {Test} from "forge-std/Test.sol";

import {IProtocolFeeVault} from "../../../src/v2/interfaces/IV2Protocol.sol";
import {ProtocolFeeVault, ProtocolFeeVaultInit} from "../../../src/v2/modules/ProtocolFeeVault.sol";
import {ImmutableAccessManaged} from "../../../src/v2/shared/ImmutableAccessManaged.sol";
import {ProtocolFeeVaultCurveCredit} from "../../../src/v2/shared/ProtocolFeeVaultCurveCredit.sol";
import {ProtocolFeeVaultLiabilities} from "../../../src/v2/shared/ProtocolFeeVaultLiabilities.sol";
import {ProtocolFeeVaultRecoveryCaps} from "../../../src/v2/shared/ProtocolFeeVaultRecoveryCaps.sol";
import {ProtocolFeeVaultRecoveryClaims} from "../../../src/v2/shared/ProtocolFeeVaultRecoveryClaims.sol";
import {ProtocolFeeVaultRecoveryRoots} from "../../../src/v2/shared/ProtocolFeeVaultRecoveryRoots.sol";
import {ProtocolFeeVaultV4Credit} from "../../../src/v2/shared/ProtocolFeeVaultV4Credit.sol";

contract ProtocolFeeVaultDependencyMock {}

contract ProtocolFeeVaultProductTest is Test {
    AccessManager private accessManager;
    ProtocolFeeVaultDependencyMock private registry;
    ProtocolFeeVaultDependencyMock private poolManager;
    ProtocolFeeVaultDependencyMock private creatorRegistry;
    ProtocolFeeVaultDependencyMock private treasury;

    function setUp() public {
        accessManager = new AccessManager(address(this));
        registry = new ProtocolFeeVaultDependencyMock();
        poolManager = new ProtocolFeeVaultDependencyMock();
        creatorRegistry = new ProtocolFeeVaultDependencyMock();
        treasury = new ProtocolFeeVaultDependencyMock();
    }

    function test_constructorAcceptsPrecomputedControllerAndFreezesAuthority() public {
        address predictedController = address(0xC011);
        assertEq(predictedController.code.length, 0);
        ProtocolFeeVault vault = _deploy(predictedController);

        assertEq(vault.authority(), address(accessManager));
        assertGt(address(vault).code.length, 0);
        assertLt(address(vault).code.length, 24_576);
    }

    function test_constructorRejectsInvalidAuthorityAndControllerAlias() public {
        ProtocolFeeVaultInit memory init = _init(address(0xC011));
        init.authority = address(0xA11);
        vm.expectRevert(abi.encodeWithSelector(ImmutableAccessManaged.InvalidAuthority.selector, address(0xA11)));
        new ProtocolFeeVault(init);

        init = _init(address(registry));
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolFeeVaultRecoveryCaps.InvalidRecoveryController.selector, address(registry))
        );
        new ProtocolFeeVault(init);
    }

    function test_canonicalMutationAndRecoveryViewSelectors() public pure {
        assertEq(ProtocolFeeVaultV4Credit.beginV4Credit.selector, IProtocolFeeVault.beginV4Credit.selector);
        assertEq(ProtocolFeeVaultV4Credit.finalizeV4Credit.selector, IProtocolFeeVault.finalizeV4Credit.selector);
        assertEq(ProtocolFeeVaultCurveCredit.creditCurveSweep.selector, IProtocolFeeVault.creditCurveSweep.selector);
        assertEq(ProtocolFeeVaultLiabilities.claimCreator.selector, IProtocolFeeVault.claimCreator.selector);
        assertEq(ProtocolFeeVaultLiabilities.claimPlatform.selector, IProtocolFeeVault.claimPlatform.selector);
        assertEq(ProtocolFeeVaultLiabilities.claimStaker.selector, IProtocolFeeVault.claimStaker.selector);
        assertEq(ProtocolFeeVaultLiabilities.claimStakerFor.selector, IProtocolFeeVault.claimStakerFor.selector);
        assertEq(
            ProtocolFeeVaultRecoveryCaps.freezeRecoveryCaps.selector, IProtocolFeeVault.freezeRecoveryCaps.selector
        );
        assertEq(
            ProtocolFeeVaultRecoveryRoots.proposeRecoveryRoot.selector, IProtocolFeeVault.proposeRecoveryRoot.selector
        );
        assertEq(
            ProtocolFeeVaultRecoveryRoots.cancelRecoveryRoot.selector, IProtocolFeeVault.cancelRecoveryRoot.selector
        );
        assertEq(
            ProtocolFeeVaultRecoveryRoots.finalizeRecoveryRoot.selector, IProtocolFeeVault.finalizeRecoveryRoot.selector
        );
        assertEq(ProtocolFeeVaultRecoveryClaims.claimRecovery.selector, IProtocolFeeVault.claimRecovery.selector);
        assertEq(ProtocolFeeVaultRecoveryCaps.recoverySnapshot.selector, IProtocolFeeVault.recoverySnapshot.selector);
        assertEq(ProtocolFeeVaultRecoveryRoots.recoveryRoot.selector, IProtocolFeeVault.recoveryRoot.selector);
        assertEq(ProtocolFeeVaultRecoveryCaps.recoveryCap.selector, IProtocolFeeVault.recoveryCap.selector);
    }

    function _deploy(address controller) private returns (ProtocolFeeVault) {
        return new ProtocolFeeVault(_init(controller));
    }

    function _init(address controller) private view returns (ProtocolFeeVaultInit memory init) {
        init = ProtocolFeeVaultInit({
            authority: address(accessManager),
            marketRegistry: address(registry),
            poolManager: address(poolManager),
            creatorRevenueRegistry: address(creatorRegistry),
            platformTreasury: address(treasury),
            feePolicyId: keccak256("V2-FEE-POLICY"),
            marketController: controller
        });
    }
}
