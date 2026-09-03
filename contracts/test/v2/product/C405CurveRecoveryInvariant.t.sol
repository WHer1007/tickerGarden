// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {
    AssetView,
    LaunchTemplate,
    MarketConfig,
    PonsBaseline,
    QuoteAssetConfig
} from "../../../src/v2/interfaces/IV2Protocol.sol";
import {MarketRegistryV2} from "../../../src/v2/modules/MarketRegistryV2.sol";
import {
    CurveInitialization,
    ICurveInitializationSource,
    PonsCompatibleCurve
} from "../../../src/v2/modules/PonsCompatibleCurve.sol";
import {TickerMemeTokenV2} from "../../../src/v2/modules/TickerMemeTokenV2.sol";
import {
    MockOfficialStockRegistry,
    MockApprovedQuoteRegistry,
    MockPonsBaselineRegistry,
    MockLaunchTemplateRegistry
} from "./MarketRegistryV2.t.sol";
import {MockExactQuoteToken} from "../mocks/MockV2QuoteAssets.sol";

contract C405GraduationExecutor {
    function predictLaunchLocker(bytes32) external pure returns (address) {
        return address(0xC405);
    }
}

contract C405CurveFactory is ICurveInitializationSource {
    address internal constant USER = address(0xA11CE);
    CurveInitialization private initialization;
    address private expectedCurve;

    function setInitialization(address curve, CurveInitialization calldata value) external {
        expectedCurve = curve;
        initialization = value;
    }

    function curveInitialization(address curve) external view returns (CurveInitialization memory) {
        require(curve == expectedCurve && msg.sender == curve, "INVALID_CURVE");
        return initialization;
    }

    function predictCurve(bytes32 salt) external view returns (address) {
        bytes32 hash = keccak256(bytes.concat(type(PonsCompatibleCurve).creationCode, abi.encode(address(this))));
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, hash)))));
    }

    function deployCurve(bytes32 salt) external returns (PonsCompatibleCurve) {
        return new PonsCompatibleCurve{salt: salt}(address(this));
    }

    function deployToken(bytes32 marketId, address predictedCurve) external returns (TickerMemeTokenV2) {
        return new TickerMemeTokenV2(marketId, USER, predictedCurve, "Ticker", "TICK", "ipfs://ticker", 1_000_000);
    }
}

contract C405FeeVault {
    receive() external payable {}

    function creditCurveSweep(bytes32, address, uint256, uint32, uint64, bytes32) external payable {}
}

