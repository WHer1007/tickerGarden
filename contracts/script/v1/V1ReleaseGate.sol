// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";

/// @notice Local release certificate gate for the official broadcast entrypoint.
/// @dev A certificate is operator-reviewed evidence, not an onchain upgrade or administrator permission.
abstract contract V1ReleaseGate is Script {
    error ReleaseNotEligible();
    error InvalidReleaseCertificate();
    error ReleaseArtifactDrift();
    error ReleasePayloadDrift();

    struct ReleaseCertificate {
        uint256 chainId;
        address deployer;
        bytes32 releaseId;
        bytes32 payloadHash;
    }

    function _releaseInput(string memory path) internal view virtual returns (string memory) {
        return vm.readFile(path);
    }

    function _assertReleaseEligibility() internal view returns (ReleaseCertificate memory certificate) {
        string memory manifest = _releaseInput("../spec/v1_execution_manifest.json");
        bytes32 state = keccak256(bytes(vm.parseJsonString(manifest, ".readiness.state")));
        if (
            (state != keccak256("DEPLOYMENT_ELIGIBLE") && state != keccak256("PRODUCTION_READY"))
                || keccak256(bytes(vm.parseJsonString(manifest, ".status"))) != state
                || !vm.parseJsonBool(manifest, ".readiness.deploymentEligible")
                || !vm.parseJsonBool(manifest, ".readiness.implementationAllowed")
                || vm.parseJsonStringArray(manifest, ".readiness.gateSets.implementation.open").length != 0
                || vm.parseJsonStringArray(manifest, ".readiness.gateSets.deployment.open").length != 0
        ) revert ReleaseNotEligible();

        string memory evidence = _releaseInput("../deployments/evidence/v1-current-release.json");
        if (
            keccak256(bytes(vm.parseJsonString(evidence, ".status"))) != keccak256("VERIFIED")
                || vm.parseJsonUint(evidence, ".schemaVersion") != 1
                || vm.parseJsonUint(evidence, ".verifiedAt") > block.timestamp
                || vm.parseJsonUint(evidence, ".expiresAt") < block.timestamp
                || vm.parseJsonUint(evidence, ".expiresAt") > vm.parseJsonUint(evidence, ".verifiedAt") + 1 days
                || keccak256(bytes(vm.parseJsonString(evidence, ".executionSpecId")))
                    != keccak256(bytes(vm.parseJsonString(manifest, ".executionSpecId")))
        ) revert InvalidReleaseCertificate();
        if (
            vm.parseJsonBytes32(evidence, ".executionManifestSha256") != sha256(bytes(manifest))
                || vm.parseJsonBytes32(evidence, ".productArtifactManifestSha256")
                    != sha256(bytes(_releaseInput("../spec/v1_product_artifact_manifest.json")))
                || vm.parseJsonBytes32(evidence, ".compiledInterfaceManifestSha256")
                    != sha256(bytes(_releaseInput("../spec/v1_compiled_interface_manifest.json")))
        ) revert ReleaseArtifactDrift();
        certificate = ReleaseCertificate({
            chainId: vm.parseJsonUint(evidence, ".chainId"),
            deployer: vm.parseJsonAddress(evidence, ".deployer"),
            releaseId: vm.parseJsonBytes32(evidence, ".releaseId"),
            payloadHash: vm.parseJsonBytes32(evidence, ".payloadHash")
        });
        if (
            certificate.chainId != block.chainid || certificate.deployer == address(0)
                || certificate.releaseId == bytes32(0) || certificate.payloadHash == bytes32(0)
        ) revert InvalidReleaseCertificate();
    }

    function _assertReleasePayload(
        ReleaseCertificate memory certificate,
        address deployer,
        bytes32 releaseId,
        bytes32 payloadHash
    ) internal pure {
        if (
            deployer != certificate.deployer || releaseId != certificate.releaseId
                || payloadHash != certificate.payloadHash
        ) {
            revert ReleasePayloadDrift();
        }
    }
}
