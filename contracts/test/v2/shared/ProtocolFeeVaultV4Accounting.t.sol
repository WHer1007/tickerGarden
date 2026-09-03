// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {GaugeIdentity, MarketConfig, MarketRuntime, MarketView} from "../../../src/v2/interfaces/IV2Protocol.sol";
import {MarketFeeAccounting} from "../../../src/v2/libraries/MarketFeeAccounting.sol";
import {MemeStockGauge} from "../../../src/v2/modules/MemeStockGauge.sol";
import {MemeStockGaugeClone} from "../../../src/v2/shared/MemeStockGaugeClone.sol";
import {ProtocolFeeVaultV4Accounting} from "../../../src/v2/shared/ProtocolFeeVaultV4Accounting.sol";
import {ProtocolFeeVaultV4Credit} from "../../../src/v2/shared/ProtocolFeeVaultV4Credit.sol";
import {MockExactQuoteToken} from "../mocks/MockV2QuoteAssets.sol";

interface IV4AccountingVault {
    function beginV4Credit(bytes32, address, uint256, uint32, bytes32) external;
    function finalizeV4Credit(bytes32, address, uint256, uint256, uint256, uint256, uint64, bytes32) external;
}

contract V4AccountingMarketRegistryMock {
    mapping(bytes32 => MarketView) private _markets;

    function configure(
        bytes32 marketId,
        address hook,
        address quoteAsset,
        address memeToken,
        address gauge,
        uint256 saturation,
        bytes32 feePolicyId,
        bytes32 executionSpecId,
        uint32 sourceVersion,
        bytes32 poolId
    ) external {
        MarketConfig memory config;
        config.quoteAsset = quoteAsset;
        config.memeToken = memeToken;
        config.gauge = gauge;
        config.graduatedHook = hook;
        config.stakeSaturationAmount = saturation;
        config.feePolicyId = feePolicyId;
        config.executionSpecId = executionSpecId;
        MarketRuntime memory runtime;
        runtime.poolId = poolId;
        runtime.sourceVersion = sourceVersion;
        runtime.launchPhase = 2;
        _markets[marketId] = MarketView({config: config, runtime: runtime});
    }

    function market(bytes32 marketId) external view returns (MarketView memory) {
        return _markets[marketId];
    }
}

contract V4AccountingCreatorRegistryMock {
    mapping(bytes32 => uint32) public currentCreatorEpoch;
    mapping(bytes32 => mapping(uint32 => address)) public creatorBeneficiaryAt;

    function setEpoch(bytes32 marketId, uint32 epoch, address beneficiary) external {
        currentCreatorEpoch[marketId] = epoch;
        creatorBeneficiaryAt[marketId][epoch] = beneficiary;
    }
}

contract V4AccountingGaugeMock {
    uint256 public storedTotalActiveStock;
    uint256 public maturingStock;
    uint256 public checkpointCalls;
    uint256 public creditCalls;
    address public lastFeeAsset;
    uint256 public lastAmount;
    bytes32 public lastFeeId;
    bool public rejectCheckpoint;
    bool public rejectCredit;

    function setActive(uint256 amount) external {
        storedTotalActiveStock = amount;
    }

    function setMaturing(uint256 amount) external {
        maturingStock = amount;
    }

    function setFailures(bool checkpoint, bool credit) external {
        rejectCheckpoint = checkpoint;
        rejectCredit = credit;
    }

    function checkpointActivations() external returns (uint256 activatedAmount, uint256 processedBuckets) {
        if (rejectCheckpoint) revert("CHECKPOINT_REJECTED");
        ++checkpointCalls;
        activatedAmount = maturingStock;
        if (activatedAmount != 0) {
            storedTotalActiveStock += activatedAmount;
            maturingStock = 0;
            processedBuckets = 1;
        }
    }

    function creditStakerFee(address feeAsset, uint256 amount, bytes32 feeId)
        external
        returns (uint256 accumulatorDelta, uint256 indexRemainder)
    {
        if (rejectCredit) revert("CREDIT_REJECTED");
        ++creditCalls;
        lastFeeAsset = feeAsset;
        lastAmount = amount;
        lastFeeId = feeId;
        accumulatorDelta = amount * 1e27 / storedTotalActiveStock;
        indexRemainder = amount * 1e27 % storedTotalActiveStock;
    }

    function consumeClaimable(address, address) external pure returns (uint256) {
        return 0;
    }
}