/// @dev Regression vectors for the C405 Emergency x NotGraduated gap.
///      These intentionally use the registry's real transition entry points;
///      the expected reverts are supplied by the production semantic fix.
contract C405CurveRecoveryInvariantTest is Test {
    bytes32 internal constant NATIVE_MARKET_ID = keccak256("c405-native");
    bytes32 internal constant ERC20_MARKET_ID = keccak256("c405-erc20");
    bytes32 internal constant ASSET_UID = keccak256("asset");
    bytes32 internal constant BASELINE_ID = keccak256("baseline");
    bytes32 internal constant QUOTE_CONFIG_ID = keccak256("quote");
    bytes32 internal constant TEMPLATE_ID = keccak256("template");
    bytes32 internal constant FEE_POLICY_ID = keccak256("fee-policy");
    bytes32 internal constant ECONOMICS = keccak256("economics");
    address internal constant FACTORY = address(0xFAC7);
    address internal constant CONTROLLER = address(0xC017);
    address internal constant BENEFICIARY = address(0xBEEF);
    address internal constant USER = address(0xA11CE);
    address internal constant GAUGE = address(0x6000);
    address internal constant HOOK = address(uint160(0x1_0000 | 0x2044));
    address internal constant SWAP_ROUTER = address(0x5100);
    address internal constant QUOTER = address(0x5200);
    MockOfficialStockRegistry internal assets;
    MockApprovedQuoteRegistry internal quotes;
    MockPonsBaselineRegistry internal baselines;
    MockLaunchTemplateRegistry internal templates;
    MarketRegistryV2 internal registry;
    C405GraduationExecutor internal graduation;
    C405FeeVault internal feeVault;

    function setUp() public {
        assets = new MockOfficialStockRegistry();
        quotes = new MockApprovedQuoteRegistry();
        baselines = new MockPonsBaselineRegistry();
        templates = new MockLaunchTemplateRegistry();
        assets.setAsset(ASSET_UID, _asset());
        quotes.setQuote(QUOTE_CONFIG_ID, _quote(address(0)));
        baselines.setBaseline(BASELINE_ID, _baseline());
        graduation = new C405GraduationExecutor();
        feeVault = new C405FeeVault();
        templates.setTemplate(TEMPLATE_ID, _template(address(graduation)));
        vm.etch(SWAP_ROUTER, hex"00");
        vm.etch(QUOTER, hex"00");
        registry = new MarketRegistryV2(
            FACTORY,
            address(assets),
            address(quotes),
            address(baselines),
            address(templates),
            address(graduation),
            CONTROLLER,
            SWAP_ROUTER,
            QUOTER
        );
    }

    function test_nativeCurveBalancesCannotBeTrappedByRetireOrEmergency() public {
        C405CurveFactory factory = new C405CurveFactory();
        quotes.setQuote(QUOTE_CONFIG_ID, _quote(address(0)));
        (PonsCompatibleCurve curve, TickerMemeTokenV2 meme) = _deployCurve(factory, NATIVE_MARKET_ID, address(0));
        _c405Register(NATIVE_MARKET_ID, _config(address(0), address(meme), address(curve)));
        vm.deal(USER, 1 ether);
        vm.prank(USER);
        curve.buy{value: 1_000}(1_000, 0, USER);
        uint256 trackedQuote = curve.realQuoteReserve();
        uint256 accruedFees = curve.accruedCurveFees();
        uint256 sellableTokens = curve.sellableTokens();
        uint256 rawQuoteBalance = address(curve).balance;
        uint256 rawMemeBalance = meme.balanceOf(address(curve));
        assertGt(trackedQuote, 0);
        assertGt(accruedFees, 0);

        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.PreGraduationTerminalStateForbidden.selector, 2));
        vm.prank(CONTROLLER);
        registry.setMarketRetired(NATIVE_MARKET_ID, keccak256("c405-native-retire"));

        _pause(NATIVE_MARKET_ID);
        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.PreGraduationTerminalStateForbidden.selector, 2));
        vm.prank(CONTROLLER);
        registry.setMarketRetired(NATIVE_MARKET_ID, keccak256("c405-native-paused-retire"));
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.PreGraduationTerminalStateForbidden.selector, 3));
        vm.prank(CONTROLLER);
        registry.commitEmergencyExit(NATIVE_MARKET_ID, uint64(block.number), keccak256("c405-native-emergency"));

        _unpause(NATIVE_MARKET_ID);
        assertEq(registry.market(NATIVE_MARKET_ID).runtime.marketStatus, 0);
        assertGt(address(curve).balance, 0);
        assertGt(meme.balanceOf(address(curve)), 0);
        assertEq(curve.realQuoteReserve(), trackedQuote);
        assertEq(curve.accruedCurveFees(), accruedFees);
        assertEq(curve.sellableTokens(), sellableTokens);
        assertEq(address(curve).balance, rawQuoteBalance);
        assertEq(meme.balanceOf(address(curve)), rawMemeBalance);

        vm.deal(USER, 1 ether);
        vm.prank(USER);
        curve.buy{value: 100}(100, 0, USER);
        assertGt(curve.realQuoteReserve(), trackedQuote);
        assertEq(registry.market(NATIVE_MARKET_ID).runtime.marketStatus, 0);
    }

    function test_erc20CurveBalancesCannotBeTrappedByRetireOrEmergency() public {
        MockExactQuoteToken quote = new MockExactQuoteToken(6);
        quotes.setQuote(QUOTE_CONFIG_ID, _quote(address(quote)));
        C405CurveFactory factory = new C405CurveFactory();
        (PonsCompatibleCurve curve, TickerMemeTokenV2 meme) = _deployCurve(factory, ERC20_MARKET_ID, address(quote));
        _c405Register(ERC20_MARKET_ID, _config(address(quote), address(meme), address(curve)));
        quote.mint(USER, 1_000);
        vm.prank(USER);
        quote.approve(address(curve), 1_000);
        vm.prank(USER);
        curve.buy(1_000, 0, USER);
        uint256 trackedQuote = curve.realQuoteReserve();
        uint256 accruedFees = curve.accruedCurveFees();
        uint256 sellableTokens = curve.sellableTokens();
        uint256 rawQuoteBalance = quote.balanceOf(address(curve));
        uint256 rawMemeBalance = meme.balanceOf(address(curve));
        assertGt(trackedQuote, 0);
        assertGt(accruedFees, 0);

        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.PreGraduationTerminalStateForbidden.selector, 2));
        vm.prank(CONTROLLER);
        registry.setMarketRetired(ERC20_MARKET_ID, keccak256("c405-erc20-retire"));

        _pause(ERC20_MARKET_ID);
        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.PreGraduationTerminalStateForbidden.selector, 2));
        vm.prank(CONTROLLER);
        registry.setMarketRetired(ERC20_MARKET_ID, keccak256("c405-erc20-paused-retire"));
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV2.PreGraduationTerminalStateForbidden.selector, 3));
        vm.prank(CONTROLLER);
        registry.commitEmergencyExit(ERC20_MARKET_ID, uint64(block.number), keccak256("c405-erc20-emergency"));

        _unpause(ERC20_MARKET_ID);
        assertEq(registry.market(ERC20_MARKET_ID).runtime.marketStatus, 0);
        assertGt(quote.balanceOf(address(curve)), 0);
        assertGt(meme.balanceOf(address(curve)), 0);
        assertEq(curve.realQuoteReserve(), trackedQuote);
        assertEq(curve.accruedCurveFees(), accruedFees);
        assertEq(curve.sellableTokens(), sellableTokens);
        assertEq(quote.balanceOf(address(curve)), rawQuoteBalance);
        assertEq(meme.balanceOf(address(curve)), rawMemeBalance);

        quote.mint(USER, 100);
        vm.prank(USER);
        quote.approve(address(curve), 100);
        vm.prank(USER);
        curve.buy(100, 0, USER);
        assertGt(curve.realQuoteReserve(), trackedQuote);
        assertEq(registry.market(ERC20_MARKET_ID).runtime.marketStatus, 0);
    }

    function _c405Register(bytes32 marketId, MarketConfig memory config) internal {
        vm.prank(FACTORY);
        registry.registerMarket(marketId, config);
    }

    function _pause(bytes32 marketId) internal {
        vm.prank(CONTROLLER);
        registry.setMarketPaused(marketId, keccak256("c405-pause"));
    }

    function _unpause(bytes32 marketId) internal {
        vm.prank(CONTROLLER);
        registry.setMarketActive(marketId);
    }

    function _config(address quoteAsset, address memeToken, address curve) internal pure returns (MarketConfig memory) {
        return MarketConfig({
            assetUid: ASSET_UID,
            ponsBaselineId: BASELINE_ID,
            quoteAssetConfigId: QUOTE_CONFIG_ID,
            launchTemplateId: TEMPLATE_ID,
            feePolicyId: FEE_POLICY_ID,
            executionSpecId: keccak256("V2-EXEC-4"),
            expectedEconomics: ECONOMICS,
            launchConfigId: 0,
            creatorRevenueBeneficiaryAtCreation: BENEFICIARY,
            memeToken: memeToken,
            curve: curve,
            gauge: GAUGE,
            quoteAsset: quoteAsset,
            graduatedHook: HOOK,
            marketController: CONTROLLER
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

    function _baseline() internal pure returns (PonsBaseline memory) {
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

    function _template(address graduationExecutor) internal pure returns (LaunchTemplate memory) {
        return LaunchTemplate({
            memeTokenImplementation: address(0x1001),
            memeTokenCodeHash: keccak256("meme"),
            curveImplementation: address(0x1002),
            curveCodeHash: keccak256("curve"),
            gaugeImplementation: address(0x1003),
            gaugeCodeHash: keccak256("gauge"),
            graduatedHook: HOOK,
            hookCodeHash: keccak256("hook"),
            graduationExecutor: graduationExecutor,
            launchLockerImplementation: address(0x1005),
            launchLockerCodeHash: keccak256("locker"),
            feePolicyId: FEE_POLICY_ID,
            executionSpecId: keccak256("V2-EXEC-4"),
            status: 1
        });
    }

    function _deployCurve(C405CurveFactory factory, bytes32 marketId, address quote)
        internal
        returns (PonsCompatibleCurve curve, TickerMemeTokenV2 meme)
    {
        bytes32 salt = keccak256(abi.encode(marketId));
        address predicted = factory.predictCurve(salt);
        meme = factory.deployToken(marketId, predicted);
        factory.setInitialization(
            predicted,
            CurveInitialization({
                marketId: marketId,
                ponsBaselineId: BASELINE_ID,
                quoteAssetConfigId: QUOTE_CONFIG_ID,
                marketRegistry: address(registry),
                protocolFeeVault: address(feeVault),
                graduationExecutor: address(graduation),
                launchRouter: address(this),
                creator: USER,
                beneficiaryAtCreation: BENEFICIARY,
                memeToken: address(meme),
                quoteAsset: quote,
                phantomQuote: 1,
                graduationThreshold: 400_000,
                initialSupply: 1_000_000,
                curveFeeBps: 100
            })
        );
        curve = factory.deployCurve(salt);
    }
}
