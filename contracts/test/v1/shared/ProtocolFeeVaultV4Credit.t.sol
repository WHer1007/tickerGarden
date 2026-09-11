// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {MarketConfig, MarketRuntime, MarketView} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {ProtocolFeeVaultV4Credit} from "../../../src/v1/shared/ProtocolFeeVaultV4Credit.sol";
import {MockExactQuoteToken, MockFeeOnTransferQuoteToken} from "../mocks/MockV1QuoteAssets.sol";

interface IV4CreditVault {
    function beginV4Credit(bytes32, address, uint256, uint32, bytes32) external;
    function finalizeV4Credit(bytes32, address, uint256, uint256, uint256, uint256, uint64, bytes32) external;
}

contract FeeCreditMarketRegistryMock {
    mapping(bytes32 => MarketView) private _markets;

    function configure(
        bytes32 marketId,
        address hook,
        address quoteAsset,
        address memeToken,
        uint8 launchPhase,
        uint32 sourceVersion,
        bytes32 poolId
    ) external {
        MarketConfig memory config;
        config.quoteAsset = quoteAsset;
        config.memeToken = memeToken;
        config.graduatedHook = hook;
        MarketRuntime memory runtime;
        runtime.launchPhase = launchPhase;
        runtime.sourceVersion = sourceVersion;
        runtime.poolId = poolId;
        _markets[marketId] = MarketView({config: config, runtime: runtime});
    }

    function market(bytes32 marketId) external view returns (MarketView memory) {
        return _markets[marketId];
    }
}

contract FeeCreditPoolManagerMock {
    function takeNative(address payable recipient, uint256 amount) external payable {
        require(msg.value == amount, "VALUE");
        (bool success,) = recipient.call{value: amount}("");
        require(success, "TAKE");
    }
}

contract FeeFinalizeCallerMock {
    function finalize(IV4CreditVault vault, bytes32 marketId, address feeAsset, uint256 amount, bytes32 feeId)
        external
    {
        vault.finalizeV4Credit(marketId, feeAsset, 10_000, 100, 20, amount, 1, feeId);
    }
}

contract ProtocolFeeVaultV4CreditHarness is ProtocolFeeVaultV4Credit {
    bool public rejectRecord;
    bool public attemptReentry;
    bool public reentryRejected;
    uint256 public recordCount;
    bytes32 public lastRecordHash;

    constructor(address marketRegistry, address poolManager) ProtocolFeeVaultV4Credit(marketRegistry, poolManager) {}

    function setRecordBehavior(bool reject, bool reenter) external {
        rejectRecord = reject;
        attemptReentry = reenter;
    }

    function consumed(bytes32 feeId) external view returns (bool) {
        return _consumedFeeIds[feeId];
    }

    function pending() external view returns (uint8 state, bytes32 feeId, uint256 amount) {
        PendingV4Credit memory value;
        (state, value) = (_creditState, _pendingCredit);
        return (state, value.feeId, value.amount);
    }

    function _recordExactV4Credit(V4CreditRecord memory record, MarketView memory) internal override {
        if (rejectRecord) revert("RECORD_REJECTED");
        if (attemptReentry) {
            (bool success,) = address(this)
                .call(
                    abi.encodeCall(
                        IV4CreditVault.beginV4Credit,
                        (
                            record.marketId,
                            record.feeAsset,
                            record.nonLpAmount,
                            record.sourceVersion,
                            keccak256("REENTRANT")
                        )
                    )
                );
            reentryRejected = !success;
        }
        ++recordCount;
        lastRecordHash = keccak256(abi.encode(record));
    }
}

