// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey as V4PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PositionInfo} from "@uniswap/v4-periphery/src/libraries/PositionInfoLibrary.sol";
import {PositionInfoLibrary} from "@uniswap/v4-periphery/src/libraries/PositionInfoLibrary.sol";

import {
    MarketConfig,
    MarketRuntime,
    MarketView,
    PoolBinding,
    PoolKey,
    QuoteAssetConfig
} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {GraduationPoolMath} from "../../../src/v1/libraries/GraduationPoolMath.sol";
import {GraduationExecutorPoolExecution} from "../../../src/v1/shared/GraduationExecutorPoolExecution.sol";
import {LaunchLockerBinding} from "../../../src/v1/shared/LaunchLockerBinding.sol";

contract PoolExecutionToken is ERC20 {
    constructor(string memory name_) ERC20(name_, name_) {}

    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }
}

contract PoolExecutionQuoteRegistryMock {
    mapping(bytes32 id => QuoteAssetConfig value) private _quotes;

    function setQuote(bytes32 id, QuoteAssetConfig memory value) external {
        _quotes[id] = value;
    }

    function quoteConfig(bytes32 id) external view returns (QuoteAssetConfig memory) {
        return _quotes[id];
    }
}

contract PoolExecutionRegistryMock {
    address public immutable factory = address(0xFAC7);
    address public immutable approvedQuoteRegistry;
    address public graduationExecutor;

    bytes32 private _marketId;
    MarketView private _value;
    PoolKey private _key;

    constructor(address quoteRegistry) {
        approvedQuoteRegistry = quoteRegistry;
    }

    function configure(
        bytes32 marketId_,
        bytes32 quoteConfigId,
        address quoteAsset,
        address memeToken,
        address curve,
        address hook
    ) external {
        _marketId = marketId_;
        _key = _canonicalKey(quoteAsset, memeToken, hook);
        _value = MarketView({
            config: MarketConfig({
                assetUid: bytes32("ASSET"),
                ponsBaselineId: bytes32("PONS"),
                quoteAssetConfigId: quoteConfigId,
                launchTemplateId: bytes32("TEMPLATE"),
                feePolicyId: bytes32("FEE"),
                executionSpecId: keccak256("V1-EXEC-6"),
                expectedEconomics: bytes32("ECON"),
                launchConfigId: 0,
                creatorRevenueBeneficiaryAtCreation: address(0xBEEF),
                memeToken: memeToken,
                curve: curve,
                gauge: address(0x5000),
                quoteAsset: quoteAsset,
                graduatedHook: hook
            }),
            runtime: MarketRuntime({poolId: bytes32(0), sourceVersion: 1, sweptAt: 10, launchPhase: 1})
        });
    }

    function setGraduationExecutor(address value) external {
        graduationExecutor = value;
    }

    function setCanonicalKey(PoolKey memory value) external {
        _key = value;
    }

    function market(bytes32 marketId_) external view returns (MarketView memory) {
        require(marketId_ == _marketId, "market");
        return _value;
    }

    function canonicalPoolKey(bytes32 marketId_) external view returns (PoolKey memory) {
        require(marketId_ == _marketId, "market");
        return _key;
    }

    function canonicalPoolId(bytes32 marketId_) external view returns (bytes32) {
        require(marketId_ == _marketId, "market");
        return keccak256(abi.encode(_key));
    }

    function commitPoolCreated(bytes32 marketId_, bytes32 poolId) external returns (uint32 sourceVersion) {
        require(msg.sender == graduationExecutor, "executor");
        require(marketId_ == _marketId && poolId == keccak256(abi.encode(_key)), "pool");
        require(_value.runtime.launchPhase == 1 && _value.runtime.poolId == bytes32(0), "phase");
        _value.runtime.launchPhase = 2;
        _value.runtime.poolId = poolId;
        sourceVersion = ++_value.runtime.sourceVersion;
    }

    function markRescued(bytes32 marketId_) external {
        require(msg.sender == graduationExecutor, "executor");
        require(marketId_ == _marketId && _value.runtime.launchPhase == 1, "phase");
        require(block.timestamp >= uint256(_value.runtime.sweptAt) + 7 days, "early");
        _value.runtime.launchPhase = 3;
    }

    function _canonicalKey(address quoteAsset, address memeToken, address hook) private pure returns (PoolKey memory) {
        (address currency0, address currency1) =
            quoteAsset < memeToken ? (quoteAsset, memeToken) : (memeToken, quoteAsset);
        return PoolKey({currency0: currency0, currency1: currency1, fee: 0, tickSpacing: 200, hooks: hook});
    }
}

