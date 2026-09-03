// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {StockTokenFingerprint} from "../../../src/v1/interfaces/IV1Protocol.sol";

library StockTokenFingerprintTestLib {
    function direct(address token) internal view returns (StockTokenFingerprint memory) {
        bytes32 runtimeCodeHash = token.codehash;
        return StockTokenFingerprint({
            tokenRuntimeCodeHash: runtimeCodeHash,
            beacon: address(0),
            beaconRuntimeCodeHash: bytes32(0),
            implementation: token,
            implementationRuntimeCodeHash: runtimeCodeHash
        });
    }

    function beacon(address token, address beaconAddress, address implementation)
        internal
        view
        returns (StockTokenFingerprint memory)
    {
        return StockTokenFingerprint({
            tokenRuntimeCodeHash: token.codehash,
            beacon: beaconAddress,
            beaconRuntimeCodeHash: beaconAddress.codehash,
            implementation: implementation,
            implementationRuntimeCodeHash: implementation.codehash
        });
    }
}