contract V4AccountingPoolManagerMock {
    function takeNative(address payable recipient, uint256 amount) external payable {
        require(msg.value == amount, "VALUE");
        (bool success,) = recipient.call{value: amount}("");
        require(success, "TAKE");
    }
}

contract V4AccountingAllocationManagerMock {
    function add(MemeStockGauge gauge, address user, uint256 amount, uint64 activationAt, uint64 unlockAt) external {
        gauge.addPending(user, amount, activationAt, unlockAt);
    }
}

contract V4AccountingMarketControllerMock {
    function isStockAllocationOpen(bytes32) external pure returns (bool) {
        return true;
    }
}

contract V4AccountingSourceMock {
    function creditErc20(
        IV4AccountingVault vault,
        MockExactQuoteToken token,
        bytes32 marketId,
        uint32 sourceVersion,
        uint256 base,
        uint256 totalFee,
        uint256 lpAmount,
        uint256 nonLpAmount,
        uint64 feeNonce,
        bytes32 feeId
    ) external {
        vault.beginV4Credit(marketId, address(token), nonLpAmount, sourceVersion, feeId);
        require(token.transfer(address(vault), nonLpAmount), "TRANSFER");
        vault.finalizeV4Credit(marketId, address(token), base, totalFee, lpAmount, nonLpAmount, feeNonce, feeId);
    }

    function creditNative(
        IV4AccountingVault vault,
        V4AccountingPoolManagerMock poolManager,
        bytes32 marketId,
        uint32 sourceVersion,
        uint256 base,
        uint256 totalFee,
        uint256 lpAmount,
        uint256 nonLpAmount,
        uint64 feeNonce,
        bytes32 feeId
    ) external payable {
        require(msg.value == nonLpAmount, "VALUE");
        vault.beginV4Credit(marketId, address(0), nonLpAmount, sourceVersion, feeId);
        poolManager.takeNative{value: nonLpAmount}(payable(address(vault)), nonLpAmount);
        vault.finalizeV4Credit(marketId, address(0), base, totalFee, lpAmount, nonLpAmount, feeNonce, feeId);
    }
}

contract ProtocolFeeVaultV4AccountingHarness is ProtocolFeeVaultV4Accounting {
    constructor(address registry, address poolManager, address creatorRegistry, address treasury, bytes32 feePolicyId)
        ProtocolFeeVaultV4Accounting(registry, poolManager, creatorRegistry, treasury, feePolicyId)
    {}

    function feePolicyHash() external view returns (bytes32) {
        return _v4FeePolicyHash();
    }

    function lastNonce(bytes32 poolId) external view returns (uint64) {
        return _lastV4FeeNonce(poolId);
    }
}

