// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
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
    IApprovedQuoteRegistry,
    IMarketRegistryV1,
    ILaunchTemplateRegistry,
    ITickerGardenMemeHook,
    ITickerGardenBaselineRegistry,
    LaunchTemplate,
    MarketView,
    PoolKey,
    QuoteAssetConfig,
    SwapParams,
    TickerGardenBaseline
} from "../../src/v1/interfaces/IV1Protocol.sol";
import {ApprovedQuoteRegistry} from "../../src/v1/modules/ApprovedQuoteRegistry.sol";
import {LaunchTemplateRegistry} from "../../src/v1/modules/LaunchTemplateRegistry.sol";
import {TickerGardenBaselineRegistry} from "../../src/v1/modules/TickerGardenBaselineRegistry.sol";
import {TickerGardenMemeHook} from "../../src/v1/modules/TickerGardenMemeHook.sol";
import {
    V1DeploymentConfig,
    V1DeploymentPlan,
    V4DeterministicDeploymentBuilder
} from "../v1/V4DeterministicDeploymentBuilder.sol";
import {
    V1DeploymentPayload,
    V1DeterministicDeploymentOrchestrator
} from "../v1/V1DeterministicDeploymentOrchestrator.sol";

interface ILocalHook {
    function beforeInitialize(address sender, PoolKey calldata key, uint160 sqrtPriceX96) external returns (bytes4);
    function afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        int256 delta,
        bytes calldata data
    ) external returns (bytes4, int128);
}

/// @dev Browser-test STOCK installed only on the disposable local chain.
contract LocalStakingStock is ERC20 {
    bytes32 public constant uid = 0x00000000000000000000000000000000aa1fee9afa45465cbc65157b4edf63f5;

    constructor() ERC20("Local Tesla Test Stock", "TSLA") {
        require(block.chainid == 46630, "LOCAL_CHAIN_ONLY");
    }

    function mint(address recipient, uint256 amount) external {
        require(block.chainid == 46630, "LOCAL_CHAIN_ONLY");
        _mint(recipient, amount);
    }
}

contract LocalPermit2 {
    struct PackedAllowance {
        uint160 amount;
        uint48 expiration;
        uint48 nonce;
    }

    mapping(address owner => mapping(address token => mapping(address spender => PackedAllowance data))) private
        _allowance;

    function allowance(address owner, address token, address spender)
        external
        view
        returns (uint160 amount, uint48 expiration, uint48 nonce)
    {
        PackedAllowance memory data = _allowance[owner][token][spender];
        return (data.amount, data.expiration, data.nonce);
    }

    function approve(address token, address spender, uint160 amount, uint48 expiration) external {
        PackedAllowance storage data = _allowance[msg.sender][token][spender];
        data.amount = amount;
        data.expiration = expiration;
    }

    function transferFrom(address from, address to, uint160 amount, address token) external {
        PackedAllowance storage data = _allowance[from][token][msg.sender];
        require(data.expiration >= block.timestamp, "permit2 allowance expired");
        require(data.amount >= amount, "permit2 allowance");
        data.amount -= amount;
        require(IERC20(token).transferFrom(from, to, amount), "token transfer");
    }
}

