// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Test} from "forge-std/Test.sol";

import {AssetView, IOfficialStockRegistryV1} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {OfficialStockRegistryV1} from "../../../src/v1/modules/OfficialStockRegistryV1.sol";
import {UserStockVaultIdentity} from "../../../src/v1/shared/UserStockVaultIdentity.sol";
import {MockExactQuoteToken} from "../mocks/MockV1QuoteAssets.sol";
import {StockTokenFingerprintTestLib} from "../mocks/StockTokenFingerprintTestLib.sol";

contract EmptyVaultDependency {}

contract AlternateSchemaStockVaultIdentity {
    address private immutable _registry;
    address private immutable _marketRegistry;
    address private immutable _allocationManager;

    constructor(address registry, address marketRegistry, address allocationManager) {
        _registry = registry;
        _marketRegistry = marketRegistry;
        _allocationManager = allocationManager;
    }

    function vaultIdentity()
        external
        view
        returns (address registry, address marketRegistry, address allocationManager, bytes32 schemaId)
    {
        return (
            _registry,
            _marketRegistry,
            _allocationManager,
            keccak256("TickerGarden.UserStockVault.AlternateSchema.test")
        );
    }
}

contract UserStockVaultIdentityHarness is UserStockVaultIdentity {
    constructor(address registry, address marketRegistry, address allocationManager)
        UserStockVaultIdentity(registry, marketRegistry, allocationManager)
    {}

    function identity()
        external
        view
        returns (address registry, address marketRegistry, address allocationManager, bytes32 schemaId)
    {
        return (address(_officialStockRegistry), address(_marketRegistry), _allocationManager, VAULT_SCHEMA_ID);
    }

    function canonicalAsset(bytes32 assetUid) external view returns (AssetView memory) {
        return _canonicalAsset(assetUid);
    }

    function activeCanonicalAsset(bytes32 assetUid) external view returns (AssetView memory) {
        return _activeCanonicalAsset(assetUid);
    }

    function allocationManagerProbe() external view onlyAllocationManager returns (bool) {
        return true;
    }

    function vaultIdentity()
        external
        view
        returns (address registry, address marketRegistry, address allocationManager, bytes32 schemaId)
    {
        return (address(_officialStockRegistry), address(_marketRegistry), _allocationManager, VAULT_SCHEMA_ID);
    }
}