contract ProtocolFeeVaultV4AccountingTest is Test {
    event FeeBucketsCredited(
        bytes32 indexed marketId,
        uint32 indexed creatorEpoch,
        address indexed feeAsset,
        bytes32 feeId,
        uint256 creatorAmount,
        uint256 stakerAmount,
        uint256 platformAmount,
        uint256 activeStock,
        uint256 stakeSaturationAmount
    );

    bytes32 private constant MARKET_ID = keccak256("v4-accounting-market");
    bytes32 private constant POOL_ID = keccak256("v4-accounting-pool");
    bytes32 private constant FEE_POLICY_ID = keccak256("v2-fee-policy");
    bytes32 private constant EXECUTION_SPEC_ID = keccak256("V2-EXEC-3");
    uint32 private constant SOURCE_VERSION = 3;
    uint256 private constant B = 10;
    address private constant CREATOR = address(0xC0FFEE);
    address private constant TREASURY = address(0x7000);
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);

    V4AccountingMarketRegistryMock private registry;
    V4AccountingCreatorRegistryMock private creatorRegistry;
    V4AccountingGaugeMock private gauge;
    V4AccountingPoolManagerMock private poolManager;
    V4AccountingSourceMock private source;
    ProtocolFeeVaultV4AccountingHarness private vault;
    MockExactQuoteToken private quote;
    MockExactQuoteToken private meme;

    function setUp() public {
        registry = new V4AccountingMarketRegistryMock();
        creatorRegistry = new V4AccountingCreatorRegistryMock();
        gauge = new V4AccountingGaugeMock();
        poolManager = new V4AccountingPoolManagerMock();
        source = new V4AccountingSourceMock();
        vault = new ProtocolFeeVaultV4AccountingHarness(
            address(registry), address(poolManager), address(creatorRegistry), TREASURY, FEE_POLICY_ID
        );
        quote = new MockExactQuoteToken(6);
        meme = new MockExactQuoteToken(18);
        creatorRegistry.setEpoch(MARKET_ID, 1, CREATOR);
        _configure(FEE_POLICY_ID, EXECUTION_SPEC_ID);
    }

    function test_zeroActiveStockCreditsFortyZeroFortyAndSkipsGaugeCredit() public {
        bytes32 feeId = _feeId(address(quote), 10_000, 100, 1);
        quote.mint(address(source), 80);
        vm.expectEmit(true, true, true, true, address(vault));
        emit FeeBucketsCredited(MARKET_ID, 1, address(quote), feeId, 40, 0, 40, 0, B);
        _creditErc20(quote, 10_000, 100, 20, 80, 1, feeId);

        assertEq(vault.liability(MARKET_ID, address(quote), 0), 40);
        assertEq(vault.liability(MARKET_ID, address(quote), 1), 0);
        assertEq(vault.liability(MARKET_ID, address(quote), 2), 40);
        assertEq(gauge.checkpointCalls(), 1);
        assertEq(gauge.creditCalls(), 0);
    }

    function test_maturedHalfSaturationIsCheckpointedBeforeSnapshotAndCreditsGauge() public {
        gauge.setMaturing(B / 2);
        bytes32 feeId = _feeId(address(quote), 10_000, 100, 1);
        quote.mint(address(source), 80);
        vm.expectEmit(true, true, true, true, address(vault));
        emit FeeBucketsCredited(MARKET_ID, 1, address(quote), feeId, 30, 20, 30, B / 2, B);
        _creditErc20(quote, 10_000, 100, 20, 80, 1, feeId);

        assertEq(gauge.storedTotalActiveStock(), B / 2);
        assertEq(gauge.creditCalls(), 1);
        assertEq(gauge.lastAmount(), 20);
        assertEq(gauge.lastFeeId(), feeId);
        assertEq(vault.liability(MARKET_ID, address(quote), 1), 20);
    }

    function test_atAndAboveSaturationCapStakerBucketButGaugeUsesFullActiveStock() public {
        gauge.setActive(B);
        bytes32 first = _feeId(address(quote), 10_000, 100, 1);
        quote.mint(address(source), 160);
        _creditErc20(quote, 10_000, 100, 20, 80, 1, first);
        assertEq(vault.liability(MARKET_ID, address(quote), 0), 20);
        assertEq(vault.liability(MARKET_ID, address(quote), 1), 40);
        assertEq(vault.liability(MARKET_ID, address(quote), 2), 20);

        gauge.setActive(B * 2);
        bytes32 second = _feeId(address(quote), 10_000, 100, 2);
        _creditErc20(quote, 10_000, 100, 20, 80, 2, second);
        assertEq(vault.liability(MARKET_ID, address(quote), 0), 40);
        assertEq(vault.liability(MARKET_ID, address(quote), 1), 80);
        assertEq(vault.liability(MARKET_ID, address(quote), 2), 40);
        assertEq(gauge.storedTotalActiveStock(), B * 2);
        assertEq(gauge.lastAmount(), 40);
    }

    function test_oddRemainderGoesToPlatformAfterLinearStakerSplit() public {
        gauge.setActive(B / 2);
        bytes32 feeId = _feeId(address(quote), 10_100, 101, 1);
        quote.mint(address(source), 81);
        _creditErc20(quote, 10_100, 101, 20, 81, 1, feeId);
        assertEq(vault.liability(MARKET_ID, address(quote), 0), 30);
        assertEq(vault.liability(MARKET_ID, address(quote), 1), 20);
        assertEq(vault.liability(MARKET_ID, address(quote), 2), 31);
    }

    function test_quoteAndMemeCreditsUseIndependentLiabilitiesAndGaugeAssets() public {
        gauge.setActive(B);
        quote.mint(address(source), 80);
        meme.mint(address(source), 80);
        bytes32 quoteFeeId = _feeId(address(quote), 10_000, 100, 1);
        _creditErc20(quote, 10_000, 100, 20, 80, 1, quoteFeeId);
        bytes32 memeFeeId = _feeId(address(meme), 10_000, 100, 2);
        _creditErc20(meme, 10_000, 100, 20, 80, 2, memeFeeId);

        assertEq(vault.totalLiability(address(quote)), 80);
        assertEq(vault.totalLiability(address(meme)), 80);
        assertEq(vault.liability(MARKET_ID, address(quote), 1), 40);
        assertEq(vault.liability(MARKET_ID, address(meme), 1), 40);
        assertEq(gauge.lastFeeAsset(), address(meme));
    }

    function test_nativeCreditUsesTheSameSnapshotAndLiabilityRules() public {
        registry.configure(
            MARKET_ID,
            address(source),
            address(0),
            address(meme),
            address(gauge),
            B,
            FEE_POLICY_ID,
            EXECUTION_SPEC_ID,
            SOURCE_VERSION,
            POOL_ID
        );
        gauge.setActive(B);
        bytes32 feeId = _feeId(address(0), 10_000, 100, 1);
        vm.deal(address(this), 80);
        source.creditNative{value: 80}(
            IV4AccountingVault(address(vault)), poolManager, MARKET_ID, SOURCE_VERSION, 10_000, 100, 20, 80, 1, feeId
        );
        assertEq(address(vault).balance, 80);
        assertEq(vault.totalLiability(address(0)), 80);
        assertEq(vault.liability(MARKET_ID, address(0), 1), 40);
    }

    function test_realGaugeDistributesStakerBucketByActiveRawStockAndClaimsThroughVault() public {
        vm.warp(1_000_000);
        V4AccountingAllocationManagerMock manager = new V4AccountingAllocationManagerMock();
        V4AccountingMarketControllerMock controller = new V4AccountingMarketControllerMock();
        MemeStockGauge implementation = new MemeStockGauge();
        MemeStockGauge realGauge = MemeStockGauge(
            MemeStockGaugeClone.deployDeterministic(
                address(implementation),
                MARKET_ID,
                GaugeIdentity({
                    marketId: MARKET_ID,
                    assetUid: keccak256("v4-accounting-stock"),
                    quoteAssetConfigId: keccak256("v4-accounting-quote"),
                    allocationManager: address(manager),
                    protocolFeeVault: address(vault),
                    marketController: address(controller),
                    quoteAsset: address(quote),
                    memeToken: address(meme)
                })
            )
        );
        registry.configure(
            MARKET_ID,
            address(source),
            address(quote),
            address(meme),
            address(realGauge),
            B,
            FEE_POLICY_ID,
            EXECUTION_SPEC_ID,
            SOURCE_VERSION,
            POOL_ID
        );

        uint64 activationAt = uint64(block.timestamp + 30 seconds);
        uint64 unlockAt = uint64(block.timestamp + 24 hours);
        manager.add(realGauge, ALICE, B / 2, activationAt, unlockAt);
        manager.add(realGauge, BOB, B / 2, activationAt, unlockAt);
        vm.warp(activationAt);

        quote.mint(address(source), 80);
        bytes32 feeId = _feeId(address(quote), 10_000, 100, 1);
        _creditErc20(quote, 10_000, 100, 20, 80, 1, feeId);

        assertEq(realGauge.storedTotalActiveStock(), B);
        assertEq(vault.liability(MARKET_ID, address(quote), 1), 40);
        assertEq(vault.claimStakerFor(ALICE, MARKET_ID, address(quote)), 20);
        assertEq(vault.claimStakerFor(BOB, MARKET_ID, address(quote)), 20);
        assertEq(quote.balanceOf(ALICE), 20);
        assertEq(quote.balanceOf(BOB), 20);
        assertEq(vault.liability(MARKET_ID, address(quote), 1), 0);
        assertEq(vault.totalLiability(address(quote)), 40);
    }

    function test_feeIdAndNonceMustMatchEveryCanonicalFieldAndSequence() public {
        gauge.setActive(B);
        quote.mint(address(source), 161);
        bytes32 wrong = keccak256("wrong-fee-id");
        vm.expectRevert(abi.encodeWithSelector(ProtocolFeeVaultV4Credit.FeeCreditNotPrepared.selector, wrong));
        _creditErc20(quote, 10_000, 100, 20, 80, 1, wrong);
        assertEq(quote.balanceOf(address(source)), 161);

        bytes32 skipped = _feeId(address(quote), 10_000, 100, 2);
        vm.expectRevert(abi.encodeWithSelector(ProtocolFeeVaultV4Credit.FeeCreditNotPrepared.selector, skipped));
        _creditErc20(quote, 10_000, 100, 20, 80, 2, skipped);

        bytes32 first = _feeId(address(quote), 10_000, 100, 1);
        _creditErc20(quote, 10_000, 100, 20, 80, 1, first);
        bytes32 repeated = _feeId(address(quote), 10_100, 101, 1);
        vm.expectRevert(abi.encodeWithSelector(ProtocolFeeVaultV4Credit.FeeCreditNotPrepared.selector, repeated));
        _creditErc20(quote, 10_100, 101, 20, 81, 1, repeated);
        assertEq(vault.lastNonce(POOL_ID), 1);
        assertFalse(vault.consumedFeeId(repeated));
    }

    function test_invalidOnePercentOrLpNonLpPartitionRollsBackArrival() public {
        gauge.setActive(B);
        quote.mint(address(source), 161);
        bytes32 wrongTotal = _feeId(address(quote), 10_000, 101, 1);
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolFeeVaultV4Accounting.InvalidV4FeeAmounts.selector, 10_000, 101, 100)
        );
        _creditErc20(quote, 10_000, 101, 20, 80, 1, wrongTotal);

        bytes32 wrongPartition = _feeId(address(quote), 10_000, 100, 1);
        vm.expectRevert();
        _creditErc20(quote, 10_000, 100, 19, 81, 1, wrongPartition);
        assertEq(quote.balanceOf(address(source)), 161);
        assertEq(vault.totalLiability(address(quote)), 0);
    }

    function test_policyOrCreatorEpochDriftRollsBackEverything() public {
        gauge.setActive(B);
        quote.mint(address(source), 80);
        bytes32 feeId = _feeId(address(quote), 10_000, 100, 1);
        _configure(keccak256("other-policy"), EXECUTION_SPEC_ID);
        vm.expectRevert();
        _creditErc20(quote, 10_000, 100, 20, 80, 1, feeId);

        _configure(FEE_POLICY_ID, EXECUTION_SPEC_ID);
        creatorRegistry.setEpoch(MARKET_ID, 0, address(0));
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolFeeVaultV4Accounting.CreatorEpochUnavailableForV4.selector, MARKET_ID, uint32(0)
            )
        );
        _creditErc20(quote, 10_000, 100, 20, 80, 1, feeId);
        assertEq(quote.balanceOf(address(source)), 80);
        assertFalse(vault.consumedFeeId(feeId));
    }

    function test_gaugeCheckpointOrCreditFailureRollsBackTransferFeeIdAndNonce() public {
        gauge.setActive(B);
        quote.mint(address(source), 80);
        bytes32 feeId = _feeId(address(quote), 10_000, 100, 1);
        gauge.setFailures(true, false);
        vm.expectRevert("CHECKPOINT_REJECTED");
        _creditErc20(quote, 10_000, 100, 20, 80, 1, feeId);
        assertEq(gauge.checkpointCalls(), 0);

        gauge.setFailures(false, true);
        vm.expectRevert("CREDIT_REJECTED");
        _creditErc20(quote, 10_000, 100, 20, 80, 1, feeId);
        assertEq(quote.balanceOf(address(source)), 80);
        assertEq(vault.totalLiability(address(quote)), 0);
        assertEq(vault.lastNonce(POOL_ID), 0);
        assertFalse(vault.consumedFeeId(feeId));
    }

    function test_constructorRejectsZeroFeePolicyId() public {
        vm.expectRevert(abi.encodeWithSelector(ProtocolFeeVaultV4Accounting.InvalidV4FeePolicy.selector, bytes32(0)));
        new ProtocolFeeVaultV4AccountingHarness(
            address(registry), address(poolManager), address(creatorRegistry), TREASURY, bytes32(0)
        );
    }

    function _creditErc20(
        MockExactQuoteToken token,
        uint256 base,
        uint256 totalFee,
        uint256 lpAmount,
        uint256 nonLpAmount,
        uint64 feeNonce,
        bytes32 feeId
    ) private {
        source.creditErc20(
            IV4AccountingVault(address(vault)),
            token,
            MARKET_ID,
            SOURCE_VERSION,
            base,
            totalFee,
            lpAmount,
            nonLpAmount,
            feeNonce,
            feeId
        );
    }

    function _feeId(address feeAsset, uint256 base, uint256 totalFee, uint64 feeNonce) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("TICKERGARDEN_V2_V4_FEE"),
                uint256(1),
                block.chainid,
                address(vault),
                address(poolManager),
                POOL_ID,
                MARKET_ID,
                SOURCE_VERSION,
                feeNonce,
                feeAsset,
                base,
                totalFee,
                vault.feePolicyHash()
            )
        );
    }

    function _configure(bytes32 feePolicyId, bytes32 executionSpecId) private {
        registry.configure(
            MARKET_ID,
            address(source),
            address(quote),
            address(meme),
            address(gauge),
            B,
            feePolicyId,
            executionSpecId,
            SOURCE_VERSION,
            POOL_ID
        );
    }
}
