// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Test} from "forge-std/Test.sol";
import {CanonicalBlockClock, ICanonicalArbSys} from "../../../src/v1/libraries/CanonicalBlockClock.sol";
contract ClockHarness {
    function number() external view returns(uint256) { return CanonicalBlockClock.number(); }
    function hash(uint256 h) external view returns(bytes32) { return CanonicalBlockClock.hash(h); }
}
contract CanonicalBlockClockTest is Test {
    ClockHarness clock;
    function setUp() public {clock=new ClockHarness();}
    function test_nativeEvmUsesEvmReceiptDomain() public {
        vm.chainId(31337);vm.roll(100);vm.setBlockhash(98,bytes32(uint256(321)));
        assertEq(clock.number(),100);assertEq(clock.hash(98),bytes32(uint256(321)));
    }
    function test_nitroUsesL2InsteadOfParentHeight() public {
        uint256[4] memory ids=[uint256(421614),42161,4663,46630];
        for(uint256 i;i<ids.length;i++){
            vm.chainId(ids[i]);vm.roll(12345);
            vm.mockCall(address(100),abi.encodeCall(ICanonicalArbSys.arbBlockNumber,()),abi.encode(uint256(300000000)));
            vm.mockCall(address(100),abi.encodeCall(ICanonicalArbSys.arbBlockHash,(299999998)),abi.encode(bytes32(uint256(987))));
            assertEq(clock.number(),300000000);assertEq(clock.hash(299999998),bytes32(uint256(987)));
        }
    }
    function test_missingNitroPrecompileNeverFallsBackToWrongDomain() public {
        vm.chainId(421614);vm.etch(address(100),hex"");vm.expectRevert();clock.number();
    }
    function test_revertingNitroHashNeverFallsBackToParentHash() public {
        vm.chainId(4663);vm.roll(100);vm.setBlockhash(98,bytes32(uint256(321)));
        vm.mockCallRevert(address(100),abi.encodeCall(ICanonicalArbSys.arbBlockHash,(98)),hex"deadbeef");
        vm.expectRevert(bytes4(0xdeadbeef));clock.hash(98);
    }
}
