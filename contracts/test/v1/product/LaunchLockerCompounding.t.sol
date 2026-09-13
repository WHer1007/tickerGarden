// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {PoolDonateTest} from "@uniswap/v4-core/src/test/PoolDonateTest.sol";
import {PoolKey as V4Key} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PositionManager} from "@uniswap/v4-periphery/src/PositionManager.sol";
import {IPositionDescriptor} from "@uniswap/v4-periphery/src/interfaces/IPositionDescriptor.sol";
import {IWETH9} from "@uniswap/v4-periphery/src/interfaces/external/IWETH9.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {MarketView, PoolKey} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {LaunchLocker} from "../../../src/v1/modules/LaunchLocker.sol";
import {LaunchLockerCompounding} from "../../../src/v1/shared/LaunchLockerCompounding.sol";
import {LaunchLockerToken} from "./LaunchLocker.t.sol";

/// Only the Permit2 allowance adapter is mocked; PoolManager and PositionManager execute real v4 actions.
contract CompoundPermit2 {
    mapping(address => mapping(address => mapping(address => uint160))) public allowance;

    function approve(address token, address spender, uint160 amount, uint48) external {
        allowance[msg.sender][token][spender] = amount;
    }

    function transferFrom(address from, address to, uint160 amount, address token) external {
        uint160 allowed = allowance[from][token][msg.sender];
        require(allowed >= amount, "permit allowance");
        allowance[from][token][msg.sender] = allowed - amount;
        require(IERC20(token).transferFrom(from, to, amount), "transfer");
    }
}

contract CompoundRegistry {
    address public graduationExecutor;
    MarketView private v;
    PoolKey private k;

    constructor(address executor, address c0, address c1) {
        graduationExecutor = executor;
        k = PoolKey(c0, c1, 0, 200, address(0));
        v.config.quoteAsset = c0;
        v.config.memeToken = c1;
    }

    function market(bytes32) external view returns (MarketView memory) {
        return v;
    }

    function canonicalPoolKey(bytes32) external view returns (PoolKey memory) {
        return k;
    }

    function canonicalPoolId(bytes32) external view returns (bytes32) {
        return keccak256(abi.encode(k));
    }

    function graduated() external {
        v.runtime.launchPhase = 1;
        v.runtime.poolId = keccak256(abi.encode(k));
    }
}

