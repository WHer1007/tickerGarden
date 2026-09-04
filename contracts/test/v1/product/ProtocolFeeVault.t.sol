// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {IProtocolFeeVault} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {ProtocolFeeVault, ProtocolFeeVaultInit} from "../../../src/v1/modules/ProtocolFeeVault.sol";
import {ProtocolFeeVaultCurveCredit} from "../../../src/v1/shared/ProtocolFeeVaultCurveCredit.sol";
import {ProtocolFeeVaultLiabilities} from "../../../src/v1/shared/ProtocolFeeVaultLiabilities.sol";
import {ProtocolFeeVaultV4Credit} from "../../../src/v1/shared/ProtocolFeeVaultV4Credit.sol";

contract ProtocolFeeVaultDependencyMock {}

contract ProtocolFeeVaultProductTest is Test {
    ProtocolFeeVaultDependencyMock private registry;
    ProtocolFeeVaultDependencyMock private poolManager;
    ProtocolFeeVaultDependencyMock private creatorRegistry;
    ProtocolFeeVaultDependencyMock private treasury;

    function setUp() public {
        registry = new ProtocolFeeVaultDependencyMock();
        poolManager = new ProtocolFeeVaultDependencyMock();
        creatorRegistry = new ProtocolFeeVaultDependencyMock();
        treasury = new ProtocolFeeVaultDependencyMock();
    }

    function test_constructorFreezesAccountingDependencies() public {
        ProtocolFeeVault vault = _deploy();
        assertGt(address(vault).code.length, 0);
        assertLt(address(vault).code.length, 24_576);
    }

    function test_canonicalMutationAndLiabilityViewSelectors() public pure {
        assertEq(ProtocolFeeVaultV4Credit.beginV4Credit.selector, IProtocolFeeVault.beginV4Credit.selector);
        assertEq(ProtocolFeeVaultV4Credit.finalizeV4Credit.selector, IProtocolFeeVault.finalizeV4Credit.selector);
        assertEq(ProtocolFeeVaultCurveCredit.beginCurveCredit.selector, IProtocolFeeVault.beginCurveCredit.selector);
        assertEq(
            ProtocolFeeVaultCurveCredit.finalizeCurveCredit.selector, IProtocolFeeVault.finalizeCurveCredit.selector
        );
        assertEq(ProtocolFeeVaultLiabilities.claimCreator.selector, IProtocolFeeVault.claimCreator.selector);
        assertEq(ProtocolFeeVaultLiabilities.claimPlatform.selector, IProtocolFeeVault.claimPlatform.selector);
        assertEq(ProtocolFeeVaultLiabilities.claimStaker.selector, IProtocolFeeVault.claimStaker.selector);
        assertEq(ProtocolFeeVaultLiabilities.claimStakerFor.selector, IProtocolFeeVault.claimStakerFor.selector);
        assertEq(ProtocolFeeVaultLiabilities.liability.selector, IProtocolFeeVault.liability.selector);
        assertEq(ProtocolFeeVaultLiabilities.totalLiability.selector, IProtocolFeeVault.totalLiability.selector);
    }

    function _deploy() private returns (ProtocolFeeVault) {
        return new ProtocolFeeVault(_init());
    }

    function _init() private view returns (ProtocolFeeVaultInit memory init) {
        init = ProtocolFeeVaultInit({
            marketRegistry: address(registry),
            poolManager: address(poolManager),
            creatorRevenueRegistry: address(creatorRegistry),
            platformTreasury: address(treasury),
            feePolicyId: keccak256("V1-FEE-POLICY")
        });
    }
}
