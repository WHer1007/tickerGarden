// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";

import {AssetView, IOfficialStockRegistryV2} from "../../../src/v2/interfaces/IV2Protocol.sol";
import {OfficialStockRegistryV2} from "../../../src/v2/modules/OfficialStockRegistryV2.sol";
import {ImmutableAccessManaged} from "../../../src/v2/shared/ImmutableAccessManaged.sol";

contract EmptyV2Contract {}

contract MockUserStockVaultIdentity {
    address internal immutable _registry;
    address internal immutable _marketRegistry;
    address internal immutable _allocationManager;
    bytes32 internal immutable _schemaId;

    constructor(address registry_, address marketRegistry_, address allocationManager_, bytes32 schemaId_) {
        _registry = registry_;
        _marketRegistry = marketRegistry_;
        _allocationManager = allocationManager_;
        _schemaId = schemaId_;
    }

    function vaultIdentity() external view returns (address, address, address, bytes32) {
        return (_registry, _marketRegistry, _allocationManager, _schemaId);
    }
}

contract OfficialStockRegistryV2Test is Test {
    uint64 internal constant PROTOCOL_ADMIN_ROLE = 1;
    uint64 internal constant PAUSE_GUARDIAN_ROLE = 2;
    uint64 internal constant UNPAUSE_ROLE = 3;
    uint32 internal constant ADMIN_DELAY = 2 days;
    uint32 internal constant UNPAUSE_DELAY = 1 days;

    bytes32 internal constant ASSET_UID = keccak256("official-stock");
    bytes32 internal constant OTHER_ASSET_UID = keccak256("other-official-stock");
    bytes32 internal constant REASON_HASH = keccak256("identity-drift");
    bytes32 internal constant VAULT_SCHEMA_ID = keccak256("TickerGarden.UserStockVault.MultiAsset.v1");
    address internal constant DELAYED_ADMIN = address(0xA11CE);
    address internal constant FAST_ADMIN = address(0xFA57);
    address internal constant GUARDIAN = address(0x6A7D);
    address internal constant UNPAUSER = address(0xBEEF);

    AccessManager internal manager;
    OfficialStockRegistryV2 internal registry;
    address internal stockToken;
    address internal vault;
    address internal marketRegistry;
    address internal allocationManager;

    event StockVaultRegistered(
        address indexed userStockVault,
        bytes32 indexed schemaId,
        address indexed marketRegistry,
        address allocationManager
    );
    event AssetRegistered(
        bytes32 indexed assetUid, address indexed stockToken, address indexed userStockVault, uint8 tokenDecimals
    );
    event AssetStatusChanged(bytes32 indexed assetUid, uint8 oldStatus, uint8 newStatus, bytes32 reasonHash);

    function setUp() public {
        vm.warp(1_000_000);
        manager = new AccessManager(address(this));
        registry = new OfficialStockRegistryV2(address(manager));
        stockToken = address(new EmptyV2Contract());
        marketRegistry = address(new EmptyV2Contract());
        allocationManager = address(new EmptyV2Contract());
        vault = address(
            new MockUserStockVaultIdentity(address(registry), marketRegistry, allocationManager, VAULT_SCHEMA_ID)
        );

        bytes4[] memory adminSelectors = new bytes4[](2);
        adminSelectors[0] = IOfficialStockRegistryV2.registerAsset.selector;
        adminSelectors[1] = IOfficialStockRegistryV2.retireAsset.selector;
        manager.setTargetFunctionRole(address(registry), adminSelectors, PROTOCOL_ADMIN_ROLE);

        bytes4[] memory pauseSelectors = new bytes4[](1);
        pauseSelectors[0] = IOfficialStockRegistryV2.pauseAsset.selector;
        manager.setTargetFunctionRole(address(registry), pauseSelectors, PAUSE_GUARDIAN_ROLE);

        bytes4[] memory unpauseSelectors = new bytes4[](1);
        unpauseSelectors[0] = IOfficialStockRegistryV2.unpauseAsset.selector;
        manager.setTargetFunctionRole(address(registry), unpauseSelectors, UNPAUSE_ROLE);

        manager.grantRole(PROTOCOL_ADMIN_ROLE, DELAYED_ADMIN, ADMIN_DELAY);
        manager.grantRole(PROTOCOL_ADMIN_ROLE, FAST_ADMIN, 0);
        manager.grantRole(PAUSE_GUARDIAN_ROLE, GUARDIAN, 0);
        manager.grantRole(UNPAUSE_ROLE, UNPAUSER, UNPAUSE_DELAY);
    }

    function test_constructorRequiresDeployedAuthority() public {
        vm.expectRevert(abi.encodeWithSelector(ImmutableAccessManaged.InvalidAuthority.selector, address(0)));
        new OfficialStockRegistryV2(address(0));

        address noCode = address(0x1234);
        vm.expectRevert(abi.encodeWithSelector(ImmutableAccessManaged.InvalidAuthority.selector, noCode));
        new OfficialStockRegistryV2(noCode);
    }

    function test_selectorsMatchCanonicalInterface() public pure {
        assertEq(OfficialStockRegistryV2.registerAsset.selector, IOfficialStockRegistryV2.registerAsset.selector);
        assertEq(OfficialStockRegistryV2.pauseAsset.selector, IOfficialStockRegistryV2.pauseAsset.selector);
        assertEq(OfficialStockRegistryV2.unpauseAsset.selector, IOfficialStockRegistryV2.unpauseAsset.selector);
        assertEq(OfficialStockRegistryV2.retireAsset.selector, IOfficialStockRegistryV2.retireAsset.selector);
        assertEq(OfficialStockRegistryV2.asset.selector, IOfficialStockRegistryV2.asset.selector);
        assertEq(OfficialStockRegistryV2.vaultSchemaId.selector, IOfficialStockRegistryV2.vaultSchemaId.selector);
        assertEq(OfficialStockRegistryV2.vaultForSchema.selector, IOfficialStockRegistryV2.vaultForSchema.selector);
    }

    function test_unknownAssetIsUnset() public view {
        AssetView memory value = registry.asset(ASSET_UID);
        assertEq(value.stockToken, address(0));
        assertEq(value.userStockVault, address(0));
        assertEq(value.tokenDecimals, 0);
        assertEq(value.status, 0);
    }

    function test_allMutationsRequireTheirConfiguredSelectorRole() public {
        _expectUnauthorized(IOfficialStockRegistryV2.registerAsset.selector);
        registry.registerAsset(ASSET_UID, stockToken, 18, vault);
        _expectUnauthorized(IOfficialStockRegistryV2.pauseAsset.selector);
        registry.pauseAsset(ASSET_UID, REASON_HASH);
        _expectUnauthorized(IOfficialStockRegistryV2.unpauseAsset.selector);
        registry.unpauseAsset(ASSET_UID);
        _expectUnauthorized(IOfficialStockRegistryV2.retireAsset.selector);
        registry.retireAsset(ASSET_UID, REASON_HASH);
    }

    function test_registerUsesExactTwoDayAccessManagerDelay() public {
        bytes memory data = abi.encodeCall(IOfficialStockRegistryV2.registerAsset, (ASSET_UID, stockToken, 18, vault));

        vm.prank(DELAYED_ADMIN);
        vm.expectRevert(
            abi.encodeWithSelector(
                ImmutableAccessManaged.AccessManagedUnauthorized.selector,
                DELAYED_ADMIN,
                IOfficialStockRegistryV2.registerAsset.selector
            )
        );
        registry.registerAsset(ASSET_UID, stockToken, 18, vault);

        uint48 readyAt = uint48(block.timestamp + ADMIN_DELAY);
        vm.prank(DELAYED_ADMIN);
        manager.schedule(address(registry), data, readyAt);
        vm.warp(readyAt - 1);
        vm.prank(DELAYED_ADMIN);
        vm.expectRevert();
        manager.execute(address(registry), data);

        vm.warp(readyAt);
        vm.expectEmit(true, true, true, true, address(registry));
        emit StockVaultRegistered(vault, VAULT_SCHEMA_ID, marketRegistry, allocationManager);
        vm.expectEmit(true, true, true, true, address(registry));
        emit AssetRegistered(ASSET_UID, stockToken, vault, 18);
        vm.prank(DELAYED_ADMIN);
        manager.execute(address(registry), data);
        _assertAsset(ASSET_UID, stockToken, vault, 18, 1);
    }

    function test_registerStoresImmutableCanonicalIdentityAndEvent() public {
        vm.expectEmit(true, true, true, true);
        emit StockVaultRegistered(vault, VAULT_SCHEMA_ID, marketRegistry, allocationManager);
        vm.expectEmit(true, true, true, true);
        emit AssetRegistered(ASSET_UID, stockToken, vault, 18);
        _registerFast(ASSET_UID, stockToken, 18, vault);
        _assertAsset(ASSET_UID, stockToken, vault, 18, 1);
        assertEq(registry.vaultSchemaId(vault), VAULT_SCHEMA_ID);
        assertEq(registry.vaultForSchema(VAULT_SCHEMA_ID), vault);
    }

    function test_registerRejectsInvalidIdentityAndDecimalBounds() public {
        _expectInvalidIdentity(bytes32(0), stockToken, 18, vault);
        _expectInvalidIdentity(ASSET_UID, address(0), 18, vault);
        _expectInvalidIdentity(ASSET_UID, stockToken, 18, address(0));
        _expectInvalidIdentity(ASSET_UID, stockToken, 18, stockToken);
        _expectInvalidIdentity(ASSET_UID, address(0x1111), 18, vault);
        _expectInvalidIdentity(ASSET_UID, stockToken, 18, address(0x2222));
        _expectInvalidIdentity(ASSET_UID, stockToken, 0, vault);
        _expectInvalidIdentity(ASSET_UID, stockToken, 5, vault);
        _expectInvalidIdentity(ASSET_UID, stockToken, 19, vault);
        _expectInvalidIdentity(ASSET_UID, stockToken, 37, vault);

        _registerFast(ASSET_UID, stockToken, 6, vault);
        assertEq(registry.asset(ASSET_UID).tokenDecimals, 6);
        address highDecimalsToken = address(new EmptyV2Contract());
        _registerFast(OTHER_ASSET_UID, highDecimalsToken, 18, vault);
        assertEq(registry.asset(OTHER_ASSET_UID).tokenDecimals, 18);
    }

    function test_assetUidAndStockTokenAreWriteOnceButVaultCanServeMultipleAssets() public {
        _registerFast(ASSET_UID, stockToken, 18, vault);

        address otherToken = address(new EmptyV2Contract());
        address otherVault = address(
            new MockUserStockVaultIdentity(
                address(registry), marketRegistry, allocationManager, keccak256("other-schema")
            )
        );
        vm.expectRevert(abi.encodeWithSelector(OfficialStockRegistryV2.AssetAlreadyRegistered.selector, ASSET_UID));
        vm.prank(FAST_ADMIN);
        registry.registerAsset(ASSET_UID, otherToken, 18, otherVault);

        vm.expectRevert(
            abi.encodeWithSelector(OfficialStockRegistryV2.StockTokenAlreadyRegistered.selector, stockToken, ASSET_UID)
        );
        vm.prank(FAST_ADMIN);
        registry.registerAsset(OTHER_ASSET_UID, stockToken, 18, otherVault);

        _registerFast(OTHER_ASSET_UID, otherToken, 18, vault);

        _assertAsset(ASSET_UID, stockToken, vault, 18, 1);
        _assertAsset(OTHER_ASSET_UID, otherToken, vault, 18, 1);
        assertEq(registry.vaultSchemaId(vault), VAULT_SCHEMA_ID);
        assertEq(registry.vaultForSchema(VAULT_SCHEMA_ID), vault);
        assertEq(registry.vaultSchemaId(otherVault), bytes32(0));
    }

    function test_eachVaultSchemaCanResolveToOnlyOneCanonicalVault() public {
        _registerFast(ASSET_UID, stockToken, 18, vault);

        address otherToken = address(new EmptyV2Contract());
        address duplicateSchemaVault = address(
            new MockUserStockVaultIdentity(address(registry), marketRegistry, allocationManager, VAULT_SCHEMA_ID)
        );
        vm.expectRevert(
            abi.encodeWithSelector(
                OfficialStockRegistryV2.VaultSchemaAlreadyRegistered.selector,
                VAULT_SCHEMA_ID,
                vault,
                duplicateSchemaVault
            )
        );
        vm.prank(FAST_ADMIN);
        registry.registerAsset(OTHER_ASSET_UID, otherToken, 18, duplicateSchemaVault);

        assertEq(registry.vaultForSchema(VAULT_SCHEMA_ID), vault);
        assertEq(registry.vaultSchemaId(duplicateSchemaVault), bytes32(0));
        assertEq(registry.asset(OTHER_ASSET_UID).status, 0);
    }

    function test_registerRejectsVaultWithMissingOrWrongIdentity() public {
        address emptyVault = address(new EmptyV2Contract());
        vm.expectRevert(
            abi.encodeWithSelector(
                OfficialStockRegistryV2.InvalidUserStockVaultIdentity.selector,
                emptyVault,
                address(0),
                address(0),
                address(0),
                bytes32(0)
            )
        );
        vm.prank(FAST_ADMIN);
        registry.registerAsset(ASSET_UID, stockToken, 18, emptyVault);

        address wrongRegistryVault =
            address(new MockUserStockVaultIdentity(address(0xBAD), marketRegistry, allocationManager, VAULT_SCHEMA_ID));
        vm.expectRevert(
            abi.encodeWithSelector(
                OfficialStockRegistryV2.InvalidUserStockVaultIdentity.selector,
                wrongRegistryVault,
                address(0xBAD),
                marketRegistry,
                allocationManager,
                VAULT_SCHEMA_ID
            )
        );
        vm.prank(FAST_ADMIN);
        registry.registerAsset(ASSET_UID, stockToken, 18, wrongRegistryVault);
    }

    function test_pauseIsImmediateAndPreservesIdentity() public {
        _registerFast(ASSET_UID, stockToken, 18, vault);
        vm.expectEmit(true, false, false, true);
        emit AssetStatusChanged(ASSET_UID, 1, 2, REASON_HASH);
        vm.prank(GUARDIAN);
        registry.pauseAsset(ASSET_UID, REASON_HASH);
        _assertAsset(ASSET_UID, stockToken, vault, 18, 2);
    }

    function test_pauseRejectsUnsetAndRepeatedTransitions() public {
        vm.expectRevert(abi.encodeWithSelector(OfficialStockRegistryV2.InvalidStateTransition.selector, 0, 2));
        vm.prank(GUARDIAN);
        registry.pauseAsset(ASSET_UID, REASON_HASH);

        _registerFast(ASSET_UID, stockToken, 18, vault);
        vm.prank(GUARDIAN);
        registry.pauseAsset(ASSET_UID, REASON_HASH);
        vm.expectRevert(abi.encodeWithSelector(OfficialStockRegistryV2.InvalidStateTransition.selector, 2, 2));
        vm.prank(GUARDIAN);
        registry.pauseAsset(ASSET_UID, REASON_HASH);
    }

    function test_unpauseUsesExactOneDayDelayAndPreservesIdentity() public {
        _registerFast(ASSET_UID, stockToken, 18, vault);
        vm.prank(GUARDIAN);
        registry.pauseAsset(ASSET_UID, REASON_HASH);

        bytes memory data = abi.encodeCall(IOfficialStockRegistryV2.unpauseAsset, (ASSET_UID));
        uint48 readyAt = uint48(block.timestamp + UNPAUSE_DELAY);
        vm.prank(UNPAUSER);
        manager.schedule(address(registry), data, readyAt);
        vm.warp(readyAt - 1);
        vm.prank(UNPAUSER);
        vm.expectRevert();
        manager.execute(address(registry), data);

        vm.warp(readyAt);
        vm.expectEmit(true, false, false, true, address(registry));
        emit AssetStatusChanged(ASSET_UID, 2, 1, bytes32(0));
        vm.prank(UNPAUSER);
        manager.execute(address(registry), data);
        _assertAsset(ASSET_UID, stockToken, vault, 18, 1);
    }

    function test_retireFromActiveUsesTwoDayDelayAndIsTerminal() public {
        _registerFast(ASSET_UID, stockToken, 18, vault);
        bytes memory data = abi.encodeCall(IOfficialStockRegistryV2.retireAsset, (ASSET_UID, REASON_HASH));
        uint48 readyAt = uint48(block.timestamp + ADMIN_DELAY);
        vm.prank(DELAYED_ADMIN);
        manager.schedule(address(registry), data, readyAt);
        vm.warp(readyAt);

        vm.expectEmit(true, false, false, true, address(registry));
        emit AssetStatusChanged(ASSET_UID, 1, 3, REASON_HASH);
        vm.prank(DELAYED_ADMIN);
        manager.execute(address(registry), data);
        _assertAsset(ASSET_UID, stockToken, vault, 18, 3);

        vm.expectRevert(abi.encodeWithSelector(OfficialStockRegistryV2.InvalidStateTransition.selector, 3, 2));
        vm.prank(GUARDIAN);
        registry.pauseAsset(ASSET_UID, REASON_HASH);
        vm.expectRevert(abi.encodeWithSelector(OfficialStockRegistryV2.InvalidStateTransition.selector, 3, 3));
        vm.prank(FAST_ADMIN);
        registry.retireAsset(ASSET_UID, REASON_HASH);
    }

    function test_retireFromPausedPreservesIdentityAndCannotUnpause() public {
        _registerFast(ASSET_UID, stockToken, 18, vault);
        vm.prank(GUARDIAN);
        registry.pauseAsset(ASSET_UID, REASON_HASH);

        vm.expectEmit(true, false, false, true);
        emit AssetStatusChanged(ASSET_UID, 2, 3, REASON_HASH);
        vm.prank(FAST_ADMIN);
        registry.retireAsset(ASSET_UID, REASON_HASH);
        _assertAsset(ASSET_UID, stockToken, vault, 18, 3);

        bytes memory data = abi.encodeCall(IOfficialStockRegistryV2.unpauseAsset, (ASSET_UID));
        uint48 readyAt = uint48(block.timestamp + UNPAUSE_DELAY);
        vm.prank(UNPAUSER);
        manager.schedule(address(registry), data, readyAt);
        vm.warp(readyAt);
        vm.expectRevert(abi.encodeWithSelector(OfficialStockRegistryV2.InvalidStateTransition.selector, 3, 1));
        vm.prank(UNPAUSER);
        manager.execute(address(registry), data);
    }

    function test_registryHasNoHardcoded194AssetLimit() public {
        for (uint256 i; i < 195; ++i) {
            bytes32 uid = bytes32(i + 1);
            address token = address(uint160(10_000 + i));
            vm.etch(token, hex"00");
            _registerFast(uid, token, 18, vault);
        }
        assertEq(registry.asset(bytes32(uint256(195))).status, 1);
    }

    function _expectUnauthorized(bytes4 selector) private {
        vm.expectRevert(
            abi.encodeWithSelector(ImmutableAccessManaged.AccessManagedUnauthorized.selector, address(this), selector)
        );
    }

    function _expectInvalidIdentity(bytes32 uid, address token, uint8 decimals, address assetVault) private {
        vm.expectRevert(
            abi.encodeWithSelector(
                OfficialStockRegistryV2.InvalidAssetIdentity.selector, uid, token, decimals, assetVault
            )
        );
        vm.prank(FAST_ADMIN);
        registry.registerAsset(uid, token, decimals, assetVault);
    }

    function _registerFast(bytes32 uid, address token, uint8 decimals, address assetVault) private {
        vm.prank(FAST_ADMIN);
        registry.registerAsset(uid, token, decimals, assetVault);
    }

    function _assertAsset(bytes32 uid, address token, address assetVault, uint8 decimals, uint8 status) private view {
        AssetView memory value = registry.asset(uid);
        assertEq(value.stockToken, token);
        assertEq(value.userStockVault, assetVault);
        assertEq(value.tokenDecimals, decimals);
        assertEq(value.status, status);
    }
}
