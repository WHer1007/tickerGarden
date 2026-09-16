// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {MarketView} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {Test} from "forge-std/Test.sol";
import {
    RewardSettlementRegistryMock,
    RewardSettlementCreatorMock,
    RewardSettlementPoolManagerMock
} from "./RewardSettlement.t.sol";
import {ProtocolFeeVaultUserClaims} from "../../../src/v1/shared/ProtocolFeeVaultUserClaims.sol";
import {MockExactQuoteToken} from "../mocks/MockV1QuoteAssets.sol";

contract UserClaimHarness is ProtocolFeeVaultUserClaims {
    constructor(address r, address p, address c)
        ProtocolFeeVaultUserClaims(r, p, c, address(0x7000), keccak256("policy"))
    {}

    function seed(bytes32 id, uint32 epoch, address asset, uint256 amount, bool creator) external {
        _creditFeeLiabilities(id, epoch, asset, amount, creator ? amount : 0, creator ? 0 : amount, 0);
    }
}

contract UserClaimGauge {
    mapping(address => mapping(address => uint256)) public pending;
    address meme;
    address quote;
    bool public locked;

    constructor(address m, address q) {
        meme = m;
        quote = q;
    }

    function set(address user, address asset, uint256 amount) external {
        pending[user][asset] = amount;
    }

    function setLock(bool value) external {
        locked = value;
    }

    function consumeClaimableAssets(address user, uint8 assets) external returns (uint256 q, uint256 m) {
        require(!locked, "LOCKED");
        if (assets & 1 != 0) {
            q = pending[user][quote];
            delete pending[user][quote];
        }
        if (assets & 2 != 0) {
            m = pending[user][meme];
            delete pending[user][meme];
        }
    }

    function restoreUserMemeRewards(address user, uint256 m) external {
        pending[user][meme] += m;
    }
}

contract UserClaimHook {
    MockExactQuoteToken meme;
    MockExactQuoteToken quote;
    uint256 public percent = 100;
    bool public fail;
    bool public lie;

    constructor(MockExactQuoteToken m, MockExactQuoteToken q) {
        meme = m;
        quote = q;
    }

    function configure(uint256 p, bool f, bool l) external {
        percent = p;
        fail = f;
        lie = l;
    }

    function convertRewards(bytes32, uint256 amount, uint256) external returns (uint256 spent, uint256 received) {
        require(!fail, "SWAP_FAILED");
        spent = amount * percent / 100;
        received = spent * 2;
        meme.transferFrom(msg.sender, address(this), spent);
        quote.mint(msg.sender, received);
        if (lie) received++;
    }
}

