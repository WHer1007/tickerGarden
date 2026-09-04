# V1 scripts

`V1HookExecutorDeployer.sol` is the one-shot bootstrap bridge for the immutable Hook/GraduationExecutor constructor cycle. The release tooling must:

1. choose the final authorizer and exact Hook/Executor init code;
2. mine a CREATE2 helper salt whose CREATE-nonce-1 child has the required `0x2044` Hook permission bits;
3. precompute the helper's nonce-1 Hook and nonce-2 Executor addresses and use those addresses in MarketRegistry and both constructors;
4. deploy the helper with CREATE2, then call `deploy(hookInitCode, executorInitCode)` from the immutable authorizer;
5. verify the emitted pair, reciprocal getters, runtime codehashes, LaunchTemplate binding graph, and deployment manifest.

The pair is created in one transaction. If either constructor or reciprocal postcondition fails, both child deployments roll back and the same helper can be retried with corrected init code. A completed helper is permanently one-shot. This mechanism does not close the target-chain CREATE2, Hook-mask, source-verification, or role-handoff gates.
