// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {stdError} from "forge-std/StdError.sol";
import {
    AssetView,
    CanonicalRoute,
    IGraduationExecutor,
    ILaunchLocker,
    IMarketRegistryV2,
    LaunchTemplate,
    MarketConfig,
    MarketView,
    PonsBaseline,
    PoolKey,
    QuoteAssetConfig
} from "../../../src/v2/interfaces/IV2Protocol.sol";
import {MarketRegistryV2} from "../../../src/v2/modules/MarketRegistryV2.sol";

contract MockOfficialStockRegistry {
    mapping(bytes32 assetUid => AssetView value) private _assets;

    function setAsset(bytes32 assetUid, AssetView calldata value) external {
        _assets[assetUid] = value;
    }

    function asset(bytes32 assetUid) external view returns (AssetView memory) {
        return _assets[assetUid];
    }
}

contract MockApprovedQuoteRegistry {
    mapping(bytes32 configId => QuoteAssetConfig value) private _quotes;

    function setQuote(bytes32 configId, QuoteAssetConfig calldata value) external {
        _quotes[configId] = value;
    }

    function quoteConfig(bytes32 configId) external view returns (QuoteAssetConfig memory) {
        return _quotes[configId];
    }
}

contract MockPonsBaselineRegistry {
    mapping(bytes32 baselineId => PonsBaseline value) private _baselines;

    function setBaseline(bytes32 baselineId, PonsBaseline calldata value) external {
        _baselines[baselineId] = value;
    }

    function baseline(bytes32 baselineId) external view returns (PonsBaseline memory) {
        return _baselines[baselineId];
    }
}

contract MockLaunchTemplateRegistry {
    mapping(bytes32 templateId => LaunchTemplate value) private _templates;

    function setTemplate(bytes32 templateId, LaunchTemplate calldata value) external {
        _templates[templateId] = value;
    }

    function launchTemplate(bytes32 templateId) external view returns (LaunchTemplate memory) {
        return _templates[templateId];
    }
}