contract LaunchLockerCompoundingTest is Test {
    address public compoundKeeper = address(0xBEEF);
    bytes32 constant ID = keccak256("compound");
    PoolManager pool;
    PositionManager positions;
    CompoundPermit2 permit;
    PoolDonateTest donor;
    CompoundRegistry registry;
    LaunchLocker locker;
    V4Key key;
    address c0;
    address c1;
    uint128 constant INITIAL = 1000 ether;
    receive() external payable {}

    function _setup(bool nativeQuote) internal {
        vm.warp(1_800_000_000);
        vm.deal(address(this), 10000 ether);
        address a = address(new LaunchLockerToken("A"));
        address b = address(new LaunchLockerToken("B"));
        (c0, c1) = a < b ? (a, b) : (b, a);
        if (nativeQuote) c0 = address(0);
        pool = new PoolManager(address(this));
        permit = CompoundPermit2(_deployPermit2());
        positions = new PositionManager(
            pool, IAllowanceTransfer(address(permit)), 100000, IPositionDescriptor(address(1)), IWETH9(address(2))
        );
        donor = new PoolDonateTest(pool);
        registry = new CompoundRegistry(address(this), c0, c1);
        locker = new LaunchLocker(ID, address(registry), address(positions));
        key = V4Key(Currency.wrap(c0), Currency.wrap(c1), 0, 200, IHooks(address(0)));
        pool.initialize(key, uint160(1 << 96));
        _fund(c0);
        _fund(c1);
        bytes[] memory p = new bytes[](3);
        p[0] = abi.encode(
            key, int24(-887200), int24(887200), uint256(INITIAL), INITIAL, INITIAL, address(locker), bytes("")
        );
        p[1] = abi.encode(key.currency0, key.currency1);
        p[2] = abi.encode(key.currency0, address(this));
        positions.modifyLiquidities{value: nativeQuote ? INITIAL : 0}(
            abi.encode(
                abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR), uint8(Actions.SWEEP)), p
            ),
            block.timestamp
        );
        registry.graduated();
    }

    function _deployPermit2() internal virtual returns (address) {
        return address(new CompoundPermit2());
    }

    function _fund(address token) private {
        if (token == address(0)) return;
        LaunchLockerToken(token).mint(address(this), 10000 ether);
        IERC20(token).approve(address(permit), type(uint256).max);
        permit.approve(token, address(positions), type(uint160).max, type(uint48).max);
        IERC20(token).approve(address(donor), type(uint256).max);
    }

    function _fees(uint256 a, uint256 b) private {
        donor.donate{value: c0 == address(0) ? a : 0}(key, a, b, bytes(""));
    }

    function _balance(address token, address owner) private view returns (uint256) {
        return token == address(0) ? owner.balance : IERC20(token).balanceOf(owner);
    }

    function _compound() private {
        vm.prank(compoundKeeper);
        locker.compoundLockedFees(50 ether, 60 ether, 60 ether, block.timestamp + 60);
    }

    function test_realV4Erc20FeesCompoundAndDonationsRemainIsolated() public {
        _setup(false);
        LaunchLockerToken(c0).mint(address(locker), 777 ether);
        LaunchLockerToken(c1).mint(address(locker), 888 ether);
        _fees(100 ether, 100 ether);
        address stranger = address(0xA11CE);
        vm.prank(stranger);
        (uint256 collected0, uint256 collected1) = locker.collectLockedFees();
        assertApproxEqAbs(collected0, 100 ether, 1);
        assertApproxEqAbs(collected1, 100 ether, 1);
        assertEq(positions.getPositionLiquidity(1), INITIAL);
        _compound();
        (uint256 remaining0, uint256 remaining1) = locker.pendingCompoundFees();
        assertEq(positions.getPositionLiquidity(1), INITIAL + 50 ether);
        assertEq(positions.ownerOf(1), address(locker));
        assertEq(_balance(c0, address(locker)), 777 ether + remaining0);
        assertEq(_balance(c1, address(locker)), 888 ether + remaining1);
        assertEq(_balance(c0, compoundKeeper), 0);
        assertEq(_balance(c1, stranger), 0);
        assertEq(IERC20(c0).allowance(address(locker), address(permit)), 0);
        assertEq(permit.allowance(address(locker), c0, address(positions)), 0);
        assertEq(IERC20(c1).allowance(address(locker), address(permit)), 0);
        assertEq(permit.allowance(address(locker), c1, address(positions)), 0);
        (uint256 again0, uint256 again1) = locker.collectLockedFees();
        assertEq(again0, 0);
        assertEq(again1, 0);
    }

    function test_realV4NativeRefundAndAtomicCollectCompound() public {
        _setup(true);
        vm.deal(address(locker), 777 ether);
        _fees(100 ether, 100 ether);
        _compound();
        (uint256 remaining0,) = locker.pendingCompoundFees();
        assertEq(address(locker).balance, 777 ether + remaining0);
        assertEq(positions.getPositionLiquidity(1), INITIAL + 50 ether);
        assertEq(address(positions).balance, 0);
    }

    function test_failedSlippageRollsBackCollectionAndApprovalsThenRetrySucceeds() public {
        _setup(false);
        _fees(100 ether, 100 ether);
        vm.prank(compoundKeeper);
        vm.expectRevert();
        locker.compoundLockedFees(50 ether, 1, 1, block.timestamp + 60);
        (uint256 a, uint256 b) = locker.pendingCompoundFees();
        assertEq(a, 0);
        assertEq(b, 0);
        assertEq(_balance(c0, address(locker)), 0);
        assertEq(positions.getPositionLiquidity(1), INITIAL);
        assertEq(IERC20(c0).allowance(address(locker), address(permit)), 0);
        _compound();
        assertEq(positions.getPositionLiquidity(1), INITIAL + 50 ether);
    }

    function test_unpairedFeesRetainedCannotSpendDonations() public {
        _setup(false);
        _fees(100 ether, 0);
        LaunchLockerToken(c1).mint(address(locker), 100 ether);
        locker.collectLockedFees();
        vm.prank(compoundKeeper);
        vm.expectRevert(LaunchLockerCompounding.InvalidCompoundPlan.selector);
        locker.compoundLockedFees(50 ether, 60 ether, 60 ether, block.timestamp + 60);
        (, uint256 b) = locker.pendingCompoundFees();
        assertEq(b, 0);
        assertEq(_balance(c1, address(locker)), 100 ether);
        _fees(0, 100 ether);
        _compound();
        assertEq(positions.getPositionLiquidity(1), INITIAL + 50 ether);
    }

    function test_externalLossCannotConsumeIsolatedExcess() public {
        _setup(false);
        LaunchLockerToken(c0).mint(address(locker), 777 ether);
        _fees(100 ether, 100 ether);
        locker.collectLockedFees();
        deal(c0, address(locker), IERC20(c0).balanceOf(address(locker)) - 1);
        vm.prank(compoundKeeper);
        vm.expectRevert(LaunchLockerCompounding.CompoundBalanceMismatch.selector);
        locker.compoundLockedFees(50 ether, 60 ether, 60 ether, block.timestamp + 60);
        assertEq(positions.getPositionLiquidity(1), INITIAL);
    }

    function test_unauthorizedDisabledKeeperAndExpiredPlans() public {
        _setup(false);
        _fees(100 ether, 100 ether);
        vm.expectRevert(LaunchLockerCompounding.UnauthorizedCompoundKeeper.selector);
        locker.compoundLockedFees(50 ether, 60 ether, 60 ether, block.timestamp + 60);
        vm.prank(compoundKeeper);
        vm.expectRevert(LaunchLockerCompounding.InvalidCompoundPlan.selector);
        locker.compoundLockedFees(50 ether, 60 ether, 60 ether, block.timestamp - 1);
        vm.prank(compoundKeeper);
        vm.expectRevert(LaunchLockerCompounding.InvalidCompoundPlan.selector);
        locker.compoundLockedFees(50 ether, 60 ether, 60 ether, block.timestamp + 301);
        address old = compoundKeeper;
        compoundKeeper = address(0);
        vm.prank(old);
        vm.expectRevert(LaunchLockerCompounding.UnauthorizedCompoundKeeper.selector);
        locker.compoundLockedFees(50 ether, 60 ether, 60 ether, block.timestamp + 60);
        locker.collectLockedFees();
        assertEq(positions.getPositionLiquidity(1), INITIAL);
    }
}
