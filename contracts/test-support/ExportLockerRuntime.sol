// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {LaunchLockerCompoundingTest} from "../test/v1/product/LaunchLockerCompounding.t.sol";

contract LocalLockerExecutorView {
    address public immutable compoundKeeper;
    address public immutable positionManager;
    address public immutable poolManager;
    address private immutable locker;
    constructor(address keeper, address positions, address pool, address locked) {
        compoundKeeper=keeper; positionManager=positions; poolManager=pool; locker=locked;
    }
    function predictLaunchLocker(bytes32) external view returns(address) { return locker; }
}

/// Local test-state exporter only: real Locker/PoolManager/PositionManager; fixture
/// Registry/Executor/Permit2/tokens. Never broadcast this script to an external chain.
contract ExportLockerRuntime is LaunchLockerCompoundingTest {
    function positionManager() external view returns (address) { return address(positions); }
    function poolManager() external view returns (address) { return address(pool); }
    function predictLaunchLocker(bytes32 id) external view returns (address) {
        require(id == ID); return address(locker);
    }
    function exportState() external {
        require(block.chainid == 31337, "LOCAL_ONLY");
        _setup(false, 2000);
        compoundKeeper = vm.addr(1);
        vm.deal(compoundKeeper, 100 ether);
        donor.donate(key, 1 ether, 2 ether, bytes(""));
        string memory obj = "locker";
        vm.serializeAddress(obj, "keeper", compoundKeeper);
        vm.serializeAddress(obj, "locker", address(locker));
        vm.serializeAddress(obj, "registry", address(registry));
        vm.serializeAddress(obj, "executor", address(this));
        vm.serializeAddress(obj, "positionManager", address(positions));
        vm.serializeAddress(obj, "poolManager", address(pool));
        address viewOnly = address(new LocalLockerExecutorView(compoundKeeper, address(positions), address(pool), address(locker)));
        vm.serializeBytes(obj, "executorCode", viewOnly.code);
        string memory data = vm.serializeBytes32(obj, "marketId", ID);
        string memory output = vm.envString("TG_LOCKER_EXPORT_DIR");
        vm.writeJson(data, string.concat(output, "/addresses.json"));
        vm.dumpState(string.concat(output, "/alloc.json"));
    }
}

contract ExportLockerRuntimeScript {
    function run() external { new ExportLockerRuntime().exportState(); }
}
