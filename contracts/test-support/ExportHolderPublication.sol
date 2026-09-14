// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {HolderSnapshotRewardsTest} from "../test/v1/treasury/product/HolderSnapshotRewards.t.sol";

contract LocalPublicationClock {
    function arbBlockNumber() external view returns(uint256) { return block.number; }
    function arbBlockHash(uint256 n) external view returns(bytes32) { return blockhash(n); }
}
/// Local imported-state fixture only. Distributor/Token/AccessManager are real;
/// Registry/Vault/Hook/clock are test dependencies. Never broadcast this exporter.
contract ExportHolderPublicationHarness is HolderSnapshotRewardsTest {
    function exportState() external {
        require(block.chainid==31337,"LOCAL_EXPORT_ONLY");
        setUp();
        _fund(1 ether,0);
        r.setSnapshotPublisher(vm.addr(1));
        vm.deal(vm.addr(1),100 ether);
        vm.etch(address(100),address(new LocalPublicationClock()).code);
        string memory obj="holder";
        vm.serializeAddress(obj,"distributor",address(r));
        vm.serializeAddress(obj,"token",address(token));
        vm.serializeAddress(obj,"alice",ALICE);
        vm.serializeAddress(obj,"curve",CURVE);
        string memory data=vm.serializeBytes32(obj,"marketId",ID);
        string memory output=vm.envString("TG_PUBLICATION_EXPORT_DIR");
        vm.writeJson(data,string.concat(output,"/addresses.json"));
        vm.dumpState(string.concat(output,"/alloc.json"));
    }
}
contract ExportHolderPublicationScript {
    function run() external { new ExportHolderPublicationHarness().exportState(); }
}
