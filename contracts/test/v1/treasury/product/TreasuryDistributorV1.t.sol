// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import {Test} from "forge-std/Test.sol";

import {
    RootServiceFeeV1,
    TreasuryEpochStatusV1,
    TreasuryEpochV1,
    TreasuryMarketV1
} from "../../../../src/v1/interfaces/IV1Protocol.sol";
import {TreasuryDistributorInitV1, TreasuryDistributorV1} from "../../../../src/v1/modules/TreasuryDistributorV1.sol";
import {TickerMemeTokenV1} from "../../../../src/v1/modules/TickerMemeTokenV1.sol";
import {ImmutableAccessManaged} from "../../../../src/v1/shared/ImmutableAccessManaged.sol";
import {
    MockInvalidMemeTokenV1,
    MockQuoteTokenV1,
    MockTaxQuoteTokenV1,
    MockTreasuryMarketRegistryV1
} from "../mocks/MockV1TreasuryAssets.sol";

contract TreasuryDistributorV1Test is Test {
    uint64 private constant CONFIG_ROLE = 1;
    uint64 private constant ROOT_PUBLISHER_ROLE = 4;
    uint64 private constant ROOT_REVIEW_ROLE = 5;

    bytes32 private constant MARKET_ID = keccak256("V1-TREASURY-MARKET");
    bytes32 private constant ELIGIBILITY_POLICY = keccak256("ALL-HOLDERS-EXCLUSIONS-V1");
    bytes32 private constant DATASET_HASH = keccak256("DATASET");
    bytes32 private constant SOURCE_BLOCK_HASH = keccak256("FINALIZED-SOURCE-BLOCK");

    address private constant CREATOR = address(0xC0FFEE);
    address private constant CURVE = address(0xC0A7E);
    address private constant HOLDER = address(0xB0B);
    address private constant SECOND_HOLDER = address(0xA11CE);
    address private constant FUNDER = address(0xF00D);
    address private constant ROOT_PUBLISHER = address(0xA001);
    address private constant ROOT_GUARDIAN = address(0xA002);
    address private constant ROOT_SERVICE_TREASURY = address(0xFEE);

    uint128 private constant ROOT_FEE = 0.1 ether;
    uint32 private constant FINALITY_DELAY_SECONDS = 1 hours;
    uint16 private constant FINALITY_DELAY_BLOCKS = 2;
    uint32 private constant PUBLICATION_WINDOW = 3 days;
    uint32 private constant REVIEW_DELAY = 2 days;
    uint32 private constant CLAIM_WINDOW = 90 days;
    uint256 private constant INITIAL_SUPPLY = 1_000_000_000 ether;

    AccessManager private manager;
    MockTreasuryMarketRegistryV1 private marketRegistry;
    TreasuryDistributorV1 private distributor;
    TickerMemeTokenV1 private meme;
    MockQuoteTokenV1 private quote;

    function setUp() public {
        vm.warp(1_700_000_000);
        vm.roll(1_000);
        manager = new AccessManager(address(this));
        marketRegistry = new MockTreasuryMarketRegistryV1();
        distributor = new TreasuryDistributorV1(_init(address(0), ROOT_FEE));
        quote = new MockQuoteTokenV1();
        meme = _deployMeme(MARKET_ID);

        _configureRoles();
        marketRegistry.setMarket(MARKET_ID, address(meme), address(quote), 2);
        distributor.registerMarket(MARKET_ID, address(meme), address(quote), ELIGIBILITY_POLICY);
        distributor.activateMarket(MARKET_ID);

        vm.prank(CURVE);
        meme.transfer(HOLDER, 1_000 ether);
        vm.prank(CURVE);
        meme.transfer(SECOND_HOLDER, 1_000 ether);
        quote.mint(FUNDER, 1_000_000 ether);
        vm.deal(HOLDER, 10 ether);
        vm.deal(SECOND_HOLDER, 10 ether);
    }

    function test_sharedMarketRegistrationAndOneWayGraduationActivation() public view {
        TreasuryMarketV1 memory value = distributor.market(MARKET_ID);
        assertEq(value.memeToken, address(meme));
        assertEq(value.quoteToken, address(quote));
        assertEq(value.eligibilityPolicyHash, ELIGIBILITY_POLICY);
        assertEq(value.activatedAt, 1_700_000_000);

        assertEq(distributor.currentEpochId(MARKET_ID), 1);
        (uint64 start, uint64 end) = distributor.epochWindow(MARKET_ID, 1);
        assertEq(start, 1_700_000_000);
        assertEq(end - start, 30 days);
    }

    function test_marketCannotBeActivatedTwiceOrRegisteredWithWrongTokenIdentity() public {
        vm.expectRevert(abi.encodeWithSelector(TreasuryDistributorV1.MarketAlreadyActive.selector, MARKET_ID));
        distributor.activateMarket(MARKET_ID);

        bytes32 otherMarket = keccak256("OTHER");
        MockInvalidMemeTokenV1 invalid = new MockInvalidMemeTokenV1();
        marketRegistry.setMarket(otherMarket, address(invalid), address(quote), 2);
        vm.expectRevert(abi.encodeWithSelector(TreasuryDistributorV1.InvalidMemeToken.selector, address(invalid)));
        distributor.registerMarket(otherMarket, address(invalid), address(quote), ELIGIBILITY_POLICY);
    }

    function test_registrationAndActivationAreBoundToCanonicalGraduatedMarket() public {
        bytes32 marketId = keccak256("CANONICAL-MARKET");
        TickerMemeTokenV1 marketMeme = _deployMeme(marketId);
        marketRegistry.setMarket(marketId, address(marketMeme), address(0), 0);

        vm.expectRevert(abi.encodeWithSelector(TreasuryDistributorV1.InvalidCanonicalMarket.selector, marketId));
        distributor.registerMarket(marketId, address(marketMeme), address(quote), ELIGIBILITY_POLICY);

        distributor.registerMarket(marketId, address(marketMeme), address(0), ELIGIBILITY_POLICY);
        vm.expectRevert(
            abi.encodeWithSelector(TreasuryDistributorV1.InvalidCanonicalLaunchPhase.selector, marketId, uint8(0))
        );
        distributor.activateMarket(marketId);

        marketRegistry.setLaunchPhase(marketId, 2);
        distributor.activateMarket(marketId);
        assertEq(distributor.market(marketId).activatedAt, block.timestamp);
    }

    function test_activationRemainsPermissionlessAndHasNoAccessManagerRoleAssignment() public {
        bytes32 marketId = keccak256("PUBLIC-ACTIVATION-MARKET");
        TickerMemeTokenV1 marketMeme = _deployMeme(marketId);
        marketRegistry.setMarket(marketId, address(marketMeme), address(0), 2);
        distributor.registerMarket(marketId, address(marketMeme), address(0), ELIGIBILITY_POLICY);

        assertEq(
            manager.getTargetFunctionRole(address(distributor), TreasuryDistributorV1.activateMarket.selector),
            manager.ADMIN_ROLE()
        );
        address keeper = address(0xBEEF);
        vm.prank(keeper);
        distributor.activateMarket(marketId);
        assertEq(distributor.market(marketId).activatedAt, block.timestamp);
    }

    function test_configAndRootRolesAreSelectorScoped() public {
        address outsider = address(0xBAD);
        vm.prank(outsider);
        vm.expectRevert(
            abi.encodeWithSelector(
                ImmutableAccessManaged.AccessManagedUnauthorized.selector,
                outsider,
                TreasuryDistributorV1.setRootServiceFee.selector
            )
        );
        distributor.setRootServiceFee(address(0), 1 ether);

        _fund(1_000 ether, keccak256("AUTH-FUND"));
        _closeEpoch(1);
        _requestNative(HOLDER, 1);
        bytes32 leaf = distributor.claimLeaf(MARKET_ID, 1, 0, HOLDER, 1, 1_000 ether);

        vm.prank(outsider);
        vm.expectRevert(
            abi.encodeWithSelector(
                ImmutableAccessManaged.AccessManagedUnauthorized.selector,
                outsider,
                TreasuryDistributorV1.publishRoot.selector
            )
        );
        distributor.publishRoot(MARKET_ID, 1, leaf, DATASET_HASH, 1, 1, 1_000 ether);
    }

    function test_quoteFundingIsEpochIsolatedAndIdempotent() public {
        bytes32 fundingId = keccak256("EPOCH-ONE-FUNDING");
        _fund(400 ether, fundingId);
        assertEq(distributor.epochQuoteAmount(MARKET_ID, 1), 400 ether);
        assertEq(distributor.totalQuoteLiability(address(quote)), 400 ether);
        assertEq(quote.balanceOf(address(distributor)), 400 ether);

        vm.prank(FUNDER);
        vm.expectRevert(
            abi.encodeWithSelector(TreasuryDistributorV1.OperationAlreadyConsumed.selector, FUNDER, fundingId)
        );
        distributor.fundQuoteTreasury(MARKET_ID, 1 ether, fundingId);

        (, uint64 end) = distributor.epochWindow(MARKET_ID, 1);
        vm.warp(end);
        _fund(600 ether, keccak256("EPOCH-TWO-FUNDING"));
        assertEq(distributor.epochQuoteAmount(MARKET_ID, 1), 400 ether);
        assertEq(distributor.epochQuoteAmount(MARKET_ID, 2), 600 ether);
        assertEq(distributor.totalQuoteLiability(address(quote)), 1_000 ether);
    }

    function test_nativeQuoteTreasuryFundsAndClaimsWithExactValue() public {
        bytes32 marketId = keccak256("NATIVE-QUOTE-MARKET");
        TickerMemeTokenV1 marketMeme = _deployMeme(marketId);
        marketRegistry.setMarket(marketId, address(marketMeme), address(0), 2);
        distributor.registerMarket(marketId, address(marketMeme), address(0), ELIGIBILITY_POLICY);
        distributor.activateMarket(marketId);
        vm.prank(CURVE);
        marketMeme.transfer(HOLDER, 1 ether);

        uint256 quoteAmount = 2 ether;
        vm.deal(FUNDER, quoteAmount);
        vm.prank(FUNDER);
        vm.expectRevert(
            abi.encodeWithSelector(TreasuryDistributorV1.IncorrectNativeFunding.selector, quoteAmount - 1, quoteAmount)
        );
        distributor.fundQuoteTreasury{value: quoteAmount - 1}(marketId, quoteAmount, keccak256("WRONG-NATIVE"));

        vm.deal(FUNDER, quoteAmount);
        vm.prank(FUNDER);
        distributor.fundQuoteTreasury{value: quoteAmount}(marketId, quoteAmount, keccak256("NATIVE-FUND"));
        assertEq(distributor.totalQuoteLiability(address(0)), quoteAmount);

        (, uint64 end) = distributor.epochWindow(marketId, 1);
        vm.warp(uint256(end) + FINALITY_DELAY_SECONDS);
        vm.roll(block.number + 100);
        vm.setBlockhash(block.number - FINALITY_DELAY_BLOCKS, SOURCE_BLOCK_HASH);
        vm.prank(HOLDER);
        distributor.requestRoot{value: ROOT_FEE}(marketId, 1);
        bytes32 leaf = distributor.claimLeaf(marketId, 1, 0, HOLDER, 1, quoteAmount);
        vm.prank(ROOT_PUBLISHER);
        distributor.publishRoot(marketId, 1, leaf, DATASET_HASH, 1, 1, quoteAmount);
        TreasuryEpochV1 memory pending = distributor.epoch(marketId, 1);
        vm.warp(pending.finalizeAfter);
        distributor.finalizeRoot(marketId, 1);

        uint256 holderBefore = HOLDER.balance;
        distributor.claim(marketId, 1, 0, HOLDER, 1, quoteAmount, new bytes32[](0));
        assertEq(HOLDER.balance, holderBefore + quoteAmount);
        assertEq(distributor.totalQuoteLiability(address(0)), 0);
        assertEq(address(distributor).balance, ROOT_FEE);
    }

    function test_feeOnTransferQuoteCannotCreateUnderfundedLiability() public {
        bytes32 marketId = keccak256("TAX-MARKET");
        MockTaxQuoteTokenV1 taxed = new MockTaxQuoteTokenV1(address(0xCA11));
        TickerMemeTokenV1 marketMeme = _deployMeme(marketId);
        marketRegistry.setMarket(marketId, address(marketMeme), address(taxed), 2);
        distributor.registerMarket(marketId, address(marketMeme), address(taxed), ELIGIBILITY_POLICY);
        distributor.activateMarket(marketId);
        taxed.mint(FUNDER, 1_000 ether);

        vm.startPrank(FUNDER);
        taxed.approve(address(distributor), type(uint256).max);
        vm.expectRevert(
            abi.encodeWithSelector(
                TreasuryDistributorV1.NonExactTokenTransfer.selector, address(taxed), 100 ether, 99 ether
            )
        );
        distributor.fundQuoteTreasury(marketId, 100 ether, keccak256("TAXED"));
        vm.stopPrank();

        assertEq(taxed.balanceOf(address(distributor)), 0);
        assertEq(distributor.totalQuoteLiability(address(taxed)), 0);
    }

    function test_memeBurnIsRealSupplyBurnAndIdempotent() public {
        uint256 supplyBefore = meme.totalSupply();
        uint256 treasuryBefore = meme.balanceOf(address(distributor));
        bytes32 burnId = keccak256("BURN-ONE");

        vm.startPrank(HOLDER);
        meme.approve(address(distributor), 100 ether);
        distributor.burnMeme(MARKET_ID, 100 ether, burnId);
        vm.expectRevert(abi.encodeWithSelector(TreasuryDistributorV1.OperationAlreadyConsumed.selector, HOLDER, burnId));
        distributor.burnMeme(MARKET_ID, 1 ether, burnId);
        vm.stopPrank();

        assertEq(meme.totalSupply(), supplyBefore - 100 ether);
        assertEq(meme.balanceOf(address(distributor)), treasuryBefore);
        assertEq(meme.balanceOf(HOLDER), 900 ether);
    }

    function test_onlyCurrentHolderCanPayToRequestClosedEpochRoot() public {
        _fund(1_000 ether, keccak256("ROOT-FUND"));
        _closeEpoch(1);

        address nonHolder = address(0x1234);
        vm.deal(nonHolder, 1 ether);
        vm.prank(nonHolder);
        vm.expectRevert(abi.encodeWithSelector(TreasuryDistributorV1.RequesterIsNotHolder.selector, nonHolder));
        distributor.requestRoot{value: ROOT_FEE}(MARKET_ID, 1);

        vm.prank(HOLDER);
        vm.expectRevert(
            abi.encodeWithSelector(TreasuryDistributorV1.IncorrectNativeServiceFee.selector, ROOT_FEE - 1, ROOT_FEE)
        );
        distributor.requestRoot{value: ROOT_FEE - 1}(MARKET_ID, 1);

        _requestNative(HOLDER, 1);
        TreasuryEpochV1 memory valueEpoch = distributor.epoch(MARKET_ID, 1);
        assertEq(uint8(valueEpoch.status), uint8(TreasuryEpochStatusV1.REQUESTED));
        assertEq(valueEpoch.requester, HOLDER);
        assertEq(valueEpoch.quoteAmount, 1_000 ether);
        assertEq(valueEpoch.sourceBlockHash, SOURCE_BLOCK_HASH);
        assertEq(distributor.totalServiceLiability(address(0)), ROOT_FEE);
    }

    function test_platformRootUsesReviewDelayThenPermissionlessFinalizationAndClaim() public {
        uint256 quoteAmount = 1_000 ether;
        _fund(quoteAmount, keccak256("SINGLE-ROOT"));
        _closeEpoch(1);
        _requestNative(HOLDER, 1);

        uint256 twab = 30_000 ether * 1 days;
        bytes32 leaf = distributor.claimLeaf(MARKET_ID, 1, 0, HOLDER, twab, quoteAmount);
        _publish(1, leaf, twab, 1, quoteAmount);

        vm.expectRevert();
        distributor.finalizeRoot(MARKET_ID, 1);
        TreasuryEpochV1 memory pending = distributor.epoch(MARKET_ID, 1);
        vm.warp(pending.finalizeAfter);
        distributor.finalizeRoot(MARKET_ID, 1);

        assertEq(distributor.serviceCredit(address(0), ROOT_SERVICE_TREASURY), ROOT_FEE);
        assertEq(distributor.totalServiceLiability(address(0)), ROOT_FEE);
        uint256 holderBefore = quote.balanceOf(HOLDER);
        bytes32[] memory proof = new bytes32[](0);
        distributor.claim(MARKET_ID, 1, 0, HOLDER, twab, quoteAmount, proof);

        assertEq(quote.balanceOf(HOLDER) - holderBefore, quoteAmount);
        assertEq(distributor.totalQuoteLiability(address(quote)), 0);
        assertTrue(distributor.isClaimed(MARKET_ID, 1, 0));
        assertTrue(distributor.accountClaimed(MARKET_ID, 1, HOLDER));
    }

    function test_twoLeafClaimsUseBitmapAndFixedRecipients() public {
        uint256 quoteAmount = 1_000 ether;
        _fund(quoteAmount, keccak256("TWO-LEAF"));
        _closeEpoch(1);
        _requestNative(HOLDER, 1);

        bytes32 aliceLeaf = distributor.claimLeaf(MARKET_ID, 1, 0, HOLDER, 3, 750 ether);
        bytes32 bobLeaf = distributor.claimLeaf(MARKET_ID, 1, 1, SECOND_HOLDER, 1, 250 ether);
        bytes32 root = _hashPair(aliceLeaf, bobLeaf);
        _publish(1, root, 4, 2, quoteAmount);
        _finalize(1);

        bytes32[] memory aliceProof = new bytes32[](1);
        aliceProof[0] = bobLeaf;
        vm.prank(address(0xCA11));
        distributor.claim(MARKET_ID, 1, 0, HOLDER, 3, 750 ether, aliceProof);
        assertEq(quote.balanceOf(HOLDER), 750 ether);

        vm.expectRevert(abi.encodeWithSelector(TreasuryDistributorV1.ClaimAlreadyConsumed.selector, 0));
        distributor.claim(MARKET_ID, 1, 0, HOLDER, 3, 750 ether, aliceProof);

        bytes32[] memory bobProof = new bytes32[](1);
        bobProof[0] = aliceLeaf;
        distributor.claim(MARKET_ID, 1, 1, SECOND_HOLDER, 1, 250 ether, bobProof);
        assertEq(quote.balanceOf(SECOND_HOLDER), 250 ether);
        assertEq(quote.balanceOf(address(distributor)), 0);
    }

    function test_leafIsBoundToMarketWindowSourceAndAccount() public {
        _fund(100 ether, keccak256("BOUND-LEAF"));
        _closeEpoch(1);
        _requestNative(HOLDER, 1);

        bytes32 canonical = distributor.claimLeaf(MARKET_ID, 1, 0, HOLDER, 99, 100 ether);
        bytes32 otherAccount = distributor.claimLeaf(MARKET_ID, 1, 0, SECOND_HOLDER, 99, 100 ether);
        bytes32 otherIndex = distributor.claimLeaf(MARKET_ID, 1, 1, HOLDER, 99, 100 ether);
        assertNotEq(canonical, otherAccount);
        assertNotEq(canonical, otherIndex);
    }

    function test_wrongProofAndDuplicateAccountCannotConsumeFunds() public {
        _fund(100 ether, keccak256("BAD-PROOF"));
        _closeEpoch(1);
        _requestNative(HOLDER, 1);
        bytes32 leaf = distributor.claimLeaf(MARKET_ID, 1, 0, HOLDER, 1, 100 ether);
        _publish(1, leaf, 1, 1, 100 ether);
        _finalize(1);

        bytes32[] memory badProof = new bytes32[](1);
        badProof[0] = keccak256("BAD");
        vm.expectRevert(TreasuryDistributorV1.InvalidMerkleProof.selector);
        distributor.claim(MARKET_ID, 1, 0, HOLDER, 1, 100 ether, badProof);
        assertFalse(distributor.isClaimed(MARKET_ID, 1, 0));
        assertEq(distributor.totalQuoteLiability(address(quote)), 100 ether);
    }

    function test_duplicateAccountLeafIsRejectedEvenWithDifferentValidIndex() public {
        _fund(100 ether, keccak256("DUPLICATE-ACCOUNT"));
        _closeEpoch(1);
        _requestNative(HOLDER, 1);
        bytes32 firstLeaf = distributor.claimLeaf(MARKET_ID, 1, 0, HOLDER, 1, 40 ether);
        bytes32 secondLeaf = distributor.claimLeaf(MARKET_ID, 1, 1, HOLDER, 2, 60 ether);
        _publish(1, _hashPair(firstLeaf, secondLeaf), 3, 2, 100 ether);
        _finalize(1);

        bytes32[] memory firstProof = new bytes32[](1);
        firstProof[0] = secondLeaf;
        distributor.claim(MARKET_ID, 1, 0, HOLDER, 1, 40 ether, firstProof);

        bytes32[] memory secondProof = new bytes32[](1);
        secondProof[0] = firstLeaf;
        vm.expectRevert(abi.encodeWithSelector(TreasuryDistributorV1.AccountAlreadyClaimed.selector, HOLDER));
        distributor.claim(MARKET_ID, 1, 1, HOLDER, 2, 60 ether, secondProof);
        assertFalse(distributor.isClaimed(MARKET_ID, 1, 1));
        assertEq(distributor.totalQuoteLiability(address(quote)), 60 ether);
    }

    function test_nonExactOutgoingQuoteRevertsClaimAndRestoresAllAccounting() public {
        bytes32 marketId = keccak256("MUTABLE-TAX-MARKET");
        MockTaxQuoteTokenV1 taxed = new MockTaxQuoteTokenV1(address(0xCA11));
        TickerMemeTokenV1 marketMeme = _deployMeme(marketId);
        marketRegistry.setMarket(marketId, address(marketMeme), address(taxed), 2);
        distributor.registerMarket(marketId, address(marketMeme), address(taxed), ELIGIBILITY_POLICY);
        distributor.activateMarket(marketId);
        vm.prank(CURVE);
        marketMeme.transfer(HOLDER, 10 ether);

        taxed.setTaxEnabled(false);
        taxed.mint(FUNDER, 100 ether);
        vm.startPrank(FUNDER);
        taxed.approve(address(distributor), 100 ether);
        distributor.fundQuoteTreasury(marketId, 100 ether, keccak256("EXACT-IN"));
        vm.stopPrank();

        (, uint64 end) = distributor.epochWindow(marketId, 1);
        vm.warp(uint256(end) + FINALITY_DELAY_SECONDS);
        vm.roll(block.number + 100);
        vm.setBlockhash(block.number - FINALITY_DELAY_BLOCKS, SOURCE_BLOCK_HASH);
        vm.prank(HOLDER);
        distributor.requestRoot{value: ROOT_FEE}(marketId, 1);
        bytes32 leaf = distributor.claimLeaf(marketId, 1, 0, HOLDER, 1, 100 ether);
        vm.prank(ROOT_PUBLISHER);
        distributor.publishRoot(marketId, 1, leaf, DATASET_HASH, 1, 1, 100 ether);
        TreasuryEpochV1 memory pending = distributor.epoch(marketId, 1);
        vm.warp(pending.finalizeAfter);
        distributor.finalizeRoot(marketId, 1);

        taxed.setTaxEnabled(true);
        bytes32[] memory proof = new bytes32[](0);
        vm.expectRevert(
            abi.encodeWithSelector(
                TreasuryDistributorV1.NonExactTokenTransfer.selector, address(taxed), 100 ether, 99 ether
            )
        );
        distributor.claim(marketId, 1, 0, HOLDER, 1, 100 ether, proof);
        assertFalse(distributor.isClaimed(marketId, 1, 0));
        assertFalse(distributor.accountClaimed(marketId, 1, HOLDER));
        assertEq(distributor.epoch(marketId, 1).claimedAmount, 0);
        assertEq(distributor.totalQuoteLiability(address(taxed)), 100 ether);
        assertEq(taxed.balanceOf(address(distributor)), 100 ether);
    }

    function test_guardianCancellationRefundsRequesterAndReopensEpoch() public {
        _fund(100 ether, keccak256("CANCEL"));
        _closeEpoch(1);
        _requestNative(HOLDER, 1);
        bytes32 leaf = distributor.claimLeaf(MARKET_ID, 1, 0, HOLDER, 1, 100 ether);
        _publish(1, leaf, 1, 1, 100 ether);

        vm.prank(ROOT_GUARDIAN);
        distributor.cancelPendingRoot(MARKET_ID, 1, keccak256("INVALID-DATASET"));
        TreasuryEpochV1 memory reset = distributor.epoch(MARKET_ID, 1);
        assertEq(uint8(reset.status), uint8(TreasuryEpochStatusV1.UNREQUESTED));
        assertEq(distributor.serviceCredit(address(0), HOLDER), ROOT_FEE);

        uint256 holderBefore = HOLDER.balance;
        vm.prank(HOLDER);
        distributor.withdrawServiceCredit(address(0));
        assertEq(HOLDER.balance - holderBefore, ROOT_FEE);
        assertEq(distributor.totalServiceLiability(address(0)), 0);
    }

    function test_unpublishedRequestExpiresAndRefundDoesNotMoveQuote() public {
        _fund(100 ether, keccak256("TIMEOUT"));
        _closeEpoch(1);
        _requestNative(HOLDER, 1);
        TreasuryEpochV1 memory requested = distributor.epoch(MARKET_ID, 1);
        vm.warp(requested.publishBy + 1);
        distributor.expireRootRequest(MARKET_ID, 1);

        assertEq(distributor.serviceCredit(address(0), HOLDER), ROOT_FEE);
        assertEq(distributor.epochQuoteAmount(MARKET_ID, 1), 100 ether);
        assertEq(distributor.totalQuoteLiability(address(quote)), 100 ether);
    }

    function test_erc20RootFeeIsEscrowedAndPaidOnlyAfterFinalization() public {
        distributor.setRootServiceFee(address(quote), 5 ether);
        quote.mint(HOLDER, 5 ether);
        vm.prank(HOLDER);
        quote.approve(address(distributor), 5 ether);
        _fund(100 ether, keccak256("TOKEN-FEE"));
        _closeEpoch(1);

        vm.prank(HOLDER);
        distributor.requestRoot(MARKET_ID, 1);
        assertEq(distributor.totalServiceLiability(address(quote)), 5 ether);
        assertEq(distributor.serviceCredit(address(quote), ROOT_SERVICE_TREASURY), 0);

        bytes32 leaf = distributor.claimLeaf(MARKET_ID, 1, 0, HOLDER, 1, 100 ether);
        _publish(1, leaf, 1, 1, 100 ether);
        _finalize(1);
        assertEq(distributor.serviceCredit(address(quote), ROOT_SERVICE_TREASURY), 5 ether);

        vm.prank(ROOT_SERVICE_TREASURY);
        distributor.withdrawServiceCredit(address(quote));
        assertEq(quote.balanceOf(ROOT_SERVICE_TREASURY), 5 ether);
        assertEq(distributor.totalServiceLiability(address(quote)), 0);
        assertEq(distributor.totalQuoteLiability(address(quote)), 100 ether);
    }

    function test_unclaimedRemainderRollsIntoCurrentEpochWithoutReducingLiability() public {
        _fund(1_000 ether, keccak256("ROLLOVER"));
        _closeEpoch(1);
        _requestNative(HOLDER, 1);
        bytes32 aliceLeaf = distributor.claimLeaf(MARKET_ID, 1, 0, HOLDER, 2, 400 ether);
        bytes32 bobLeaf = distributor.claimLeaf(MARKET_ID, 1, 1, SECOND_HOLDER, 3, 600 ether);
        _publish(1, _hashPair(aliceLeaf, bobLeaf), 5, 2, 1_000 ether);
        _finalize(1);

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = bobLeaf;
        distributor.claim(MARKET_ID, 1, 0, HOLDER, 2, 400 ether, proof);
        TreasuryEpochV1 memory valueEpoch = distributor.epoch(MARKET_ID, 1);
        vm.warp(valueEpoch.claimUntil + 1);

        (uint32 toEpochId, uint256 amount) = distributor.rolloverExpiredEpoch(MARKET_ID, 1);
        assertGt(toEpochId, 1);
        assertEq(amount, 600 ether);
        assertEq(distributor.epochQuoteAmount(MARKET_ID, 1), 0);
        assertEq(distributor.epochQuoteAmount(MARKET_ID, toEpochId), 600 ether);
        assertEq(distributor.totalQuoteLiability(address(quote)), 600 ether);
        assertEq(uint8(distributor.epoch(MARKET_ID, 1).status), uint8(TreasuryEpochStatusV1.ROLLED_OVER));
    }

    function test_serviceFeeUpdatesAffectOnlyFutureRequests() public {
        RootServiceFeeV1 memory beforeFee = distributor.rootServiceFee();
        assertEq(beforeFee.asset, address(0));
        assertEq(beforeFee.amount, ROOT_FEE);

        distributor.setRootServiceFee(address(quote), 7 ether);
        RootServiceFeeV1 memory afterFee = distributor.rootServiceFee();
        assertEq(afterFee.asset, address(quote));
        assertEq(afterFee.amount, 7 ether);
    }

    function _configureRoles() private {
        bytes4[] memory configSelectors = new bytes4[](2);
        configSelectors[0] = TreasuryDistributorV1.registerMarket.selector;
        configSelectors[1] = TreasuryDistributorV1.setRootServiceFee.selector;
        manager.setTargetFunctionRole(address(distributor), configSelectors, CONFIG_ROLE);

        bytes4[] memory publisherSelectors = new bytes4[](1);
        publisherSelectors[0] = TreasuryDistributorV1.publishRoot.selector;
        manager.setTargetFunctionRole(address(distributor), publisherSelectors, ROOT_PUBLISHER_ROLE);

        bytes4[] memory reviewSelectors = new bytes4[](1);
        reviewSelectors[0] = TreasuryDistributorV1.cancelPendingRoot.selector;
        manager.setTargetFunctionRole(address(distributor), reviewSelectors, ROOT_REVIEW_ROLE);

        manager.grantRole(CONFIG_ROLE, address(this), 0);
        manager.grantRole(ROOT_PUBLISHER_ROLE, ROOT_PUBLISHER, 0);
        manager.grantRole(ROOT_REVIEW_ROLE, ROOT_GUARDIAN, 0);
    }

    function _init(address feeAsset, uint128 feeAmount) private view returns (TreasuryDistributorInitV1 memory) {
        return TreasuryDistributorInitV1({
            authority: address(manager),
            marketRegistry: address(marketRegistry),
            rootServiceTreasury: ROOT_SERVICE_TREASURY,
            rootServiceFeeAsset: feeAsset,
            rootServiceFeeAmount: feeAmount,
            finalityDelaySeconds: FINALITY_DELAY_SECONDS,
            finalityDelayBlocks: FINALITY_DELAY_BLOCKS,
            rootPublicationWindow: PUBLICATION_WINDOW,
            rootReviewDelay: REVIEW_DELAY,
            claimWindow: CLAIM_WINDOW
        });
    }

    function _deployMeme(bytes32 marketId) private returns (TickerMemeTokenV1) {
        return new TickerMemeTokenV1(
            marketId, CREATOR, CURVE, address(distributor), "Ticker Garden V1", "TGV1", "ipfs://v1", INITIAL_SUPPLY
        );
    }

    function _fund(uint256 amount, bytes32 fundingId) private {
        vm.startPrank(FUNDER);
        quote.approve(address(distributor), amount);
        distributor.fundQuoteTreasury(MARKET_ID, amount, fundingId);
        vm.stopPrank();
    }

    function _closeEpoch(uint32 epochId) private {
        (, uint64 end) = distributor.epochWindow(MARKET_ID, epochId);
        vm.warp(uint256(end) + FINALITY_DELAY_SECONDS);
        vm.roll(block.number + 100);
        vm.setBlockhash(block.number - FINALITY_DELAY_BLOCKS, SOURCE_BLOCK_HASH);
    }

    function _requestNative(address holder, uint32 epochId) private {
        vm.prank(holder);
        distributor.requestRoot{value: ROOT_FEE}(MARKET_ID, epochId);
    }

    function _publish(uint32 epochId, bytes32 root, uint256 totalTwab, uint32 leafCount, uint256 amount) private {
        vm.prank(ROOT_PUBLISHER);
        distributor.publishRoot(MARKET_ID, epochId, root, DATASET_HASH, totalTwab, leafCount, amount);
    }

    function _finalize(uint32 epochId) private {
        TreasuryEpochV1 memory valueEpoch = distributor.epoch(MARKET_ID, epochId);
        vm.warp(valueEpoch.finalizeAfter);
        distributor.finalizeRoot(MARKET_ID, epochId);
    }

    function _hashPair(bytes32 left, bytes32 right) private pure returns (bytes32) {
        return
            uint256(left) < uint256(right) ? keccak256(bytes.concat(left, right)) : keccak256(bytes.concat(right, left));
    }
}
