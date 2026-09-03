// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice One CREATE2 prediction and deployment implementation shared by Factory and GraduationExecutor.
library V2Create2 {
    error Create2AddressCollision(address predicted);
    error Create2DeploymentFailed(address predicted, bytes32 salt, bytes32 initCodeHash);

    function initCodeHash(bytes memory creationCode, bytes memory constructorArgs) internal pure returns (bytes32) {
        return keccak256(bytes.concat(creationCode, constructorArgs));
    }

    function predict(address deployer, bytes32 salt, bytes32 initCodeHash_) internal pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, initCodeHash_)))));
    }

    function deploy(bytes32 salt, bytes memory initCode) internal returns (address deployed) {
        bytes32 initCodeHash_ = keccak256(initCode);
        address predicted = predict(address(this), salt, initCodeHash_);
        if (predicted.code.length != 0) revert Create2AddressCollision(predicted);

        assembly ("memory-safe") {
            deployed := create2(0, add(initCode, 0x20), mload(initCode), salt)
        }
        if (deployed == address(0) || deployed != predicted || deployed.code.length == 0) {
            revert Create2DeploymentFailed(predicted, salt, initCodeHash_);
        }
    }
}