contract MarketRegistryV2Test is Test {
    bytes32 internal constant MARKET_ID = keccak256("market-1");
    bytes32 internal constant OTHER_MARKET_ID = keccak256("market-2");
    bytes32 internal constant ASSET_UID = keccak256("asset");
    bytes32 internal constant BASELINE_ID = keccak256("baseline");
    bytes32 internal constant QUOTE_CONFIG_ID = keccak256("quote");
    bytes32 internal constant TEMPLATE_ID = keccak256("template");
    bytes32 internal constant FEE_POLICY_ID = keccak256("fee-policy");
    bytes32 internal constant ECONOMICS = keccak256("economics");
    uint256 internal constant LAUNCH_CONFIG_ID = 0;
    int24 internal constant TICK_SPACING = 200;

    address internal constant FACTORY = address(0xFAC7);
    address internal constant GRADUATION = address(0x1004);
    address internal constant CONTROLLER = address(0xC017);
    address internal constant BENEFICIARY = address(0xBEEF);
    address internal constant MEME_TOKEN = address(0xA000);
    address internal constant CURVE = address(0xC000);
    address internal constant GAUGE = address(0x6000);
    address internal constant QUOTE_ASSET = address(0x1000);
    address internal constant HOOK = address(uint160(0x1_0000 | 0x2044));
    address internal constant SWAP_ROUTER = address(0x5100);
    address internal constant QUOTER = address(0x5200);
    address internal constant LAUNCH_LOCKER = address(0x5300);

    MockOfficialStockRegistry internal assets;
    MockApprovedQuoteRegistry internal quotes;
    MockPonsBaselineRegistry internal baselines;
    MockLaunchTemplateRegistry internal templates;
    MarketRegistryV2 internal registry;

    event MarketRegistered(
        bytes32 indexed marketId,
        bytes32 indexed assetUid,
        address indexed memeToken,
        address curve,
        address gauge,
        uint32 sourceVersion
    );
    event LaunchPhaseChanged(
        bytes32 indexed marketId, uint8 oldPhase, uint8 newPhase, uint64 sweptAt, bytes32 poolId, uint32 sourceVersion
    );
    event MarketStatusChanged(
        bytes32 indexed marketId,
        uint8 oldStatus,
        uint8 newStatus,
        uint64 statusSince,
        uint64 restrictedSince,
        bytes32 reasonHash
    );
    event EmergencyStateCommitted(
        bytes32 indexed marketId,
        uint32 indexed recoveryEpoch,
        uint32 sourceVersion,
        uint64 snapshotBlock,
        bytes32 stateHash
    );

    function setUp() public {
        assets = new MockOfficialStockRegistry();
        quotes = new MockApprovedQuoteRegistry();
        baselines = new MockPonsBaselineRegistry();
        templates = new MockLaunchTemplateRegistry();
        assets.setAsset(ASSET_UID, _asset());
        quotes.setQuote(QUOTE_CONFIG_ID, _quote(QUOTE_ASSET));
        baselines.setBaseline(BASELINE_ID, _baseline());
        templates.setTemplate(TEMPLATE_ID, _template());
        vm.etch(SWAP_ROUTER, hex"00");
        vm.etch(QUOTER, hex"00");
        registry = new MarketRegistryV2(
            FACTORY,
            address(assets),
            address(quotes),
            address(baselines),
            address(templates),
            GRADUATION,
            CONTROLLER,
            SWAP_ROUTER,
            QUOTER
        );
    }

    function test_registersCanonicalConfigRuntimeAndTokenLookup() public {
        vm.warp(1_789_000_000);
        MarketConfig memory config = _config(QUOTE_ASSET, MEME_TOKEN);

        vm.expectEmit(true, true, true, true);
        emit MarketRegistered(MARKET_ID, ASSET_UID, MEME_TOKEN, CURVE, GAUGE, 1);
        vm.prank(FACTORY);
        registry.registerMarket(MARKET_ID, config);

        MarketView memory stored = registry.market(MARKET_ID);
        assertEq(keccak256(abi.encode(stored.config)), keccak256(abi.encode(config)));
        assertEq(stored.runtime.poolId, bytes32(0));
        assertEq(stored.runtime.sourceVersion, 1);
        assertEq(stored.runtime.recoveryEpoch, 0);
        assertEq(stored.runtime.sweptAt, 0);
        assertEq(stored.runtime.statusSince, 1_789_000_000);
        assertEq(stored.runtime.restrictedSince, 0);
        assertEq(stored.runtime.launchPhase, 0);
        assertEq(stored.runtime.marketStatus, 0);
        assertEq(registry.marketIdByToken(MEME_TOKEN), MARKET_ID);

        (address source, uint32 version) = registry.activeFeeSource(MARKET_ID);
        assertEq(source, CURVE);
        assertEq(version, 1);
    }

    function test_registrationAndDiscoverySelectorsMatchCanonicalInterface() public pure {
        assertEq(MarketRegistryV2.registerMarket.selector, IMarketRegistryV2.registerMarket.selector);
        assertEq(MarketRegistryV2.market.selector, IMarketRegistryV2.market.selector);
        assertEq(MarketRegistryV2.marketIdByToken.selector, IMarketRegistryV2.marketIdByToken.selector);
        assertEq(MarketRegistryV2.canonicalPoolKey.selector, IMarketRegistryV2.canonicalPoolKey.selector);
        assertEq(MarketRegistryV2.canonicalPoolId.selector, IMarketRegistryV2.canonicalPoolId.selector);
        assertEq(MarketRegistryV2.canonicalRoute.selector, IMarketRegistryV2.canonicalRoute.selector);
        assertEq(MarketRegistryV2.activeFeeSource.selector, IMarketRegistryV2.activeFeeSource.selector);
        assertEq(MarketRegistryV2.markSwept.selector, IMarketRegistryV2.markSwept.selector);
        assertEq(MarketRegistryV2.commitPoolCreated.selector, IMarketRegistryV2.commitPoolCreated.selector);
        assertEq(MarketRegistryV2.markRescued.selector, IMarketRegistryV2.markRescued.selector);
        assertEq(MarketRegistryV2.setMarketPaused.selector, IMarketRegistryV2.setMarketPaused.selector);
        assertEq(MarketRegistryV2.setMarketActive.selector, IMarketRegistryV2.setMarketActive.selector);
        assertEq(MarketRegistryV2.setMarketRetired.selector, IMarketRegistryV2.setMarketRetired.selector);
        assertEq(MarketRegistryV2.commitEmergencyExit.selector, IMarketRegistryV2.commitEmergencyExit.selector);
    }

    function test_constructorRejectsNonContractAndAliasedRoutingDependencies() public {
        address noCodeQuoter = address(0xDEAD);
        vm.expectRevert(
            abi.encodeWithSelector(MarketRegistryV2.InvalidRoutingDependencies.selector, SWAP_ROUTER, noCodeQuoter)
        );
        new MarketRegistryV2(
            FACTORY,
            address(assets),
            address(quotes),
            address(baselines),
            address(templates),
            GRADUATION,
            CONTROLLER,
            SWAP_ROUTER,
            noCodeQuoter
        );

        vm.expectRevert(
            abi.encodeWithSelector(MarketRegistryV2.InvalidRoutingDependencies.selector, SWAP_ROUTER, SWAP_ROUTER)
        );
        new MarketRegistryV2(
            FACTORY,
            address(assets),
            address(quotes),
            address(baselines),
            address(templates),
            GRADUATION,
            CONTROLLER,
            SWAP_ROUTER,
            SWAP_ROUTER
        );
    }

    function test_canonicalRouteReturnsEveryFrozenAddressAndContractDerivedTradingState() public {
        _register(MARKET_ID, _config(QUOTE_ASSET, MEME_TOKEN));
        _mockLaunchLockerRoute(MARKET_ID, false);

        CanonicalRoute memory route = registry.canonicalRoute(MARKET_ID);
        PoolKey memory expectedKey = registry.canonicalPoolKey(MARKET_ID);
        assertEq(keccak256(abi.encode(route.poolKey)), keccak256(abi.encode(expectedKey)));
        assertEq(route.poolId, registry.canonicalPoolId(MARKET_ID));
        assertEq(route.swapRouter, SWAP_ROUTER);
        assertEq(route.quoter, QUOTER);
        assertEq(route.hook, HOOK);
        assertEq(route.quoteAsset, QUOTE_ASSET);
        assertEq(route.memeToken, MEME_TOKEN);
        assertEq(route.gauge, GAUGE);
        assertEq(route.curve, CURVE);
        assertEq(route.launchLocker, LAUNCH_LOCKER);
        assertEq(route.sourceVersion, 1);
        assertEq(route.launchPhase, 0);
        assertEq(route.marketStatus, 0);
        assertTrue(route.curveTradingEnabled);
        assertFalse(route.poolTradingEnabled);

        _sweep(MARKET_ID);
        route = registry.canonicalRoute(MARKET_ID);
        assertEq(route.launchPhase, 1);
        assertFalse(route.curveTradingEnabled);
        assertFalse(route.poolTradingEnabled);
    }

    function test_poolRouteRequiresAndAttestsTheCanonicalDeployedLocker() public {
        _register(MARKET_ID, _config(QUOTE_ASSET, MEME_TOKEN));
        _mockLaunchLockerRoute(MARKET_ID, false);
        _sweep(MARKET_ID);
        bytes32 poolId = registry.canonicalPoolId(MARKET_ID);
        vm.prank(GRADUATION);
        registry.commitPoolCreated(MARKET_ID, poolId);

        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.InvalidCanonicalRoute.selector, MARKET_ID));
        registry.canonicalRoute(MARKET_ID);

        _mockLaunchLockerRoute(MARKET_ID, true);
        CanonicalRoute memory route = registry.canonicalRoute(MARKET_ID);
        assertEq(route.poolId, poolId);
        assertEq(route.sourceVersion, 2);
        assertEq(route.launchPhase, 2);
        assertTrue(route.poolTradingEnabled);
        assertFalse(route.curveTradingEnabled);

        _pause(MARKET_ID, keccak256("route-pause"));
        route = registry.canonicalRoute(MARKET_ID);
        assertEq(route.marketStatus, 1);
        assertFalse(route.poolTradingEnabled);

        vm.prank(CONTROLLER);
        registry.setMarketActive(MARKET_ID);
        assertTrue(registry.canonicalRoute(MARKET_ID).poolTradingEnabled);

        vm.prank(CONTROLLER);
        registry.setMarketRetired(MARKET_ID, keccak256("route-retire"));
        route = registry.canonicalRoute(MARKET_ID);
        assertEq(route.marketStatus, 2);
        assertFalse(route.poolTradingEnabled);
    }

    function test_canonicalRouteFailsClosedOnMissingPredictionAndInvalidLockerIdentity() public {
        _register(MARKET_ID, _config(QUOTE_ASSET, MEME_TOKEN));
        vm.mockCall(
            GRADUATION, abi.encodeCall(IGraduationExecutor.predictLaunchLocker, (MARKET_ID)), abi.encode(address(0))
        );
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.InvalidCanonicalRoute.selector, MARKET_ID));
        registry.canonicalRoute(MARKET_ID);

        _mockLaunchLockerRoute(MARKET_ID, false);
        _sweep(MARKET_ID);
        bytes32 poolId = registry.canonicalPoolId(MARKET_ID);
        vm.prank(GRADUATION);
        registry.commitPoolCreated(MARKET_ID, poolId);
        vm.etch(LAUNCH_LOCKER, hex"00");
        vm.mockCall(LAUNCH_LOCKER, abi.encodeCall(ILaunchLocker.marketId, ()), abi.encode(OTHER_MARKET_ID));
        vm.mockCall(LAUNCH_LOCKER, abi.encodeCall(ILaunchLocker.lockedPosition, ()), abi.encode(uint256(1), poolId));
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.InvalidCanonicalRoute.selector, MARKET_ID));
        registry.canonicalRoute(MARKET_ID);
    }

    function test_markSweptIsCurveOnlyActiveAndWriteOnce() public {
        vm.warp(1_000);
        _register(MARKET_ID, _config(QUOTE_ASSET, MEME_TOKEN));

        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.UnauthorizedMarketCurve.selector, address(this), CURVE));
        registry.markSwept(MARKET_ID);

        vm.warp(2_000);
        vm.expectEmit(true, false, false, true);
        emit LaunchPhaseChanged(MARKET_ID, 0, 1, 2_000, bytes32(0), 1);
        vm.prank(CURVE);
        registry.markSwept(MARKET_ID);

        MarketView memory stored = registry.market(MARKET_ID);
        assertEq(stored.runtime.launchPhase, 1);
        assertEq(stored.runtime.sweptAt, 2_000);
        (address source, uint32 version) = registry.activeFeeSource(MARKET_ID);
        assertEq(source, address(0));
        assertEq(version, 0);

        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.InvalidStateTransition.selector, 1, 1));
        vm.prank(CURVE);
        registry.markSwept(MARKET_ID);
    }

    function test_pausedMarketCannotBeSwept() public {
        _register(MARKET_ID, _config(QUOTE_ASSET, MEME_TOKEN));
        _pause(MARKET_ID, keccak256("pause"));
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.InactiveFeeSource.selector, MARKET_ID, 1));
        vm.prank(CURVE);
        registry.markSwept(MARKET_ID);
    }

    function test_commitPoolCreatedUsesCanonicalPoolAndIncrementsSourceVersion() public {
        vm.warp(1_000);
        _register(MARKET_ID, _config(QUOTE_ASSET, MEME_TOKEN));
        bytes32 poolId = registry.canonicalPoolId(MARKET_ID);
        _sweep(MARKET_ID);

        vm.expectEmit(true, false, false, true);
        emit LaunchPhaseChanged(MARKET_ID, 1, 2, 1_000, poolId, 2);
        vm.prank(GRADUATION);
        uint32 sourceVersion = registry.commitPoolCreated(MARKET_ID, poolId);
        assertEq(sourceVersion, 2);

        MarketView memory stored = registry.market(MARKET_ID);
        assertEq(stored.runtime.launchPhase, 2);
        assertEq(stored.runtime.poolId, poolId);
        assertEq(stored.runtime.sourceVersion, 2);
        (address source, uint32 version) = registry.activeFeeSource(MARKET_ID);
        assertEq(source, HOOK);
        assertEq(version, 2);

        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.InvalidStateTransition.selector, 2, 2));
        vm.prank(GRADUATION);
        registry.commitPoolCreated(MARKET_ID, poolId);
    }

    function test_commitPoolCreatedRejectsWrongPoolAndPausedStatus() public {
        _register(MARKET_ID, _config(QUOTE_ASSET, MEME_TOKEN));
        _sweep(MARKET_ID);
        bytes32 wrongPool = keccak256("wrong-pool");
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.PoolNotExpected.selector, wrongPool));
        vm.prank(GRADUATION);
        registry.commitPoolCreated(MARKET_ID, wrongPool);

        _pause(MARKET_ID, keccak256("pause"));
        bytes32 canonicalPool = registry.canonicalPoolId(MARKET_ID);
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.InactiveFeeSource.selector, MARKET_ID, 1));
        vm.prank(GRADUATION);
        registry.commitPoolCreated(MARKET_ID, canonicalPool);
    }

    function test_rescueUsesInclusiveSevenDayBoundaryAndIsTerminal() public {
        vm.warp(1_000);
        _register(MARKET_ID, _config(QUOTE_ASSET, MEME_TOKEN));
        _mockLaunchLockerRoute(MARKET_ID, false);
        _sweep(MARKET_ID);

        vm.warp(1_000 + 7 days - 1);
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.EmergencyExitNotReady.selector, 1_000 + 7 days));
        vm.prank(GRADUATION);
        registry.markRescued(MARKET_ID);

        vm.warp(1_000 + 7 days);
        vm.expectEmit(true, false, false, true);
        emit LaunchPhaseChanged(MARKET_ID, 1, 3, 1_000, bytes32(0), 1);
        vm.prank(GRADUATION);
        registry.markRescued(MARKET_ID);
        assertEq(registry.market(MARKET_ID).runtime.launchPhase, 3);

        (address source, uint32 version) = registry.activeFeeSource(MARKET_ID);
        assertEq(source, address(0));
        assertEq(version, 0);
        CanonicalRoute memory route = registry.canonicalRoute(MARKET_ID);
        assertEq(route.launchPhase, 3);
        assertFalse(route.curveTradingEnabled);
        assertFalse(route.poolTradingEnabled);
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.GraduationNotRetryable.selector, MARKET_ID, 3, 0));
        vm.prank(GRADUATION);
        registry.markRescued(MARKET_ID);
    }

    function test_rescueCanCompleteWhileMarketRemainsPaused() public {
        vm.warp(1_000);
        _register(MARKET_ID, _config(QUOTE_ASSET, MEME_TOKEN));
        _sweep(MARKET_ID);
        _pause(MARKET_ID, keccak256("pause"));
        vm.warp(1_000 + 7 days);
        vm.prank(GRADUATION);
        registry.markRescued(MARKET_ID);
        MarketView memory stored = registry.market(MARKET_ID);
        assertEq(stored.runtime.launchPhase, 3);
        assertEq(stored.runtime.marketStatus, 1);
    }

    function test_pauseAndReactivateUpdateTimestampsAndPreserveSourceIdentity() public {
        vm.warp(1_000);
        _register(MARKET_ID, _config(QUOTE_ASSET, MEME_TOKEN));
        bytes32 reasonHash = keccak256("pause");
        vm.warp(2_000);
        vm.expectEmit(true, false, false, true);
        emit MarketStatusChanged(MARKET_ID, 0, 1, 2_000, 2_000, reasonHash);
        _pause(MARKET_ID, reasonHash);

        MarketView memory stored = registry.market(MARKET_ID);
        assertEq(stored.runtime.marketStatus, 1);
        assertEq(stored.runtime.statusSince, 2_000);
        assertEq(stored.runtime.restrictedSince, 2_000);
        (address source, uint32 version) = registry.activeFeeSource(MARKET_ID);
        assertEq(source, CURVE);
        assertEq(version, 1);

        vm.warp(3_000);
        vm.expectEmit(true, false, false, true);
        emit MarketStatusChanged(MARKET_ID, 1, 0, 3_000, 0, bytes32(0));
        vm.prank(CONTROLLER);
        registry.setMarketActive(MARKET_ID);
        stored = registry.market(MARKET_ID);
        assertEq(stored.runtime.marketStatus, 0);
        assertEq(stored.runtime.statusSince, 3_000);
        assertEq(stored.runtime.restrictedSince, 0);
    }

    function test_retirePostSweepFromActiveSetsRestrictionAndFromPausedPreservesIt() public {
        vm.warp(1_000);
        _register(MARKET_ID, _config(QUOTE_ASSET, MEME_TOKEN));
        _sweep(MARKET_ID);
        bytes32 reasonHash = keccak256("retire");
        vm.warp(2_000);
        vm.expectEmit(true, false, false, true);
        emit MarketStatusChanged(MARKET_ID, 0, 2, 2_000, 2_000, reasonHash);
        vm.prank(CONTROLLER);
        registry.setMarketRetired(MARKET_ID, reasonHash);
        assertEq(registry.market(MARKET_ID).runtime.restrictedSince, 2_000);
        (address source, uint32 version) = registry.activeFeeSource(MARKET_ID);
        assertEq(source, address(0));
        assertEq(version, 0);

        _register(OTHER_MARKET_ID, _config(QUOTE_ASSET, address(0xB000)));
        _sweep(OTHER_MARKET_ID);
        vm.warp(3_000);
        _pause(OTHER_MARKET_ID, keccak256("pause"));
        vm.warp(4_000);
        vm.expectEmit(true, false, false, true);
        emit MarketStatusChanged(OTHER_MARKET_ID, 1, 2, 4_000, 3_000, reasonHash);
        vm.prank(CONTROLLER);
        registry.setMarketRetired(OTHER_MARKET_ID, reasonHash);
        assertEq(registry.market(OTHER_MARKET_ID).runtime.restrictedSince, 3_000);
    }

    function test_notGraduatedTerminalTransitionsRevertAndPauseRemainsRecoverable() public {
        vm.warp(1_000);
        _register(MARKET_ID, _config(QUOTE_ASSET, MEME_TOKEN));
        _mockLaunchLockerRoute(MARKET_ID, false);

        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.PreGraduationTerminalStateForbidden.selector, uint8(2)));
        vm.prank(CONTROLLER);
        registry.setMarketRetired(MARKET_ID, keccak256("retire"));

        _pause(MARKET_ID, keccak256("pause"));
        vm.warp(1_000 + 1 days);
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.PreGraduationTerminalStateForbidden.selector, uint8(2)));
        vm.prank(CONTROLLER);
        registry.setMarketRetired(MARKET_ID, keccak256("retire"));
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.PreGraduationTerminalStateForbidden.selector, uint8(3)));
        vm.prank(CONTROLLER);
        registry.commitEmergencyExit(MARKET_ID, 77, keccak256("state"));

        vm.prank(CONTROLLER);
        registry.setMarketActive(MARKET_ID);
        MarketView memory stored = registry.market(MARKET_ID);
        assertEq(stored.runtime.launchPhase, 0);
        assertEq(stored.runtime.marketStatus, 0);
        assertEq(stored.runtime.restrictedSince, 0);
        assertTrue(registry.canonicalRoute(MARKET_ID).curveTradingEnabled);
    }

    function test_emergencyExitUsesInclusiveDayBoundaryAndInvalidatesSource() public {
        vm.warp(1_000);
        _register(MARKET_ID, _config(QUOTE_ASSET, MEME_TOKEN));
        _mockLaunchLockerRoute(MARKET_ID, false);
        _sweep(MARKET_ID);
        _pause(MARKET_ID, keccak256("pause"));

        vm.warp(1_000 + 1 days - 1);
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.EmergencyExitNotReady.selector, 1_000 + 1 days));
        vm.prank(CONTROLLER);
        registry.commitEmergencyExit(MARKET_ID, 77, keccak256("state"));

        vm.warp(1_000 + 1 days);
        bytes32 stateHash = keccak256("state");
        vm.expectEmit(true, true, false, true);
        emit EmergencyStateCommitted(MARKET_ID, 1, 2, 77, stateHash);
        vm.prank(CONTROLLER);
        uint32 epoch = registry.commitEmergencyExit(MARKET_ID, 77, stateHash);
        assertEq(epoch, 1);

        MarketView memory stored = registry.market(MARKET_ID);
        assertEq(stored.runtime.marketStatus, 3);
        assertEq(stored.runtime.statusSince, 1_000 + 1 days);
        assertEq(stored.runtime.restrictedSince, 1_000);
        assertEq(stored.runtime.sourceVersion, 2);
        assertEq(stored.runtime.recoveryEpoch, 1);
        (address source, uint32 version) = registry.activeFeeSource(MARKET_ID);
        assertEq(source, address(0));
        assertEq(version, 0);
        CanonicalRoute memory route = registry.canonicalRoute(MARKET_ID);
        assertEq(route.marketStatus, 3);
        assertEq(route.sourceVersion, 2);
        assertFalse(route.curveTradingEnabled);
        assertFalse(route.poolTradingEnabled);
    }

    function test_retiredMarketCanEnterEmergencyAtInclusiveDayBoundary() public {
        vm.warp(1_000);
        _register(MARKET_ID, _config(QUOTE_ASSET, MEME_TOKEN));
        _sweep(MARKET_ID);
        vm.prank(CONTROLLER);
        registry.setMarketRetired(MARKET_ID, keccak256("retire"));
        vm.warp(1_000 + 1 days);
        vm.prank(CONTROLLER);
        uint32 epoch = registry.commitEmergencyExit(MARKET_ID, 88, keccak256("retired-state"));
        MarketView memory stored = registry.market(MARKET_ID);
        assertEq(epoch, 1);
        assertEq(stored.runtime.marketStatus, 3);
        assertEq(stored.runtime.restrictedSince, 1_000);
    }

    function test_unlistedStatusEdgesAndEmergencyTerminalStateRevert() public {
        _register(MARKET_ID, _config(QUOTE_ASSET, MEME_TOKEN));
        _sweep(MARKET_ID);
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.InvalidStateTransition.selector, 0, 0));
        vm.prank(CONTROLLER);
        registry.setMarketActive(MARKET_ID);

        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.InvalidStateTransition.selector, 0, 3));
        vm.prank(CONTROLLER);
        registry.commitEmergencyExit(MARKET_ID, 0, bytes32(0));

        _pause(MARKET_ID, bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.InvalidStateTransition.selector, 1, 1));
        vm.prank(CONTROLLER);
        registry.setMarketPaused(MARKET_ID, bytes32(0));

        vm.warp(block.timestamp + 1 days);
        vm.prank(CONTROLLER);
        registry.commitEmergencyExit(MARKET_ID, 0, bytes32(0));

        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.InvalidStateTransition.selector, 3, 0));
        vm.prank(CONTROLLER);
        registry.setMarketActive(MARKET_ID);
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.InvalidStateTransition.selector, 3, 2));
        vm.prank(CONTROLLER);
        registry.setMarketRetired(MARKET_ID, bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.InvalidStateTransition.selector, 3, 3));
        vm.prank(CONTROLLER);
        registry.commitEmergencyExit(MARKET_ID, 0, bytes32(0));
    }

    function test_sourceAndRecoveryEpochCheckedIncrementsCannotWrap() public {
        vm.warp(1_000);
        _register(MARKET_ID, _config(QUOTE_ASSET, MEME_TOKEN));
        bytes32 poolId = registry.canonicalPoolId(MARKET_ID);
        _sweep(MARKET_ID);
        _setPackedRuntimeCounter(MARKET_ID, true, type(uint32).max);
        assertEq(registry.market(MARKET_ID).runtime.sourceVersion, type(uint32).max);
        vm.expectRevert(stdError.arithmeticError);
        vm.prank(GRADUATION);
        registry.commitPoolCreated(MARKET_ID, poolId);
        assertEq(registry.market(MARKET_ID).runtime.launchPhase, 1);

        address secondToken = address(0xB000);
        _register(OTHER_MARKET_ID, _config(QUOTE_ASSET, secondToken));
        _sweep(OTHER_MARKET_ID);
        _pause(OTHER_MARKET_ID, bytes32(0));
        _setPackedRuntimeCounter(OTHER_MARKET_ID, false, type(uint32).max);
        vm.warp(1_000 + 1 days);
        vm.expectRevert(stdError.arithmeticError);
        vm.prank(CONTROLLER);
        registry.commitEmergencyExit(OTHER_MARKET_ID, 0, bytes32(0));
        MarketView memory stored = registry.market(OTHER_MARKET_ID);
        assertEq(stored.runtime.marketStatus, 1);
        assertEq(stored.runtime.sourceVersion, 1);
        assertEq(stored.runtime.recoveryEpoch, type(uint32).max);
    }

    function test_allTransitionCallersAreImmutableModules() public {
        _register(MARKET_ID, _config(QUOTE_ASSET, MEME_TOKEN));
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.UnauthorizedModule.selector, address(this), GRADUATION));
        registry.commitPoolCreated(MARKET_ID, bytes32(uint256(1)));
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.UnauthorizedModule.selector, address(this), GRADUATION));
        registry.markRescued(MARKET_ID);
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.UnauthorizedModule.selector, address(this), CONTROLLER));
        registry.setMarketPaused(MARKET_ID, bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.UnauthorizedModule.selector, address(this), CONTROLLER));
        registry.setMarketActive(MARKET_ID);
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.UnauthorizedModule.selector, address(this), CONTROLLER));
        registry.setMarketRetired(MARKET_ID, bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.UnauthorizedModule.selector, address(this), CONTROLLER));
        registry.commitEmergencyExit(MARKET_ID, 0, bytes32(0));
    }

    function test_timeAdditionOverflowsFailClosed() public {
        vm.warp(uint256(type(uint64).max) - 1);
        _register(MARKET_ID, _config(QUOTE_ASSET, MEME_TOKEN));
        _sweep(MARKET_ID);
        vm.expectRevert(
            abi.encodeWithSelector(
                MarketRegistryV2.BlockTimestampOverflow.selector, uint256(type(uint64).max) - 1 + 7 days
            )
        );
        vm.prank(GRADUATION);
        registry.markRescued(MARKET_ID);

        _register(OTHER_MARKET_ID, _config(QUOTE_ASSET, address(0xB000)));
        _sweep(OTHER_MARKET_ID);
        _pause(OTHER_MARKET_ID, bytes32(0));
        vm.expectRevert(
            abi.encodeWithSelector(
                MarketRegistryV2.BlockTimestampOverflow.selector, uint256(type(uint64).max) - 1 + 1 days
            )
        );
        vm.prank(CONTROLLER);
        registry.commitEmergencyExit(OTHER_MARKET_ID, 0, bytes32(0));
    }

    function test_canonicalPoolDiscoverySortsCurrenciesAndHashesAllFiveFields() public {
        _register(MARKET_ID, _config(QUOTE_ASSET, MEME_TOKEN));
        PoolKey memory key = registry.canonicalPoolKey(MARKET_ID);
        assertEq(key.currency0, QUOTE_ASSET);
        assertEq(key.currency1, MEME_TOKEN);
        assertEq(key.fee, 0);
        assertEq(key.tickSpacing, TICK_SPACING);
        assertEq(key.hooks, HOOK);
        assertEq(registry.canonicalPoolId(MARKET_ID), keccak256(abi.encode(key)));
        assertEq(registry.market(MARKET_ID).runtime.poolId, bytes32(0));
    }

    function test_nativeQuoteIsCanonicalCurrencyZero() public {
        quotes.setQuote(QUOTE_CONFIG_ID, _quote(address(0)));
        _register(MARKET_ID, _config(address(0), MEME_TOKEN));
        PoolKey memory key = registry.canonicalPoolKey(MARKET_ID);
        assertEq(key.currency0, address(0));
        assertEq(key.currency1, MEME_TOKEN);
    }

    function test_canonicalPoolDiscoverySortsMemeBeforeHigherQuoteAddress() public {
        address highQuote = address(0xF000);
        quotes.setQuote(QUOTE_CONFIG_ID, _quote(highQuote));
        _register(MARKET_ID, _config(highQuote, MEME_TOKEN));
        PoolKey memory key = registry.canonicalPoolKey(MARKET_ID);
        assertEq(key.currency0, MEME_TOKEN);
        assertEq(key.currency1, highQuote);
    }

    function test_onlyFactoryCanRegister() public {
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.UnauthorizedFactory.selector, address(this)));
        registry.registerMarket(MARKET_ID, _config(QUOTE_ASSET, MEME_TOKEN));
    }

    function test_marketIdAndMemeTokenAreBothWriteOnce() public {
        _register(MARKET_ID, _config(QUOTE_ASSET, MEME_TOKEN));

        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.MarketAlreadyRegistered.selector, MARKET_ID));
        _register(MARKET_ID, _config(QUOTE_ASSET, address(0xB000)));

        vm.expectRevert(
            abi.encodeWithSelector(MarketRegistryV2.MemeTokenAlreadyRegistered.selector, MEME_TOKEN, MARKET_ID)
        );
        _register(OTHER_MARKET_ID, _config(QUOTE_ASSET, MEME_TOKEN));
    }

    function test_sameAssetUidCanBackMultipleMarkets() public {
        _register(MARKET_ID, _config(QUOTE_ASSET, MEME_TOKEN));
        address secondToken = address(0xB000);
        _register(OTHER_MARKET_ID, _config(QUOTE_ASSET, secondToken));
        assertEq(registry.market(MARKET_ID).config.assetUid, ASSET_UID);
        assertEq(registry.market(OTHER_MARKET_ID).config.assetUid, ASSET_UID);
        assertEq(registry.marketIdByToken(secondToken), OTHER_MARKET_ID);
    }

    function test_unknownMarketViewsFailClosed() public {
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.MarketNotRegistered.selector, MARKET_ID));
        registry.market(MARKET_ID);
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.MarketNotRegistered.selector, MARKET_ID));
        registry.canonicalPoolKey(MARKET_ID);
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.MarketNotRegistered.selector, MARKET_ID));
        registry.canonicalPoolId(MARKET_ID);
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.MarketNotRegistered.selector, MARKET_ID));
        registry.canonicalRoute(MARKET_ID);
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.MarketNotRegistered.selector, MARKET_ID));
        registry.activeFeeSource(MARKET_ID);
    }

    function test_rejectsWrongExecutionSpecControllerOrHookMask() public {
        MarketConfig memory config = _config(QUOTE_ASSET, MEME_TOKEN);
        config.executionSpecId = bytes32(uint256(1));
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.InvalidExecutionSpecId.selector, bytes32(uint256(1))));
        _register(MARKET_ID, config);

        config = _config(QUOTE_ASSET, MEME_TOKEN);
        config.marketController = address(0xBAD);
        vm.expectRevert(MarketRegistryV2.InvalidMarketConfig.selector);
        _register(MARKET_ID, config);

        config = _config(QUOTE_ASSET, MEME_TOKEN);
        config.graduatedHook = address(0x1234);
        vm.expectRevert(MarketRegistryV2.InvalidCanonicalPoolKey.selector);
        _register(MARKET_ID, config);
    }

    function test_rejectsInactiveOrIncompatiblePonsBaseline() public {
        PonsBaseline memory value = _baseline();
        value.status = 2;
        baselines.setBaseline(BASELINE_ID, value);
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.InvalidPonsBaseline.selector, BASELINE_ID));
        _register(MARKET_ID, _config(QUOTE_ASSET, MEME_TOKEN));

        value = _baseline();
        value.poolFee = 1;
        baselines.setBaseline(BASELINE_ID, value);
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.InvalidPonsBaseline.selector, BASELINE_ID));
        _register(MARKET_ID, _config(QUOTE_ASSET, MEME_TOKEN));

        value = _baseline();
        value.tickSpacing = 0;
        baselines.setBaseline(BASELINE_ID, value);
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.InvalidPonsBaseline.selector, BASELINE_ID));
        _register(MARKET_ID, _config(QUOTE_ASSET, MEME_TOKEN));
    }

    function test_rejectsInactiveOrMismatchedAssetQuoteAndTemplateSnapshots() public {
        AssetView memory assetValue = _asset();
        assetValue.tokenDecimals = 5;
        assets.setAsset(ASSET_UID, assetValue);
        MarketConfig memory config = _config(QUOTE_ASSET, MEME_TOKEN);
        vm.expectRevert(MarketRegistryV2.InvalidMarketConfig.selector);
        _register(MARKET_ID, config);

        assetValue.tokenDecimals = 19;
        assets.setAsset(ASSET_UID, assetValue);
        vm.expectRevert(MarketRegistryV2.InvalidMarketConfig.selector);
        _register(MARKET_ID, config);
        assets.setAsset(ASSET_UID, _asset());

        assetValue = _asset();
        assetValue.status = 2;
        assets.setAsset(ASSET_UID, assetValue);
        vm.expectRevert(MarketRegistryV2.InvalidMarketConfig.selector);
        _register(MARKET_ID, _config(QUOTE_ASSET, MEME_TOKEN));
        assets.setAsset(ASSET_UID, _asset());

        QuoteAssetConfig memory quoteValue = _quote(QUOTE_ASSET);
        quoteValue.status = 2;
        quotes.setQuote(QUOTE_CONFIG_ID, quoteValue);
        vm.expectRevert(MarketRegistryV2.InvalidMarketConfig.selector);
        _register(MARKET_ID, _config(QUOTE_ASSET, MEME_TOKEN));

        quoteValue = _quote(address(0xBAD));
        quotes.setQuote(QUOTE_CONFIG_ID, quoteValue);
        vm.expectRevert(MarketRegistryV2.InvalidMarketConfig.selector);
        _register(MARKET_ID, _config(QUOTE_ASSET, MEME_TOKEN));
        quotes.setQuote(QUOTE_CONFIG_ID, _quote(QUOTE_ASSET));

        LaunchTemplate memory templateValue = _template();
        templateValue.status = 2;
        templates.setTemplate(TEMPLATE_ID, templateValue);
        vm.expectRevert(MarketRegistryV2.InvalidMarketConfig.selector);
        _register(MARKET_ID, _config(QUOTE_ASSET, MEME_TOKEN));

        templateValue = _template();
        templateValue.feePolicyId = bytes32(uint256(1));
        templates.setTemplate(TEMPLATE_ID, templateValue);
        vm.expectRevert(MarketRegistryV2.InvalidMarketConfig.selector);
        _register(MARKET_ID, _config(QUOTE_ASSET, MEME_TOKEN));
    }

    function test_laterConfigStatusChangesDoNotMutateHistoricalMarketSnapshot() public {
        MarketConfig memory config = _config(QUOTE_ASSET, MEME_TOKEN);
        _register(MARKET_ID, config);

        AssetView memory assetValue = _asset();
        assetValue.status = 2;
        assets.setAsset(ASSET_UID, assetValue);
        QuoteAssetConfig memory quoteValue = _quote(QUOTE_ASSET);
        quoteValue.status = 2;
        quotes.setQuote(QUOTE_CONFIG_ID, quoteValue);
        PonsBaseline memory baselineValue = _baseline();
        baselineValue.status = 2;
        baselines.setBaseline(BASELINE_ID, baselineValue);
        LaunchTemplate memory templateValue = _template();
        templateValue.status = 2;
        templates.setTemplate(TEMPLATE_ID, templateValue);

        assertEq(keccak256(abi.encode(registry.market(MARKET_ID).config)), keccak256(abi.encode(config)));
        assertEq(registry.canonicalPoolKey(MARKET_ID).tickSpacing, TICK_SPACING);
        (address source, uint32 version) = registry.activeFeeSource(MARKET_ID);
        assertEq(source, CURVE);
        assertEq(version, 1);
    }

    function test_rejectsTimestampThatCannotFitCanonicalRuntime() public {
        vm.warp(uint256(type(uint64).max) + 1);
        vm.expectRevert(
            abi.encodeWithSelector(MarketRegistryV2.BlockTimestampOverflow.selector, uint256(type(uint64).max) + 1)
        );
        _register(MARKET_ID, _config(QUOTE_ASSET, MEME_TOKEN));
    }

    function _register(bytes32 marketId, MarketConfig memory config) internal {
        vm.prank(FACTORY);
        registry.registerMarket(marketId, config);
    }

    function _sweep(bytes32 marketId) internal {
        vm.prank(CURVE);
        registry.markSwept(marketId);
    }

    function _pause(bytes32 marketId, bytes32 reasonHash) internal {
        vm.prank(CONTROLLER);
        registry.setMarketPaused(marketId, reasonHash);
    }

    function _mockLaunchLockerRoute(bytes32 marketId, bool deployed) internal {
        vm.mockCall(
            GRADUATION, abi.encodeCall(IGraduationExecutor.predictLaunchLocker, (marketId)), abi.encode(LAUNCH_LOCKER)
        );
        if (!deployed) return;
        bytes32 poolId = registry.canonicalPoolId(marketId);
        vm.etch(LAUNCH_LOCKER, hex"00");
        vm.mockCall(LAUNCH_LOCKER, abi.encodeCall(ILaunchLocker.marketId, ()), abi.encode(marketId));
        vm.mockCall(LAUNCH_LOCKER, abi.encodeCall(ILaunchLocker.lockedPosition, ()), abi.encode(uint256(1), poolId));
    }

    function _setPackedRuntimeCounter(bytes32 marketId, bool sourceCounter, uint32 value) internal {
        bytes32 runtimeRoot = keccak256(abi.encode(marketId, uint256(1)));
        bytes32 counterSlot = bytes32(uint256(runtimeRoot) + 1);
        uint256 packed = uint256(vm.load(address(registry), counterSlot));
        uint256 shift = sourceCounter ? 0 : 32;
        uint256 mask = uint256(type(uint32).max) << shift;
        vm.store(address(registry), counterSlot, bytes32((packed & ~mask) | (uint256(value) << shift)));
    }

    function _config(address quoteAsset, address memeToken) internal pure returns (MarketConfig memory) {
        return MarketConfig({
            assetUid: ASSET_UID,
            ponsBaselineId: BASELINE_ID,
            quoteAssetConfigId: QUOTE_CONFIG_ID,
            launchTemplateId: TEMPLATE_ID,
            feePolicyId: FEE_POLICY_ID,
            executionSpecId: keccak256("V2-EXEC-4"),
            expectedEconomics: ECONOMICS,
            launchConfigId: LAUNCH_CONFIG_ID,
            creatorRevenueBeneficiaryAtCreation: BENEFICIARY,
            memeToken: memeToken,
            curve: CURVE,
            gauge: GAUGE,
            quoteAsset: quoteAsset,
            graduatedHook: HOOK,
            marketController: CONTROLLER
        });
    }

    function _baseline() internal pure returns (PonsBaseline memory) {
        return PonsBaseline({
            referenceChainId: 4663,
            referenceFactory: address(0xFACADE),
            referenceFactoryCodeHash: keccak256("factory-runtime"),
            launchConfigId: LAUNCH_CONFIG_ID,
            supply: 1_000_000_000e18,
            curveFeeBps: 100,
            poolFee: 0,
            tickSpacing: TICK_SPACING,
            behaviorVectorRoot: keccak256("vectors"),
            status: 1
        });
    }

    function _asset() internal pure returns (AssetView memory) {
        return AssetView({stockToken: address(0x570C), userStockVault: address(0xA017), tokenDecimals: 18, status: 1});
    }

    function _quote(address quoteAsset) internal pure returns (QuoteAssetConfig memory) {
        return QuoteAssetConfig({
            ponsBaselineId: BASELINE_ID,
            quoteAsset: quoteAsset,
            quoteDecimals: quoteAsset == address(0) ? 18 : 6,
            phantomQuote: 1,
            graduationThreshold: 2,
            economicsHash: QUOTE_CONFIG_ID,
            status: 1
        });
    }

    function _template() internal pure returns (LaunchTemplate memory) {
        return LaunchTemplate({
            memeTokenImplementation: address(0x1001),
            memeTokenCodeHash: keccak256("meme"),
            curveImplementation: address(0x1002),
            curveCodeHash: keccak256("curve"),
            gaugeImplementation: address(0x1003),
            gaugeCodeHash: keccak256("gauge"),
            graduatedHook: HOOK,
            hookCodeHash: keccak256("hook"),
            graduationExecutor: GRADUATION,
            launchLockerImplementation: address(0x1005),
            launchLockerCodeHash: keccak256("locker"),
            feePolicyId: FEE_POLICY_ID,
            executionSpecId: keccak256("V2-EXEC-4"),
            status: 1
        });
    }
}
