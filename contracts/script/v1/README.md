# V1 scripts

`DeployV1Deterministic.s.sol` is the fail-closed deterministic preview and broadcast entry point. `preview()` checks the target chain, canonical CREATE2 deployer, external dependency addresses and runtime code hashes, PositionManager bindings, deterministic release salts, and Hook permission mask, then prints the complete address plan without loading a private key. `run()` additionally binds the broadcaster to `V1_EXPECTED_DEPLOYER`, requires the previewed `V1_EXPECTED_ORCHESTRATOR`, and broadcasts only the exact plan after the release readiness gate permits deployment. The runtime graph is idempotent: a rerun accepts only the exact completed payload and addresses. Preview remains keyless and does not authorize broadcast.

`run()` invokes `V1ReleaseGate._assertReleaseEligibility()` before reading `DEPLOYER_PRIVATE_KEY`; the official Forge broadcast entrypoint therefore cannot bypass open readiness gates. The gate reads `../deployments/evidence/v1-current-release.json` only after the manifest state is eligible. That local certificate must be operator-reviewed evidence issued after real evidence passes; it is not a cryptographic signature or an onchain permission. The current repository has no `VERIFIED` release certificate and no broadcast has occurred, despite the manifest now being `DEPLOYMENT_ELIGIBLE`.

The certificate shape is fixed at schema version `1` and contains `status`, `schemaVersion`, `verifiedAt`, `expiresAt`, `executionSpecId`, `executionManifestSha256`, `productArtifactManifestSha256`, `compiledInterfaceManifestSha256`, `chainId`, `deployer`, `releaseId`, and `payloadHash`. The gate requires `status=VERIFIED`, a non-expired certificate with `expiresAt <= verifiedAt + 24h`, exact SHA-256 matches for the three current manifest files, matching execution spec and chain, and nonzero deployer/release/payload values. It then matches deployer, release ID, and payload hash against the prepared plan. `preview()` remains unaffected and does not require the certificate or a private key.

`V1DeterministicDeploymentOrchestrator.sol` creates all 16 ordinary components, the Hook/Executor helper pair, and the Factory in one call. Any failure rolls the complete runtime graph back. Registry activation, role handoff, and market creation remain separate receipt-bound operations and are never performed by the runtime broadcast script.

`V1HookExecutorDeployer.sol` is the one-shot bootstrap bridge for the immutable Hook/GraduationExecutor constructor cycle. The release tooling must:

1. choose the final authorizer and exact Hook/Executor init code;
2. mine a CREATE2 helper salt whose CREATE-nonce-1 child has the required `0x2044` Hook permission bits;
3. precompute the helper's nonce-1 Hook and nonce-2 Executor addresses and use those addresses in MarketRegistry and both constructors;
4. deploy the helper with CREATE2, then call `deploy(hookInitCode, executorInitCode)` from the immutable authorizer;
5. verify the emitted pair, reciprocal getters, runtime codehashes, LaunchTemplate binding graph, and deployment manifest.

The pair is created in one transaction. If either constructor or reciprocal postcondition fails, both child deployments roll back and the same helper can be retried with corrected init code. A completed helper is permanently one-shot. This mechanism does not close the target-chain CREATE2, Hook-mask, source-verification, or role-handoff gates.
