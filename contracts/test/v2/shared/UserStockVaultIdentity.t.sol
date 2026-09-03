// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Test} from "forge-std/Test.sol";

import {AssetView, IOfficialStockRegistryV2} from "../../../src/v2/interfaces/IV2Protocol.sol";
import {OfficialStockRegistryV2} from "../../../src/v2/modules/OfficialStockRegistryV2.sol";
import {UserStockVaultIdentity} from "../../../src/v2/shared/UserStockVaultIdentity.sol";
import {MockExactQuoteToken} from "../mocks/MockV2QuoteAssets.sol";

contract EmptyVaultDependency {}

contract UserStockVaultIdentityHarness is UserStockVaultIdentity {
    constructor(
        address registry,
        address marketRegistry,
        address allocationManager,
        bytes32 assetUid,
        address stockToken
    ) UserStockVaultIdentity(registry, marketRegistry, allocationManager, assetUid, stockToken) {}

    function identity()
        external
        view
        returns (
            address registry,
            address marketRegistry,
            address allocationManager,
            bytes32 assetUid,
            address stockToken
        )
    {
        return (
            address(_officialStockRegistry),
            address(_marketRegistry),
            _allocationManager,
            _assetUid,
            address(_stockToken)
        );
    }

    function canonicalAsset() external view returns (AssetView memory) {
        return _canonicalAsset();
    }

    function activeCanonicalAsset() external view returns (AssetView memory) {
        return _activeCanonicalAsset();
    }

    function allocationManagerProbe() external view onlyAllocationManager returns (bool) {
        return true;
    }
}

