// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {HolderPoolFlowTest} from "../shared/HolderPoolFlow.t.sol";
import {InvariantOfficialStockRegistry} from "../product/VaultGaugeInvariant.t.sol";
import {AllocationManager} from "../../../src/v1/modules/AllocationManager.sol";
import {UserStockVault} from "../../../src/v1/modules/UserStockVault.sol";
import {MemeStockGauge} from "../../../src/v1/modules/MemeStockGauge.sol";
import {MemeStockGaugeClone} from "../../../src/v1/shared/MemeStockGaugeClone.sol";
import {MockExactQuoteToken} from "../mocks/MockV1QuoteAssets.sol";
import {GaugeIdentity, MarketView} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";

/// @dev Fault injection: zero-valued bytes are not evidence of a successful uint256 return.
contract ReviewWeightProbeFault {
    uint256 private immutable _mode;

    constructor(uint256 mode) {
        _mode = mode;
    }

    function effectiveTotalActiveStock() external view returns (uint256) {
        uint256 mode = _mode;
        assembly ("memory-safe") {
            mstore(0, 0)
            switch mode
            case 0 { return(0, 0) }
            case 1 { return(0, 31) }
            case 2 {
                mstore(32, 0)
                return(0, 64)
            }
            case 3 { revert(0, 32) }
            default { invalid() }
        }
    }
}

