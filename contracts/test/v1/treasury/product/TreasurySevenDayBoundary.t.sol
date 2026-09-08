// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import {Test} from "forge-std/Test.sol";
import {TreasuryEpochStatusV1, TreasuryEpochV1} from "../../../../src/v1/interfaces/IV1Protocol.sol";
import {TreasuryDistributorInitV1, TreasuryDistributorV1} from "../../../../src/v1/modules/TreasuryDistributorV1.sol";
import {TickerMemeTokenV1} from "../../../../src/v1/modules/TickerMemeTokenV1.sol";
import {MockQuoteTokenV1, MockTreasuryMarketRegistryV1} from "../mocks/MockV1TreasuryAssets.sol";

contract TreasurySevenDayBoundaryTest is Test {
    bytes32 private constant MARKET_ID = keccak256("SEVEN-DAY-BOUNDARY");
    bytes32 private constant POLICY = keccak256("POLICY");
    bytes32 private constant ROOT = keccak256("ROOT");
    bytes32 private constant DATASET = keccak256("DATASET");
    bytes32 private constant SOURCE = keccak256("SOURCE");
    address private constant HOLDER = address(0xB0B);
    address private constant FUNDER = address(0xF00D);
    address private constant PUBLISHER = address(0xA001);
    address private constant TREASURY = address(0xFEE);
    address private constant CURVE = address(0xCAFE);
    uint128 private constant FEE = 0.1 ether;
    uint32 private constant FINALITY_SECONDS = 1 hours;
    uint16 private constant FINALITY_BLOCKS = 2;

    AccessManager private manager;
    MockTreasuryMarketRegistryV1 private registry;
    TreasuryDistributorV1 private distributor;
    MockQuoteTokenV1 private quote;

    function setUp() public {
        vm.warp(1_700_000_000);
        vm.roll(1_000);
        manager = new AccessManager(address(this));
        registry = new MockTreasuryMarketRegistryV1();
        quote = new MockQuoteTokenV1();
        distributor = new TreasuryDistributorV1(TreasuryDistributorInitV1({
            authority: address(manager), marketRegistry: address(registry), rootServiceTreasury: TREASURY,
            rootServiceFeeAsset: address(0), rootServiceFeeAmount: FEE, finalityDelaySeconds: FINALITY_SECONDS,
            finalityDelayBlocks: FINALITY_BLOCKS, rootPublicationWindow: 3 days, rootReviewDelay: 2 days,
            claimWindow: 30 days
        }));
        TickerMemeTokenV1 meme = new TickerMemeTokenV1(
            MARKET_ID, address(this), CURVE, address(distributor), "Ticker Garden", "TGV", "ipfs://v1", 1_000_000 ether
        );
        registry.setMarket(MARKET_ID, address(meme), address(quote), 1);
        bytes4[] memory config = new bytes4[](2);
        config[0] = distributor.registerMarket.selector;
        config[1] = distributor.setRootServiceFee.selector;
        manager.setTargetFunctionRole(address(distributor), config, 1);
        manager.grantRole(1, address(this), 0);
        bytes4[] memory publish = new bytes4[](1);
        publish[0] = distributor.publishRoot.selector;
        manager.setTargetFunctionRole(address(distributor), publish, 4);
        manager.grantRole(4, PUBLISHER, 0);
        distributor.registerMarket(MARKET_ID, address(meme), address(quote), POLICY);
        distributor.activateMarket(MARKET_ID);
        vm.prank(CURVE);
        meme.transfer(HOLDER, 1_000 ether);
        quote.mint(FUNDER, 1_000 ether);
        vm.deal(HOLDER, 1 ether);
    }

    function test_sevenDaysMinusOneSecondCannotRequest() public {
        (, uint64 end) = distributor.epochWindow(MARKET_ID, 1);
        vm.warp(uint256(end) - 1);
        vm.prank(HOLDER);
        vm.expectRevert(abi.encodeWithSelector(TreasuryDistributorV1.EpochNotClosed.selector, end + FINALITY_SECONDS));
        distributor.requestRoot{value: FEE}(MARKET_ID, 1);
    }

    function test_sevenDaysPlusFinalityCanRequest() public {
        vm.prank(FUNDER);
        quote.approve(address(distributor), 100 ether);
        vm.prank(FUNDER);
        distributor.fundQuoteTreasury(MARKET_ID, 100 ether, keccak256("REQUEST-FUND"));
        (, uint64 end) = distributor.epochWindow(MARKET_ID, 1);
        vm.warp(uint256(end) + FINALITY_SECONDS);
        vm.roll(block.number + 10);
        vm.setBlockhash(block.number - FINALITY_BLOCKS, SOURCE);
        vm.prank(HOLDER);
        distributor.requestRoot{value: FEE}(MARKET_ID, 1);
        assertEq(uint8(distributor.epoch(MARKET_ID, 1).status), uint8(TreasuryEpochStatusV1.REQUESTED));
    }

    function test_nitroRootRequestCommitsL2HeaderNotParentHeader() public {
        vm.prank(FUNDER);quote.approve(address(distributor),100 ether);
        vm.prank(FUNDER);distributor.fundQuoteTreasury(MARKET_ID,100 ether,keccak256("NITRO-FUND"));
        (,uint64 end)=distributor.epochWindow(MARKET_ID,1);vm.warp(uint256(end)+FINALITY_SECONDS);
        vm.chainId(421614);vm.roll(11000000);
        vm.mockCall(address(100),abi.encodeWithSignature("arbBlockNumber()"),abi.encode(uint256(300000000)));
        vm.mockCall(address(100),abi.encodeWithSignature("arbBlockHash(uint256)",uint256(299999998)),abi.encode(SOURCE));
        vm.prank(HOLDER);distributor.requestRoot{value:FEE}(MARKET_ID,1);
        TreasuryEpochV1 memory value=distributor.epoch(MARKET_ID,1);
        assertEq(value.sourceBlockNumber,299999998);assertEq(value.sourceBlockHash,SOURCE);
        assertTrue(value.sourceBlockNumber!=block.number-FINALITY_BLOCKS);
    }

    function test_epochTwoStartsExactlyAtSevenDayBoundary() public {
        (uint64 start1, uint64 end1) = distributor.epochWindow(MARKET_ID, 1);
        (uint64 start2, uint64 end2) = distributor.epochWindow(MARKET_ID, 2);
        assertEq(start2, end1);
        assertEq(end1 - start1, 7 days);
        assertEq(end2 - start2, 7 days);
        assertEq(distributor.currentEpochId(MARKET_ID), 1);
        vm.warp(start2);
        assertEq(distributor.currentEpochId(MARKET_ID), 2);
    }

    function test_thirtyDayClaimWindowIsIndependentFromSevenDayEpoch() public {
        vm.prank(FUNDER);
        quote.approve(address(distributor), 100 ether);
        vm.prank(FUNDER);
        distributor.fundQuoteTreasury(MARKET_ID, 100 ether, keccak256("FUND"));
        (, uint64 end) = distributor.epochWindow(MARKET_ID, 1);
        vm.warp(uint256(end) + FINALITY_SECONDS);
        vm.roll(block.number + 10);
        vm.setBlockhash(block.number - FINALITY_BLOCKS, SOURCE);
        vm.prank(HOLDER);
        distributor.requestRoot{value: FEE}(MARKET_ID, 1);
        vm.prank(PUBLISHER);
        distributor.publishRoot(MARKET_ID, 1, ROOT, DATASET, 1, 1, 100 ether);
        TreasuryEpochV1 memory pending = distributor.epoch(MARKET_ID, 1);
        vm.warp(pending.finalizeAfter);
        distributor.finalizeRoot(MARKET_ID, 1);
        TreasuryEpochV1 memory claiming = distributor.epoch(MARKET_ID, 1);
        assertEq(claiming.claimUntil - claiming.finalizeAfter, 30 days);
        (uint64 start2, uint64 end2) = distributor.epochWindow(MARKET_ID, 2);
        assertEq(end2 - start2, 7 days);
    }
}
