// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {HolderPoolFlowTest} from "../shared/HolderPoolFlow.t.sol";
import {CapacityAllocationMock} from "./CurrentContractOptimizationBoundary.t.sol";
import {MemeStockGauge} from "../../../src/v1/modules/MemeStockGauge.sol";
import {MemeStockGaugeClone} from "../../../src/v1/shared/MemeStockGaugeClone.sol";
import {MarketView, GaugeIdentity} from "../../../src/v1/interfaces/IV1Protocol.sol";

/// @notice Execution-interval measurements, not transaction receipts or RH data fees.
/// Registry, tokens and allocation weight source are fixture mocks; PoolManager and Gauge are real.
contract ContractCostBaselineTest is HolderPoolFlowTest {
    function _coolCommon() private {
        vm.cool(address(router));
        vm.cool(address(manager));
        vm.cool(HOOK);
        vm.cool(address(vault));
        vm.cool(address(registry));
        vm.cool(address(meme));
        vm.cool(address(quote));
    }

    function testCost_noStakingSwap() public {
        _coolCommon();
        uint256 used = _sell();
        Vm.Gas memory last = vm.lastCallGas();
        emit log_named_uint("no-staking-swap-interval", used);
        emit log_named_uint("swap-last-call-total", last.gasTotalUsed);
        emit log_named_int("swap-last-call-refund", last.gasRefunded);
    }

    function testCost_activeStakingNoPendingSwap() public {
        CapacityAllocationMock allocation = new CapacityAllocationMock();
        MemeStockGauge implementation = new MemeStockGauge();
        MemeStockGauge gauge = MemeStockGauge(MemeStockGaugeClone.deployDeterministic(
            address(implementation), keccak256("cost-baseline"),
            GaugeIdentity(ID, bytes32(uint256(1)), bytes32(uint256(2)), address(allocation),
                address(vault), address(quote), address(meme))
        ));
        MarketView memory value = registry.market(ID);
        value.config.stakingEnabled = true;
        value.config.gauge = address(gauge);
        registry.set(value, registry.canonicalPoolKey(ID));
        vm.prank(address(allocation));
        gauge.addPending(address(0x8000), 1 ether, uint64(block.timestamp + 30), uint64(block.timestamp + 1 days));
        vm.warp(block.timestamp + 30);
        gauge.checkpointActivations();
        assertEq(gauge.totalPendingStock(), 0);
        assertEq(gauge.storedTotalActiveStock(), 1 ether);
        _coolCommon();
        vm.cool(address(allocation));
        vm.cool(address(gauge));
        vm.cool(address(implementation));
        uint256 used = _sell();
        Vm.Gas memory last = vm.lastCallGas();
        emit log_named_uint("active-staking-no-pending-swap-interval", used);
        emit log_named_uint("swap-last-call-total", last.gasTotalUsed);
        emit log_named_int("swap-last-call-refund", last.gasRefunded);
        assertEq(vault.forfeitureReserve(ID, address(quote)), 0);
        assertGt(vault.liability(ID, address(quote), 1), 0);
    }
}
