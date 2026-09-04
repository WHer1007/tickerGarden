// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {
    AssetView,
    CanonicalRoute,
    IGraduationExecutor,
    ILaunchLocker,
    IMarketRegistryV1,
    LaunchTemplate,
    MarketConfig,
    MarketView,
    PonsBaseline,
    QuoteAssetConfig
} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {MarketRegistryV1} from "../../../src/v1/modules/MarketRegistryV1.sol";

contract MarketRegistryStockMock {
    mapping(bytes32 assetUid => AssetView value) private _assets;

    function setAsset(bytes32 assetUid, AssetView calldata value) external {
        _assets[assetUid] = value;
    }

    function asset(bytes32 assetUid) external view returns (AssetView memory) {
        return _assets[assetUid];
    }

    /// @dev Test fixture default: identity is stable unless explicitly modeled by a dedicated mock.
    function assetIdentityCurrent(bytes32) external pure returns (bool) {
        return true;
    }
}

contract MarketRegistryQuoteMock {
    mapping(bytes32 configId => QuoteAssetConfig value) private _quotes;
    bool private _identityIsCurrent = true;

    function setQuote(bytes32 configId, QuoteAssetConfig calldata value) external {
        _quotes[configId] = value;
    }

    function quoteConfig(bytes32 configId) external view returns (QuoteAssetConfig memory) {
        return _quotes[configId];
    }

    function setIdentityCurrent(bool current) external {
        _identityIsCurrent = current;
    }

    function quoteIdentityCurrent(bytes32) external view returns (bool) {
        return _identityIsCurrent;
    }
}

contract MarketRegistryBaselineMock {
    mapping(bytes32 baselineId => PonsBaseline value) private _baselines;

    function setBaseline(bytes32 baselineId, PonsBaseline calldata value) external {
        _baselines[baselineId] = value;
    }

    function baseline(bytes32 baselineId) external view returns (PonsBaseline memory) {
        return _baselines[baselineId];
    }
}

contract MarketRegistryTemplateMock {
    mapping(bytes32 templateId => LaunchTemplate value) private _templates;

    function setTemplate(bytes32 templateId, LaunchTemplate calldata value) external {
        _templates[templateId] = value;
    }

    function launchTemplate(bytes32 templateId) external view returns (LaunchTemplate memory) {
        return _templates[templateId];
    }
}