/// @dev Local-only v4 boundary. It supports graduation and deterministic fee
/// injection; it is not a swap-price implementation.
contract LocalPoolManager {
    address public positionManager;
    uint24 public lpFee;
    uint160 public sqrtPriceX96;

    receive() external payable {}

    function setPositionManager(address value) external {
        require(positionManager == address(0), "position manager set");
        positionManager = value;
    }

    function initialize(V4PoolKey memory key, uint160 initialSqrtPriceX96) external returns (int24 tick) {
        lpFee = key.fee;
        sqrtPriceX96 = initialSqrtPriceX96;
        ILocalHook(address(key.hooks))
            .beforeInitialize(
                msg.sender,
                PoolKey({
                    currency0: Currency.unwrap(key.currency0),
                    currency1: Currency.unwrap(key.currency1),
                    fee: key.fee,
                    tickSpacing: key.tickSpacing,
                    hooks: address(key.hooks)
                }),
                initialSqrtPriceX96
            );
        return TickMath.getTickAtSqrtPrice(initialSqrtPriceX96);
    }

    function extsload(bytes32) external view returns (bytes32) {
        return bytes32(uint256(sqrtPriceX96) | (uint256(lpFee) << 208));
    }

    function take(Currency currency, address to, uint256 amount) external {
        address asset = Currency.unwrap(currency);
        if (asset == address(0)) {
            (bool ok,) = payable(to).call{value: amount}("");
            require(ok, "native take");
        } else {
            require(IERC20(asset).transfer(to, amount), "token take");
        }
    }

    function quote(PoolKey calldata key, bool zeroForOne, uint128 amountIn) external view returns (uint256) {
        (uint256 reserveIn, uint256 reserveOut) = _reserves(key, zeroForOne, 0);
        return _netOutput(key, amountIn, reserveIn, reserveOut);
    }

    /// @dev Local-only constant-product swap used by the browser integration
    /// surface. The production router and PoolManager are exercised on Fork.
    function swap(PoolKey calldata key, bool zeroForOne, uint128 amountIn, address recipient, bool inputPrepaid)
        external
        payable
        returns (uint256 amountOut)
    {
        require(amountIn > 0 && recipient != address(0), "local swap input");
        address input = zeroForOne ? key.currency0 : key.currency1;
        if (input == address(0)) require(msg.value == amountIn && !inputPrepaid, "native input");
        else require(msg.value == 0 && inputPrepaid, "token input");
        (uint256 reserveIn, uint256 reserveOut) = _reserves(key, zeroForOne, amountIn);
        uint256 grossOut = _grossOutput(key.fee, amountIn, reserveIn, reserveOut);
        address output = zeroForOne ? key.currency1 : key.currency0;
        uint128 hookFee = _chargeHook(key, zeroForOne, amountIn, uint128(grossOut));
        amountOut = grossOut - hookFee;
        _transfer(output, recipient, amountOut);
    }

    function _chargeHook(PoolKey calldata key, bool zeroForOne, uint128 amountIn, uint128 grossOut)
        private
        returns (uint128)
    {
        int128 amount0 = zeroForOne ? int128(0) : int128(uint128(grossOut));
        int128 amount1 = zeroForOne ? int128(uint128(grossOut)) : int128(0);
        int256 delta = (int256(amount0) << 128) | int256(uint256(uint128(amount1)));
        (, int128 hookFee) = ILocalHook(key.hooks)
            .afterSwap(
                msg.sender,
                key,
                SwapParams({zeroForOne: zeroForOne, amountSpecified: -int256(uint256(amountIn)), sqrtPriceLimitX96: 0}),
                delta,
                ""
            );
        return uint128(hookFee);
    }

    function _reserves(PoolKey calldata key, bool zeroForOne, uint256 receivedInput)
        private
        view
        returns (uint256 reserveIn, uint256 reserveOut)
    {
        address input = zeroForOne ? key.currency0 : key.currency1;
        address output = zeroForOne ? key.currency1 : key.currency0;
        reserveIn = _balance(input) - receivedInput;
        reserveOut = _balance(output);
        require(reserveIn > 0 && reserveOut > 0, "local pool empty");
    }

    function _netOutput(PoolKey calldata key, uint128 amountIn, uint256 reserveIn, uint256 reserveOut)
        private
        view
        returns (uint256)
    {
        uint256 gross = _grossOutput(key.fee, amountIn, reserveIn, reserveOut);
        bytes32 poolId = keccak256(abi.encode(key));
        bytes32 marketId = ITickerGardenMemeHook(key.hooks).poolBinding(poolId).marketId;
        MarketView memory market = IMarketRegistryV1(ITickerGardenMemeHook(key.hooks).marketRegistry()).market(marketId);
        uint256 hookFee = gross / 100 + gross * market.config.creatorTaxBps / 10_000;
        return gross - hookFee;
    }

    function _grossOutput(uint24 fee, uint128 amountIn, uint256 reserveIn, uint256 reserveOut)
        private
        pure
        returns (uint256)
    {
        require(fee <= 10_000, "local LP fee");
        uint256 effective = uint256(amountIn) * (1_000_000 - fee) / 1_000_000;
        uint256 output = reserveOut * effective / (reserveIn + effective);
        require(output > 0 && output <= uint256(uint128(type(int128).max)), "local swap output");
        return output;
    }

    function _balance(address asset) private view returns (uint256) {
        return asset == address(0) ? address(this).balance : IERC20(asset).balanceOf(address(this));
    }

    function _transfer(address asset, address to, uint256 amount) private {
        if (asset == address(0)) {
            (bool ok,) = payable(to).call{value: amount}("");
            require(ok, "native output");
        } else {
            require(IERC20(asset).transfer(to, amount), "token output");
        }
    }

    /// @notice Produces one real Hook/FeeVault accounting event using a
    /// controlled swap delta. Fund this contract with the selected fee asset.
    function accrue(address hook, PoolKey calldata key, address feeAsset, uint128 base)
        external
        returns (int128 hookFee)
    {
        require(base > 0, "zero base");
        bool feeIsCurrency1 = feeAsset == key.currency1;
        require(feeIsCurrency1 || feeAsset == key.currency0, "fee asset");
        int128 amount0 = feeIsCurrency1 ? int128(0) : int128(base);
        int128 amount1 = feeIsCurrency1 ? int128(base) : int128(0);
        int256 delta = (int256(amount0) << 128) | int256(uint256(uint128(amount1)));
        (, hookFee) = ILocalHook(hook)
            .afterSwap(
                msg.sender,
                key,
                SwapParams({zeroForOne: feeIsCurrency1, amountSpecified: -int256(uint256(base)), sqrtPriceLimitX96: 0}),
                delta,
                ""
            );
    }
}

