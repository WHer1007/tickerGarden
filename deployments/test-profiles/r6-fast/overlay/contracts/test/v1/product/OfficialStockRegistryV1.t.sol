// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import {BeaconProxy} from "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import {UpgradeableBeacon} from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {AssetView, IOfficialStockRegistryV1, StockTokenFingerprint} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {OfficialStockRegistryV1} from "../../../src/v1/modules/OfficialStockRegistryV1.sol";
import {ImmutableAccessManaged} from "../../../src/v1/shared/ImmutableAccessManaged.sol";
import {StockTokenFingerprintTestLib} from "../mocks/StockTokenFingerprintTestLib.sol";

contract EmptyV1Contract {}

contract MockOfficialStockToken {
    bytes32 public uid;
    uint8 public decimals;

    constructor(bytes32 uid_, uint8 decimals_) {
        uid = uid_;
        decimals = decimals_;
    }

    function setUid(bytes32 uid_) external {
        uid = uid_;
    }

    function setDecimals(uint8 decimals_) external {
        decimals = decimals_;
    }
}

contract MockBeaconStockTokenLogic {
    bytes32 public uid;
    uint8 public decimals;

    function initialize(bytes32 uid_, uint8 decimals_) external {
        require(uid == bytes32(0), "ALREADY_INITIALIZED");
        uid = uid_;
        decimals = decimals_;
    }
}

contract MockBeaconStockTokenLogicV2 is MockBeaconStockTokenLogic {
    function version() external pure returns (uint256) {
        return 2;
    }
}

contract MockNestedDelegateStockTokenLogic is MockBeaconStockTokenLogic {
    function delegateInto(address target, bytes calldata data) external returns (bytes memory result) {
        (bool success, bytes memory returned) = target.delegatecall(data);
        require(success, "DELEGATE_FAILED");
        return returned;
    }
}

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

contract MockMutableUserStockVaultIdentity {
    address public registry;
    address public marketRegistry;
    address public allocationManager;
    bytes32 public schemaId;

    constructor(address registry_, address marketRegistry_, address allocationManager_, bytes32 schemaId_) {
        registry = registry_;
        marketRegistry = marketRegistry_;
        allocationManager = allocationManager_;
        schemaId = schemaId_;
    }

    function setBindings(address marketRegistry_, address allocationManager_) external {
        marketRegistry = marketRegistry_;
        allocationManager = allocationManager_;
    }

    function vaultIdentity() external view returns (address, address, address, bytes32) {
        return (registry, marketRegistry, allocationManager, schemaId);
    }
}

contract MockDelegatingUserStockVaultIdentity is MockUserStockVaultIdentity {
    constructor(address registry_, address marketRegistry_, address allocationManager_, bytes32 schemaId_)
        MockUserStockVaultIdentity(registry_, marketRegistry_, allocationManager_, schemaId_)
    {}

    function delegateInto(address target, bytes calldata data) external returns (bytes memory result) {
        (bool success, bytes memory returned) = target.delegatecall(data);
        require(success, "DELEGATE_FAILED");
        return returned;
    }
}

contract OfficialStockRegistryV1InspectionHarness is OfficialStockRegistryV1 {
    constructor(address authority_) OfficialStockRegistryV1(authority_) {}

    function containsForbiddenVaultOpcode(address target) external view returns (bool) {
        return _containsForbiddenVaultOpcode(target);
    }

    function containsDelegateExecution(address target) external view returns (bool) {
        return _containsDelegateExecution(target);
    }
}

