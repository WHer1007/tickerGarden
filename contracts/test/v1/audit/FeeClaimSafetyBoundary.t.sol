// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {UserRewardClaimsTest, UserClaimHarness} from "../shared/UserRewardClaims.t.sol";
import {RewardSettlementCreatorMock, RewardSettlementPoolManagerMock} from "../shared/RewardSettlement.t.sol";

import {MockExactQuoteToken, MockRebasingQuoteToken} from "../mocks/MockV1QuoteAssets.sol";
import {ProtocolFeeVaultLiabilities} from "../../../src/v1/shared/ProtocolFeeVaultLiabilities.sol";

contract CrossAssetClaimMeme is MockExactQuoteToken {
    MockRebasingQuoteToken immutable quote;
    address public target;

    constructor(MockRebasingQuoteToken quote_) MockExactQuoteToken(18) {
        quote = quote_;
    }

    function arm(address vault) external {
        target = vault;
    }

    function _transfer(address owner, address recipient, uint256 amount) internal override {
        super._transfer(owner, recipient, amount);
        if (owner == target) quote.simulateRebase(target, 0);
    }
}

/// @dev Stress double: models exhaustion of the conversion subcall's gas,
///      not an allegation that a user can replace the canonical Hook.
contract ExhaustClaimConversionGas {
    function convertRewards(bytes32, uint256, uint256) external pure returns (uint256, uint256) {
        assembly { invalid() }
    }
}

contract RejectNativeClaimRecipient {
    function claim(UserClaimHarness vault, bytes32 id, uint8 assets) external {
        vault.claimUserRewardAssets(id, 0, 1, assets);
    }
    // No receive or payable fallback: native payment cannot succeed.
}

contract ReenterNativeClaimRecipient {
    UserClaimHarness vault;
    bytes32 id;
    bool public nestedSuccess;
    uint256 public payments;

    function claim(UserClaimHarness vault_, bytes32 id_) external {
        vault = vault_;
        id = id_;
        vault.claimUserRewards(id, 0, 1);
    }

    receive() external payable {
        payments++;
        (nestedSuccess,) =
            address(vault).call(abi.encodeWithSelector(vault.claimUserRewards.selector, id, uint8(0), uint32(1)));
    }
}

