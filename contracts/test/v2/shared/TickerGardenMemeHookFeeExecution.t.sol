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
} from "../../../src/v2/interfaces/IV2Protocol.sol";
import {TickerGardenMemeHookBinding} from "../../../src/v2/shared/TickerGardenMemeHookBinding.sol";
import {TickerGardenMemeHookFeeExecution} from "../../../src/v2/shared/TickerGardenMemeHookFeeExecution.sol";
import {ProtocolFeeVaultV4Credit} from "../../../src/v2/shared/ProtocolFeeVaultV4Credit.sol";
import {MockExactQuoteToken} from "../mocks/MockV2QuoteAssets.sol";

contract HookFeeExecutionDependencyMock {}

contract HookFeeExecutionRegistryMock {
    mapping(bytes32 marketId => MarketView value) private _markets;
    mapping(bytes32 marketId => PoolKey key) private _keys;

    function configure(bytes32 marketId, MarketView calldata value, PoolKey calldata key) external {
        _markets[marketId] = value;
        _keys[marketId] = key;
    }

    function market(bytes32 marketId) external view returns (MarketView memory) {
        return _markets[marketId];
    }

    function canonicalPoolKey(bytes32 marketId) external view returns (PoolKey memory) {
        return _keys[marketId];
    }
}

contract HookFeeExecutionVault is ProtocolFeeVaultV4Credit {
    V4CreditRecord private _lastRecord;
    uint256 public recordCount;
    bool public failRecord;

    error ForcedRecordFailure();

    constructor(address registry, address poolManager) ProtocolFeeVaultV4Credit(registry, poolManager) {}

    function setFailRecord(bool value) external {
        failRecord = value;
    }

    function lastRecord() external view returns (V4CreditRecord memory) {
        return _lastRecord;
    }

    function creditState() external view returns (uint8 state) {
        (state,) = _pendingV4Credit();
    }

    function _recordExactV4Credit(V4CreditRecord memory record) internal override {
        if (failRecord) revert ForcedRecordFailure();
        _lastRecord = record;
        recordCount += 1;
    }
}

contract HookFeeExecutionPoolManagerMock {
    bytes32 private constant POOLS_SLOT = bytes32(uint256(6));

    address public feeVault;
    address private _activeHook;
    mapping(address currency => int256 delta) public hookDelta;
    mapping(bytes32 slot => bytes32 value) private _externalStorage;

    uint256 public swapCount;
    uint256 public donateCount;
    uint256 public takeCount;
    uint256 public lastAmount0;
    uint256 public lastAmount1;
    address public lastTakenAsset;
    uint256 public lastTakenAmount;
    bool public failDonate;
    bool public failTake;
    bool public shortTransfer;
    bool public hasInRangeLiquidity = true;

    error InvalidActionOrder();
    error ForcedDonateFailure();
    error ForcedTakeFailure();
    error NoLiquidityToReceiveFees();
    error CurrencyNotSettled(address currency, int256 delta);
    error TokenTransferFailed();

    function setFeeVault(address value) external {
        require(feeVault == address(0));
        feeVault = value;
    }

    function setFailures(bool donateFailure, bool takeFailure, bool shortTransfer_) external {
        failDonate = donateFailure;
        failTake = takeFailure;
        shortTransfer = shortTransfer_;
    }

    function setCoreFees(bytes32 poolId, uint24 protocolFee, uint24 lpFee) external {
        bytes32 slot = keccak256(abi.encodePacked(poolId, POOLS_SLOT));
        _externalStorage[slot] = bytes32((uint256(lpFee) << 208) | (uint256(protocolFee) << 184));
    }

    function setHasInRangeLiquidity(bool value) external {
        hasInRangeLiquidity = value;
    }

    function extsload(bytes32 slot) external view returns (bytes32 value) {
        return _externalStorage[slot];
    }

    function swap(
        ITickerGardenMemeHook hook,
        PoolKey calldata key,
        SwapParams calldata params,
        int256 coreDelta,
        bytes calldata hookData
    ) external returns (bytes4 selector, int128 hookFeeDelta) {
        if (_activeHook != address(0)) revert InvalidActionOrder();
        _activeHook = address(hook);
        swapCount += 1;
        (selector, hookFeeDelta) = hook.afterSwap(msg.sender, key, params, coreDelta, hookData);
        address feeAsset = (params.amountSpecified < 0) == params.zeroForOne ? key.currency1 : key.currency0;
        hookDelta[feeAsset] += hookFeeDelta;
        if (hookDelta[key.currency0] != 0) {
            revert CurrencyNotSettled(key.currency0, hookDelta[key.currency0]);
        }
        if (hookDelta[key.currency1] != 0) {
            revert CurrencyNotSettled(key.currency1, hookDelta[key.currency1]);
        }
        if (HookFeeExecutionVault(payable(feeVault)).creditState() != 0) revert InvalidActionOrder();
        _activeHook = address(0);
    }

    function donate(PoolKey calldata key, uint256 amount0, uint256 amount1, bytes calldata) external returns (int256) {
        if (msg.sender != _activeHook || HookFeeExecutionVault(payable(feeVault)).creditState() != 1) {
            revert InvalidActionOrder();
        }
        if (failDonate) revert ForcedDonateFailure();
        if (!hasInRangeLiquidity) revert NoLiquidityToReceiveFees();
        donateCount += 1;
        lastAmount0 = amount0;
        lastAmount1 = amount1;
        hookDelta[key.currency0] -= int256(amount0);
        hookDelta[key.currency1] -= int256(amount1);
        return 0;
    }

    function take(address currency, address to, uint256 amount) external {
        if (msg.sender != _activeHook || to != feeVault || HookFeeExecutionVault(payable(feeVault)).creditState() != 1) revert InvalidActionOrder();
        if (failTake) revert ForcedTakeFailure();

        takeCount += 1;
        lastTakenAsset = currency;
        lastTakenAmount = amount;
        hookDelta[currency] -= int256(amount);
        uint256 sent = shortTransfer ? amount - 1 : amount;
        if (currency == address(0)) {
            (bool success,) = payable(to).call{value: sent}("");
            if (!success) revert TokenTransferFailed();
        } else {
            (bool success, bytes memory result) =
                currency.call(abi.encodeCall(MockExactQuoteToken.transfer, (to, sent)));
            if (!success || result.length != 32 || !abi.decode(result, (bool))) revert TokenTransferFailed();
        }
    }

    receive() external payable {}
}

