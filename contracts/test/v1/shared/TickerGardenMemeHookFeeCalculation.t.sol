// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {BalanceDelta, toBalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";

import {
    ITickerGardenMemeHook,
    MarketConfig,
    MarketRuntime,
    MarketView,
    PoolBinding,
    PoolKey,
    SwapParams
} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {TickerGardenMemeHookBinding} from "../../../src/v1/shared/TickerGardenMemeHookBinding.sol";
import {TickerGardenMemeHookFeeCalculation} from "../../../src/v1/shared/TickerGardenMemeHookFeeCalculation.sol";
import {V1MarketEconomics} from "../../../src/v1/shared/V1MarketEconomics.sol";

contract HookFeeCalculationDependencyMock {}

contract HookFeeCalculationRegistryMock {
    mapping(bytes32 marketId => MarketView value) private _markets;
    mapping(bytes32 marketId => PoolKey key) private _keys;
    address public graduationExecutor;

    function setGraduationExecutor(address value) external {
        graduationExecutor = value;
    }

    function configure(bytes32 marketId, MarketView calldata value, PoolKey calldata key) external {
        _markets[marketId] = value;
        _keys[marketId] = key;
    }

    function setCreatorTaxBps(bytes32 marketId, uint16 creatorTaxBps) external {
        _markets[marketId].config.creatorTaxBps = creatorTaxBps;
    }

    function market(bytes32 marketId) external view returns (MarketView memory) {
        return _markets[marketId];
    }

    function canonicalPoolKey(bytes32 marketId) external view returns (PoolKey memory) {
        return _keys[marketId];
    }
}

contract HookFeeCalculationCreate2Deployer {
    function deploy(bytes memory initCode, bytes32 salt) external returns (address deployed) {
        assembly ("memory-safe") {
            deployed := create2(0, add(initCode, 0x20), mload(initCode), salt)
            if iszero(deployed) {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }
        }
    }
}

contract HookFeeCalculationPoolManagerMock {
    function prepare(
        TickerGardenMemeHookFeeCalculationHarness hook,
        PoolKey calldata key,
        SwapParams calldata params,
        int256 coreDelta
    ) external returns (TickerGardenMemeHookFeeCalculation.CalculatedV4Fee memory) {
        return hook.prepare(key, params, coreDelta);
    }
}

contract TickerGardenMemeHookFeeCalculationHarness is TickerGardenMemeHookFeeCalculation {
    function convertRewards(bytes32, uint256, uint256, uint256) external pure override returns (uint256, uint256) {
        revert("UNSUPPORTED_TEST_LAYER");
    }

    function unlockCallback(bytes calldata) external pure override returns (bytes memory) {
        revert("UNSUPPORTED_TEST_LAYER");
    }

    constructor(address registry, address poolManager, address feeVault, address graduation)
        TickerGardenMemeHookFeeCalculation(registry, poolManager, feeVault, graduation)
    {}

    function prepare(PoolKey calldata key, SwapParams calldata params, int256 coreDelta)
        external
        returns (CalculatedV4Fee memory)
    {
        return _prepareV4Fee(key, params, coreDelta);
    }

    function seedActive(bytes32 marketId, PoolKey calldata key, uint32 sourceVersion) external {
        bytes32 poolId = keccak256(abi.encode(key));
        _marketIdsByPool[poolId] = marketId;
        _poolBindings[poolId] = PoolBinding({
            marketId: marketId, keyHash: poolId, sourceVersion: sourceVersion, feeNonce: 0, status: BINDING_ACTIVE
        });
    }

    function seedNonce(bytes32 poolId, uint64 feeNonce) external {
        _poolBindings[poolId].feeNonce = feeNonce;
    }

    function seedStatus(bytes32 poolId, uint8 status) external {
        _poolBindings[poolId].status = status;
    }

    function feePolicyHash() external view returns (bytes32) {
        return _hookFeePolicyHash;
    }

    function afterSwap(address, PoolKey calldata, SwapParams calldata, int256, bytes calldata)
        external
        pure
        override
        returns (bytes4, int128)
    {
        revert("C302_D_NOT_IMPLEMENTED");
    }
}