contract UserRewardClaimsTest is Test {
    bytes32 constant ID = keccak256("user-claim");
    address constant ALICE = address(0xa11ce);
    address constant BOB = address(0xb0b);
    MockExactQuoteToken m;
    MockExactQuoteToken q;
    UserClaimHarness v;
    UserClaimHook h;
    UserClaimGauge g;
    RewardSettlementRegistryMock r;

    function setUp() public {
        m = new MockExactQuoteToken(18);
        q = new MockExactQuoteToken(18);
        r = new RewardSettlementRegistryMock();
        RewardSettlementCreatorMock c = new RewardSettlementCreatorMock();
        c.setEpoch(ID, 1, ALICE);
        c.setEpoch(ID, 2, BOB);
        g = new UserClaimGauge(address(m), address(q));
        h = new UserClaimHook(m, q);
        v = new UserClaimHarness(address(r), address(new RewardSettlementPoolManagerMock()), address(c));
        r.configure(ID, address(h), address(q), address(m), address(g));
        m.mint(address(v), 200);
        q.mint(address(v), 60);
        v.seed(ID, 1, address(m), 100, true);
        v.seed(ID, 2, address(m), 100, true);
        v.seed(ID, 1, address(q), 30, true);
        v.seed(ID, 2, address(q), 30, true);
    }

    function claim(bool, bool) private returns (uint256, uint256) {
        vm.prank(ALICE);
        return v.claimUserRewards(ID, 0, 1);
    }

    function test_legacyEntrypointsCannotConsumeUserRewards() public {
        bytes[] memory calls = new bytes[](8);
        calls[0] = abi.encodeWithSignature("claimCreator(bytes32,uint32,address)", ID, uint32(1), address(q));
        calls[1] = abi.encodeWithSignature("claimStaker(bytes32,address)", ID, address(q));
        calls[2] = abi.encodeWithSignature("claimStakerFor(address,bytes32,address)", ALICE, ID, address(q));
        calls[3] = abi.encodeWithSignature("requestRawRewardExit(bytes32)", ID);
        calls[4] = abi.encodeWithSignature("cancelRawRewardExit(bytes32)", ID);
        calls[5] = abi.encodeWithSignature("setSettlementOperator(address)", ALICE);
        calls[6] = abi.encodeWithSignature("settlementOperator()");
        calls[7] = abi.encodeWithSignature("RAW_EXIT_DELAY()");
        for (uint256 i; i < calls.length; ++i) {
            vm.prank(ALICE);
            (bool ok,) = address(v).call(calls[i]);
            assertFalse(ok, "Legacy selector must not be exposed");
        }
        assertEq(v.creatorLiability(ID, 1, address(q)), 30);
        assertEq(v.creatorLiability(ID, 1, address(m)), 100);
        claim(false, false);
        assertEq(q.balanceOf(ALICE), 30);
        assertEq(m.balanceOf(ALICE), 100);
    }

    function test_rawImmediatelyAndOtherUserFundsIsolated() public {
        claim(false, false);
        assertEq(m.balanceOf(ALICE), 100);
        assertEq(q.balanceOf(ALICE), 30);
        assertEq(v.creatorLiability(ID, 2, address(m)), 100);
        assertEq(m.balanceOf(address(v)), 100);
        vm.prank(BOB);
        v.claimUserRewards(ID, 0, 2);
        assertEq(q.balanceOf(BOB), 30);
        assertEq(m.balanceOf(BOB), 100);
    }

    function test_cannotClaimOtherCreatorOrInvokeConversionChild() public {
        vm.prank(BOB);
        vm.expectRevert();
        v.claimUserRewards(ID, 0, 1);
        MarketView memory value = r.market(ID);
        (bool ok,) = address(v)
            .call(
                abi.encodeWithSignature(
                    "convertUserClaim(bytes32,((bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,uint256,address,address,address,address,address,address,uint16,bool,bool),(bytes32,uint32,uint8)),uint256,uint256)",
                    ID,
                    value,
                    100,
                    block.timestamp + 240
                )
            );
        assertFalse(ok);
    }

    function test_claimRoleValidation() public {
        vm.prank(ALICE);
        v.claimUserRewards(ID, 0, 1);
        assertEq(q.balanceOf(ALICE), 30);
        assertEq(m.balanceOf(ALICE), 100);
        vm.expectRevert();
        v.claimUserRewards(ID, 3, 0);
    }

    function test_rawClaimKeepsRightsAfterLongIdle() public {
        vm.warp(block.timestamp + 365 days);
        vm.prank(ALICE);
        v.claimUserRewards(ID, 0, 1);
        assertEq(q.balanceOf(ALICE), 30);
        assertEq(m.balanceOf(ALICE), 100);
    }

    function test_claimReadsMarketOnce() public {
        vm.expectCall(address(r), abi.encodeWithSelector(r.market.selector, ID), uint64(1));
        claim(true, false);
    }

    function test_secondAssetDebitFailureRollsBackBothGaugeLedgers() public {
        m.mint(address(v), 50);
        q.mint(address(v), 10);
        v.seed(ID, 2, address(m), 50, false);
        v.seed(ID, 2, address(q), 10, false);
        g.set(ALICE, address(q), 10);
        g.set(ALICE, address(m), 51);
        vm.prank(ALICE);
        vm.expectRevert();
        v.claimUserRewards(ID, 1, 0);
        assertEq(g.pending(ALICE, address(q)), 10);
        assertEq(g.pending(ALICE, address(m)), 51);
        assertEq(q.balanceOf(ALICE), 0);
        assertEq(m.balanceOf(ALICE), 0);
        assertEq(v.creatorLiability(ID, 2, address(m)), 100);
    }

    function test_stakerLockAndRemainderBelongToSameUser() public {
        m.mint(address(v), 50);
        q.mint(address(v), 10);
        v.seed(ID, 2, address(m), 50, false);
        v.seed(ID, 2, address(q), 10, false);
        g.set(ALICE, address(m), 50);
        g.set(ALICE, address(q), 10);
        g.setLock(true);
        vm.prank(ALICE);
        vm.expectRevert("LOCKED");
        v.claimUserRewards(ID, 1, 0);
        g.setLock(false);
        h.configure(40, false, false);
        vm.expectCall(address(g), abi.encodeWithSelector(g.consumeClaimableAssets.selector, ALICE, uint8(3)), uint64(1));
        vm.prank(ALICE);
        v.claimUserRewards(ID, 1, 0);
        assertEq(g.pending(ALICE, address(m)), 0);
        assertEq(g.pending(BOB, address(m)), 0);
        assertEq(q.balanceOf(ALICE), 10);
        assertEq(m.balanceOf(ALICE), 50);
    }

    function test_rawClaimNeverApprovesOrCallsFailingSwapService() public {
        h.configure(100, true, true);
        (uint256 paid, uint256 memePaid) = claim(false, false);
        assertEq(paid, 30);
        assertEq(memePaid, 100);
        assertEq(m.allowance(address(v), address(h)), 0);
        assertEq(m.balanceOf(address(h)), 0);
        assertEq(v.creatorLiability(ID, 2, address(m)), 100);
    }

    function test_oldConversionClaimSelectorsAreAbsent() public {
        vm.prank(ALICE);
        (bool ok,) = address(v)
            .call(
                abi.encodeWithSignature(
                    "claimUserRewards(bytes32,uint8,uint32,bool,bool,uint256)",
                    ID,
                    uint8(0),
                    uint32(1),
                    true,
                    true,
                    block.timestamp + 60
                )
            );
        assertFalse(ok);
        assertEq(v.creatorLiability(ID, 1, address(m)), 100);
        assertEq(v.creatorLiability(ID, 1, address(q)), 30);
    }
}
