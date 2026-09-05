// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import {MarketConfig, MarketRuntime, MarketView} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {ProtocolFeeVaultRewardSettlement} from "../../../src/v1/shared/ProtocolFeeVaultRewardSettlement.sol";
import {ProtocolFeeVaultLiabilities} from "../../../src/v1/shared/ProtocolFeeVaultLiabilities.sol";
import {TreasuryDistributorInitV1, TreasuryDistributorV1} from "../../../src/v1/modules/TreasuryDistributorV1.sol";
import {MockExactQuoteToken} from "../mocks/MockV1QuoteAssets.sol";

contract HolderFeeRegistryMock {
    mapping(bytes32 => MarketView) internal values;
    address public immutable factory;

    constructor(address factory_) {
        factory = factory_;
    }

    function setMarket(bytes32 id, MarketView memory value) external {
        values[id] = value;
    }

    function market(bytes32 id) external view returns (MarketView memory) {
        return values[id];
    }
}

contract HolderFeePoolManagerMock {}

contract HolderFeeDistributorMock {
    mapping(bytes32 => uint32) public currentEpochId;

    function setEpoch(bytes32 id, uint32 epoch) external {
        currentEpochId[id] = epoch;
    }
    function fundCreatorFees(bytes32, uint32, uint256) external payable {}
}

contract HolderFeeCreatorMock {
    mapping(bytes32 => uint32) public currentCreatorEpoch;
    mapping(bytes32 => mapping(uint32 => address)) public creatorBeneficiaryAt;

    function setEpoch(bytes32 id, uint32 epoch, address beneficiary) external {
        currentCreatorEpoch[id] = epoch;
        creatorBeneficiaryAt[id][epoch] = beneficiary;
    }
}

contract HolderFeeMemeMock is MockExactQuoteToken {
    bytes32 public immutable marketId;
    address public immutable treasuryDistributor;
    uint256 public totalSupply;

    constructor(bytes32 id, address distributor) MockExactQuoteToken(18) {
        marketId = id;
        treasuryDistributor = distributor;
    }

    function mintSupply(address account, uint256 amount) external {
        this.mint(account, amount);
        totalSupply += amount;
    }
}

contract HolderFeeHookMock {
    address public immutable poolManager;
    address public immutable protocolFeeVault;
    MockExactQuoteToken public immutable meme;
    MockExactQuoteToken public immutable quote;

    constructor(address poolManager_, address vault_, MockExactQuoteToken meme_, MockExactQuoteToken quote_) {
        poolManager = poolManager_;
        protocolFeeVault = vault_;
        meme = meme_;
        quote = quote_;
    }

    function convertRewards(bytes32, uint256 amount, uint256, uint256)
        external
        returns (uint256 spent, uint256 received)
    {
        meme.transferFrom(msg.sender, address(this), amount);
        spent = amount;
        received = amount * 2;
        quote.mint(msg.sender, received);
    }
}

contract HolderFeeVaultHarness is ProtocolFeeVaultRewardSettlement {
    constructor(address registry, address creators, address treasury, bytes32 policy)
        ProtocolFeeVaultRewardSettlement(registry, address(new HolderFeePoolManagerMock()), creators, treasury, policy)
    {}

    function seedHolder(bytes32 id, uint32 epoch, address asset, uint256 amount) external {
        _creditHolderFee(id, epoch, asset, amount);
    }

    function recordCurve(
        bytes32 id,
        uint32 epoch,
        address asset,
        uint256 amount,
        uint256 creatorAmount,
        uint256 platformAmount
    ) external {
        _creditFeeLiabilities(id, epoch, asset, amount, creatorAmount, 0, platformAmount);
    }
}

