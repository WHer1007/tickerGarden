// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {ITickerMemeTokenV1} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {TickerMemeTokenV1} from "../../../src/v1/modules/TickerMemeTokenV1.sol";

contract TokenFactoryHarness {
    function deploy(
        bytes32 salt,
        bytes32 marketId,
        address creator,
        address predictedCurve,
        string memory name,
        string memory symbol,
        string memory metadataURI,
        uint256 supply
    ) external returns (TickerMemeTokenV1 token) {
        token = new TickerMemeTokenV1{salt: salt}(marketId, creator, predictedCurve, name, symbol, metadataURI, supply);
    }

    function predict(
        bytes32 salt,
        bytes32 marketId,
        address creator,
        address predictedCurve,
        string memory name,
        string memory symbol,
        string memory metadataURI,
        uint256 supply
    ) external view returns (address) {
        bytes memory initCode = abi.encodePacked(
            type(TickerMemeTokenV1).creationCode,
            abi.encode(marketId, creator, predictedCurve, name, symbol, metadataURI, supply)
        );
        return
            address(
                uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(initCode)))))
            );
    }
}

contract TickerMemeTokenV1Test is Test {
    bytes32 internal constant MARKET_ID = keccak256("market-1");
    bytes32 internal constant SALT = keccak256("token-salt");
    address internal constant CREATOR = address(0xC0FFEE);
    address internal constant CURVE = address(0xC0A7E);
    address internal constant BUYER = address(0xB0B);
    address internal constant SPENDER = address(0xA11CE);
    uint256 internal constant SUPPLY = 1_000_000_000 ether;

    TokenFactoryHarness internal factory;
    TickerMemeTokenV1 internal token;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function setUp() public {
        factory = new TokenFactoryHarness();
        token = factory.deploy(SALT, MARKET_ID, CREATOR, CURVE, "Ticker Garden", "TGRDN", "ipfs://market-1", SUPPLY);
    }

    function test_identityMetadataAndFixedDecimalsAreFrozenAtDeployment() public view {
        assertEq(token.marketId(), MARKET_ID);
        assertEq(token.creator(), CREATOR);
        assertEq(token.factory(), address(factory));
        assertEq(token.name(), "Ticker Garden");
        assertEq(token.symbol(), "TGRDN");
        assertEq(token.decimals(), 18);
        assertEq(token.metadataURI(), "ipfs://market-1");
        assertEq(token.initialSupply(), SUPPLY);
    }

    function test_entireSupplyIsMintedOnceDirectlyToPredictedCurve() public view {
        assertEq(token.totalSupply(), SUPPLY);
        assertEq(token.balanceOf(CURVE), SUPPLY);
        assertEq(token.balanceOf(address(factory)), 0);
        assertEq(token.balanceOf(CREATOR), 0);
        assertEq(token.balanceOf(address(this)), 0);
    }

    function test_create2PredictionIncludesCurveAndAllImmutableInputs() public view {
        address predicted =
            factory.predict(SALT, MARKET_ID, CREATOR, CURVE, "Ticker Garden", "TGRDN", "ipfs://market-1", SUPPLY);
        assertEq(address(token), predicted);

        address differentCurve =
            factory.predict(SALT, MARKET_ID, CREATOR, BUYER, "Ticker Garden", "TGRDN", "ipfs://market-1", SUPPLY);
        assertNotEq(differentCurve, predicted);
    }

    function test_standardTransfersAndApprovalsDoNotChangeSupply() public {
        vm.expectEmit(true, true, false, true, address(token));
        emit Transfer(CURVE, BUYER, 100 ether);
        vm.prank(CURVE);
        assertTrue(token.transfer(BUYER, 100 ether));
        assertEq(token.balanceOf(BUYER), 100 ether);

        vm.expectEmit(true, true, false, true, address(token));
        emit Approval(BUYER, SPENDER, 40 ether);
        vm.prank(BUYER);
        assertTrue(token.approve(SPENDER, 40 ether));
        assertEq(token.allowance(BUYER, SPENDER), 40 ether);

        vm.expectEmit(true, true, false, true, address(token));
        emit Transfer(BUYER, CREATOR, 25 ether);
        vm.prank(SPENDER);
        assertTrue(token.transferFrom(BUYER, CREATOR, 25 ether));
        assertEq(token.balanceOf(CREATOR), 25 ether);
        assertEq(token.allowance(BUYER, SPENDER), 15 ether);
        assertEq(token.totalSupply(), SUPPLY);
    }

    function test_noPostDeploymentMintBurnPauseTaxOrMetadataMutationPath() public {
        bytes4[7] memory forbidden = [
            bytes4(keccak256("mint(address,uint256)")),
            bytes4(keccak256("burn(uint256)")),
            bytes4(keccak256("pause()")),
            bytes4(keccak256("blacklist(address)")),
            bytes4(keccak256("setTax(uint256)")),
            bytes4(keccak256("setMetadataURI(string)")),
            bytes4(keccak256("rebase(uint256)"))
        ];
        uint256 supplyBefore = token.totalSupply();
        for (uint256 i; i < forbidden.length; ++i) {
            (bool success,) = address(token).call(abi.encodeWithSelector(forbidden[i], CREATOR, 1 ether));
            assertFalse(success);
        }
        assertEq(token.totalSupply(), supplyBefore);
    }

    function test_constructorRejectsIncompleteIdentityOrZeroSupply() public {
        vm.expectRevert(TickerMemeTokenV1.InvalidTokenIdentity.selector);
        new TickerMemeTokenV1(bytes32(0), CREATOR, CURVE, "Name", "SYM", "uri", SUPPLY);

        vm.expectRevert(TickerMemeTokenV1.InvalidTokenIdentity.selector);
        new TickerMemeTokenV1(MARKET_ID, address(0), CURVE, "Name", "SYM", "uri", SUPPLY);

        vm.expectRevert(TickerMemeTokenV1.InvalidTokenIdentity.selector);
        new TickerMemeTokenV1(MARKET_ID, CREATOR, address(0), "Name", "SYM", "uri", SUPPLY);

        vm.expectRevert(TickerMemeTokenV1.InvalidTokenIdentity.selector);
        new TickerMemeTokenV1(MARKET_ID, CREATOR, CURVE, "Name", "SYM", "uri", 0);
    }

    function test_customSelectorsMatchCanonicalInterface() public pure {
        assertEq(TickerMemeTokenV1.marketId.selector, ITickerMemeTokenV1.marketId.selector);
        assertEq(TickerMemeTokenV1.creator.selector, ITickerMemeTokenV1.creator.selector);
        assertEq(TickerMemeTokenV1.factory.selector, ITickerMemeTokenV1.factory.selector);
        assertEq(TickerMemeTokenV1.metadataURI.selector, ITickerMemeTokenV1.metadataURI.selector);
        assertEq(TickerMemeTokenV1.initialSupply.selector, ITickerMemeTokenV1.initialSupply.selector);
    }
}
