// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {MarketConfig, MarketRuntime, MarketView} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {IProtocolFeeVault} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {ProtocolFeeVaultLiabilities} from "../../../src/v1/shared/ProtocolFeeVaultLiabilities.sol";
import {ProtocolFeeVaultV4Credit} from "../../../src/v1/shared/ProtocolFeeVaultV4Credit.sol";
import {
    IV1QuoteTransferCallback,
    MockCallbackQuoteToken,
    MockExactQuoteToken,
    MockFeeOnTransferQuoteToken,
    MockRebasingQuoteToken
} from "../mocks/MockV1QuoteAssets.sol";

interface ILiabilityClaimVault {
    function claimPlatform(bytes32, address) external returns (uint256);
}

interface ILiabilityCurveCreditVault {
    function beginCurveCredit(bytes32, address, uint256, uint256, uint32, uint64, bytes32) external;
    function finalizeCurveCredit(bytes32, address, uint256, uint256, uint32, uint64, bytes32) external payable;
}

contract LiabilityMarketRegistryMock {
    mapping(bytes32 => MarketView) private _markets;

    function configure(bytes32 marketId, address quoteAsset, address memeToken, address gauge) external {
        MarketConfig memory config;
        config.quoteAsset = quoteAsset;
        config.memeToken = memeToken;
        config.gauge = gauge;
        config.stakingEnabled = true;
        MarketRuntime memory runtime;
        _markets[marketId] = MarketView({config: config, runtime: runtime});
    }

    function configureCurve(
        bytes32 marketId,
        address quoteAsset,
        address memeToken,
        address gauge,
        address curve,
        uint32 sourceVersion
    ) external {
        MarketConfig memory config;
        config.quoteAsset = quoteAsset;
        config.memeToken = memeToken;
        config.gauge = gauge;
        config.stakingEnabled = true;
        config.curve = curve;
        MarketRuntime memory runtime;
        runtime.sourceVersion = sourceVersion;
        _markets[marketId] = MarketView({config: config, runtime: runtime});
    }

    function configureV4(
        bytes32 marketId,
        address quoteAsset,
        address memeToken,
        address gauge,
        address hook,
        uint32 sourceVersion
    ) external {
        MarketConfig memory config;
        config.quoteAsset = quoteAsset;
        config.memeToken = memeToken;
        config.gauge = gauge;
        config.stakingEnabled = true;
        config.graduatedHook = hook;
        MarketRuntime memory runtime;
        runtime.poolId = keccak256("pool");
        runtime.sourceVersion = sourceVersion;
        runtime.launchPhase = 1;
        _markets[marketId] = MarketView({config: config, runtime: runtime});
    }

    function disableStaking(bytes32 marketId) external {
        _markets[marketId].config.stakingEnabled = false;
        _markets[marketId].config.gauge = address(0);
    }

    function market(bytes32 marketId) external view returns (MarketView memory) {
        return _markets[marketId];
    }
}

contract LiabilityCreatorRegistryMock {
    mapping(bytes32 => uint32) public currentCreatorEpoch;
    mapping(bytes32 => mapping(uint32 => address)) public creatorBeneficiaryAt;

    function setEpoch(bytes32 marketId, uint32 epoch, address beneficiary) external {
        currentCreatorEpoch[marketId] = epoch;
        creatorBeneficiaryAt[marketId][epoch] = beneficiary;
    }
}

contract LiabilityGaugeMock {
    mapping(address => mapping(address => uint256)) public claimable;
    mapping(address => uint64) public unlockAt;
    bool public rejectConsume;

    function setClaimable(address user, address feeAsset, uint256 amount) external {
        claimable[user][feeAsset] = amount;
    }

    function setRejectConsume(bool value) external {
        rejectConsume = value;
    }

    function setUnlockAt(address user, uint64 unlockAt_) external {
        unlockAt[user] = unlockAt_;
    }

    function consumeClaimable(address user, address feeAsset) external returns (uint256 amount) {
        if (rejectConsume) revert("GAUGE_REJECTED");
        if (block.timestamp < unlockAt[user]) revert("POSITION_LOCKED");
        amount = claimable[user][feeAsset];
        claimable[user][feeAsset] = 0;
    }
}

contract LiabilityPoolManagerMock {}

