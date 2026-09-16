// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {HolderPoolFlowTest} from "../shared/HolderPoolFlow.t.sol";
import {CapacityAllocationMock} from "./CurrentContractOptimizationBoundary.t.sol";
import {MemeStockGauge} from "../../../src/v1/modules/MemeStockGauge.sol";
import {MemeStockGaugeClone} from "../../../src/v1/shared/MemeStockGaugeClone.sol";
import {MarketView, GaugeIdentity} from "../../../src/v1/interfaces/IV1Protocol.sol";

/// @notice Real PoolManager/Hook/FeeVault/Gauge, fixture registry and allocation weight.
/// Verifies the empty-weight optimization without weakening the active-stake boundary.
contract LatestBusinessCompletenessTest is HolderPoolFlowTest {
    function auditSell() external { _sell(); }

    function testReview_emptyStakingUsesBoundedLightweightProbe() public {
        (bool withoutStaking,) = address(this).call{gas: 1_000_000}(abi.encodeCall(this.auditSell, ()));
        assertTrue(withoutStaking, "control swap fits one million gas");

        CapacityAllocationMock allocation = new CapacityAllocationMock();
        allocation.setActive(0);
        MemeStockGauge implementation = new MemeStockGauge();
        MemeStockGauge gauge = MemeStockGauge(MemeStockGaugeClone.deployDeterministic(
            address(implementation), keccak256("business-review-empty-gauge"),
            GaugeIdentity(ID, bytes32(uint256(1)), bytes32(uint256(2)), address(allocation),
                address(vault), address(quote), address(meme))
        ));
        MarketView memory value = registry.market(ID);
        value.config.stakingEnabled = true;
        value.config.gauge = address(gauge);
        registry.set(value, registry.canonicalPoolKey(ID));
        assertEq(gauge.effectiveTotalActiveStock(), 0);
        uint256 liabilityBefore = vault.totalLiability(address(quote));
        (bool lowLimit,) = address(this).call{gas: 1_000_000}(abi.encodeCall(this.auditSell, ()));
        assertTrue(lowLimit, "empty staking fits ordinary gas limit");
        assertGt(vault.totalLiability(address(quote)), liabilityBefore);
        (bool sufficientLimit,) = address(this).call{gas: 8_000_000}(abi.encodeCall(this.auditSell, ()));
        assertTrue(sufficientLimit, "sufficient gas limit restores ordinary swap");
        assertGt(vault.totalLiability(address(quote)), liabilityBefore);
        assertEq(vault.forfeitureReserve(ID, address(quote)), 0);
    }
}
