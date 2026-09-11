// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {UserRewardClaimsTest} from "./UserRewardClaims.t.sol";

/// @dev Fault injection only: models a conversion child exhausting its gas allowance.
contract AuditGasExhaustingHook {
    function convertRewards(bytes32, uint256, uint256) external pure returns (uint256, uint256) {
        assembly { invalid() }
    }
}

contract ClaimAvailabilityAuditTest is UserRewardClaimsTest {
    function test_auditQuoteTransferFailureAlsoBlocksHealthyRawMeme() public {
        vm.mockCallRevert(address(q), abi.encodeCall(IERC20.transfer, (ALICE, 30)), bytes("QUOTE_PAUSED"));
        vm.prank(ALICE);
        vm.expectRevert();
        v.claimUserRewards(ID, 0, 1, false, false, 0);
        assertEq(m.balanceOf(ALICE), 0);
        assertEq(v.creatorLiability(ID, 1, address(m)), 100);
        assertEq(v.creatorLiability(ID, 1, address(q)), 30);
        vm.clearMockedCalls();
        vm.prank(ALICE);
        v.claimUserRewards(ID, 0, 1, false, false, 0);
        assertEq(m.balanceOf(ALICE), 100);
    }

    function test_auditGasExhaustionCanPreventAuthorizedFallback() public {
        r.configure(ID, address(new AuditGasExhaustingHook()), address(q), address(m), address(g));
        vm.prank(ALICE);
        (bool converted,) = address(v).call{gas: 500_000}(
            abi.encodeCall(v.claimUserRewards, (ID, uint8(0), uint32(1), true, true, block.timestamp + 240))
        );
        assertFalse(converted, "Fault model should exhaust fallback reserve");
        assertEq(v.creatorLiability(ID, 1, address(m)), 100);
        assertEq(v.creatorLiability(ID, 1, address(q)), 30);
        vm.prank(ALICE);
        (bool raw,) = address(v).call{gas: 500_000}(
            abi.encodeCall(v.claimUserRewards, (ID, uint8(0), uint32(1), false, false, uint256(0)))
        );
        assertTrue(raw, "Same budget supports ordinary raw claim");
        assertEq(m.balanceOf(ALICE), 100);
    }
}
