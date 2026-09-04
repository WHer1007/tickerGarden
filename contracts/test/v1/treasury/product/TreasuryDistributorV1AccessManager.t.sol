// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import {Test} from "forge-std/Test.sol";

import {TreasuryEpochStatusV1} from "../../../../src/v1/interfaces/IV1Protocol.sol";
import {TreasuryDistributorInitV1, TreasuryDistributorV1} from "../../../../src/v1/modules/TreasuryDistributorV1.sol";
import {TickerMemeTokenV1} from "../../../../src/v1/modules/TickerMemeTokenV1.sol";
import {ImmutableAccessManaged} from "../../../../src/v1/shared/ImmutableAccessManaged.sol";
import {MockQuoteTokenV1, MockTreasuryMarketRegistryV1} from "../mocks/MockV1TreasuryAssets.sol";

contract TreasuryDistributorV1AccessManagerTest is Test {
    uint64 private constant PROTOCOL_ADMIN_ROLE = 1;
    uint64 private constant PAUSE_GUARDIAN_ROLE = 2;
    uint64 private constant ROOT_PUBLISHER_ROLE = 4;
    uint64 private constant ROOT_REVIEW_ROLE = 5;
    uint32 private constant PROTOCOL_ADMIN_DELAY = 2 days;

    bytes32 private constant MARKET_ID = keccak256("TREASURY-ACCESS-MANAGER-MARKET");
    bytes32 private constant ELIGIBILITY_POLICY = keccak256("TREASURY-ACCESS-MANAGER-POLICY");

    address private constant GOVERNANCE_SAFE = address(0xA001);
    address private constant GUARDIAN_SAFE = address(0xA002);
    address private constant ROOT_PUBLISHER_SAFE = address(0xA004);
    address private constant ROOT_REVIEWER_SAFE = address(0xA005);
    address private constant KEEPER = address(0xBEEF);
    address private constant CURVE = address(0xC0A7E);
    address private constant ROOT_SERVICE_TREASURY = address(0xFEE);

    AccessManager private manager;
    MockTreasuryMarketRegistryV1 private marketRegistry;
    TreasuryDistributorV1 private distributor;
    MockQuoteTokenV1 private quote;
    TickerMemeTokenV1 private meme;

    function setUp() public {
        vm.warp(1_700_000_000);
        manager = new AccessManager(address(this));
        marketRegistry = new MockTreasuryMarketRegistryV1();
        distributor = new TreasuryDistributorV1(_init(address(manager)));
        quote = new MockQuoteTokenV1();
        meme = new TickerMemeTokenV1(
            MARKET_ID,
            address(0xC0FFEE),
            CURVE,
            address(distributor),
            "Treasury Access Meme",
            "TAM",
            "ipfs://treasury-access",
            1_000_000 ether
        );
        marketRegistry.setMarket(MARKET_ID, address(meme), address(quote), 1);
        _configureAndFreezeAccessManager();
    }

    function test_constructorFreezesCanonicalAuthorityAndRegistryAndRejectsNonContracts() public {
        assertEq(distributor.authority(), address(manager));
        assertEq(distributor.marketRegistry(), address(marketRegistry));

        vm.expectRevert(abi.encodeWithSelector(ImmutableAccessManaged.InvalidAuthority.selector, address(0)));
        new TreasuryDistributorV1(_init(address(0)));

        address eoaAuthority = address(0xBAD);
        vm.expectRevert(abi.encodeWithSelector(ImmutableAccessManaged.InvalidAuthority.selector, eoaAuthority));
        new TreasuryDistributorV1(_init(eoaAuthority));
    }

    function test_frozenHandoffBindsExactRolesDelaysGuardiansAndSelectors() public view {
        (bool deployerAdmin,) = manager.hasRole(manager.ADMIN_ROLE(), address(this));
        assertFalse(deployerAdmin);
        _assertRole(PROTOCOL_ADMIN_ROLE, GOVERNANCE_SAFE, PROTOCOL_ADMIN_DELAY);
        _assertRole(PAUSE_GUARDIAN_ROLE, GUARDIAN_SAFE, 0);
        _assertRole(ROOT_PUBLISHER_ROLE, ROOT_PUBLISHER_SAFE, 0);
        _assertRole(ROOT_REVIEW_ROLE, ROOT_REVIEWER_SAFE, 0);

        assertEq(manager.getRoleAdmin(PROTOCOL_ADMIN_ROLE), PROTOCOL_ADMIN_ROLE);
        assertEq(manager.getRoleAdmin(PAUSE_GUARDIAN_ROLE), PROTOCOL_ADMIN_ROLE);
        assertEq(manager.getRoleAdmin(ROOT_PUBLISHER_ROLE), PROTOCOL_ADMIN_ROLE);
        assertEq(manager.getRoleAdmin(ROOT_REVIEW_ROLE), PROTOCOL_ADMIN_ROLE);
        assertEq(manager.getRoleGuardian(PROTOCOL_ADMIN_ROLE), PAUSE_GUARDIAN_ROLE);
        assertEq(manager.getRoleGuardian(ROOT_PUBLISHER_ROLE), PAUSE_GUARDIAN_ROLE);
        assertEq(manager.getRoleGuardian(ROOT_REVIEW_ROLE), PAUSE_GUARDIAN_ROLE);

        assertEq(
            manager.getTargetFunctionRole(address(distributor), TreasuryDistributorV1.registerMarket.selector),
            PROTOCOL_ADMIN_ROLE
        );
        assertEq(
            manager.getTargetFunctionRole(address(distributor), TreasuryDistributorV1.setRootServiceFee.selector),
            PROTOCOL_ADMIN_ROLE
        );
        assertEq(
            manager.getTargetFunctionRole(address(distributor), TreasuryDistributorV1.publishRoot.selector),
            ROOT_PUBLISHER_ROLE
        );
        assertEq(
            manager.getTargetFunctionRole(address(distributor), TreasuryDistributorV1.cancelPendingRoot.selector),
            ROOT_REVIEW_ROLE
        );
        assertEq(
            manager.getTargetFunctionRole(address(distributor), TreasuryDistributorV1.activateMarket.selector),
            manager.ADMIN_ROLE()
        );
    }

    function test_protocolConfigurationRequiresScheduleAndGuardianCanCancel() public {
        bytes memory feeUpdate = abi.encodeCall(distributor.setRootServiceFee, (address(quote), uint128(7 ether)));
        _expectTargetUnauthorized(
            GOVERNANCE_SAFE, TreasuryDistributorV1.setRootServiceFee.selector, feeUpdate, address(distributor)
        );

        uint48 cancelledReadyAt = uint48(block.timestamp + PROTOCOL_ADMIN_DELAY);
        vm.prank(GOVERNANCE_SAFE);
        manager.schedule(address(distributor), feeUpdate, cancelledReadyAt);
        vm.prank(GUARDIAN_SAFE);
        manager.cancel(GOVERNANCE_SAFE, address(distributor), feeUpdate);
        vm.warp(cancelledReadyAt);
        vm.prank(GOVERNANCE_SAFE);
        vm.expectRevert();
        manager.execute(address(distributor), feeUpdate);

        _scheduleAndExecute(GOVERNANCE_SAFE, feeUpdate, PROTOCOL_ADMIN_DELAY);
        assertEq(distributor.rootServiceFee().asset, address(quote));
        assertEq(distributor.rootServiceFee().amount, 7 ether);
    }

    function test_registerUsesExactTwoDayDelayWhileActivationRemainsPermissionless() public {
        bytes memory registration =
            abi.encodeCall(distributor.registerMarket, (MARKET_ID, address(meme), address(quote), ELIGIBILITY_POLICY));
        _expectTargetUnauthorized(
            GOVERNANCE_SAFE, TreasuryDistributorV1.registerMarket.selector, registration, address(distributor)
        );
        _scheduleAndExecute(GOVERNANCE_SAFE, registration, PROTOCOL_ADMIN_DELAY);

        (bool managerImmediate, uint32 managerDelay) =
            manager.canCall(KEEPER, address(distributor), TreasuryDistributorV1.activateMarket.selector);
        assertFalse(managerImmediate);
        assertEq(managerDelay, 0);

        vm.prank(KEEPER);
        distributor.activateMarket(MARKET_ID);
        assertEq(distributor.market(MARKET_ID).activatedAt, block.timestamp);
    }

    function test_publisherAndReviewerAreImmediateIndependentAndSelectorScoped() public {
        bytes memory publish = abi.encodeCall(
            distributor.publishRoot,
            (MARKET_ID, uint32(1), bytes32(uint256(1)), bytes32(uint256(2)), uint256(1), uint32(1), uint256(1))
        );
        bytes memory cancel = abi.encodeCall(distributor.cancelPendingRoot, (MARKET_ID, uint32(1), bytes32(uint256(3))));

        _expectTargetUnauthorized(
            ROOT_REVIEWER_SAFE, TreasuryDistributorV1.publishRoot.selector, publish, address(distributor)
        );
        _expectTargetUnauthorized(
            ROOT_PUBLISHER_SAFE, TreasuryDistributorV1.cancelPendingRoot.selector, cancel, address(distributor)
        );

        vm.prank(ROOT_PUBLISHER_SAFE);
        vm.expectRevert(
            abi.encodeWithSelector(
                TreasuryDistributorV1.InvalidEpochStatus.selector,
                TreasuryEpochStatusV1.UNREQUESTED,
                TreasuryEpochStatusV1.REQUESTED
            )
        );
        distributor.publishRoot(MARKET_ID, 1, bytes32(uint256(1)), bytes32(uint256(2)), 1, 1, 1);

        vm.prank(ROOT_REVIEWER_SAFE);
        vm.expectRevert(
            abi.encodeWithSelector(
                TreasuryDistributorV1.InvalidEpochStatus.selector,
                TreasuryEpochStatusV1.UNREQUESTED,
                TreasuryEpochStatusV1.ROOT_PENDING
            )
        );
        distributor.cancelPendingRoot(MARKET_ID, 1, bytes32(uint256(3)));
    }

    function test_renouncedBootstrapAdminCannotRewriteTreasuryPermissions() public {
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = TreasuryDistributorV1.publishRoot.selector;
        vm.expectRevert();
        manager.setTargetFunctionRole(address(distributor), selectors, PROTOCOL_ADMIN_ROLE);

        vm.prank(GOVERNANCE_SAFE);
        vm.expectRevert();
        manager.setTargetFunctionRole(address(distributor), selectors, PROTOCOL_ADMIN_ROLE);

        vm.prank(GOVERNANCE_SAFE);
        vm.expectRevert();
        manager.setRoleGuardian(ROOT_PUBLISHER_ROLE, PROTOCOL_ADMIN_ROLE);
    }

    function _configureAndFreezeAccessManager() private {
        manager.setRoleGuardian(PROTOCOL_ADMIN_ROLE, PAUSE_GUARDIAN_ROLE);
        manager.setRoleGuardian(ROOT_PUBLISHER_ROLE, PAUSE_GUARDIAN_ROLE);
        manager.setRoleGuardian(ROOT_REVIEW_ROLE, PAUSE_GUARDIAN_ROLE);

        bytes4[] memory adminSelectors = new bytes4[](2);
        adminSelectors[0] = TreasuryDistributorV1.registerMarket.selector;
        adminSelectors[1] = TreasuryDistributorV1.setRootServiceFee.selector;
        manager.setTargetFunctionRole(address(distributor), adminSelectors, PROTOCOL_ADMIN_ROLE);

        bytes4[] memory publisherSelectors = new bytes4[](1);
        publisherSelectors[0] = TreasuryDistributorV1.publishRoot.selector;
        manager.setTargetFunctionRole(address(distributor), publisherSelectors, ROOT_PUBLISHER_ROLE);

        bytes4[] memory reviewSelectors = new bytes4[](1);
        reviewSelectors[0] = TreasuryDistributorV1.cancelPendingRoot.selector;
        manager.setTargetFunctionRole(address(distributor), reviewSelectors, ROOT_REVIEW_ROLE);

        manager.grantRole(PROTOCOL_ADMIN_ROLE, GOVERNANCE_SAFE, PROTOCOL_ADMIN_DELAY);
        manager.grantRole(PAUSE_GUARDIAN_ROLE, GUARDIAN_SAFE, 0);
        manager.grantRole(ROOT_PUBLISHER_ROLE, ROOT_PUBLISHER_SAFE, 0);
        manager.grantRole(ROOT_REVIEW_ROLE, ROOT_REVIEWER_SAFE, 0);

        manager.setRoleAdmin(PROTOCOL_ADMIN_ROLE, PROTOCOL_ADMIN_ROLE);
        manager.setRoleAdmin(PAUSE_GUARDIAN_ROLE, PROTOCOL_ADMIN_ROLE);
        manager.setRoleAdmin(ROOT_PUBLISHER_ROLE, PROTOCOL_ADMIN_ROLE);
        manager.setRoleAdmin(ROOT_REVIEW_ROLE, PROTOCOL_ADMIN_ROLE);
        manager.renounceRole(manager.ADMIN_ROLE(), address(this));
    }

    function _scheduleAndExecute(address actor, bytes memory data, uint32 delay) private {
        uint48 readyAt = uint48(block.timestamp + delay);
        vm.prank(actor);
        manager.schedule(address(distributor), data, readyAt);

        vm.warp(readyAt - 1);
        vm.prank(actor);
        vm.expectRevert();
        manager.execute(address(distributor), data);

        vm.warp(readyAt);
        vm.prank(actor);
        manager.execute(address(distributor), data);
    }

    function _expectTargetUnauthorized(address actor, bytes4 functionSelector, bytes memory data, address target)
        private
    {
        vm.prank(actor);
        (bool success, bytes memory reason) = target.call(data);
        assertFalse(success);
        assertEq(
            reason,
            abi.encodeWithSelector(ImmutableAccessManaged.AccessManagedUnauthorized.selector, actor, functionSelector)
        );
    }

    function _assertRole(uint64 roleId, address member, uint32 delay) private view {
        (bool active, uint32 actualDelay) = manager.hasRole(roleId, member);
        assertTrue(active);
        assertEq(actualDelay, delay);
    }

    function _init(address authority) private view returns (TreasuryDistributorInitV1 memory) {
        return TreasuryDistributorInitV1({
            authority: authority,
            marketRegistry: address(marketRegistry),
            rootServiceTreasury: ROOT_SERVICE_TREASURY,
            rootServiceFeeAsset: address(0),
            rootServiceFeeAmount: 0.1 ether,
            finalityDelaySeconds: 1 hours,
            finalityDelayBlocks: 2,
            rootPublicationWindow: 3 days,
            rootReviewDelay: 2 days,
            claimWindow: 90 days
        });
    }
}
