// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {PoolKey} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {LaunchLockerBinding} from "../../../src/v1/shared/LaunchLockerBinding.sol";
import {LaunchLockerCustody} from "../../../src/v1/shared/LaunchLockerCustody.sol";
import {
    PoolExecutionPonsBaselineRegistryMock,
    PoolExecutionQuoteRegistryMock,
    PoolExecutionRegistryMock,
    PoolExecutionToken
} from "./GraduationExecutorPoolExecution.t.sol";
import {LaunchLockerPositionManagerMock} from "./LaunchLockerBinding.t.sol";

contract LaunchLockerCustodyHarness is LaunchLockerCustody {
    constructor(bytes32 marketId_, address registry_, address positionManager_)
        LaunchLockerCustody(marketId_, registry_, positionManager_)
    {}

    function requireOwnership() external view returns (uint256 tokenId, bytes32 poolId) {
        return _requireLockedPositionOwnership();
    }

    function lockedCurrencies() external view returns (address currency0, address currency1) {
        return _lockedCurrencies();
    }
}

contract LaunchLockerCustodyTest is Test {
    bytes32 private constant MARKET_ID = keccak256("LOCKER-CUSTODY");
    bytes32 private constant QUOTE_ID = keccak256("QUOTE-CONFIG");
    address private constant HOOK = address(0x2044);

    PoolExecutionToken private quote;
    PoolExecutionToken private meme;
    PoolExecutionRegistryMock private registry;
    LaunchLockerPositionManagerMock private positionManager;

    function setUp() public {
        quote = new PoolExecutionToken("QUOTE");
        meme = new PoolExecutionToken("MEME");
        PoolExecutionQuoteRegistryMock quoteRegistry = new PoolExecutionQuoteRegistryMock();
        PoolExecutionPonsBaselineRegistryMock baselineRegistry = new PoolExecutionPonsBaselineRegistryMock();
        registry = new PoolExecutionRegistryMock(address(quoteRegistry), address(baselineRegistry));
        positionManager = new LaunchLockerPositionManagerMock();
        registry.configure(MARKET_ID, QUOTE_ID, address(quote), address(meme), address(0xC0A7), HOOK);
        registry.setGraduationExecutor(address(this));
    }

    function test_constructorFreezesCanonicalMarketPoolTokenAndCurrenciesOnce() public {
        positionManager.setNextTokenId(27);
        LaunchLockerCustodyHarness locker = _deploy();
        (uint256 tokenId, bytes32 poolId) = locker.lockedPosition();
        (address currency0, address currency1) = locker.lockedCurrencies();

        assertEq(locker.marketId(), MARKET_ID);
        assertEq(tokenId, 27);
        assertEq(poolId, registry.canonicalPoolId(MARKET_ID));
        assertEq(currency0, address(quote) < address(meme) ? address(quote) : address(meme));
        assertEq(currency1, address(quote) < address(meme) ? address(meme) : address(quote));

        registry.setCanonicalKey(
            PoolKey({currency0: address(0x1000), currency1: address(0x2000), fee: 0, tickSpacing: 200, hooks: HOOK})
        );
        (uint256 frozenTokenId, bytes32 frozenPoolId) = locker.lockedPosition();
        (address frozenCurrency0, address frozenCurrency1) = locker.lockedCurrencies();
        assertEq(frozenTokenId, 27);
        assertEq(frozenPoolId, poolId);
        assertEq(frozenCurrency0, currency0);
        assertEq(frozenCurrency1, currency1);
    }

    function test_onlyCanonicalCurrencyBalancesAreExposedAndRemainLocked() public {
        LaunchLockerCustodyHarness locker = _deploy();
        quote.mint(address(locker), 11 ether);
        meme.mint(address(locker), 29 ether);
        positionManager.setOwner(1, address(locker));

        assertEq(locker.unpairedLockedBalance(address(quote)), 11 ether);
        assertEq(locker.unpairedLockedBalance(address(meme)), 29 ether);
        vm.expectRevert(
            abi.encodeWithSelector(LaunchLockerCustody.UnsupportedLaunchLockerCurrency.selector, address(0xBAD))
        );
        locker.unpairedLockedBalance(address(0xBAD));

        (uint256 tokenId,) = locker.requireOwnership();
        assertEq(tokenId, 1);
        assertEq(quote.balanceOf(address(locker)), 11 ether);
        assertEq(meme.balanceOf(address(locker)), 29 ether);
    }

    function test_positionOwnershipGuardFailsClosedIfTheNftLeavesTheLocker() public {
        LaunchLockerCustodyHarness locker = _deploy();
        positionManager.setOwner(1, address(locker));
        locker.requireOwnership();

        positionManager.setOwner(1, address(this));
        vm.expectRevert(abi.encodeWithSelector(LaunchLockerBinding.LockedPositionNotOwned.selector, 1, address(this)));
        locker.requireOwnership();
    }

    function test_noNftApprovalTransferWithdrawalAdminOrArbitraryExecuteSelectorExists() public {
        LaunchLockerCustodyHarness locker = _deploy();
        positionManager.setOwner(1, address(locker));

        _assertSelectorAbsent(address(locker), abi.encodeWithSignature("approve(address,uint256)", address(this), 1));
        _assertSelectorAbsent(
            address(locker), abi.encodeWithSignature("setApprovalForAll(address,bool)", address(this), true)
        );
        _assertSelectorAbsent(
            address(locker),
            abi.encodeWithSignature("transferFrom(address,address,uint256)", address(locker), address(this), 1)
        );
        _assertSelectorAbsent(address(locker), abi.encodeWithSignature("withdraw(address,uint256)", address(quote), 1));
        _assertSelectorAbsent(
            address(locker), abi.encodeWithSignature("execute(address,bytes)", address(quote), bytes(""))
        );
        _assertSelectorAbsent(address(locker), abi.encodeWithSignature("initialize(bytes)"));

        (uint256 tokenId,) = locker.requireOwnership();
        assertEq(tokenId, 1);
        assertEq(positionManager.ownerOf(1), address(locker));
    }

    function test_nativeValueIsAcceptedOnlyForTheCanonicalNativePool() public {
        LaunchLockerCustodyHarness erc20Locker = _deploy();
        vm.deal(address(this), 3 ether);
        vm.expectRevert(
            abi.encodeWithSelector(
                LaunchLockerCustody.UnexpectedNativeLaunchLockerValue.selector,
                address(quote) < address(meme) ? address(quote) : address(meme),
                1 ether
            )
        );
        (bool rejected,) = address(erc20Locker).call{value: 1 ether}("");
        rejected;

        registry.configure(MARKET_ID, QUOTE_ID, address(0), address(meme), address(0xC0A7), HOOK);
        registry.setGraduationExecutor(address(this));
        LaunchLockerCustodyHarness nativeLocker = _deploy();
        (bool accepted,) = address(nativeLocker).call{value: 2 ether}("");
        assertTrue(accepted);
        assertEq(nativeLocker.unpairedLockedBalance(address(0)), 2 ether);
    }

    function test_nonCanonicalPoolKeyCannotCreateACustodyDomain() public {
        PoolKey memory invalid = PoolKey({
            currency0: address(quote) < address(meme) ? address(quote) : address(meme),
            currency1: address(quote) < address(meme) ? address(meme) : address(quote),
            fee: 1,
            tickSpacing: 200,
            hooks: HOOK
        });
        registry.setCanonicalKey(invalid);
        bytes32 invalidPoolId = keccak256(abi.encode(invalid));

        vm.expectRevert(
            abi.encodeWithSelector(
                LaunchLockerCustody.InvalidLaunchLockerPoolKey.selector, MARKET_ID, invalidPoolId, invalidPoolId
            )
        );
        _deploy();
    }

    function _deploy() private returns (LaunchLockerCustodyHarness) {
        return new LaunchLockerCustodyHarness(MARKET_ID, address(registry), address(positionManager));
    }

    function _assertSelectorAbsent(address target, bytes memory data) private {
        (bool success,) = target.call(data);
        assertFalse(success);
    }
}
