// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Test} from "forge-std/Test.sol";
import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import {HolderRewardsDistributorV1 as Rewards} from "../../../../src/v1/modules/HolderRewardsDistributorV1.sol";
import {TickerMemeTokenV1} from "../../../../src/v1/modules/TickerMemeTokenV1.sol";
import {MarketView} from "../../../../src/v1/interfaces/IV1Protocol.sol";

contract SnapshotRegistry {
    address public factory;
    address public officialStockRegistry;
    mapping(bytes32 => MarketView) private markets;

    constructor(address stocks) {
        factory = msg.sender;
        officialStockRegistry = stocks;
    }

    function set(bytes32 id, MarketView memory v) external {
        markets[id] = v;
    }

    function market(bytes32 id) external view returns (MarketView memory) {
        return markets[id];
    }
}

contract SnapshotAuthority {
    address public authority;

    constructor(address a) {
        authority = a;
    }
}

contract SnapshotVault {
    receive() external payable {}
}

contract SnapshotHook {
    address public poolManager = address(0xB001);
    address public protocolFeeVault;

    constructor(address v) {
        protocolFeeVault = v;
    }
}

contract SnapshotWallet {
    receive() external payable {}

    function claim(Rewards r, bytes32 id, uint256 amount) external {
        r.claimSnapshot(id, 1, amount, 0, 1, new bytes32[](0));
    }
}

contract SnapshotReentrantWallet {
    Rewards private rewards;
    bytes32 private market;
    bool public reject = true;
    bool public nestedSucceeded;

    function allowPayment() external {
        reject = false;
    }

    function claim(Rewards r, bytes32 id) external {
        rewards = r;
        market = id;
        r.claimSnapshot(id, 1, 1 ether, 0, 1, new bytes32[](0));
    }

    receive() external payable {
        require(!reject, "REJECT_NATIVE");
        (nestedSucceeded,) = address(rewards)
            .call(abi.encodeCall(rewards.claimSnapshot, (market, uint64(1), 1 ether, 0, uint8(1), new bytes32[](0))));
    }
}