contract TickerGardenMemeHookFeeCalculationTest is Test {
    uint160 private constant MASK = 0x2044;
    uint160 private constant ALL_BITS = (1 << 14) - 1;
    bytes32 private constant MARKET_ID = keccak256("hook-fee-calculation-market");
    address private constant QUOTE = address(0);
    address private constant MEME = address(0xBEEF);

    HookFeeCalculationRegistryMock private registry;
    HookFeeCalculationPoolManagerMock private poolManager;
    HookFeeCalculationDependencyMock private feeVault;
    HookFeeCalculationDependencyMock private graduation;
    HookFeeCalculationCreate2Deployer private deployer;
    TickerGardenMemeHookFeeCalculationHarness private hook;
    PoolKey private key;
    bytes32 private poolId;

    function setUp() public {
        registry = new HookFeeCalculationRegistryMock();
        poolManager = new HookFeeCalculationPoolManagerMock();
        feeVault = new HookFeeCalculationDependencyMock();
        graduation = new HookFeeCalculationDependencyMock();
        registry.setGraduationExecutor(address(graduation));
        deployer = new HookFeeCalculationCreate2Deployer();
        hook = _deployHook();
        key = PoolKey({currency0: QUOTE, currency1: MEME, fee: 0, tickSpacing: 60, hooks: address(hook)});
        poolId = keccak256(abi.encode(key));
        _configure(key, poolId);
        hook.seedActive(MARKET_ID, key, 2);
    }

    function test_fourSwapQuadrantsSelectExactUnspecifiedAssetAndCoreDelta() public {
        int256 coreDelta = _delta(-10_000, 12_345);

        TickerGardenMemeHookFeeCalculation.CalculatedV4Fee memory fee = _prepare(true, -1, coreDelta);
        assertEq(fee.feeAsset, MEME);
        assertEq(fee.base, 12_345);

        fee = _prepare(true, 1, coreDelta);
        assertEq(fee.feeAsset, QUOTE);
        assertEq(fee.base, 10_000);

        fee = _prepare(false, -1, coreDelta);
        assertEq(fee.feeAsset, QUOTE);
        assertEq(fee.base, 10_000);

        fee = _prepare(false, 1, coreDelta);
        assertEq(fee.feeAsset, MEME);
        assertEq(fee.base, 12_345);
        assertEq(hook.poolBinding(poolId).feeNonce, 4);
    }

    function test_feeUsesFlooringAndCanonicalIdentityFields() public {
        TickerGardenMemeHookFeeCalculation.CalculatedV4Fee memory fee = _prepare(true, -1, _delta(-1, 12_345));
        assertEq(fee.marketId, MARKET_ID);
        assertEq(fee.poolId, poolId);
        assertEq(fee.sourceVersion, 2);
        assertEq(fee.base, 12_345);
        assertEq(fee.totalFee, 123);
        assertEq(fee.lpAmount, 0);
        assertEq(fee.nonLpAmount, 123);
        assertEq(fee.feeNonce, 1);
        assertEq(fee.feeId, _feeId(fee));
    }

    function test_creatorTax500IsIncludedForExactInputAndExactOutputUnspecifiedCurrency() public {
        registry.setCreatorTaxBps(MARKET_ID, 500);

        TickerGardenMemeHookFeeCalculation.CalculatedV4Fee memory exactInput = _prepare(true, -1, _delta(-1, 10_000));
        assertEq(exactInput.feeAsset, MEME);
        assertEq(exactInput.base, 10_000);
        assertEq(exactInput.totalFee, 600);
        assertEq(exactInput.nonLpAmount, 600);
        assertEq(exactInput.feeId, _feeId(exactInput));

        TickerGardenMemeHookFeeCalculation.CalculatedV4Fee memory exactOutput = _prepare(true, 1, _delta(10_000, -1));
        assertEq(exactOutput.feeAsset, QUOTE);
        assertEq(exactOutput.base, 10_000);
        assertEq(exactOutput.totalFee, 600);
        assertEq(exactOutput.nonLpAmount, 600);
        assertEq(exactOutput.feeId, _feeId(exactOutput));
    }

    function test_creatorTaxAndBaseFeeUseIndependentFloorRoundingForTinyAmount() public {
        registry.setCreatorTaxBps(MARKET_ID, 500);
        TickerGardenMemeHookFeeCalculation.CalculatedV4Fee memory fee = _prepare(true, -1, _delta(-1, 101));

        assertEq(fee.base, 101);
        assertEq(fee.totalFee, 6); // floor(101 * 1%) + floor(101 * 5%) = 1 + 5
        assertEq(fee.nonLpAmount, 6);
        assertEq(fee.feeNonce, 1);
        assertEq(fee.feeId, _feeId(fee));
    }

    function test_zeroOrSubMinimumFeeDoesNotConsumeNonceOrCreateFeeId() public {
        TickerGardenMemeHookFeeCalculation.CalculatedV4Fee memory fee = _prepare(true, -1, _delta(-1, 0));
        assertEq(fee.base, 0);
        assertEq(fee.totalFee, 0);
        assertEq(fee.feeNonce, 0);
        assertEq(fee.feeId, bytes32(0));

        fee = _prepare(true, -1, _delta(-1, 99));
        assertEq(fee.base, 99);
        assertEq(fee.totalFee, 0);
        assertEq(hook.poolBinding(poolId).feeNonce, 0);

        fee = _prepare(true, -1, _delta(-1, 100));
        assertEq(fee.totalFee, 1);
        assertEq(fee.lpAmount, 0);
        assertEq(fee.nonLpAmount, 1);
        assertEq(fee.feeNonce, 1);
    }

    function test_int128MinimumIsWidenedBeforeAbsoluteValue() public {
        TickerGardenMemeHookFeeCalculation.CalculatedV4Fee memory fee = _prepare(true, 1, _delta(type(int128).min, 1));
        uint256 expectedBase = uint256(1) << 127;
        assertEq(fee.base, expectedBase);
        assertEq(fee.totalFee, expectedBase / 100);
        assertLe(fee.totalFee, uint256(uint128(type(int128).max)));

        fee = _prepare(false, 1, _delta(1, type(int128).max));
        assertEq(fee.base, uint256(uint128(type(int128).max)));
    }

    function test_unselectedExtremeDeltaCannotChangeBaseOrAsset() public {
        TickerGardenMemeHookFeeCalculation.CalculatedV4Fee memory fee =
            _prepare(true, -1, _delta(type(int128).min, 1_000));
        assertEq(fee.feeAsset, MEME);
        assertEq(fee.base, 1_000);
        assertEq(fee.totalFee, 10);
    }

    function test_absoluteValueMakesEitherCoreDeltaSignChargeTheSameBase() public {
        TickerGardenMemeHookFeeCalculation.CalculatedV4Fee memory positive = _prepare(true, -1, _delta(0, 50_001));
        TickerGardenMemeHookFeeCalculation.CalculatedV4Fee memory negative = _prepare(true, -1, _delta(0, -50_001));
        assertEq(positive.base, negative.base);
        assertEq(positive.totalFee, negative.totalFee);
        assertEq(positive.feeAsset, negative.feeAsset);
    }

    function test_zeroAmountSpecifiedFailsBeforeNonceMutation() public {
        SwapParams memory params = SwapParams({zeroForOne: true, amountSpecified: 0, sqrtPriceLimitX96: 1});
        vm.expectRevert(
            abi.encodeWithSelector(TickerGardenMemeHookFeeCalculation.InvalidSwapAmountSpecified.selector, int256(0))
        );
        poolManager.prepare(hook, key, params, _delta(-1, 1_000));
        assertEq(hook.poolBinding(poolId).feeNonce, 0);
    }

    function test_nonCanonicalUnspecifiedAssetFailsClosed() public {
        PoolKey memory wrongKey = key;
        wrongKey.currency1 = address(0xCAFE);
        bytes32 wrongPoolId = keccak256(abi.encode(wrongKey));
        _configure(wrongKey, wrongPoolId);
        hook.seedActive(MARKET_ID, wrongKey, 2);

        SwapParams memory params = SwapParams({zeroForOne: true, amountSpecified: -1, sqrtPriceLimitX96: 1});
        vm.expectRevert(
            abi.encodeWithSelector(TickerGardenMemeHookFeeCalculation.FeeAssetNotCanonical.selector, address(0xCAFE))
        );
        poolManager.prepare(hook, wrongKey, params, _delta(-1, 1_000));
        assertEq(hook.poolBinding(wrongPoolId).feeNonce, 0);
    }

    function test_onlyPoolManagerAndActiveCanonicalSourceCanPrepareFee() public {
        SwapParams memory params = SwapParams({zeroForOne: true, amountSpecified: -1, sqrtPriceLimitX96: 1});
        vm.expectRevert(
            abi.encodeWithSelector(
                TickerGardenMemeHookBinding.UnauthorizedHookCaller.selector, address(this), address(poolManager)
            )
        );
        hook.prepare(key, params, _delta(-1, 1_000));

        hook.seedStatus(poolId, 4);
        vm.expectRevert(abi.encodeWithSelector(TickerGardenMemeHookBinding.PoolBindingNotActive.selector, poolId));
        poolManager.prepare(hook, key, params, _delta(-1, 1_000));
    }

    function test_feeNonceOverflowFailsClosedWithoutWrapOrFeeId() public {
        hook.seedNonce(poolId, type(uint48).max);
        SwapParams memory params = SwapParams({zeroForOne: true, amountSpecified: -1, sqrtPriceLimitX96: 1});
        vm.expectRevert(
            abi.encodeWithSelector(TickerGardenMemeHookFeeCalculation.HookFeeNonceOverflow.selector, poolId)
        );
        poolManager.prepare(hook, key, params, _delta(-1, 10_000));
        assertEq(hook.poolBinding(poolId).feeNonce, type(uint48).max);
    }

    function test_lastAdmittedLifetimeFeeCreditUsesUint48MaxNonce() public {
        hook.seedNonce(poolId, type(uint48).max - 1);
        TickerGardenMemeHookFeeCalculation.CalculatedV4Fee memory fee = _prepare(true, -1, _delta(-1, 10_000));

        assertEq(fee.feeNonce, type(uint48).max);
        assertEq(hook.poolBinding(poolId).feeNonce, type(uint48).max);
    }

    function test_feePolicyHashMatchesFeeVaultAndSuccessiveIdsCannotRepeat() public {
        bytes32 expectedPolicyHash = V1MarketEconomics.hashFeePolicy(
            V1MarketEconomics.FeePolicyInput({
                executionSpecId: keccak256("V1-EXEC-11"),
                feePips: 10_000,
                lpShareBps: 0,
                poolKeyFee: 0,
                hookPermissionMask: MASK,
                feeAssetMode: 1,
                stakerNonLpShareBps: 3_000,
                platformNonLpShareBps: 3_000
            })
        );
        assertEq(hook.feePolicyHash(), expectedPolicyHash);

        TickerGardenMemeHookFeeCalculation.CalculatedV4Fee memory first = _prepare(true, -1, _delta(-1, 10_000));
        TickerGardenMemeHookFeeCalculation.CalculatedV4Fee memory second = _prepare(true, -1, _delta(-1, 10_000));
        assertEq(first.feeNonce, 1);
        assertEq(second.feeNonce, 2);
        assertTrue(first.feeId != second.feeId);
        assertEq(first.feeId, _feeId(first));
        assertEq(second.feeId, _feeId(second));
    }

    function testFuzz_selectedDeltaAlwaysUsesExactInt128AbsoluteValue(int128 selected) public {
        TickerGardenMemeHookFeeCalculation.CalculatedV4Fee memory fee = _prepare(true, -1, _delta(777, selected));
        int256 widened = int256(selected);
        uint256 expected = widened < 0 ? uint256(-widened) : uint256(widened);
        assertEq(fee.feeAsset, MEME);
        assertEq(fee.base, expected);
        assertEq(fee.totalFee, expected / 100);
    }

    function _prepare(bool zeroForOne, int256 amountSpecified, int256 coreDelta)
        private
        returns (TickerGardenMemeHookFeeCalculation.CalculatedV4Fee memory)
    {
        SwapParams memory params =
            SwapParams({zeroForOne: zeroForOne, amountSpecified: amountSpecified, sqrtPriceLimitX96: 1});
        return poolManager.prepare(hook, key, params, coreDelta);
    }

    function _configure(PoolKey memory canonicalKey, bytes32 canonicalPoolId) private {
        MarketConfig memory config;
        config.quoteAsset = QUOTE;
        config.memeToken = MEME;
        config.graduatedHook = address(hook);
        MarketRuntime memory runtime;
        runtime.launchPhase = 1;
        runtime.poolId = canonicalPoolId;
        runtime.sourceVersion = 2;
        registry.configure(MARKET_ID, MarketView({config: config, runtime: runtime}), canonicalKey);
    }

    function _feeId(TickerGardenMemeHookFeeCalculation.CalculatedV4Fee memory fee) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("TICKERGARDEN_V1_V4_FEE"),
                uint256(1),
                block.chainid,
                address(feeVault),
                address(poolManager),
                fee.poolId,
                fee.marketId,
                fee.sourceVersion,
                fee.feeNonce,
                fee.feeAsset,
                fee.base,
                fee.totalFee,
                hook.feePolicyHash()
            )
        );
    }

    function _delta(int128 amount0, int128 amount1) private pure returns (int256) {
        return BalanceDelta.unwrap(toBalanceDelta(amount0, amount1));
    }

    function _deployHook() private returns (TickerGardenMemeHookFeeCalculationHarness result) {
        bytes memory initCode = abi.encodePacked(
            type(TickerGardenMemeHookFeeCalculationHarness).creationCode,
            abi.encode(address(registry), address(poolManager), address(feeVault), address(graduation))
        );
        bytes32 initCodeHash = keccak256(initCode);
        for (uint256 nonce; nonce < 100_000; ++nonce) {
            bytes32 salt = bytes32(nonce);
            address predicted = address(
                uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(deployer), salt, initCodeHash))))
            );
            if (uint160(predicted) & ALL_BITS == MASK) {
                return TickerGardenMemeHookFeeCalculationHarness(deployer.deploy(initCode, salt));
            }
        }
        revert("HOOK_SALT_NOT_FOUND");
    }
}
