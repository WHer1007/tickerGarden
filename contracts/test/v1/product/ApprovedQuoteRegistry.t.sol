// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {BeaconProxy} from "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import {UpgradeableBeacon} from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";

import {
    AssetView,
    IApprovedQuoteRegistry,
    IOfficialStockRegistryV1,
    QuoteAssetConfig,
    StockQuoteBinding,
    StockTokenFingerprint
} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {ApprovedQuoteRegistry} from "../../../src/v1/modules/ApprovedQuoteRegistry.sol";
import {OfficialStockRegistryV1} from "../../../src/v1/modules/OfficialStockRegistryV1.sol";
import {ImmutableAccessManaged} from "../../../src/v1/shared/ImmutableAccessManaged.sol";
import {StockTokenFingerprintTestLib} from "../mocks/StockTokenFingerprintTestLib.sol";

contract QuoteRegistryEmptyDependency {}

contract QuoteRegistryBeaconStockLogic {
    bytes32 public uid;
    uint8 public decimals;

    function initialize(bytes32 uid_, uint8 decimals_) external {
        require(uid == bytes32(0), "ALREADY_INITIALIZED");
        uid = uid_;
        decimals = decimals_;
    }
}

contract QuoteRegistryBeaconStockLogicV2 is QuoteRegistryBeaconStockLogic {
    function version() external pure returns (uint256) {
        return 2;
    }
}