/// @dev Implements only the exact-input subset emitted by poolTrade.ts.
contract LocalSwapBoundary {
    struct QuoteExactInputSingleParams {
        V4PoolKey poolKey;
        bool zeroForOne;
        uint128 exactAmount;
        bytes hookData;
    }

    struct SwapExactInputParams {
        V4PoolKey poolKey;
        bool zeroForOne;
        uint128 amountIn;
        uint128 amountOutMinimum;
        uint256 minHopPriceX36;
        bytes hookData;
    }

    address public immutable poolManager;
    address public immutable permit2;

    constructor(address poolManager_, address permit2_) {
        poolManager = poolManager_;
        permit2 = permit2_;
    }

    function quoteExactInputSingle(QuoteExactInputSingleParams calldata params)
        external
        view
        returns (uint256 amountOut, uint256 gasEstimate)
    {
        require(params.hookData.length == 0, "hook data");
        V4PoolKey calldata poolKey = params.poolKey;
        PoolKey memory key = PoolKey({
            currency0: Currency.unwrap(poolKey.currency0),
            currency1: Currency.unwrap(poolKey.currency1),
            fee: poolKey.fee,
            tickSpacing: poolKey.tickSpacing,
            hooks: address(poolKey.hooks)
        });
        return (LocalPoolManager(payable(poolManager)).quote(key, params.zeroForOne, params.exactAmount), 300_000);
    }

    function execute(bytes calldata, bytes[] calldata inputs, uint256 deadline) external payable {
        require(block.timestamp <= deadline && inputs.length > 0, "local execute");
        (, bytes[] memory params) = abi.decode(inputs[0], (bytes, bytes[]));
        require(params.length == 3, "local actions");
        _executeSwap(params[0], params[1], params[2]);
    }

    function _executeSwap(bytes memory swapData, bytes memory settleData, bytes memory takeData) private {
        SwapExactInputParams memory swapParams = abi.decode(swapData, (SwapExactInputParams));
        require(swapParams.minHopPriceX36 == 0 && swapParams.hookData.length == 0, "local swap params");
        (address settleAsset, uint256 settleAmount) = abi.decode(settleData, (address, uint256));
        (address takeAsset,) = abi.decode(takeData, (address, uint256));
        address input = swapParams.zeroForOne
            ? Currency.unwrap(swapParams.poolKey.currency0)
            : Currency.unwrap(swapParams.poolKey.currency1);
        address output = swapParams.zeroForOne
            ? Currency.unwrap(swapParams.poolKey.currency1)
            : Currency.unwrap(swapParams.poolKey.currency0);
        require(settleAsset == input && settleAmount == swapParams.amountIn && takeAsset == output, "local assets");
        bool prepaid = input != address(0);
        if (prepaid) LocalPermit2(permit2).transferFrom(msg.sender, poolManager, swapParams.amountIn, input);
        V4PoolKey memory poolKey = swapParams.poolKey;
        PoolKey memory key = PoolKey({
            currency0: Currency.unwrap(poolKey.currency0),
            currency1: Currency.unwrap(poolKey.currency1),
            fee: poolKey.fee,
            tickSpacing: poolKey.tickSpacing,
            hooks: address(poolKey.hooks)
        });
        uint256 amountOut = LocalPoolManager(payable(poolManager)).swap{value: msg.value}(
            key, swapParams.zeroForOne, swapParams.amountIn, msg.sender, prepaid
        );
        require(amountOut >= swapParams.amountOutMinimum, "minimum output");
    }
}

