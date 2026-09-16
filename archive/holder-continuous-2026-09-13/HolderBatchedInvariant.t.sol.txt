// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {HolderAccountingHarness as HolderRewardsDistributorV1} from "../../mocks/HolderAccountingHarness.sol";
import {TickerMemeTokenV1} from "../../../../src/v1/modules/TickerMemeTokenV1.sol";
import {MarketView} from "../../../../src/v1/interfaces/IV1Protocol.sol";
import {MockExactQuoteToken} from "../../mocks/MockV1QuoteAssets.sol";
import {ContinuousRegistryMock, ContinuousVaultMock, ContinuousHookMock} from "./HolderRewardsDistributorV1.t.sol";

contract HolderBatchedHandler is Test {
    HolderRewardsDistributorV1 public d;
    ContinuousVaultMock public vault;
    MockExactQuoteToken public quote;
    TickerMemeTokenV1[3] public tokens;
    bytes32[3] public ids;
    uint256[3] public funded;
    uint256[3] public paid;
    address constant ALICE = address(0xA11CE);
    address constant BOB = address(0xB0B);
    address constant CURVE = address(0xC001);

    constructor(
        HolderRewardsDistributorV1 d_,
        ContinuousVaultMock v,
        MockExactQuoteToken q,
        TickerMemeTokenV1[3] memory t,
        bytes32[3] memory marketIds
    ) {
        d = d_;
        vault = v;
        quote = q;
        tokens = t;
        ids = marketIds;
        vm.deal(address(this), 1_000_000 ether);
    }

    function fund(uint8 market, uint128 amount) external {
        uint256 i = market % 3;
        uint256 n = bound(amount, 1, 10 ether);
        if (i == 2) {
            quote.mint(address(vault), n);
            vault.fundToken(d, ids[i], quote, n);
        } else {
            vault.fund{value: n}(d, ids[i]);
        }
        funded[i] += n;
    }

    function move(uint8 market, uint8 from, uint8 to, uint256 amount) external {
        address[3] memory actors = [ALICE, BOB, CURVE];
        uint256 i = market % 3;
        address sender = actors[from % 3];
        uint256 n = bound(amount, 0, tokens[i].balanceOf(sender));
        vm.prank(sender);
        tokens[i].transfer(actors[to % 3], n);
    }

    function claim(uint8 market, bool bob) public {
        uint256 i = market % 3;
        vm.prank(bob ? BOB : ALICE);
        paid[i] += d.claim(ids[i]);
    }

    function advance(uint32 seconds_, uint8 market) external {
        vm.warp(block.timestamp + bound(seconds_, 0, 3 days));
        d.checkpoint(ids[market % 3]);
    }

    function drain() external {
        for (uint256 i; i < 3; ++i) {
            uint256 balance = tokens[i].balanceOf(CURVE);
            vm.prank(CURVE);
            tokens[i].transfer(ALICE, balance);
        }
        vm.warp(block.timestamp + 4 hours);
        for (uint256 i; i < 3; ++i) {
            d.checkpoint(ids[i]);
        }
        vm.warp(block.timestamp + 24 hours);
        for (uint8 i; i < 3; ++i) {
            claim(i, false);
            claim(i, true);
        }
    }
}

contract HolderBatchedInvariantTest is StdInvariant, Test {
    HolderRewardsDistributorV1 d;
    HolderBatchedHandler h;
    MockExactQuoteToken quote;
    TickerMemeTokenV1[3] tokens;
    bytes32[3] ids;

    function setUp() public {
        vm.warp(1_800_000_000);
        ContinuousRegistryMock registry = new ContinuousRegistryMock();
        ContinuousVaultMock vault = new ContinuousVaultMock();
        ContinuousHookMock hook = new ContinuousHookMock(address(vault));
        d = new HolderRewardsDistributorV1(address(registry));
        quote = new MockExactQuoteToken(6);
        for (uint256 i; i < 3; ++i) {
            ids[i] = keccak256(abi.encode("batched invariant", i));
            tokens[i] = new TickerMemeTokenV1(
                ids[i], address(this), address(0xC001), address(d), "Invariant", "INV", "", 1000 ether
            );
            MarketView memory v;
            v.config.memeToken = address(tokens[i]);
            v.config.curve = address(0xC001);
            v.config.quoteAsset = i == 2 ? address(quote) : address(0);
            v.config.creatorFeesToHolders = true;
            v.config.graduatedHook = address(hook);
            registry.set(v);
            d.registerFeeSharingMarket(ids[i], address(vault), address(0xC002));
            vm.prank(address(0xC001));
            tokens[i].transfer(address(0xA11CE), 500 ether);
        }
        h = new HolderBatchedHandler(d, vault, quote, tokens, ids);
        bytes4[] memory selectors = new bytes4[](4);
        selectors[0] = h.fund.selector;
        selectors[1] = h.move.selector;
        selectors[2] = h.claim.selector;
        selectors[3] = h.advance.selector;
        targetSelector(FuzzSelector(address(h), selectors));
        targetContract(address(h));
    }

    function invariant_independentCashflowSolvencySupplyAndBoundedStreams() public view {
        uint256 nativeLiability;
        for (uint256 i; i < 3; ++i) {
            HolderRewardsDistributorV1.Market memory m = d.marketState(ids[i]);
            assertEq(m.funded, h.funded(i));
            assertEq(m.paid, h.paid(i));
            assertLe(m.paid, m.funded);
            assertLe(m.count, 6);
            assertEq(m.supply, tokens[i].balanceOf(address(0xA11CE)) + tokens[i].balanceOf(address(0xB0B)));
            assertEq(d.claimable(ids[i], address(0xC001)), 0);
            (uint256 unreleased, uint256 idle,,) = d.releaseState(ids[i]);
            uint256 claims = d.claimable(ids[i], address(0xA11CE)) + d.claimable(ids[i], address(0xB0B));
            assertLe(claims + unreleased + idle, m.funded - m.paid);
            if (i == 2) {
                assertEq(d.totalLiability(address(quote)), m.funded - m.paid);
                assertEq(quote.balanceOf(address(d)), m.funded - m.paid);
            } else {
                nativeLiability += m.funded - m.paid;
            }
        }
        assertEq(d.totalLiability(address(0)), nativeLiability);
        assertEq(address(d).balance, nativeLiability);
    }

    function afterInvariant() public {
        h.drain();
        for (uint256 i; i < 3; ++i) {
            HolderRewardsDistributorV1.Market memory m = d.marketState(ids[i]);
            assertEq(m.count, 0);
            assertEq(m.idle, 0);
            assertLe(m.funded - m.paid, 2);
        }
    }
}