contract LiabilityCurveSourceMock {
    function sweep(
        ILiabilityCurveCreditVault vault,
        MockExactQuoteToken quote,
        bytes32 marketId,
        uint256 amount,
        uint32 sourceVersion,
        uint64 sweepNonce,
        bytes32 feeId
    ) external {
        vault.beginCurveCredit(marketId, address(quote), amount, 0, sourceVersion, sweepNonce, feeId);
        require(quote.transfer(address(vault), amount), "TRANSFER");
        vault.finalizeCurveCredit(marketId, address(quote), amount, 0, sourceVersion, sweepNonce, feeId);
    }
}

contract LiabilityTreasury {
    receive() external payable {}
}

contract LiabilityRejectingBeneficiary {
    receive() external payable {
        revert("NO_NATIVE");
    }
}

contract LiabilityReentrantBeneficiary is IV1QuoteTransferCallback {
    ILiabilityClaimVault private immutable _vault;
    bytes32 private immutable _marketId;
    address private immutable _feeAsset;
    bool public reentryBlocked;

    constructor(ILiabilityClaimVault vault_, bytes32 marketId_, address feeAsset_) {
        _vault = vault_;
        _marketId = marketId_;
        _feeAsset = feeAsset_;
    }

    function onV1QuoteTransfer(address, address, uint256) external {
        try _vault.claimPlatform(_marketId, _feeAsset) returns (uint256) {
            revert("REENTRY_SUCCEEDED");
        } catch {
            reentryBlocked = true;
        }
    }
}

contract LiabilityFalseTransferToken is MockExactQuoteToken {
    constructor() MockExactQuoteToken(18) {}

    function transfer(address, uint256) external pure override returns (bool) {
        return false;
    }
}

contract ProtocolFeeVaultLiabilitiesHarness is ProtocolFeeVaultLiabilities {
    constructor(address marketRegistry, address poolManager, address creatorRegistry, address treasury)
        ProtocolFeeVaultLiabilities(marketRegistry, poolManager, creatorRegistry, treasury)
    {}

    function creditBuckets(
        bytes32 marketId,
        uint32 creatorEpoch,
        address feeAsset,
        uint256 amount,
        uint256 creatorAmount,
        uint256 stakerAmount,
        uint256 platformAmount
    ) external {
        _creditFeeLiabilities(marketId, creatorEpoch, feeAsset, amount, creatorAmount, stakerAmount, platformAmount);
    }

    function _recordExactV4Credit(V4CreditRecord memory, MarketView memory) internal pure override {}
}