contract LocalPositionManager {
    using PositionInfoLibrary for V4PoolKey;

    address public immutable poolManager;
    address public immutable permit2;
    uint256 public nextTokenId = 1;
    mapping(uint256 => address) public ownerOf;
    mapping(uint256 => PositionInfo) private infos;
    mapping(uint256 => V4PoolKey) private keys;
    mapping(uint256 => uint128) private liquidities;

    constructor(address poolManager_, address permit2_) {
        poolManager = poolManager_;
        permit2 = permit2_;
    }

    function modifyLiquidities(bytes calldata unlockData, uint256 deadline) external payable {
        require(block.timestamp <= deadline, "deadline");
        (bytes memory actions, bytes[] memory params) = abi.decode(unlockData, (bytes, bytes[]));
        require(actions.length == 2 && params.length == 2, "actions");
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
        require(hookData.length == 0 && liquidity <= type(uint128).max, "mint");
        uint256 nativeRequired =
            _settle(msg.sender, key.currency0, amount0Max) + _settle(msg.sender, key.currency1, amount1Max);
        require(msg.value == nativeRequired, "native");
        if (nativeRequired != 0) {
            (bool ok,) = payable(poolManager).call{value: nativeRequired}("");
            require(ok, "native settle");
        }
        uint256 tokenId = nextTokenId++;
        ownerOf[tokenId] = owner;
        keys[tokenId] = key;
        infos[tokenId] = PositionInfoLibrary.initialize(key, tickLower, tickUpper);
        liquidities[tokenId] = uint128(liquidity);
    }

    function getPoolAndPositionInfo(uint256 tokenId) external view returns (V4PoolKey memory, PositionInfo) {
        return (keys[tokenId], infos[tokenId]);
    }

    function getPositionLiquidity(uint256 tokenId) external view returns (uint128) {
        return liquidities[tokenId];
    }

    function _settle(address payer, Currency currency, uint160 amount) private returns (uint256) {
        address asset = Currency.unwrap(currency);
        if (asset == address(0)) return amount;
        LocalPermit2(permit2).transferFrom(payer, poolManager, amount, asset);
        return 0;
    }
}

contract LocalCodeAnchor {}

contract LocalTreasury {
    receive() external payable {}
}