contract PoolExecutionPermit2Mock {
    mapping(address owner => mapping(address token => mapping(address spender => uint160 amount))) public allowance;

    function approve(address token, address spender, uint160 amount, uint48) external {
        allowance[msg.sender][token][spender] = amount;
    }

    function transferFrom(address from, address to, uint160 amount, address token) external {
        uint160 available = allowance[from][token][msg.sender];
        require(available >= amount, "permit2 allowance");
        allowance[from][token][msg.sender] = available - amount;
        require(IERC20Like(token).transferFrom(from, to, amount), "token transfer");
    }
}

interface IERC20Like {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IPoolExecutionInitializeHook {
    function beforeInitialize(address sender, V4PoolKey calldata key, uint160 sqrtPriceX96) external returns (bytes4);
}

interface IPoolExecutionTokenConsumer {
    function consumeTokenId(address owner) external;
}

contract PoolExecutionPoolManagerMock {
    address public positionManager;
    bool public stealProspectiveToken;
    bytes32 public initializedPoolId;
    uint160 public initializedSqrtPrice;

    receive() external payable {}

    function setPositionManager(address value) external {
        positionManager = value;
    }

    function setStealProspectiveToken(bool value) external {
        stealProspectiveToken = value;
    }

    function initialize(V4PoolKey memory key, uint160 sqrtPriceX96) external returns (int24 tick) {
        require(initializedPoolId == bytes32(0), "initialized");
        initializedPoolId = keccak256(abi.encode(key));
        initializedSqrtPrice = sqrtPriceX96;
        IPoolExecutionInitializeHook(address(key.hooks)).beforeInitialize(msg.sender, key, sqrtPriceX96);
        if (stealProspectiveToken) IPoolExecutionTokenConsumer(positionManager).consumeTokenId(address(0xBAD));
        tick = TickMath.getTickAtSqrtPrice(sqrtPriceX96);
    }
}

contract PoolExecutionHookMock {
    address public executor;
    address public poolManager;
    bool public failActivation;
    mapping(bytes32 poolId => PoolBinding binding) private _bindings;

    function configure(address executor_, address poolManager_) external {
        executor = executor_;
        poolManager = poolManager_;
    }

    function setFailActivation(bool value) external {
        failActivation = value;
    }

    function registerExpectedPool(bytes32 marketId, PoolKey calldata key, uint32 sourceVersion)
        external
        returns (bytes32 poolId)
    {
        require(msg.sender == executor, "executor");
        poolId = keccak256(abi.encode(key));
        require(_bindings[poolId].status == 0, "registered");
        _bindings[poolId] =
            PoolBinding({marketId: marketId, keyHash: poolId, sourceVersion: sourceVersion, feeNonce: 0, status: 1});
    }

    function beforeInitialize(address, V4PoolKey calldata key, uint160) external returns (bytes4) {
        require(msg.sender == poolManager, "pool manager");
        bytes32 poolId = keccak256(abi.encode(key));
        require(_bindings[poolId].status == 1, "expected");
        _bindings[poolId].status = 2;
        return this.beforeInitialize.selector;
    }

    function activatePool(bytes32 poolId) external {
        require(msg.sender == executor, "executor");
        require(!failActivation, "activation");
        require(_bindings[poolId].status == 2, "initialize");
        _bindings[poolId].status = 3;
    }

    function poolBinding(bytes32 poolId) external view returns (PoolBinding memory) {
        return _bindings[poolId];
    }
}

contract PoolExecutionPositionManagerMock {
    using PositionInfoLibrary for V4PoolKey;

    address public immutable poolManager;
    address public immutable permit2;
    uint256 public nextTokenId = 1;
    bool public usedCanonicalActions;

    mapping(uint256 tokenId => address owner) public ownerOf;
    mapping(uint256 tokenId => PositionInfo info) private _positionInfo;
    mapping(uint256 tokenId => V4PoolKey key) private _poolKeys;
    mapping(uint256 tokenId => uint128 liquidity) private _liquidity;

    constructor(address poolManager_, address permit2_) {
        poolManager = poolManager_;
        permit2 = permit2_;
    }

    function modifyLiquidities(bytes calldata unlockData, uint256 deadline) external payable {
        require(block.timestamp <= deadline, "deadline");
        (bytes memory actions, bytes[] memory params) = abi.decode(unlockData, (bytes, bytes[]));
        require(actions.length == 2 && params.length == 2, "length");
        require(uint8(actions[0]) == 0x02 && uint8(actions[1]) == 0x0d, "actions");

        (
            V4PoolKey memory key,
            int24 tickLower,
            int24 tickUpper,
            uint256 liquidity,
            uint128 amount0Max,
            uint128 amount1Max,
            address owner,
            bytes memory hookData
        ) = abi.decode(params[0], (V4PoolKey, int24, int24, uint256, uint128, uint128, address, bytes));
        (Currency settle0, Currency settle1) = abi.decode(params[1], (Currency, Currency));
        require(Currency.unwrap(settle0) == Currency.unwrap(key.currency0), "settle0");
        require(Currency.unwrap(settle1) == Currency.unwrap(key.currency1), "settle1");
        require(hookData.length == 0 && liquidity <= type(uint128).max, "mint");

        uint256 nativeRequired;
        nativeRequired += _settle(msg.sender, key.currency0, amount0Max);
        nativeRequired += _settle(msg.sender, key.currency1, amount1Max);
        require(msg.value == nativeRequired, "native");
        if (nativeRequired != 0) {
            (bool success,) = payable(poolManager).call{value: nativeRequired}("");
            require(success, "native transfer");
        }

        uint256 tokenId = nextTokenId++;
        ownerOf[tokenId] = owner;
        _poolKeys[tokenId] = key;
        _positionInfo[tokenId] = PositionInfoLibrary.initialize(key, tickLower, tickUpper);
        _liquidity[tokenId] = uint128(liquidity);
        usedCanonicalActions = true;
    }

    function consumeTokenId(address owner) external {
        require(msg.sender == poolManager, "pool manager");
        ownerOf[nextTokenId] = owner;
        ++nextTokenId;
    }

    function getPoolAndPositionInfo(uint256 tokenId) external view returns (V4PoolKey memory, PositionInfo) {
        return (_poolKeys[tokenId], _positionInfo[tokenId]);
    }

    function getPositionLiquidity(uint256 tokenId) external view returns (uint128) {
        return _liquidity[tokenId];
    }

    function _settle(address payer, Currency currency, uint160 amount) private returns (uint256 nativeAmount) {
        address asset = Currency.unwrap(currency);
        if (asset == address(0)) return amount;
        PoolExecutionPermit2Mock(permit2).transferFrom(payer, poolManager, amount, asset);
    }
}

contract PoolExecutionLocker is LaunchLockerBinding {
    constructor(bytes32 marketId_, address registry_, address positionManager_)
        LaunchLockerBinding(marketId_, registry_, positionManager_)
    {}

    function compoundLockedFees() external view returns (uint256, uint256, uint128) {
        _requireLockedPositionOwnership();
        return (0, 0, 0);
    }

    function unpairedLockedBalance(address currency) external view returns (uint256) {
        if (currency == address(0)) return address(this).balance;
        return ERC20(currency).balanceOf(address(this));
    }
}

contract PoolExecutionExecutorHarness is GraduationExecutorPoolExecution {
    mapping(bytes32 marketId => uint256 quote) private _quote;
    mapping(bytes32 marketId => uint256 meme) private _meme;

    constructor(
        address registry,
        address quoteRegistry,
        address poolManager,
        address positionManager,
        address hook,
        address dustRecipient
    ) GraduationExecutorPoolExecution(registry, quoteRegistry, poolManager, positionManager, hook, dustRecipient) {}

    function record(bytes32 marketId, uint256 quote, uint256 meme) external {
        _quote[marketId] = quote;
        _meme[marketId] = meme;
    }

    function _recordedGraduationEscrow(bytes32 marketId, MarketView memory)
        internal
        view
        override
        returns (uint256, uint256)
    {
        return (_quote[marketId], _meme[marketId]);
    }

    function _launchLockerCreationCode() internal pure override returns (bytes memory) {
        return type(PoolExecutionLocker).creationCode;
    }
}

contract PoolExecutionCurveCaller {
    uint256 private _sweptQuote;
    uint256 private _sweptTokens;

    function setGraduationEscrow(uint256 sweptQuote, uint256 sweptTokens) external {
        _sweptQuote = sweptQuote;
        _sweptTokens = sweptTokens;
    }

    function graduationEscrow() external view returns (uint256 sweptQuote, uint256 sweptTokens) {
        return (_sweptQuote, _sweptTokens);
    }

    function graduate(address executor, bytes32 marketId) external {
        PoolExecutionExecutorHarness(payable(executor)).graduateFromCurve(marketId);
    }
}

contract PoolExecutionMathHarness {
    function derive(PoolKey memory key, address quote, address meme, uint256 sweptQuote, uint256 poolMeme)
        external
        pure
        returns (GraduationPoolMath.PoolPlan memory)
    {
        return GraduationPoolMath.derive(key, quote, meme, sweptQuote, poolMeme);
    }
}

contract PoolExecutionDustOrderReceiver {
    PoolExecutionPositionManagerMock private immutable _positionManager;
    bool public observedMintBeforeDust;

    constructor(PoolExecutionPositionManagerMock positionManager_) {
        _positionManager = positionManager_;
    }

    receive() external payable {
        require(_positionManager.nextTokenId() == 2, "dust before mint");
        observedMintBeforeDust = true;
    }
}

contract GraduationExecutorPoolExecutionTest is Test {
    bytes32 private constant MARKET_ID = keccak256("POOL-EXECUTION");
    bytes32 private constant QUOTE_ID = keccak256("QUOTE-CONFIG");
    address private constant HOOK_ADDRESS = address(0x2044);
    address private constant DUST_RECIPIENT = address(0xD057);
    uint256 private constant SWEPT_QUOTE = 40 ether;
    uint256 private constant SWEPT_MEME = 100 ether;
    uint256 private constant PHANTOM = 10 ether;

    PoolExecutionToken private meme;
    PoolExecutionToken private quote;
    PoolExecutionQuoteRegistryMock private quoteRegistry;
    PoolExecutionRegistryMock private registry;
    PoolExecutionPermit2Mock private permit2;
    PoolExecutionPoolManagerMock private poolManager;
    PoolExecutionPositionManagerMock private positionManager;
    PoolExecutionHookMock private hook;
    PoolExecutionExecutorHarness private executor;
    PoolExecutionCurveCaller private curve;
    PoolExecutionMathHarness private math;

    function setUp() public {
        meme = new PoolExecutionToken("MEME");
        quote = new PoolExecutionToken("QUOTE");
        quoteRegistry = new PoolExecutionQuoteRegistryMock();
        registry = new PoolExecutionRegistryMock(address(quoteRegistry));
        permit2 = new PoolExecutionPermit2Mock();
        poolManager = new PoolExecutionPoolManagerMock();
        positionManager = new PoolExecutionPositionManagerMock(address(poolManager), address(permit2));
        poolManager.setPositionManager(address(positionManager));

        PoolExecutionHookMock hookImplementation = new PoolExecutionHookMock();
        vm.etch(HOOK_ADDRESS, address(hookImplementation).code);
        hook = PoolExecutionHookMock(HOOK_ADDRESS);
        curve = new PoolExecutionCurveCaller();
        math = new PoolExecutionMathHarness();

        _configureQuote(address(quote));
        registry.configure(MARKET_ID, QUOTE_ID, address(quote), address(meme), address(curve), address(hook));
        executor = new PoolExecutionExecutorHarness(
            address(registry),
            address(quoteRegistry),
            address(poolManager),
            address(positionManager),
            address(hook),
            DUST_RECIPIENT
        );
        registry.setGraduationExecutor(address(executor));
        hook.configure(address(executor), address(poolManager));
        executor.record(MARKET_ID, SWEPT_QUOTE, SWEPT_MEME);
    }

    function test_erc20QuoteUsesCanonicalActionsExactPermit2AndDirectLockerOwnership() public {
        quote.mint(address(executor), SWEPT_QUOTE);
        meme.mint(address(executor), SWEPT_MEME);
        address predictedLocker = executor.predictLaunchLocker(MARKET_ID);
        GraduationPoolMath.PoolPlan memory plan = _plan(address(quote));

        curve.graduate(address(executor), MARKET_ID);

        _assertCommittedPosition(predictedLocker, plan);
        (uint256 quoteMint, uint256 memeMint) = _assetMints(plan, address(quote));
        assertEq(quote.balanceOf(address(poolManager)), quoteMint);
        assertEq(meme.balanceOf(address(poolManager)), memeMint);
        assertEq(quote.balanceOf(DUST_RECIPIENT), SWEPT_QUOTE - quoteMint);
        assertEq(meme.balanceOf(predictedLocker), SWEPT_MEME - memeMint);
        assertEq(quote.balanceOf(address(executor)), 0);
        assertEq(meme.balanceOf(address(executor)), 0);
        assertEq(quote.allowance(address(executor), address(permit2)), 0);
        assertEq(meme.allowance(address(executor), address(permit2)), 0);
        assertEq(permit2.allowance(address(executor), address(quote), address(positionManager)), 0);
        assertEq(permit2.allowance(address(executor), address(meme), address(positionManager)), 0);
    }

    function test_nativeQuoteSettlesOnlyExactMintDebtAndRoutesDustBeforeCommit() public {
        _configureQuote(address(0));
        registry.configure(MARKET_ID, QUOTE_ID, address(0), address(meme), address(curve), address(hook));
        PoolExecutionDustOrderReceiver dustReceiver = new PoolExecutionDustOrderReceiver(positionManager);
        PoolExecutionExecutorHarness nativeExecutor = new PoolExecutionExecutorHarness(
            address(registry),
            address(quoteRegistry),
            address(poolManager),
            address(positionManager),
            address(hook),
            address(dustReceiver)
        );
        registry.setGraduationExecutor(address(nativeExecutor));
        hook.configure(address(nativeExecutor), address(poolManager));
        nativeExecutor.record(MARKET_ID, SWEPT_QUOTE, SWEPT_MEME);
        vm.deal(address(nativeExecutor), SWEPT_QUOTE);
        meme.mint(address(nativeExecutor), SWEPT_MEME);
        address predictedLocker = nativeExecutor.predictLaunchLocker(MARKET_ID);
        GraduationPoolMath.PoolPlan memory plan = _plan(address(0));

        curve.graduate(address(nativeExecutor), MARKET_ID);

        _assertCommittedPosition(predictedLocker, plan);
        (uint256 quoteMint, uint256 memeMint) = _assetMints(plan, address(0));
        assertEq(address(poolManager).balance, quoteMint);
        assertEq(address(dustReceiver).balance, SWEPT_QUOTE - quoteMint);
        assertTrue(dustReceiver.observedMintBeforeDust());
        assertEq(meme.balanceOf(address(poolManager)), memeMint);
        assertEq(meme.balanceOf(predictedLocker), SWEPT_MEME - memeMint);
        assertEq(address(nativeExecutor).balance, 0);
    }

    function test_lateActivationFailureRollsBackLockerNftLiquidityDustAndBindings() public {
        quote.mint(address(executor), SWEPT_QUOTE);
        meme.mint(address(executor), SWEPT_MEME);
        address predictedLocker = executor.predictLaunchLocker(MARKET_ID);
        bytes32 poolId = registry.canonicalPoolId(MARKET_ID);
        hook.setFailActivation(true);

        vm.expectRevert(bytes("activation"));
        curve.graduate(address(executor), MARKET_ID);

        assertEq(predictedLocker.code.length, 0);
        assertEq(positionManager.nextTokenId(), 1);
        assertEq(quote.balanceOf(address(executor)), SWEPT_QUOTE);
        assertEq(meme.balanceOf(address(executor)), SWEPT_MEME);
        assertEq(quote.balanceOf(address(poolManager)), 0);
        assertEq(meme.balanceOf(address(poolManager)), 0);
        assertEq(quote.balanceOf(DUST_RECIPIENT), 0);
        assertEq(hook.poolBinding(poolId).status, 0);
        assertEq(registry.market(MARKET_ID).runtime.launchPhase, 1);
    }

    function test_initializeCannotStealProspectiveTokenIdWithoutAtomicRollback() public {
        quote.mint(address(executor), SWEPT_QUOTE);
        meme.mint(address(executor), SWEPT_MEME);
        address predictedLocker = executor.predictLaunchLocker(MARKET_ID);
        poolManager.setStealProspectiveToken(true);

        vm.expectRevert(
            abi.encodeWithSelector(
                GraduationExecutorPoolExecution.UnexpectedPositionCounter.selector, uint256(3), uint256(2)
            )
        );
        curve.graduate(address(executor), MARKET_ID);

        assertEq(predictedLocker.code.length, 0);
        assertEq(positionManager.nextTokenId(), 1);
        assertEq(registry.market(MARKET_ID).runtime.launchPhase, 1);
    }

    function _configureQuote(address quoteAsset) private {
        quoteRegistry.setQuote(
            QUOTE_ID,
            QuoteAssetConfig({
                ponsBaselineId: bytes32("PONS"),
                quoteAsset: quoteAsset,
                quoteDecimals: 18,
                phantomQuote: PHANTOM,
                graduationThreshold: SWEPT_QUOTE,
                economicsHash: QUOTE_ID,
                status: 1
            })
        );
    }

    function _plan(address quoteAsset) private view returns (GraduationPoolMath.PoolPlan memory) {
        PoolKey memory key = registry.canonicalPoolKey(MARKET_ID);
        uint256 poolMeme = SWEPT_MEME * SWEPT_QUOTE / (SWEPT_QUOTE + PHANTOM);
        return math.derive(key, quoteAsset, address(meme), SWEPT_QUOTE, poolMeme);
    }

    function _assetMints(GraduationPoolMath.PoolPlan memory plan, address quoteAsset)
        private
        view
        returns (uint256 quoteMint, uint256 memeMint)
    {
        PoolKey memory key = registry.canonicalPoolKey(MARKET_ID);
        return key.currency0 == quoteAsset ? (plan.mintAmount0, plan.mintAmount1) : (plan.mintAmount1, plan.mintAmount0);
    }

    function _assertCommittedPosition(address locker, GraduationPoolMath.PoolPlan memory plan) private view {
        assertGt(locker.code.length, 0);
        assertTrue(positionManager.usedCanonicalActions());
        assertEq(positionManager.nextTokenId(), 2);
        assertEq(positionManager.ownerOf(1), locker);
        (uint256 tokenId, bytes32 poolId) = PoolExecutionLocker(locker).lockedPosition();
        assertEq(tokenId, 1);
        assertEq(poolId, plan.poolId);
        assertEq(positionManager.getPositionLiquidity(tokenId), plan.liquidity);
        assertEq(hook.poolBinding(poolId).status, 3);
        MarketView memory value = registry.market(MARKET_ID);
        assertEq(value.runtime.launchPhase, 2);
        assertEq(value.runtime.poolId, poolId);
        assertEq(value.runtime.sourceVersion, 2);
    }
}
