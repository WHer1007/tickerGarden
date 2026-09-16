// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {
    MarketConfig,
    MarketRuntime,
    MarketView,
    TickerGardenBaseline,
    QuoteAssetConfig
} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {GraduationExecutorAssetAccounting} from "../../../src/v1/shared/GraduationExecutorAssetAccounting.sol";

contract GraduationAccountingToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }
}

contract GraduationAccountingQuoteRegistryMock {
    mapping(bytes32 configId => QuoteAssetConfig value) private _configs;

    function configure(bytes32 configId, QuoteAssetConfig calldata value) external {
        _configs[configId] = value;
    }

    function quoteConfig(bytes32 configId) external view returns (QuoteAssetConfig memory) {
        return _configs[configId];
    }
}

contract GraduationAccountingTickerGardenBaselineRegistryMock {
    mapping(bytes32 id => TickerGardenBaseline value) private _baselines;

    function configure(bytes32 id, TickerGardenBaseline calldata value) external {
        _baselines[id] = value;
    }

    function baseline(bytes32 id) external view returns (TickerGardenBaseline memory) {
        return _baselines[id];
    }
}

contract GraduationAccountingRegistryMock {
    address public immutable approvedQuoteRegistry;
    address public immutable tickerGardenBaselineRegistry;
    address public executor;
    mapping(bytes32 marketId => MarketView value) private _markets;

    error UnauthorizedExecutor(address caller);

    constructor(address quoteRegistry, address baselineRegistry) {
        approvedQuoteRegistry = quoteRegistry;
        tickerGardenBaselineRegistry = baselineRegistry;
    }

    function setExecutor(address value) external {
        require(executor == address(0));
        executor = value;
    }

    function configure(bytes32 marketId, MarketConfig calldata config, uint32 sourceVersion) external {
        MarketRuntime memory runtime;
        runtime.launchPhase = 0;
        runtime.sourceVersion = sourceVersion;
        _markets[marketId] = MarketView({config: config, runtime: runtime});
    }

    function commitPool(bytes32 marketId, bytes32 poolId) external {
        if (msg.sender != executor) revert UnauthorizedExecutor(msg.sender);
        MarketRuntime storage runtime = _markets[marketId].runtime;
        runtime.launchPhase = 1;
        runtime.poolId = poolId;
        runtime.sourceVersion += 1;
    }

    function market(bytes32 marketId) external view returns (MarketView memory) {
        return _markets[marketId];
    }
}

contract GraduationAccountingCurveCaller {
    function graduate(
        GraduationExecutorAssetAccounting executor,
        bytes32 marketId,
        uint256 quoteAmount,
        uint256 memeAmount
    ) external payable {
        executor.graduateFromCurve{value: msg.value}(marketId, quoteAmount, memeAmount);
    }
}

contract GraduationAccountingExecutorHarness is GraduationExecutorAssetAccounting {
    enum Mode {
        COMPLETE,
        UNDER_CONSUME_QUOTE,
        ZERO_LOCKER
    }

    GraduationAccountingRegistryMock private immutable _registry;
    address private immutable _quoteSink;
    address private immutable _locker;
    Mode private _mode;

    uint256 public observedPoolMeme;
    uint256 public observedPoolQuote;
    uint256 public observedLockedExcessQuote;
    uint256 public observedLockedExcessMeme;

    constructor(address registry, address quoteRegistry, address quoteSink, address locker)
        GraduationExecutorAssetAccounting(registry, quoteRegistry)
    {
        _registry = GraduationAccountingRegistryMock(registry);
        _quoteSink = quoteSink;
        _locker = locker;
    }

    function setMode(Mode value) external {
        _mode = value;
    }

    function _executeGraduationAssetPlan(bytes32 marketId, MarketView memory, GraduationAssetPlan memory plan)
        internal
        override
        returns (address launchLocker)
    {
        observedPoolQuote = plan.poolQuoteAmount;
        observedPoolMeme = plan.poolMemeAmount;
        observedLockedExcessQuote = plan.lockedExcessQuote;
        observedLockedExcessMeme = plan.lockedExcessMeme;

        uint256 quoteToConsume = _mode == Mode.UNDER_CONSUME_QUOTE ? plan.sweptQuote - 1 : plan.sweptQuote;
        if (plan.quoteAsset == address(0)) {
            (bool success,) = payable(_quoteSink).call{value: quoteToConsume}("");
            require(success);
        } else {
            require(IERC20(plan.quoteAsset).transfer(_quoteSink, quoteToConsume));
        }
        require(IERC20(plan.memeToken).transfer(_quoteSink, plan.poolMemeAmount));
        require(IERC20(plan.memeToken).transfer(_locker, plan.lockedExcessMeme));

        _registry.commitPool(marketId, keccak256("graduation-accounting-pool"));
        launchLocker = _mode == Mode.ZERO_LOCKER ? address(0) : _locker;
    }
}