contract HolderSnapshotRewardsTest is Test {
    bytes32 constant ID = keccak256("wallet snapshot");
    address constant ALICE = address(0xA11CE);
    address constant BOB = address(0xB0B);
    address constant PUBLISHER = address(0x9001);
    address constant CURVE = address(0xC001);
    Rewards r;
    SnapshotRegistry registry;
    SnapshotVault vault;
    AccessManager manager;
    TickerMemeTokenV1 token;

    function setUp() public {
        vm.roll(1000);
        manager = new AccessManager(address(this));
        registry = new SnapshotRegistry(address(new SnapshotAuthority(address(manager))));
        vault = new SnapshotVault();
        r = new Rewards(address(registry));
        token = new TickerMemeTokenV1(ID, address(this), CURVE, address(r), "Garden", "G", "", 1000 ether);
        MarketView memory v;
        v.config.memeToken = address(token);
        v.config.curve = CURVE;
        v.config.creatorFeesToHolders = true;
        v.config.graduatedHook = address(new SnapshotHook(address(vault)));
        registry.set(ID, v);
        r.registerFeeSharingMarket(ID, address(vault), address(0xC002));
        vm.prank(CURVE);
        token.transfer(ALICE, 100 ether);
        vm.deal(address(vault), 100 ether);
    }

    function _fund(uint256 q, uint256 m) internal {
        if (q != 0) {
            vm.prank(address(vault));
            r.fundQuoteRewards{value: q}(ID, 1, q);
        }
        if (m != 0) {
            vm.prank(CURVE);
            token.transfer(address(vault), m);
            vm.startPrank(address(vault));
            token.approve(address(r), m);
            r.fundMemeFees(ID, m);
            vm.stopPrank();
        }
    }

    function _publication(bytes32 root, uint256 q, uint256 m) internal view returns (Rewards.Publication memory) {
        return Rewards.Publication(ID, 1, 1000, keccak256("block1000"), root, keccak256("public dataset"), q, m);
    }

    function _publish(Rewards.Publication memory p) internal {
        r.setSnapshotPublisher(PUBLISHER);
        vm.roll(2000); // Archived block identity attested by publisher in this test.
        Rewards.Publication[] memory ps = new Rewards.Publication[](1);
        ps[0] = p;
        vm.prank(PUBLISHER);
        r.publishSnapshots(ps);
    }

    function _claim(address user, uint256 q, uint256 m, uint8 assets) internal returns (uint256, uint256) {
        vm.prank(user);
        return r.claimSnapshot(ID, 1, q, m, assets, new bytes32[](0));
    }

    function test_robinhoodUsesCanonicalL2BlockDomain() public {
        vm.chainId(4663);
        vm.mockCall(address(100), abi.encodeWithSignature("arbBlockNumber()"), abi.encode(uint256(50000)));
        bytes32 otherId = keccak256("RH L2");
        TickerMemeTokenV1 other =
            new TickerMemeTokenV1(otherId, address(this), CURVE, address(r), "RH", "RH", "", 1000 ether);
        MarketView memory v = registry.market(ID);
        v.config.memeToken = address(other);
        registry.set(otherId, v);
        r.registerFeeSharingMarket(otherId, address(vault), address(0xC002));
        assertEq(r.marketState(otherId).registeredBlock, 50000);
        vm.prank(address(vault));
        r.fundQuoteRewards{value: 1 ether}(otherId, 1, 1 ether);
        vm.roll(1234); // Parent height cannot identify this snapshot.
        vm.mockCall(address(100), abi.encodeWithSignature("arbBlockNumber()"), abi.encode(uint256(50002)));
        bytes32 hash = keccak256("canonical L2 block");
        vm.mockCall(address(100), abi.encodeWithSignature("arbBlockHash(uint256)", uint256(50001)), abi.encode(hash));
        r.setSnapshotPublisher(PUBLISHER);
        Rewards.Publication[] memory ps = new Rewards.Publication[](1);
        ps[0] = Rewards.Publication(
            otherId, 1, 50001, hash, r.claimLeaf(otherId, 1, ALICE, 1 ether, 0), keccak256("data"), 1 ether, 0
        );
        vm.prank(PUBLISHER);
        r.publishSnapshots(ps);
        assertEq(r.roundState(otherId, 1).snapshotBlock, 50001);
    }

    function test_burnMarketRejectsMemeFundingAndNonzeroMemeSnapshot() public {
        bytes32 id = keccak256("burn mode snapshot");
        TickerMemeTokenV1 t = new TickerMemeTokenV1(id, address(this), CURVE, address(r), "Burn", "BURN", "", 1000 ether);
        MarketView memory v = registry.market(ID); v.config.memeToken = address(t); v.config.burnMemeFees = true;
        registry.set(id, v); r.registerFeeSharingMarket(id, address(vault), address(0xC002));
        vm.prank(address(vault)); vm.expectRevert(Rewards.InvalidFunding.selector); r.fundMemeFees(id, 1);
        vm.prank(address(vault)); r.fundQuoteRewards{value: 1 ether}(id, 1, 1 ether);
        r.setSnapshotPublisher(PUBLISHER);
        uint64 snapshot = r.marketState(id).registeredBlock + 1; vm.roll(uint256(snapshot) + 1);
        bytes32 blockHash = keccak256("burn snapshot block"); vm.setBlockhash(snapshot, blockHash);
        Rewards.Publication[] memory ps = new Rewards.Publication[](1);
        ps[0] = Rewards.Publication(id, 1, snapshot, blockHash, r.claimLeaf(id,1,ALICE,1 ether,0), keccak256("data"),1 ether,1);
        vm.prank(PUBLISHER); vm.expectRevert(Rewards.InvalidPublication.selector); r.publishSnapshots(ps);
        ps[0].memeBudget=0; vm.prank(PUBLISHER); r.publishSnapshots(ps);
        vm.prank(ALICE); (uint256 q,uint256 m)=r.claimSnapshot(id,1,1 ether,0,1,new bytes32[](0));
        assertEq(q,1 ether);assertEq(m,0);
    }

    function test_publisherStartsUnsetAndIsGoverned() public {
        assertEq(r.snapshotPublisher(), address(0));
        vm.expectRevert(Rewards.Unauthorized.selector);
        vm.prank(ALICE);
        r.setSnapshotPublisher(ALICE);
        r.setSnapshotPublisher(PUBLISHER);
        vm.expectRevert(Rewards.Unauthorized.selector);
        vm.prank(PUBLISHER);
        r.setSnapshotPublisher(BOB);
        r.setSnapshotPublisher(BOB);
        assertEq(r.snapshotPublisher(), BOB);
    }

    function test_publisherRotationUsesConfiguredGovernanceDelay() public {
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = r.setSnapshotPublisher.selector;
        manager.setTargetFunctionRole(address(r), selectors, 42);
        manager.grantRole(42, ALICE, 2 days);
        bytes memory data = abi.encodeCall(r.setSnapshotPublisher, (PUBLISHER));
        vm.prank(ALICE);
        manager.schedule(address(r), data, 0);
        vm.expectRevert(Rewards.Unauthorized.selector);
        vm.prank(ALICE);
        r.setSnapshotPublisher(PUBLISHER);
        vm.warp(block.timestamp + 2 days);
        vm.prank(ALICE);
        manager.execute(address(r), data);
        assertEq(r.snapshotPublisher(), PUBLISHER);
    }

    function test_dualAssetsClaimAfterSellingAndNoCurrentBalanceRequirement() public {
        _fund(6 ether, 4 ether);
        _publish(_publication(r.claimLeaf(ID, 1, ALICE, 6 ether, 4 ether), 6 ether, 4 ether));
        vm.prank(ALICE);
        token.transfer(BOB, 100 ether);
        _claim(ALICE, 6 ether, 4 ether, 3);
        assertEq(ALICE.balance, 6 ether);
        assertEq(token.balanceOf(ALICE), 4 ether);
        assertEq(r.totalLiability(address(0)), 0);
        assertEq(r.totalLiability(address(token)), 0);
        vm.expectRevert(Rewards.InvalidClaim.selector);
        _claim(BOB, 6 ether, 4 ether, 3);
    }

    function test_selectedAssetsRemainIndependentAndCannotReplay() public {
        _fund(6 ether, 4 ether);
        _publish(_publication(r.claimLeaf(ID, 1, ALICE, 6 ether, 4 ether), 6 ether, 4 ether));
        _claim(ALICE, 6 ether, 4 ether, 1);
        assertEq(r.roundState(ID, 1).memeRemaining, 4 ether);
        vm.expectRevert(Rewards.AlreadyClaimed.selector);
        _claim(ALICE, 6 ether, 4 ether, 3);
        _claim(ALICE, 6 ether, 4 ether, 2);
        assertEq(r.claimedAssets(ID, 1, ALICE), 3);
    }

    function test_wrongProofAmountOrChainCannotClaim() public {
        _fund(6 ether, 0);
        _publish(_publication(r.claimLeaf(ID, 1, ALICE, 6 ether, 0), 6 ether, 0));
        vm.expectRevert(Rewards.InvalidClaim.selector);
        _claim(ALICE, 7 ether, 0, 1);
        vm.chainId(block.chainid + 1);
        vm.expectRevert(Rewards.InvalidClaim.selector);
        _claim(ALICE, 6 ether, 0, 1);
    }

    function test_contractWalletIsEligibleButProtocolInventoryIsNot() public {
        SnapshotWallet wallet = new SnapshotWallet();
        vm.prank(ALICE);
        token.transfer(address(wallet), 100 ether);
        _fund(1 ether, 0);
        _publish(_publication(r.claimLeaf(ID, 1, address(wallet), 1 ether, 0), 1 ether, 0));
        wallet.claim(r, ID, 1 ether);
        assertEq(address(wallet).balance, 1 ether);
        assertFalse(r.excluded(ID, address(wallet)));
        assertTrue(r.excluded(ID, CURVE));
    }

    function test_maliciousInventoryLeafStillCannotClaim() public {
        _fund(1 ether, 0);
        _publish(_publication(r.claimLeaf(ID, 1, CURVE, 1 ether, 0), 1 ether, 0));
        vm.expectRevert(Rewards.InvalidClaim.selector);
        _claim(CURVE, 1 ether, 0, 1);
    }

    function test_unfundedBudgetAndRootOverwriteRejected() public {
        _fund(1 ether, 0);
        Rewards.Publication memory p = _publication(r.claimLeaf(ID, 1, ALICE, 1 ether, 0), 2 ether, 0);
        r.setSnapshotPublisher(PUBLISHER);
        vm.roll(2000);
        Rewards.Publication[] memory ps = new Rewards.Publication[](1);
        ps[0] = p;
        vm.expectRevert(Rewards.BudgetExceeded.selector);
        vm.prank(PUBLISHER);
        r.publishSnapshots(ps);
        ps[0].quoteBudget = 1 ether;
        vm.prank(PUBLISHER);
        r.publishSnapshots(ps);
        vm.expectRevert(Rewards.InvalidPublication.selector);
        vm.prank(PUBLISHER);
        r.publishSnapshots(ps);
        assertEq(r.marketState(ID).unallocatedQuote, 0);
    }

    function test_leafCannotSpendAnotherRoundsBudget() public {
        _fund(10 ether, 0);
        _publish(_publication(r.claimLeaf(ID, 1, ALICE, 10 ether, 0), 1 ether, 0));
        vm.expectRevert(Rewards.BudgetExceeded.selector);
        _claim(ALICE, 10 ether, 0, 1);
        assertEq(r.marketState(ID).unallocatedQuote, 9 ether);
        assertEq(r.claimedAssets(ID, 1, ALICE), 0);
    }

    function test_invalidBatchRollsBackEarlierPublication() public {
        _fund(2 ether, 0);
        r.setSnapshotPublisher(PUBLISHER);
        vm.roll(2000);
        Rewards.Publication[] memory ps = new Rewards.Publication[](2);
        ps[0] = _publication(r.claimLeaf(ID, 1, ALICE, 1 ether, 0), 1 ether, 0);
        ps[1] = ps[0];
        vm.expectRevert(Rewards.InvalidPublication.selector);
        vm.prank(PUBLISHER);
        r.publishSnapshots(ps);
        assertEq(r.marketState(ID).lastRound, 0);
        assertEq(r.marketState(ID).unallocatedQuote, 2 ether);
    }

    function test_recentSnapshotHashMustMatchAndFutureBlockRejected() public {
        _fund(1 ether, 0);
        r.setSnapshotPublisher(PUBLISHER);
        vm.roll(1002);
        vm.setBlockhash(1000, keccak256("actual"));
        Rewards.Publication[] memory ps = new Rewards.Publication[](1);
        ps[0] = _publication(r.claimLeaf(ID, 1, ALICE, 1 ether, 0), 1 ether, 0);
        vm.expectRevert(Rewards.InvalidPublication.selector);
        vm.prank(PUBLISHER);
        r.publishSnapshots(ps);
        ps[0].snapshotBlock = 1002;
        vm.expectRevert(Rewards.InvalidPublication.selector);
        vm.prank(PUBLISHER);
        r.publishSnapshots(ps);
    }

    function test_rewardFailureAndPublisherAbsenceNeverEnterTransferPath() public {
        vm.mockCallRevert(address(r), bytes(""), bytes("REWARDS_DOWN"));
        vm.cool(address(token));
        vm.prank(ALICE);
        uint256 start = gasleft();
        token.transfer(BOB, 40 ether);
        uint256 used = start - gasleft();
        emit log_named_uint("snapshot token cold transfer gas", used);
        assertLt(used, 100_000);
        assertEq(token.balanceOf(BOB), 40 ether);
        vm.clearMockedCalls();
        assertEq(r.snapshotPublisher(), address(0));
    }

    function test_insolventQuoteDoesNotBlockSelectedMemeOrTransfers() public {
        _fund(6 ether, 4 ether);
        _publish(_publication(r.claimLeaf(ID, 1, ALICE, 6 ether, 4 ether), 6 ether, 4 ether));
        vm.deal(address(r), 0);
        vm.expectRevert(Rewards.Insolvent.selector);
        _claim(ALICE, 6 ether, 4 ether, 3);
        assertEq(r.claimedAssets(ID, 1, ALICE), 0);
        vm.prank(ALICE);
        token.transfer(BOB, 1 ether);
        _claim(ALICE, 6 ether, 4 ether, 2);
        assertEq(r.roundState(ID, 1).quoteRemaining, 6 ether);
    }

    function test_twoLeafProofAndFundingConservation() public {
        _fund(10 ether, 0);
        bytes32 a = r.claimLeaf(ID, 1, ALICE, 7 ether, 0);
        bytes32 b = r.claimLeaf(ID, 1, BOB, 3 ether, 0);
        bytes32 root = a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
        _publish(_publication(root, 10 ether, 0));
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = b;
        vm.prank(ALICE);
        r.claimSnapshot(ID, 1, 7 ether, 0, 1, proof);
        proof[0] = a;
        vm.prank(BOB);
        r.claimSnapshot(ID, 1, 3 ether, 0, 1, proof);
        assertEq(ALICE.balance + BOB.balance, 10 ether);
        assertEq(address(r).balance, 0);
    }

    function test_failedRecipientRestoresRightsAndReentrancyCannotDoublePay() public {
        SnapshotReentrantWallet wallet = new SnapshotReentrantWallet();
        _fund(1 ether, 0);
        _publish(_publication(r.claimLeaf(ID, 1, address(wallet), 1 ether, 0), 1 ether, 0));
        vm.expectRevert(Rewards.TransferFailed.selector);
        wallet.claim(r, ID);
        assertEq(r.claimedAssets(ID, 1, address(wallet)), 0);
        assertEq(r.roundState(ID, 1).quoteRemaining, 1 ether);
        wallet.allowPayment();
        wallet.claim(r, ID);
        assertFalse(wallet.nestedSucceeded());
        assertEq(address(wallet).balance, 1 ether);
        assertEq(r.totalLiability(address(0)), 0);
    }

    function test_sharedAssetCannotSubsidizeAnotherMarketsBudget() public {
        bytes32 otherId = keccak256("second market");
        TickerMemeTokenV1 other =
            new TickerMemeTokenV1(otherId, address(this), CURVE, address(r), "Other", "O", "", 100 ether);
        MarketView memory v = registry.market(ID);
        v.config.memeToken = address(other);
        registry.set(otherId, v);
        r.registerFeeSharingMarket(otherId, address(vault), address(0xC002));
        _fund(1 ether, 0);
        vm.prank(address(vault));
        r.fundQuoteRewards{value: 10 ether}(otherId, 1, 10 ether);
        r.setSnapshotPublisher(PUBLISHER);
        vm.roll(2000);
        Rewards.Publication[] memory ps = new Rewards.Publication[](1);
        ps[0] = _publication(r.claimLeaf(ID, 1, ALICE, 2 ether, 0), 2 ether, 0);
        vm.expectRevert(Rewards.BudgetExceeded.selector);
        vm.prank(PUBLISHER);
        r.publishSnapshots(ps);
        assertEq(address(r).balance, 11 ether);
        assertEq(r.marketState(otherId).unallocatedQuote, 10 ether);
    }

    function test_revokedPublisherCannotPublishAndOldClaimsSurviveRotation() public {
        _fund(1 ether, 0);
        _publish(_publication(r.claimLeaf(ID, 1, ALICE, 1 ether, 0), 1 ether, 0));
        r.setSnapshotPublisher(BOB);
        Rewards.Publication[] memory ps = new Rewards.Publication[](1);
        vm.expectRevert(Rewards.Unauthorized.selector);
        vm.prank(PUBLISHER);
        r.publishSnapshots(ps);
        _claim(ALICE, 1 ether, 0, 1);
        assertEq(ALICE.balance, 1 ether);
    }

    function testFuzz_claimConservesFundedAssets(uint128 amount) public {
        uint256 q = bound(uint256(amount), 1, 100 ether);
        _fund(q, 0);
        _publish(_publication(r.claimLeaf(ID, 1, ALICE, q, 0), q, 0));
        _claim(ALICE, q, 0, 1);
        assertEq(r.totalLiability(address(0)), 0);
        assertEq(address(r).balance, 0);
    }
}