contract HolderFeeSharingTest is Test {
    bytes32 internal constant ID = keccak256("holder-fee-market");
    address internal constant CREATOR = address(0xC0FFEE);
    address internal constant TREASURY = address(0x7000);
    address internal constant POOL_MANAGER = address(0x9000);
    address internal constant LOCKER = address(0xA000);

    HolderFeeRegistryMock internal registry;
    HolderFeeCreatorMock internal creators;
    HolderFeeDistributorMock internal holderMock;
    HolderFeeVaultHarness internal vault;
    MockExactQuoteToken internal quote;
    HolderFeeMemeMock internal meme;
    HolderFeeHookMock internal hook;
    TreasuryDistributorV1 internal distributor;
    MarketConfig internal config;

    function setUp() public {
        registry = new HolderFeeRegistryMock(address(this));
        creators = new HolderFeeCreatorMock();
        holderMock = new HolderFeeDistributorMock();
        holderMock.setEpoch(ID, 1);
        quote = new MockExactQuoteToken(6);
        vault = new HolderFeeVaultHarness(address(registry), address(creators), TREASURY, keccak256("policy"));
        meme = new HolderFeeMemeMock(ID, address(holderMock));
        hook = new HolderFeeHookMock(POOL_MANAGER, address(vault), meme, quote);
        config = MarketConfig({
            assetUid: bytes32(0),
            ponsBaselineId: bytes32(0),
            quoteAssetConfigId: bytes32(0),
            launchTemplateId: bytes32(0),
            feePolicyId: keccak256("policy-id"),
            executionSpecId: keccak256("V1-EXEC-11"),
            expectedEconomics: bytes32(0),
            launchConfigId: 0,
            creatorRevenueBeneficiaryAtCreation: CREATOR,
            memeToken: address(meme),
            curve: address(this),
            gauge: address(0x1234),
            quoteAsset: address(quote),
            graduatedHook: address(hook),
            creatorTaxBps: 1000,
            creatorFeesToHolders: true
        });
        registry.setMarket(ID, MarketView(config, MarketRuntime(bytes32(0), 1, 0)));
        creators.setEpoch(ID, 1, CREATOR);
        meme.mintSupply(address(vault), 1_000 ether);
    }

    function test_enabledTradingFeeEarmarksOnlyBaseHolderShareAndRetainsCreatorTax() public {
        // The public curve credit path supplies total fee and creator tax; the implementation splits base 50/50.
        uint256 total = 100 ether;
        uint256 tax = 10 ether;
        bytes32 feeId = keccak256(
            abi.encode(
                keccak256("TICKERGARDEN_V1_CURVE_SWEEP"),
                uint256(1),
                block.chainid,
                address(vault),
                address(this),
                ID,
                uint32(1),
                uint64(1),
                address(quote),
                total,
                tax
            )
        );
        vm.deal(address(this), total);
        vault.beginCurveCredit(ID, address(quote), total, tax, 1, 1, feeId);
        quote.mint(address(vault), total);
        vault.finalizeCurveCredit(ID, address(quote), total, tax, 1, 1, feeId);
        // Curve base is 90; its 70% creator leg is 63, so holders receive floor(63 / 2) = 31.5.
        assertEq(vault.holderLiability(ID, 1, address(quote)), 31.5 ether);
        assertEq(vault.creatorLiability(ID, 1, address(quote)), 41.5 ether);
        assertEq(vault.liability(ID, address(quote), 0), 41.5 ether);
    }

    function test_oddCreatorBaseRoundsHolderShareDownAndPreservesUnit() public {
        uint256 total = 101;
        uint256 tax;
        bytes32 feeId = keccak256(
            abi.encode(
                keccak256("TICKERGARDEN_V1_CURVE_SWEEP"),
                uint256(1),
                block.chainid,
                address(vault),
                address(this),
                ID,
                uint32(1),
                uint64(1),
                address(quote),
                total,
                tax
            )
        );
        vault.beginCurveCredit(ID, address(quote), total, tax, 1, 1, feeId);
        quote.mint(address(vault), total);
        vault.finalizeCurveCredit(ID, address(quote), total, tax, 1, 1, feeId);
        assertEq(vault.holderLiability(ID, 1, address(quote)), 35);
        assertEq(vault.creatorLiability(ID, 1, address(quote)), 36);
    }

    function test_disabledTradingFeeKeepsCreatorLiabilityNormal() public {
        config.creatorFeesToHolders = false;
        registry.setMarket(ID, MarketView(config, MarketRuntime(bytes32(0), 1, 0)));
        quote.mint(address(vault), 100);
        vault.recordCurve(ID, 1, address(quote), 100, 100, 0);
        assertEq(vault.creatorLiability(ID, 1, address(quote)), 100);
        assertEq(vault.holderLiability(ID, 1, address(quote)), 0);
    }

    function test_holderConversionKeepsOriginalEpochAndRefundsPartialAmount() public {
        config.graduatedHook = address(hook);
        registry.setMarket(ID, MarketView(config, MarketRuntime(bytes32(0), 1, 1)));
        quote.mint(address(vault), 80);
        vault.seedHolder(ID, 7, address(meme), 100);
        vm.prank(TREASURY);
        (uint256 spent, uint256 received) = vault.settleHolderRewards(ID, 7, 40, 80, block.timestamp + 5 minutes);
        assertEq(spent, 40);
        assertEq(received, 80);
        assertEq(vault.holderLiability(ID, 7, address(meme)), 60);
        assertEq(vault.holderLiability(ID, 7, address(quote)), 80);
    }

    function test_creatorBeneficiaryTransferDoesNotAlterHolderEpochLiability() public {
        quote.mint(address(vault), 10);
        vault.seedHolder(ID, 1, address(quote), 10);
        creators.setEpoch(ID, 2, address(0xB0B));
        assertEq(vault.holderLiability(ID, 1, address(quote)), 10);
        assertEq(vault.holderLiability(ID, 2, address(quote)), 0);
    }

    function test_fundHolderRewardsCreditsOriginalEpochAndClearsLiability() public {
        distributor = _newDistributor();
        meme = new HolderFeeMemeMock(ID, address(distributor));
        meme.mintSupply(address(this), 1);
        hook = new HolderFeeHookMock(POOL_MANAGER, address(vault), meme, quote);
        config.memeToken = address(meme);
        config.graduatedHook = address(hook);
        registry.setMarket(ID, MarketView(config, MarketRuntime(bytes32(0), 1, 1)));
        distributor.registerFeeSharingMarket(ID, address(vault), LOCKER);
        quote.mint(address(vault), 25);
        vault.seedHolder(ID, 1, address(quote), 25);
        assertEq(vault.fundHolderRewards(ID, 1), 25);
        assertEq(vault.holderLiability(ID, 1, address(quote)), 0);
        assertEq(distributor.epochQuoteAmount(ID, 1), 25);
        assertEq(distributor.totalQuoteLiability(address(quote)), 25);
    }

    function test_nativeFundHolderRewardsCreditsExactEpoch() public {
        distributor = _newDistributor();
        meme = new HolderFeeMemeMock(ID, address(distributor));
        meme.mintSupply(address(this), 1);
        hook = new HolderFeeHookMock(POOL_MANAGER, address(vault), meme, quote);
        config.memeToken = address(meme);
        config.graduatedHook = address(hook);
        config.quoteAsset = address(0);
        registry.setMarket(ID, MarketView(config, MarketRuntime(bytes32(0), 1, 1)));
        distributor.registerFeeSharingMarket(ID, address(vault), LOCKER);
        vm.deal(address(vault), 7);
        vault.seedHolder(ID, 1, address(0), 7);
        assertEq(vault.fundHolderRewards(ID, 1), 7);
        assertEq(vault.holderLiability(ID, 1, address(0)), 0);
        assertEq(distributor.epochQuoteAmount(ID, 1), 7);
    }

    function test_taxOnlyCreatorShareDoesNotCreateHolderLiability() public {
        uint256 total = 10;
        uint256 tax = 10;
        bytes32 feeId = keccak256(
            abi.encode(
                keccak256("TICKERGARDEN_V1_CURVE_SWEEP"),
                uint256(1),
                block.chainid,
                address(vault),
                address(this),
                ID,
                uint32(1),
                uint64(1),
                address(quote),
                total,
                tax
            )
        );
        vault.beginCurveCredit(ID, address(quote), total, tax, 1, 1, feeId);
        quote.mint(address(vault), total);
        vault.finalizeCurveCredit(ID, address(quote), total, tax, 1, 1, feeId);
        assertEq(vault.holderLiability(ID, 1, address(quote)), 0);
        assertEq(vault.creatorLiability(ID, 1, address(quote)), total);
    }

    function _newDistributor() internal returns (TreasuryDistributorV1 d) {
        d = new TreasuryDistributorV1(
            TreasuryDistributorInitV1({
                authority: address(new AccessManager(address(this))),
                marketRegistry: address(registry),
                rootServiceTreasury: TREASURY,
                rootServiceFeeAsset: address(0),
                rootServiceFeeAmount: 1,
                finalityDelaySeconds: 1,
                finalityDelayBlocks: 1,
                rootPublicationWindow: 1 days,
                rootReviewDelay: 1 hours,
                claimWindow: 30 days
            })
        );
    }

    function test_factoryOnlyRegistrationAndCanonicalSortedExclusionsPolicyHash() public {
        distributor = _newDistributor();
        meme = new HolderFeeMemeMock(ID, address(distributor));
        meme.mintSupply(address(this), 1);
        hook = new HolderFeeHookMock(POOL_MANAGER, address(vault), meme, quote);
        config.memeToken = address(meme);
        config.graduatedHook = address(hook);
        registry.setMarket(ID, MarketView(config, MarketRuntime(bytes32(0), 1, 1)));
        vm.prank(address(0xCAFE));
        vm.expectRevert(TreasuryDistributorV1.InvalidFeeSharingCaller.selector);
        distributor.registerFeeSharingMarket(ID, address(vault), LOCKER);
        distributor.registerFeeSharingMarket(ID, address(vault), LOCKER);
        address[] memory xs = distributor.feeSharingExcludedAccounts(ID);
        for (uint256 i = 1; i < xs.length; ++i) {
            assertLe(uint160(xs[i - 1]), uint160(xs[i]));
        }
        assertEq(distributor.feeSharingVault(ID), address(vault));
    }

    function test_rootCannotSealEpochWhileHolderLiabilityPending() public {
        distributor = _newDistributor();
        meme = new HolderFeeMemeMock(ID, address(distributor));
        meme.mintSupply(address(this), 1);
        hook = new HolderFeeHookMock(POOL_MANAGER, address(vault), meme, quote);
        config.memeToken = address(meme);
        config.graduatedHook = address(hook);
        registry.setMarket(ID, MarketView(config, MarketRuntime(bytes32(0), 1, 1)));
        distributor.registerFeeSharingMarket(ID, address(vault), LOCKER);
        quote.mint(address(vault), 1);
        vault.seedHolder(ID, 1, address(quote), 1);
        vm.warp(block.timestamp + 31 days);
        vm.expectRevert(TreasuryDistributorV1.HolderFeesAwaitingSettlement.selector);
        distributor.requestRoot{value: 1}(ID, 1);
    }
}
