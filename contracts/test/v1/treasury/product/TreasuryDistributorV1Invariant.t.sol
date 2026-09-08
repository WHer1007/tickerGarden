// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import {Test} from "forge-std/Test.sol";

import {TreasuryEpochStatusV1, TreasuryEpochV1, TreasuryMarketV1} from "../../../../src/v1/interfaces/IV1Protocol.sol";
import {TreasuryDistributorInitV1, TreasuryDistributorV1} from "../../../../src/v1/modules/TreasuryDistributorV1.sol";
import {TickerMemeTokenV1} from "../../../../src/v1/modules/TickerMemeTokenV1.sol";
import {MockQuoteTokenV1, MockTreasuryMarketRegistryV1} from "../mocks/MockV1TreasuryAssets.sol";

contract TreasuryDistributorV1InvariantHandler is Test {
    uint32 internal constant EPOCH_DURATION = 7 days;
    uint32 internal constant FINALITY_DELAY_SECONDS = 1 hours;
    uint16 internal constant FINALITY_DELAY_BLOCKS = 2;
    uint32 internal constant PUBLICATION_WINDOW = 3 days;
    uint32 internal constant REVIEW_DELAY = 2 days;
    uint32 internal constant CLAIM_WINDOW = 90 days;
    uint128 internal constant SERVICE_FEE = 1 ether;
    uint256 internal constant MAX_FUNDING = 100_000 ether;
    uint256 internal constant MAX_ELAPSED = 7 days;

    bytes32 internal constant MARKET_ID = keccak256("V1-TREASURY-INVARIANT-MARKET");
    bytes32 internal constant ELIGIBILITY_POLICY = keccak256("ALL-HOLDERS");
    bytes32 internal constant DATASET_HASH = keccak256("INVARIANT-DATASET");
    bytes32 internal constant SOURCE_BLOCK_HASH = keccak256("INVARIANT-SOURCE-BLOCK");

    address internal constant HOLDER_A = address(0xA11CE);
    address internal constant HOLDER_B = address(0xB0B);
    address internal constant FUNDER = address(0xF00D);
    address internal constant ROOT_SERVICE_TREASURY = address(0xFEE);

    TreasuryDistributorV1 public immutable distributor;
    TickerMemeTokenV1 public immutable meme;
    MockQuoteTokenV1 public immutable quote;

    uint256 public totalFunded;
    uint256 public totalClaimed;
    uint256 public totalServiceFeesCollected;
    uint256 public totalServiceFeesWithdrawn;
    uint256 public totalBurned;

    uint256 private _fundingNonce;
    uint256 private _burnNonce;
    uint32[] private _fundedEpochs;
    mapping(uint32 epochId => bool known) private _knownEpoch;

    constructor(TreasuryDistributorV1 distributor_, TickerMemeTokenV1 meme_, MockQuoteTokenV1 quote_) {
        distributor = distributor_;
        meme = meme_;
        quote = quote_;
    }

    function fundedEpochCount() external view returns (uint256) {
        return _fundedEpochs.length;
    }

    function fundedEpochAt(uint256 index) external view returns (uint32) {
        return _fundedEpochs[index];
    }

    function fund(uint96 rawAmount) external {
        uint256 amount = bound(uint256(rawAmount), 1, MAX_FUNDING);
        quote.mint(FUNDER, amount);

        bytes32 fundingId = bytes32(++_fundingNonce);
        vm.startPrank(FUNDER);
        quote.approve(address(distributor), amount);
        uint32 epochId = distributor.fundQuoteTreasury(MARKET_ID, amount, fundingId);
        vm.stopPrank();

        totalFunded += amount;
        _trackEpoch(epochId);
    }

    function rollover(uint8 rawEpoch) external {
        (bool found, uint32 epochId) = _epochWithStatus(rawEpoch, TreasuryEpochStatusV1.CLAIMING);
        if (!found) return;
        TreasuryEpochV1 memory valueEpoch = distributor.epoch(MARKET_ID, epochId);
        if (block.timestamp <= valueEpoch.claimUntil) return;

        (uint32 toEpochId,) = distributor.rolloverExpiredEpoch(MARKET_ID, epochId);
        _trackEpoch(toEpochId);
    }

    function _trackEpoch(uint32 epochId) private {
        if (!_knownEpoch[epochId]) {
            _knownEpoch[epochId] = true;
            _fundedEpochs.push(epochId);
        }
    }

    function burn(uint8 rawHolder, uint96 rawAmount) external {
        address holder = _holder(rawHolder);
        uint256 balance = meme.balanceOf(holder);
        if (balance == 0) return;

        uint256 amount = bound(uint256(rawAmount), 1, balance);
        bytes32 burnId = bytes32(++_burnNonce);
        vm.startPrank(holder);
        meme.approve(address(distributor), amount);
        distributor.burnMeme(MARKET_ID, amount, burnId);
        vm.stopPrank();

        totalBurned += amount;
    }

    function elapse(uint32 rawSeconds) external {
        uint256 elapsed = bound(uint256(rawSeconds), 1, MAX_ELAPSED);
        vm.warp(block.timestamp + elapsed);
        vm.roll(block.number + 1);
    }

    function requestRoot(uint8 rawEpoch, uint8 rawHolder) external {
        if (_fundedEpochs.length == 0) return;
        uint32 epochId = _fundedEpochs[uint256(rawEpoch) % _fundedEpochs.length];
        TreasuryEpochV1 memory valueEpoch = distributor.epoch(MARKET_ID, epochId);
        if (
            valueEpoch.status != TreasuryEpochStatusV1.UNREQUESTED
                || distributor.epochQuoteAmount(MARKET_ID, epochId) == 0
        ) return;

        (, uint64 windowEnd) = distributor.epochWindow(MARKET_ID, epochId);
        if (block.timestamp < uint256(windowEnd) + FINALITY_DELAY_SECONDS) return;

        address holder = _holder(rawHolder);
        if (meme.balanceOf(holder) == 0) return;

        // Keep the source block available even after arbitrary time advances.
        vm.roll(block.number + FINALITY_DELAY_BLOCKS + 1);
        vm.setBlockhash(block.number - FINALITY_DELAY_BLOCKS, SOURCE_BLOCK_HASH);
        quote.mint(holder, SERVICE_FEE);
        vm.startPrank(holder);
        quote.approve(address(distributor), SERVICE_FEE);
        distributor.requestRoot(MARKET_ID, epochId);
        vm.stopPrank();

        totalServiceFeesCollected += SERVICE_FEE;
    }

    function publishRoot(uint8 rawEpoch) external {
        (bool found, uint32 epochId) = _epochWithStatus(rawEpoch, TreasuryEpochStatusV1.REQUESTED);
        if (!found) return;
        TreasuryEpochV1 memory valueEpoch = distributor.epoch(MARKET_ID, epochId);
        if (block.timestamp > valueEpoch.publishBy) return;

        bytes32 leaf = distributor.claimLeaf(MARKET_ID, epochId, 0, HOLDER_A, 1, valueEpoch.quoteAmount);
        distributor.publishRoot(MARKET_ID, epochId, leaf, DATASET_HASH, 1, 1, valueEpoch.quoteAmount);
    }

    function finalizeRoot(uint8 rawEpoch) external {
        (bool found, uint32 epochId) = _epochWithStatus(rawEpoch, TreasuryEpochStatusV1.ROOT_PENDING);
        if (!found) return;
        TreasuryEpochV1 memory valueEpoch = distributor.epoch(MARKET_ID, epochId);
        if (block.timestamp < valueEpoch.finalizeAfter) return;
        distributor.finalizeRoot(MARKET_ID, epochId);
    }

    function claim(uint8 rawEpoch) external {
        (bool found, uint32 epochId) = _epochWithStatus(rawEpoch, TreasuryEpochStatusV1.CLAIMING);
        if (!found) return;
        TreasuryEpochV1 memory valueEpoch = distributor.epoch(MARKET_ID, epochId);
        if (block.timestamp > valueEpoch.claimUntil || valueEpoch.claimedAmount >= valueEpoch.quoteAmount) return;
        if (distributor.accountClaimed(MARKET_ID, epochId, HOLDER_A)) return;

        uint256 amount = valueEpoch.quoteAmount - valueEpoch.claimedAmount;
        bytes32[] memory proof = new bytes32[](0);
        distributor.claim(MARKET_ID, epochId, 0, HOLDER_A, 1, amount, proof);
        totalClaimed += amount;
    }

    function expireRoot(uint8 rawEpoch) external {
        (bool found, uint32 epochId) = _epochWithStatus(rawEpoch, TreasuryEpochStatusV1.REQUESTED);
        if (!found) return;
        TreasuryEpochV1 memory valueEpoch = distributor.epoch(MARKET_ID, epochId);
        if (block.timestamp <= valueEpoch.publishBy) return;
        distributor.expireRootRequest(MARKET_ID, epochId);
    }

    function cancelRoot(uint8 rawEpoch) external {
        (bool found, uint32 epochId) = _epochWithStatus(rawEpoch, TreasuryEpochStatusV1.ROOT_PENDING);
        if (!found) return;
        distributor.cancelPendingRoot(MARKET_ID, epochId, keccak256("INVARIANT-CANCEL"));
    }

    function withdrawService(uint8 rawBeneficiary) external {
        address beneficiary = rawBeneficiary % 2 == 0 ? ROOT_SERVICE_TREASURY : HOLDER_A;
        uint256 amount = distributor.serviceCredit(address(quote), beneficiary);
        if (amount == 0) return;

        vm.prank(beneficiary);
        distributor.withdrawServiceCredit(address(quote));
        totalServiceFeesWithdrawn += amount;
    }

    function _epochWithStatus(uint8 rawEpoch, TreasuryEpochStatusV1 status)
        private
        view
        returns (bool found, uint32 epochId)
    {
        if (_fundedEpochs.length == 0) return (false, 0);
        uint256 start = uint256(rawEpoch) % _fundedEpochs.length;
        for (uint256 i; i < _fundedEpochs.length; ++i) {
            uint32 candidate = _fundedEpochs[(start + i) % _fundedEpochs.length];
            if (distributor.epoch(MARKET_ID, candidate).status == status) return (true, candidate);
        }
        return (false, 0);
    }

    function _holder(uint8 rawHolder) private pure returns (address) {
        return rawHolder % 2 == 0 ? HOLDER_A : HOLDER_B;
    }
}

