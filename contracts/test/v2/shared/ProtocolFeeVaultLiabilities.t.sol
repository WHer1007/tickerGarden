// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {IProtocolFeeVault, MarketConfig, MarketRuntime, MarketView} from "../../../src/v2/interfaces/IV2Protocol.sol";
import {ProtocolFeeVaultLiabilities} from "../../../src/v2/shared/ProtocolFeeVaultLiabilities.sol";
import {ProtocolFeeVaultV4Credit} from "../../../src/v2/shared/ProtocolFeeVaultV4Credit.sol";
import {
    IV2QuoteTransferCallback,
    MockCallbackQuoteToken,
    MockExactQuoteToken,
    MockRebasingQuoteToken
} from "../mocks/MockV2QuoteAssets.sol";

interface ILiabilityClaimVault {
    function claimCreator(bytes32, uint32, address) external returns (uint256);
    function claimPlatform(bytes32, address) external returns (uint256);
    function claimStaker(bytes32, address) external returns (uint256);
    function claimStakerFor(address, bytes32, address) external returns (uint256);
}

interface ILiabilityCurveCreditVault {
    function creditCurveSweep(bytes32, address, uint256, uint32, uint64, bytes32) external payable;
}

contract LiabilityMarketRegistryMock {
    mapping(bytes32 => MarketView) private _markets;

    function configure(bytes32 marketId, address quoteAsset, address memeToken, address gauge) external {
        MarketConfig memory config;
        config.quoteAsset = quoteAsset;
        config.memeToken = memeToken;
        config.gauge = gauge;
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
        config.graduatedHook = hook;
        MarketRuntime memory runtime;
        runtime.poolId = keccak256("pool");
        runtime.sourceVersion = sourceVersion;
        runtime.launchPhase = 2;
        _markets[marketId] = MarketView({config: config, runtime: runtime});
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
    bool public rejectConsume;

    function setClaimable(address user, address feeAsset, uint256 amount) external {
        claimable[user][feeAsset] = amount;
    }

    function setRejectConsume(bool value) external {
        rejectConsume = value;
    }

    function consumeClaimable(address user, address feeAsset) external returns (uint256 amount) {
        if (rejectConsume) revert("GAUGE_REJECTED");
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
        require(quote.transfer(address(vault), amount), "TRANSFER");
        vault.creditCurveSweep(marketId, address(quote), amount, sourceVersion, sweepNonce, feeId);
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

contract LiabilityReentrantBeneficiary is IV2QuoteTransferCallback {
    ILiabilityClaimVault private immutable _vault;
    bytes32 private immutable _marketId;
    address private immutable _feeAsset;
    bool public reentryBlocked;

    constructor(ILiabilityClaimVault vault_, bytes32 marketId_, address feeAsset_) {
        _vault = vault_;
        _marketId = marketId_;
        _feeAsset = feeAsset_;
    }

    function onV2QuoteTransfer(address, address, uint256) external {
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

    function _recordExactV4Credit(V4CreditRecord memory) internal pure override {}
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

    function test_claimAndLiabilitySelectorsMatchCanonicalInterface() public pure {
        assertEq(ProtocolFeeVaultLiabilities.claimCreator.selector, IProtocolFeeVault.claimCreator.selector);
        assertEq(ProtocolFeeVaultLiabilities.claimPlatform.selector, IProtocolFeeVault.claimPlatform.selector);
        assertEq(ProtocolFeeVaultLiabilities.claimStaker.selector, IProtocolFeeVault.claimStaker.selector);
        assertEq(ProtocolFeeVaultLiabilities.claimStakerFor.selector, IProtocolFeeVault.claimStakerFor.selector);
        assertEq(ProtocolFeeVaultLiabilities.liability.selector, IProtocolFeeVault.liability.selector);
        assertEq(ProtocolFeeVaultLiabilities.creatorLiability.selector, IProtocolFeeVault.creatorLiability.selector);
        assertEq(ProtocolFeeVaultLiabilities.totalLiability.selector, IProtocolFeeVault.totalLiability.selector);
        assertEq(ProtocolFeeVaultLiabilities.consumedFeeId.selector, IProtocolFeeVault.consumedFeeId.selector);
    }

    function test_curveCreditWritesEpochLiabilitiesAndConsumesCanonicalFeeId() public {
        uint32 sourceVersion = 7;
        LiabilityCurveSourceMock curve = new LiabilityCurveSourceMock();
        registry.configureCurve(MARKET_ID, address(quote), address(meme), address(gauge), address(curve), sourceVersion);
        creatorRegistry.setEpoch(MARKET_ID, 2, CREATOR_TWO);
        quote.mint(address(curve), 81);
        bytes32 feeId = keccak256(
            abi.encode(
                keccak256("TICKERGARDEN_V2_CURVE_SWEEP"),
                uint256(1),
                block.chainid,
                address(vault),
                address(curve),
                MARKET_ID,
                sourceVersion,
                uint64(1),
                address(quote),
                uint256(81)
            )
        );

        vm.expectEmit(true, true, true, true, address(vault));
        emit CurveFeesSwept(MARKET_ID, 2, address(quote), 1, feeId, 81, 40, 41);
        curve.sweep(ILiabilityCurveCreditVault(address(vault)), quote, MARKET_ID, 81, sourceVersion, 1, feeId);

        assertEq(vault.creatorLiability(MARKET_ID, 2, address(quote)), 40);
        assertEq(vault.liability(MARKET_ID, address(quote), 0), 40);
        assertEq(vault.liability(MARKET_ID, address(quote), 1), 0);
        assertEq(vault.liability(MARKET_ID, address(quote), 2), 41);
        assertEq(vault.totalLiability(address(quote)), 81);
        assertTrue(vault.consumedFeeId(feeId));
    }

    function test_creatorClaimIsPermissionlessButPaysHistoricalEpochBeneficiary() public {
        _fundAndCredit(address(quote), 80, 40, 0, 40, 1);
        vm.expectEmit(true, true, true, true, address(vault));
        emit FeeClaimed(0, CREATOR_ONE, MARKET_ID, 1, address(quote), 40);
        vm.prank(BOB);
        uint256 amount = vault.claimCreator(MARKET_ID, 1, address(quote));

        assertEq(amount, 40);
        assertEq(quote.balanceOf(CREATOR_ONE), 40);
        assertEq(quote.balanceOf(BOB), 0);
        assertEq(quote.balanceOf(CREATOR_TWO), 0);
        assertEq(vault.creatorLiability(MARKET_ID, 1, address(quote)), 0);
        assertEq(vault.liability(MARKET_ID, address(quote), 0), 0);
        assertEq(vault.totalLiability(address(quote)), 40);
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

    function test_stakerClaimsConsumeOnlySelectedAssetAndAlwaysPayFixedUser() public {
        _fundAndCredit(address(quote), 60, 20, 20, 20, 1);
        _fundAndCredit(address(meme), 60, 20, 20, 20, 1);
        gauge.setClaimable(ALICE, address(quote), 13);
        gauge.setClaimable(ALICE, address(meme), 17);

        vm.prank(BOB);
        uint256 quoteAmount = vault.claimStakerFor(ALICE, MARKET_ID, address(quote));
        assertEq(quoteAmount, 13);
        assertEq(quote.balanceOf(ALICE), 13);
        assertEq(quote.balanceOf(BOB), 0);
        assertEq(gauge.claimable(ALICE, address(meme)), 17);
        assertEq(vault.liability(MARKET_ID, address(quote), 1), 7);
        assertEq(vault.liability(MARKET_ID, address(meme), 1), 20);

        vm.prank(ALICE);
        uint256 memeAmount = vault.claimStaker(MARKET_ID, address(meme));
        assertEq(memeAmount, 17);
        assertEq(meme.balanceOf(ALICE), 17);
        assertEq(vault.liability(MARKET_ID, address(meme), 1), 3);
    }

    function test_zeroClaimsReturnWithoutMovingOtherBuckets() public {
        _fundAndCredit(address(quote), 80, 40, 0, 40, 1);
        assertEq(vault.claimStakerFor(ALICE, MARKET_ID, address(quote)), 0);
        assertEq(vault.claimCreator(MARKET_ID, 2, address(quote)), 0);
        assertEq(vault.totalLiability(address(quote)), 80);
    }

    function test_pendingV4CreditBlocksClaimsUntilTheAtomicCreditFinishes() public {
        registry.configureV4(MARKET_ID, address(quote), address(meme), address(gauge), address(this), 1);
        bytes32 feeId = keccak256("pending-v4");
        vault.beginV4Credit(MARKET_ID, address(quote), 1, 1, feeId);

        vm.expectRevert(
            abi.encodeWithSelector(ProtocolFeeVaultV4Credit.FeeCreditNotPrepared.selector, bytes32("CLAIM_PLATFORM"))
        );
        vault.claimPlatform(MARKET_ID, address(quote));
    }

    function test_invalidMarketAssetBucketEpochAndUserFailClosed() public {
        MockExactQuoteToken third = new MockExactQuoteToken(8);
        vm.expectRevert(abi.encodeWithSelector(ProtocolFeeVaultLiabilities.InvalidFeeMarket.selector, OTHER_MARKET_ID));
        vault.claimPlatform(OTHER_MARKET_ID, address(0));
        vm.expectRevert(abi.encodeWithSelector(ProtocolFeeVaultV4Credit.FeeAssetNotCanonical.selector, address(third)));
        vault.claimPlatform(MARKET_ID, address(third));
        vm.expectRevert(abi.encodeWithSelector(ProtocolFeeVaultLiabilities.InvalidBucketType.selector, uint8(3)));
        vault.liability(MARKET_ID, address(quote), 3);
        vm.expectRevert(abi.encodeWithSelector(ProtocolFeeVaultLiabilities.InvalidFeeBeneficiary.selector, address(0)));
        vault.claimCreator(MARKET_ID, 0, address(quote));
        vm.expectRevert(abi.encodeWithSelector(ProtocolFeeVaultLiabilities.InvalidFeeBeneficiary.selector, address(0)));
        vault.claimStakerFor(address(0), MARKET_ID, address(quote));
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

    function test_gaugeOverconsumeOrFailureRollsBackGaugeAndLiability() public {
        _fundAndCredit(address(quote), 20, 0, 20, 0, 1);
        gauge.setClaimable(ALICE, address(quote), 21);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolFeeVaultLiabilities.InsufficientStakerLiability.selector, MARKET_ID, address(quote), 20, 21
            )
        );
        vault.claimStakerFor(ALICE, MARKET_ID, address(quote));
        assertEq(gauge.claimable(ALICE, address(quote)), 21);
        assertEq(vault.liability(MARKET_ID, address(quote), 1), 20);

        gauge.setRejectConsume(true);
        vm.expectRevert("GAUGE_REJECTED");
        vault.claimStakerFor(ALICE, MARKET_ID, address(quote));
        assertEq(vault.liability(MARKET_ID, address(quote), 1), 20);
    }

    function test_erc20TransferFailureRollsBackClaimAndLiabilities() public {
        LiabilityFalseTransferToken failing = new LiabilityFalseTransferToken();
        registry.configure(MARKET_ID, address(failing), address(meme), address(gauge));
        failing.mint(address(vault), 80);
        vault.creditBuckets(MARKET_ID, 1, address(failing), 80, 40, 0, 40);

        vm.expectRevert();
        vault.claimCreator(MARKET_ID, 1, address(failing));
        assertEq(vault.creatorLiability(MARKET_ID, 1, address(failing)), 40);
        assertEq(vault.totalLiability(address(failing)), 80);
        assertEq(failing.balanceOf(address(vault)), 80);
    }

    function test_rejectedNativeClaimDoesNotBlockSameEpochErc20Claim() public {
        LiabilityRejectingBeneficiary rejecting = new LiabilityRejectingBeneficiary();
        creatorRegistry.setEpoch(MARKET_ID, 1, address(rejecting));
        registry.configure(MARKET_ID, address(0), address(meme), address(gauge));
        vm.deal(address(vault), 80);
        vault.creditBuckets(MARKET_ID, 1, address(0), 80, 40, 0, 40);
        meme.mint(address(vault), 80);
        vault.creditBuckets(MARKET_ID, 1, address(meme), 80, 40, 0, 40);

        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolFeeVaultLiabilities.NativeFeeClaimFailed.selector, address(rejecting), uint256(40)
            )
        );
        vault.claimCreator(MARKET_ID, 1, address(0));
        assertEq(vault.creatorLiability(MARKET_ID, 1, address(0)), 40);

        assertEq(vault.claimCreator(MARKET_ID, 1, address(meme)), 40);
        assertEq(meme.balanceOf(address(rejecting)), 40);
        assertEq(vault.creatorLiability(MARKET_ID, 1, address(meme)), 0);
    }

    function test_transferCallbackCannotReenterAnotherBucketClaim() public {
        MockCallbackQuoteToken callbackToken = new MockCallbackQuoteToken(18);
        registry.configure(MARKET_ID, address(callbackToken), address(meme), address(gauge));
        LiabilityReentrantBeneficiary beneficiary =
            new LiabilityReentrantBeneficiary(ILiabilityClaimVault(address(vault)), MARKET_ID, address(callbackToken));
        creatorRegistry.setEpoch(MARKET_ID, 1, address(beneficiary));
        callbackToken.mint(address(vault), 80);
        vault.creditBuckets(MARKET_ID, 1, address(callbackToken), 80, 40, 0, 40);
        callbackToken.setCallbackEnabled(true);

        assertEq(vault.claimCreator(MARKET_ID, 1, address(callbackToken)), 40);
        assertTrue(beneficiary.reentryBlocked());
        assertEq(vault.liability(MARKET_ID, address(callbackToken), 2), 40);
        assertEq(callbackToken.balanceOf(address(treasury)), 0);
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
