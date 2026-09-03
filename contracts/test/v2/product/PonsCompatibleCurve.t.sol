// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {
    IPonsCompatibleCurve,
    MarketConfig,
    MarketRuntime,
    MarketView
} from "../../../src/v2/interfaces/IV2Protocol.sol";
import {
    CurveInitialization,
    ICurveInitializationSource,
    PonsCompatibleCurve
} from "../../../src/v2/modules/PonsCompatibleCurve.sol";
import {TickerMemeTokenV2} from "../../../src/v2/modules/TickerMemeTokenV2.sol";
import {GraduationExecutorEntry} from "../../../src/v2/shared/GraduationExecutorEntry.sol";
import {
    MockExactQuoteToken,
    MockFeeOnTransferQuoteToken,
    MockForcedNativeSender,
    MockReturnAnomalyQuoteToken
} from "../mocks/MockV2QuoteAssets.sol";

contract MockCurveMarketRegistry {
    bytes32 private _marketId;
    MarketView private _marketView;
    bool public rejectMarkSwept;
    uint256 public markSweptCalls;
    address public graduationExecutor;

    function configure(bytes32 marketId_, MarketConfig memory config) external {
        _marketId = marketId_;
        _marketView.config = config;
        _marketView.runtime = MarketRuntime({
            poolId: bytes32(0),
            sourceVersion: 1,
            recoveryEpoch: 0,
            sweptAt: 0,
            statusSince: uint64(block.timestamp),
            restrictedSince: 0,
            launchPhase: 0,
            marketStatus: 0
        });
    }

    function setRuntime(uint8 launchPhase, uint8 marketStatus) external {
        _marketView.runtime.launchPhase = launchPhase;
        _marketView.runtime.marketStatus = marketStatus;
    }

    function setRejectMarkSwept(bool value) external {
        rejectMarkSwept = value;
    }

    function setGraduationExecutor(address value) external {
        graduationExecutor = value;
    }

    function markSwept(bytes32 marketId_) external {
        require(!rejectMarkSwept, "MARK_SWEPT_REJECTED");
        require(marketId_ == _marketId, "UNKNOWN_MARKET");
        require(msg.sender == _marketView.config.curve, "WRONG_CURVE");
        require(_marketView.runtime.launchPhase == 0 && _marketView.runtime.marketStatus == 0, "WRONG_PHASE");
        ++markSweptCalls;
        _marketView.runtime.launchPhase = 1;
        _marketView.runtime.sweptAt = uint64(block.timestamp);
    }

    function commitPoolCreated(bytes32 marketId_, bytes32 poolId) external {
        require(marketId_ == _marketId, "UNKNOWN_MARKET");
        require(msg.sender == graduationExecutor, "WRONG_EXECUTOR");
        require(_marketView.runtime.launchPhase == 1 && _marketView.runtime.marketStatus == 0, "WRONG_PHASE");
        _marketView.runtime.launchPhase = 2;
        _marketView.runtime.poolId = poolId;
        _marketView.runtime.sourceVersion += 1;
    }

    function market(bytes32 marketId_) external view returns (MarketView memory) {
        require(marketId_ == _marketId, "UNKNOWN_MARKET");
        return _marketView;
    }
}

contract MockCurveGraduationExecutor is GraduationExecutorEntry {
    error GraduationRejected();

    MockCurveMarketRegistry public registry;
    bytes32 public marketId;
    uint256 public calls;
    bool public shouldRevert;

    receive() external payable {}

    constructor(MockCurveMarketRegistry registry_) GraduationExecutorEntry(address(registry_)) {
        registry = registry_;
    }

    function setShouldRevert(bool shouldRevert_) external {
        shouldRevert = shouldRevert_;
    }

    function _graduateSweptMarket(bytes32 marketId_, MarketView memory) internal override {
        if (shouldRevert) revert GraduationRejected();
        marketId = marketId_;
        ++calls;
        registry.commitPoolCreated(marketId_, keccak256("mock-curve-pool"));
    }
}