contract TreasuryDistributorV1InvariantTest is Test {
    uint64 private constant CONFIG_ROLE = 1;
    uint64 private constant ROOT_PUBLISHER_ROLE = 4;
    uint64 private constant ROOT_REVIEW_ROLE = 5;

    bytes32 private constant MARKET_ID = keccak256("V1-TREASURY-INVARIANT-MARKET");
    bytes32 private constant ELIGIBILITY_POLICY = keccak256("ALL-HOLDERS");
    address private constant CREATOR = address(0xC0FFEE);
    address private constant CURVE = address(0xC0A7E);
    address private constant HOLDER_A = address(0xA11CE);
    address private constant HOLDER_B = address(0xB0B);
    address private constant FUNDER = address(0xF00D);
    address private constant ROOT_SERVICE_TREASURY = address(0xFEE);
    uint128 private constant SERVICE_FEE = 1 ether;
    uint256 private constant INITIAL_SUPPLY = 1_000_000_000 ether;

    AccessManager private manager;
    MockTreasuryMarketRegistryV1 private marketRegistry;
    TreasuryDistributorV1 private distributor;
    TickerMemeTokenV1 private meme;
    MockQuoteTokenV1 private quote;
    TreasuryDistributorV1InvariantHandler private handler;

    function setUp() public {
        vm.warp(1_700_000_000);
        vm.roll(1_000);

        manager = new AccessManager(address(this));
        marketRegistry = new MockTreasuryMarketRegistryV1();
        quote = new MockQuoteTokenV1();
        distributor = new TreasuryDistributorV1(
            TreasuryDistributorInitV1({
                authority: address(manager),
                marketRegistry: address(marketRegistry),
                rootServiceTreasury: ROOT_SERVICE_TREASURY,
                rootServiceFeeAsset: address(quote),
                rootServiceFeeAmount: SERVICE_FEE,
                finalityDelaySeconds: 1 hours,
                finalityDelayBlocks: 2,
                rootPublicationWindow: 3 days,
                rootReviewDelay: 2 days,
                claimWindow: 90 days
            })
        );
        meme = new TickerMemeTokenV1(
            MARKET_ID,
            CREATOR,
            CURVE,
            address(distributor),
            "Ticker Garden V1 Invariant",
            "TGI",
            "ipfs://v1-invariant",
            INITIAL_SUPPLY
        );

        _configureRoles();
        marketRegistry.setMarket(MARKET_ID, address(meme), address(quote), 1);
        distributor.registerMarket(MARKET_ID, address(meme), address(quote), ELIGIBILITY_POLICY);
        distributor.activateMarket(MARKET_ID);

        vm.prank(CURVE);
        meme.transfer(HOLDER_A, 1_000_000 ether);
        vm.prank(CURVE);
        meme.transfer(HOLDER_B, 1_000_000 ether);

        handler = new TreasuryDistributorV1InvariantHandler(distributor, meme, quote);
        manager.grantRole(ROOT_PUBLISHER_ROLE, address(handler), 0);
        manager.grantRole(ROOT_REVIEW_ROLE, address(handler), 0);

        bytes4[] memory selectors = new bytes4[](11);
        selectors[0] = handler.fund.selector;
        selectors[1] = handler.burn.selector;
        selectors[2] = handler.elapse.selector;
        selectors[3] = handler.requestRoot.selector;
        selectors[4] = handler.publishRoot.selector;
        selectors[5] = handler.finalizeRoot.selector;
        selectors[6] = handler.claim.selector;
        selectors[7] = handler.expireRoot.selector;
        selectors[8] = handler.cancelRoot.selector;
        selectors[9] = handler.withdrawService.selector;
        selectors[10] = handler.rollover.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function invariant_quoteBalanceCoversQuoteAndServiceLiabilities() public view {
        uint256 quoteLiability = distributor.totalQuoteLiability(address(quote));
        uint256 serviceLiability = distributor.totalServiceLiability(address(quote));
        uint256 quoteBalance = quote.balanceOf(address(distributor));

        assertGe(quoteBalance, quoteLiability + serviceLiability);
        assertEq(quoteLiability, handler.totalFunded() - handler.totalClaimed());
        assertEq(serviceLiability, handler.totalServiceFeesCollected() - handler.totalServiceFeesWithdrawn());
    }

    function invariant_quoteFundingAndPaymentsConserveBalance() public view {
        uint256 expectedBalance = handler.totalFunded() + handler.totalServiceFeesCollected();
        expectedBalance -= handler.totalClaimed();
        expectedBalance -= handler.totalServiceFeesWithdrawn();
        assertEq(quote.balanceOf(address(distributor)), expectedBalance);
    }

    function invariant_allQuoteLiabilityRemainsAssignedToAnEpoch() public view {
        uint256 reachableLiability;
        uint256 fundedEpochCount = handler.fundedEpochCount();
        for (uint256 i; i < fundedEpochCount; ++i) {
            uint32 epochId = handler.fundedEpochAt(i);
            TreasuryEpochV1 memory valueEpoch = distributor.epoch(MARKET_ID, epochId);
            if (valueEpoch.status == TreasuryEpochStatusV1.UNREQUESTED) {
                reachableLiability += distributor.epochQuoteAmount(MARKET_ID, epochId);
            } else if (valueEpoch.status != TreasuryEpochStatusV1.ROLLED_OVER) {
                reachableLiability += valueEpoch.quoteAmount - valueEpoch.claimedAmount;
            }
        }
        assertEq(reachableLiability, distributor.totalQuoteLiability(address(quote)));
    }

    function invariant_memeSupplyAndBalancesConserveTrueBurns() public view {
        assertEq(meme.totalSupply() + handler.totalBurned(), INITIAL_SUPPLY);
        assertEq(meme.balanceOf(address(distributor)), 0);
        assertEq(meme.balanceOf(CURVE) + meme.balanceOf(HOLDER_A) + meme.balanceOf(HOLDER_B), meme.totalSupply());
        assertLe(handler.totalBurned(), INITIAL_SUPPLY);
    }

    function invariant_randomTimeAndEpochArithmeticStayInRange() public view {
        TreasuryMarketV1 memory value = distributor.market(MARKET_ID);
        assertGe(block.timestamp, uint256(value.activatedAt));
        uint32 currentEpoch = distributor.currentEpochId(MARKET_ID);
        assertGt(currentEpoch, 0);
        (uint64 start, uint64 end) = distributor.epochWindow(MARKET_ID, currentEpoch);
        assertEq(start, uint64(uint256(value.activatedAt) + uint256(currentEpoch - 1) * 7 days));
        assertGt(end, start);
        assertLe(uint256(end), type(uint64).max);

        uint256 fundedEpochCount = handler.fundedEpochCount();
        for (uint256 i; i < fundedEpochCount; ++i) {
            uint32 epochId = handler.fundedEpochAt(i);
            (uint64 epochStart, uint64 epochEnd) = distributor.epochWindow(MARKET_ID, epochId);
            assertGt(epochEnd, epochStart);
            TreasuryEpochV1 memory valueEpoch = distributor.epoch(MARKET_ID, epochId);
            if (valueEpoch.status == TreasuryEpochStatusV1.ROLLED_OVER) {
                assertEq(distributor.epochQuoteAmount(MARKET_ID, epochId), 0);
            } else if (valueEpoch.status != TreasuryEpochStatusV1.UNREQUESTED) {
                assertEq(distributor.epochQuoteAmount(MARKET_ID, epochId), valueEpoch.quoteAmount);
            } else {
                // Before a root request (and after a cancellation/expiry),
                // quoteAmount is intentionally not copied into the epoch view.
                assertEq(valueEpoch.quoteAmount, 0);
            }
            assertLe(valueEpoch.claimedAmount, valueEpoch.quoteAmount);
        }
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
    }
}
