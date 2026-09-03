// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {TickerMemeTokenV2} from "../../../src/v2/modules/TickerMemeTokenV2.sol";

contract TreasuryCodeStubV2 {}

contract TickerMemeTokenV2Test is Test {
    bytes32 private constant MARKET_ID = keccak256("V2-MARKET");
    address private constant CREATOR = address(0xC0FFEE);
    address private constant CURVE = address(0xC0A7E);
    address private constant HOLDER = address(0xB0B);
    uint256 private constant INITIAL_SUPPLY = 1_000_000_000 ether;

    TreasuryCodeStubV2 private treasury;
    TickerMemeTokenV2 private token;

    function setUp() public {
        vm.warp(1_700_000_000);
        treasury = new TreasuryCodeStubV2();
        token = new TickerMemeTokenV2(
            MARKET_ID, CREATOR, CURVE, address(treasury), "Ticker Garden V2", "TGV2", "ipfs://v2", INITIAL_SUPPLY
        );
    }

    function test_identityAndFixedMintAreImmutable() public view {
        assertEq(token.marketId(), MARKET_ID);
        assertEq(token.creator(), CREATOR);
        assertEq(token.factory(), address(this));
        assertEq(token.treasuryDistributor(), address(treasury));
        assertEq(token.metadataURI(), "ipfs://v2");
        assertEq(token.initialSupply(), INITIAL_SUPPLY);
        assertEq(token.deployedAt(), 1_700_000_000);
        assertEq(token.totalSupply(), INITIAL_SUPPLY);
        assertEq(token.balanceOf(CURVE), INITIAL_SUPPLY);
    }

    function test_onlyTreasuryCanBurnAndBurnReducesSupply() public {
        vm.prank(CURVE);
        token.transfer(address(treasury), 100 ether);

        vm.prank(HOLDER);
        vm.expectRevert(abi.encodeWithSelector(TickerMemeTokenV2.UnauthorizedTreasury.selector, HOLDER));
        token.burnTreasury(1 ether);

        vm.prank(address(treasury));
        token.burnTreasury(40 ether);
        assertEq(token.balanceOf(address(treasury)), 60 ether);
        assertEq(token.totalSupply(), INITIAL_SUPPLY - 40 ether);
    }

    function test_zeroBurnAndIncompleteIdentityAreRejected() public {
        vm.prank(address(treasury));
        vm.expectRevert(TickerMemeTokenV2.InvalidBurnAmount.selector);
        token.burnTreasury(0);

        vm.expectRevert(TickerMemeTokenV2.InvalidTokenIdentity.selector);
        new TickerMemeTokenV2(
            bytes32(0), CREATOR, CURVE, address(treasury), "Ticker Garden V2", "TGV2", "ipfs://v2", INITIAL_SUPPLY
        );

        vm.expectRevert(TickerMemeTokenV2.InvalidTokenIdentity.selector);
        new TickerMemeTokenV2(
            MARKET_ID, CREATOR, CURVE, HOLDER, "Ticker Garden V2", "TGV2", "ipfs://v2", INITIAL_SUPPLY
        );
    }

    function test_noGenericMintBurnPauseTaxOrMetadataMutationSurface() public {
        bytes4[6] memory forbidden = [
            bytes4(keccak256("mint(address,uint256)")),
            bytes4(keccak256("burn(uint256)")),
            bytes4(keccak256("pause()")),
            bytes4(keccak256("setTax(uint256)")),
            bytes4(keccak256("setMetadataURI(string)")),
            bytes4(keccak256("rebase(uint256)"))
        ];
        uint256 supplyBefore = token.totalSupply();
        for (uint256 i; i < forbidden.length; ++i) {
            (bool success,) = address(token).call(abi.encodeWithSelector(forbidden[i], HOLDER, 1 ether));
            assertFalse(success);
        }
        assertEq(token.totalSupply(), supplyBefore);
    }

    function test_standardTransferHasNoTwabCheckpointMutationSelector() public {
        vm.prank(CURVE);
        token.transfer(HOLDER, 10 ether);
        assertEq(token.balanceOf(HOLDER), 10 ether);

        (bool success,) =
            address(token).staticcall(abi.encodeWithSignature("getPastBalance(address,uint256)", HOLDER, 1));
        assertFalse(success);
    }
}