contract GraduationExecutorAssetAccountingTest is Test {
    bytes32 private constant MARKET_ID = keccak256("graduation-accounting-market");
    bytes32 private constant BASELINE_ID = keccak256("graduation-accounting-baseline");
    bytes32 private constant QUOTE_CONFIG_ID = keccak256("graduation-accounting-quote");
    bytes32 private constant POOL_ID = keccak256("graduation-accounting-pool");
    uint32 private constant SOURCE_VERSION = 7;
    address private constant QUOTE_SINK = address(0xBEEF);
    address private constant LOCKER = address(0xCAFE);

    uint256 private constant NATIVE_SWEPT_QUOTE = 4_200_000_000_000_000_157;
    uint256 private constant NATIVE_PHANTOM = 1_680_000_000_000_000_000;
    uint256 private constant NATIVE_THRESHOLD = 4_200_000_000_000_000_000;
    uint256 private constant NATIVE_POOL_QUOTE = 4_200_000_000_000_000_001;
    uint256 private constant NATIVE_LOCKED_EXCESS_QUOTE = 156;
    uint256 private constant NATIVE_SWEPT_TOKENS = 285_714_285_714_285_714_285_714_285;
    uint256 private constant NATIVE_POOL_MEME = 204_081_632_653_061_224_503_679_022;
    uint256 private constant NATIVE_LOCKED_EXCESS_MEME = 81_632_653_061_224_489_782_035_263;
    uint256 private constant BASELINE_SUPPLY = 1_000_000_000 ether;

    GraduationAccountingQuoteRegistryMock private quotes;
    GraduationAccountingTickerGardenBaselineRegistryMock private baselines;
    GraduationAccountingRegistryMock private registry;
    GraduationAccountingCurveCaller private curve;
    GraduationAccountingToken private meme;
    GraduationAccountingExecutorHarness private executor;

    event PoolGraduated(
        bytes32 indexed marketId,
        bytes32 indexed poolId,
        address indexed launchLocker,
        uint256 sweptQuote,
        uint256 sweptTokens,
        uint256 poolQuoteAmount,
        uint256 poolMemeAmount,
        uint256 lockedExcessQuote,
        uint256 lockedExcessMeme,
        uint32 sourceVersion
    );

    function setUp() public {
        quotes = new GraduationAccountingQuoteRegistryMock();
        baselines = new GraduationAccountingTickerGardenBaselineRegistryMock();
        registry = new GraduationAccountingRegistryMock(address(quotes), address(baselines));
        curve = new GraduationAccountingCurveCaller();
        meme = new GraduationAccountingToken("Meme", "MEME");
        executor = new GraduationAccountingExecutorHarness(address(registry), address(quotes), QUOTE_SINK, LOCKER);
        registry.setExecutor(address(executor));
        _configureMarket(address(0), NATIVE_PHANTOM);
    }

    function test_nativePlanMatchesPinnedRuntimeAndPreservesUnrelatedBalances() public {
        uint256 unrelatedQuote = 13 ether;
        uint256 unrelatedMeme = 99;
        vm.deal(address(executor), unrelatedQuote);
        meme.mint(address(executor), NATIVE_SWEPT_TOKENS + unrelatedMeme);

        vm.expectEmit(true, true, true, true, address(executor));
        emit PoolGraduated(
            MARKET_ID,
            POOL_ID,
            LOCKER,
            NATIVE_SWEPT_QUOTE,
            NATIVE_SWEPT_TOKENS,
            NATIVE_POOL_QUOTE,
            NATIVE_POOL_MEME,
            NATIVE_LOCKED_EXCESS_QUOTE,
            NATIVE_LOCKED_EXCESS_MEME,
            SOURCE_VERSION + 1
        );
        curve.graduate{value: NATIVE_SWEPT_QUOTE}(executor, MARKET_ID, NATIVE_SWEPT_QUOTE, NATIVE_SWEPT_TOKENS);

        assertEq(executor.observedPoolQuote(), NATIVE_POOL_QUOTE);
        assertEq(executor.observedPoolMeme(), NATIVE_POOL_MEME);
        assertEq(executor.observedLockedExcessQuote(), NATIVE_LOCKED_EXCESS_QUOTE);
        assertEq(executor.observedLockedExcessMeme(), NATIVE_LOCKED_EXCESS_MEME);
        assertEq(NATIVE_POOL_MEME + NATIVE_LOCKED_EXCESS_MEME, NATIVE_SWEPT_TOKENS);
        assertEq(address(executor).balance, unrelatedQuote);
        assertEq(meme.balanceOf(address(executor)), unrelatedMeme);
        assertEq(meme.balanceOf(QUOTE_SINK), NATIVE_POOL_MEME);
        assertEq(meme.balanceOf(LOCKER), NATIVE_LOCKED_EXCESS_MEME);
        assertEq(registry.market(MARKET_ID).runtime.launchPhase, 1);
    }

    function test_erc20PlanUsesActualRecordedAmountsAndConsumesEachAssetExactly() public {
        GraduationAccountingToken quote = new GraduationAccountingToken("Quote", "QUOTE");
        uint256 sweptQuote = 26_639_006_882_017_848_470;
        uint256 phantom = 10_655_602_752_807_139_311;
        uint256 sweptTokens = 285_714_285_714_285_713_760_935_269;
        uint256 expectedPoolQuote = 26_639_006_882_017_848_347;
        uint256 expectedLockedQuote = 123;
        uint256 expectedPool = 204_081_632_653_061_224_267_079_484;
        uint256 expectedExcess = 81_632_653_061_224_489_493_855_785;
        _configureMarket(address(quote), phantom);
        quote.mint(address(executor), sweptQuote);
        meme.mint(address(executor), sweptTokens);
        curve.graduate(executor, MARKET_ID, sweptQuote, sweptTokens);

        assertEq(executor.observedPoolQuote(), expectedPoolQuote);
        assertEq(executor.observedLockedExcessQuote(), expectedLockedQuote);
        assertEq(executor.observedPoolMeme(), expectedPool);
        assertEq(executor.observedLockedExcessMeme(), expectedExcess);
        assertEq(expectedPool + expectedExcess, sweptTokens);
        assertEq(quote.balanceOf(address(executor)), 0);
        assertEq(quote.balanceOf(QUOTE_SINK), sweptQuote);
        assertEq(meme.balanceOf(QUOTE_SINK), expectedPool);
        assertEq(meme.balanceOf(LOCKER), expectedExcess);
    }

    function test_inexactNativeCallValueFailsBeforeAnyConsumption() public {
        meme.mint(address(executor), NATIVE_SWEPT_TOKENS);

        vm.expectRevert(
            abi.encodeWithSelector(
                GraduationExecutorAssetAccounting.InvalidGraduationPaymentValue.selector,
                NATIVE_SWEPT_QUOTE,
                NATIVE_SWEPT_QUOTE - 1
            )
        );
        curve.graduate{value: NATIVE_SWEPT_QUOTE - 1}(executor, MARKET_ID, NATIVE_SWEPT_QUOTE, NATIVE_SWEPT_TOKENS);

        assertEq(address(QUOTE_SINK).balance, 0);
        assertEq(meme.balanceOf(LOCKER), 0);
        assertEq(registry.market(MARKET_ID).runtime.launchPhase, 0);
    }

    function test_partialConsumptionRevertsPoolCommitAndEveryTransfer() public {
        meme.mint(address(executor), NATIVE_SWEPT_TOKENS);
        executor.setMode(GraduationAccountingExecutorHarness.Mode.UNDER_CONSUME_QUOTE);

        vm.expectRevert(
            abi.encodeWithSelector(
                GraduationExecutorAssetAccounting.GraduationAssetConsumptionMismatch.selector,
                address(0),
                NATIVE_SWEPT_QUOTE,
                NATIVE_SWEPT_QUOTE - 1
            )
        );
        curve.graduate{value: NATIVE_SWEPT_QUOTE}(executor, MARKET_ID, NATIVE_SWEPT_QUOTE, NATIVE_SWEPT_TOKENS);

        assertEq(address(executor).balance, 0);
        assertEq(meme.balanceOf(address(executor)), NATIVE_SWEPT_TOKENS);
        assertEq(address(QUOTE_SINK).balance, 0);
        assertEq(meme.balanceOf(LOCKER), 0);
        assertEq(registry.market(MARKET_ID).runtime.launchPhase, 0);
    }

    function test_zeroOrDegenerateRecordedAmountsFailClosed() public {
        meme.mint(address(executor), NATIVE_SWEPT_TOKENS);

        vm.expectRevert(
            abi.encodeWithSelector(GraduationExecutorAssetAccounting.GraduationMarketAssetMismatch.selector, MARKET_ID)
        );
        curve.graduate(executor, MARKET_ID, 0, NATIVE_SWEPT_TOKENS);
        assertEq(registry.market(MARKET_ID).runtime.launchPhase, 0);
    }

    function test_wrongFrozenQuoteBindingFailsBeforeUsingEscrow() public {
        _configureQuote(address(0), NATIVE_PHANTOM, keccak256("wrong-baseline"));
        meme.mint(address(executor), NATIVE_SWEPT_TOKENS);

        vm.expectRevert(
            abi.encodeWithSelector(GraduationExecutorAssetAccounting.GraduationMarketAssetMismatch.selector, MARKET_ID)
        );
        curve.graduate{value: NATIVE_SWEPT_QUOTE}(executor, MARKET_ID, NATIVE_SWEPT_QUOTE, NATIVE_SWEPT_TOKENS);
        assertEq(registry.market(MARKET_ID).runtime.launchPhase, 0);
    }

    function test_invalidLockerRollsBackAssetsAndPoolCommit() public {
        meme.mint(address(executor), NATIVE_SWEPT_TOKENS);
        executor.setMode(GraduationAccountingExecutorHarness.Mode.ZERO_LOCKER);

        vm.expectRevert(
            abi.encodeWithSelector(GraduationExecutorAssetAccounting.InvalidLaunchLocker.selector, address(0))
        );
        curve.graduate{value: NATIVE_SWEPT_QUOTE}(executor, MARKET_ID, NATIVE_SWEPT_QUOTE, NATIVE_SWEPT_TOKENS);

        assertEq(address(executor).balance, 0);
        assertEq(meme.balanceOf(address(executor)), NATIVE_SWEPT_TOKENS);
        assertEq(registry.market(MARKET_ID).runtime.launchPhase, 0);
    }

    function _configureMarket(address quoteAsset, uint256 phantom) private {
        _configureQuote(quoteAsset, phantom, BASELINE_ID);
        MarketConfig memory config;
        config.curve = address(curve);
        config.memeToken = address(meme);
        config.quoteAsset = quoteAsset;
        config.tickerGardenBaselineId = BASELINE_ID;
        config.quoteAssetConfigId = QUOTE_CONFIG_ID;
        registry.configure(MARKET_ID, config, SOURCE_VERSION);
    }

    function _configureQuote(address quoteAsset, uint256 phantom, bytes32 baselineId) private {
        quotes.configure(
            QUOTE_CONFIG_ID,
            QuoteAssetConfig({
                tickerGardenBaselineId: baselineId,
                quoteAsset: quoteAsset,
                quoteDecimals: 18,
                phantomQuote: phantom,
                graduationThreshold: quoteAsset == address(0) ? NATIVE_THRESHOLD : 26_639_006_882_017_848_346,
                economicsHash: QUOTE_CONFIG_ID,
                status: 1
            })
        );
        baselines.configure(
            baselineId,
            TickerGardenBaseline({
                referenceChainId: block.chainid,
                referenceFactory: address(registry),
                referenceFactoryCodeHash: bytes32(0),
                launchConfigId: 0,
                supply: BASELINE_SUPPLY,
                curveFeeBps: 0,
                poolFee: 0,
                tickSpacing: 1,
                behaviorVectorRoot: bytes32(0),
                status: 1
            })
        );
    }
}
