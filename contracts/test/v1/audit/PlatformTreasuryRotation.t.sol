// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import {ProtocolFeeVault, ProtocolFeeVaultInit} from "../../../src/v1/modules/ProtocolFeeVault.sol";
import {ProtocolFeeVaultLiabilities} from "../../../src/v1/shared/ProtocolFeeVaultLiabilities.sol";
import {MarketView} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {MockExactQuoteToken} from "../mocks/MockV1QuoteAssets.sol";

contract RotationRegistry {
    address public quote;
    address public meme;

    constructor(address q, address m) {
        quote = q;
        meme = m;
    }

    function market(bytes32) external view returns (MarketView memory v) {
        v.config.quoteAsset = quote;
        v.config.memeToken = meme;
    }
}

contract RotationRecipient {
    function accept(ProtocolFeeVault vault, uint256 nonce) external {
        vault.acceptPlatformTreasury(nonce);
    }
    receive() external payable {}
}

contract RotationVault is ProtocolFeeVault {
    constructor(ProtocolFeeVaultInit memory init) ProtocolFeeVault(init) {}

    function credit(bytes32 marketId, address asset, uint256 creator, uint256 staker, uint256 platform) external {
        _creditFeeLiabilities(marketId, 1, asset, creator + staker + platform, creator, staker, platform);
    }

    function setBusy(bool busy) external {
        _creditState = busy ? 1 : 0;
    }
}

contract RotationReentrantRecipient {
    ProtocolFeeVault public vault;
    uint256 public nonce;
    bool public blocked;

    function configure(ProtocolFeeVault v, uint256 n) external {
        vault = v;
        nonce = n;
    }

    receive() external payable {
        (bool ok,) = address(vault).call(abi.encodeCall(vault.executePlatformTreasury, (nonce)));
        blocked = !ok;
    }
}