contract MockCurveFeeVault {
    bytes32 public marketId;
    address public quoteAsset;
    uint256 public amount;
    uint32 public sourceVersion;
    uint64 public nonce;
    bytes32 public feeId;
    uint256 public calls;
    bool public shouldRevert;

    function setShouldRevert(bool value) external {
        shouldRevert = value;
    }

    function creditCurveSweep(
        bytes32 marketId_,
        address quoteAsset_,
        uint256 amount_,
        uint32 sourceVersion_,
        uint64 nonce_,
        bytes32 feeId_
    ) external payable {
        if (shouldRevert) revert("VAULT_REJECTED");
        marketId = marketId_;
        quoteAsset = quoteAsset_;
        amount = amount_;
        sourceVersion = sourceVersion_;
        nonce = nonce_;
        feeId = feeId_;
        ++calls;
        if (quoteAsset_ == address(0)) require(msg.value == amount_, "WRONG_VALUE");
        else require(msg.value == 0, "UNEXPECTED_VALUE");
    }
}

contract MockCurveFactory is ICurveInitializationSource {
    CurveInitialization private _initialization;
    address private _expectedCurve;

    receive() external payable {}

    function setInitialization(address expectedCurve, CurveInitialization memory initialization) external {
        _expectedCurve = expectedCurve;
        _initialization = initialization;
    }

    function curveInitialization(address curve) external view returns (CurveInitialization memory) {
        require(curve == _expectedCurve && msg.sender == curve, "INVALID_CURVE");
        return _initialization;
    }

    function deployToken(bytes32 marketId, address creator, address predictedCurve, uint256 supply)
        external
        returns (TickerMemeTokenV2)
    {
        return new TickerMemeTokenV2(marketId, creator, predictedCurve, "Ticker", "TICK", "ipfs://ticker", supply);
    }

    function predictCurve(bytes32 salt) external view returns (address) {
        bytes32 initCodeHash =
            keccak256(bytes.concat(type(PonsCompatibleCurve).creationCode, abi.encode(address(this))));
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash)))));
    }

    function deployCurve(bytes32 salt) external returns (PonsCompatibleCurve) {
        return new PonsCompatibleCurve{salt: salt}(address(this));
    }

    function atomicFirstBuy(PonsCompatibleCurve curve, uint256 quoteIn, uint256 minTokensOut, address recipient)
        external
        payable
        returns (uint256, uint256)
    {
        return curve.buy{value: msg.value}(quoteIn, minTokensOut, recipient);
    }
}

contract RejectingCurveBuyer {
    function buy(PonsCompatibleCurve curve, uint256 quoteIn, uint256 minTokensOut, address recipient) external payable {
        curve.buy{value: msg.value}(quoteIn, minTokensOut, recipient);
    }

    receive() external payable {
        revert("NO_REFUND");
    }
}

contract ReentrantQuoteToken is MockExactQuoteToken {
    PonsCompatibleCurve public target;
    bool public attack;

    constructor() MockExactQuoteToken(6) {}

    function configure(PonsCompatibleCurve target_, bool attack_) external {
        target = target_;
        attack = attack_;
    }

    function transferFrom(address owner, address recipient, uint256 amount) external override returns (bool) {
        if (attack) target.buy(1, 0, owner);
        uint256 currentAllowance = allowance[owner][msg.sender];
        if (currentAllowance != type(uint256).max) allowance[owner][msg.sender] = currentAllowance - amount;
        _transfer(owner, recipient, amount);
        return true;
    }
}

