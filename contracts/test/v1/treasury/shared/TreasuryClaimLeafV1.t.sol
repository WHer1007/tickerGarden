// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {TreasuryClaimLeafV1} from "../../../../src/v1/libraries/TreasuryClaimLeafV1.sol";

contract TreasuryClaimLeafHarnessV1 {
    function hash(
        TreasuryClaimLeafV1.Context memory context,
        uint256 index,
        address account,
        uint256 twab,
        uint256 amount
    ) external pure returns (bytes32) {
        return TreasuryClaimLeafV1.hash(context, index, account, twab, amount);
    }
}

contract TreasuryClaimLeafV1Test is Test {
    bytes32 private constant EXPECTED = 0xab280e273527f73b10b62757d6010f593c0298c7fba4f6c61e9d2028c07ee054;
    bytes32 private constant POLICY = 0x9eb852c8b30899159ae73ab17ba2015052ea0ca12e229b11b43ee1cf79dfc2ea;

    TreasuryClaimLeafHarnessV1 private harness;

    function setUp() public {
        harness = new TreasuryClaimLeafHarnessV1();
    }

    function test_typescriptGeneratorAndSolidityLeafSchemaMatch() public view {
        bytes32 actual = harness.hash(_context(), 0, address(0xa11c), 60_480_000, 1_000);
        assertEq(actual, EXPECTED);
    }

    function test_replayProtectionFieldsChangeLeaf() public view {
        TreasuryClaimLeafV1.Context memory context = _context();
        bytes32 canonical = harness.hash(context, 0, address(0xa11c), 60_480_000, 1_000);
        context.chainId = 1;
        assertNotEq(harness.hash(context, 0, address(0xa11c), 60_480_000, 1_000), canonical);
        context = _context();
        context.sourceBlockHash = keccak256("OTHER");
        assertNotEq(harness.hash(context, 0, address(0xa11c), 60_480_000, 1_000), canonical);
    }

    function _context() private pure returns (TreasuryClaimLeafV1.Context memory context) {
        context.chainId = 46_630;
        context.distributor = address(0xd157);
        context.marketId = 0x1111111111111111111111111111111111111111111111111111111111111111;
        context.epochId = 1;
        context.memeToken = address(0x1000);
        context.quoteToken = address(0x2000);
        context.eligibilityPolicyHash = POLICY;
        context.windowStart = 1_700_000_000;
        context.windowEnd = 1_700_604_800;
        context.sourceBlockNumber = 999;
        context.sourceBlockHash = 0x2222222222222222222222222222222222222222222222222222222222222222;
    }
}