contract PlatformTreasuryRotationTest is Test {
    bytes32 constant MARKET = keccak256("rotation-market");
    address constant GOV = address(0x601);
    address constant GUARDIAN = address(0x602);
    AccessManager access;
    RotationVault vault;
    RotationRecipient oldTreasury;
    RotationRecipient nextTreasury;
    RotationRegistry registry;
    MockExactQuoteToken quote;
    MockExactQuoteToken meme;

    function setUp() public {
        vm.warp(1_800_000_000);
        access = new AccessManager(address(this));
        access.grantRole(1, GOV, 48 hours);
        access.grantRole(2, GUARDIAN, 0);
        quote = new MockExactQuoteToken(18);
        meme = new MockExactQuoteToken(18);
        registry = new RotationRegistry(address(quote), address(meme));
        oldTreasury = new RotationRecipient();
        nextTreasury = new RotationRecipient();
        vault = new RotationVault(
            ProtocolFeeVaultInit(
                address(access),
                address(registry),
                address(quote),
                address(meme),
                address(oldTreasury),
                keccak256("policy")
            )
        );
    }

    function _propose() private {
        vm.prank(GOV);
        vault.proposePlatformTreasury(address(nextTreasury));
    }

    function _rotate() private {
        _propose();
        nextTreasury.accept(vault, 1);
        vm.warp(vault.treasuryChangeReadyAt());
        vault.executePlatformTreasury(1);
    }

    function test_exact48HoursAndAcceptanceRequired() public {
        _propose();
        assertEq(vault.platformTreasury(), address(oldTreasury));
        uint256 ready = vault.treasuryChangeReadyAt();
        assertEq(ready, block.timestamp + 48 hours);
        nextTreasury.accept(vault, 1);
        vm.warp(ready - 1);
        vm.expectRevert(ProtocolFeeVault.TreasuryChangeNotReady.selector);
        vault.executePlatformTreasury(1);
        vm.warp(ready);
        vm.prank(address(0xBEEF));
        vault.executePlatformTreasury(1);
        assertEq(vault.platformTreasury(), address(nextTreasury));
        assertEq(vault.pendingPlatformTreasury(), address(0));
        assertEq(vault.treasuryChangeReadyAt(), 0);
        assertFalse(vault.treasuryChangeAccepted());
    }

    function test_waitingDoesNotReplaceNewTreasuryConsent() public {
        _propose();
        vm.warp(vault.treasuryChangeReadyAt());
        vm.expectRevert(ProtocolFeeVault.TreasuryChangeNotReady.selector);
        vault.executePlatformTreasury(1);
        vm.expectRevert(abi.encodeWithSelector(ProtocolFeeVault.UnauthorizedTreasuryActor.selector, address(this)));
        vault.acceptPlatformTreasury(1);
    }

    function test_deployerGuardianAndOldTreasuryCannotPropose() public {
        address[3] memory actors = [address(this), GUARDIAN, address(oldTreasury)];
        for (uint256 i; i < actors.length; ++i) {
            vm.prank(actors[i]);
            vm.expectRevert(abi.encodeWithSelector(ProtocolFeeVault.UnauthorizedTreasuryActor.selector, actors[i]));
            vault.proposePlatformTreasury(address(nextTreasury));
        }
    }

    function test_invalidRecipientsRejected() public {
        address[7] memory targets = [
            address(0),
            address(0xBEEF),
            address(vault),
            address(access),
            address(registry),
            address(quote),
            address(oldTreasury)
        ];
        for (uint256 i; i < targets.length; ++i) {
            vm.prank(GOV);
            vm.expectRevert(
                abi.encodeWithSelector(ProtocolFeeVaultLiabilities.InvalidPlatformTreasury.selector, targets[i])
            );
            vault.proposePlatformTreasury(targets[i]);
        }
    }

    function test_cannotOverwritePendingAndOldSignatureCannotAcceptNewProposal() public {
        _propose();
        vm.prank(GOV);
        vm.expectRevert(ProtocolFeeVault.TreasuryProposalPending.selector);
        vault.proposePlatformTreasury(address(nextTreasury));
        nextTreasury.accept(vault, 1);
        vm.prank(GOV);
        vault.cancelPlatformTreasury(1);
        _propose();
        assertEq(vault.treasuryProposalNonce(), 2);
        assertFalse(vault.treasuryChangeAccepted());
        vm.expectRevert(abi.encodeWithSelector(ProtocolFeeVault.InvalidTreasuryProposal.selector, 1));
        nextTreasury.accept(vault, 1);
        vm.expectRevert(abi.encodeWithSelector(ProtocolFeeVault.InvalidTreasuryProposal.selector, 1));
        vault.executePlatformTreasury(1);
    }

    function test_guardianCanCancelImmediatelyEvenAfterAcceptanceAndDelay() public {
        _propose();
        nextTreasury.accept(vault, 1);
        vm.warp(vault.treasuryChangeReadyAt());
        vm.prank(GUARDIAN);
        vault.cancelPlatformTreasury(1);
        vm.expectRevert(abi.encodeWithSelector(ProtocolFeeVault.InvalidTreasuryProposal.selector, 1));
        vault.executePlatformTreasury(1);
        assertEq(vault.platformTreasury(), address(oldTreasury));
    }

    function test_unrelatedOrOldTreasuryCannotCancel() public {
        _propose();
        vm.prank(address(oldTreasury));
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolFeeVault.UnauthorizedTreasuryActor.selector, address(oldTreasury))
        );
        vault.cancelPlatformTreasury(1);
    }

    function test_revokedProposerCannotExecuteStaleProposal() public {
        _propose();
        nextTreasury.accept(vault, 1);
        access.revokeRole(1, GOV);
        vm.warp(vault.treasuryChangeReadyAt());
        vm.expectRevert(abi.encodeWithSelector(ProtocolFeeVault.UnauthorizedTreasuryActor.selector, GOV));
        vault.executePlatformTreasury(1);
    }

    function test_codeDriftAfterConsentBlocksExecution() public {
        _propose();
        nextTreasury.accept(vault, 1);
        vm.etch(address(nextTreasury), hex"60006000f3");
        vm.warp(vault.treasuryChangeReadyAt());
        vm.expectRevert(abi.encodeWithSelector(ProtocolFeeVault.TreasuryCodeChanged.selector, address(nextTreasury)));
        vault.executePlatformTreasury(1);
    }

    function test_pendingCreditBlocksTreasuryMutation() public {
        vault.setBusy(true);
        vm.prank(GOV);
        vm.expectRevert();
        vault.proposePlatformTreasury(address(nextTreasury));
        vault.setBusy(false);
        _propose();
        nextTreasury.accept(vault, 1);
        vm.warp(vault.treasuryChangeReadyAt());
        vault.setBusy(true);
        vm.expectRevert();
        vault.executePlatformTreasury(1);
        assertEq(vault.platformTreasury(), address(oldTreasury));
    }

    function test_unpaidPlatformFeesFollowNewTreasuryOtherBucketsStayUnchanged() public {
        quote.mint(address(vault), 100);
        vault.credit(MARKET, address(quote), 20, 30, 50);
        _rotate();
        vm.prank(address(0xBEEF));
        assertEq(vault.claimPlatform(MARKET, address(quote)), 50);
        assertEq(quote.balanceOf(address(nextTreasury)), 50);
        assertEq(quote.balanceOf(address(oldTreasury)), 0);
        assertEq(vault.creatorLiability(MARKET, 1, address(quote)), 20);
        assertEq(vault.liability(MARKET, address(quote), 1), 30);
        assertEq(vault.totalLiability(address(quote)), 50);
        assertEq(vault.claimPlatform(MARKET, address(quote)), 0);
    }

    function test_claimDuringPendingGoesToOldTreasury() public {
        quote.mint(address(vault), 50);
        vault.credit(MARKET, address(quote), 0, 0, 50);
        _propose();
        vault.claimPlatform(MARKET, address(quote));
        assertEq(quote.balanceOf(address(oldTreasury)), 50);
        assertEq(quote.balanceOf(address(nextTreasury)), 0);
    }

    function test_nativeClaimCannotReenterTreasuryExecution() public {
        RotationReentrantRecipient old = new RotationReentrantRecipient();
        RotationRegistry nativeRegistry = new RotationRegistry(address(0), address(meme));
        RotationVault nativeVault = new RotationVault(
            ProtocolFeeVaultInit(
                address(access),
                address(nativeRegistry),
                address(quote),
                address(meme),
                address(old),
                keccak256("policy")
            )
        );
        vm.prank(GOV);
        nativeVault.proposePlatformTreasury(address(nextTreasury));
        nextTreasury.accept(nativeVault, 1);
        vm.warp(nativeVault.treasuryChangeReadyAt());
        old.configure(nativeVault, 1);
        vm.deal(address(nativeVault), 1 ether);
        nativeVault.credit(MARKET, address(0), 0, 0, 1 ether);
        nativeVault.claimPlatform(MARKET, address(0));
        assertTrue(old.blocked());
        assertEq(nativeVault.platformTreasury(), address(old));
        nativeVault.executePlatformTreasury(1);
        vm.deal(address(nativeVault), 2 ether);
        nativeVault.credit(MARKET, address(0), 0, 0, 2 ether);
        nativeVault.claimPlatform(MARKET, address(0));
        assertEq(address(nextTreasury).balance, 2 ether);
    }

    function testFuzz_noExecutionBeforeDelay(uint32 elapsed) public {
        elapsed = uint32(bound(elapsed, 0, 48 hours - 1));
        _propose();
        nextTreasury.accept(vault, 1);
        vm.warp(block.timestamp + elapsed);
        vm.expectRevert(ProtocolFeeVault.TreasuryChangeNotReady.selector);
        vault.executePlatformTreasury(1);
    }
}