contract HookFeeExecutionCreate2Deployer {
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

contract TickerGardenMemeHookFeeExecutionHarness is TickerGardenMemeHookFeeExecution {
    constructor(address registry, address poolManager, address feeVault, address graduation, address controller)
        TickerGardenMemeHookFeeExecution(registry, poolManager, feeVault, graduation, controller)
    {}

    function seedActive(bytes32 marketId, PoolKey calldata key, uint32 sourceVersion) external {
        bytes32 poolId = keccak256(abi.encode(key));
        _marketIdsByPool[poolId] = marketId;
        _poolBindings[poolId] = PoolBinding({
            marketId: marketId, keyHash: poolId, sourceVersion: sourceVersion, feeNonce: 0, status: BINDING_ACTIVE
        });
    }
}

contract TickerGardenMemeHookFeeExecutionTest is Test {
    uint160 private constant MASK = 0x2044;
    uint160 private constant ALL_BITS = (1 << 14) - 1;
    bytes32 private constant MARKET_ID = keccak256("hook-fee-execution-market");
    address private constant QUOTE = address(0);

    HookFeeExecutionRegistryMock private registry;
    HookFeeExecutionPoolManagerMock private poolManager;
    HookFeeExecutionVault private feeVault;
    HookFeeExecutionDependencyMock private graduation;
    HookFeeExecutionDependencyMock private controller;
    HookFeeExecutionCreate2Deployer private deployer;
    MockExactQuoteToken private meme;
    TickerGardenMemeHookFeeExecutionHarness private hook;
    PoolKey private key;
    bytes32 private poolId;

    function setUp() public {
        registry = new HookFeeExecutionRegistryMock();
        poolManager = new HookFeeExecutionPoolManagerMock();
        feeVault = new HookFeeExecutionVault(address(registry), address(poolManager));
        poolManager.setFeeVault(address(feeVault));
        graduation = new HookFeeExecutionDependencyMock();
        controller = new HookFeeExecutionDependencyMock();
        deployer = new HookFeeExecutionCreate2Deployer();
        meme = new MockExactQuoteToken(18);
        meme.mint(address(poolManager), 1_000_000 ether);
        vm.deal(address(poolManager), 1_000_000 ether);
        hook = _deployHook();
        key = PoolKey({currency0: QUOTE, currency1: address(meme), fee: 0, tickSpacing: 60, hooks: address(hook)});
        poolId = keccak256(abi.encode(key));
        _configure();
        hook.seedActive(MARKET_ID, key, 2);
    }

    function test_erc20AfterSwapDonatesTakesCreditsAndNetsHookDeltaToZero() public {
        SwapParams memory params = _params(true, -1);
        bytes32 expectedFeeId = _feeId(address(meme), 12_345, 123, 1);
        vm.expectEmit(true, true, true, true, address(hook));
        emit ITickerGardenMemeHook.V4FeeAccrued(MARKET_ID, poolId, address(meme), 1, expectedFeeId, 12_345, 123, 24, 99);

        (bytes4 selector, int128 returnedDelta) =
            poolManager.swap(hook, key, params, _delta(-20_000, 12_345), "forged-market-id");

        assertEq(selector, ITickerGardenMemeHook.afterSwap.selector);
        assertEq(returnedDelta, 123);
        assertEq(poolManager.donateCount(), 1);
        assertEq(poolManager.lastAmount0(), 0);
        assertEq(poolManager.lastAmount1(), 24);
        assertEq(poolManager.takeCount(), 1);
        assertEq(poolManager.lastTakenAsset(), address(meme));
        assertEq(poolManager.lastTakenAmount(), 99);
        assertEq(meme.balanceOf(address(feeVault)), 99);
        assertEq(meme.balanceOf(address(hook)), 0);
        assertEq(poolManager.hookDelta(address(meme)), 0);
        _assertRecord(address(meme), 12_345, 123, 24, 99, 1, expectedFeeId);
    }

    function test_nativeAfterSwapTransfersExactNonLpAmountAndDonatesCurrency0() public {
        uint256 managerBefore = address(poolManager).balance;
        SwapParams memory params = _params(true, 1);
        (bytes4 selector, int128 returnedDelta) = poolManager.swap(hook, key, params, _delta(-10_000, 9_000), "ignored");

        assertEq(selector, ITickerGardenMemeHook.afterSwap.selector);
        assertEq(returnedDelta, 100);
        assertEq(poolManager.lastAmount0(), 20);
        assertEq(poolManager.lastAmount1(), 0);
        assertEq(poolManager.lastTakenAsset(), QUOTE);
        assertEq(poolManager.lastTakenAmount(), 80);
        assertEq(address(feeVault).balance, 80);
        assertEq(address(poolManager).balance, managerBefore - 80);
        assertEq(address(hook).balance, 0);
        assertEq(poolManager.hookDelta(QUOTE), 0);
        _assertRecord(QUOTE, 10_000, 100, 20, 80, 1, _feeId(QUOTE, 10_000, 100, 1));
    }

    function test_zeroFeeDoesNotCallDonateTakeVaultOrConsumeNonce() public {
        (bytes4 selector, int128 returnedDelta) =
            poolManager.swap(hook, key, _params(true, -1), _delta(-1, 99), "ignored");
        assertEq(selector, ITickerGardenMemeHook.afterSwap.selector);
        assertEq(returnedDelta, 0);
        assertEq(poolManager.donateCount(), 0);
        assertEq(poolManager.takeCount(), 0);
        assertEq(feeVault.recordCount(), 0);
        assertEq(hook.poolBinding(poolId).feeNonce, 0);
    }

    function test_oneUnitTotalFeeSkipsZeroDonationButStillCreditsExactTake() public {
        (, int128 returnedDelta) = poolManager.swap(hook, key, _params(true, -1), _delta(-1, 100), "ignored");
        assertEq(returnedDelta, 1);
        assertEq(poolManager.donateCount(), 0);
        assertEq(poolManager.takeCount(), 1);
        assertEq(poolManager.lastTakenAmount(), 1);
        assertEq(meme.balanceOf(address(feeVault)), 1);
        _assertRecord(address(meme), 100, 1, 0, 1, 1, _feeId(address(meme), 100, 1, 1));
    }

    function test_donateFailureRollsBackNoncePendingStateAndEveryEffect() public {
        poolManager.setFailures(true, false, false);
        vm.expectRevert(HookFeeExecutionPoolManagerMock.ForcedDonateFailure.selector);
        poolManager.swap(hook, key, _params(true, -1), _delta(-1, 10_000), "ignored");
        _assertNoEffects(address(meme));
    }

    function test_takeFailureRollsBackPriorDonationAndPendingCredit() public {
        poolManager.setFailures(false, true, false);
        vm.expectRevert(HookFeeExecutionPoolManagerMock.ForcedTakeFailure.selector);
        poolManager.swap(hook, key, _params(true, -1), _delta(-1, 10_000), "ignored");
        _assertNoEffects(address(meme));
    }

    function test_inexactErc20ArrivalRollsBackTransferDonationNonceAndVault() public {
        poolManager.setFailures(false, false, true);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolFeeVaultV4Credit.FeeBalanceDeltaMismatch.selector, address(meme), uint256(80), uint256(79)
            )
        );
        poolManager.swap(hook, key, _params(true, -1), _delta(-1, 10_000), "ignored");
        _assertNoEffects(address(meme));
    }

    function test_downstreamVaultRecordFailureRollsBackTakeDonateNonceAndEvent() public {
        feeVault.setFailRecord(true);
        vm.recordLogs();
        vm.expectRevert(HookFeeExecutionVault.ForcedRecordFailure.selector);
        poolManager.swap(hook, key, _params(true, -1), _delta(-1, 10_000), "ignored");
        assertEq(vm.getRecordedLogs().length, 0);
        _assertNoEffects(address(meme));
    }

    function test_successiveSwapsUseMonotonicNonceAndDistinctCanonicalFeeIds() public {
        poolManager.swap(hook, key, _params(true, -1), _delta(-1, 10_000), "first");
        bytes32 firstFeeId = feeVault.lastRecord().feeId;
        poolManager.swap(hook, key, _params(true, -1), _delta(-1, 10_000), "second");
        ProtocolFeeVaultV4Credit.V4CreditRecord memory second = feeVault.lastRecord();
        assertEq(second.feeNonce, 2);
        assertTrue(firstFeeId != second.feeId);
        assertEq(second.feeId, _feeId(address(meme), 10_000, 100, 2));
        assertEq(hook.poolBinding(poolId).feeNonce, 2);
        assertEq(feeVault.recordCount(), 2);
        assertEq(meme.balanceOf(address(feeVault)), 160);
    }

    function test_nonPoolManagerCannotEnterCanonicalAfterSwap() public {
        SwapParams memory params = _params(true, -1);
        vm.expectRevert(
            abi.encodeWithSelector(
                TickerGardenMemeHookBinding.UnauthorizedHookCaller.selector, address(this), address(poolManager)
            )
        );
        hook.afterSwap(address(this), key, params, _delta(-1, 10_000), "ignored");
    }

    function test_nonzeroLpFeeFailsClosedBeforeAnyFeeActionAndCanRetry() public {
        poolManager.setCoreFees(poolId, 0, 3_000);
        vm.expectRevert(
            abi.encodeWithSelector(
                TickerGardenMemeHookFeeExecution.NonzeroCorePoolFee.selector, poolId, uint24(0), uint24(3_000)
            )
        );
        poolManager.swap(hook, key, _params(true, -1), _delta(-1, 10_000), "ignored");
        _assertNoEffects(address(meme));

        poolManager.setCoreFees(poolId, 0, 0);
        (, int128 returnedDelta) = poolManager.swap(hook, key, _params(true, -1), _delta(-1, 10_000), "retry");
        assertEq(returnedDelta, 100);
        assertEq(hook.poolBinding(poolId).feeNonce, 1);
    }

    function test_eitherPackedProtocolFeeDirectionFailsClosedIncludingZeroTotalFee() public {
        poolManager.setCoreFees(poolId, 1, 0);
        vm.expectRevert(
            abi.encodeWithSelector(
                TickerGardenMemeHookFeeExecution.NonzeroCorePoolFee.selector, poolId, uint24(1), uint24(0)
            )
        );
        poolManager.swap(hook, key, _params(true, -1), _delta(-1, 99), "zero-total-fee");
        _assertNoEffects(address(meme));

        poolManager.setCoreFees(poolId, uint24(1 << 12), 0);
        vm.expectRevert(
            abi.encodeWithSelector(
                TickerGardenMemeHookFeeExecution.NonzeroCorePoolFee.selector, poolId, uint24(1 << 12), uint24(0)
            )
        );
        poolManager.swap(hook, key, _params(true, -1), _delta(-1, 10_000), "other-direction");
        _assertNoEffects(address(meme));
    }

    function test_nonzeroPoolKeyFeeCannotReachCoreOrConsumeNonce() public {
        PoolKey memory wrongKey = key;
        wrongKey.fee = 1;
        bytes32 wrongPoolId = keccak256(abi.encode(wrongKey));
        vm.expectRevert(abi.encodeWithSelector(TickerGardenMemeHookBinding.PoolBindingNotActive.selector, wrongPoolId));
        poolManager.swap(hook, wrongKey, _params(true, -1), _delta(-1, 10_000), "ignored");
        _assertNoEffects(address(meme));
    }

    function test_noInRangeLiquidityRollsBackCoreSwapNonceCreditAndEvent() public {
        poolManager.setHasInRangeLiquidity(false);
        vm.recordLogs();
        vm.expectRevert(HookFeeExecutionPoolManagerMock.NoLiquidityToReceiveFees.selector);
        poolManager.swap(hook, key, _params(true, -1), _delta(-1, 10_000), "ignored");
        assertEq(vm.getRecordedLogs().length, 0);
        _assertNoEffects(address(meme));
    }

    function test_noInRangeLiquidityDoesNotBlockZeroLpDonationCase() public {
        poolManager.setHasInRangeLiquidity(false);
        (, int128 returnedDelta) = poolManager.swap(hook, key, _params(true, -1), _delta(-1, 100), "ignored");
        assertEq(returnedDelta, 1);
        assertEq(poolManager.swapCount(), 1);
        assertEq(poolManager.donateCount(), 0);
        assertEq(poolManager.takeCount(), 1);
        assertEq(hook.poolBinding(poolId).feeNonce, 1);
    }

    function _assertNoEffects(address feeAsset) private view {
        assertEq(hook.poolBinding(poolId).feeNonce, 0);
        assertEq(feeVault.creditState(), 0);
        assertEq(feeVault.recordCount(), 0);
        assertEq(meme.balanceOf(address(feeVault)), 0);
        assertEq(poolManager.donateCount(), 0);
        assertEq(poolManager.takeCount(), 0);
        assertEq(poolManager.swapCount(), 0);
        assertEq(poolManager.hookDelta(feeAsset), 0);
    }

    function _assertRecord(
        address feeAsset,
        uint256 base,
        uint256 totalFee,
        uint256 lpAmount,
        uint256 nonLpAmount,
        uint64 nonce,
        bytes32 expectedFeeId
    ) private view {
        ProtocolFeeVaultV4Credit.V4CreditRecord memory record = feeVault.lastRecord();
        assertEq(record.marketId, MARKET_ID);
        assertEq(record.feeAsset, feeAsset);
        assertEq(record.base, base);
        assertEq(record.totalFee, totalFee);
        assertEq(record.lpAmount, lpAmount);
        assertEq(record.nonLpAmount, nonLpAmount);
        assertEq(record.sourceVersion, 2);
        assertEq(record.feeNonce, nonce);
        assertEq(record.feeId, expectedFeeId);
        assertEq(feeVault.recordCount(), nonce);
    }

    function _configure() private {
        MarketConfig memory config;
        config.quoteAsset = QUOTE;
        config.memeToken = address(meme);
        config.graduatedHook = address(hook);
        MarketRuntime memory runtime;
        runtime.launchPhase = 2;
        runtime.marketStatus = 0;
        runtime.poolId = poolId;
        runtime.sourceVersion = 2;
        registry.configure(MARKET_ID, MarketView({config: config, runtime: runtime}), key);
    }

    function _feeId(address feeAsset, uint256 base, uint256 totalFee, uint64 nonce) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("TICKERGARDEN_V2_V4_FEE"),
                uint256(1),
                block.chainid,
                address(feeVault),
                address(poolManager),
                poolId,
                MARKET_ID,
                uint32(2),
                nonce,
                feeAsset,
                base,
                totalFee,
                hookFeePolicyHash()
            )
        );
    }

    function hookFeePolicyHash() private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("TICKERGARDEN_V2_FEE_POLICY"),
                uint256(2),
                keccak256("V2-EXEC-3"),
                uint24(10_000),
                uint16(2_000),
                uint24(0),
                uint160(MASK),
                uint8(1),
                uint256(10),
                uint8(1)
            )
        );
    }

    function _params(bool zeroForOne, int256 amountSpecified) private pure returns (SwapParams memory) {
        return SwapParams({zeroForOne: zeroForOne, amountSpecified: amountSpecified, sqrtPriceLimitX96: 1});
    }

    function _delta(int128 amount0, int128 amount1) private pure returns (int256) {
        return BalanceDelta.unwrap(toBalanceDelta(amount0, amount1));
    }

    function _deployHook() private returns (TickerGardenMemeHookFeeExecutionHarness result) {
        bytes memory initCode = abi.encodePacked(
            type(TickerGardenMemeHookFeeExecutionHarness).creationCode,
            abi.encode(
                address(registry), address(poolManager), address(feeVault), address(graduation), address(controller)
            )
        );
        bytes32 initCodeHash = keccak256(initCode);
        for (uint256 nonce; nonce < 100_000; ++nonce) {
            bytes32 salt = bytes32(nonce);
            address predicted = address(
                uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(deployer), salt, initCodeHash))))
            );
            if (uint160(predicted) & ALL_BITS == MASK) {
                return TickerGardenMemeHookFeeExecutionHarness(deployer.deploy(initCode, salt));
            }
        }
        revert("HOOK_SALT_NOT_FOUND");
    }
}
