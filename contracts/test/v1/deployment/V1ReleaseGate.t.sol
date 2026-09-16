// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Test} from "forge-std/Test.sol";
import {V1ReleaseGate} from "../../../script/v1/V1ReleaseGate.sol";
import {DeployV1Deterministic} from "../../../script/v1/DeployV1Deterministic.s.sol";

contract ReleaseGateHarness is V1ReleaseGate {
    mapping(bytes32 => string) private inputs;

    function set(string memory path, string memory data) external {
        inputs[keccak256(bytes(path))] = data;
    }

    function _releaseInput(string memory path) internal view override returns (string memory) {
        return inputs[keccak256(bytes(path))];
    }

    function check(address deployer, bytes32 releaseId, bytes32 payloadHash) external view {
        _assertReleasePayload(_assertReleaseEligibility(), deployer, releaseId, payloadHash);
    }
}

contract BlockedReleaseEntry is DeployV1Deterministic {
    function _releaseInput(string memory) internal pure override returns (string memory) {
        return '{"status":"IMPLEMENTATION_ALLOWED","readiness":{"state":"IMPLEMENTATION_ALLOWED"}}';
    }
}

contract V1ReleaseGateTest is Test {
    ReleaseGateHarness private gate;
    bytes32 constant RELEASE = keccak256("release");
    bytes32 constant PAYLOAD = keccak256("payload");
    string constant MANIFEST = "../spec/v1_execution_manifest.json";
    string constant CERT = "../deployments/evidence/v1-current-release.json";
    string private manifest;

    function setUp() public {
        vm.warp(100000);
        gate = new ReleaseGateHarness();
        manifest =
            '{"status":"DEPLOYMENT_ELIGIBLE","executionSpecId":"V1-EXEC-11","readiness":{"state":"DEPLOYMENT_ELIGIBLE","deploymentEligible":true,"implementationAllowed":true,"gateSets":{"implementation":{"open":[]},"deployment":{"open":[]}}}}';
        gate.set(MANIFEST, manifest);
        gate.set("../spec/v1_product_artifact_manifest.json", "product");
        gate.set("../spec/v1_compiled_interface_manifest.json", "compiled");
        _certificate(100000, 100600, "VERIFIED");
    }

    function _certificate(uint256 verified, uint256 expires, string memory status) private {
        string memory key = "certificate";
        vm.serializeUint(key, "schemaVersion", 1);
        vm.serializeString(key, "status", status);
        vm.serializeString(key, "executionSpecId", "V1-EXEC-11");
        vm.serializeUint(key, "verifiedAt", verified);
        vm.serializeUint(key, "expiresAt", expires);
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeAddress(key, "deployer", address(this));
        vm.serializeBytes32(key, "releaseId", RELEASE);
        vm.serializeBytes32(key, "payloadHash", PAYLOAD);
        vm.serializeBytes32(key, "executionManifestSha256", sha256(bytes(manifest)));
        vm.serializeBytes32(key, "productArtifactManifestSha256", sha256("product"));
        gate.set(CERT, vm.serializeBytes32(key, "compiledInterfaceManifestSha256", sha256("compiled")));
    }

    function test_validCertificateAcceptsExactReviewedPayload() public view {
        gate.check(address(this), RELEASE, PAYLOAD);
    }

    function test_sourceArtifactDriftRejects() public {
        gate.set("../spec/v1_product_artifact_manifest.json", "new build");
        vm.expectRevert(V1ReleaseGate.ReleaseArtifactDrift.selector);
        gate.check(address(this), RELEASE, PAYLOAD);
    }

    function test_changedPayloadRejectsEvenWithUnchangedManifest() public {
        vm.expectRevert(V1ReleaseGate.ReleasePayloadDrift.selector);
        gate.check(address(this), RELEASE, keccak256("new code"));
    }

    function test_changedDeployerOrReleaseRejects() public {
        vm.expectRevert(V1ReleaseGate.ReleasePayloadDrift.selector);
        gate.check(address(1), RELEASE, PAYLOAD);
        vm.expectRevert(V1ReleaseGate.ReleasePayloadDrift.selector);
        gate.check(address(this), bytes32(uint256(1)), PAYLOAD);
    }

    function test_staleExpiredFutureOrLongLivedCertificateRejects() public {
        _certificate(100000, 100600, "STALE");
        vm.expectRevert(V1ReleaseGate.InvalidReleaseCertificate.selector);
        gate.check(address(this), RELEASE, PAYLOAD);
        _certificate(99900, 99999, "VERIFIED");
        vm.expectRevert(V1ReleaseGate.InvalidReleaseCertificate.selector);
        gate.check(address(this), RELEASE, PAYLOAD);
        _certificate(100001, 100600, "VERIFIED");
        vm.expectRevert(V1ReleaseGate.InvalidReleaseCertificate.selector);
        gate.check(address(this), RELEASE, PAYLOAD);
        _certificate(100000, 200000, "VERIFIED");
        vm.expectRevert(V1ReleaseGate.InvalidReleaseCertificate.selector);
        gate.check(address(this), RELEASE, PAYLOAD);
    }

    function test_wrongChainRejects() public {
        vm.chainId(block.chainid + 1);
        vm.expectRevert(V1ReleaseGate.InvalidReleaseCertificate.selector);
        gate.check(address(this), RELEASE, PAYLOAD);
    }

    function test_openGateRejectsEvenIfStateClaimsEligible() public {
        gate.set(
            MANIFEST,
            '{"status":"DEPLOYMENT_ELIGIBLE","executionSpecId":"V1-EXEC-11","readiness":{"state":"DEPLOYMENT_ELIGIBLE","deploymentEligible":true,"implementationAllowed":true,"gateSets":{"implementation":{"open":[]},"deployment":{"open":["FORK"]}}}}'
        );
        vm.expectRevert(V1ReleaseGate.ReleaseNotEligible.selector);
        gate.check(address(this), RELEASE, PAYLOAD);
    }

    function test_actualBroadcastEntryRejectsCurrentOpenGatesBeforeReadingPrivateKey() public {
        BlockedReleaseEntry entry = new BlockedReleaseEntry();
        vm.expectRevert(V1ReleaseGate.ReleaseNotEligible.selector);
        entry.run();
    }
}
