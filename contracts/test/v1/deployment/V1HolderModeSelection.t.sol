// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Test} from "forge-std/Test.sol";
import {V1HolderModeSelection} from "../../../script/v1/V1HolderModeSelection.sol";

contract HolderModeSelectionHarness {
    function validate(string memory mode, bool continuous) external pure {
        V1HolderModeSelection.validate(mode, continuous);
    }
}

contract V1HolderModeSelectionTest is Test {
    function test_onlyCurrentModeAccepted() public {
        HolderModeSelectionHarness h = new HolderModeSelectionHarness();
        h.validate("dual-asset-24h-v4", true);
        bytes memory expected =
            abi.encodeWithSelector(V1HolderModeSelection.HolderModeSelectionRequired.selector, "dual-asset-24h-v4");
        vm.expectRevert(expected);
        h.validate("", true);
        vm.expectRevert(expected);
        h.validate("legacy-merkle-7d-v1", true);
        vm.expectRevert(expected);
        h.validate("dual-asset-24h-v4", false);
    }
}