contract MarketRegistryV1Test is Test {
    bytes32 private constant MARKET_ID = keccak256("market-1");
    bytes32 private constant OTHER_MARKET_ID = keccak256("market-2");
    bytes32 private constant ASSET_UID = keccak256("asset");
    bytes32 private constant BASELINE_ID = keccak256("baseline");
    bytes32 private constant QUOTE_CONFIG_ID = keccak256("quote");
    bytes32 private constant TEMPLATE_ID = keccak256("template");
    bytes32 private constant FEE_POLICY_ID = keccak256("fee-policy");
    bytes32 private constant ECONOMICS = keccak256("economics");
    address private constant FACTORY = address(0xFAC7);
    address private constant GRADUATION = address(0x1004);
    address private constant MEME_TOKEN = address(0xA000);
    address private constant CURVE = address(0xC000);
    address private constant GAUGE = address(0x6000);
    address private constant QUOTE_ASSET = address(0x1000);
    address private constant HOOK = address(uint160(0x1_0000 | 0x2044));
    address private constant SWAP_ROUTER = address(0x5100);
    address private constant QUOTER = address(0x5200);
    address private constant LAUNCH_LOCKER = address(0x5300);

    MarketRegistryStockMock private assets;
    MarketRegistryQuoteMock private quotes;
    MarketRegistryBaselineMock private baselines;
    MarketRegistryTemplateMock private templates;
    MarketRegistryV1 private registry;

    event MarketRegistered(
        bytes32 indexed marketId,
        bytes32 indexed assetUid,
        address indexed memeToken,
        address curve,
        address gauge,
        uint32 sourceVersion
    );
    event LaunchPhaseChanged(
        bytes32 indexed marketId, uint8 oldPhase, uint8 newPhase, bytes32 poolId, uint32 sourceVersion
    );

    function setUp() public {
        assets = new MarketRegistryStockMock();
        quotes = new MarketRegistryQuoteMock();
        baselines = new MarketRegistryBaselineMock();
        templates = new MarketRegistryTemplateMock();
        assets.setAsset(ASSET_UID, AssetView(address(0x570C), address(0xA017), 18, 1));
        quotes.setQuote(QUOTE_CONFIG_ID, _quote(QUOTE_ASSET));
        baselines.setBaseline(BASELINE_ID, _baseline());
        templates.setTemplate(TEMPLATE_ID, _template());
        vm.etch(SWAP_ROUTER, hex"00");
        vm.etch(QUOTER, hex"00");
        registry = new MarketRegistryV1(
            FACTORY,
            address(assets),
            address(quotes),
            address(baselines),
            address(templates),
            GRADUATION,
            SWAP_ROUTER,
            QUOTER
        );
    }

    function test_registersAppendOnlyConfigAndMinimalRuntime() public {
        MarketConfig memory config = _config(QUOTE_ASSET, MEME_TOKEN);
        vm.expectEmit(true, true, true, true);
        emit MarketRegistered(MARKET_ID, ASSET_UID, MEME_TOKEN, CURVE, GAUGE, 1);
        _register(MARKET_ID, config);
        MarketView memory stored = registry.market(MARKET_ID);
        assertEq(keccak256(abi.encode(stored.config)), keccak256(abi.encode(config)));
        assertEq(stored.runtime.poolId, bytes32(0));
        assertEq(stored.runtime.sourceVersion, 1);
        assertEq(stored.runtime.launchPhase, 0);
        assertEq(registry.marketIdByToken(MEME_TOKEN), MARKET_ID);
        (address source, uint32 version) = registry.activeFeeSource(MARKET_ID);
        assertEq(source, CURVE);
        assertEq(version, 1);
    }

    function test_canonicalSelectorsAndOldInterventionSelectorsAreAbsent() public {
        assertEq(MarketRegistryV1.registerMarket.selector, IMarketRegistryV1.registerMarket.selector);
        assertEq(MarketRegistryV1.commitPoolCreated.selector, IMarketRegistryV1.commitPoolCreated.selector);
        bytes4[6] memory removed = [
            bytes4(keccak256("setMarketPaused(bytes32,bytes32)")),
            bytes4(keccak256("setMarketActive(bytes32)")),
            bytes4(keccak256("setMarketRetired(bytes32,bytes32)")),
            bytes4(keccak256("commitEmergencyExit(bytes32,uint64,bytes32)")),
            bytes4(keccak256("markSwept(bytes32)")),
            bytes4(keccak256("markRescued(bytes32)"))
        ];
        for (uint256 i; i < removed.length; ++i) {
            (bool success,) = address(registry).call(abi.encodePacked(removed[i], bytes32(0), bytes32(0), bytes32(0)));
            assertFalse(success, "removed market intervention selector remained callable");
        }
    }

    function test_launchLifecycleIsOneWayAndCannotBeInterrupted() public {
        _register(MARKET_ID, _config(QUOTE_ASSET, MEME_TOKEN));
        _mockLaunchLocker(MARKET_ID, false);
        vm.expectEmit(true, false, false, true);
        bytes32 poolId = registry.canonicalPoolId(MARKET_ID);
        emit LaunchPhaseChanged(MARKET_ID, 0, 1, poolId, 2);
        vm.prank(GRADUATION);
        assertEq(registry.commitPoolCreated(MARKET_ID, poolId), 2);
        _mockLaunchLocker(MARKET_ID, true);
        MarketView memory stored = registry.market(MARKET_ID);
        assertEq(stored.runtime.launchPhase, 1);
        assertEq(stored.runtime.poolId, poolId);
        assertEq(stored.runtime.sourceVersion, 2);
        (address source, uint32 version) = registry.activeFeeSource(MARKET_ID);
        assertEq(source, HOOK);
        assertEq(version, 2);
        CanonicalRoute memory route = registry.canonicalRoute(MARKET_ID);
        assertFalse(route.curveTradingEnabled);
        assertTrue(route.poolTradingEnabled);
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV1.InvalidStateTransition.selector, 1, 1));
        vm.prank(GRADUATION);
        registry.commitPoolCreated(MARKET_ID, poolId);
    }

    function test_executorAuthenticationAndCanonicalPoolBinding() public {
        _register(MARKET_ID, _config(QUOTE_ASSET, MEME_TOKEN));
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV1.UnauthorizedModule.selector, address(this), GRADUATION));
        registry.commitPoolCreated(MARKET_ID, bytes32(uint256(1)));
        bytes32 wrongPool = keccak256("wrong-pool");
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV1.PoolNotExpected.selector, wrongPool));
        vm.prank(GRADUATION);
        registry.commitPoolCreated(MARKET_ID, wrongPool);
    }

    function test_poolRouteAttestsCanonicalDeployedLocker() public {
        _register(MARKET_ID, _config(QUOTE_ASSET, MEME_TOKEN));
        _mockLaunchLocker(MARKET_ID, false);
        bytes32 poolId = registry.canonicalPoolId(MARKET_ID);
        vm.prank(GRADUATION);
        registry.commitPoolCreated(MARKET_ID, poolId);
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV1.InvalidCanonicalRoute.selector, MARKET_ID));
        registry.canonicalRoute(MARKET_ID);
        _mockLaunchLocker(MARKET_ID, true);
        CanonicalRoute memory route = registry.canonicalRoute(MARKET_ID);
        assertEq(route.poolId, poolId);
        assertEq(route.launchLocker, LAUNCH_LOCKER);
        assertTrue(route.poolTradingEnabled);
    }

    function test_identitiesAreWriteOnceAndWrongSpecIsRejected() public {
        _register(MARKET_ID, _config(QUOTE_ASSET, MEME_TOKEN));
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV1.MarketAlreadyRegistered.selector, MARKET_ID));
        _register(MARKET_ID, _config(QUOTE_ASSET, address(0xB000)));
        vm.expectRevert(
            abi.encodeWithSelector(MarketRegistryV1.MemeTokenAlreadyRegistered.selector, MEME_TOKEN, MARKET_ID)
        );
        _register(OTHER_MARKET_ID, _config(QUOTE_ASSET, MEME_TOKEN));
        MarketConfig memory wrongSpec = _config(QUOTE_ASSET, address(0xB000));
        wrongSpec.executionSpecId = bytes32(uint256(1));
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV1.InvalidExecutionSpecId.selector, bytes32(uint256(1))));
        _register(OTHER_MARKET_ID, wrongSpec);
    }

    function test_registrationRejectsQuoteIdentityDrift() public {
        quotes.setIdentityCurrent(false);
        vm.expectRevert(MarketRegistryV1.InvalidMarketConfig.selector);
        _register(MARKET_ID, _config(QUOTE_ASSET, MEME_TOKEN));
    }

    function test_configStatusChangesAfterRegistrationCannotDisableExistingMarket() public {
        MarketConfig memory config = _config(QUOTE_ASSET, MEME_TOKEN);
        _register(MARKET_ID, config);

        bytes32 expectedPoolId = registry.canonicalPoolId(MARKET_ID);
        assets.setAsset(ASSET_UID, AssetView(address(0x570C), address(0xA017), 18, 3));
        QuoteAssetConfig memory quote = _quote(QUOTE_ASSET);
        quote.status = 3;
        quotes.setQuote(QUOTE_CONFIG_ID, quote);
        PonsBaseline memory baseline = _baseline();
        baseline.status = 3;
        baselines.setBaseline(BASELINE_ID, baseline);
        LaunchTemplate memory template = _template();
        template.status = 3;
        templates.setTemplate(TEMPLATE_ID, template);

        assertEq(keccak256(abi.encode(registry.market(MARKET_ID).config)), keccak256(abi.encode(config)));
        assertEq(registry.canonicalPoolId(MARKET_ID), expectedPoolId);
        (address source, uint32 version) = registry.activeFeeSource(MARKET_ID);
        assertEq(source, CURVE);
        assertEq(version, 1);

        vm.prank(GRADUATION);
        registry.commitPoolCreated(MARKET_ID, expectedPoolId);
        _mockLaunchLocker(MARKET_ID, true);

        CanonicalRoute memory route = registry.canonicalRoute(MARKET_ID);
        assertEq(route.poolId, expectedPoolId);
        assertFalse(route.curveTradingEnabled);
        assertTrue(route.poolTradingEnabled);
        (source, version) = registry.activeFeeSource(MARKET_ID);
        assertEq(source, HOOK);
        assertEq(version, 2);
    }

    function _register(bytes32 marketId, MarketConfig memory config) private {
        vm.prank(FACTORY);
        registry.registerMarket(marketId, config);
    }

    function _mockLaunchLocker(bytes32 marketId, bool deployed) private {
        vm.mockCall(
            GRADUATION, abi.encodeCall(IGraduationExecutor.predictLaunchLocker, (marketId)), abi.encode(LAUNCH_LOCKER)
        );
        if (!deployed) return;
        bytes32 poolId = registry.canonicalPoolId(marketId);
        vm.etch(LAUNCH_LOCKER, hex"00");
        vm.mockCall(LAUNCH_LOCKER, abi.encodeCall(ILaunchLocker.marketId, ()), abi.encode(marketId));
        vm.mockCall(LAUNCH_LOCKER, abi.encodeCall(ILaunchLocker.lockedPosition, ()), abi.encode(uint256(1), poolId));
    }

    function _config(address quoteAsset, address memeToken) private pure returns (MarketConfig memory) {
        return MarketConfig({
            assetUid: ASSET_UID,
            ponsBaselineId: BASELINE_ID,
            quoteAssetConfigId: QUOTE_CONFIG_ID,
            launchTemplateId: TEMPLATE_ID,
            feePolicyId: FEE_POLICY_ID,
            executionSpecId: keccak256("V1-EXEC-9"),
            expectedEconomics: ECONOMICS,
            launchConfigId: 0,
            creatorRevenueBeneficiaryAtCreation: address(0xBEEF),
            memeToken: memeToken,
            curve: CURVE,
            gauge: GAUGE,
            quoteAsset: quoteAsset,
            graduatedHook: HOOK
        });
    }

    function _quote(address quoteAsset) private pure returns (QuoteAssetConfig memory) {
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

    function _baseline() private pure returns (PonsBaseline memory) {
        return PonsBaseline({
            referenceChainId: 4663,
            referenceFactory: address(0xFACADE),
            referenceFactoryCodeHash: keccak256("factory-runtime"),
            launchConfigId: 0,
            supply: 1_000_000_000e18,
            curveFeeBps: 100,
            poolFee: 0,
            tickSpacing: 200,
            behaviorVectorRoot: keccak256("vectors"),
            status: 1
        });
    }

    function _template() private pure returns (LaunchTemplate memory) {
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
            executionSpecId: keccak256("V1-EXEC-9"),
            status: 1
        });
    }
}