contract QuoteRegistryVaultIdentity {
    address private immutable _registry;
    address private immutable _marketRegistry;
    address private immutable _allocationManager;
    bytes32 private immutable _schemaId;

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

contract QuoteTokenMock {
    uint8 public immutable decimals;

    constructor(uint8 decimals_) {
        decimals = decimals_;
    }
}

contract MutableDecimalsQuoteMock {
    uint8 public decimals;

    constructor(uint8 decimals_) {
        decimals = decimals_;
    }

    function setDecimals(uint8 decimals_) external {
        decimals = decimals_;
    }
}

contract RevertingDecimalsMock {
    function decimals() external pure returns (uint8) {
        revert();
    }
}

contract MalformedDecimalsMock {
    fallback() external {
        assembly ("memory-safe") {
            mstore(0, 6)
            return(31, 1)
        }
    }
}

contract ApprovedQuoteRegistryTest is Test {
    uint64 internal constant PROTOCOL_ADMIN_ROLE = 1;
    uint64 internal constant PAUSE_GUARDIAN_ROLE = 2;
    uint64 internal constant UNPAUSE_ROLE = 3;
    uint32 internal constant ADMIN_DELAY = 2 days;
    uint32 internal constant UNPAUSE_DELAY = 1 days;
    uint256 internal constant TARGET_CHAIN_ID = 4663;

    bytes32 internal constant BASELINE_ID = 0x78d3fa45758f93f793093e0ea0cd900f9aaade792dc1cb6a1d3567b1dc81881d;
    bytes32 internal constant NATIVE_CONFIG_ID = 0x110acc145df286ef871d394b987b4ce12b062dc4d50d75343cdac7986a21e64e;
    bytes32 internal constant REASON_HASH = keccak256("quote-risk");
    bytes32 internal constant ASSET_UID = keccak256("official-stock-quote");
    bytes32 internal constant VAULT_SCHEMA_ID = keccak256("TickerGarden.UserStockVault.MultiAsset.StockQuoteTest");
    bytes32 internal constant REFERENCE_EVIDENCE_HASH = keccak256("finalized-price-and-behavior-evidence");
    bytes32 internal constant GENERATOR_POLICY_ID = keccak256("stock-quote-generator-policy-v1");
    address internal constant DELAYED_ADMIN = address(0xA11CE);
    address internal constant FAST_ADMIN = address(0xFA57);
    address internal constant GUARDIAN = address(0x6A7D);
    address internal constant UNPAUSER = address(0xBEEF);

    AccessManager internal manager;
    OfficialStockRegistryV1 internal stockRegistry;
    ApprovedQuoteRegistry internal registry;
    QuoteTokenMock internal token;
    QuoteRegistryBeaconStockLogic internal stockImplementation;
    UpgradeableBeacon internal stockBeacon;
    address internal stockToken;
    address internal stockVault;

    event QuoteAssetConfigAdded(
        bytes32 indexed configId,
        address indexed quoteAsset,
        bytes32 indexed tickerGardenBaselineId,
        bytes32 economicsHash
    );
    event QuoteAssetIdentityPinned(bytes32 indexed configId, address indexed quoteAsset, bytes32 runtimeCodeHash);
    event StockQuoteConfigBound(
        bytes32 indexed configId,
        bytes32 indexed assetUid,
        address indexed quoteAsset,
        bytes32 stockTokenFingerprintHash,
        bytes32 referenceEvidenceHash,
        bytes32 generatorPolicyId
    );
    event QuoteAssetStatusChanged(bytes32 indexed configId, uint8 oldStatus, uint8 newStatus, bytes32 reasonHash);

    function setUp() public {
        vm.chainId(TARGET_CHAIN_ID);
        vm.warp(1_000_000);
        manager = new AccessManager(address(this));
        stockRegistry = new OfficialStockRegistryV1(address(manager));
        stockImplementation = new QuoteRegistryBeaconStockLogic();
        stockBeacon = new UpgradeableBeacon(address(stockImplementation), address(this));
        stockToken = address(
            new BeaconProxy(
                address(stockBeacon), abi.encodeCall(QuoteRegistryBeaconStockLogic.initialize, (ASSET_UID, uint8(18)))
            )
        );
        address marketDependency = address(new QuoteRegistryEmptyDependency());
        address allocationDependency = address(new QuoteRegistryEmptyDependency());
        stockVault = address(
            new QuoteRegistryVaultIdentity(
                address(stockRegistry), marketDependency, allocationDependency, VAULT_SCHEMA_ID
            )
        );
        registry = new ApprovedQuoteRegistry(address(manager), address(stockRegistry));
        token = new QuoteTokenMock(6);

        bytes4[] memory adminSelectors = new bytes4[](3);
        adminSelectors[0] = IApprovedQuoteRegistry.addQuoteConfig.selector;
        adminSelectors[1] = IApprovedQuoteRegistry.addStockQuoteConfig.selector;
        adminSelectors[2] = IApprovedQuoteRegistry.retireQuote.selector;
        manager.setTargetFunctionRole(address(registry), adminSelectors, PROTOCOL_ADMIN_ROLE);

        bytes4[] memory stockAdminSelectors = new bytes4[](4);
        stockAdminSelectors[0] = IOfficialStockRegistryV1.registerAsset.selector;
        stockAdminSelectors[1] = IOfficialStockRegistryV1.acceptAssetImplementation.selector;
        stockAdminSelectors[2] = IOfficialStockRegistryV1.setMinimumAllocation.selector;
        stockAdminSelectors[3] = IOfficialStockRegistryV1.retireAsset.selector;
        manager.setTargetFunctionRole(address(stockRegistry), stockAdminSelectors, PROTOCOL_ADMIN_ROLE);

        bytes4[] memory pauseSelectors = new bytes4[](1);
        pauseSelectors[0] = IApprovedQuoteRegistry.pauseQuote.selector;
        manager.setTargetFunctionRole(address(registry), pauseSelectors, PAUSE_GUARDIAN_ROLE);
        pauseSelectors[0] = IOfficialStockRegistryV1.pauseAsset.selector;
        manager.setTargetFunctionRole(address(stockRegistry), pauseSelectors, PAUSE_GUARDIAN_ROLE);

        bytes4[] memory unpauseSelectors = new bytes4[](1);
        unpauseSelectors[0] = IApprovedQuoteRegistry.unpauseQuote.selector;
        manager.setTargetFunctionRole(address(registry), unpauseSelectors, UNPAUSE_ROLE);
        unpauseSelectors[0] = IOfficialStockRegistryV1.unpauseAsset.selector;
        manager.setTargetFunctionRole(address(stockRegistry), unpauseSelectors, UNPAUSE_ROLE);

        manager.grantRole(PROTOCOL_ADMIN_ROLE, DELAYED_ADMIN, ADMIN_DELAY);
        manager.grantRole(PROTOCOL_ADMIN_ROLE, FAST_ADMIN, 0);
        manager.grantRole(PAUSE_GUARDIAN_ROLE, GUARDIAN, 0);
        manager.grantRole(UNPAUSE_ROLE, UNPAUSER, UNPAUSE_DELAY);
        manager.grantRole(UNPAUSE_ROLE, FAST_ADMIN, 0);

        vm.prank(FAST_ADMIN);
        stockRegistry.registerAsset(
            ASSET_UID,
            stockToken,
            18,
            stockVault,
            1 ether,
            StockTokenFingerprintTestLib.beacon(stockToken, address(stockBeacon), address(stockImplementation))
        );
    }

    function test_constructorRequiresDeployedAuthority() public {
        vm.expectRevert(abi.encodeWithSelector(ImmutableAccessManaged.InvalidAuthority.selector, address(0)));
        new ApprovedQuoteRegistry(address(0), address(stockRegistry));

        address noCode = address(0x1234);
        vm.expectRevert(abi.encodeWithSelector(ImmutableAccessManaged.InvalidAuthority.selector, noCode));
        new ApprovedQuoteRegistry(noCode, address(stockRegistry));

        vm.expectRevert(
            abi.encodeWithSelector(
                ApprovedQuoteRegistry.InvalidOfficialStockRegistry.selector, address(0), address(manager), address(0)
            )
        );
        new ApprovedQuoteRegistry(address(manager), address(0));

        AccessManager otherManager = new AccessManager(address(this));
        OfficialStockRegistryV1 otherRegistry = new OfficialStockRegistryV1(address(otherManager));
        vm.expectRevert(
            abi.encodeWithSelector(
                ApprovedQuoteRegistry.InvalidOfficialStockRegistry.selector,
                address(otherRegistry),
                address(manager),
                address(otherManager)
            )
        );
        new ApprovedQuoteRegistry(address(manager), address(otherRegistry));
    }

    function test_selectorsMatchCanonicalInterface() public pure {
        assertEq(ApprovedQuoteRegistry.addQuoteConfig.selector, IApprovedQuoteRegistry.addQuoteConfig.selector);
        assertEq(
            ApprovedQuoteRegistry.addStockQuoteConfig.selector, IApprovedQuoteRegistry.addStockQuoteConfig.selector
        );
        assertEq(ApprovedQuoteRegistry.pauseQuote.selector, IApprovedQuoteRegistry.pauseQuote.selector);
        assertEq(ApprovedQuoteRegistry.unpauseQuote.selector, IApprovedQuoteRegistry.unpauseQuote.selector);
        assertEq(ApprovedQuoteRegistry.retireQuote.selector, IApprovedQuoteRegistry.retireQuote.selector);
        assertEq(ApprovedQuoteRegistry.quoteConfig.selector, IApprovedQuoteRegistry.quoteConfig.selector);
        assertEq(
            ApprovedQuoteRegistry.quoteRuntimeCodeHash.selector, IApprovedQuoteRegistry.quoteRuntimeCodeHash.selector
        );
        assertEq(
            ApprovedQuoteRegistry.quoteIdentityCurrent.selector, IApprovedQuoteRegistry.quoteIdentityCurrent.selector
        );
        assertEq(ApprovedQuoteRegistry.stockQuoteBinding.selector, IApprovedQuoteRegistry.stockQuoteBinding.selector);
        assertEq(bytes4(keccak256("officialStockRegistry()")), IApprovedQuoteRegistry.officialStockRegistry.selector);
    }

    function test_unknownConfigIsUnsetAndNotNative() public view {
        QuoteAssetConfig memory config = registry.quoteConfig(keccak256("unknown"));
        assertEq(config.tickerGardenBaselineId, bytes32(0));
        assertEq(config.quoteAsset, address(0));
        assertEq(config.quoteDecimals, 0);
        assertEq(config.phantomQuote, 0);
        assertEq(config.graduationThreshold, 0);
        assertEq(config.economicsHash, bytes32(0));
        assertEq(config.status, 0);
        assertEq(registry.quoteRuntimeCodeHash(keccak256("unknown")), bytes32(0));
        StockQuoteBinding memory binding = registry.stockQuoteBinding(keccak256("unknown"));
        assertEq(binding.assetUid, bytes32(0));
        assertEq(binding.stockTokenFingerprintHash, bytes32(0));
        assertEq(binding.referenceEvidenceHash, bytes32(0));
        assertEq(binding.generatorPolicyId, bytes32(0));
        assertFalse(registry.quoteIdentityCurrent(keccak256("unknown")));
        assertEq(registry.officialStockRegistry(), address(stockRegistry));
    }

    function test_allMutationsRequireTheirConfiguredSelectorRole() public {
        QuoteAssetConfig memory config = _nativeConfig();
        _expectUnauthorized(IApprovedQuoteRegistry.addQuoteConfig.selector);
        registry.addQuoteConfig(NATIVE_CONFIG_ID, config);
        _expectUnauthorized(IApprovedQuoteRegistry.addStockQuoteConfig.selector);
        registry.addStockQuoteConfig(
            bytes32(0), config, StockQuoteBinding(bytes32(0), bytes32(0), bytes32(0), bytes32(0))
        );
        _expectUnauthorized(IApprovedQuoteRegistry.pauseQuote.selector);
        registry.pauseQuote(NATIVE_CONFIG_ID, REASON_HASH);
        _expectUnauthorized(IApprovedQuoteRegistry.unpauseQuote.selector);
        registry.unpauseQuote(NATIVE_CONFIG_ID);
        _expectUnauthorized(IApprovedQuoteRegistry.retireQuote.selector);
        registry.retireQuote(NATIVE_CONFIG_ID, REASON_HASH);
    }

    function test_addUsesExactTwoDayAccessManagerDelay() public {
        QuoteAssetConfig memory config = _nativeConfig();
        bytes memory data = abi.encodeCall(IApprovedQuoteRegistry.addQuoteConfig, (NATIVE_CONFIG_ID, config));

        vm.prank(DELAYED_ADMIN);
        vm.expectRevert(
            abi.encodeWithSelector(
                ImmutableAccessManaged.AccessManagedUnauthorized.selector,
                DELAYED_ADMIN,
                IApprovedQuoteRegistry.addQuoteConfig.selector
            )
        );
        registry.addQuoteConfig(NATIVE_CONFIG_ID, config);

        uint48 readyAt = uint48(block.timestamp + ADMIN_DELAY);
        vm.prank(DELAYED_ADMIN);
        manager.schedule(address(registry), data, readyAt);
        vm.warp(readyAt - 1);
        vm.prank(DELAYED_ADMIN);
        vm.expectRevert();
        manager.execute(address(registry), data);

        vm.warp(readyAt);
        vm.expectEmit(true, true, true, true, address(registry));
        emit QuoteAssetConfigAdded(NATIVE_CONFIG_ID, address(0), BASELINE_ID, NATIVE_CONFIG_ID);
        vm.prank(DELAYED_ADMIN);
        manager.execute(address(registry), data);
        _assertConfig(NATIVE_CONFIG_ID, config, 1);
    }

    function test_addsFrozenNativeInitialConfigAndEmitsCanonicalEvent() public {
        QuoteAssetConfig memory config = _nativeConfig();
        assertEq(_economicsHash(config), NATIVE_CONFIG_ID);
        vm.expectEmit(true, true, true, true);
        emit QuoteAssetConfigAdded(NATIVE_CONFIG_ID, address(0), BASELINE_ID, NATIVE_CONFIG_ID);
        _addFast(NATIVE_CONFIG_ID, config);
        _assertConfig(NATIVE_CONFIG_ID, config, 1);
    }

    function test_addsErc20AndRequiresLiveMatchingDecimals() public {
        QuoteAssetConfig memory config = _erc20Config(address(token), 6, 3_236_000_000, 8_090_000_000);
        bytes32 configId = _economicsHash(config);
        config.economicsHash = configId;
        _addFast(configId, config);
        _assertConfig(configId, config, 1);
        assertEq(registry.quoteRuntimeCodeHash(configId), address(token).codehash);
        assertTrue(registry.quoteIdentityCurrent(configId));

        QuoteAssetConfig memory wrongDecimals = _erc20Config(address(token), 8, 1, 2);
        bytes32 wrongId = _economicsHash(wrongDecimals);
        wrongDecimals.economicsHash = wrongId;
        vm.expectRevert(abi.encodeWithSelector(ApprovedQuoteRegistry.InvalidQuoteAsset.selector, address(token), 8));
        vm.prank(FAST_ADMIN);
        registry.addQuoteConfig(wrongId, wrongDecimals);
    }

    function test_addsOfficialBeaconStockQuoteWithPinnedUidFingerprintAndEvidence() public {
        StockQuoteBinding memory binding = _stockBinding();
        QuoteAssetConfig memory config = _stockConfig(binding, 2 ether, 5 ether);
        bytes32 configId = config.economicsHash;

        vm.expectEmit(true, true, true, true);
        emit QuoteAssetConfigAdded(configId, stockToken, BASELINE_ID, configId);
        vm.expectEmit(true, true, false, true);
        emit QuoteAssetIdentityPinned(configId, stockToken, stockToken.codehash);
        vm.expectEmit(true, true, true, true);
        emit StockQuoteConfigBound(
            configId,
            ASSET_UID,
            stockToken,
            binding.stockTokenFingerprintHash,
            REFERENCE_EVIDENCE_HASH,
            GENERATOR_POLICY_ID
        );
        _addStockFast(configId, config, binding);

        _assertConfig(configId, config, 1);
        StockQuoteBinding memory stored = registry.stockQuoteBinding(configId);
        assertEq(keccak256(abi.encode(stored)), keccak256(abi.encode(binding)));
        assertEq(registry.quoteRuntimeCodeHash(configId), stockToken.codehash);
        assertTrue(registry.quoteIdentityCurrent(configId));
    }

    function test_stockQuoteAdmissionUsesExactTwoDayAccessManagerDelay() public {
        StockQuoteBinding memory binding = _stockBinding();
        QuoteAssetConfig memory config = _stockConfig(binding, 2 ether, 5 ether);
        bytes32 configId = config.economicsHash;
        bytes memory data = abi.encodeCall(IApprovedQuoteRegistry.addStockQuoteConfig, (configId, config, binding));

        vm.prank(DELAYED_ADMIN);
        vm.expectRevert(
            abi.encodeWithSelector(
                ImmutableAccessManaged.AccessManagedUnauthorized.selector,
                DELAYED_ADMIN,
                IApprovedQuoteRegistry.addStockQuoteConfig.selector
            )
        );
        registry.addStockQuoteConfig(configId, config, binding);

        uint48 readyAt = uint48(block.timestamp + ADMIN_DELAY);
        vm.prank(DELAYED_ADMIN);
        manager.schedule(address(registry), data, readyAt);
        vm.warp(readyAt - 1);
        vm.prank(DELAYED_ADMIN);
        vm.expectRevert();
        manager.execute(address(registry), data);

        vm.warp(readyAt);
        vm.prank(DELAYED_ADMIN);
        manager.execute(address(registry), data);
        assertTrue(registry.quoteIdentityCurrent(configId));
    }

    function test_stockQuoteRejectsMissingEvidenceWrongUidTokenDecimalsAndFingerprint() public {
        StockQuoteBinding memory binding = _stockBinding();
        QuoteAssetConfig memory config = _stockConfig(binding, 2 ether, 5 ether);

        StockQuoteBinding memory missingEvidence = _stockBinding();
        missingEvidence.referenceEvidenceHash = bytes32(0);
        vm.expectRevert(
            abi.encodeWithSelector(
                ApprovedQuoteRegistry.InvalidStockQuoteBinding.selector, config.economicsHash, ASSET_UID
            )
        );
        vm.prank(FAST_ADMIN);
        registry.addStockQuoteConfig(config.economicsHash, config, missingEvidence);

        StockQuoteBinding memory unknown = _stockBinding();
        unknown.assetUid = keccak256("unknown-stock");
        config = _stockConfig(unknown, 3 ether, 6 ether);
        vm.expectRevert(
            abi.encodeWithSelector(ApprovedQuoteRegistry.StockQuoteAssetNotActive.selector, unknown.assetUid, 0)
        );
        vm.prank(FAST_ADMIN);
        registry.addStockQuoteConfig(config.economicsHash, config, unknown);

        QuoteAssetConfig memory wrongToken = _stockConfig(binding, 4 ether, 7 ether);
        wrongToken.quoteAsset = address(token);
        wrongToken.quoteDecimals = 6;
        wrongToken.economicsHash = _stockEconomicsHash(wrongToken, binding);
        vm.expectRevert(
            abi.encodeWithSelector(
                ApprovedQuoteRegistry.StockQuoteAssetMismatch.selector,
                ASSET_UID,
                stockToken,
                address(token),
                uint8(18),
                uint8(6)
            )
        );
        vm.prank(FAST_ADMIN);
        registry.addStockQuoteConfig(wrongToken.economicsHash, wrongToken, binding);

        StockQuoteBinding memory wrongFingerprint = _stockBinding();
        wrongFingerprint.stockTokenFingerprintHash = keccak256("wrong-fingerprint");
        config = _stockConfig(wrongFingerprint, 5 ether, 8 ether);
        vm.expectRevert(
            abi.encodeWithSelector(
                ApprovedQuoteRegistry.InvalidStockQuoteFingerprint.selector,
                ASSET_UID,
                wrongFingerprint.stockTokenFingerprintHash,
                _stockBinding().stockTokenFingerprintHash
            )
        );
        vm.prank(FAST_ADMIN);
        registry.addStockQuoteConfig(config.economicsHash, config, wrongFingerprint);
    }

    function test_optionalStockBindingRemainsStrictWhileGenericWhitelistAdmitsProxy() public {
        QuoteAssetConfig memory genericConfig = _erc20Config(stockToken, 18, 1 ether, 2 ether);
        vm.prank(FAST_ADMIN);
        registry.addQuoteConfig(genericConfig.economicsHash, genericConfig);
        assertTrue(registry.quoteIdentityCurrent(genericConfig.economicsHash));

        bytes32 directUid = keccak256("direct-official-stock");
        QuoteRegistryBeaconStockLogic directStock = new QuoteRegistryBeaconStockLogic();
        directStock.initialize(directUid, 18);
        vm.prank(FAST_ADMIN);
        stockRegistry.registerAsset(
            directUid,
            address(directStock),
            18,
            stockVault,
            1 ether,
            StockTokenFingerprintTestLib.direct(address(directStock))
        );
        AssetView memory directAsset = stockRegistry.asset(directUid);
        StockTokenFingerprint memory directFingerprint = stockRegistry.assetFingerprint(directUid);
        StockQuoteBinding memory binding = StockQuoteBinding({
            assetUid: directUid,
            stockTokenFingerprintHash: _fingerprintHash(directUid, directAsset, directFingerprint),
            referenceEvidenceHash: REFERENCE_EVIDENCE_HASH,
            generatorPolicyId: GENERATOR_POLICY_ID
        });
        QuoteAssetConfig memory config = QuoteAssetConfig({
            tickerGardenBaselineId: BASELINE_ID,
            quoteAsset: address(directStock),
            quoteDecimals: 18,
            phantomQuote: 2 ether,
            graduationThreshold: 5 ether,
            economicsHash: bytes32(0),
            status: 1
        });
        config.economicsHash = _stockEconomicsHash(config, binding);

        vm.expectRevert(
            abi.encodeWithSelector(
                ApprovedQuoteRegistry.StockQuoteRequiresImmutableBeacon.selector, directUid, address(directStock)
            )
        );
        vm.prank(FAST_ADMIN);
        registry.addStockQuoteConfig(config.economicsHash, config, binding);
    }

    function test_auditGenericProxyQuoteDoesNotDetectImplementationUpgrade() public {
        QuoteAssetConfig memory genericConfig = _erc20Config(stockToken, 18, 1 ether, 2 ether);
        vm.prank(FAST_ADMIN);
        registry.addQuoteConfig(genericConfig.economicsHash, genericConfig);
        StockQuoteBinding memory binding = _stockBinding();
        QuoteAssetConfig memory boundConfig = _stockConfig(binding, 2 ether, 5 ether);
        _addStockFast(boundConfig.economicsHash, boundConfig, binding);
        bytes32 pinnedProxyCode = stockToken.codehash;

        stockBeacon.upgradeTo(address(new QuoteRegistryBeaconStockLogicV2()));

        assertEq(stockToken.codehash, pinnedProxyCode, "proxy runtime did not change");
        assertTrue(
            registry.quoteIdentityCurrent(genericConfig.economicsHash), "generic admission trusts proxy upgrades"
        );
        assertFalse(
            registry.quoteIdentityCurrent(boundConfig.economicsHash), "explicit fingerprint binding detects upgrade"
        );
        assertFalse(stockRegistry.assetIdentityCurrent(ASSET_UID));
    }

    function test_assetPauseAndBeaconUpgradeInvalidateStockQuoteForFutureMarkets() public {
        StockQuoteBinding memory binding = _stockBinding();
        QuoteAssetConfig memory config = _stockConfig(binding, 2 ether, 5 ether);
        _addStockFast(config.economicsHash, config, binding);
        assertTrue(registry.quoteIdentityCurrent(config.economicsHash));

        vm.prank(GUARDIAN);
        stockRegistry.pauseAsset(ASSET_UID, REASON_HASH);
        assertFalse(registry.quoteIdentityCurrent(config.economicsHash));

        vm.warp(block.timestamp + UNPAUSE_DELAY);
        vm.prank(FAST_ADMIN);
        stockRegistry.unpauseAsset(ASSET_UID);
        assertTrue(registry.quoteIdentityCurrent(config.economicsHash));

        QuoteRegistryBeaconStockLogicV2 secondImplementation = new QuoteRegistryBeaconStockLogicV2();
        stockBeacon.upgradeTo(address(secondImplementation));
        assertFalse(stockRegistry.assetIdentityCurrent(ASSET_UID));
        assertFalse(registry.quoteIdentityCurrent(config.economicsHash));

        vm.prank(GUARDIAN);
        stockRegistry.pauseAsset(ASSET_UID, REASON_HASH);
        vm.prank(FAST_ADMIN);
        stockRegistry.acceptAssetImplementation(
            ASSET_UID, address(secondImplementation), address(secondImplementation).codehash, REASON_HASH
        );
        vm.warp(block.timestamp + UNPAUSE_DELAY);
        vm.prank(FAST_ADMIN);
        stockRegistry.unpauseAsset(ASSET_UID);

        assertTrue(stockRegistry.assetIdentityCurrent(ASSET_UID));
        assertFalse(registry.quoteIdentityCurrent(config.economicsHash));

        StockQuoteBinding memory replacementBinding = _stockBinding();
        QuoteAssetConfig memory replacementConfig = _stockConfig(replacementBinding, 3 ether, 6 ether);
        _addStockFast(replacementConfig.economicsHash, replacementConfig, replacementBinding);
        assertTrue(registry.quoteIdentityCurrent(replacementConfig.economicsHash));
        assertTrue(replacementConfig.economicsHash != config.economicsHash);
    }

    function test_adminMayAppendMultipleIndependentActiveQuoteConfigs() public {
        QuoteTokenMock secondToken = new QuoteTokenMock(18);
        QuoteAssetConfig memory nativeConfig = _nativeConfig();
        QuoteAssetConfig memory sixDecimalConfig = _erc20Config(address(token), 6, 3_236_000_000, 8_090_000_000);
        QuoteAssetConfig memory eighteenDecimalConfig = _erc20Config(address(secondToken), 18, 2 ether, 5 ether);

        _addFast(nativeConfig.economicsHash, nativeConfig);
        _addFast(sixDecimalConfig.economicsHash, sixDecimalConfig);
        _addFast(eighteenDecimalConfig.economicsHash, eighteenDecimalConfig);

        assertEq(registry.quoteConfig(nativeConfig.economicsHash).status, 1);
        assertEq(registry.quoteConfig(sixDecimalConfig.economicsHash).status, 1);
        assertEq(registry.quoteConfig(eighteenDecimalConfig.economicsHash).status, 1);
        assertTrue(registry.quoteIdentityCurrent(nativeConfig.economicsHash));
        assertTrue(registry.quoteIdentityCurrent(sixDecimalConfig.economicsHash));
        assertTrue(registry.quoteIdentityCurrent(eighteenDecimalConfig.economicsHash));

        vm.prank(GUARDIAN);
        registry.pauseQuote(sixDecimalConfig.economicsHash, REASON_HASH);
        assertEq(registry.quoteConfig(sixDecimalConfig.economicsHash).status, 2);
        assertEq(registry.quoteConfig(nativeConfig.economicsHash).status, 1);
        assertEq(registry.quoteConfig(eighteenDecimalConfig.economicsHash).status, 1);
    }

    function test_adminWhitelistAdmitsSixAndEightDecimalErc1967Proxies() public {
        QuoteAssetConfig memory config = _erc20Config(address(token), 6, 3_236_000_000, 8_090_000_000);
        bytes32 configId = config.economicsHash;
        vm.expectEmit(true, true, true, true);
        emit QuoteAssetConfigAdded(configId, address(token), BASELINE_ID, configId);
        vm.expectEmit(true, true, false, true);
        emit QuoteAssetIdentityPinned(configId, address(token), address(token).codehash);
        _addFast(configId, config);

        for (uint8 decimals = 6; decimals <= 8; decimals += 2) {
            QuoteRegistryBeaconStockLogic implementation = new QuoteRegistryBeaconStockLogic();
            ERC1967Proxy proxy = new ERC1967Proxy(
                address(implementation),
                abi.encodeCall(implementation.initialize, (bytes32(uint256(decimals)), decimals))
            );
            QuoteAssetConfig memory reviewed = _erc20Config(address(proxy), decimals, 1_000_000, 2_500_000);
            vm.expectRevert();
            vm.prank(address(0xBAD));
            registry.addQuoteConfig(reviewed.economicsHash, reviewed);
            _addFast(reviewed.economicsHash, reviewed);
            assertTrue(registry.quoteIdentityCurrent(reviewed.economicsHash));
            assertEq(registry.quoteConfig(reviewed.economicsHash).status, 1);
        }
    }

    function test_whitelistAcceptsReviewedRuntimeBytes() public {
        address candidate = address(0xD312);
        // PUSH1 0xf4; POP; then return ABI-encoded decimals=6. The 0xf4 byte is data, not DELEGATECALL.
        vm.etch(candidate, hex"60f450600660005260206000f3");
        QuoteAssetConfig memory config = _erc20Config(candidate, 6, 1, 2);
        _addFast(config.economicsHash, config);
        assertTrue(registry.quoteIdentityCurrent(config.economicsHash));
    }

    function test_mutableDecimalsDriftFailsIdentityEvenWhenRuntimeCodehashIsUnchanged() public {
        MutableDecimalsQuoteMock mutableToken = new MutableDecimalsQuoteMock(6);
        QuoteAssetConfig memory config = _erc20Config(address(mutableToken), 6, 1, 2);
        _addFast(config.economicsHash, config);
        bytes32 pinned = address(mutableToken).codehash;

        mutableToken.setDecimals(18);

        assertEq(address(mutableToken).codehash, pinned);
        assertFalse(registry.quoteIdentityCurrent(config.economicsHash));
    }

    function test_runtimeCodeDriftBlocksIdentityCheckAndUnpause() public {
        QuoteAssetConfig memory config = _erc20Config(address(token), 6, 1, 2);
        bytes32 configId = config.economicsHash;
        _addFast(configId, config);
        bytes32 pinned = address(token).codehash;
        assertEq(registry.quoteRuntimeCodeHash(configId), pinned);

        vm.prank(GUARDIAN);
        registry.pauseQuote(configId, REASON_HASH);
        vm.etch(address(token), hex"00");
        assertFalse(registry.quoteIdentityCurrent(configId));

        bytes memory data = abi.encodeCall(IApprovedQuoteRegistry.unpauseQuote, (configId));
        uint48 readyAt = uint48(block.timestamp + UNPAUSE_DELAY);
        vm.prank(UNPAUSER);
        manager.schedule(address(registry), data, readyAt);
        vm.warp(readyAt);
        vm.expectRevert(abi.encodeWithSelector(ApprovedQuoteRegistry.QuoteAssetIdentityDrift.selector, configId));
        vm.prank(UNPAUSER);
        manager.execute(address(registry), data);
    }

    function test_rejectsInvalidConfigShapeAndNumericDomain() public {
        QuoteAssetConfig memory config = _nativeConfig();
        _expectInvalidConfig(bytes32(0), config);

        config.tickerGardenBaselineId = bytes32(0);
        _expectInvalidConfig(NATIVE_CONFIG_ID, config);
        config = _nativeConfig();
        config.status = 0;
        _expectInvalidConfig(NATIVE_CONFIG_ID, config);
        config = _nativeConfig();
        config.status = 2;
        _expectInvalidConfig(NATIVE_CONFIG_ID, config);
        config = _nativeConfig();
        config.phantomQuote = 0;
        _expectInvalidConfig(NATIVE_CONFIG_ID, config);
        config = _nativeConfig();
        config.graduationThreshold = 0;
        _expectInvalidConfig(NATIVE_CONFIG_ID, config);
        config = _nativeConfig();
        config.phantomQuote = type(uint256).max;
        config.graduationThreshold = 1;
        _expectInvalidConfig(NATIVE_CONFIG_ID, config);
        config = _nativeConfig();
        config.phantomQuote = uint256(uint128(type(int128).max)) + 1;
        config.economicsHash = _economicsHash(config);
        _expectInvalidConfig(config.economicsHash, config);
        config = _nativeConfig();
        config.graduationThreshold = uint256(uint128(type(int128).max)) + 1;
        config.economicsHash = _economicsHash(config);
        _expectInvalidConfig(config.economicsHash, config);

        QuoteAssetConfig memory lowDecimals = _erc20Config(address(new QuoteTokenMock(5)), 5, 1, 2);
        _expectInvalidConfig(_economicsHash(lowDecimals), lowDecimals);
        QuoteAssetConfig memory highDecimals = _erc20Config(address(new QuoteTokenMock(19)), 19, 1, 2);
        _expectInvalidConfig(_economicsHash(highDecimals), highDecimals);
    }

    function test_nativeRequiresExactlyAddressZeroAndEighteenDecimals() public {
        QuoteAssetConfig memory wrongDecimals = _nativeConfig();
        wrongDecimals.quoteDecimals = 17;
        wrongDecimals.economicsHash = _economicsHash(wrongDecimals);
        vm.expectRevert(abi.encodeWithSelector(ApprovedQuoteRegistry.InvalidQuoteAsset.selector, address(0), 17));
        vm.prank(FAST_ADMIN);
        registry.addQuoteConfig(wrongDecimals.economicsHash, wrongDecimals);
    }

    function test_erc20RejectsEoaRevertingAndMalformedDecimals() public {
        _expectInvalidAsset(address(0x1234), 6);
        _expectInvalidAsset(address(new RevertingDecimalsMock()), 6);
        _expectInvalidAsset(address(new MalformedDecimalsMock()), 6);
    }

    function test_configIdAndEconomicsHashMustBothEqualContentHash() public {
        QuoteAssetConfig memory config = _nativeConfig();
        bytes32 wrongId = keccak256("wrong-id");
        vm.expectRevert(
            abi.encodeWithSelector(
                ApprovedQuoteRegistry.InvalidEconomicsHash.selector, wrongId, NATIVE_CONFIG_ID, NATIVE_CONFIG_ID
            )
        );
        vm.prank(FAST_ADMIN);
        registry.addQuoteConfig(wrongId, config);

        config.economicsHash = keccak256("wrong-economics");
        vm.expectRevert(
            abi.encodeWithSelector(
                ApprovedQuoteRegistry.InvalidEconomicsHash.selector,
                NATIVE_CONFIG_ID,
                config.economicsHash,
                NATIVE_CONFIG_ID
            )
        );
        vm.prank(FAST_ADMIN);
        registry.addQuoteConfig(NATIVE_CONFIG_ID, config);
    }

    function test_configIdIsWriteOnceAndEconomicsRemainFrozen() public {
        QuoteAssetConfig memory config = _nativeConfig();
        _addFast(NATIVE_CONFIG_ID, config);

        vm.expectRevert(
            abi.encodeWithSelector(ApprovedQuoteRegistry.QuoteConfigAlreadyExists.selector, NATIVE_CONFIG_ID)
        );
        vm.prank(FAST_ADMIN);
        registry.addQuoteConfig(NATIVE_CONFIG_ID, config);
        _assertConfig(NATIVE_CONFIG_ID, config, 1);
    }

    function test_pauseAndUnpauseUseExactStateAndOneDayDelay() public {
        QuoteAssetConfig memory config = _nativeConfig();
        _addFast(NATIVE_CONFIG_ID, config);
        vm.expectEmit(true, false, false, true);
        emit QuoteAssetStatusChanged(NATIVE_CONFIG_ID, 1, 2, REASON_HASH);
        vm.prank(GUARDIAN);
        registry.pauseQuote(NATIVE_CONFIG_ID, REASON_HASH);
        _assertConfig(NATIVE_CONFIG_ID, config, 2);

        bytes memory data = abi.encodeCall(IApprovedQuoteRegistry.unpauseQuote, (NATIVE_CONFIG_ID));
        uint48 readyAt = uint48(block.timestamp + UNPAUSE_DELAY);
        vm.prank(UNPAUSER);
        manager.schedule(address(registry), data, readyAt);
        vm.warp(readyAt - 1);
        vm.prank(UNPAUSER);
        vm.expectRevert();
        manager.execute(address(registry), data);

        vm.warp(readyAt);
        vm.expectEmit(true, false, false, true, address(registry));
        emit QuoteAssetStatusChanged(NATIVE_CONFIG_ID, 2, 1, bytes32(0));
        vm.prank(UNPAUSER);
        manager.execute(address(registry), data);
        _assertConfig(NATIVE_CONFIG_ID, config, 1);
    }

    function test_unpauseCannotBePreScheduledBeforePause() public {
        QuoteAssetConfig memory config = _nativeConfig();
        _addFast(NATIVE_CONFIG_ID, config);
        bytes memory data = abi.encodeCall(IApprovedQuoteRegistry.unpauseQuote, (NATIVE_CONFIG_ID));
        uint48 scheduledAt = uint48(block.timestamp + UNPAUSE_DELAY);
        vm.prank(UNPAUSER);
        manager.schedule(address(registry), data, scheduledAt);

        vm.warp(block.timestamp + 1);
        uint48 pausedAt = uint48(block.timestamp);
        vm.prank(GUARDIAN);
        registry.pauseQuote(NATIVE_CONFIG_ID, REASON_HASH);

        vm.warp(uint256(pausedAt) + UNPAUSE_DELAY - 1);
        vm.prank(UNPAUSER);
        vm.expectRevert();
        manager.execute(address(registry), data);

        vm.warp(uint256(pausedAt) + UNPAUSE_DELAY);
        vm.prank(UNPAUSER);
        manager.execute(address(registry), data);
        _assertConfig(NATIVE_CONFIG_ID, config, 1);
    }

    function test_invalidPauseAndUnpauseTransitionsFailClosed() public {
        vm.expectRevert(abi.encodeWithSelector(ApprovedQuoteRegistry.InvalidStateTransition.selector, 0, 2));
        vm.prank(GUARDIAN);
        registry.pauseQuote(NATIVE_CONFIG_ID, REASON_HASH);

        QuoteAssetConfig memory config = _nativeConfig();
        _addFast(NATIVE_CONFIG_ID, config);
        bytes memory data = abi.encodeCall(IApprovedQuoteRegistry.unpauseQuote, (NATIVE_CONFIG_ID));
        uint48 readyAt = uint48(block.timestamp + UNPAUSE_DELAY);
        vm.prank(UNPAUSER);
        manager.schedule(address(registry), data, readyAt);
        vm.warp(readyAt);
        vm.expectRevert(abi.encodeWithSelector(ApprovedQuoteRegistry.InvalidStateTransition.selector, 1, 1));
        vm.prank(UNPAUSER);
        manager.execute(address(registry), data);
    }

    function test_retireFromActiveUsesTwoDayDelayAndIsTerminal() public {
        QuoteAssetConfig memory config = _nativeConfig();
        _addFast(NATIVE_CONFIG_ID, config);
        bytes memory data = abi.encodeCall(IApprovedQuoteRegistry.retireQuote, (NATIVE_CONFIG_ID, REASON_HASH));
        uint48 readyAt = uint48(block.timestamp + ADMIN_DELAY);
        vm.prank(DELAYED_ADMIN);
        manager.schedule(address(registry), data, readyAt);
        vm.warp(readyAt - 1);
        vm.prank(DELAYED_ADMIN);
        vm.expectRevert();
        manager.execute(address(registry), data);

        vm.warp(readyAt);
        vm.expectEmit(true, false, false, true, address(registry));
        emit QuoteAssetStatusChanged(NATIVE_CONFIG_ID, 1, 3, REASON_HASH);
        vm.prank(DELAYED_ADMIN);
        manager.execute(address(registry), data);
        _assertConfig(NATIVE_CONFIG_ID, config, 3);

        vm.expectRevert(abi.encodeWithSelector(ApprovedQuoteRegistry.InvalidStateTransition.selector, 3, 2));
        vm.prank(GUARDIAN);
        registry.pauseQuote(NATIVE_CONFIG_ID, REASON_HASH);

        bytes memory unpauseData = abi.encodeCall(IApprovedQuoteRegistry.unpauseQuote, (NATIVE_CONFIG_ID));
        uint48 unpauseReadyAt = uint48(block.timestamp + UNPAUSE_DELAY);
        vm.prank(UNPAUSER);
        manager.schedule(address(registry), unpauseData, unpauseReadyAt);
        vm.warp(unpauseReadyAt);
        vm.expectRevert(abi.encodeWithSelector(ApprovedQuoteRegistry.InvalidStateTransition.selector, 3, 1));
        vm.prank(UNPAUSER);
        manager.execute(address(registry), unpauseData);
    }

    function test_retireFromPausedIsAllowedAndPreservesEconomics() public {
        QuoteAssetConfig memory config = _nativeConfig();
        _addFast(NATIVE_CONFIG_ID, config);
        vm.prank(GUARDIAN);
        registry.pauseQuote(NATIVE_CONFIG_ID, REASON_HASH);

        vm.expectEmit(true, false, false, true);
        emit QuoteAssetStatusChanged(NATIVE_CONFIG_ID, 2, 3, REASON_HASH);
        vm.prank(FAST_ADMIN);
        registry.retireQuote(NATIVE_CONFIG_ID, REASON_HASH);
        _assertConfig(NATIVE_CONFIG_ID, config, 3);
    }

    function _nativeConfig() private pure returns (QuoteAssetConfig memory) {
        return QuoteAssetConfig({
            tickerGardenBaselineId: BASELINE_ID,
            quoteAsset: address(0),
            quoteDecimals: 18,
            phantomQuote: 1_680_000_000_000_000_000,
            graduationThreshold: 4_200_000_000_000_000_000,
            economicsHash: NATIVE_CONFIG_ID,
            status: 1
        });
    }

    function _erc20Config(address quoteAsset, uint8 decimals, uint256 phantom, uint256 threshold)
        private
        view
        returns (QuoteAssetConfig memory config)
    {
        config = QuoteAssetConfig({
            tickerGardenBaselineId: BASELINE_ID,
            quoteAsset: quoteAsset,
            quoteDecimals: decimals,
            phantomQuote: phantom,
            graduationThreshold: threshold,
            economicsHash: bytes32(0),
            status: 1
        });
        config.economicsHash = _economicsHash(config);
    }

    function _economicsHash(QuoteAssetConfig memory config) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("TICKERGARDEN_V1_QUOTE_ECONOMICS"),
                uint256(1),
                block.chainid,
                config.tickerGardenBaselineId,
                config.quoteAsset,
                config.quoteDecimals,
                config.phantomQuote,
                config.graduationThreshold
            )
        );
    }

    function _stockBinding() private view returns (StockQuoteBinding memory binding) {
        AssetView memory asset = stockRegistry.asset(ASSET_UID);
        StockTokenFingerprint memory fingerprint = stockRegistry.assetFingerprint(ASSET_UID);
        binding = StockQuoteBinding({
            assetUid: ASSET_UID,
            stockTokenFingerprintHash: _fingerprintHash(ASSET_UID, asset, fingerprint),
            referenceEvidenceHash: REFERENCE_EVIDENCE_HASH,
            generatorPolicyId: GENERATOR_POLICY_ID
        });
    }

    function _stockConfig(StockQuoteBinding memory binding, uint256 phantom, uint256 threshold)
        private
        view
        returns (QuoteAssetConfig memory config)
    {
        config = QuoteAssetConfig({
            tickerGardenBaselineId: BASELINE_ID,
            quoteAsset: stockToken,
            quoteDecimals: 18,
            phantomQuote: phantom,
            graduationThreshold: threshold,
            economicsHash: bytes32(0),
            status: 1
        });
        config.economicsHash = _stockEconomicsHash(config, binding);
    }

    function _fingerprintHash(bytes32 assetUid, AssetView memory asset, StockTokenFingerprint memory fingerprint)
        private
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                keccak256("TICKERGARDEN_V1_STOCK_QUOTE_FINGERPRINT"),
                uint256(1),
                block.chainid,
                assetUid,
                asset.stockToken,
                asset.tokenDecimals,
                fingerprint.tokenRuntimeCodeHash,
                fingerprint.beacon,
                fingerprint.beaconRuntimeCodeHash,
                fingerprint.implementation,
                fingerprint.implementationRuntimeCodeHash
            )
        );
    }

    function _stockEconomicsHash(QuoteAssetConfig memory config, StockQuoteBinding memory binding)
        private
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                keccak256("TICKERGARDEN_V1_STOCK_QUOTE_ECONOMICS"),
                uint256(1),
                block.chainid,
                config.tickerGardenBaselineId,
                config.quoteAsset,
                config.quoteDecimals,
                config.phantomQuote,
                config.graduationThreshold,
                binding.assetUid,
                binding.stockTokenFingerprintHash,
                binding.referenceEvidenceHash,
                binding.generatorPolicyId
            )
        );
    }

    function _addFast(bytes32 configId, QuoteAssetConfig memory config) private {
        vm.prank(FAST_ADMIN);
        registry.addQuoteConfig(configId, config);
    }

    function _addStockFast(bytes32 configId, QuoteAssetConfig memory config, StockQuoteBinding memory binding) private {
        vm.prank(FAST_ADMIN);
        registry.addStockQuoteConfig(configId, config, binding);
    }

    function _expectInvalidConfig(bytes32 configId, QuoteAssetConfig memory config) private {
        vm.expectRevert(abi.encodeWithSelector(ApprovedQuoteRegistry.InvalidQuoteConfig.selector, configId));
        vm.prank(FAST_ADMIN);
        registry.addQuoteConfig(configId, config);
    }

    function _expectInvalidAsset(address asset, uint8 decimals) private {
        QuoteAssetConfig memory config = _erc20Config(asset, decimals, 1, 2);
        bytes32 configId = _economicsHash(config);
        config.economicsHash = configId;
        vm.expectRevert(abi.encodeWithSelector(ApprovedQuoteRegistry.InvalidQuoteAsset.selector, asset, decimals));
        vm.prank(FAST_ADMIN);
        registry.addQuoteConfig(configId, config);
    }

    function _expectUnauthorized(bytes4 selector) private {
        vm.expectRevert(
            abi.encodeWithSelector(ImmutableAccessManaged.AccessManagedUnauthorized.selector, address(this), selector)
        );
    }

    function _assertConfig(bytes32 configId, QuoteAssetConfig memory expected, uint8 status) private view {
        QuoteAssetConfig memory actual = registry.quoteConfig(configId);
        assertEq(actual.tickerGardenBaselineId, expected.tickerGardenBaselineId);
        assertEq(actual.quoteAsset, expected.quoteAsset);
        assertEq(actual.quoteDecimals, expected.quoteDecimals);
        assertEq(actual.phantomQuote, expected.phantomQuote);
        assertEq(actual.graduationThreshold, expected.graduationThreshold);
        assertEq(actual.economicsHash, expected.economicsHash);
        assertEq(actual.status, status);
    }
}
