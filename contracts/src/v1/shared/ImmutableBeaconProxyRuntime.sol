// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Closed set of complete BeaconProxy programs, not a byte-pattern detector.
/// @dev Templates and provenance: spec/v1_beacon_proxy_templates.json. Both programs perform
///      STATICCALL implementation() on the immutable word at byte 29, then DELEGATECALL only
///      that result. Every other byte (including metadata) is pinned. Supporting another compiler
///      or proxy variant requires code review and a new deployment, not administrator approval.
library ImmutableBeaconProxyRuntime {
    bytes32 internal constant LOCAL_TEMPLATE = 0xe345c31e3aa53d450cab1ce4b7b8d944201a0d7c88ec989604ae9ddffccb8c2b;
    bytes32 internal constant RH_TEMPLATE = 0xcc20afa74ce45ef50184f03d81a5bfd1fe23d087f97a8fd3dc5403155a003d23;
    bytes32 internal constant RH_TESTNET_TEMPLATE = 0x03b31ff7bb8349c8d21fe83180506f2319281b960b29ad548c6445948df7b2d3;

    function beacon(bytes memory runtime) internal pure returns (address) {
        if (runtime.length != 229 && runtime.length != 283) return address(0);
        uint256 word;
        assembly ("memory-safe") {
            word := mload(add(runtime, 61)) // bytes header + immutable word offset (32 + 29)
            mstore(add(runtime, 61), 0)
        }
        bytes32 normalizedHash = keccak256(runtime);
        // Do not mutate the caller's copy.
        assembly ("memory-safe") { mstore(add(runtime, 61), word) }
        if (word == 0 || word > type(uint160).max) return address(0);
        if (normalizedHash != LOCAL_TEMPLATE && normalizedHash != RH_TEMPLATE && normalizedHash != RH_TESTNET_TEMPLATE)
        {
            return address(0);
        }
        return address(uint160(word));
    }
}