/// @notice Review coverage for both real reward ledgers, beyond a mocked aggregate-weight source.
/// @dev Registry configuration and the Stock token are fixtures. Runtime PoolManager, Hook, FeeVault,
///      Gauge, AllocationManager and UserStockVault execute their production implementations.
contract Review20260914RewardGasTest is HolderPoolFlowTest {
    bytes32 private constant STOCK_UID = keccak256("review-20260914-stock");
    InvariantOfficialStockRegistry private stocks;
    AllocationManager private allocation;
    UserStockVault private stockVault;
    MockExactQuoteToken private stock;
    MemeStockGauge private gauge;
    MemeStockGauge private implementation;

    function _bindRealAccounting() private {
        stocks = new InvariantOfficialStockRegistry();
        allocation = new AllocationManager(address(stocks), address(registry));
        stockVault = new UserStockVault(address(stocks), address(registry), address(allocation));
        stock = new MockExactQuoteToken(18);
        stocks.configure(STOCK_UID, address(stock), address(stockVault), 18, 1, 0.5 ether);
        implementation = new MemeStockGauge();
        gauge = MemeStockGauge(
            MemeStockGaugeClone.deployDeterministic(
                address(implementation),
                keccak256("review-real-accounting"),
                GaugeIdentity(
                    ID,
                    STOCK_UID,
                    bytes32(uint256(2)),
                    address(allocation),
                    address(vault),
                    address(quote),
                    address(meme)
                )
            )
        );
        MarketView memory v = registry.market(ID);
        v.config.assetUid = STOCK_UID;
        v.config.gauge = address(gauge);
        v.config.stakingEnabled = true;
        registry.set(v, registry.canonicalPoolKey(ID));
    }

    function _stake(address user) private {
        stock.mint(user, 1 ether);
        vm.startPrank(user);
        stock.approve(address(stockVault), 1 ether);
        allocation.stake(ID, 1 ether);
        vm.stopPrank();
    }

    function _coolAccounting() private {
        vm.cool(address(stocks));
        vm.cool(address(allocation));
        vm.cool(address(stockVault));
        vm.cool(address(gauge));
        vm.cool(address(implementation));
        vm.cool(address(registry));
        vm.cool(address(vault));
        vm.cool(address(manager));
        vm.cool(HOOK);
    }

    function reviewSell() external {
        _sell();
    }

    function testReview_realLedgersEmptyStakeFitsOneMillionGas() public {
        _bindRealAccounting();
        _coolAccounting();
        (bool ok,) = address(this).call{gas: 1_000_000}(abi.encodeCall(this.reviewSell, ()));
        assertTrue(ok, "real empty accounting path must use lightweight branch");
        assertEq(vault.forfeitureReserve(ID, address(quote)), 0);
    }

    function testReview_invalidProbeCannotMasqueradeAsZeroWeight() public {
        MarketView memory value = registry.market(ID);
        value.config.stakingEnabled = true;
        for (uint256 mode; mode < 5; ++mode) {
            value.config.gauge = address(new ReviewWeightProbeFault(mode));
            registry.set(value, registry.canonicalPoolKey(ID));
            uint256 beforeLiability = vault.totalLiability(address(quote));
            uint256 beforeMeme = meme.balanceOf(ALICE);
            uint256 beforeReserve = vault.forfeitureReserve(ID, address(quote));
            (bool ok,) = address(this).call{gas: 1_000_000}(abi.encodeCall(this.reviewSell, ()));
            assertFalse(ok, "malformed, reverted and gas-exhausted probes require funded fallback");
            assertEq(vault.totalLiability(address(quote)), beforeLiability);
            assertEq(meme.balanceOf(ALICE), beforeMeme);
            assertEq(vault.forfeitureReserve(ID, address(quote)), beforeReserve);
            (ok,) = address(this).call{gas: 8_000_000}(abi.encodeCall(this.reviewSell, ()));
            assertTrue(ok, "bounded funded fallback contains the fault without blocking trade");
            assertGt(vault.totalLiability(address(quote)), beforeLiability);
            if (mode == 2) {
                // Ordinary ABI decoding accepts a complete uint256 plus trailing bytes.
                // The strict optimization rejects it, but the full settlement still proves zero.
                assertEq(vault.forfeitureReserve(ID, address(quote)), beforeReserve);
            } else {
                assertGt(vault.forfeitureReserve(ID, address(quote)), beforeReserve);
            }
        }
    }

    function testReview_realLedgersThirtyFutureBucketsFitOneMillionGas() public {
        _bindRealAccounting();
        uint256 origin = block.timestamp;
        for (uint256 i; i < 30; ++i) {
            vm.warp(origin + i);
            _stake(address(uint160(0x9000 + i)));
        }
        _assertFutureBucketsFitOneMillionGas(30);
    }

    function testReview_firstActivationCannotUseZeroWeightShortcut() public {
        _bindRealAccounting();
        _stake(address(0x9000));
        vm.warp(block.timestamp + 29);
        _assertFutureBucketsFitOneMillionGas(1);
        vm.warp(block.timestamp + 1);
        assertEq(stockVault.marketRewardEligible(STOCK_UID, ID), 1 ether);
        uint256 beforeLiability = vault.totalLiability(address(quote));
        uint256 beforeMeme = meme.balanceOf(ALICE);
        _coolAccounting();
        (bool ok,) = address(this).call{gas: 1_000_000}(abi.encodeCall(this.reviewSell, ()));
        assertFalse(ok, "the first mature bucket requires the protected reward write budget");
        assertEq(vault.totalLiability(address(quote)), beforeLiability);
        assertEq(meme.balanceOf(ALICE), beforeMeme);
        assertEq(vault.forfeitureReserve(ID, address(quote)), 0);
        _coolAccounting();
        (ok,) = address(this).call{gas: 8_000_000}(abi.encodeCall(this.reviewSell, ()));
        assertTrue(ok);
        assertGt(vault.liability(ID, address(quote), 1), 0);
        assertEq(vault.forfeitureReserve(ID, address(quote)), 0);
    }

    function testFuzzReview_futureBucketsFitOneMillionGas(uint8 bucketCount) public {
        uint256 count = bound(uint256(bucketCount), 1, 30);
        _bindRealAccounting();
        uint256 origin = block.timestamp;
        for (uint256 i; i < count; ++i) {
            vm.warp(origin + i);
            _stake(address(uint160(0x9000 + i)));
        }
        _assertFutureBucketsFitOneMillionGas(count);
    }

    function _assertFutureBucketsFitOneMillionGas(uint256 count) private {
        assertEq(stockVault.marketRewardEligible(STOCK_UID, ID), 0);
        uint256 beforeLiability = vault.totalLiability(address(quote));
        _coolAccounting();
        uint256 beforeGas = gasleft();
        (bool ok,) = address(this).call{gas: 1_000_000}(abi.encodeCall(this.reviewSell, ()));
        emit log_named_uint("real-accounting-future-buckets-swap-call-gas", beforeGas - gasleft());
        assertTrue(ok, "cold future buckets must use the lightweight zero-weight path");
        assertGt(vault.totalLiability(address(quote)), beforeLiability);
        assertEq(vault.liability(ID, address(quote), 1), 0);
        assertEq(gauge.totalPendingStock(), count * 1 ether);
        assertEq(vault.forfeitureReserve(ID, address(quote)), 0);
        // Repeated swaps must not activate future buckets or alter fee ownership.
        (ok,) = address(this).call{gas: 1_000_000}(abi.encodeCall(this.reviewSell, ()));
        assertTrue(ok, "warm zero-weight path also fits");
        assertEq(vault.liability(ID, address(quote), 1), 0);
        assertEq(gauge.totalPendingStock(), count * 1 ether);
        assertEq(vault.forfeitureReserve(ID, address(quote)), 0);
    }

    function testReview_realLedgersThirtyMatureBucketsPreserveStakerFees() public {
        _bindRealAccounting();
        _stake(address(0x8000));
        vm.warp(block.timestamp + 30);
        _sell();
        quote.mint(ALICE, 1 ether);
        vm.prank(ALICE);
        quote.approve(address(router), type(uint256).max);
        bool direction = Currency.unwrap(key.currency0) == address(quote);
        vm.prank(ALICE);
        router.swap(
            key,
            SwapParams(
                direction, -int256(0.0001 ether), direction ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            ),
            PoolSwapTest.TestSettings(false, false),
            ""
        );
        assertGt(gauge.rewardState(address(quote)).accFeePerShare, 0);
        assertGt(gauge.rewardState(address(meme)).accFeePerShare, 0);
        uint256 origin = block.timestamp;
        for (uint256 i; i < 30; ++i) {
            vm.warp(origin + i);
            _stake(address(uint160(0x9000 + i)));
        }
        vm.warp(origin + 59);
        assertEq(stockVault.marketRewardEligible(STOCK_UID, ID), 31 ether);
        uint256 liabilityBefore = vault.liability(ID, address(quote), 1);
        _coolAccounting();
        uint256 beforeGas = gasleft();
        (bool ok,) = address(this).call{gas: 8_000_000}(abi.encodeCall(this.reviewSell, ()));
        emit log_named_uint("real-accounting-thirty-bucket-swap-call-gas", beforeGas - gasleft());
        assertTrue(ok, "complete swap must succeed");
        assertEq(gauge.totalPendingStock(), 0, "all matured snapshots must be processed");
        assertEq(gauge.storedTotalActiveStock(), 31 ether);
        assertGt(vault.liability(ID, address(quote), 1), liabilityBefore);
        assertEq(vault.forfeitureReserve(ID, address(quote)), 0, "healthy new rewards cannot be abandoned");
        assertEq(vault.forfeitureReserve(ID, address(meme)), 0);
    }
}
