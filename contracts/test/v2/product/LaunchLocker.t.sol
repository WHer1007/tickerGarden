// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey as V4PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PositionInfo} from "@uniswap/v4-periphery/src/libraries/PositionInfoLibrary.sol";
import {PositionInfoLibrary} from "@uniswap/v4-periphery/src/libraries/PositionInfoLibrary.sol";

import {MarketConfig, MarketRuntime, MarketView, PoolKey} from "../../../src/v2/interfaces/IV2Protocol.sol";
import {LaunchLocker} from "../../../src/v2/modules/LaunchLocker.sol";
import {LaunchLockerBinding} from "../../../src/v2/shared/LaunchLockerBinding.sol";
import {LaunchLockerCompounding} from "../../../src/v2/shared/LaunchLockerCompounding.sol";

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
                ponsBaselineId: keccak256("locker-pons"),
                quoteAssetConfigId: keccak256("locker-quote"),
                launchTemplateId: keccak256("locker-template"),
                feePolicyId: keccak256("locker-fee"),
                executionSpecId: keccak256("V2-EXEC-5"),
                expectedEconomics: keccak256("locker-economics"),
                launchConfigId: 0,
                creatorRevenueBeneficiaryAtCreation: address(0xBEEF),
                memeToken: meme,
                curve: address(0xC0DE),
                gauge: address(0x6000),
                quoteAsset: quote,
                graduatedHook: hook,
                marketController: address(0x7000)
            }),
            runtime: MarketRuntime({
                poolId: bytes32(0),
                sourceVersion: 1,
                recoveryEpoch: 0,
                sweptAt: 1,
                statusSince: 1,
                restrictedSince: 0,
                launchPhase: 1,
                marketStatus: 0
            })
        });
    }

    function setGraduationExecutor(address value) external {
        graduationExecutor = value;
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

contract LaunchLockerPoolManagerMock {
    bytes32 private constant POOLS_SLOT = bytes32(uint256(6));
    mapping(bytes32 slot => bytes32 value) private _externalStorage;

    receive() external payable {}

    function setSlot0(bytes32 poolId, uint160 sqrtPriceX96, int24 tick) external {
        bytes32 slot = keccak256(abi.encodePacked(poolId, POOLS_SLOT));
        _externalStorage[slot] = bytes32(uint256(sqrtPriceX96) | (uint256(uint24(tick)) << 160));
    }

    function extsload(bytes32 slot) external view returns (bytes32 value) {
        return _externalStorage[slot];
    }
}

contract LaunchLockerPermit2Mock {
    mapping(address owner => mapping(address token => mapping(address spender => uint160 amount))) public allowance;

    function approve(address token, address spender, uint160 amount, uint48) external {
        allowance[msg.sender][token][spender] = amount;
    }

    function transferFrom(address from, address to, uint160 amount, address token) external {
        uint160 available = allowance[from][token][msg.sender];
        require(available >= amount, "permit2 allowance");
        allowance[from][token][msg.sender] = available - amount;
        require(ERC20(token).transferFrom(from, to, amount), "token transfer");
    }
}

contract LaunchLockerPositionManagerMock {
    using PositionInfoLibrary for V4PoolKey;

    address public immutable poolManager;
    address public immutable permit2;
    uint256 public nextTokenId = 1;

    mapping(uint256 tokenId => address owner) public ownerOf;
    mapping(uint256 tokenId => V4PoolKey key) private _keys;
    mapping(uint256 tokenId => PositionInfo info) private _infos;
    mapping(uint256 tokenId => uint128 liquidity) private _liquidities;

    uint256 public accrued0;
    uint256 public accrued1;
    uint256 public collectCalls;
    uint256 public increaseCalls;
    bool public failIncrease;
    bool public shortConsume;
    bool public attemptReenter;
    bool public reentryBlocked;

    constructor(address poolManager_, address permit2_) {
        poolManager = poolManager_;
        permit2 = permit2_;
    }

    receive() external payable {}

    function configurePosition(uint256 tokenId, address owner, V4PoolKey memory key, uint128 liquidity) external {
        ownerOf[tokenId] = owner;
        _keys[tokenId] = key;
        int24 lower = (TickMath.MIN_TICK / key.tickSpacing) * key.tickSpacing;
        int24 upper = (TickMath.MAX_TICK / key.tickSpacing) * key.tickSpacing;
        _infos[tokenId] = PositionInfoLibrary.initialize(key, lower, upper);
        _liquidities[tokenId] = liquidity;
    }

    function setPositionOwner(uint256 tokenId, address owner) external {
        ownerOf[tokenId] = owner;
    }

    function setPositionKey(uint256 tokenId, V4PoolKey memory key) external {
        _keys[tokenId] = key;
        int24 lower = (TickMath.MIN_TICK / key.tickSpacing) * key.tickSpacing;
        int24 upper = (TickMath.MAX_TICK / key.tickSpacing) * key.tickSpacing;
        _infos[tokenId] = PositionInfoLibrary.initialize(key, lower, upper);
    }

    function setLiquidity(uint256 tokenId, uint128 value) external {
        _liquidities[tokenId] = value;
    }

    function setAccrued(uint256 amount0, uint256 amount1) external {
        accrued0 = amount0;
        accrued1 = amount1;
    }

    function setBehavior(bool failIncrease_, bool shortConsume_, bool attemptReenter_) external {
        failIncrease = failIncrease_;
        shortConsume = shortConsume_;
        attemptReenter = attemptReenter_;
    }

    function modifyLiquidities(bytes calldata unlockData, uint256 deadline) external payable {
        require(block.timestamp <= deadline, "deadline");
        (bytes memory actions, bytes[] memory params) = abi.decode(unlockData, (bytes, bytes[]));
        require(actions.length == 2 && params.length == 2, "length");
        if (uint8(actions[1]) == 0x11) {
            _collect(msg.sender, actions, params);
        } else {
            _increase(msg.sender, actions, params);
        }
    }

    function getPoolAndPositionInfo(uint256 tokenId) external view returns (V4PoolKey memory, PositionInfo) {
        return (_keys[tokenId], _infos[tokenId]);
    }

    function getPositionLiquidity(uint256 tokenId) external view returns (uint128) {
        return _liquidities[tokenId];
    }

    function _collect(address caller, bytes memory actions, bytes[] memory params) private {
        require(uint8(actions[0]) == 0x00 && uint8(actions[1]) == 0x11, "collect actions");
        (uint256 tokenId, uint256 liquidity, uint128 amount0Max, uint128 amount1Max, bytes memory hookData) =
            abi.decode(params[0], (uint256, uint256, uint128, uint128, bytes));
        (Currency currency0, Currency currency1, address recipient) =
            abi.decode(params[1], (Currency, Currency, address));
        require(
            tokenId == 1 && ownerOf[tokenId] == caller && liquidity == 0 && amount0Max == 0 && amount1Max == 0
                && hookData.length == 0 && recipient == caller,
            "collect params"
        );
        require(
            Currency.unwrap(currency0) == Currency.unwrap(_keys[tokenId].currency0)
                && Currency.unwrap(currency1) == Currency.unwrap(_keys[tokenId].currency1),
            "collect currencies"
        );
        if (attemptReenter) {
            (bool success,) = caller.call(abi.encodeWithSignature("compoundLockedFees()"));
            require(!success, "reentered");
            reentryBlocked = true;
        }
        ++collectCalls;
        _pay(recipient, Currency.unwrap(currency0), accrued0);
        _pay(recipient, Currency.unwrap(currency1), accrued1);
        accrued0 = 0;
        accrued1 = 0;
    }

    function _increase(address caller, bytes memory actions, bytes[] memory params) private {
        require(uint8(actions[0]) == 0x00 && uint8(actions[1]) == 0x0d, "increase actions");
        (uint256 tokenId, uint256 liquidity, uint128 amount0Max, uint128 amount1Max, bytes memory hookData) =
            abi.decode(params[0], (uint256, uint256, uint128, uint128, bytes));
        (Currency currency0, Currency currency1) = abi.decode(params[1], (Currency, Currency));
        require(tokenId == 1 && ownerOf[tokenId] == caller && liquidity != 0 && hookData.length == 0, "increase params");
        require(
            Currency.unwrap(currency0) == Currency.unwrap(_keys[tokenId].currency0)
                && Currency.unwrap(currency1) == Currency.unwrap(_keys[tokenId].currency1),
            "increase currencies"
        );
        if (failIncrease) revert("increase");
        ++increaseCalls;
        uint256 consume0 = shortConsume && amount0Max != 0 ? amount0Max - 1 : amount0Max;
        uint256 consume1 = shortConsume && amount0Max == 0 && amount1Max != 0 ? amount1Max - 1 : amount1Max;
        uint256 nativeRequired = _consume(caller, Currency.unwrap(currency0), consume0);
        nativeRequired += _consume(caller, Currency.unwrap(currency1), consume1);
        require(msg.value == nativeRequired, "native");
        if (nativeRequired != 0) {
            (bool success,) = payable(poolManager).call{value: nativeRequired}("");
            require(success, "native transfer");
        }
        _liquidities[tokenId] += uint128(liquidity);
    }

    function _pay(address recipient, address currency, uint256 amount) private {
        if (amount == 0) return;
        if (currency == address(0)) {
            (bool success,) = payable(recipient).call{value: amount}("");
            require(success, "native fee");
        } else {
            require(ERC20(currency).transfer(recipient, amount), "token fee");
        }
    }

    function _consume(address payer, address currency, uint256 amount) private returns (uint256 nativeAmount) {
        if (amount == 0) return 0;
        if (currency == address(0)) return amount;
        LaunchLockerPermit2Mock(permit2).transferFrom(payer, poolManager, uint160(amount), currency);
    }
}

contract LaunchLockerTest is Test {
    bytes32 private constant MARKET_ID = keccak256("launch-locker-market");
    address private constant HOOK = address(0x2044);

    LaunchLockerToken private quote;
    LaunchLockerToken private meme;
    LaunchLockerRegistryMock private registry;
    LaunchLockerPoolManagerMock private poolManager;
    LaunchLockerPermit2Mock private permit2;
    LaunchLockerPositionManagerMock private positionManager;
    LaunchLocker private locker;
    V4PoolKey private key;
    bytes32 private poolId;

    event LockedFeesCompounded(
        bytes32 indexed marketId,
        uint256 amount0,
        uint256 amount1,
        uint128 liquidityAdded,
        uint256 remaining0,
        uint256 remaining1
    );

    function setUp() public {
        quote = new LaunchLockerToken("QUOTE");
        meme = new LaunchLockerToken("MEME");
        poolManager = new LaunchLockerPoolManagerMock();
        permit2 = new LaunchLockerPermit2Mock();
        positionManager = new LaunchLockerPositionManagerMock(address(poolManager), address(permit2));
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
        poolManager.setSlot0(poolId, uint160(1 << 96), 0);
        locker = new LaunchLocker(MARKET_ID, address(registry), address(positionManager));
        positionManager.configurePosition(1, address(locker), key, 1_000_000);
    }

    function test_permissionlessBalancedFeesIncreaseOnlyTheCanonicalPositionAndRevokeAllowances() public {
        _fundPositionManager(1_000_000, 2_000_000);
        positionManager.setAccrued(1_000_000, 2_000_000);
        vm.prank(address(0xB0B));
        (uint256 amount0, uint256 amount1, uint128 liquidityAdded) = locker.compoundLockedFees();

        assertGt(amount0, 0);
        assertGt(amount1, 0);
        assertGt(liquidityAdded, 0);
        assertEq(positionManager.getPositionLiquidity(1), 1_000_000 + liquidityAdded);
        assertEq(positionManager.ownerOf(1), address(locker));
        assertEq(positionManager.collectCalls(), 1);
        assertEq(positionManager.increaseCalls(), 1);
        _assertAllowancesZero();
        _assertCanonicalPosition();
    }

    function test_preexistingBalancesAndCollectedFeesShareOneExactCompoundWithoutLosingResiduals() public {
        _mintToLocker(111, 333);
        _fundPositionManager(1_000, 2_000);
        positionManager.setAccrued(1_000, 2_000);
        uint256 before0 = _balance(address(locker), _currency0());
        uint256 before1 = _balance(address(locker), _currency1());

        (uint256 amount0, uint256 amount1, uint128 liquidityAdded) = locker.compoundLockedFees();

        assertGt(liquidityAdded, 0);
        assertEq(_balance(address(locker), _currency0()), before0 + 1_000 - amount0);
        assertEq(_balance(address(locker), _currency1()), before1 + 2_000 - amount1);
        assertEq(locker.unpairedLockedBalance(_currency0()), before0 + 1_000 - amount0);
        assertEq(locker.unpairedLockedBalance(_currency1()), before1 + 2_000 - amount1);
    }

    function test_singleSidedBalanceRemainsIsolatedAndDoesNotMutateLiquidity() public {
        _fundPositionManager(999, 0);
        positionManager.setAccrued(999, 0);
        uint128 liquidityBefore = positionManager.getPositionLiquidity(1);

        (uint256 amount0, uint256 amount1, uint128 liquidityAdded) = locker.compoundLockedFees();

        assertEq(amount0, 0);
        assertEq(amount1, 0);
        assertEq(liquidityAdded, 0);
        assertEq(positionManager.getPositionLiquidity(1), liquidityBefore);
        assertEq(locker.unpairedLockedBalance(_currency0()), 999);
        assertEq(locker.unpairedLockedBalance(_currency1()), 0);
        assertEq(positionManager.collectCalls(), 1);
        assertEq(positionManager.increaseCalls(), 0);
        _assertAllowancesZero();
    }

    function test_maximumPositionLiquidityCollectsButCannotOverflowOrAddLiquidity() public {
        positionManager.setLiquidity(1, type(uint128).max);
        _fundPositionManager(100, 100);
        positionManager.setAccrued(100, 100);

        (uint256 amount0, uint256 amount1, uint128 liquidityAdded) = locker.compoundLockedFees();

        assertEq(amount0, 0);
        assertEq(amount1, 0);
        assertEq(liquidityAdded, 0);
        assertEq(positionManager.getPositionLiquidity(1), type(uint128).max);
        assertEq(locker.unpairedLockedBalance(_currency0()), 100);
        assertEq(locker.unpairedLockedBalance(_currency1()), 100);
    }

    function test_lateIncreaseFailureRollsBackFeeCollectionBalancesAndAllowances() public {
        _fundPositionManager(1_000, 1_000);
        positionManager.setAccrued(1_000, 1_000);
        positionManager.setBehavior(true, false, false);

        vm.expectRevert(bytes("increase"));
        locker.compoundLockedFees();

        assertEq(positionManager.accrued0(), 1_000);
        assertEq(positionManager.accrued1(), 1_000);
        assertEq(positionManager.collectCalls(), 0);
        assertEq(positionManager.increaseCalls(), 0);
        assertEq(locker.unpairedLockedBalance(_currency0()), 0);
        assertEq(locker.unpairedLockedBalance(_currency1()), 0);
        assertEq(positionManager.getPositionLiquidity(1), 1_000_000);
        _assertAllowancesZero();
    }

    function test_shortConsumptionIsDetectedAndRollsBackTheWholeCompound() public {
        _fundPositionManager(1_000, 1_000);
        positionManager.setAccrued(1_000, 1_000);
        positionManager.setBehavior(false, true, false);

        vm.expectPartialRevert(LaunchLockerCompounding.LockedCompoundBalanceMismatch.selector);
        locker.compoundLockedFees();

        assertEq(positionManager.accrued0(), 1_000);
        assertEq(positionManager.accrued1(), 1_000);
        assertEq(positionManager.getPositionLiquidity(1), 1_000_000);
        _assertAllowancesZero();
    }

    function test_reentrancyDuringCollectionIsBlockedWithoutPreventingCanonicalCompound() public {
        _fundPositionManager(1_000, 1_000);
        positionManager.setAccrued(1_000, 1_000);
        positionManager.setBehavior(false, false, true);

        (,, uint128 liquidityAdded) = locker.compoundLockedFees();

        assertTrue(positionManager.reentryBlocked());
        assertGt(liquidityAdded, 0);
        assertEq(positionManager.increaseCalls(), 1);
    }

    function test_wrongOwnerOrPoolCannotCollectOrMutateAnyBalance() public {
        _fundPositionManager(1_000, 1_000);
        positionManager.setAccrued(1_000, 1_000);
        positionManager.setPositionOwner(1, address(0xBAD));
        vm.expectRevert(abi.encodeWithSelector(LaunchLockerBinding.LockedPositionNotOwned.selector, 1, address(0xBAD)));
        locker.compoundLockedFees();
        assertEq(positionManager.collectCalls(), 0);

        positionManager.setPositionOwner(1, address(locker));
        V4PoolKey memory wrongKey = key;
        wrongKey.tickSpacing = 201;
        positionManager.setPositionKey(1, wrongKey);
        vm.expectPartialRevert(LaunchLockerCompounding.InvalidLockedPositionData.selector);
        locker.compoundLockedFees();
        assertEq(positionManager.collectCalls(), 0);
    }

    function test_nativeQuoteAndErc20MemeCompoundWithoutLeavingApprovalOrOwnershipSurface() public {
        LaunchLockerRegistryMock nativeRegistry = new LaunchLockerRegistryMock();
        LaunchLockerPoolManagerMock nativePoolManager = new LaunchLockerPoolManagerMock();
        LaunchLockerPermit2Mock nativePermit2 = new LaunchLockerPermit2Mock();
        LaunchLockerPositionManagerMock nativePositionManager =
            new LaunchLockerPositionManagerMock(address(nativePoolManager), address(nativePermit2));
        nativeRegistry.configure(MARKET_ID, address(0), address(meme), HOOK);
        nativeRegistry.setGraduationExecutor(address(this));
        PoolKey memory nativeStored = nativeRegistry.canonicalPoolKey(MARKET_ID);
        V4PoolKey memory nativeKey = V4PoolKey({
            currency0: Currency.wrap(nativeStored.currency0),
            currency1: Currency.wrap(nativeStored.currency1),
            fee: nativeStored.fee,
            tickSpacing: nativeStored.tickSpacing,
            hooks: IHooks(nativeStored.hooks)
        });
        bytes32 nativePoolId = keccak256(abi.encode(nativeKey));
        nativePoolManager.setSlot0(nativePoolId, uint160(1 << 96), 0);
        LaunchLocker nativeLocker = new LaunchLocker(MARKET_ID, address(nativeRegistry), address(nativePositionManager));
        nativePositionManager.configurePosition(1, address(nativeLocker), nativeKey, 1_000_000);
        vm.deal(address(nativePositionManager), 1_000);
        meme.mint(address(nativePositionManager), 1_000);
        nativePositionManager.setAccrued(1_000, 1_000);

        (uint256 amount0, uint256 amount1, uint128 liquidityAdded) = nativeLocker.compoundLockedFees();

        assertGt(amount0, 0);
        assertGt(amount1, 0);
        assertGt(liquidityAdded, 0);
        assertEq(nativePositionManager.ownerOf(1), address(nativeLocker));
        assertEq(meme.allowance(address(nativeLocker), address(nativePermit2)), 0);
        assertEq(nativePermit2.allowance(address(nativeLocker), address(meme), address(nativePositionManager)), 0);
    }

    function test_noWithdrawalApprovalTransferAdminOrArbitraryExecuteSelectorExists() public view {
        bytes4[8] memory forbidden = [
            bytes4(keccak256("withdraw(address,uint256)")),
            bytes4(keccak256("withdrawFees(address)")),
            bytes4(keccak256("approve(address,uint256)")),
            bytes4(keccak256("transfer(address,uint256)")),
            bytes4(keccak256("transferFrom(address,address,uint256)")),
            bytes4(keccak256("execute(address,bytes)")),
            bytes4(keccak256("setPool(bytes32)")),
            bytes4(keccak256("setPosition(uint256)"))
        ];
        for (uint256 i; i < forbidden.length; ++i) {
            (bool success,) = address(locker).staticcall(abi.encodeWithSelector(forbidden[i], address(this), 1));
            assertFalse(success);
        }
    }

    function _fundPositionManager(uint256 amount0, uint256 amount1) private {
        _mint(address(positionManager), _currency0(), amount0);
        _mint(address(positionManager), _currency1(), amount1);
    }

    function _mintToLocker(uint256 amount0, uint256 amount1) private {
        _mint(address(locker), _currency0(), amount0);
        _mint(address(locker), _currency1(), amount1);
    }

    function _mint(address recipient, address currency, uint256 amount) private {
        if (currency == address(quote)) quote.mint(recipient, amount);
        else meme.mint(recipient, amount);
    }

    function _currency0() private view returns (address) {
        return Currency.unwrap(key.currency0);
    }

    function _currency1() private view returns (address) {
        return Currency.unwrap(key.currency1);
    }

    function _balance(address account, address currency) private view returns (uint256) {
        if (currency == address(0)) return account.balance;
        return ERC20(currency).balanceOf(account);
    }

    function _assertAllowancesZero() private view {
        assertEq(ERC20(_currency0()).allowance(address(locker), address(permit2)), 0);
        assertEq(ERC20(_currency1()).allowance(address(locker), address(permit2)), 0);
        assertEq(permit2.allowance(address(locker), _currency0(), address(positionManager)), 0);
        assertEq(permit2.allowance(address(locker), _currency1(), address(positionManager)), 0);
    }

    function _assertCanonicalPosition() private view {
        (V4PoolKey memory actualKey, PositionInfo info) = positionManager.getPoolAndPositionInfo(1);
        assertEq(keccak256(abi.encode(actualKey)), poolId);
        assertEq(info.poolId(), bytes25(poolId));
        assertEq(info.tickLower(), (TickMath.MIN_TICK / key.tickSpacing) * key.tickSpacing);
        assertEq(info.tickUpper(), (TickMath.MAX_TICK / key.tickSpacing) * key.tickSpacing);
    }
}
