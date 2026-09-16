// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey as V4PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";

import {MarketConfig, MarketRuntime, MarketView, PoolKey} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {LaunchLocker} from "../../../src/v1/modules/LaunchLocker.sol";
import {LaunchLockerCustody} from "../../../src/v1/shared/LaunchLockerCustody.sol";

contract LaunchLockerToken is ERC20 {
    constructor(string memory name_) ERC20(name_, name_) {}

    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }
}

contract LaunchLockerRegistryMock {
    address public graduationExecutor;
    bytes32 private _marketId;
    MarketView private _market;
    PoolKey private _key;

    function configure(bytes32 marketId_, address quote, address meme, address hook) external {
        (address currency0, address currency1) = quote < meme ? (quote, meme) : (meme, quote);
        _marketId = marketId_;
        _key = PoolKey({currency0: currency0, currency1: currency1, fee: 0, tickSpacing: 200, hooks: hook});
        _market = MarketView({
            config: MarketConfig({
                assetUid: keccak256("locker-stock"),
                tickerGardenBaselineId: keccak256("locker-pons"),
                quoteAssetConfigId: keccak256("locker-quote"),
                launchTemplateId: keccak256("locker-template"),
                feePolicyId: keccak256("locker-fee"),
                executionSpecId: keccak256("V1-EXEC-11"),
                expectedEconomics: keccak256("locker-economics"),
                launchConfigId: 0,
                creatorRevenueBeneficiaryAtCreation: address(0xBEEF),
                memeToken: meme,
                curve: address(0xC0DE),
                gauge: address(0x6000),
                quoteAsset: quote,
                graduatedHook: hook,
                creatorTaxBps: 0,
                creatorFeesToHolders: false,
                stakingEnabled: true,
                burnMemeFees: false,
            lpFeePips: 0
        }),
            runtime: MarketRuntime({poolId: bytes32(0), sourceVersion: 1, launchPhase: 0})
        });
    }

    function setGraduationExecutor(address value) external {
        graduationExecutor = value;
    }

    function setCanonicalHook(address value) external {
        _key.hooks = value;
    }

    function market(bytes32 marketId_) external view returns (MarketView memory) {
        require(marketId_ == _marketId, "market");
        return _market;
    }

    function canonicalPoolKey(bytes32 marketId_) external view returns (PoolKey memory) {
        require(marketId_ == _marketId, "market");
        return _key;
    }

    function canonicalPoolId(bytes32 marketId_) external view returns (bytes32) {
        require(marketId_ == _marketId, "market");
        return keccak256(abi.encode(_key));
    }
}

contract LaunchLockerPositionManagerMock {
    uint256 public nextTokenId = 1;
    mapping(uint256 tokenId => address owner) public ownerOf;

    function setOwner(uint256 tokenId, address owner) external {
        ownerOf[tokenId] = owner;
    }
}

