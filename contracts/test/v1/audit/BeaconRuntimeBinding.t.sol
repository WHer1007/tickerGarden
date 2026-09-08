// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import {UpgradeableBeacon} from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import {OfficialStockRegistryV1} from "../../../src/v1/modules/OfficialStockRegistryV1.sol";
import {ImmutableBeaconProxyRuntime} from "../../../src/v1/shared/ImmutableBeaconProxyRuntime.sol";
import {StockTokenFingerprint} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {AuditDelegateTarget} from "./Audit20260905.t.sol";
import {
    MockUserStockVaultIdentity,
    EmptyV1Contract,
    MockBeaconStockTokenLogic,
    MockBeaconStockTokenLogicV2
} from "../product/OfficialStockRegistryV1.t.sol";

contract BeaconRuntimeBindingTest is Test {
    OfficialStockRegistryV1 registry;
    address vault;

    function setUp() public {
        registry = new OfficialStockRegistryV1(address(new AccessManager(address(this))));
        vault = address(
            new MockUserStockVaultIdentity(
                address(registry),
                address(new EmptyV1Contract()),
                address(new EmptyV1Contract()),
                keccak256("review-schema")
            )
        );
    }

    function _fingerprint(address proxy, address beacon, address implementation)
        private
        view
        returns (StockTokenFingerprint memory)
    {
        return StockTokenFingerprint(proxy.codehash, beacon, beacon.codehash, implementation, implementation.codehash);
    }

    function test_rejectDecoyBeaconWithApprovedHashAndMatchingStorage() public {
        AuditDelegateTarget first = new AuditDelegateTarget(1);
        UpgradeableBeacon beacon = new UpgradeableBeacon(address(first), address(this));
        address proxy = address(0xCA19);
        vm.etch(
            proxy,
            abi.encodePacked(
                hex"365f5f375f5f365f5f545af43d5f5f3e3d5ff3",
                hex"7f",
                bytes32(uint256(uint160(address(beacon)))),
                hex"6001600160a01b0316635c60da1b"
            )
        );
        vm.store(proxy, bytes32(0), bytes32(uint256(uint160(address(first)))));
        vm.store(
            proxy, bytes32(uint256(keccak256("eip1967.proxy.beacon")) - 1), bytes32(uint256(uint160(address(beacon))))
        );
        StockTokenFingerprint memory fingerprint = _fingerprint(proxy, address(beacon), address(first));
        vm.expectRevert(
            abi.encodeWithSelector(
                OfficialStockRegistryV1.UnsupportedStockTokenProxy.selector, proxy, address(beacon), address(0)
            )
        );
        registry.registerAsset(keccak256("audit-asset"), proxy, 18, vault, 414, fingerprint);
    }

    function _template(uint256 index, address beacon) private view returns (bytes memory runtime) {
        string memory json = vm.readFile("../spec/v1_beacon_proxy_templates.json");
        runtime = vm.parseJsonBytes(json, string.concat(".templates[", vm.toString(index), "].normalizedRuntime"));
        assembly ("memory-safe") { mstore(add(runtime, 61), beacon) }
    }

    function test_observedRhTemplateDispatchesToMonitoredBeaconAndDetectsUpgrade() public {
        MockBeaconStockTokenLogic first = new MockBeaconStockTokenLogic();
        UpgradeableBeacon beacon = new UpgradeableBeacon(address(first), address(this));
        address proxy = address(0xCA20);
        vm.etch(proxy, _template(1, address(beacon)));
        bytes32 uid = keccak256("rh-template");
        MockBeaconStockTokenLogic(proxy).initialize(uid, 18);
        registry.registerAsset(uid, proxy, 18, vault, 414, _fingerprint(proxy, address(beacon), address(first)));
        assertTrue(registry.assetIdentityCurrent(uid));
        beacon.upgradeTo(address(new MockBeaconStockTokenLogicV2()));
        assertEq(MockBeaconStockTokenLogicV2(proxy).version(), 2);
        assertFalse(registry.assetIdentityCurrent(uid));
    }

    function test_observedTemplateMatchesPreviouslyPinnedOfficialRuntime() public view {
        bytes memory runtime = _template(1, 0xe10b6f6B275de231345c20D14Ab812db62151b00);
        assertEq(keccak256(runtime), 0x6c1fdd40002dcb440c7fff6a84171404d279ccb057803b65826f7546acd65630);
    }

    function test_observedRobinhoodTestnetTemplateDispatchesToMonitoredBeacon() public view {
        address beacon = 0x1dF3cA0fD30ED5eeb09eB01938f4E9c5196E6Ca5;
        bytes memory runtime = _template(2, beacon);
        assertEq(keccak256(runtime), 0x2f367e6a678e7b30ab613d5963e541e6f4d3ca586de76e2f441fbfeb1a27c440);
        assertEq(ImmutableBeaconProxyRuntime.beacon(runtime), beacon);
    }

    function test_rejectAppendedCodeAndPushDataDecoys() public view {
        bytes memory runtime = _template(0, address(0xBEEF));
        assertEq(ImmutableBeaconProxyRuntime.beacon(abi.encodePacked(runtime, hex"00")), address(0));
        assertEq(ImmutableBeaconProxyRuntime.beacon(abi.encodePacked(hex"7f", runtime)), address(0));
    }

    function testFuzz_anyNonAddressByteMutationFailsClosed(uint8 which, uint256 offset, uint8 xorMask) public view {
        bytes memory runtime = _template(which % 3, address(0xBEEF));
        offset = bound(offset, 0, runtime.length - 1);
        vm.assume(offset < 41 || offset > 60);
        xorMask = uint8(bound(xorMask, 1, 255));
        assertEq(ImmutableBeaconProxyRuntime.beacon(runtime), address(0xBEEF));
        runtime[offset] = bytes1(uint8(runtime[offset]) ^ xorMask);
        assertEq(ImmutableBeaconProxyRuntime.beacon(runtime), address(0));
    }
}