contract PonsCompatibleCurveTest is Test {
    struct Deployment {
        MockCurveFactory factory;
        MockCurveMarketRegistry registry;
        MockCurveFeeVault feeVault;
        MockCurveGraduationExecutor graduationExecutor;
        TickerMemeTokenV2 token;
        PonsCompatibleCurve curve;
    }

    bytes32 internal constant MARKET_ID = keccak256("MARKET");
    bytes32 internal constant BASELINE_ID = keccak256("BASELINE");
    bytes32 internal constant QUOTE_CONFIG_ID = keccak256("QUOTE_CONFIG");
    bytes32 internal constant SALT = keccak256("CURVE_SALT");
    address internal constant CREATOR = address(0xC0FFEE);
    address internal constant BENEFICIARY = address(0xBEEF);
    address internal constant USER = address(0xA11CE);
    address internal constant RECIPIENT = address(0xB0B);

    event CurveBuy(
        address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax
    );
    event CurveBuyRefunded(address indexed buyer, uint256 unusedQuote);
    event CurveCompleted(bytes32 indexed marketId);
    event LaunchSwept(
        bytes32 indexed marketId, address indexed quoteAsset, uint256 sweptQuote, uint256 sweptTokens, uint64 sweptAt
    );
    event AutoGraduationFailed(bytes32 indexed marketId, bytes32 reasonHash);

    MockCurveFactory internal factory;
    MockCurveMarketRegistry internal registry;
    MockCurveFeeVault internal feeVault;
    MockCurveGraduationExecutor internal graduationExecutor;
    TickerMemeTokenV2 internal memeToken;
    PonsCompatibleCurve internal curve;

    function setUp() public {
        Deployment memory deployment = _deploy(address(0), 1_000, 200, 400_000);
        factory = deployment.factory;
        registry = deployment.registry;
        feeVault = deployment.feeVault;
        graduationExecutor = deployment.graduationExecutor;
        memeToken = deployment.token;
        curve = deployment.curve;
        vm.deal(USER, 10 ether);
        vm.warp(block.timestamp + 3);
    }

    function test_tailNativeBuyPartiallyFillsRefundsCallerAndCompletes() public {
        (uint256 previewTokens, uint256 previewSpent, uint256 previewRefund) = curve.quoteBuy(1_000, RECIPIENT);
        assertEq(previewTokens, 66_667);
        assertEq(previewSpent, 204);
        assertEq(previewRefund, 796);

        vm.expectEmit(true, false, false, true, address(curve));
        emit CurveBuyRefunded(USER, 796);
        vm.expectEmit(true, true, false, true, address(curve));
        emit CurveBuy(USER, RECIPIENT, 204, 66_667, 2, 0);
        vm.expectEmit(true, false, false, true, address(curve));
        emit CurveCompleted(MARKET_ID);
        vm.expectEmit(true, true, false, true, address(curve));
        emit LaunchSwept(MARKET_ID, address(0), 202, 333_333, uint64(block.timestamp));
        vm.prank(USER);
        (uint256 tokensOut, uint256 quoteSpent) = curve.buy{value: 1_000}(1_000, 100_000, RECIPIENT);

        assertEq(tokensOut, previewTokens);
        assertEq(quoteSpent, previewSpent);
        assertEq(memeToken.balanceOf(RECIPIENT), 66_667);
        assertEq(address(curve).balance, 0);
        assertEq(address(feeVault).balance, 2);
        assertEq(address(graduationExecutor).balance, 202);
        assertEq(memeToken.balanceOf(address(graduationExecutor)), 333_333);
        assertEq(curve.accruedCurveFees(), 0);
        assertEq(curve.sweepNonce(), 1);
        assertEq(curve.realQuoteReserve(), 0);
        bytes32 expectedFeeId = keccak256(
            abi.encode(
                keccak256("TICKERGARDEN_V2_CURVE_SWEEP"),
                uint256(1),
                block.chainid,
                address(feeVault),
                address(curve),
                MARKET_ID,
                uint32(1),
                uint64(1),
                address(0),
                uint256(2)
            )
        );
        assertEq(feeVault.feeId(), expectedFeeId);
        assertEq(feeVault.sourceVersion(), 1);
        assertEq(feeVault.nonce(), 1);
        (uint256 quoteReserve, uint256 tokenReserve) = curve.getReserves();
        assertEq(quoteReserve, 0);
        assertEq(tokenReserve, 0);
        assertEq(curve.sellableTokens(), 0);
        assertFalse(curve.readyToGraduate());
        (uint256 recordedQuote, uint256 recordedTokens) = curve.graduationEscrow();
        assertEq(recordedQuote, 202);
        assertEq(recordedTokens, 333_333);
        assertEq(registry.markSweptCalls(), 1);
        assertEq(graduationExecutor.calls(), 1);
        assertEq(graduationExecutor.marketId(), MARKET_ID);
        assertEq(registry.market(MARKET_ID).runtime.launchPhase, 2);
    }

    function test_failedAutomaticGraduationKeepsSweptAssetsAndEmitsDeterministicReason() public {
        graduationExecutor.setShouldRevert(true);
        bytes memory reason = abi.encodeWithSelector(MockCurveGraduationExecutor.GraduationRejected.selector);
        vm.expectEmit(true, false, false, true, address(curve));
        emit AutoGraduationFailed(MARKET_ID, keccak256(reason));

        vm.prank(USER);
        curve.buy{value: 1_000}(1_000, 0, RECIPIENT);

        assertEq(registry.market(MARKET_ID).runtime.launchPhase, 1);
        assertEq(registry.markSweptCalls(), 1);
        assertEq(graduationExecutor.calls(), 0);
        assertEq(address(graduationExecutor).balance, 202);
        assertEq(memeToken.balanceOf(address(graduationExecutor)), 333_333);
        assertEq(address(feeVault).balance, 2);
        assertEq(curve.accruedCurveFees(), 0);
        assertEq(curve.sweepNonce(), 1);
        assertTrue(curve.readyToGraduate());
        (uint256 recordedQuote, uint256 recordedTokens) = curve.graduationEscrow();
        assertEq(recordedQuote, 202);
        assertEq(recordedTokens, 333_333);
    }

    function test_finalFeeSweepFailureRollsBackTheEntireFinalBuy() public {
        feeVault.setShouldRevert(true);
        vm.expectRevert("VAULT_REJECTED");
        vm.prank(USER);
        curve.buy{value: 1_000}(1_000, 0, RECIPIENT);

        _assertInitialState(curve, memeToken);
        assertEq(memeToken.balanceOf(RECIPIENT), 0);
        assertEq(address(feeVault).balance, 0);
        assertEq(feeVault.calls(), 0);
        assertEq(address(graduationExecutor).balance, 0);
        assertEq(registry.markSweptCalls(), 0);
        (uint256 recordedQuote, uint256 recordedTokens) = curve.graduationEscrow();
        assertEq(recordedQuote, 0);
        assertEq(recordedTokens, 0);
    }

    function test_markSweptFailureRollsBackFeesEscrowAndFinalBuy() public {
        registry.setRejectMarkSwept(true);
        vm.expectRevert("MARK_SWEPT_REJECTED");
        vm.prank(USER);
        curve.buy{value: 1_000}(1_000, 0, RECIPIENT);

        _assertInitialState(curve, memeToken);
        assertEq(memeToken.balanceOf(RECIPIENT), 0);
        assertEq(address(feeVault).balance, 0);
        assertEq(feeVault.calls(), 0);
        (uint256 recordedQuote, uint256 recordedTokens) = curve.graduationEscrow();
        assertEq(recordedQuote, 0);
        assertEq(recordedTokens, 0);
        assertEq(address(graduationExecutor).balance, 0);
        assertEq(memeToken.balanceOf(address(graduationExecutor)), 0);
        assertEq(registry.markSweptCalls(), 0);
    }

    function test_zeroFeeSweepIsNoOpAndDoesNotConsumeNonce() public {
        assertEq(curve.sweepCurveFees(), 0);
        assertEq(curve.sweepNonce(), 0);
        assertEq(feeVault.calls(), 0);
    }

    function test_authenticatedRouterGetsOneAtomicFirstBuyExemptionAndReceivesCurveRefund() public {
        Deployment memory deployment = _deploy(address(0), 1_000, 200, 400_000);
        vm.deal(USER, 1_000);

        vm.prank(USER);
        (uint256 tokensOut, uint256 spent) =
            deployment.factory.atomicFirstBuy{value: 1_000}(deployment.curve, 1_000, 0, RECIPIENT);
        assertEq(tokensOut, 66_667);
        assertEq(spent, 204);
        assertEq(address(deployment.factory).balance, 796);
        assertEq(deployment.token.balanceOf(RECIPIENT), 66_667);
    }

    function test_tailProportionalSlippageRevertsWithoutChangingState() public {
        vm.prank(USER);
        vm.expectRevert(abi.encodeWithSelector(PonsCompatibleCurve.SlippageExceeded.selector, 66_667, 400_000));
        curve.buy{value: 1_000}(1_000, 400_000, RECIPIENT);
        _assertInitialState(curve, memeToken);
    }

    function test_nativePaymentMustEqualDeclaredQuote() public {
        vm.startPrank(USER);
        vm.expectRevert(abi.encodeWithSelector(PonsCompatibleCurve.InvalidPaymentValue.selector, 1_000, 999));
        curve.buy{value: 999}(1_000, 0, RECIPIENT);
        vm.expectRevert(abi.encodeWithSelector(PonsCompatibleCurve.InvalidPaymentValue.selector, 1_000, 1_001));
        curve.buy{value: 1_001}(1_000, 0, RECIPIENT);
        vm.stopPrank();
        _assertInitialState(curve, memeToken);
    }

    function test_rejectedNativeRefundRollsBackAllAccountingAndTransfers() public {
        RejectingCurveBuyer buyer = new RejectingCurveBuyer();
        vm.deal(address(buyer), 1_000);
        vm.expectRevert(
            abi.encodeWithSelector(PonsCompatibleCurve.NativeTransferFailed.selector, address(buyer), uint256(796))
        );
        buyer.buy{value: 1_000}(curve, 1_000, 0, RECIPIENT);
        _assertInitialState(curve, memeToken);
        assertEq(memeToken.balanceOf(RECIPIENT), 0);
    }

    function test_exactErc20TailBuyRefundsInTheSameAsset() public {
        MockExactQuoteToken quote = new MockExactQuoteToken(6);
        Deployment memory deployment = _deploy(address(quote), 1_000, 200, 400_000);
        TickerMemeTokenV2 token = deployment.token;
        PonsCompatibleCurve ercCurve = deployment.curve;
        quote.mint(USER, 1_000);
        vm.prank(USER);
        quote.approve(address(ercCurve), 1_000);
        vm.warp(block.timestamp + 3);

        vm.prank(USER);
        (uint256 tokensOut, uint256 spent) = ercCurve.buy(1_000, 100_000, RECIPIENT);
        assertEq(tokensOut, 66_667);
        assertEq(spent, 204);
        assertEq(quote.balanceOf(USER), 796);
        assertEq(quote.balanceOf(address(deployment.feeVault)), 2);
        assertEq(quote.balanceOf(address(deployment.graduationExecutor)), 202);
        assertEq(quote.balanceOf(address(ercCurve)), 0);
        assertEq(token.balanceOf(RECIPIENT), 66_667);
        assertEq(token.balanceOf(address(deployment.graduationExecutor)), 333_333);
        assertEq(ercCurve.realQuoteReserve(), 0);
    }

    function test_feeOnTransferQuoteFailsExactArrivalAndRollsBack() public {
        MockFeeOnTransferQuoteToken quote = new MockFeeOnTransferQuoteToken(6, 100);
        Deployment memory deployment = _deploy(address(quote), 1_000, 200, 400_000);
        TickerMemeTokenV2 token = deployment.token;
        PonsCompatibleCurve ercCurve = deployment.curve;
        quote.mint(USER, 1_000);
        vm.prank(USER);
        quote.approve(address(ercCurve), 1_000);
        vm.warp(block.timestamp + 3);

        vm.prank(USER);
        vm.expectRevert(
            abi.encodeWithSelector(
                PonsCompatibleCurve.InexactBalanceDelta.selector, address(quote), uint256(1_000), uint256(990)
            )
        );
        ercCurve.buy(1_000, 0, RECIPIENT);
        _assertInitialState(ercCurve, token);
        assertEq(quote.balanceOf(USER), 1_000);
    }

    function test_falseNoDataAndMalformedTransferReturnsAreRejected() public {
        MockReturnAnomalyQuoteToken quote = new MockReturnAnomalyQuoteToken();
        PonsCompatibleCurve ercCurve = _deploy(address(quote), 1_000, 200, 400_000).curve;
        vm.warp(block.timestamp + 3);

        vm.expectRevert(abi.encodeWithSelector(PonsCompatibleCurve.InvalidTransferReturn.selector, address(quote)));
        vm.prank(USER);
        ercCurve.buy(1_000, 0, RECIPIENT);

        quote.setMode(MockReturnAnomalyQuoteToken.ReturnMode.NO_DATA);
        vm.expectRevert(abi.encodeWithSelector(PonsCompatibleCurve.InvalidTransferReturn.selector, address(quote)));
        vm.prank(USER);
        ercCurve.buy(1_000, 0, RECIPIENT);

        quote.setMode(MockReturnAnomalyQuoteToken.ReturnMode.MALFORMED_TRUE);
        vm.expectRevert(abi.encodeWithSelector(PonsCompatibleCurve.InvalidTransferReturn.selector, address(quote)));
        vm.prank(USER);
        ercCurve.buy(1_000, 0, RECIPIENT);
    }

    function test_reentrantQuoteCallbackCannotEnterBuy() public {
        ReentrantQuoteToken quote = new ReentrantQuoteToken();
        PonsCompatibleCurve ercCurve = _deploy(address(quote), 1_000, 200, 400_000).curve;
        quote.mint(USER, 1_000);
        vm.prank(USER);
        quote.approve(address(ercCurve), 1_000);
        quote.configure(ercCurve, true);
        vm.warp(block.timestamp + 3);

        vm.expectRevert(abi.encodeWithSelector(PonsCompatibleCurve.TransferCallFailed.selector, address(quote)));
        vm.prank(USER);
        ercCurve.buy(1_000, 0, RECIPIENT);
        assertEq(quote.balanceOf(USER), 1_000);
    }

    function test_sellPathAndReserveAccounting() public {
        Deployment memory deployment = _deploy(address(0), 1_000, 999_000, 1_000_000);
        TickerMemeTokenV2 token = deployment.token;
        PonsCompatibleCurve liquidCurve = deployment.curve;
        vm.warp(block.timestamp + 3);
        vm.prank(USER);
        (uint256 bought,) = liquidCurve.buy{value: 100}(100, 0, USER);
        uint256 tokensIn = bought / 2;
        vm.prank(USER);
        token.approve(address(liquidCurve), tokensIn);
        (uint256 previewOut, uint256 previewFee) = liquidCurve.quoteSell(tokensIn);
        uint256 balanceBefore = USER.balance;

        vm.prank(USER);
        (uint256 quoteOut, uint256 fee) = liquidCurve.sell(tokensIn, previewOut, USER);
        assertEq(quoteOut, previewOut);
        assertEq(fee, previewFee);
        assertEq(USER.balance - balanceBefore, quoteOut);
        assertEq(liquidCurve.realQuoteReserve(), 99 - quoteOut - fee);
        assertEq(liquidCurve.accruedCurveFees(), 1 + fee);
    }

    function test_forcedBalancesDoNotChangePricingOrGraduationProgress() public {
        vm.prank(USER);
        curve.buy{value: 100}(100, 0, USER);
        (uint256 quoteBefore, uint256 tokenBefore) = curve.getReserves();
        uint256 sellableBefore = curve.sellableTokens();

        MockForcedNativeSender sender = new MockForcedNativeSender{value: 1 ether}();
        sender.force(payable(address(curve)));
        vm.prank(USER);
        memeToken.transfer(address(curve), 1);

        (uint256 quoteAfter, uint256 tokenAfter) = curve.getReserves();
        assertEq(quoteAfter, quoteBefore);
        assertEq(tokenAfter, tokenBefore);
        assertEq(curve.sellableTokens(), sellableBefore);
    }

    function test_pausedAndCompletedMarketsRejectFurtherTrades() public {
        registry.setRuntime(0, 1);
        vm.expectRevert(abi.encodeWithSelector(PonsCompatibleCurve.MarketNotTradable.selector, 0, 1, false));
        vm.prank(USER);
        curve.buy{value: 1_000}(1_000, 0, RECIPIENT);

        registry.setRuntime(0, 0);
        vm.prank(USER);
        curve.buy{value: 1_000}(1_000, 0, RECIPIENT);
        vm.expectRevert(abi.encodeWithSelector(PonsCompatibleCurve.MarketNotTradable.selector, 2, 0, true));
        vm.prank(USER);
        curve.buy{value: 1}(1, 0, RECIPIENT);

        vm.expectRevert(abi.encodeWithSelector(PonsCompatibleCurve.CurveFeeSweepAfterClose.selector, MARKET_ID));
        curve.sweepCurveFees();
        assertEq(graduationExecutor.calls(), 1);
        assertEq(registry.markSweptCalls(), 1);
    }

    function test_curveFeeSweepIsAtomicAndDoesNotChangeRealReserve() public {
        PonsCompatibleCurve liquidCurve = _deploy(address(0), 1_000, 999_000, 1_000_000).curve;
        vm.warp(block.timestamp + 3);
        vm.prank(USER);
        liquidCurve.buy{value: 100}(100, 0, USER);
        uint256 realBefore = liquidCurve.realQuoteReserve();

        assertEq(liquidCurve.sweepCurveFees(), 1);
        assertEq(liquidCurve.sweepNonce(), 1);
        assertEq(liquidCurve.accruedCurveFees(), 0);
        assertEq(liquidCurve.realQuoteReserve(), realBefore);
    }

    function test_failedFeeVaultCallRollsBackSweepStateAndFunds() public {
        Deployment memory deployment = _deploy(address(0), 1_000, 999_000, 1_000_000);
        MockCurveFeeVault vault = deployment.feeVault;
        PonsCompatibleCurve liquidCurve = deployment.curve;
        vm.warp(block.timestamp + 3);
        vm.prank(USER);
        liquidCurve.buy{value: 100}(100, 0, USER);
        vault.setShouldRevert(true);

        vm.expectRevert("VAULT_REJECTED");
        liquidCurve.sweepCurveFees();
        assertEq(liquidCurve.sweepNonce(), 0);
        assertEq(liquidCurve.accruedCurveFees(), 1);
        assertEq(address(liquidCurve).balance, 100);
    }

    function test_canonicalSelectorsMatchInterface() public pure {
        assertEq(PonsCompatibleCurve.buy.selector, IPonsCompatibleCurve.buy.selector);
        assertEq(PonsCompatibleCurve.sell.selector, IPonsCompatibleCurve.sell.selector);
        assertEq(PonsCompatibleCurve.quoteBuy.selector, IPonsCompatibleCurve.quoteBuy.selector);
        assertEq(PonsCompatibleCurve.quoteSell.selector, IPonsCompatibleCurve.quoteSell.selector);
        assertEq(PonsCompatibleCurve.sweepCurveFees.selector, IPonsCompatibleCurve.sweepCurveFees.selector);
    }

    function _deploy(address quoteAsset, uint256 phantom, uint256 threshold, uint256 supply)
        private
        returns (Deployment memory deployment)
    {
        deployment.factory = new MockCurveFactory();
        deployment.registry = new MockCurveMarketRegistry();
        deployment.feeVault = new MockCurveFeeVault();
        deployment.graduationExecutor = new MockCurveGraduationExecutor(deployment.registry);
        deployment.registry.setGraduationExecutor(address(deployment.graduationExecutor));
        address predictedCurve = deployment.factory.predictCurve(SALT);
        deployment.token = deployment.factory.deployToken(MARKET_ID, CREATOR, predictedCurve, supply);

        CurveInitialization memory initialization = CurveInitialization({
            marketId: MARKET_ID,
            ponsBaselineId: BASELINE_ID,
            quoteAssetConfigId: QUOTE_CONFIG_ID,
            marketRegistry: address(deployment.registry),
            protocolFeeVault: address(deployment.feeVault),
            graduationExecutor: address(deployment.graduationExecutor),
            launchRouter: address(deployment.factory),
            creator: CREATOR,
            beneficiaryAtCreation: BENEFICIARY,
            memeToken: address(deployment.token),
            quoteAsset: quoteAsset,
            phantomQuote: phantom,
            graduationThreshold: threshold,
            initialSupply: supply,
            curveFeeBps: 100
        });
        deployment.factory.setInitialization(predictedCurve, initialization);
        deployment.registry.configure(MARKET_ID, _marketConfig(predictedCurve, address(deployment.token), quoteAsset));
        deployment.curve = deployment.factory.deployCurve(SALT);
        assertEq(address(deployment.curve), predictedCurve);
    }

    function _marketConfig(address curve_, address token_, address quoteAsset_)
        private
        pure
        returns (MarketConfig memory)
    {
        return MarketConfig({
            assetUid: keccak256("ASSET"),
            ponsBaselineId: BASELINE_ID,
            quoteAssetConfigId: QUOTE_CONFIG_ID,
            launchTemplateId: keccak256("TEMPLATE"),
            feePolicyId: keccak256("FEE_POLICY"),
            executionSpecId: keccak256("V2-EXEC-4"),
            expectedEconomics: keccak256("ECONOMICS"),
            launchConfigId: 0,
            creatorRevenueBeneficiaryAtCreation: BENEFICIARY,
            memeToken: token_,
            curve: curve_,
            gauge: address(0x600D),
            quoteAsset: quoteAsset_,
            graduatedHook: address(0x2044),
            marketController: address(0xC017)
        });
    }

    function _assertInitialState(PonsCompatibleCurve target, TickerMemeTokenV2 token) private view {
        (uint256 quoteReserve, uint256 tokenReserve) = target.getReserves();
        assertEq(quoteReserve, 1_000);
        assertEq(tokenReserve, 400_000);
        assertEq(target.realQuoteReserve(), 0);
        assertEq(target.accruedCurveFees(), 0);
        assertEq(token.balanceOf(address(target)), 400_000);
        assertFalse(target.readyToGraduate());
    }
}