contract OfficialStockRegistryV1Test is Test {
    uint64 internal constant PROTOCOL_ADMIN_ROLE = 1;
    uint64 internal constant PAUSE_GUARDIAN_ROLE = 2;
    uint64 internal constant UNPAUSE_ROLE = 3;
    uint32 internal constant ADMIN_DELAY = 2 days;
    uint32 internal constant UNPAUSE_DELAY = 20 minutes;

    bytes32 internal constant ASSET_UID = keccak256("official-stock");
    bytes32 internal constant OTHER_ASSET_UID = keccak256("other-official-stock");
    bytes32 internal constant REASON_HASH = keccak256("identity-drift");
    bytes32 internal constant VAULT_SCHEMA_ID = keccak256("TickerGarden.UserStockVault.MultiAsset.v4");
    address internal constant DELAYED_ADMIN = address(0xA11CE);
    address internal constant FAST_ADMIN = address(0xFA57);
    address internal constant GUARDIAN = address(0x6A7D);
    address internal constant UNPAUSER = address(0xBEEF);

    AccessManager internal manager;
    OfficialStockRegistryV1 internal registry;
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
    event StockVaultCodeIdentityPinned(address indexed userStockVault, bytes32 indexed runtimeCodeHash);
    event AssetRegistered(
        bytes32 indexed assetUid, address indexed stockToken, address indexed userStockVault, uint8 tokenDecimals
    );
    event StockTokenFingerprintRegistered(
        bytes32 indexed assetUid,
        bytes32 indexed tokenRuntimeCodeHash,
        address indexed beacon,
        bytes32 beaconRuntimeCodeHash,
        address implementation,
        bytes32 implementationRuntimeCodeHash
    );
    event AssetImplementationAccepted(
        bytes32 indexed assetUid,
        address indexed oldImplementation,
        address indexed newImplementation,
        bytes32 oldImplementationRuntimeCodeHash,
        bytes32 newImplementationRuntimeCodeHash,
        bytes32 reasonHash
    );
    event AssetStatusChanged(bytes32 indexed assetUid, uint8 oldStatus, uint8 newStatus, bytes32 reasonHash);
    event AssetMinimumAllocationChanged(
        bytes32 indexed assetUid, uint256 oldMinimum, uint256 newMinimum, bytes32 reasonHash
    );

    function setUp() public {
        vm.warp(1_000_000);
        manager = new AccessManager(address(this));
        registry = new OfficialStockRegistryV1(address(manager));
        stockToken = address(new MockOfficialStockToken(ASSET_UID, 18));
        marketRegistry = address(new EmptyV1Contract());
        allocationManager = address(new EmptyV1Contract());
        vault = address(
            new MockUserStockVaultIdentity(address(registry), marketRegistry, allocationManager, VAULT_SCHEMA_ID)
        );

        bytes4[] memory adminSelectors = new bytes4[](4);
        adminSelectors[0] = IOfficialStockRegistryV1.registerAsset.selector;
        adminSelectors[1] = IOfficialStockRegistryV1.retireAsset.selector;
        adminSelectors[2] = IOfficialStockRegistryV1.setMinimumAllocation.selector;
        adminSelectors[3] = IOfficialStockRegistryV1.acceptAssetImplementation.selector;
        manager.setTargetFunctionRole(address(registry), adminSelectors, PROTOCOL_ADMIN_ROLE);

        bytes4[] memory pauseSelectors = new bytes4[](1);
        pauseSelectors[0] = IOfficialStockRegistryV1.pauseAsset.selector;
        manager.setTargetFunctionRole(address(registry), pauseSelectors, PAUSE_GUARDIAN_ROLE);

        bytes4[] memory unpauseSelectors = new bytes4[](1);
        unpauseSelectors[0] = IOfficialStockRegistryV1.unpauseAsset.selector;
        manager.setTargetFunctionRole(address(registry), unpauseSelectors, UNPAUSE_ROLE);

        manager.grantRole(PROTOCOL_ADMIN_ROLE, DELAYED_ADMIN, ADMIN_DELAY);
        manager.grantRole(PROTOCOL_ADMIN_ROLE, FAST_ADMIN, 0);
        manager.grantRole(PAUSE_GUARDIAN_ROLE, GUARDIAN, 0);
        manager.grantRole(UNPAUSE_ROLE, UNPAUSER, UNPAUSE_DELAY);
    }

    function test_constructorRequiresDeployedAuthority() public {
        vm.expectRevert(abi.encodeWithSelector(ImmutableAccessManaged.InvalidAuthority.selector, address(0)));
        new OfficialStockRegistryV1(address(0));

        address noCode = address(0x1234);
        vm.expectRevert(abi.encodeWithSelector(ImmutableAccessManaged.InvalidAuthority.selector, noCode));
        new OfficialStockRegistryV1(noCode);
    }

    function test_selectorsMatchCanonicalInterface() public pure {
        assertEq(OfficialStockRegistryV1.registerAsset.selector, IOfficialStockRegistryV1.registerAsset.selector);
        assertEq(
            OfficialStockRegistryV1.acceptAssetImplementation.selector,
            IOfficialStockRegistryV1.acceptAssetImplementation.selector
        );
        assertEq(OfficialStockRegistryV1.pauseAsset.selector, IOfficialStockRegistryV1.pauseAsset.selector);
        assertEq(OfficialStockRegistryV1.unpauseAsset.selector, IOfficialStockRegistryV1.unpauseAsset.selector);
        assertEq(OfficialStockRegistryV1.retireAsset.selector, IOfficialStockRegistryV1.retireAsset.selector);
        assertEq(OfficialStockRegistryV1.asset.selector, IOfficialStockRegistryV1.asset.selector);
        assertEq(OfficialStockRegistryV1.assetFingerprint.selector, IOfficialStockRegistryV1.assetFingerprint.selector);
        assertEq(
            OfficialStockRegistryV1.assetIdentityCurrent.selector,
            IOfficialStockRegistryV1.assetIdentityCurrent.selector
        );
        assertEq(
            OfficialStockRegistryV1.minimumAllocation.selector, IOfficialStockRegistryV1.minimumAllocation.selector
        );
        assertEq(
            OfficialStockRegistryV1.setMinimumAllocation.selector,
            IOfficialStockRegistryV1.setMinimumAllocation.selector
        );
        assertEq(OfficialStockRegistryV1.vaultSchemaId.selector, IOfficialStockRegistryV1.vaultSchemaId.selector);
        assertEq(OfficialStockRegistryV1.vaultForSchema.selector, IOfficialStockRegistryV1.vaultForSchema.selector);
    }

    function test_unknownAssetIsUnset() public view {
        AssetView memory value = registry.asset(ASSET_UID);
        assertEq(value.stockToken, address(0));
        assertEq(value.userStockVault, address(0));
        assertEq(value.tokenDecimals, 0);
        assertEq(value.status, 0);
    }

    function test_allMutationsRequireTheirConfiguredSelectorRole() public {
        _expectUnauthorized(IOfficialStockRegistryV1.registerAsset.selector);
        registry.registerAsset(ASSET_UID, stockToken, 18, vault, 0.5 ether, _directFingerprint(stockToken));
        _expectUnauthorized(IOfficialStockRegistryV1.acceptAssetImplementation.selector);
        registry.acceptAssetImplementation(ASSET_UID, stockToken, stockToken.codehash, REASON_HASH);
        _expectUnauthorized(IOfficialStockRegistryV1.pauseAsset.selector);
        registry.pauseAsset(ASSET_UID, REASON_HASH);
        _expectUnauthorized(IOfficialStockRegistryV1.unpauseAsset.selector);
        registry.unpauseAsset(ASSET_UID);
        _expectUnauthorized(IOfficialStockRegistryV1.retireAsset.selector);
        registry.retireAsset(ASSET_UID, REASON_HASH);
    }

    function test_registerUsesExactTwoDayAccessManagerDelay() public {
        StockTokenFingerprint memory fingerprint = _directFingerprint(stockToken);
        bytes memory data = abi.encodeCall(
            IOfficialStockRegistryV1.registerAsset, (ASSET_UID, stockToken, 18, vault, 0.5 ether, fingerprint)
        );

        vm.prank(DELAYED_ADMIN);
        vm.expectRevert(
            abi.encodeWithSelector(
                ImmutableAccessManaged.AccessManagedUnauthorized.selector,
                DELAYED_ADMIN,
                IOfficialStockRegistryV1.registerAsset.selector
            )
        );
        registry.registerAsset(ASSET_UID, stockToken, 18, vault, 0.5 ether, fingerprint);

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
        emit StockVaultCodeIdentityPinned(vault, vault.codehash);
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
        emit StockVaultCodeIdentityPinned(vault, vault.codehash);
        vm.expectEmit(true, true, true, true);
        emit AssetRegistered(ASSET_UID, stockToken, vault, 18);
        StockTokenFingerprint memory fingerprint = _directFingerprint(stockToken);
        vm.expectEmit(true, true, true, true);
        emit StockTokenFingerprintRegistered(
            ASSET_UID,
            fingerprint.tokenRuntimeCodeHash,
            address(0),
            bytes32(0),
            stockToken,
            fingerprint.implementationRuntimeCodeHash
        );
        vm.expectEmit(true, false, false, true);
        emit AssetMinimumAllocationChanged(ASSET_UID, 0, 0.5 ether, bytes32(0));
        _registerFast(ASSET_UID, stockToken, 18, vault);
        _assertAsset(ASSET_UID, stockToken, vault, 18, 1);
        assertEq(registry.vaultSchemaId(vault), VAULT_SCHEMA_ID);
        assertEq(registry.vaultForSchema(VAULT_SCHEMA_ID), vault);
        assertEq(registry.minimumAllocation(ASSET_UID), 0.5 ether);
        assertEq(registry.vaultRuntimeCodeHash(vault), vault.codehash);
        assertTrue(registry.vaultIdentityCurrent(vault));
    }

    function test_vaultRuntimeCodeHashAndIdentityCurrentDetectCodeDrift() public {
        _registerFast(ASSET_UID, stockToken, 18, vault);
        bytes32 pinned = registry.vaultRuntimeCodeHash(vault);
        assertEq(pinned, vault.codehash);
        assertTrue(registry.vaultIdentityCurrent(vault));
        vm.etch(vault, hex"00");
        assertEq(registry.vaultRuntimeCodeHash(vault), pinned);
        assertFalse(registry.vaultIdentityCurrent(vault));
        assertFalse(registry.assetIdentityCurrent(ASSET_UID));
    }

    function test_vaultIdentityCurrentPinsReportedRuntimeBindings() public {
        MockMutableUserStockVaultIdentity mutableVault = new MockMutableUserStockVaultIdentity(
            address(registry), marketRegistry, allocationManager, VAULT_SCHEMA_ID
        );
        _registerFast(ASSET_UID, stockToken, 18, address(mutableVault));
        assertTrue(registry.vaultIdentityCurrent(address(mutableVault)));

        mutableVault.setBindings(address(new EmptyV1Contract()), allocationManager);
        assertFalse(registry.vaultIdentityCurrent(address(mutableVault)));
        assertFalse(registry.assetIdentityCurrent(ASSET_UID));
    }

    function test_registerRejectsVaultRuntimeWithDelegatedExecution() public {
        address delegatingVault = address(
            new MockDelegatingUserStockVaultIdentity(
                address(registry), marketRegistry, allocationManager, VAULT_SCHEMA_ID
            )
        );
        vm.expectRevert(
            abi.encodeWithSelector(
                OfficialStockRegistryV1.InvalidUserStockVaultCodeIdentity.selector,
                delegatingVault,
                bytes32(0),
                delegatingVault.codehash
            )
        );
        vm.prank(FAST_ADMIN);
        registry.registerAsset(ASSET_UID, stockToken, 18, delegatingVault, 0.5 ether, _directFingerprint(stockToken));
    }

    function test_minimumAllocationIsPerAssetAndUsesConfiguredAdminDelay() public {
        _registerFast(ASSET_UID, stockToken, 18, vault);
        address otherToken = address(new MockOfficialStockToken(OTHER_ASSET_UID, 6));
        _registerFast(OTHER_ASSET_UID, otherToken, 6, vault);
        assertEq(registry.minimumAllocation(ASSET_UID), 0.5 ether);
        assertEq(registry.minimumAllocation(OTHER_ASSET_UID), 500_000);

        bytes memory data =
            abi.encodeCall(IOfficialStockRegistryV1.setMinimumAllocation, (ASSET_UID, 10 ether, REASON_HASH));
        vm.prank(DELAYED_ADMIN);
        vm.expectRevert();
        registry.setMinimumAllocation(ASSET_UID, 10 ether, REASON_HASH);

        uint48 readyAt = uint48(block.timestamp + ADMIN_DELAY);
        vm.prank(DELAYED_ADMIN);
        manager.schedule(address(registry), data, readyAt);
        vm.warp(readyAt);
        vm.expectEmit(true, false, false, true, address(registry));
        emit AssetMinimumAllocationChanged(ASSET_UID, 0.5 ether, 10 ether, REASON_HASH);
        vm.prank(DELAYED_ADMIN);
        manager.execute(address(registry), data);
        assertEq(registry.minimumAllocation(ASSET_UID), 10 ether);

        data = abi.encodeCall(IOfficialStockRegistryV1.setMinimumAllocation, (ASSET_UID, 1 ether, REASON_HASH));
        readyAt = uint48(block.timestamp + ADMIN_DELAY);
        vm.prank(DELAYED_ADMIN);
        manager.schedule(address(registry), data, readyAt);
        vm.warp(readyAt - 1);
        vm.prank(DELAYED_ADMIN);
        vm.expectRevert();
        manager.execute(address(registry), data);

        vm.warp(readyAt);
        vm.expectEmit(true, false, false, true, address(registry));
        emit AssetMinimumAllocationChanged(ASSET_UID, 10 ether, 1 ether, REASON_HASH);
        vm.prank(DELAYED_ADMIN);
        manager.execute(address(registry), data);
        assertEq(registry.minimumAllocation(ASSET_UID), 1 ether);
    }

    function test_registerAndUpdateRejectMinimumBelowAccumulatorSafetyFloor() public {
        vm.expectRevert(abi.encodeWithSelector(OfficialStockRegistryV1.InvalidMinimumAllocation.selector, ASSET_UID, 0));
        vm.prank(FAST_ADMIN);
        registry.registerAsset(ASSET_UID, stockToken, 18, vault, 0, _directFingerprint(stockToken));

        vm.expectRevert(
            abi.encodeWithSelector(OfficialStockRegistryV1.InvalidMinimumAllocation.selector, ASSET_UID, 413)
        );
        vm.prank(FAST_ADMIN);
        registry.registerAsset(ASSET_UID, stockToken, 18, vault, 413, _directFingerprint(stockToken));

        vm.prank(FAST_ADMIN);
        registry.registerAsset(ASSET_UID, stockToken, 18, vault, 414, _directFingerprint(stockToken));
        assertEq(registry.minimumAllocation(ASSET_UID), 414);

        vm.expectRevert(
            abi.encodeWithSelector(OfficialStockRegistryV1.InvalidMinimumAllocation.selector, ASSET_UID, 413)
        );
        vm.prank(FAST_ADMIN);
        registry.setMinimumAllocation(ASSET_UID, 413, REASON_HASH);
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

        address lowDecimalsToken = address(new MockOfficialStockToken(ASSET_UID, 6));
        _registerFast(ASSET_UID, lowDecimalsToken, 6, vault);
        assertEq(registry.asset(ASSET_UID).tokenDecimals, 6);
        address highDecimalsToken = address(new MockOfficialStockToken(OTHER_ASSET_UID, 18));
        _registerFast(OTHER_ASSET_UID, highDecimalsToken, 18, vault);
        assertEq(registry.asset(OTHER_ASSET_UID).tokenDecimals, 18);
    }

    function test_registerRejectsReportedIdentityAndCommittedFingerprintMismatches() public {
        MockOfficialStockToken token = MockOfficialStockToken(stockToken);
        StockTokenFingerprint memory fingerprint = _directFingerprint(stockToken);

        token.setUid(OTHER_ASSET_UID);
        vm.expectRevert(
            abi.encodeWithSelector(
                OfficialStockRegistryV1.StockTokenUidMismatch.selector, stockToken, ASSET_UID, OTHER_ASSET_UID
            )
        );
        vm.prank(FAST_ADMIN);
        registry.registerAsset(ASSET_UID, stockToken, 18, vault, 0.5 ether, fingerprint);

        token.setUid(ASSET_UID);
        token.setDecimals(17);
        vm.expectRevert(
            abi.encodeWithSelector(
                OfficialStockRegistryV1.StockTokenDecimalsMismatch.selector, stockToken, uint8(18), uint256(17)
            )
        );
        vm.prank(FAST_ADMIN);
        registry.registerAsset(ASSET_UID, stockToken, 18, vault, 0.5 ether, fingerprint);

        token.setDecimals(18);
        fingerprint.tokenRuntimeCodeHash = bytes32(uint256(1));
        vm.expectRevert(
            abi.encodeWithSelector(
                OfficialStockRegistryV1.StockTokenFingerprintMismatch.selector,
                ASSET_UID,
                keccak256(abi.encode(fingerprint)),
                keccak256(abi.encode(_directFingerprint(stockToken)))
            )
        );
        vm.prank(FAST_ADMIN);
        registry.registerAsset(ASSET_UID, stockToken, 18, vault, 0.5 ether, fingerprint);
        assertEq(registry.asset(ASSET_UID).status, 0);
    }

    function test_registerRejectsUnmonitoredDelegateProxyAsDirectToken() public {
        MockBeaconStockTokenLogic implementation = new MockBeaconStockTokenLogic();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(implementation), abi.encodeCall(MockBeaconStockTokenLogic.initialize, (ASSET_UID, uint8(18)))
        );

        vm.expectRevert(
            abi.encodeWithSelector(OfficialStockRegistryV1.UnmonitoredDelegateProxy.selector, address(proxy))
        );
        vm.prank(FAST_ADMIN);
        registry.registerAsset(ASSET_UID, address(proxy), 18, vault, 0.5 ether, _directFingerprint(address(proxy)));
    }

    function test_vaultScannerSkipsOnlyUnreachableInvalidDelimitedConstants() public {
        OfficialStockRegistryV1InspectionHarness harness =
            new OfficialStockRegistryV1InspectionHarness(address(manager));
        address target = address(0xCA04);
        vm.etch(target, hex"60006000f3fef2f4ff");
        assertFalse(harness.containsForbiddenVaultOpcode(target));
        // A jump target after INVALID makes the suffix executable.
        vm.etch(target, hex"600456fe5bf4");
        assertTrue(harness.containsForbiddenVaultOpcode(target));
        // INVALID inside PUSH data must never terminate the scan.
        vm.etch(target, hex"60fef4");
        assertTrue(harness.containsForbiddenVaultOpcode(target));
        vm.etch(target, hex"f2fe");
        assertTrue(harness.containsForbiddenVaultOpcode(target));
        vm.etch(target, hex"fffe");
        assertTrue(harness.containsForbiddenVaultOpcode(target));
        vm.etch(target, hex"62f2f4ff00");
        assertFalse(harness.containsForbiddenVaultOpcode(target));
    }

    function test_delegateScannerIgnoresSolidityCborMetadataButNotExecutableOpcodes() public {
        OfficialStockRegistryV1InspectionHarness harness =
            new OfficialStockRegistryV1InspectionHarness(address(manager));
        address metadataOnly = address(0xCA01);
        address executableDelegate = address(0xCA02);
        address jumpableSuffix = address(0xCA03);
        address fakeMetadataAfterPushImmediate = address(0xCA05);
        vm.etch(metadataOnly, hex"60006000f3fea16178f40004");
        vm.etch(executableDelegate, hex"60006000f40000");
        vm.etch(jumpableSuffix, hex"60006000f3fe5bf4a16178000004");
        vm.etch(fakeMetadataAfterPushImmediate, hex"60fe50365f5f375f5f365f5f545af43d5f5f3e3d5ff3a00001");

        assertFalse(harness.containsDelegateExecution(metadataOnly));
        assertTrue(harness.containsDelegateExecution(executableDelegate));
        assertTrue(harness.containsDelegateExecution(jumpableSuffix));
        assertTrue(harness.containsDelegateExecution(fakeMetadataAfterPushImmediate));
    }

    function test_delegateScannerHandlesLiteralDataBeforeCborWithoutHidingJumpableCode() public {
        OfficialStockRegistryV1InspectionHarness harness =
            new OfficialStockRegistryV1InspectionHarness(address(manager));
        address constantsBeforeCbor = address(0xCA06);
        address laterJumpDestination = address(0xCA07);
        address invalidInsidePush = address(0xCA08);
        // The real CRM implementation has this INVALID + literals + CBOR layout.
        vm.etch(
            constantsBeforeCbor,
            hex"00fe395525728d1d6f4af44d273368682dd92b28e7464d750ef3212d3cb7f5959d0052c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace0068747470733a2f2f726f62696e686f6f642e636f6d2f73746f636b746f6b656e2f72686a8d25ea8ee309999a79f0af498fbab0e424669497170669bd9e93b81a62babc008d25ea8ee309999a79f0af498fbab0e424669497170669bd9e93b81a62babc01a2646970667358221220de4ea362122513b8e7578bfb315ce99fc240a11e4e9c5464cada2fa0503fe7aa64736f6c63430008210033"
        );
        vm.etch(laterJumpDestination, hex"600456fe5bf4fe112233");
        vm.etch(invalidInsidePush, hex"61fe0050f400");
        assertFalse(harness.containsDelegateExecution(constantsBeforeCbor));
        assertTrue(harness.containsDelegateExecution(laterJumpDestination));
        assertTrue(harness.containsDelegateExecution(invalidInsidePush));
    }

    function test_beaconUpgradeDriftRequiresPauseAndCommittedImplementationAcceptance() public {
        MockBeaconStockTokenLogic firstImplementation = new MockBeaconStockTokenLogic();
        UpgradeableBeacon beacon = new UpgradeableBeacon(address(firstImplementation), address(this));
        BeaconProxy proxy = new BeaconProxy(
            address(beacon), abi.encodeCall(MockBeaconStockTokenLogic.initialize, (ASSET_UID, uint8(18)))
        );
        StockTokenFingerprint memory fingerprint =
            StockTokenFingerprintTestLib.beacon(address(proxy), address(beacon), address(firstImplementation));

        vm.prank(FAST_ADMIN);
        registry.registerAsset(ASSET_UID, address(proxy), 18, vault, 0.5 ether, fingerprint);
        assertTrue(registry.assetIdentityCurrent(ASSET_UID));
        StockTokenFingerprint memory stored = registry.assetFingerprint(ASSET_UID);
        assertEq(stored.beacon, address(beacon));
        assertEq(stored.implementation, address(firstImplementation));

        MockBeaconStockTokenLogicV2 secondImplementation = new MockBeaconStockTokenLogicV2();
        beacon.upgradeTo(address(secondImplementation));
        assertFalse(registry.assetIdentityCurrent(ASSET_UID));

        vm.prank(GUARDIAN);
        registry.pauseAsset(ASSET_UID, REASON_HASH);
        vm.expectRevert(
            abi.encodeWithSelector(
                OfficialStockRegistryV1.InvalidAssetImplementation.selector,
                ASSET_UID,
                address(secondImplementation),
                bytes32(uint256(1)),
                address(secondImplementation),
                address(secondImplementation).codehash
            )
        );
        vm.prank(FAST_ADMIN);
        registry.acceptAssetImplementation(ASSET_UID, address(secondImplementation), bytes32(uint256(1)), REASON_HASH);

        vm.expectEmit(true, true, true, true, address(registry));
        emit AssetImplementationAccepted(
            ASSET_UID,
            address(firstImplementation),
            address(secondImplementation),
            address(firstImplementation).codehash,
            address(secondImplementation).codehash,
            REASON_HASH
        );
        vm.prank(FAST_ADMIN);
        registry.acceptAssetImplementation(
            ASSET_UID, address(secondImplementation), address(secondImplementation).codehash, REASON_HASH
        );

        assertTrue(registry.assetIdentityCurrent(ASSET_UID));
        stored = registry.assetFingerprint(ASSET_UID);
        assertEq(stored.implementation, address(secondImplementation));
        assertEq(stored.implementationRuntimeCodeHash, address(secondImplementation).codehash);
        assertEq(registry.asset(ASSET_UID).status, 2);
    }

    function test_acceptRejectsNestedDelegateImplementationThatWouldEscapeMonitoring() public {
        MockBeaconStockTokenLogic firstImplementation = new MockBeaconStockTokenLogic();
        UpgradeableBeacon beacon = new UpgradeableBeacon(address(firstImplementation), address(this));
        BeaconProxy proxy = new BeaconProxy(
            address(beacon), abi.encodeCall(MockBeaconStockTokenLogic.initialize, (ASSET_UID, uint8(18)))
        );
        vm.prank(FAST_ADMIN);
        registry.registerAsset(
            ASSET_UID,
            address(proxy),
            18,
            vault,
            0.5 ether,
            StockTokenFingerprintTestLib.beacon(address(proxy), address(beacon), address(firstImplementation))
        );

        MockNestedDelegateStockTokenLogic nestedImplementation = new MockNestedDelegateStockTokenLogic();
        beacon.upgradeTo(address(nestedImplementation));
        vm.prank(GUARDIAN);
        registry.pauseAsset(ASSET_UID, REASON_HASH);

        vm.expectRevert(
            abi.encodeWithSelector(
                OfficialStockRegistryV1.UnmonitoredDelegateProxy.selector, address(nestedImplementation)
            )
        );
        vm.prank(FAST_ADMIN);
        registry.acceptAssetImplementation(
            ASSET_UID, address(nestedImplementation), address(nestedImplementation).codehash, REASON_HASH
        );
        assertFalse(registry.assetIdentityCurrent(ASSET_UID));
        assertEq(registry.assetFingerprint(ASSET_UID).implementation, address(firstImplementation));
    }

    function test_unpauseFailsClosedWhileDirectTokenIdentityHasDrifted() public {
        _registerFast(ASSET_UID, stockToken, 18, vault);
        vm.prank(GUARDIAN);
        registry.pauseAsset(ASSET_UID, REASON_HASH);
        MockOfficialStockToken(stockToken).setUid(OTHER_ASSET_UID);
        assertFalse(registry.assetIdentityCurrent(ASSET_UID));

        manager.grantRole(UNPAUSE_ROLE, address(this), 0);
        vm.warp(block.timestamp + UNPAUSE_DELAY);
        vm.expectRevert(abi.encodeWithSelector(OfficialStockRegistryV1.AssetIdentityDrift.selector, ASSET_UID));
        registry.unpauseAsset(ASSET_UID);
        assertEq(registry.asset(ASSET_UID).status, 2);
    }

    function test_assetUidAndStockTokenAreWriteOnceButVaultCanServeMultipleAssets() public {
        _registerFast(ASSET_UID, stockToken, 18, vault);

        address otherToken = address(new MockOfficialStockToken(OTHER_ASSET_UID, 18));
        address otherVault = address(
            new MockUserStockVaultIdentity(
                address(registry), marketRegistry, allocationManager, keccak256("other-schema")
            )
        );
        vm.expectRevert(abi.encodeWithSelector(OfficialStockRegistryV1.AssetAlreadyRegistered.selector, ASSET_UID));
        vm.prank(FAST_ADMIN);
        registry.registerAsset(ASSET_UID, otherToken, 18, otherVault, 0.5 ether, _directFingerprint(otherToken));

        vm.expectRevert(
            abi.encodeWithSelector(OfficialStockRegistryV1.StockTokenAlreadyRegistered.selector, stockToken, ASSET_UID)
        );
        vm.prank(FAST_ADMIN);
        registry.registerAsset(OTHER_ASSET_UID, stockToken, 18, otherVault, 0.5 ether, _directFingerprint(stockToken));

        _registerFast(OTHER_ASSET_UID, otherToken, 18, vault);

        _assertAsset(ASSET_UID, stockToken, vault, 18, 1);
        _assertAsset(OTHER_ASSET_UID, otherToken, vault, 18, 1);
        assertEq(registry.vaultSchemaId(vault), VAULT_SCHEMA_ID);
        assertEq(registry.vaultForSchema(VAULT_SCHEMA_ID), vault);
        assertEq(registry.vaultSchemaId(otherVault), bytes32(0));
    }

    function test_eachVaultSchemaCanResolveToOnlyOneCanonicalVault() public {
        _registerFast(ASSET_UID, stockToken, 18, vault);

        address otherToken = address(new MockOfficialStockToken(OTHER_ASSET_UID, 18));
        address duplicateSchemaVault = address(
            new MockUserStockVaultIdentity(address(registry), marketRegistry, allocationManager, VAULT_SCHEMA_ID)
        );
        vm.expectRevert(
            abi.encodeWithSelector(
                OfficialStockRegistryV1.VaultSchemaAlreadyRegistered.selector,
                VAULT_SCHEMA_ID,
                vault,
                duplicateSchemaVault
            )
        );
        vm.prank(FAST_ADMIN);
        registry.registerAsset(
            OTHER_ASSET_UID, otherToken, 18, duplicateSchemaVault, 0.5 ether, _directFingerprint(otherToken)
        );

        assertEq(registry.vaultForSchema(VAULT_SCHEMA_ID), vault);
        assertEq(registry.vaultSchemaId(duplicateSchemaVault), bytes32(0));
        assertEq(registry.asset(OTHER_ASSET_UID).status, 0);
    }

    function test_registerRejectsVaultWithMissingOrWrongIdentity() public {
        address emptyVault = address(new EmptyV1Contract());
        vm.expectRevert(
            abi.encodeWithSelector(
                OfficialStockRegistryV1.InvalidUserStockVaultIdentity.selector,
                emptyVault,
                address(0),
                address(0),
                address(0),
                bytes32(0)
            )
        );
        vm.prank(FAST_ADMIN);
        registry.registerAsset(ASSET_UID, stockToken, 18, emptyVault, 0.5 ether, _directFingerprint(stockToken));

        address wrongRegistryVault =
            address(new MockUserStockVaultIdentity(address(0xBAD), marketRegistry, allocationManager, VAULT_SCHEMA_ID));
        vm.expectRevert(
            abi.encodeWithSelector(
                OfficialStockRegistryV1.InvalidUserStockVaultIdentity.selector,
                wrongRegistryVault,
                address(0xBAD),
                marketRegistry,
                allocationManager,
                VAULT_SCHEMA_ID
            )
        );
        vm.prank(FAST_ADMIN);
        registry.registerAsset(ASSET_UID, stockToken, 18, wrongRegistryVault, 0.5 ether, _directFingerprint(stockToken));
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
        vm.expectRevert(abi.encodeWithSelector(OfficialStockRegistryV1.InvalidStateTransition.selector, 0, 2));
        vm.prank(GUARDIAN);
        registry.pauseAsset(ASSET_UID, REASON_HASH);

        _registerFast(ASSET_UID, stockToken, 18, vault);
        vm.prank(GUARDIAN);
        registry.pauseAsset(ASSET_UID, REASON_HASH);
        vm.expectRevert(abi.encodeWithSelector(OfficialStockRegistryV1.InvalidStateTransition.selector, 2, 2));
        vm.prank(GUARDIAN);
        registry.pauseAsset(ASSET_UID, REASON_HASH);
    }

    function test_unpauseUsesExactOneDayDelayAndPreservesIdentity() public {
        _registerFast(ASSET_UID, stockToken, 18, vault);
        vm.prank(GUARDIAN);
        registry.pauseAsset(ASSET_UID, REASON_HASH);

        bytes memory data = abi.encodeCall(IOfficialStockRegistryV1.unpauseAsset, (ASSET_UID));
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

    function test_unpauseCannotBePreScheduledBeforePause() public {
        _registerFast(ASSET_UID, stockToken, 18, vault);
        bytes memory data = abi.encodeCall(IOfficialStockRegistryV1.unpauseAsset, (ASSET_UID));
        uint48 scheduledAt = uint48(block.timestamp + UNPAUSE_DELAY);
        vm.prank(UNPAUSER);
        manager.schedule(address(registry), data, scheduledAt);

        vm.warp(block.timestamp + 1);
        uint48 pausedAt = uint48(block.timestamp);
        vm.prank(GUARDIAN);
        registry.pauseAsset(ASSET_UID, REASON_HASH);

        vm.warp(uint256(pausedAt) + UNPAUSE_DELAY - 1);
        vm.prank(UNPAUSER);
        vm.expectRevert();
        manager.execute(address(registry), data);

        vm.warp(uint256(pausedAt) + UNPAUSE_DELAY);
        vm.prank(UNPAUSER);
        manager.execute(address(registry), data);
        _assertAsset(ASSET_UID, stockToken, vault, 18, 1);
    }

    function test_retireFromActiveUsesTwoDayDelayAndIsTerminal() public {
        _registerFast(ASSET_UID, stockToken, 18, vault);
        bytes memory data = abi.encodeCall(IOfficialStockRegistryV1.retireAsset, (ASSET_UID, REASON_HASH));
        uint48 readyAt = uint48(block.timestamp + ADMIN_DELAY);
        vm.prank(DELAYED_ADMIN);
        manager.schedule(address(registry), data, readyAt);
        vm.warp(readyAt);

        vm.expectEmit(true, false, false, true, address(registry));
        emit AssetStatusChanged(ASSET_UID, 1, 3, REASON_HASH);
        vm.prank(DELAYED_ADMIN);
        manager.execute(address(registry), data);
        _assertAsset(ASSET_UID, stockToken, vault, 18, 3);

        vm.expectRevert(abi.encodeWithSelector(OfficialStockRegistryV1.InvalidStateTransition.selector, 3, 2));
        vm.prank(GUARDIAN);
        registry.pauseAsset(ASSET_UID, REASON_HASH);
        vm.expectRevert(abi.encodeWithSelector(OfficialStockRegistryV1.InvalidStateTransition.selector, 3, 3));
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

        bytes memory data = abi.encodeCall(IOfficialStockRegistryV1.unpauseAsset, (ASSET_UID));
        uint48 readyAt = uint48(block.timestamp + UNPAUSE_DELAY);
        vm.prank(UNPAUSER);
        manager.schedule(address(registry), data, readyAt);
        vm.warp(readyAt);
        vm.expectRevert(abi.encodeWithSelector(OfficialStockRegistryV1.InvalidStateTransition.selector, 3, 1));
        vm.prank(UNPAUSER);
        manager.execute(address(registry), data);
    }

    function test_registryHasNoHardcoded194AssetLimit() public {
        for (uint256 i; i < 195; ++i) {
            bytes32 uid = bytes32(i + 1);
            address token = address(uint160(10_000 + i));
            vm.etch(token, hex"00");
            vm.mockCall(token, abi.encodeWithSelector(bytes4(0xf514ce36)), abi.encode(uid));
            vm.mockCall(token, abi.encodeWithSelector(bytes4(0x313ce567)), abi.encode(uint256(18)));
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
                OfficialStockRegistryV1.InvalidAssetIdentity.selector, uid, token, decimals, assetVault
            )
        );
        vm.prank(FAST_ADMIN);
        registry.registerAsset(uid, token, decimals, assetVault, 0.5 ether, _directFingerprint(token));
    }

    function _registerFast(bytes32 uid, address token, uint8 decimals, address assetVault) private {
        vm.prank(FAST_ADMIN);
        registry.registerAsset(uid, token, decimals, assetVault, 5 * (10 ** (decimals - 1)), _directFingerprint(token));
    }

    function _directFingerprint(address token) private view returns (StockTokenFingerprint memory) {
        return StockTokenFingerprintTestLib.direct(token);
    }

    function _assertAsset(bytes32 uid, address token, address assetVault, uint8 decimals, uint8 status) private view {
        AssetView memory value = registry.asset(uid);
        assertEq(value.stockToken, token);
        assertEq(value.userStockVault, assetVault);
        assertEq(value.tokenDecimals, decimals);
        assertEq(value.status, status);
    }
}