contract ProtocolFeeVaultLiabilitiesTest is Test {
    event CurveFeesSwept(
        bytes32 indexed marketId,
        uint32 indexed creatorEpoch,
        address indexed quoteAsset,
        uint64 sweepNonce,
        bytes32 feeId,
        uint256 amount,
        uint256 creatorAmount,
        uint256 platformAmount
    );
    event FeeClaimed(
        uint8 indexed beneficiaryType,
        address indexed beneficiary,
        bytes32 indexed marketId,
        uint32 beneficiaryEpoch,
        address feeAsset,
        uint256 amount
    );

    bytes32 private constant MARKET_ID = keccak256("liability-market");
    bytes32 private constant OTHER_MARKET_ID = keccak256("other-liability-market");
    address private constant CREATOR_ONE = address(0xC001);
    address private constant CREATOR_TWO = address(0xC002);
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);

    LiabilityMarketRegistryMock private registry;
    LiabilityCreatorRegistryMock private creatorRegistry;
    LiabilityGaugeMock private gauge;
    LiabilityPoolManagerMock private poolManager;
    LiabilityTreasury private treasury;
    ProtocolFeeVaultLiabilitiesHarness private vault;
    MockExactQuoteToken private quote;
    MockExactQuoteToken private meme;

    function setUp() public {
        registry = new LiabilityMarketRegistryMock();
        creatorRegistry = new LiabilityCreatorRegistryMock();
        gauge = new LiabilityGaugeMock();
        poolManager = new LiabilityPoolManagerMock();
        treasury = new LiabilityTreasury();
        vault = new ProtocolFeeVaultLiabilitiesHarness(
            address(registry), address(poolManager), address(creatorRegistry), address(treasury)
        );
        quote = new MockExactQuoteToken(6);
        meme = new MockExactQuoteToken(18);
        registry.configure(MARKET_ID, address(quote), address(meme), address(gauge));
        creatorRegistry.setEpoch(MARKET_ID, 1, CREATOR_ONE);
        creatorRegistry.setEpoch(MARKET_ID, 2, CREATOR_TWO);
    }

    function test_dualAssetCreditsRemainIsolatedAndEveryViewConservesLiability() public {
        _fundAndCredit(address(quote), 100, 40, 20, 40, 1);
        _fundAndCredit(address(meme), 75, 30, 15, 30, 2);

        assertEq(vault.creatorLiability(MARKET_ID, 1, address(quote)), 40);
        assertEq(vault.creatorLiability(MARKET_ID, 2, address(meme)), 30);
        assertEq(vault.liability(MARKET_ID, address(quote), 0), 40);
        assertEq(vault.liability(MARKET_ID, address(quote), 1), 20);
        assertEq(vault.liability(MARKET_ID, address(quote), 2), 40);
        assertEq(vault.totalLiability(address(quote)), 100);
        assertEq(vault.totalLiability(address(meme)), 75);
        assertEq(quote.balanceOf(address(vault)), 100);
        assertEq(meme.balanceOf(address(vault)), 75);
    }

    function test_curveCreditWritesEpochLiabilitiesAndConsumesCanonicalFeeId() public {
        uint32 sourceVersion = 7;
        LiabilityCurveSourceMock curve = new LiabilityCurveSourceMock();
        registry.configureCurve(MARKET_ID, address(quote), address(meme), address(gauge), address(curve), sourceVersion);
        creatorRegistry.setEpoch(MARKET_ID, 2, CREATOR_TWO);
        quote.mint(address(curve), 81);
        bytes32 feeId = keccak256(
            abi.encode(
                keccak256("TICKERGARDEN_V1_CURVE_SWEEP"),
                uint256(1),
                block.chainid,
                address(vault),
                address(curve),
                MARKET_ID,
                sourceVersion,
                uint64(1),
                address(quote),
                uint256(81),
                uint256(0)
            )
        );

        vm.expectEmit(true, true, true, true, address(vault));
        emit CurveFeesSwept(MARKET_ID, 2, address(quote), 1, feeId, 81, 57, 24);
        curve.sweep(ILiabilityCurveCreditVault(address(vault)), quote, MARKET_ID, 81, sourceVersion, 1, feeId);

        assertEq(vault.creatorLiability(MARKET_ID, 2, address(quote)), 57);
        assertEq(vault.liability(MARKET_ID, address(quote), 0), 57);
        assertEq(vault.liability(MARKET_ID, address(quote), 1), 0);
        assertEq(vault.liability(MARKET_ID, address(quote), 2), 24);
        assertEq(vault.totalLiability(address(quote)), 81);
        assertTrue(vault.consumedFeeId(feeId));
    }

    function test_platformClaimAlwaysPaysImmutableTreasury() public {
        _fundAndCredit(address(quote), 80, 40, 0, 40, 1);
        vm.prank(ALICE);
        uint256 amount = vault.claimPlatform(MARKET_ID, address(quote));

        assertEq(amount, 40);
        assertEq(quote.balanceOf(address(treasury)), 40);
        assertEq(quote.balanceOf(ALICE), 0);
        assertEq(vault.liability(MARKET_ID, address(quote), 2), 0);
    }

    function test_forfeitureReserveConvertsToPlatformOnNextClaimForBothAssets() public {
        _fundAndCredit(address(quote), 20, 0, 20, 0, 1);
        _fundAndCredit(address(meme), 30, 0, 30, 0, 1);

        vm.prank(address(gauge));
        vault.recordForfeiture(MARKET_ID, ALICE, 7, 11);
        assertEq(vault.forfeitureReserve(MARKET_ID, address(quote)), 7);
        assertEq(vault.forfeitureReserve(MARKET_ID, address(meme)), 11);
        assertEq(vault.liability(MARKET_ID, address(quote), 1), 13);
        assertEq(vault.liability(MARKET_ID, address(meme), 1), 19);

        vm.prank(BOB);
        assertEq(vault.claimPlatform(MARKET_ID, address(quote)), 7);
        vm.prank(BOB);
        assertEq(vault.claimPlatform(MARKET_ID, address(meme)), 11);
        assertEq(vault.forfeitureReserve(MARKET_ID, address(quote)), 0);
        assertEq(vault.forfeitureReserve(MARKET_ID, address(meme)), 0);
        assertEq(vault.liability(MARKET_ID, address(quote), 1), 13);
        assertEq(vault.liability(MARKET_ID, address(meme), 1), 19);
        assertEq(quote.balanceOf(address(treasury)), 7);
        assertEq(meme.balanceOf(address(treasury)), 11);
    }

    function test_pendingV4CreditBlocksClaimsUntilTheAtomicCreditFinishes() public {
        // Under Forge transaction isolation, put begin and the attempted claim in one outer call.
        this.atomicPendingCreditClaim();
    }

    function atomicPendingCreditClaim() external {
        registry.configureV4(MARKET_ID, address(quote), address(meme), address(gauge), address(this), 1);
        bytes32 feeId = keccak256("pending-v4");
        vault.beginV4Credit(MARKET_ID, address(quote), 1, 1, feeId);

        vm.expectRevert(
            abi.encodeWithSelector(ProtocolFeeVaultV4Credit.FeeCreditNotPrepared.selector, bytes32("CLAIM_PLATFORM"))
        );
        vault.claimPlatform(MARKET_ID, address(quote));
    }

    function test_creditRejectsNonConservationAndInsolvencyWithoutPartialLiability() public {
        quote.mint(address(vault), 99);
        vm.expectRevert(abi.encodeWithSelector(ProtocolFeeVaultLiabilities.InvalidFeeLiabilityCredit.selector, 100, 99));
        vault.creditBuckets(MARKET_ID, 1, address(quote), 100, 40, 20, 39);
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolFeeVaultLiabilities.FeeVaultInsolvent.selector, address(quote), 99, 100)
        );
        vault.creditBuckets(MARKET_ID, 1, address(quote), 100, 40, 20, 40);
        assertEq(vault.totalLiability(address(quote)), 0);
    }

    function test_claimChecksSolvencyBeforeConsumingAnyBucket() public {
        MockRebasingQuoteToken rebasing = new MockRebasingQuoteToken(18);
        registry.configure(MARKET_ID, address(rebasing), address(meme), address(gauge));
        rebasing.mint(address(vault), 80);
        vault.creditBuckets(MARKET_ID, 1, address(rebasing), 80, 40, 0, 40);
        rebasing.simulateRebase(address(vault), 79);

        vm.expectRevert(
            abi.encodeWithSelector(ProtocolFeeVaultLiabilities.FeeVaultInsolvent.selector, address(rebasing), 79, 80)
        );
        vault.claimPlatform(MARKET_ID, address(rebasing));
        assertEq(vault.liability(MARKET_ID, address(rebasing), 2), 40);
        assertEq(vault.totalLiability(address(rebasing)), 80);
    }

    function test_feeOnTransferPlatformPaymentRevertsAndRollsBackEveryStateChange() public {
        MockFeeOnTransferQuoteToken feeToken = new MockFeeOnTransferQuoteToken(18, 1_000);
        registry.configure(MARKET_ID, address(feeToken), address(meme), address(gauge));
        feeToken.mint(address(vault), 100);
        vault.creditBuckets(MARKET_ID, 1, address(feeToken), 100, 40, 20, 40);

        vm.expectRevert();
        vault.claimPlatform(MARKET_ID, address(feeToken));

        assertEq(feeToken.balanceOf(address(vault)), 100);
        assertEq(feeToken.balanceOf(address(treasury)), 0);
        assertEq(vault.creatorLiability(MARKET_ID, 1, address(feeToken)), 40);
        assertEq(vault.liability(MARKET_ID, address(feeToken), 0), 40);
        assertEq(vault.liability(MARKET_ID, address(feeToken), 1), 20);
        assertEq(vault.liability(MARKET_ID, address(feeToken), 2), 40);
        assertEq(vault.totalLiability(address(feeToken)), 100);
    }

    function test_constructorRejectsInvalidTreasuryAliases() public {
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolFeeVaultLiabilities.InvalidPlatformTreasury.selector, address(0))
        );
        new ProtocolFeeVaultLiabilitiesHarness(
            address(registry), address(poolManager), address(creatorRegistry), address(0)
        );
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolFeeVaultLiabilities.InvalidPlatformTreasury.selector, address(creatorRegistry)
            )
        );
        new ProtocolFeeVaultLiabilitiesHarness(
            address(registry), address(poolManager), address(creatorRegistry), address(creatorRegistry)
        );
    }

    function _fundAndCredit(
        address feeAsset,
        uint256 amount,
        uint256 creatorAmount,
        uint256 stakerAmount,
        uint256 platformAmount,
        uint32 creatorEpoch
    ) private {
        MockExactQuoteToken(feeAsset).mint(address(vault), amount);
        vault.creditBuckets(MARKET_ID, creatorEpoch, feeAsset, amount, creatorAmount, stakerAmount, platformAmount);
    }
}