contract LaunchLockerTest is Test {
    bytes32 private constant MARKET_ID = keccak256("launch-locker-market");
    address private constant HOOK = address(0x2044);
    LaunchLockerToken private quote;
    LaunchLockerToken private meme;
    LaunchLockerRegistryMock private registry;
    LaunchLockerPositionManagerMock private positionManager;
    LaunchLocker private locker;
    V4PoolKey private key;
    bytes32 private poolId;

    function setUp() public {
        quote = new LaunchLockerToken("QUOTE");
        meme = new LaunchLockerToken("MEME");
        positionManager = new LaunchLockerPositionManagerMock();
        registry = new LaunchLockerRegistryMock();
        registry.configure(MARKET_ID, address(quote), address(meme), HOOK);
        registry.setGraduationExecutor(address(this));
        PoolKey memory storedKey = registry.canonicalPoolKey(MARKET_ID);
        key = V4PoolKey({
            currency0: Currency.wrap(storedKey.currency0),
            currency1: Currency.wrap(storedKey.currency1),
            fee: storedKey.fee,
            tickSpacing: storedKey.tickSpacing,
            hooks: IHooks(storedKey.hooks)
        });
        poolId = keccak256(abi.encode(key));
        locker = new LaunchLocker(MARKET_ID, address(registry), address(positionManager));
        positionManager.setOwner(1, address(locker));
    }

    function test_bindsMarketPoolAndProspectivePosition() public view {
        assertEq(locker.marketId(), MARKET_ID);
        (uint256 tokenId, bytes32 boundPoolId) = locker.lockedPosition();
        assertEq(tokenId, 1);
        assertEq(boundPoolId, poolId);
        PoolKey memory stored = registry.canonicalPoolKey(MARKET_ID);
        assertEq(stored.currency0, Currency.unwrap(key.currency0));
        assertEq(stored.currency1, Currency.unwrap(key.currency1));
        assertEq(stored.fee, 0);
        assertEq(stored.tickSpacing, 200);
        assertEq(stored.hooks, address(key.hooks));
    }

    function test_rejectsWrongCanonicalPoolKey() public {
        LaunchLockerRegistryMock wrongRegistry = new LaunchLockerRegistryMock();
        wrongRegistry.configure(MARKET_ID, address(quote), address(meme), HOOK);
        wrongRegistry.setCanonicalHook(address(0xBAD));
        wrongRegistry.setGraduationExecutor(address(this));
        vm.expectRevert();
        new LaunchLocker(MARKET_ID, address(wrongRegistry), address(positionManager));
    }

    function test_locksPositionNFTAndExposesNoWithdrawalOrUnboundedCompoundSurface() public view {
        bytes4[9] memory forbidden = [
            bytes4(keccak256("withdraw(address,uint256)")),
            bytes4(keccak256("withdrawFees(address)")),
            bytes4(keccak256("approve(address,uint256)")),
            bytes4(keccak256("transfer(address,uint256)")),
            bytes4(keccak256("transferFrom(address,address,uint256)")),
            bytes4(keccak256("execute(address,bytes)")),
            bytes4(keccak256("setPool(bytes32)")),
            bytes4(keccak256("setPosition(uint256)")),
            bytes4(keccak256("compoundLockedFees()"))
        ];
        for (uint256 i; i < forbidden.length; ++i) {
            (bool success,) = address(locker).staticcall(abi.encodeWithSelector(forbidden[i], address(this), 1));
            assertFalse(success);
        }
        assertEq(positionManager.ownerOf(1), address(locker));
    }

    function test_unboundedCompoundSelectorDoesNotExist() public view {
        (bool success,) = address(locker).staticcall(abi.encodeWithSignature("compoundLockedFees()"));
        assertFalse(success);
    }

    function test_directErc20TransfersRemainPermanentlyUnpaired() public {
        quote.mint(address(locker), 111);
        meme.mint(address(locker), 333);
        assertEq(locker.unpairedLockedBalance(address(quote)), 111);
        assertEq(locker.unpairedLockedBalance(address(meme)), 333);
    }

    function test_rejectsUnsupportedCurrencyBalanceQuery() public {
        vm.expectRevert(
            abi.encodeWithSelector(LaunchLockerCustody.UnsupportedLaunchLockerCurrency.selector, address(0xBAD))
        );
        locker.unpairedLockedBalance(address(0xBAD));
    }

    function test_nativeCurrencyAcceptsDirectValueAndTracksUnpairedBalance() public {
        LaunchLockerRegistryMock nativeRegistry = new LaunchLockerRegistryMock();
        LaunchLockerPositionManagerMock nativePositionManager = new LaunchLockerPositionManagerMock();
        nativeRegistry.configure(MARKET_ID, address(0), address(meme), HOOK);
        nativeRegistry.setGraduationExecutor(address(this));
        LaunchLocker nativeLocker = new LaunchLocker(MARKET_ID, address(nativeRegistry), address(nativePositionManager));
        nativePositionManager.setOwner(1, address(nativeLocker));
        vm.deal(address(this), 1 ether);
        (bool success,) = address(nativeLocker).call{value: 1 ether}("");
        assertTrue(success);
        assertEq(nativeLocker.unpairedLockedBalance(address(0)), 1 ether);
    }

    function test_erc20OnlyLockerRejectsUnexpectedNativeValue() public {
        vm.deal(address(this), 1 ether);
        (bool success,) = address(locker).call{value: 1}("");
        assertFalse(success);
    }
}