contract UserStockVaultIdentityTest is Test {
    bytes32 internal constant ASSET_UID = keccak256("official-stock");
    bytes32 internal constant OTHER_ASSET_UID = keccak256("other-official-stock");
    uint64 internal constant PROTOCOL_ADMIN_ROLE = 1;

    AccessManager internal accessManager;
    OfficialStockRegistryV1 internal registry;
    MockExactQuoteToken internal stockToken;
    MockExactQuoteToken internal otherToken;
    EmptyVaultDependency internal allocationManager;
    EmptyVaultDependency internal marketRegistry;
    UserStockVaultIdentityHarness internal vault;

    function setUp() public {
        accessManager = new AccessManager(address(this));
        registry = new OfficialStockRegistryV1(address(accessManager));
        stockToken = new MockExactQuoteToken(18);
        marketRegistry = new EmptyVaultDependency();
        allocationManager = new EmptyVaultDependency();
        otherToken = new MockExactQuoteToken(6);
        vault =
            new UserStockVaultIdentityHarness(address(registry), address(marketRegistry), address(allocationManager));

        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = IOfficialStockRegistryV1.registerAsset.selector;
        accessManager.setTargetFunctionRole(address(registry), selectors, PROTOCOL_ADMIN_ROLE);
        accessManager.grantRole(PROTOCOL_ADMIN_ROLE, address(this), 0);
    }

    function test_constructorFreezesIdentityBeforeRegistryRegistrationWithoutInitializer() public {
        (address actualRegistry, address actualMarketRegistry, address actualManager, bytes32 actualSchemaId) =
            vault.identity();
        assertEq(actualRegistry, address(registry));
        assertEq(actualMarketRegistry, address(marketRegistry));
        assertEq(actualManager, address(allocationManager));
        assertEq(actualSchemaId, keccak256("TickerGarden.UserStockVault.MultiAsset.v5"));

        (bool initialized,) = address(vault)
            .call(abi.encodeWithSignature("initialize(address,address,address)", address(1), address(2), address(3)));
        assertFalse(initialized);
    }

    function test_constructorRejectsZeroNoCodeAndAliasedDependencies() public {
        _expectInvalid(address(0), address(marketRegistry), address(allocationManager));
        _expectInvalid(address(registry), address(0), address(allocationManager));
        _expectInvalid(address(registry), address(marketRegistry), address(0));
        _expectInvalid(address(registry), address(registry), address(allocationManager));
        _expectInvalid(address(registry), address(marketRegistry), address(marketRegistry));
        _expectInvalid(address(registry), address(marketRegistry), address(registry));
    }

    function test_unregisteredAndMismatchedRegistryBindingsFailClosed() public {
        vm.expectRevert();
        vault.canonicalAsset(ASSET_UID);

        stockToken.setUid(ASSET_UID);
        registry.registerAsset(
            ASSET_UID,
            address(stockToken),
            18,
            address(vault),
            0.5 ether,
            StockTokenFingerprintTestLib.direct(address(stockToken))
        );
        AlternateSchemaStockVaultIdentity otherVault = new AlternateSchemaStockVaultIdentity(
            address(registry), address(marketRegistry), address(allocationManager)
        );
        otherToken.setUid(OTHER_ASSET_UID);
        registry.registerAsset(
            OTHER_ASSET_UID,
            address(otherToken),
            6,
            address(otherVault),
            500_000,
            StockTokenFingerprintTestLib.direct(address(otherToken))
        );
        vm.expectRevert();
        vault.canonicalAsset(OTHER_ASSET_UID);
    }

    function test_exactRegistryBindingActivatesOnlyTheCanonicalVaultAndToken() public {
        stockToken.setUid(ASSET_UID);
        registry.registerAsset(
            ASSET_UID,
            address(stockToken),
            18,
            address(vault),
            0.5 ether,
            StockTokenFingerprintTestLib.direct(address(stockToken))
        );
        AssetView memory assetView = vault.activeCanonicalAsset(ASSET_UID);
        assertEq(assetView.stockToken, address(stockToken));
        assertEq(assetView.userStockVault, address(vault));
        assertEq(assetView.tokenDecimals, 18);
        assertEq(assetView.status, 1);

        MockExactQuoteToken secondToken = new MockExactQuoteToken(6);
        secondToken.setUid(OTHER_ASSET_UID);
        registry.registerAsset(
            OTHER_ASSET_UID,
            address(secondToken),
            6,
            address(vault),
            500_000,
            StockTokenFingerprintTestLib.direct(address(secondToken))
        );
        assertEq(vault.activeCanonicalAsset(OTHER_ASSET_UID).stockToken, address(secondToken));
        assertEq(vault.activeCanonicalAsset(ASSET_UID).stockToken, address(stockToken));
    }

    function test_assetStatusGatesNewActivityButPreservesCanonicalIdentity() public {
        stockToken.setUid(ASSET_UID);
        registry.registerAsset(
            ASSET_UID,
            address(stockToken),
            18,
            address(vault),
            0.5 ether,
            StockTokenFingerprintTestLib.direct(address(stockToken))
        );
        bytes4[] memory selector = new bytes4[](1);
        selector[0] = IOfficialStockRegistryV1.pauseAsset.selector;
        accessManager.setTargetFunctionRole(address(registry), selector, PROTOCOL_ADMIN_ROLE);
        registry.pauseAsset(ASSET_UID, keccak256("pause"));

        AssetView memory canonical = vault.canonicalAsset(ASSET_UID);
        assertEq(canonical.status, 2);
        vm.expectRevert(abi.encodeWithSelector(UserStockVaultIdentity.AssetNotActive.selector, ASSET_UID, uint8(2)));
        vault.activeCanonicalAsset(ASSET_UID);
    }

    function test_runtimeIdentityDriftBlocksNewActivityButPreservesCanonicalExitIdentity() public {
        stockToken.setUid(ASSET_UID);
        registry.registerAsset(
            ASSET_UID,
            address(stockToken),
            18,
            address(vault),
            0.5 ether,
            StockTokenFingerprintTestLib.direct(address(stockToken))
        );
        stockToken.setUid(OTHER_ASSET_UID);

        AssetView memory canonical = vault.canonicalAsset(ASSET_UID);
        assertEq(canonical.stockToken, address(stockToken));
        assertEq(canonical.status, 1);
        vm.expectRevert(abi.encodeWithSelector(UserStockVaultIdentity.AssetIdentityDrift.selector, ASSET_UID));
        vault.activeCanonicalAsset(ASSET_UID);
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

    function _expectInvalid(address registry_, address marketRegistry_, address manager_) private {
        vm.expectRevert(
            abi.encodeWithSelector(
                UserStockVaultIdentity.InvalidVaultIdentity.selector, registry_, marketRegistry_, manager_
            )
        );
        new UserStockVaultIdentityHarness(registry_, marketRegistry_, manager_);
    }
}
