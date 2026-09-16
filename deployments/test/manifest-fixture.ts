import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { keccak_256 } from "@noble/hashes/sha3.js";

export type JsonRecord = Record<string, unknown>;

export const compiled = JSON.parse(readFileSync(new URL("../../spec/v1_compiled_interface_manifest.json", import.meta.url), "utf8")) as { mutations: Array<Record<string, unknown>>; modules: Array<{ target: string }> };
export const permissions = JSON.parse(readFileSync(new URL("../../spec/v1_permissions_matrix.json", import.meta.url), "utf8")) as { functions: Array<Record<string, unknown>> };

export function hash(label: string): string {
  return `0x${createHash("sha256").update(label).digest("hex")}`;
}

export function address(label: string): string {
  return `0x${createHash("sha256").update(label).digest("hex").slice(0, 40)}`;
}

function functionSelector(signature: string): string {
  return `0x${Buffer.from(keccak_256(new TextEncoder().encode(signature))).subarray(0, 4).toString("hex")}`;
}

function keccakHex(value: string): string {
  return `0x${Buffer.from(keccak_256(Buffer.from(value.slice(2), "hex"))).toString("hex")}`;
}

function addressReturnHash(value: string): string {
  const encoded = Uint8Array.from(value.slice(2).padStart(64, "0").match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
  return `0x${Buffer.from(keccak_256(encoded)).toString("hex")}`;
}

function moduleDeployment(name: string): JsonRecord {
  const moduleKind = name === "MemeStockGauge"
    ? "CLONE_IMPLEMENTATION"
    : ["TickerMemeTokenV1", "TickerGardenCurve", "LaunchLocker"].includes(name)
      ? "PER_MARKET_IMPLEMENTATION"
      : "SHARED_IMMUTABLE";
  return {
    moduleKind,
    sourceName: `src/v1/modules/${name}.sol`, contractName: name, artifactPath: `out-v1/${name}.sol/${name}.json`, compilerVersion: "0.8.26+commit.8a97fa7a",
    sourceHash: hash(`${name}:source`), artifactHash: hash(`${name}:artifact`), abiHash: hash(`${name}:abi`), creationCodeHash: hash(`${name}:creation`), runtimeCodeHash: hash(`${name}:runtime`), constructorArgsHash: hash(`${name}:constructor`), immutableArgsHash: hash(`${name}:immutable`),
    deployedAddress: address(`${name}:deployed`), deployer: address(`${name}:deployer`), sourceVerified: true,
  };
}

const ROLE_BY_CALLER: Readonly<Record<string, string>> = { PROTOCOL_ADMIN_ROLE: "1", PAUSE_GUARDIAN_ROLE: "2", UNPAUSE_ROLE: "3" };

function permission(row: Record<string, unknown>, index: number): JsonRecord {
  const target = String(row.target ?? row.module);
  const caller = String(row.caller);
  return {
    target,
    targetAddress: target === "AccessManager" ? address("access-manager") : address(`${target}:deployed`),
    selector: String(row.selector ?? functionSelector(String(row.signature ?? `${target}:${index}`))), caller, roleId: ROLE_BY_CALLER[caller] ?? "0",
    executionDelaySeconds: typeof row.executionDelaySeconds === "number" ? row.executionDelaySeconds : typeof row.delaySeconds === "number" ? row.delaySeconds : 0,
    stateDelaySeconds: Number(row.stateDelaySeconds ?? 0), stateDelayAnchor: String(row.stateDelayAnchor ?? "NONE"), precondition: String(row.precondition ?? "NONE"), recipient: String(row.recipient ?? "none"),
  };
}

function create2Component(kind: string, protocolModules: JsonRecord): JsonRecord {
  const gaugeImplementation = protocolModules.MemeStockGauge as JsonRecord;
  return {
    deploymentKind: kind === "GAUGE" ? "ERC1167_IMMUTABLE_ARGS_CLONE" : "FULL_CREATE2",
    deployer: address(`${kind}:deployer`), saltDomain: hash(`${kind}:domain`), salt: hash(`${kind}:salt`), initCodeHash: hash(`${kind}:init`), runtimeCodeHash: hash(`${kind}:runtime`), constructorArgsHash: hash(`${kind}:constructor`), immutableArgsHash: hash(`${kind}:immutable`),
    ...(kind === "GAUGE" ? { implementationAddress: gaugeImplementation.deployedAddress, implementationCodeHash: gaugeImplementation.runtimeCodeHash } : {}),
    predictedAddress: address(`${kind}:predicted`), actualAddress: address(`${kind}:actual`), collisionPolicy: "REVERT_NO_NONCE_FALLBACK",
  };
}

export function validManifest(): JsonRecord {
  const protocolModules = Object.fromEntries(compiled.modules.map(({ target }) => [target, moduleDeployment(target)]));
  protocolModules.HolderRewardsDistributorV1 = moduleDeployment("HolderRewardsDistributorV1");
  const protocolPermissions = compiled.mutations.map(permission);
  const administrativePermissions = permissions.functions.filter((row) => row.module === "AccessManager").map(permission);
  const gateIds = ["V1-DEPLOY-CHAIN-SNAPSHOT-01", "V1-DEPLOY-ARTIFACT-CODEHASH-01", "V1-DEPLOY-CREATE2-VECTORS-01", "V1-DEPLOY-HOOK-MASK-01", "V1-DEPLOY-PERMISSIONS-01", "V1-DEPLOY-ABI-DIFF-01", "V1-DEPLOY-PRODUCT-FORK-E2E-01"];
  const hook = "0x1234567890abcdef1234567890abcdef12342044";
  const report = (name: string) => ({ reportHash: hash(`${name}:report`), testCount: 1, passed: true });
  const locker = protocolModules.LaunchLocker as JsonRecord;
  const resolver = protocolModules.LaunchConfigResolver as JsonRecord;
  const components = Object.fromEntries(["TOKEN", "CURVE", "GAUGE", "LOCKER"].map((kind) => [kind, create2Component(kind, protocolModules)])) as JsonRecord;
  const gaugeComponent = components.GAUGE as JsonRecord;
  return {
    schemaVersion: 1, manifestKind: "TICKERGARDEN_V1_NETWORK_DEPLOYMENT", executionSpecId: "V1-EXEC-11", releaseStatus: "DEPLOYMENT_CANDIDATE",
    readinessCertificate: { state: "DEPLOYMENT_ELIGIBLE", executionManifestHash: hash("execution-manifest"), compiledInterfaceManifestHash: hash("compiled-interface-manifest"), closedDeploymentGateEvidence: gateIds },
    chain: { chainId: 4663, network: "Robinhood Chain", rpcUrls: ["https://rpc.release.invalid"], finalizedBlockNumber: "123500", finalizedBlockHash: hash("finalized-block"), observedAt: "2026-09-03T00:00:00Z", evmVersion: "cancun" },
    externalDependencies: Object.fromEntries(["poolManager", "positionManager", "stateView", "permit2"].map((name) => [name, { address: address(name), runtimeCodeHash: hash(`${name}:runtime`), versionOrCommit: hash(`${name}:commit`).slice(2, 42) }])),
    protocolModules,
    configSnapshot: { tickerGardenBaselineIds: [hash("baseline")], quoteConfigIds: [hash("native-quote")], launchTemplateIds: [hash("template")], feePolicyId: hash("fee-policy"), launchFeeRaw: "500000000000000", numericBoundsHash: hash("numeric-bounds"), officialStockCatalogHash: hash("stock-catalog"), snapshotHash: hash("config-snapshot") },
    quoteAssets: [{ configId: hash("native-quote"), tickerGardenBaselineId: hash("baseline"), economicsHash: hash("native-economics"), assetKind: "NATIVE", tokenAddress: "0x0000000000000000000000000000000000000000", decimals: 18, phantomQuote: "1680000000000000000", graduationThreshold: "4200000000000000000", observationBlockHash: hash("native-observation"), exactBalanceDeltaEvidenceHash: hash("native-balance-delta") }],
    officialStocks: [{ assetUid: hash("stock-uid"), tokenAddress: address("stock-token"), decimals: 18, runtimeCodeHash: hash("stock-runtime"), proxyKind: "IMMUTABLE_BEACON", beaconAddress: address("stock-beacon"), beaconCodeHash: hash("stock-beacon-code"), implementationAddress: address("stock-implementation"), implementationCodeHash: hash("stock-implementation-code"), observationBlockHash: hash("stock-observation"), exactBalanceDeltaEvidenceHash: hash("stock-balance-delta") }],
    create2: { marketId: hash("market-id"), creator: address("creator"), components, predictionVectorHash: hash("prediction-vector"), predictionMatchesDeployment: true },
    hook: { address: hook, runtimeCodeHash: hash("hook-runtime"), permissionMaskHex: "0x2044", permissionMaskDecimal: 8260, addressLow14BitsHex: "0x2044", poolKeyFee: 0, requiredSlot0LpFee: 0, requiredPackedProtocolFee: 0, proofHash: hash("hook-proof"), maskVerified: true },
    accessManager: {
      address: address("access-manager"), runtimeCodeHash: hash("access-manager-runtime"), framework: "OPENZEPPELIN_ACCESS_MANAGER_5_7_0", protocolPermissions, administrativePermissions,
      roles: [["PROTOCOL_ADMIN_ROLE", "1", "governance-safe", 172800], ["PAUSE_GUARDIAN_ROLE", "2", "guardian-safe", 0], ["UNPAUSE_ROLE", "3", "security-safe", 86400]].map(([roleName, roleId, member, executionDelaySeconds]) => ({ roleName, roleId, members: [address(String(member))], executionDelaySeconds })),
      exactDiffHash: hash("permission-diff"), exactDiffVerified: true,
    },
    livePreflight: {
      accessManagerDeploymentBlockNumber: "123400",
      keyGetterChecks: [
        { label: "launch-template-hash", category: "CONFIG_IDENTITY", target: String((protocolModules.LaunchTemplateRegistry as JsonRecord).deployedAddress), callData: `0x12345678${hash("template-id").slice(2)}`, expectedReturnDataHash: hash("template-return-data") },
        { label: "factory-platform-treasury", category: "CONFIG_IDENTITY", target: String((protocolModules.TickerGardenFactoryV1 as JsonRecord).deployedAddress), callData: functionSelector("platformTreasury()"), expectedReturnDataHash: addressReturnHash(address("platform-treasury")) },
        { label: "fee-vault-platform-treasury", category: "CONFIG_IDENTITY", target: String((protocolModules.ProtocolFeeVault as JsonRecord).deployedAddress), callData: functionSelector("platformTreasury()"), expectedReturnDataHash: addressReturnHash(address("platform-treasury")) },
        { label: "treasury-change-delay", category: "CONFIG_IDENTITY", target: String((protocolModules.ProtocolFeeVault as JsonRecord).deployedAddress), callData: functionSelector("TREASURY_CHANGE_DELAY()"), expectedReturnDataHash: keccakHex(`0x${BigInt(172800).toString(16).padStart(64, "0")}`) },
        { label: "treasury-pending-recipient", category: "CONFIG_IDENTITY", target: String((protocolModules.ProtocolFeeVault as JsonRecord).deployedAddress), callData: functionSelector("pendingPlatformTreasury()"), expectedReturnDataHash: keccakHex(`0x${"0".repeat(64)}`) },
        { label: "treasury-proposal-nonce", category: "CONFIG_IDENTITY", target: String((protocolModules.ProtocolFeeVault as JsonRecord).deployedAddress), callData: functionSelector("treasuryProposalNonce()"), expectedReturnDataHash: keccakHex(`0x${"0".repeat(64)}`) },
        { label: "factory-market-registry", category: "IMMUTABLE_BINDING", target: String((protocolModules.TickerGardenFactoryV1 as JsonRecord).deployedAddress), callData: "0x87654321", expectedReturnDataHash: hash("factory-registry-return-data") },
        { label: "gauge-clone-identity", category: "IMMUTABLE_BINDING", target: String(gaugeComponent.actualAddress), callData: functionSelector("gaugeIdentity()"), expectedReturnDataHash: String(gaugeComponent.immutableArgsHash) },
        { label: "resolver-approved-quote-registry", category: "IMMUTABLE_BINDING", target: String(resolver.deployedAddress), callData: functionSelector("approvedQuoteRegistry()"), expectedReturnDataHash: addressReturnHash(String((protocolModules.ApprovedQuoteRegistry as JsonRecord).deployedAddress)) },
        { label: "resolver-tickergarden-baseline-registry", category: "IMMUTABLE_BINDING", target: String(resolver.deployedAddress), callData: functionSelector("tickerGardenBaselineRegistry()"), expectedReturnDataHash: addressReturnHash(String((protocolModules.TickerGardenBaselineRegistry as JsonRecord).deployedAddress)) },
        { label: "resolver-launch-template-registry", category: "IMMUTABLE_BINDING", target: String(resolver.deployedAddress), callData: functionSelector("launchTemplateRegistry()"), expectedReturnDataHash: addressReturnHash(String((protocolModules.LaunchTemplateRegistry as JsonRecord).deployedAddress)) },
        { label: "official-stock-registry-access-manager-authority", category: "IMMUTABLE_BINDING", target: String((protocolModules.OfficialStockRegistryV1 as JsonRecord).deployedAddress), callData: functionSelector("authority()"), expectedReturnDataHash: addressReturnHash(address("access-manager")) },
        { label: "approved-quote-registry-access-manager-authority", category: "IMMUTABLE_BINDING", target: String((protocolModules.ApprovedQuoteRegistry as JsonRecord).deployedAddress), callData: functionSelector("authority()"), expectedReturnDataHash: addressReturnHash(address("access-manager")) },
        { label: "approved-quote-registry-official-stock-registry", category: "IMMUTABLE_BINDING", target: String((protocolModules.ApprovedQuoteRegistry as JsonRecord).deployedAddress), callData: functionSelector("officialStockRegistry()"), expectedReturnDataHash: addressReturnHash(String((protocolModules.OfficialStockRegistryV1 as JsonRecord).deployedAddress)) },
        { label: "tickergarden-baseline-registry-access-manager-authority", category: "IMMUTABLE_BINDING", target: String((protocolModules.TickerGardenBaselineRegistry as JsonRecord).deployedAddress), callData: functionSelector("authority()"), expectedReturnDataHash: addressReturnHash(address("access-manager")) },
        { label: "launch-template-registry-access-manager-authority", category: "IMMUTABLE_BINDING", target: String((protocolModules.LaunchTemplateRegistry as JsonRecord).deployedAddress), callData: functionSelector("authority()"), expectedReturnDataHash: addressReturnHash(address("access-manager")) },
        { label: "protocol-fee-vault-access-manager-authority", category: "IMMUTABLE_BINDING", target: String((protocolModules.ProtocolFeeVault as JsonRecord).deployedAddress), callData: functionSelector("authority()"), expectedReturnDataHash: addressReturnHash(address("access-manager")) },
        { label: "holder-market-registry", category: "IMMUTABLE_BINDING", target: String((protocolModules.HolderRewardsDistributorV1 as JsonRecord).deployedAddress), callData: functionSelector("marketRegistry()"), expectedReturnDataHash: addressReturnHash(String((protocolModules.MarketRegistryV1 as JsonRecord).deployedAddress)) },
        { label: "stock-uid", category: "EXTERNAL_IDENTITY", target: address("stock-token"), callData: functionSelector("uid()"), expectedReturnDataHash: hash("stock-uid-return") },
        { label: "stock-decimals", category: "EXTERNAL_IDENTITY", target: address("stock-token"), callData: functionSelector("decimals()"), expectedReturnDataHash: hash("stock-decimals-return") },
        { label: "stock-beacon-implementation", category: "PROXY_OR_BEACON_LINKAGE", target: address("stock-beacon"), callData: "0x5c60da1b", expectedReturnDataHash: hash("stock-beacon-implementation-return") },
      ],
      storageChecks: [{ label: "stock-beacon-slot", target: address("stock-token"), slot: "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50", expectedValue: `0x${address("stock-beacon").slice(2).padStart(64, "0")}` }],
      marketProbe: { marketId: hash("market-id"), sourceVersion: 2, activeFeeSource: hook, poolId: hash("canonical-pool"), poolKey: { currency0: address("pool-currency-0"), currency1: address("pool-currency-1"), fee: 0, tickSpacing: 60, hooks: hook }, positionTokenId: "1", launchLocker: String(locker.deployedAddress), expectedBindingStatus: 2 },
      revokedAccounts: [address("release-deployer")],
    },
    tests: { unit: report("unit"), fuzz: report("fuzz"), invariant: report("invariant"), fork: report("fork"), e2e: report("e2e") },
    roleHandoff: { deployer: address("release-deployer"), governanceSafe: address("governance-safe"), guardianSafe: address("guardian-safe"), securityOrGovernanceSafe: address("security-safe"), platformTreasury: address("platform-treasury"), handoffTransactions: [{ transactionHash: hash("handoff-tx"), blockNumber: "123457", action: "GRANT_AND_REVOKE" }], deployerRevocationTransactionHash: hash("deployer-revocation"), deployerRevocationBlock: "123458", deployerRolesRevoked: true, safeRolesVerified: true },
    evidence: gateIds.map((gateId) => ({ gateId, evidencePath: `evidence/${gateId}.json`, contentHash: hash(`${gateId}:evidence`) })),
  };
}

export function clone(value: JsonRecord): JsonRecord {
  return structuredClone(value);
}
