// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {MarketConfig, MarketRuntime, MarketView} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {ProtocolFeeVaultCurveCredit} from "../../../src/v1/shared/ProtocolFeeVaultCurveCredit.sol";
import {ProtocolFeeVaultV4Credit} from "../../../src/v1/shared/ProtocolFeeVaultV4Credit.sol";
import {MockExactQuoteToken} from "../mocks/MockV1QuoteAssets.sol";

interface ICurveCreditVault {
    function creditCurveSweep(bytes32, address, uint256, uint32, uint64, bytes32) external payable;
}

contract CurveCreditMarketRegistryMock {
    mapping(bytes32 => MarketView) private _markets;

    function configure(bytes32 marketId, address curve, address quoteAsset, uint8 launchPhase, uint32 sourceVersion)
        external
    {
        MarketConfig memory config;
        config.curve = curve;
        config.quoteAsset = quoteAsset;
        MarketRuntime memory runtime;
        runtime.launchPhase = launchPhase;
        runtime.sourceVersion = sourceVersion;
        _markets[marketId] = MarketView({config: config, runtime: runtime});
    }

    function market(bytes32 marketId) external view returns (MarketView memory) {
        return _markets[marketId];
    }
}

contract CurveCreditCreatorRegistryMock {
    mapping(bytes32 => uint32) public currentCreatorEpoch;
    mapping(bytes32 => mapping(uint32 => address)) public creatorBeneficiaryAt;

    function setEpoch(bytes32 marketId, uint32 epoch, address beneficiary) external {
        currentCreatorEpoch[marketId] = epoch;
        creatorBeneficiaryAt[marketId][epoch] = beneficiary;
    }
}

contract CurveCreditPoolManagerMock {}

contract ProtocolFeeVaultCurveCreditHarness is ProtocolFeeVaultCurveCredit {
    bool public rejectRecord;
    uint256 public recordCount;
    bytes32 public lastRecordHash;
    mapping(bytes32 => mapping(uint32 => uint256)) public creatorCredits;
    mapping(bytes32 => uint256) public platformCredits;

    constructor(address marketRegistry, address poolManager, address creatorRegistry)
        ProtocolFeeVaultCurveCredit(marketRegistry, poolManager, creatorRegistry)
    {}

    function setRejectRecord(bool value) external {
        rejectRecord = value;
    }

    function consumed(bytes32 feeId) external view returns (bool) {
        return _consumedFeeIds[feeId];
    }

    function lastNonce(bytes32 marketId) external view returns (uint64) {
        return _lastCurveSweepNonce(marketId);
    }

    function _recordExactV4Credit(V4CreditRecord memory) internal pure override {}

    function _recordExactCurveCredit(CurveCreditRecord memory record) internal override {
        if (rejectRecord) revert("CURVE_RECORD_REJECTED");
        ++recordCount;
        creatorCredits[record.marketId][record.creatorEpoch] += record.creatorAmount;
        platformCredits[record.marketId] += record.platformAmount;
        lastRecordHash = keccak256(abi.encode(record));
    }
}

contract CurveCreditSourceMock {
    function creditErc20(
        ICurveCreditVault vault,
        MockExactQuoteToken quote,
        bytes32 marketId,
        uint256 amount,
        uint32 sourceVersion,
        uint64 sweepNonce,
        bytes32 feeId
    ) external {
        uint256 sourceBefore = quote.balanceOf(address(this));
        uint256 vaultBefore = quote.balanceOf(address(vault));
        require(quote.transfer(address(vault), amount), "TRANSFER");
        require(sourceBefore - quote.balanceOf(address(this)) == amount, "DEBIT");
        require(quote.balanceOf(address(vault)) - vaultBefore == amount, "CREDIT");
        vault.creditCurveSweep(marketId, address(quote), amount, sourceVersion, sweepNonce, feeId);
    }

    function creditWithoutTransfer(
        ICurveCreditVault vault,
        address quoteAsset,
        bytes32 marketId,
        uint256 amount,
        uint32 sourceVersion,
        uint64 sweepNonce,
        bytes32 feeId
    ) external {
        vault.creditCurveSweep(marketId, quoteAsset, amount, sourceVersion, sweepNonce, feeId);
    }

    function creditNative(
        ICurveCreditVault vault,
        bytes32 marketId,
        uint256 amount,
        uint32 sourceVersion,
        uint64 sweepNonce,
        bytes32 feeId
    ) external payable {
        vault.creditCurveSweep{value: msg.value}(marketId, address(0), amount, sourceVersion, sweepNonce, feeId);
    }

    function creditErc20WithValue(
        ICurveCreditVault vault,
        MockExactQuoteToken quote,
        bytes32 marketId,
        uint256 amount,
        uint32 sourceVersion,
        uint64 sweepNonce,
        bytes32 feeId
    ) external payable {
        require(quote.transfer(address(vault), amount), "TRANSFER");
        vault.creditCurveSweep{value: msg.value}(marketId, address(quote), amount, sourceVersion, sweepNonce, feeId);
    }
}