contract LocalCreatorClaimScript is Script {
    address private constant CANONICAL_PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    bytes32 private constant RELEASE_ID = keccak256("TICKERGARDEN_LOCAL_CREATOR_CLAIM_V1");
    bytes32 private constant FEE_POLICY_ID = keccak256("TICKERGARDEN_V1_FEE_POLICY_40_30_30");
    bytes32 private constant BASELINE_ID = keccak256("TICKERGARDEN_LOCAL_BASELINE");
    bytes32 private constant TEMPLATE_ID = keccak256("TICKERGARDEN_LOCAL_TEMPLATE");
    bytes32 private constant EXECUTION_SPEC_ID = keccak256("V1-EXEC-11");

    function run() external {
        require(block.chainid == 46630, "LOCAL_CHAIN_ID");
        uint256 privateKey = vm.envUint("LOCAL_DEPLOYER_PRIVATE_KEY");
        address admin = vm.addr(privateKey);
        vm.startBroadcast(privateKey);

        LocalPermit2 permit2 = new LocalPermit2();
        LocalPoolManager poolManager = new LocalPoolManager();
        LocalPositionManager positionManager = new LocalPositionManager(address(poolManager), address(permit2));
        poolManager.setPositionManager(address(positionManager));
        LocalTreasury treasury = new LocalTreasury();
        LocalCodeAnchor referenceFactory = new LocalCodeAnchor();

        V1DeploymentConfig memory config = V1DeploymentConfig({
            initialAdmin: admin,
            poolManager: address(poolManager),
            positionManager: address(positionManager),
            platformTreasury: address(treasury),
            feePolicyId: FEE_POLICY_ID
        });
        V1DeterministicDeploymentOrchestrator orchestrator =
            new V1DeterministicDeploymentOrchestrator(admin, RELEASE_ID);
        (bytes32 helperSalt,) =
            V4DeterministicDeploymentBuilder.mineHelperSalt(address(orchestrator), RELEASE_ID, 500_000);
        bytes32 factorySalt = V4DeterministicDeploymentBuilder.factorySalt(block.chainid, RELEASE_ID);
        (V1DeploymentPlan memory plan, V1DeploymentPayload memory payload) =
            V4DeterministicDeploymentBuilder.build(address(orchestrator), config, helperSalt, factorySalt);
        orchestrator.deploy(payload, plan.payloadHash);

        TickerGardenBaselineRegistry(plan.ordinaryComponents[3])
            .addBaseline(
                BASELINE_ID,
                TickerGardenBaseline({
                    referenceChainId: block.chainid,
                    referenceFactory: address(referenceFactory),
                    referenceFactoryCodeHash: address(referenceFactory).codehash,
                    launchConfigId: 0,
                    supply: 1_000_000_000 ether,
                    curveFeeBps: 100,
                    poolFee: 0,
                    tickSpacing: 200,
                    behaviorVectorRoot: keccak256("LOCAL_CREATOR_CLAIM_VECTOR"),
                    status: 1
                })
            );
        bytes32 quoteId = keccak256(
            abi.encode(
                keccak256("TICKERGARDEN_V1_QUOTE_ECONOMICS"),
                uint256(1),
                block.chainid,
                BASELINE_ID,
                address(0),
                uint8(18),
                0.168 ether,
                0.42 ether
            )
        );
        ApprovedQuoteRegistry(plan.ordinaryComponents[2])
            .addQuoteConfig(
                quoteId,
                QuoteAssetConfig({
                    tickerGardenBaselineId: BASELINE_ID,
                    quoteAsset: address(0),
                    quoteDecimals: 18,
                    phantomQuote: 0.168 ether,
                    graduationThreshold: 0.42 ether,
                    economicsHash: quoteId,
                    status: 1
                })
            );
        LaunchTemplateRegistry(plan.ordinaryComponents[4])
            .addLaunchTemplate(
                TEMPLATE_ID,
                LaunchTemplate({
                    memeTokenImplementation: plan.ordinaryComponents[6],
                    memeTokenCodeHash: plan.ordinaryComponents[6].codehash,
                    curveImplementation: plan.ordinaryComponents[7],
                    curveCodeHash: plan.ordinaryComponents[7].codehash,
                    gaugeImplementation: plan.ordinaryComponents[8],
                    gaugeCodeHash: plan.ordinaryComponents[8].codehash,
                    graduatedHook: plan.hook,
                    hookCodeHash: plan.hook.codehash,
                    graduationExecutor: plan.executor,
                    graduationExecutorCodeHash: plan.executor.codehash,
                    feePolicyId: FEE_POLICY_ID,
                    executionSpecId: EXECUTION_SPEC_ID,
                    status: 1
                })
            );
        new LocalSwapBoundary(address(poolManager), CANONICAL_PERMIT2);
        vm.stopBroadcast();

        console2.log("LOCAL_FACTORY", plan.factory);
        console2.log("LOCAL_POOL_MANAGER", address(poolManager));
        console2.log("LOCAL_PLATFORM_TREASURY", address(treasury));
        console2.log("LOCAL_RELEASE_ID");
        console2.logBytes32(RELEASE_ID);
        console2.log("LOCAL_BASELINE_ID");
        console2.logBytes32(BASELINE_ID);
        console2.log("LOCAL_QUOTE_ID");
        console2.logBytes32(quoteId);
        console2.log("LOCAL_TEMPLATE_ID");
        console2.logBytes32(TEMPLATE_ID);
        console2.log("LOCAL_HOOK", plan.hook);
        console2.log("LOCAL_OFFICIAL_STOCK_REGISTRY", plan.ordinaryComponents[1]);
        console2.log("LOCAL_APPROVED_QUOTE_REGISTRY", plan.ordinaryComponents[2]);
        console2.log("LOCAL_BASELINE_REGISTRY", plan.ordinaryComponents[3]);
        console2.log("LOCAL_TEMPLATE_REGISTRY", plan.ordinaryComponents[4]);
        console2.log("LOCAL_LAUNCH_ROUTER", plan.ordinaryComponents[9]);
        console2.log("LOCAL_MARKET_REGISTRY", plan.ordinaryComponents[10]);
        console2.log("LOCAL_CREATOR_REGISTRY", plan.ordinaryComponents[11]);
        console2.log("LOCAL_ALLOCATION_MANAGER", plan.ordinaryComponents[12]);
        console2.log("LOCAL_USER_STOCK_VAULT", plan.ordinaryComponents[13]);
        console2.log("LOCAL_HOLDER_DISTRIBUTOR", plan.ordinaryComponents[14]);
        console2.log("LOCAL_FEE_VAULT", plan.ordinaryComponents[15]);
    }
}
