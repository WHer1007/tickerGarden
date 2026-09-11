// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
/// @dev Current deployment configuration and deterministic address plan.
struct V1DeploymentConfig {
    address initialAdmin;
    address poolManager;
    uint24 nativeQuotePoolFee;
    int24 nativeQuoteTickSpacing;
    address positionManager;
    address swapRouter;
    address quoter;
    address platformTreasury;
    bytes32 feePolicyId;
}

struct V1DeploymentPlan {
    address[16] ordinaryComponents;
    address helper;
    address hook;
    address executor;
    address factory;
    bytes32 payloadHash;
}