contract ProtocolFeeVaultCurveCreditTest is Test {
    bytes32 private constant MARKET_ID = keccak256("curve-credit-market");
    uint32 private constant SOURCE_VERSION = 1;
    address private constant BENEFICIARY_ONE = address(0xBEEF);
    address private constant BENEFICIARY_TWO = address(0xCAFE);

    CurveCreditMarketRegistryMock private registry;
    CurveCreditCreatorRegistryMock private creatorRegistry;
    CurveCreditPoolManagerMock private poolManager;
    ProtocolFeeVaultCurveCreditHarness private vault;
    ICurveCreditVault private creditVault;
    CurveCreditSourceMock private curve;
    MockExactQuoteToken private quote;

    function setUp() public {
        registry = new CurveCreditMarketRegistryMock();
        creatorRegistry = new CurveCreditCreatorRegistryMock();
        poolManager = new CurveCreditPoolManagerMock();
        vault =
            new ProtocolFeeVaultCurveCreditHarness(address(registry), address(poolManager), address(creatorRegistry));
        creditVault = ICurveCreditVault(address(vault));
        curve = new CurveCreditSourceMock();
        quote = new MockExactQuoteToken(6);
        _configure(address(quote), 0, SOURCE_VERSION);
        creatorRegistry.setEpoch(MARKET_ID, 1, BENEFICIARY_ONE);
    }

    function test_erc20SweepBindsCurrentEpochSplitsRemainderAndConsumesCanonicalFeeId() public {
        quote.mint(address(curve), 81);
        bytes32 feeId = _feeId(address(quote), 81, SOURCE_VERSION, 1);
        curve.creditErc20(creditVault, quote, MARKET_ID, 81, SOURCE_VERSION, 1, feeId);

        assertEq(quote.balanceOf(address(vault)), 81);
        assertEq(vault.creatorCredits(MARKET_ID, 1), 57);
        assertEq(vault.platformCredits(MARKET_ID), 24);
        assertEq(vault.lastNonce(MARKET_ID), 1);
        assertTrue(vault.consumed(feeId));
        assertEq(vault.recordCount(), 1);
    }

    function test_nativeSweepRequiresExactMsgValueAndPreservesPreexistingBalance() public {
        _configure(address(0), 0, SOURCE_VERSION);
        vm.deal(address(vault), 777);
        vm.deal(address(this), 81);
        bytes32 feeId = _feeId(address(0), 81, SOURCE_VERSION, 1);
        curve.creditNative{value: 81}(creditVault, MARKET_ID, 81, SOURCE_VERSION, 1, feeId);
        assertEq(address(vault).balance, 858);
        assertEq(vault.creatorCredits(MARKET_ID, 1), 57);
        assertEq(vault.platformCredits(MARKET_ID), 24);
    }

    function test_successiveSweepsBindTheEpochAtEachCredit() public {
        quote.mint(address(curve), 160);
        bytes32 first = _feeId(address(quote), 80, SOURCE_VERSION, 1);
        curve.creditErc20(creditVault, quote, MARKET_ID, 80, SOURCE_VERSION, 1, first);
        creatorRegistry.setEpoch(MARKET_ID, 2, BENEFICIARY_TWO);
        bytes32 second = _feeId(address(quote), 80, SOURCE_VERSION, 2);
        curve.creditErc20(creditVault, quote, MARKET_ID, 80, SOURCE_VERSION, 2, second);

        assertEq(vault.creatorCredits(MARKET_ID, 1), 56);
        assertEq(vault.creatorCredits(MARKET_ID, 2), 56);
        assertEq(vault.platformCredits(MARKET_ID), 48);
        assertEq(vault.lastNonce(MARKET_ID), 2);
    }

    function test_feeIdMustMatchEveryCanonicalCurveSweepField() public {
        quote.mint(address(curve), 80);
        bytes32 wrongFeeId = keccak256("WRONG");
        vm.expectRevert(abi.encodeWithSelector(ProtocolFeeVaultV4Credit.FeeCreditNotPrepared.selector, wrongFeeId));
        curve.creditErc20(creditVault, quote, MARKET_ID, 80, SOURCE_VERSION, 1, wrongFeeId);
        assertEq(quote.balanceOf(address(curve)), 80);
        assertEq(quote.balanceOf(address(vault)), 0);
        assertFalse(vault.consumed(wrongFeeId));
        assertEq(vault.lastNonce(MARKET_ID), 0);
    }

    function test_sweepNonceMustBeStrictlySequentialEvenWithDistinctFeeIds() public {
        quote.mint(address(curve), 160);
        bytes32 skipped = _feeId(address(quote), 80, SOURCE_VERSION, 2);
        vm.expectRevert(abi.encodeWithSelector(ProtocolFeeVaultV4Credit.FeeCreditNotPrepared.selector, skipped));
        curve.creditErc20(creditVault, quote, MARKET_ID, 80, SOURCE_VERSION, 2, skipped);

        bytes32 first = _feeId(address(quote), 80, SOURCE_VERSION, 1);
        curve.creditErc20(creditVault, quote, MARKET_ID, 80, SOURCE_VERSION, 1, first);
        bytes32 repeatedWithDifferentAmount = _feeId(address(quote), 79, SOURCE_VERSION, 1);
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolFeeVaultV4Credit.FeeCreditNotPrepared.selector, repeatedWithDifferentAmount)
        );
        curve.creditErc20(creditVault, quote, MARKET_ID, 79, SOURCE_VERSION, 1, repeatedWithDifferentAmount);
        assertEq(vault.lastNonce(MARKET_ID), 1);
        assertFalse(vault.consumed(repeatedWithDifferentAmount));
    }

    function test_consumedCanonicalFeeIdCannotBeReplayed() public {
        quote.mint(address(curve), 160);
        bytes32 feeId = _feeId(address(quote), 80, SOURCE_VERSION, 1);
        curve.creditErc20(creditVault, quote, MARKET_ID, 80, SOURCE_VERSION, 1, feeId);

        vm.expectRevert(abi.encodeWithSelector(ProtocolFeeVaultV4Credit.FeeIdAlreadyConsumed.selector, feeId));
        curve.creditErc20(creditVault, quote, MARKET_ID, 80, SOURCE_VERSION, 1, feeId);

        assertEq(quote.balanceOf(address(curve)), 80);
        assertEq(quote.balanceOf(address(vault)), 80);
        assertEq(vault.recordCount(), 1);
        assertEq(vault.lastNonce(MARKET_ID), 1);
    }

    function test_onlyExactRegisteredOpenCurveQuoteAndSourceVersionCanCredit() public {
        bytes32 feeId = _feeId(address(quote), 80, SOURCE_VERSION, 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolFeeVaultCurveCredit.UnauthorizedMarketCurve.selector, address(this), address(curve)
            )
        );
        vault.creditCurveSweep(MARKET_ID, address(quote), 80, SOURCE_VERSION, 1, feeId);

        _configure(address(quote), 1, SOURCE_VERSION);
        quote.mint(address(curve), 80);
        vm.expectRevert(abi.encodeWithSelector(ProtocolFeeVaultCurveCredit.CurveFeeSweepAfterClose.selector, MARKET_ID));
        curve.creditErc20(creditVault, quote, MARKET_ID, 80, SOURCE_VERSION, 1, feeId);

        _configure(address(quote), 0, SOURCE_VERSION + 1);
        vm.expectRevert(abi.encodeWithSelector(ProtocolFeeVaultCurveCredit.CurveFeeSweepAfterClose.selector, MARKET_ID));
        curve.creditErc20(creditVault, quote, MARKET_ID, 80, SOURCE_VERSION, 1, feeId);
        assertEq(quote.balanceOf(address(curve)), 80);
    }

    function test_nonCanonicalQuoteAndUnavailableCreatorEpochFailAtomically() public {
        MockExactQuoteToken other = new MockExactQuoteToken(8);
        other.mint(address(curve), 80);
        bytes32 otherFeeId = _feeId(address(other), 80, SOURCE_VERSION, 1);
        vm.expectRevert(abi.encodeWithSelector(ProtocolFeeVaultV4Credit.FeeAssetNotCanonical.selector, address(other)));
        curve.creditErc20(creditVault, other, MARKET_ID, 80, SOURCE_VERSION, 1, otherFeeId);
        assertEq(other.balanceOf(address(curve)), 80);

        creatorRegistry.setEpoch(MARKET_ID, 0, address(0));
        quote.mint(address(curve), 80);
        bytes32 feeId = _feeId(address(quote), 80, SOURCE_VERSION, 1);
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolFeeVaultCurveCredit.CreatorEpochUnavailable.selector, MARKET_ID, uint32(0))
        );
        curve.creditErc20(creditVault, quote, MARKET_ID, 80, SOURCE_VERSION, 1, feeId);
        assertEq(quote.balanceOf(address(curve)), 80);

        creatorRegistry.setEpoch(MARKET_ID, 1, address(0));
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolFeeVaultCurveCredit.CreatorEpochUnavailable.selector, MARKET_ID, uint32(1))
        );
        curve.creditErc20(creditVault, quote, MARKET_ID, 80, SOURCE_VERSION, 1, feeId);
        assertEq(quote.balanceOf(address(curve)), 80);
    }

    function test_missingErc20ArrivalAndWrongNativeOrErc20ValueFailClosed() public {
        bytes32 feeId = _feeId(address(quote), 80, SOURCE_VERSION, 1);
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolFeeVaultV4Credit.FeeBalanceDeltaMismatch.selector, address(quote), 80, 0)
        );
        curve.creditWithoutTransfer(creditVault, address(quote), MARKET_ID, 80, SOURCE_VERSION, 1, feeId);

        _configure(address(0), 0, SOURCE_VERSION);
        vm.deal(address(this), 80);
        bytes32 nativeFeeId = _feeId(address(0), 81, SOURCE_VERSION, 1);
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolFeeVaultV4Credit.FeeBalanceDeltaMismatch.selector, address(0), 81, 80)
        );
        curve.creditNative{value: 80}(creditVault, MARKET_ID, 81, SOURCE_VERSION, 1, nativeFeeId);

        _configure(address(quote), 0, SOURCE_VERSION);
        quote.mint(address(curve), 80);
        vm.deal(address(this), 1);
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolFeeVaultV4Credit.FeeBalanceDeltaMismatch.selector, address(quote), 0, 1)
        );
        curve.creditErc20WithValue{value: 1}(creditVault, quote, MARKET_ID, 80, SOURCE_VERSION, 1, feeId);
    }

    function test_downstreamFailureRollsBackTransferNonceBucketsAndFeeId() public {
        vault.setRejectRecord(true);
        quote.mint(address(curve), 80);
        bytes32 feeId = _feeId(address(quote), 80, SOURCE_VERSION, 1);
        vm.expectRevert("CURVE_RECORD_REJECTED");
        curve.creditErc20(creditVault, quote, MARKET_ID, 80, SOURCE_VERSION, 1, feeId);
        assertEq(quote.balanceOf(address(curve)), 80);
        assertEq(quote.balanceOf(address(vault)), 0);
        assertEq(vault.lastNonce(MARKET_ID), 0);
        assertEq(vault.creatorCredits(MARKET_ID, 1), 0);
        assertEq(vault.platformCredits(MARKET_ID), 0);
        assertFalse(vault.consumed(feeId));
    }

    function _configure(address quoteAsset, uint8 phase, uint32 sourceVersion) private {
        registry.configure(MARKET_ID, address(curve), quoteAsset, phase, sourceVersion);
    }

    function _feeId(address quoteAsset, uint256 amount, uint32 sourceVersion, uint64 sweepNonce)
        private
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                keccak256("TICKERGARDEN_V1_CURVE_SWEEP"),
                uint256(1),
                block.chainid,
                address(vault),
                address(curve),
                MARKET_ID,
                sourceVersion,
                sweepNonce,
                quoteAsset,
                amount
            )
        );
    }
}