contract FeeClaimSafetyBoundaryTest is UserRewardClaimsTest {
    function testAudit_nativeCallbackCannotReenterUnifiedClaim() public {
        ReenterNativeClaimRecipient recipient = new ReenterNativeClaimRecipient();
        RewardSettlementCreatorMock creators = new RewardSettlementCreatorMock();
        creators.setEpoch(ID, 1, address(recipient));
        UserClaimHarness nativeVault =
            new UserClaimHarness(address(r), address(new RewardSettlementPoolManagerMock()), address(creators));
        r.configure(ID, address(h), address(0), address(m), address(g));
        vm.deal(address(nativeVault), 1 ether);
        nativeVault.seed(ID, 1, address(0), 1 ether, true);
        recipient.claim(nativeVault, ID);
        recipient.claim(nativeVault, ID);
        assertFalse(recipient.nestedSuccess());
        assertEq(recipient.payments(), 1);
        assertEq(address(recipient).balance, 1 ether);
        assertEq(nativeVault.totalLiability(address(0)), 0);
    }

    function testAudit_repeatUnifiedClaimCannotConsumeOtherEpoch() public {
        vm.startPrank(ALICE);
        v.claimUserRewardAssets(ID, 0, 1, 2);
        (uint256 quotePaid, uint256 memePaid) = v.claimUserRewards(ID, 0, 1);
        assertEq(quotePaid, 30);
        assertEq(memePaid, 0);
        (quotePaid, memePaid) = v.claimUserRewards(ID, 0, 1);
        vm.stopPrank();
        assertEq(quotePaid, 0);
        assertEq(memePaid, 0);
        assertEq(v.creatorLiability(ID, 2, address(m)), 100);
        assertEq(v.creatorLiability(ID, 2, address(q)), 30);
    }

    function testAudit_finalSolvencyCheckDetectsCrossAssetLossDuringSecondPayment() public {
        MockRebasingQuoteToken quote = new MockRebasingQuoteToken(18);
        CrossAssetClaimMeme meme = new CrossAssetClaimMeme(quote);
        r.configure(ID, address(h), address(quote), address(meme), address(g));
        quote.mint(address(v), 60);
        meme.mint(address(v), 200);
        v.seed(ID, 1, address(quote), 30, true);
        v.seed(ID, 2, address(quote), 30, true);
        v.seed(ID, 1, address(meme), 100, true);
        v.seed(ID, 2, address(meme), 100, true);
        meme.arm(address(v));
        vm.prank(ALICE);
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolFeeVaultLiabilities.FeeVaultInsolvent.selector, address(quote), 0, 30)
        );
        v.claimUserRewards(ID, 0, 1);
        assertEq(quote.balanceOf(ALICE), 0);
        assertEq(meme.balanceOf(ALICE), 0);
        assertEq(quote.balanceOf(address(v)), 60);
        assertEq(v.creatorLiability(ID, 1, address(quote)), 30);
        assertEq(v.creatorLiability(ID, 1, address(meme)), 100);
    }

    function testAudit_nativeRejectingBeneficiaryCannotRedirectOldEpoch() public {
        RejectNativeClaimRecipient recipient = new RejectNativeClaimRecipient();
        RewardSettlementCreatorMock creators = new RewardSettlementCreatorMock();
        creators.setEpoch(ID, 1, address(recipient));
        UserClaimHarness nativeVault =
            new UserClaimHarness(address(r), address(new RewardSettlementPoolManagerMock()), address(creators));
        r.configure(ID, address(h), address(0), address(m), address(g));
        vm.deal(address(nativeVault), 1 ether);
        m.mint(address(nativeVault), 100);
        nativeVault.seed(ID, 1, address(0), 1 ether, true);
        nativeVault.seed(ID, 1, address(m), 100, true);
        vm.expectRevert();
        recipient.claim(nativeVault, ID, 3);
        assertEq(nativeVault.creatorLiability(ID, 1, address(0)), 1 ether);
        // A new beneficiary epoch does not reassign the old owner's earnings.
        creators.setEpoch(ID, 2, ALICE);
        vm.prank(ALICE);
        vm.expectRevert();
        nativeVault.claimUserRewardAssets(ID, 0, 1, 1);
        recipient.claim(nativeVault, ID, 2);
        assertEq(m.balanceOf(address(recipient)), 100);
        assertEq(nativeVault.creatorLiability(ID, 1, address(0)), 1 ether);
    }

    function testAudit_sharedAssetDeficitBlocksQuoteButNotSelectedMeme() public {
        // Conditional external balance loss; no claim or attacker operation causes it here.
        deal(address(q), address(v), 59);
        vm.prank(ALICE);
        vm.expectRevert();
        v.claimUserRewardAssets(ID, 0, 1, 1);
        assertEq(v.creatorLiability(ID, 1, address(q)), 30);
        vm.prank(ALICE);
        v.claimUserRewardAssets(ID, 0, 1, 2);
        assertEq(m.balanceOf(ALICE), 100);
        assertEq(v.creatorLiability(ID, 2, address(m)), 100);
    }

    function testAudit_rawCreatorClaimReadsVaultBalanceFourTimesPerAsset() public {
        vm.expectCall(address(q), abi.encodeWithSignature("balanceOf(address)", address(v)), uint64(4));
        vm.expectCall(address(m), abi.encodeWithSignature("balanceOf(address)", address(v)), uint64(4));
        vm.prank(ALICE);
        uint256 before = gasleft();
        v.claimUserRewards(ID, 0, 1);
        emit log_named_uint("raw dual-asset creator claim gas", before - gasleft());
    }
}