contract UserStockVaultIdentityTest is Test {
    bytes32 internal constant ASSET_UID = keccak256("official-stock");
    bytes32 internal constant OTHER_ASSET_UID = keccak256("other-official-stock");
    uint64 internal constant PROTOCOL_ADMIN_ROLE = 1;

    AccessManager internal accessManager;
    OfficialStockRegistryV2 internal registry;
    MockExactQuoteToken internal stockToken;
    EmptyVaultDependency internal allocationManager;
    EmptyVaultDependency internal marketRegistry;
    UserStockVaultIdentityHarness internal vault;

    function setUp() public {
        accessManager = new AccessManager(address(this));
        registry = new OfficialStockRegistryV2(address(accessManager));
        stockToken = new MockExactQuoteToken(18);
        marketRegistry = new EmptyVaultDependency();
        allocationManager = new EmptyVaultDependency();
        vault = new UserStockVaultIdentityHarness(
            address(registry), address(marketRegistry), address(allocationManager), ASSET_UID, address(stockToken)
        );

        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = IOfficialStockRegistryV2.registerAsset.selector;
        accessManager.setTargetFunctionRole(address(registry), selectors, PROTOCOL_ADMIN_ROLE);
        accessManager.grantRole(PROTOCOL_ADMIN_ROLE, address(this), 0);
    }

    function test_constructorFreezesIdentityBeforeRegistryRegistrationWithoutInitializer() public {
        (
            address actualRegistry,
            address actualMarketRegistry,
            address actualManager,
            bytes32 actualUid,
            address actualToken
        ) = vault.identity();
        assertEq(actualRegistry, address(registry));
        assertEq(actualMarketRegistry, address(marketRegistry));
        assertEq(actualManager, address(allocationManager));
        assertEq(actualUid, ASSET_UID);
        assertEq(actualToken, address(stockToken));

        (bool initialized,) = address(vault)
            .call(
                abi.encodeWithSignature(
                    "initialize(address,address,address,bytes32,address)",
                    address(1),
                    address(2),
                    address(3),
                    bytes32(0),
                    address(4)
                )
            );
        assertFalse(initialized);
    }

    function test_constructorRejectsZeroNoCodeAndAliasedDependencies() public {
        _expectInvalid(address(0), address(marketRegistry), address(allocationManager), ASSET_UID, address(stockToken));
        _expectInvalid(address(registry), address(0), address(allocationManager), ASSET_UID, address(stockToken));
        _expectInvalid(address(registry), address(marketRegistry), address(0), ASSET_UID, address(stockToken));
        _expectInvalid(
            address(registry), address(marketRegistry), address(allocationManager), bytes32(0), address(stockToken)
        );
        _expectInvalid(address(registry), address(marketRegistry), address(allocationManager), ASSET_UID, address(0));
        _expectInvalid(
            address(0x1111), address(marketRegistry), address(allocationManager), ASSET_UID, address(stockToken)
        );
        _expectInvalid(address(registry), address(0x2222), address(allocationManager), ASSET_UID, address(stockToken));
        _expectInvalid(address(registry), address(marketRegistry), address(0x3333), ASSET_UID, address(stockToken));
        _expectInvalid(
            address(registry), address(marketRegistry), address(allocationManager), ASSET_UID, address(0x4444)
        );
        _expectInvalid(address(registry), address(registry), address(allocationManager), ASSET_UID, address(stockToken));
        _expectInvalid(
            address(registry), address(marketRegistry), address(marketRegistry), ASSET_UID, address(stockToken)
        );
        _expectInvalid(address(registry), address(marketRegistry), address(stockToken), ASSET_UID, address(stockToken));
    }

    function test_unregisteredAndMismatchedRegistryBindingsFailClosed() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                UserStockVaultIdentity.NonCanonicalVaultBinding.selector,
                ASSET_UID,
                address(stockToken),
                address(0),
                address(vault),
                address(0)
            )
        );
        vault.canonicalAsset();

        EmptyVaultDependency otherVault = new EmptyVaultDependency();
        registry.registerAsset(ASSET_UID, address(stockToken), 18, address(otherVault));
        vm.expectRevert(
            abi.encodeWithSelector(
                UserStockVaultIdentity.NonCanonicalVaultBinding.selector,
                ASSET_UID,
                address(stockToken),
                address(stockToken),
                address(vault),
                address(otherVault)
            )
        );
        vault.canonicalAsset();
    }

    function test_exactRegistryBindingActivatesOnlyTheCanonicalVaultAndToken() public {
        registry.registerAsset(ASSET_UID, address(stockToken), 18, address(vault));
        AssetView memory assetView = vault.activeCanonicalAsset();
        assertEq(assetView.stockToken, address(stockToken));
        assertEq(assetView.userStockVault, address(vault));
        assertEq(assetView.tokenDecimals, 18);
        assertEq(assetView.status, 1);

        MockExactQuoteToken otherToken = new MockExactQuoteToken(6);
        UserStockVaultIdentityHarness otherVault = new UserStockVaultIdentityHarness(
            address(registry), address(marketRegistry), address(allocationManager), OTHER_ASSET_UID, address(otherToken)
        );
        registry.registerAsset(OTHER_ASSET_UID, address(otherToken), 6, address(otherVault));
        assertEq(otherVault.activeCanonicalAsset().stockToken, address(otherToken));
        assertEq(vault.activeCanonicalAsset().stockToken, address(stockToken));
    }

    function test_assetStatusGatesNewActivityButPreservesCanonicalIdentity() public {
        registry.registerAsset(ASSET_UID, address(stockToken), 18, address(vault));
        bytes4[] memory selector = new bytes4[](1);
        selector[0] = IOfficialStockRegistryV2.pauseAsset.selector;
        accessManager.setTargetFunctionRole(address(registry), selector, PROTOCOL_ADMIN_ROLE);
        registry.pauseAsset(ASSET_UID, keccak256("pause"));

        AssetView memory canonical = vault.canonicalAsset();
        assertEq(canonical.status, 2);
        vm.expectRevert(abi.encodeWithSelector(UserStockVaultIdentity.AssetNotActive.selector, ASSET_UID, uint8(2)));
        vault.activeCanonicalAsset();
    }

    function test_onlyImmutableAllocationManagerCanEnterAllocationBoundary() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                UserStockVaultIdentity.UnauthorizedAllocationManager.selector, address(this), address(allocationManager)
            )
        );
        vault.allocationManagerProbe();

        vm.prank(address(allocationManager));
        assertTrue(vault.allocationManagerProbe());
    }

    function test_identityLayerCreatesNoStockAllowanceOrPrincipalCustodyInOtherModules() public view {
        assertEq(IERC20(address(stockToken)).allowance(address(vault), address(allocationManager)), 0);
        assertEq(stockToken.balanceOf(address(allocationManager)), 0);
        assertEq(stockToken.balanceOf(address(vault)), 0);
    }

    function _expectInvalid(address registry_, address marketRegistry_, address manager_, bytes32 uid_, address token_)
        private
    {
        vm.expectRevert(
            abi.encodeWithSelector(
                UserStockVaultIdentity.InvalidVaultIdentity.selector, registry_, marketRegistry_, manager_, uid_, token_
            )
        );
        new UserStockVaultIdentityHarness(registry_, marketRegistry_, manager_, uid_, token_);
    }
}
