// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {TreasuryClaimLeafV2} from "../../../src/v2/libraries/TreasuryClaimLeafV2.sol";

contract TreasuryClaimLeafHarnessV2 {
    function hash(
        TreasuryClaimLeafV2.Context memory context,
        uint256 index,
        address account,
        uint256 twab,
        uint256 amount
    ) external pure returns (bytes32) {
        return TreasuryClaimLeafV2.hash(context, index, account, twab, amount);
    }
}

contract TreasuryClaimLeafV2Test is Test {
    bytes32 private constant EXPECTED = 0x44d733ed1c08b532ac388800d9e34d12ddc666713d3d0b5ad9af8f4ed1acd263;
    bytes32 private constant POLICY = 0x9eb852c8b30899159ae73ab17ba2015052ea0ca12e229b11b43ee1cf79dfc2ea;

    TreasuryClaimLeafHarnessV2 private harness;

    function setUp() public {
        harness = new TreasuryClaimLeafHarnessV2();
    }

    function test_typescriptGeneratorAndSolidityLeafSchemaMatch() public view {
        bytes32 actual = harness.hash(_context(), 0, address(0xa11c), 259_200_000, 1_000);
        assertEq(actual, EXPECTED);
    }

    function test_replayProtectionFieldsChangeLeaf() public view {
        TreasuryClaimLeafV2.Context memory context = _context();
        bytes32 canonical = harness.hash(context, 0, address(0xa11c), 259_200_000, 1_000);
        context.chainId = 1;
        assertNotEq(harness.hash(context, 0, address(0xa11c), 259_200_000, 1_000), canonical);
        context = _context();
        context.sourceBlockHash = keccak256("OTHER");
        assertNotEq(harness.hash(context, 0, address(0xa11c), 259_200_000, 1_000), canonical);
    }

    function _context() private pure returns (TreasuryClaimLeafV2.Context memory context) {
        context.chainId = 46_630;
        context.distributor = address(0xd157);
        context.marketId = 0x1111111111111111111111111111111111111111111111111111111111111111;
        context.epochId = 1;
        context.memeToken = address(0x1000);
        context.quoteToken = address(0x2000);
        context.eligibilityPolicyHash = POLICY;
        context.windowStart = 1_700_000_000;
        context.windowEnd = 1_702_592_000;
        context.sourceBlockNumber = 999;
        context.sourceBlockHash = 0x2222222222222222222222222222222222222222222222222222222222222222;
    }
}