contract FeeCreditSourceMock {
    function creditErc20(
        IV4CreditVault vault,
        MockExactQuoteToken token,
        bytes32 marketId,
        uint32 sourceVersion,
        bytes32 feeId,
        uint256 declaredAmount,
        uint256 transferAmount
    ) external {
        vault.beginV4Credit(marketId, address(token), declaredAmount, sourceVersion, feeId);
        require(token.transfer(address(vault), transferAmount), "TRANSFER");
        vault.finalizeV4Credit(marketId, address(token), 10_000, 100, 20, declaredAmount, 1, feeId);
    }

    function creditNative(
        IV4CreditVault vault,
        FeeCreditPoolManagerMock poolManager,
        bytes32 marketId,
        uint32 sourceVersion,
        bytes32 feeId,
        uint256 amount
    ) external payable {
        require(msg.value == amount, "VALUE");
        vault.beginV4Credit(marketId, address(0), amount, sourceVersion, feeId);
        poolManager.takeNative{value: amount}(payable(address(vault)), amount);
        vault.finalizeV4Credit(marketId, address(0), 10_000, 100, 20, amount, 1, feeId);
    }

    function doubleBegin(
        IV4CreditVault vault,
        bytes32 marketId,
        address feeAsset,
        uint32 sourceVersion,
        bytes32 firstFeeId,
        bytes32 secondFeeId
    ) external {
        vault.beginV4Credit(marketId, feeAsset, 80, sourceVersion, firstFeeId);
        vault.beginV4Credit(marketId, feeAsset, 80, sourceVersion, secondFeeId);
    }

    function creditErc20WithFinalizeMismatch(
        IV4CreditVault vault,
        MockExactQuoteToken token,
        bytes32 marketId,
        uint32 sourceVersion,
        bytes32 feeId,
        bytes32 finalMarketId,
        address finalAsset,
        uint256 finalAmount,
        bytes32 finalFeeId
    ) external {
        vault.beginV4Credit(marketId, address(token), 80, sourceVersion, feeId);
        require(token.transfer(address(vault), 80), "TRANSFER");
        vault.finalizeV4Credit(finalMarketId, finalAsset, 10_000, 100, 20, finalAmount, 1, finalFeeId);
    }

    function creditErc20WithWrongFinalizer(
        IV4CreditVault vault,
        FeeFinalizeCallerMock finalizer,
        MockExactQuoteToken token,
        bytes32 marketId,
        uint32 sourceVersion,
        bytes32 feeId
    ) external {
        vault.beginV4Credit(marketId, address(token), 80, sourceVersion, feeId);
        require(token.transfer(address(vault), 80), "TRANSFER");
        finalizer.finalize(vault, marketId, address(token), 80, feeId);
    }

    function creditErc20WithVersionDrift(
        IV4CreditVault vault,
        FeeCreditMarketRegistryMock registry,
        MockExactQuoteToken token,
        bytes32 marketId,
        uint32 sourceVersion,
        bytes32 feeId,
        address memeToken
    ) external {
        vault.beginV4Credit(marketId, address(token), 80, sourceVersion, feeId);
        registry.configure(marketId, address(this), address(token), memeToken, 1, sourceVersion + 1, keccak256("POOL"));
        require(token.transfer(address(vault), 80), "TRANSFER");
        vault.finalizeV4Credit(marketId, address(token), 10_000, 100, 20, 80, 1, feeId);
    }
}

contract FeeBalanceMalformedMock {
    fallback() external {
        assembly ("memory-safe") {
            mstore(0, 1)
            return(0, 1)
        }
    }
}

