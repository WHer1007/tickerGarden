// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {GaugeIdentity, MarketConfig, MarketRuntime, MarketView} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {MarketFeeAccounting} from "../../../src/v1/libraries/MarketFeeAccounting.sol";
import {MemeStockGauge} from "../../../src/v1/modules/MemeStockGauge.sol";
import {MemeStockGaugeClone} from "../../../src/v1/shared/MemeStockGaugeClone.sol";
import {ProtocolFeeVaultV4Accounting} from "../../../src/v1/shared/ProtocolFeeVaultV4Accounting.sol";
import {ProtocolFeeVaultV4Credit} from "../../../src/v1/shared/ProtocolFeeVaultV4Credit.sol";
import {MockExactQuoteToken} from "../mocks/MockV1QuoteAssets.sol";

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
        bytes32 feePolicyId,
        bytes32 executionSpecId,
        uint32 sourceVersion,
        bytes32 poolId
    ) external {
        MarketConfig memory config;
        config.quoteAsset = quoteAsset;
        config.memeToken = memeToken;
        config.gauge = gauge;
        config.stakingEnabled = true;
        config.graduatedHook = hook;
        config.feePolicyId = feePolicyId;
        config.executionSpecId = executionSpecId;
        MarketRuntime memory runtime;
        runtime.poolId = poolId;
        runtime.sourceVersion = sourceVersion;
        runtime.launchPhase = 1;
        _markets[marketId] = MarketView({config: config, runtime: runtime});
    }

    function market(bytes32 marketId) external view returns (MarketView memory) {
        return _markets[marketId];
    }

    function setLaunchPhase(bytes32 marketId, uint8 launchPhase) external {
        _markets[marketId].runtime.launchPhase = launchPhase;
    }

    function disableStaking(bytes32 marketId) external {
        _markets[marketId].config.stakingEnabled = false;
        _markets[marketId].config.gauge = address(0);
    }

    function setCreatorTaxBps(bytes32 marketId, uint16 creatorTaxBps) external {
        _markets[marketId].config.creatorTaxBps = creatorTaxBps;
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

    function effectiveTotalActiveStock() external view returns (uint256) {
        return storedTotalActiveStock;
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
    uint256 private _totalRewardEligible;
    uint64 private _activationAt;
    uint256 private _quoteAccumulator;
    uint256 private _memeAccumulator;

    function add(MemeStockGauge gauge, address user, uint256 amount, uint64 activationAt, uint64 unlockAt) external {
        _totalRewardEligible += amount;
        _activationAt = activationAt;
        gauge.addPending(user, amount, activationAt, unlockAt);
    }

    function rageQuitSettlementPending(bytes32, address) external pure returns (bool pending, uint256 principal) {
        return (false, 0);
    }

    function rewardEligibleActiveStock(bytes32) external view returns (uint256) {
        return block.timestamp >= _activationAt ? _totalRewardEligible : 0;
    }

    function rewardCohortEpoch(bytes32) external pure returns (uint256) {
        return 0;
    }

    function recordGaugeRewardState(bytes32, uint256 quoteAccumulator, uint256 memeAccumulator) external {
        _quoteAccumulator = quoteAccumulator;
        _memeAccumulator = memeAccumulator;
    }

    function rageQuitRewardCutoff(bytes32, address)
        external
        view
        returns (uint256 principal, uint256 quoteAccumulator, uint256 memeAccumulator, bool forfeitureRedistributable)
    {
        return (0, _quoteAccumulator, _memeAccumulator, false);
    }
}

contract V4AccountingControllerMock {
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
        uint256 activeStock
    );

    bytes32 private constant MARKET_ID = keccak256("v4-accounting-market");
    bytes32 private constant POOL_ID = keccak256("v4-accounting-pool");
    bytes32 private constant FEE_POLICY_ID = keccak256("v1-fee-policy");
    bytes32 private constant EXECUTION_SPEC_ID = keccak256("V1-EXEC-11");
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

    function test_disabledStakingNeverCallsGaugeAndRetainsAllCreatorTax() public {
        registry.disableStaking(MARKET_ID);
        registry.setCreatorTaxBps(MARKET_ID, 500);
        bytes32 feeId = _feeId(address(quote), 10_000, 600, 1);
        quote.mint(address(source), 600);
        _creditErc20(quote, 10_000, 600, 0, 600, 1, feeId);
        assertEq(vault.liability(MARKET_ID, address(quote), 0), 570);
        assertEq(vault.liability(MARKET_ID, address(quote), 1), 0);
        assertEq(vault.liability(MARKET_ID, address(quote), 2), 30);
        assertEq(gauge.checkpointCalls(), 0);
    }

    function test_zeroActiveStockCreditsSeventyZeroThirtyAndSkipsGaugeCredit() public {
        bytes32 feeId = _feeId(address(quote), 10_000, 100, 1);
        quote.mint(address(source), 100);
        vm.expectEmit(true, true, true, true, address(vault));
        emit FeeBucketsCredited(MARKET_ID, 1, address(quote), feeId, 70, 0, 30, 0);
        _creditErc20(quote, 10_000, 100, 0, 100, 1, feeId);

        assertEq(vault.liability(MARKET_ID, address(quote), 0), 70);
        assertEq(vault.liability(MARKET_ID, address(quote), 1), 0);
        assertEq(vault.liability(MARKET_ID, address(quote), 2), 30);
        assertEq(gauge.checkpointCalls(), 1);
        assertEq(gauge.creditCalls(), 0);
    }

    function test_legacyPhaseTwoCannotCreditPoolFees() public {
        registry.setLaunchPhase(MARKET_ID, 2);
        bytes32 feeId = _feeId(address(quote), 10_000, 100, 1);
        quote.mint(address(source), 100);

        vm.expectRevert(
            abi.encodeWithSelector(ProtocolFeeVaultV4Credit.InactiveFeeSource.selector, MARKET_ID, SOURCE_VERSION)
        );
        _creditErc20(quote, 10_000, 100, 0, 100, 1, feeId);

        assertEq(quote.balanceOf(address(source)), 100);
        assertEq(quote.balanceOf(address(vault)), 0);
        assertFalse(vault.consumedFeeId(feeId));
    }

    function test_maturedActiveStakeIsCheckpointedBeforeSnapshotAndCreditsGauge() public {
        gauge.setMaturing(B / 2);
        bytes32 feeId = _feeId(address(quote), 10_000, 100, 1);
        quote.mint(address(source), 100);
        vm.expectEmit(true, true, true, true, address(vault));
        emit FeeBucketsCredited(MARKET_ID, 1, address(quote), feeId, 40, 30, 30, B / 2);
        _creditErc20(quote, 10_000, 100, 0, 100, 1, feeId);

        assertEq(gauge.storedTotalActiveStock(), B / 2);
        assertEq(gauge.creditCalls(), 1);
        assertEq(gauge.lastAmount(), 30);
        assertEq(gauge.lastFeeId(), feeId);
        assertEq(vault.liability(MARKET_ID, address(quote), 1), 30);
    }

    function test_atAndAboveActiveStockUseTheSameFixedStakerBucket() public {
        gauge.setActive(B);
        bytes32 first = _feeId(address(quote), 10_000, 100, 1);
        quote.mint(address(source), 200);
        _creditErc20(quote, 10_000, 100, 0, 100, 1, first);
        assertEq(vault.liability(MARKET_ID, address(quote), 0), 40);
        assertEq(vault.liability(MARKET_ID, address(quote), 1), 30);
        assertEq(vault.liability(MARKET_ID, address(quote), 2), 30);

        gauge.setActive(B * 2);
        bytes32 second = _feeId(address(quote), 10_000, 100, 2);
        _creditErc20(quote, 10_000, 100, 0, 100, 2, second);
        assertEq(vault.liability(MARKET_ID, address(quote), 0), 80);
        assertEq(vault.liability(MARKET_ID, address(quote), 1), 60);
        assertEq(vault.liability(MARKET_ID, address(quote), 2), 60);
        assertEq(gauge.storedTotalActiveStock(), B * 2);
        assertEq(gauge.lastAmount(), 30);
    }

    function test_integerRemainderGoesToCreatorAfterFixedBeneficiaryFloors() public {
        gauge.setActive(B / 2);
        bytes32 feeId = _feeId(address(quote), 10_100, 101, 1);
        quote.mint(address(source), 101);
        _creditErc20(quote, 10_100, 101, 0, 101, 1, feeId);
        assertEq(vault.liability(MARKET_ID, address(quote), 0), 41);
        assertEq(vault.liability(MARKET_ID, address(quote), 1), 30);
        assertEq(vault.liability(MARKET_ID, address(quote), 2), 30);
    }

    function test_creatorTax500IsAddedToCreatorAfterBaseFeeSplitWithActiveStake() public {
        registry.setCreatorTaxBps(MARKET_ID, 500);
        gauge.setActive(B);
        bytes32 feeId = _feeId(address(quote), 10_000, 600, 1);
        quote.mint(address(source), 600);
        vm.expectEmit(true, true, true, true, address(vault));
        emit FeeBucketsCredited(MARKET_ID, 1, address(quote), feeId, 540, 30, 30, B);
        _creditErc20(quote, 10_000, 600, 0, 600, 1, feeId);

        assertEq(vault.liability(MARKET_ID, address(quote), 0), 540);
        assertEq(vault.liability(MARKET_ID, address(quote), 1), 30);
        assertEq(vault.liability(MARKET_ID, address(quote), 2), 30);
        assertEq(gauge.lastAmount(), 30);
    }

    function test_creatorTax500WithZeroActiveStakeRemainsCreatorOwned() public {
        registry.setCreatorTaxBps(MARKET_ID, 500);
        bytes32 feeId = _feeId(address(quote), 10_000, 600, 1);
        quote.mint(address(source), 600);
        vm.expectEmit(true, true, true, true, address(vault));
        emit FeeBucketsCredited(MARKET_ID, 1, address(quote), feeId, 570, 0, 30, 0);
        _creditErc20(quote, 10_000, 600, 0, 600, 1, feeId);

        assertEq(vault.liability(MARKET_ID, address(quote), 0), 570);
        assertEq(vault.liability(MARKET_ID, address(quote), 1), 0);
        assertEq(vault.liability(MARKET_ID, address(quote), 2), 30);
        assertEq(gauge.creditCalls(), 0);
    }

    function test_creatorTaxAndBaseFeeBothUseFloorRoundingForTinyBase() public {
        registry.setCreatorTaxBps(MARKET_ID, 500);
        gauge.setActive(B);
        bytes32 feeId = _feeId(address(quote), 101, 6, 1);
        quote.mint(address(source), 6);
        _creditErc20(quote, 101, 6, 0, 6, 1, feeId);

        assertEq(vault.liability(MARKET_ID, address(quote), 0), 6);
        assertEq(vault.liability(MARKET_ID, address(quote), 1), 0);
        assertEq(vault.liability(MARKET_ID, address(quote), 2), 0);
        assertEq(gauge.creditCalls(), 0);
    }

    function test_creatorTaxWrongTotalFeeRollsBackArrivalAndFeeState() public {
        registry.setCreatorTaxBps(MARKET_ID, 500);
        gauge.setActive(B);
        quote.mint(address(source), 600);
        bytes32 feeId = _feeId(address(quote), 10_000, 599, 1);
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolFeeVaultV4Accounting.InvalidV4FeeAmounts.selector, 10_000, 599, 600)
        );
        _creditErc20(quote, 10_000, 599, 0, 599, 1, feeId);

        assertEq(quote.balanceOf(address(source)), 600);
        assertEq(quote.balanceOf(address(vault)), 0);
        assertEq(vault.totalLiability(address(quote)), 0);
        assertEq(vault.lastNonce(POOL_ID), 0);
        assertFalse(vault.consumedFeeId(feeId));
    }

    function test_quoteAndMemeCreditsUseIndependentLiabilitiesAndGaugeAssets() public {
        gauge.setActive(B);
        quote.mint(address(source), 100);
        meme.mint(address(source), 100);
        bytes32 quoteFeeId = _feeId(address(quote), 10_000, 100, 1);
        _creditErc20(quote, 10_000, 100, 0, 100, 1, quoteFeeId);
        bytes32 memeFeeId = _feeId(address(meme), 10_000, 100, 2);
        _creditErc20(meme, 10_000, 100, 0, 100, 2, memeFeeId);

        assertEq(vault.totalLiability(address(quote)), 100);
        assertEq(vault.totalLiability(address(meme)), 100);
        assertEq(vault.liability(MARKET_ID, address(quote), 1), 30);
        assertEq(vault.liability(MARKET_ID, address(meme), 1), 30);
        assertEq(gauge.lastFeeAsset(), address(meme));
    }

    function test_nativeCreditUsesTheSameSnapshotAndLiabilityRules() public {
        registry.configure(
            MARKET_ID,
            address(source),
            address(0),
            address(meme),
            address(gauge),
            FEE_POLICY_ID,
            EXECUTION_SPEC_ID,
            SOURCE_VERSION,
            POOL_ID
        );
        gauge.setActive(B);
        bytes32 feeId = _feeId(address(0), 10_000, 100, 1);
        vm.deal(address(this), 100);
        source.creditNative{value: 100}(
            IV4AccountingVault(address(vault)), poolManager, MARKET_ID, SOURCE_VERSION, 10_000, 100, 0, 100, 1, feeId
        );
        assertEq(address(vault).balance, 100);
        assertEq(vault.totalLiability(address(0)), 100);
        assertEq(vault.liability(MARKET_ID, address(0), 1), 30);
    }

    function test_realGaugeDistributesStakerBucketByActiveRawStockAndClaimsThroughVault() public {
        vm.warp(1_000_000);
        V4AccountingAllocationManagerMock manager = new V4AccountingAllocationManagerMock();
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
            FEE_POLICY_ID,
            EXECUTION_SPEC_ID,
            SOURCE_VERSION,
            POOL_ID
        );

        uint64 activationAt = uint64(block.timestamp + 30 seconds);
        uint64 unlockAt = uint64(block.timestamp + 20 minutes);
        manager.add(realGauge, ALICE, B / 2, activationAt, unlockAt);
        manager.add(realGauge, BOB, B / 2, activationAt, unlockAt);
        vm.warp(activationAt);

        quote.mint(address(source), 100);
        bytes32 feeId = _feeId(address(quote), 10_000, 100, 1);
        _creditErc20(quote, 10_000, 100, 0, 100, 1, feeId);

        assertEq(realGauge.storedTotalActiveStock(), B);
        vm.warp(unlockAt);
        assertEq(vault.liability(MARKET_ID, address(quote), 1), 30);
        assertEq(vault.claimStakerFor(ALICE, MARKET_ID, address(quote)), 15);
        assertEq(vault.claimStakerFor(BOB, MARKET_ID, address(quote)), 15);
        assertEq(quote.balanceOf(ALICE), 15);
        assertEq(quote.balanceOf(BOB), 15);
        assertEq(vault.liability(MARKET_ID, address(quote), 1), 0);
        assertEq(vault.totalLiability(address(quote)), 70);
    }

    function test_feeIdAndNonceMustMatchEveryCanonicalFieldAndSequence() public {
        gauge.setActive(B);
        quote.mint(address(source), 300);
        bytes32 wrong = keccak256("wrong-fee-id");
        vm.expectRevert(abi.encodeWithSelector(ProtocolFeeVaultV4Credit.FeeCreditNotPrepared.selector, wrong));
        _creditErc20(quote, 10_000, 100, 0, 100, 1, wrong);
        assertEq(quote.balanceOf(address(source)), 300);

        bytes32 skipped = _feeId(address(quote), 10_000, 100, 2);
        vm.expectRevert(abi.encodeWithSelector(ProtocolFeeVaultV4Credit.FeeCreditNotPrepared.selector, skipped));
        _creditErc20(quote, 10_000, 100, 0, 100, 2, skipped);

        bytes32 first = _feeId(address(quote), 10_000, 100, 1);
        _creditErc20(quote, 10_000, 100, 0, 100, 1, first);
        bytes32 repeated = _feeId(address(quote), 10_100, 101, 1);
        vm.expectRevert(abi.encodeWithSelector(ProtocolFeeVaultV4Credit.FeeCreditNotPrepared.selector, repeated));
        _creditErc20(quote, 10_100, 101, 0, 101, 1, repeated);
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
        _creditErc20(quote, 10_000, 101, 0, 100, 1, wrongTotal);

        bytes32 wrongPartition = _feeId(address(quote), 10_000, 100, 1);
        vm.expectRevert();
        _creditErc20(quote, 10_000, 100, 19, 81, 1, wrongPartition);
        assertEq(quote.balanceOf(address(source)), 161);
        assertEq(vault.totalLiability(address(quote)), 0);
    }

    function test_policyOrCreatorEpochDriftRollsBackEverything() public {
        gauge.setActive(B);
        quote.mint(address(source), 100);
        bytes32 feeId = _feeId(address(quote), 10_000, 100, 1);
        _configure(keccak256("other-policy"), EXECUTION_SPEC_ID);
        vm.expectRevert();
        _creditErc20(quote, 10_000, 100, 0, 100, 1, feeId);

        _configure(FEE_POLICY_ID, EXECUTION_SPEC_ID);
        creatorRegistry.setEpoch(MARKET_ID, 0, address(0));
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolFeeVaultV4Accounting.CreatorEpochUnavailableForV4.selector, MARKET_ID, uint32(0)
            )
        );
        _creditErc20(quote, 10_000, 100, 0, 100, 1, feeId);
        assertEq(quote.balanceOf(address(source)), 100);
        assertFalse(vault.consumedFeeId(feeId));
    }

    function test_gaugeCheckpointOrCreditFailureRollsBackTransferFeeIdAndNonce() public {
        gauge.setActive(B);
        quote.mint(address(source), 100);
        bytes32 feeId = _feeId(address(quote), 10_000, 100, 1);
        gauge.setFailures(true, false);
        vm.expectRevert("CHECKPOINT_REJECTED");
        _creditErc20(quote, 10_000, 100, 0, 100, 1, feeId);
        assertEq(gauge.checkpointCalls(), 0);

        gauge.setFailures(false, true);
        vm.expectRevert("CREDIT_REJECTED");
        _creditErc20(quote, 10_000, 100, 0, 100, 1, feeId);
        assertEq(quote.balanceOf(address(source)), 100);
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
                keccak256("TICKERGARDEN_V1_V4_FEE"),
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
            feePolicyId,
            executionSpecId,
            SOURCE_VERSION,
            POOL_ID
        );
    }
}