contract ProtocolFeeVaultV4CreditTest is Test {
    bytes32 private constant MARKET_ID = keccak256("fee-credit-market");
    bytes32 private constant POOL_ID = keccak256("fee-credit-pool");
    uint32 private constant SOURCE_VERSION = 2;

    FeeCreditMarketRegistryMock private registry;
    FeeCreditPoolManagerMock private poolManager;
    ProtocolFeeVaultV4CreditHarness private vault;
    IV4CreditVault private creditVault;
    FeeCreditSourceMock private source;
    MockExactQuoteToken private quote;
    MockExactQuoteToken private meme;

    function setUp() public {
        registry = new FeeCreditMarketRegistryMock();
        poolManager = new FeeCreditPoolManagerMock();
        vault = new ProtocolFeeVaultV4CreditHarness(address(registry), address(poolManager));
        creditVault = IV4CreditVault(address(vault));
        source = new FeeCreditSourceMock();
        quote = new MockExactQuoteToken(6);
        meme = new MockExactQuoteToken(18);
        registry.configure(MARKET_ID, address(source), address(quote), address(meme), 1, SOURCE_VERSION, POOL_ID);
    }

    function test_exactErc20ArrivalConsumesFeeIdAndClearsPendingLock() public {
        bytes32 feeId = keccak256("ERC20");
        quote.mint(address(vault), 777);
        quote.mint(address(source), 80);
        source.creditErc20(creditVault, quote, MARKET_ID, SOURCE_VERSION, feeId, 80, 80);

        assertEq(quote.balanceOf(address(vault)), 857);
        assertTrue(vault.consumed(feeId));
        assertEq(vault.recordCount(), 1);
        (uint8 state, bytes32 pendingFeeId, uint256 pendingAmount) = vault.pending();
        assertEq(state, 0);
        assertEq(pendingFeeId, bytes32(0));
        assertEq(pendingAmount, 0);
    }

    function test_exactNativeArrivalAcceptsOnlyPoolManagerDuringPendingWindow() public {
        bytes32 feeId = keccak256("NATIVE");
        registry.configure(MARKET_ID, address(source), address(0), address(meme), 1, SOURCE_VERSION, POOL_ID);
        vm.deal(address(vault), 777);
        vm.deal(address(this), 80);
        source.creditNative{value: 80}(creditVault, poolManager, MARKET_ID, SOURCE_VERSION, feeId, 80);

        assertEq(address(vault).balance, 857);
        assertTrue(vault.consumed(feeId));
        assertEq(vault.recordCount(), 1);
    }

    function test_feeOnTransferMismatchRollsBackTransferBeginAndConsumption() public {
        MockFeeOnTransferQuoteToken taxed = new MockFeeOnTransferQuoteToken(6, 1_250);
        registry.configure(MARKET_ID, address(source), address(taxed), address(meme), 1, SOURCE_VERSION, POOL_ID);
        taxed.mint(address(source), 80);
        bytes32 feeId = keccak256("TAXED");

        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolFeeVaultV4Credit.FeeBalanceDeltaMismatch.selector,
                address(taxed),
                80,
                80 - (80 * 1_250 / 10_000)
            )
        );
        source.creditErc20(creditVault, taxed, MARKET_ID, SOURCE_VERSION, feeId, 80, 80);
        assertEq(taxed.balanceOf(address(source)), 80);
        assertEq(taxed.balanceOf(address(vault)), 0);
        assertFalse(vault.consumed(feeId));
        _assertNoPending();
    }

    function test_underOrOverpaymentRollsBackTheWholeAtomicCredit() public {
        quote.mint(address(source), 80);
        bytes32 feeId = keccak256("UNDERPAY");
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolFeeVaultV4Credit.FeeBalanceDeltaMismatch.selector, address(quote), 80, 79)
        );
        source.creditErc20(creditVault, quote, MARKET_ID, SOURCE_VERSION, feeId, 80, 79);
        assertEq(quote.balanceOf(address(source)), 80);
        assertEq(quote.balanceOf(address(vault)), 0);
        assertFalse(vault.consumed(feeId));
        _assertNoPending();

        quote.mint(address(source), 1);
        bytes32 overpayFeeId = keccak256("OVERPAY");
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolFeeVaultV4Credit.FeeBalanceDeltaMismatch.selector, address(quote), 80, 81)
        );
        source.creditErc20(creditVault, quote, MARKET_ID, SOURCE_VERSION, overpayFeeId, 80, 81);
        assertEq(quote.balanceOf(address(source)), 81);
        assertEq(quote.balanceOf(address(vault)), 0);
        assertFalse(vault.consumed(overpayFeeId));
        _assertNoPending();
    }

    function test_secondBeginRevertsAndRollsBackTheFirstPendingRecord() public {
        bytes32 first = keccak256("FIRST");
        bytes32 second = keccak256("SECOND");
        vm.expectRevert(abi.encodeWithSelector(ProtocolFeeVaultV4Credit.FeeCreditNotPrepared.selector, second));
        source.doubleBegin(creditVault, MARKET_ID, address(quote), SOURCE_VERSION, first, second);
        assertFalse(vault.consumed(first));
        _assertNoPending();
    }

    function test_sourceVersionDriftAtFinalizeRollsBackEverything() public {
        quote.mint(address(source), 80);
        bytes32 feeId = keccak256("DRIFT");
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolFeeVaultV4Credit.InactiveFeeSource.selector, MARKET_ID, SOURCE_VERSION)
        );
        source.creditErc20WithVersionDrift(
            creditVault, registry, quote, MARKET_ID, SOURCE_VERSION, feeId, address(meme)
        );
        assertEq(quote.balanceOf(address(source)), 80);
        assertFalse(vault.consumed(feeId));
        _assertNoPending();
    }

    function test_finalizeMustMatchPreparedMarketAssetAmountFeeIdAndSource() public {
        quote.mint(address(source), 80);
        bytes32 feeId = keccak256("BOUND");
        bytes32 otherFeeId = keccak256("OTHER");

        vm.expectRevert(abi.encodeWithSelector(ProtocolFeeVaultV4Credit.FeeCreditNotPrepared.selector, feeId));
        source.creditErc20WithFinalizeMismatch(
            creditVault, quote, MARKET_ID, SOURCE_VERSION, feeId, keccak256("OTHER_MARKET"), address(quote), 80, feeId
        );
        vm.expectRevert(abi.encodeWithSelector(ProtocolFeeVaultV4Credit.FeeCreditNotPrepared.selector, feeId));
        source.creditErc20WithFinalizeMismatch(
            creditVault, quote, MARKET_ID, SOURCE_VERSION, feeId, MARKET_ID, address(meme), 80, feeId
        );
        vm.expectRevert(abi.encodeWithSelector(ProtocolFeeVaultV4Credit.FeeCreditNotPrepared.selector, feeId));
        source.creditErc20WithFinalizeMismatch(
            creditVault, quote, MARKET_ID, SOURCE_VERSION, feeId, MARKET_ID, address(quote), 79, feeId
        );
        vm.expectRevert(abi.encodeWithSelector(ProtocolFeeVaultV4Credit.FeeCreditNotPrepared.selector, otherFeeId));
        source.creditErc20WithFinalizeMismatch(
            creditVault, quote, MARKET_ID, SOURCE_VERSION, feeId, MARKET_ID, address(quote), 80, otherFeeId
        );

        FeeFinalizeCallerMock finalizer = new FeeFinalizeCallerMock();
        vm.expectRevert(abi.encodeWithSelector(ProtocolFeeVaultV4Credit.FeeCreditNotPrepared.selector, feeId));
        source.creditErc20WithWrongFinalizer(creditVault, finalizer, quote, MARKET_ID, SOURCE_VERSION, feeId);

        assertEq(quote.balanceOf(address(source)), 80);
        assertEq(quote.balanceOf(address(vault)), 0);
        assertFalse(vault.consumed(feeId));
        _assertNoPending();
    }

    function test_everyInactiveLaunchShapeRejectsBegin() public {
        _expectInactiveBegin(0, SOURCE_VERSION, POOL_ID);
        _expectInactiveBegin(1, SOURCE_VERSION, bytes32(0));
        _expectInactiveBegin(1, SOURCE_VERSION + 1, POOL_ID);
        _expectInactiveBegin(2, SOURCE_VERSION, POOL_ID);
    }

    function test_onlyActiveRegisteredHookAndCanonicalAssetsCanBegin() public {
        bytes32 feeId = keccak256("AUTH");
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolFeeVaultV4Credit.InactiveFeeSource.selector, MARKET_ID, SOURCE_VERSION)
        );
        vault.beginV4Credit(MARKET_ID, address(quote), 80, SOURCE_VERSION, feeId);

        MockExactQuoteToken third = new MockExactQuoteToken(8);
        vm.prank(address(source));
        vm.expectRevert(abi.encodeWithSelector(ProtocolFeeVaultV4Credit.FeeAssetNotCanonical.selector, address(third)));
        vault.beginV4Credit(MARKET_ID, address(third), 80, SOURCE_VERSION, feeId);
    }

    function test_replayedFeeIdAndInvalidAmountsFailBeforePreparingCredit() public {
        bytes32 feeId = keccak256("REPLAY");
        quote.mint(address(source), 160);
        source.creditErc20(creditVault, quote, MARKET_ID, SOURCE_VERSION, feeId, 80, 80);

        vm.expectRevert(abi.encodeWithSelector(ProtocolFeeVaultV4Credit.FeeIdAlreadyConsumed.selector, feeId));
        source.creditErc20(creditVault, quote, MARKET_ID, SOURCE_VERSION, feeId, 80, 80);

        vm.prank(address(source));
        vm.expectRevert(abi.encodeWithSelector(ProtocolFeeVaultV4Credit.FeeAmountTooLarge.selector, 0));
        vault.beginV4Credit(MARKET_ID, address(quote), 0, SOURCE_VERSION, keccak256("ZERO"));

        uint256 excessive = uint256(uint128(type(int128).max)) + 1;
        vm.prank(address(source));
        vm.expectRevert(abi.encodeWithSelector(ProtocolFeeVaultV4Credit.FeeAmountTooLarge.selector, excessive));
        vault.beginV4Credit(MARKET_ID, address(quote), excessive, SOURCE_VERSION, keccak256("LARGE"));
    }

    function test_downstreamAccountingFailureRollsBackArrivalAndFeeId() public {
        vault.setRecordBehavior(true, false);
        quote.mint(address(source), 80);
        bytes32 feeId = keccak256("DOWNSTREAM");
        vm.expectRevert("RECORD_REJECTED");
        source.creditErc20(creditVault, quote, MARKET_ID, SOURCE_VERSION, feeId, 80, 80);
        assertEq(quote.balanceOf(address(source)), 80);
        assertFalse(vault.consumed(feeId));
        assertEq(vault.recordCount(), 0);
        _assertNoPending();
    }

    function test_finalizingStateRejectsReentrantBeginWithoutBreakingCredit() public {
        vault.setRecordBehavior(false, true);
        quote.mint(address(source), 80);
        bytes32 feeId = keccak256("REENTRY");
        source.creditErc20(creditVault, quote, MARKET_ID, SOURCE_VERSION, feeId, 80, 80);
        assertTrue(vault.reentryRejected());
        assertTrue(vault.consumed(feeId));
        assertEq(vault.recordCount(), 1);
        _assertNoPending();
    }

    function test_nativeReceiveAndMalformedBalanceReadFailClosed() public {
        vm.deal(address(this), 1);
        (bool direct,) = address(vault).call{value: 1}("");
        assertFalse(direct);

        FeeBalanceMalformedMock malformed = new FeeBalanceMalformedMock();
        registry.configure(MARKET_ID, address(source), address(malformed), address(meme), 1, SOURCE_VERSION, POOL_ID);
        vm.prank(address(source));
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolFeeVaultV4Credit.FeeAssetBalanceUnavailable.selector, address(malformed))
        );
        vault.beginV4Credit(MARKET_ID, address(malformed), 80, SOURCE_VERSION, keccak256("MALFORMED"));
    }

    function _assertNoPending() private view {
        (uint8 state, bytes32 feeId, uint256 amount) = vault.pending();
        assertEq(state, 0);
        assertEq(feeId, bytes32(0));
        assertEq(amount, 0);
    }

    function _expectInactiveBegin(uint8 launchPhase, uint32 configuredVersion, bytes32 poolId) private {
        registry.configure(
            MARKET_ID, address(source), address(quote), address(meme), launchPhase, configuredVersion, poolId
        );
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolFeeVaultV4Credit.InactiveFeeSource.selector, MARKET_ID, SOURCE_VERSION)
        );
        vm.prank(address(source));
        vault.beginV4Credit(MARKET_ID, address(quote), 80, SOURCE_VERSION, keccak256(abi.encode(launchPhase, poolId)));
    }
}
