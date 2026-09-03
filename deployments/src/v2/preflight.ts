import { keccak_256 } from "@noble/hashes/sha3.js";
import { readFileSync } from "node:fs";

import { assertV2Deployable, assertV2DeploymentManifest, assertV2ProductionReady } from "../index.ts";

type JsonRecord = Record<string, unknown>;

export interface V2ReadOnlyRpc {
  request(method: string, params: readonly unknown[]): Promise<unknown>;
}

export type V2LivePreflightReport = Readonly<{
  chainId: number;
  blockNumber: string;
  blockHash: string;
  codeHashesChecked: number;
  getterChecks: number;
  storageChecks: number;
  permissionChecks: number;
  administrativePermissionChecks: number;
  roleMembershipChecks: number;
  revokedMembershipChecks: number;
  accessManagerEvents: number;
  transactionReceiptsChecked: number;
}>;

type Manifest = JsonRecord & {
  chain: JsonRecord;
  externalDependencies: Record<string, JsonRecord>;
  protocolModules: Record<string, JsonRecord>;
  quoteAssets: JsonRecord[];
  officialStocks: JsonRecord[];
  create2: JsonRecord & { components: Record<string, JsonRecord> };
  hook: JsonRecord;
  accessManager: JsonRecord & {
    protocolPermissions: JsonRecord[];
    administrativePermissions: JsonRecord[];
    roles: JsonRecord[];
  };
  livePreflight: JsonRecord & {
    keyGetterChecks: JsonRecord[];
    storageChecks: JsonRecord[];
    marketProbe: JsonRecord;
    revokedAccounts: string[];
  };
  roleHandoff: JsonRecord;
};

const READ_ONLY_METHODS = new Set([
  "eth_chainId",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_call",
  "eth_getStorageAt",
  "eth_getLogs",
  "eth_getTransactionReceipt",
]);

const ERC1967_IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const ERC1967_BEACON_SLOT = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";

export class HttpV2ReadOnlyRpc implements V2ReadOnlyRpc {
  readonly #url: string;
  readonly #timeoutMs: number;
  #id = 0;

  constructor(url: string, timeoutMs = 15_000) {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`V2 preflight HTTP transport requires http(s), received ${parsed.protocol}`);
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new Error("V2 preflight RPC timeout must be a positive integer");
    }
    this.#url = parsed.href;
    this.#timeoutMs = timeoutMs;
  }

  async request(method: string, params: readonly unknown[]): Promise<unknown> {
    if (!READ_ONLY_METHODS.has(method)) {
      throw new Error(`V2 preflight rejected non-read-only RPC method: ${method}`);
    }
    const id = ++this.#id;
    const response = await fetch(this.#url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    if (!response.ok) throw new Error(`V2 preflight RPC HTTP ${response.status}`);
    const payload = (await response.json()) as JsonRecord;
    if (payload.jsonrpc !== "2.0" || payload.id !== id) {
      throw new Error(`V2 preflight RPC ${method} returned a mismatched response envelope`);
    }
    if (payload.error !== undefined) {
      throw new Error(`V2 preflight RPC ${method} failed: ${JSON.stringify(payload.error)}`);
    }
    if (!("result" in payload)) throw new Error(`V2 preflight RPC ${method} omitted result`);
    return payload.result;
  }
}

function fail(label: string, expected: unknown, actual: unknown): never {
  throw new Error(`V2 live preflight mismatch at ${label}: expected=${String(expected)} actual=${String(actual)}`);
}

function stringField(record: JsonRecord, key: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new Error(`V2 live preflight invalid string: ${key}`);
  return value;
}

function numberField(record: JsonRecord, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`V2 live preflight invalid integer: ${key}`);
  }
  return value;
}

function normalizedHex(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new Error(`V2 live preflight invalid hex from ${label}`);
  }
  return value.toLowerCase();
}

function bytesFromHex(value: string): Uint8Array {
  return Uint8Array.from(value.slice(2).match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
}

function keccakHex(value: string): string {
  return `0x${Buffer.from(keccak_256(bytesFromHex(value))).toString("hex")}`;
}

function selector(signature: string): string {
  return `0x${Buffer.from(keccak_256(new TextEncoder().encode(signature))).subarray(0, 4).toString("hex")}`;
}

function uintWord(value: bigint): string {
  if (value < 0n || value >= 1n << 256n) throw new Error(`uint256 out of range: ${value}`);
  return value.toString(16).padStart(64, "0");
}

function signedWord(value: bigint, bits: bigint): string {
  const limit = 1n << bits;
  const minimum = -(1n << (bits - 1n));
  const maximum = (1n << (bits - 1n)) - 1n;
  if (value < minimum || value > maximum) throw new Error(`signed integer out of range: ${value}`);
  return (value < 0n ? (1n << 256n) + value : value).toString(16).padStart(64, "0");
}

function addressWord(address: string): string {
  return address.toLowerCase().slice(2).padStart(64, "0");
}

function bytes4Word(value: string): string {
  return value.toLowerCase().slice(2).padEnd(64, "0");
}

function callData(signature: string, words: readonly string[] = []): string {
  return `${selector(signature)}${words.join("")}`;
}

function words(value: unknown, label: string, minimum: number): string[] {
  const hex = normalizedHex(value, label).slice(2);
  if (hex.length % 64 !== 0 || hex.length / 64 < minimum) {
    throw new Error(`V2 live preflight malformed ABI result at ${label}`);
  }
  return hex.match(/.{64}/g) ?? [];
}

function wordUint(word: string): bigint {
  return BigInt(`0x${word}`);
}

function wordAddress(word: string): string {
  return `0x${word.slice(24)}`.toLowerCase();
}

function wordSigned24(word: string): number {
  const raw = Number(BigInt(`0x${word}`) & 0xffffffn);
  return raw & 0x800000 ? raw - 0x1000000 : raw;
}

function quantity(value: string | number | bigint): string {
  return `0x${BigInt(value).toString(16)}`;
}

function same(label: string, expected: string, actual: string): void {
  if (expected.toLowerCase() !== actual.toLowerCase()) fail(label, expected, actual);
}

async function rpcCall(
  rpc: V2ReadOnlyRpc,
  to: string,
  data: string,
  blockTag: string,
  label: string,
): Promise<string> {
  return normalizedHex(
    await rpc.request("eth_call", [{ to, data }, blockTag]),
    `eth_call:${label}`,
  );
}

function addCodeExpectation(
  expectations: Map<string, { hash: string; labels: string[] }>,
  address: string,
  hash: string,
  label: string,
): void {
  const key = address.toLowerCase();
  const prior = expectations.get(key);
  if (prior !== undefined && prior.hash.toLowerCase() !== hash.toLowerCase()) {
    fail(`manifest codehash conflict for ${address}`, prior.hash, hash);
  }
  if (prior === undefined) expectations.set(key, { hash, labels: [label] });
  else prior.labels.push(label);
}

function collectCodeExpectations(manifest: Manifest): Map<string, { hash: string; labels: string[] }> {
  const output = new Map<string, { hash: string; labels: string[] }>();
  for (const [name, dependency] of Object.entries(manifest.externalDependencies)) {
    addCodeExpectation(output, stringField(dependency, "address"), stringField(dependency, "runtimeCodeHash"), `externalDependencies.${name}`);
  }
  for (const [name, module] of Object.entries(manifest.protocolModules)) {
    addCodeExpectation(output, stringField(module, "deployedAddress"), stringField(module, "runtimeCodeHash"), `protocolModules.${name}`);
  }
  addCodeExpectation(output, stringField(manifest.hook, "address"), stringField(manifest.hook, "runtimeCodeHash"), "hook");
  addCodeExpectation(output, stringField(manifest.accessManager, "address"), stringField(manifest.accessManager, "runtimeCodeHash"), "accessManager");
  for (const [index, quote] of manifest.quoteAssets.entries()) {
    if (quote.assetKind === "ERC20") {
      addCodeExpectation(output, stringField(quote, "tokenAddress"), stringField(quote, "runtimeCodeHash"), `quoteAssets.${index}`);
      addCodeExpectation(output, stringField(quote, "implementationAddress"), stringField(quote, "implementationCodeHash"), `quoteAssets.${index}.implementation`);
    }
  }
  for (const [index, stock] of manifest.officialStocks.entries()) {
    addCodeExpectation(output, stringField(stock, "tokenAddress"), stringField(stock, "runtimeCodeHash"), `officialStocks.${index}`);
    addCodeExpectation(output, stringField(stock, "beaconAddress"), stringField(stock, "beaconCodeHash"), `officialStocks.${index}.beacon`);
    addCodeExpectation(output, stringField(stock, "implementationAddress"), stringField(stock, "implementationCodeHash"), `officialStocks.${index}.implementation`);
  }
  for (const [kind, component] of Object.entries(manifest.create2.components)) {
    addCodeExpectation(output, stringField(component, "actualAddress"), stringField(component, "runtimeCodeHash"), `create2.${kind}`);
  }
  return output;
}

function verifyProxyEvidence(manifest: Manifest): void {
  const storage = new Map(
    manifest.livePreflight.storageChecks.map((check) => [
      `${stringField(check, "target").toLowerCase()}:${stringField(check, "slot").toLowerCase()}`,
      stringField(check, "expectedValue").toLowerCase(),
    ]),
  );
  const getters = new Map(
    manifest.livePreflight.keyGetterChecks.map((check) => [
      `${stringField(check, "target").toLowerCase()}:${stringField(check, "callData").toLowerCase()}`,
      stringField(check, "expectedReturnDataHash").toLowerCase(),
    ]),
  );
  for (const [index, stock] of manifest.officialStocks.entries()) {
    const token = stringField(stock, "tokenAddress").toLowerCase();
    const beacon = stringField(stock, "beaconAddress").toLowerCase();
    const implementation = stringField(stock, "implementationAddress").toLowerCase();
    const expectedBeaconWord = `0x${addressWord(beacon)}`;
    const storedBeacon = storage.get(`${token}:${ERC1967_BEACON_SLOT}`);
    if (storedBeacon !== expectedBeaconWord) fail(`officialStocks.${index}.beaconSlot`, expectedBeaconWord, storedBeacon);
    const implementationCall = callData("implementation()").toLowerCase();
    const expectedImplementationHash = keccakHex(`0x${addressWord(implementation)}`);
    const getterHash = getters.get(`${beacon}:${implementationCall}`);
    if (getterHash !== expectedImplementationHash) {
      fail(`officialStocks.${index}.beaconImplementationGetter`, expectedImplementationHash, getterHash);
    }
  }
  for (const [index, quote] of manifest.quoteAssets.entries()) {
    if (quote.assetKind !== "ERC20") continue;
    const token = stringField(quote, "tokenAddress").toLowerCase();
    const implementation = stringField(quote, "implementationAddress").toLowerCase();
    const proxyKind = stringField(quote, "proxyKind");
    if (proxyKind === "ERC1967") {
      const expectedImplementationWord = `0x${addressWord(implementation)}`;
      const storedImplementation = storage.get(`${token}:${ERC1967_IMPLEMENTATION_SLOT}`);
      if (storedImplementation !== expectedImplementationWord) {
        fail(`quoteAssets.${index}.implementationSlot`, expectedImplementationWord, storedImplementation);
      }
    } else if (proxyKind === "BEACON") {
      const linkage = manifest.livePreflight.keyGetterChecks.some(
        (check) => check.category === "PROXY_OR_BEACON_LINKAGE" && stringField(check, "target").toLowerCase() === token,
      );
      if (!linkage) throw new Error(`V2 live preflight quoteAssets.${index} lacks beacon linkage getter`);
    } else if (proxyKind === "NONE" && token !== implementation) {
      fail(`quoteAssets.${index}.implementationAddress`, token, implementation);
    } else if (proxyKind === "OTHER_VERIFIED") {
      const linkage = manifest.livePreflight.keyGetterChecks.some(
        (check) => check.category === "PROXY_OR_BEACON_LINKAGE" && stringField(check, "target").toLowerCase() === token,
      );
      if (!linkage) throw new Error(`V2 live preflight quoteAssets.${index} lacks verified implementation linkage`);
    }
  }
}

function expectedPoolId(poolKey: JsonRecord): string {
  const encoded = `0x${[
    addressWord(stringField(poolKey, "currency0")),
    addressWord(stringField(poolKey, "currency1")),
    uintWord(BigInt(numberField(poolKey, "fee"))),
    signedWord(BigInt(numberField(poolKey, "tickSpacing")), 24n),
    addressWord(stringField(poolKey, "hooks")),
  ].join("")}`;
  return keccakHex(encoded);
}

function canonicalPermissionRows(): { mutations: JsonRecord[]; administrative: JsonRecord[] } {
  const compiled = JSON.parse(
    readFileSync(new URL("../../../spec/v2_compiled_interface_manifest.json", import.meta.url), "utf8"),
  ) as { mutations: JsonRecord[] };
  const permissions = JSON.parse(
    readFileSync(new URL("../../../spec/v2_permissions_matrix.json", import.meta.url), "utf8"),
  ) as { functions: JsonRecord[] };
  return {
    mutations: compiled.mutations,
    administrative: permissions.functions.filter((row) => row.module === "AccessManager"),
  };
}

function comparePermissionSemantics(manifest: Manifest): void {
  const canonical = canonicalPermissionRows();
  const accessManagerAddress = stringField(manifest.accessManager, "address").toLowerCase();
  const deployer = stringField(manifest.roleHandoff, "deployer").toLowerCase();
  const governanceSafe = stringField(manifest.roleHandoff, "governanceSafe").toLowerCase();
  const guardianSafe = stringField(manifest.roleHandoff, "guardianSafe").toLowerCase();
  const securitySafe = stringField(manifest.roleHandoff, "securityOrGovernanceSafe").toLowerCase();
  const recoverySafe = stringField(manifest.roleHandoff, "recoverySafe").toLowerCase();
  const actors = [governanceSafe, guardianSafe, securitySafe, recoverySafe];
  if (actors.includes(deployer) || actors.includes(accessManagerAddress) || deployer === accessManagerAddress) {
    throw new Error("V2 live preflight aliased deployer, AccessManager, or Safe actor");
  }
  if (
    guardianSafe === governanceSafe || guardianSafe === securitySafe || guardianSafe === recoverySafe
    || recoverySafe === governanceSafe || recoverySafe === securitySafe
  ) {
    throw new Error("V2 live preflight Guardian and recovery roles require independent Safe members");
  }
  const deploymentAddresses = new Set([accessManagerAddress, deployer, ...actors]);
  for (const [name, module] of Object.entries(manifest.protocolModules)) {
    const deployedAddress = stringField(module, "deployedAddress").toLowerCase();
    if (deploymentAddresses.has(deployedAddress)) throw new Error(`V2 live preflight aliased protocol module: ${name}`);
    deploymentAddresses.add(deployedAddress);
  }
  const expectedRoles: Readonly<Record<string, { member: string; delay: number }>> = {
    PROTOCOL_ADMIN_ROLE: { member: stringField(manifest.roleHandoff, "governanceSafe"), delay: 172800 },
    PAUSE_GUARDIAN_ROLE: { member: stringField(manifest.roleHandoff, "guardianSafe"), delay: 0 },
    UNPAUSE_ROLE: { member: stringField(manifest.roleHandoff, "securityOrGovernanceSafe"), delay: 86400 },
    RECOVERY_ROLE: { member: stringField(manifest.roleHandoff, "recoverySafe"), delay: 86400 },
  };
  const roleIds = new Map<string, string>();
  for (const [index, role] of manifest.accessManager.roles.entries()) {
    const name = stringField(role, "roleName");
    const expected = expectedRoles[name];
    if (expected === undefined) throw new Error(`V2 live preflight unexpected AccessManager role: ${name}`);
    const roleId = stringField(role, "roleId");
    if (roleId === "0" || [...roleIds.values()].includes(roleId)) {
      throw new Error(`V2 live preflight invalid or duplicate roleId at accessManager.roles.${index}`);
    }
    roleIds.set(name, roleId);
    const members = role.members as string[];
    if (members.length !== 1) fail(`accessManager.roles.${index}.members.length`, 1, members.length);
    same(`accessManager.roles.${index}.member`, expected.member, members[0] as string);
    if (numberField(role, "executionDelaySeconds") !== expected.delay) {
      fail(`accessManager.roles.${index}.executionDelaySeconds`, expected.delay, role.executionDelaySeconds);
    }
  }
  if (roleIds.size !== Object.keys(expectedRoles).length) fail("AccessManager role count", Object.keys(expectedRoles).length, roleIds.size);
  if (manifest.accessManager.protocolPermissions.length !== canonical.mutations.length) {
    fail("protocol permission count", canonical.mutations.length, manifest.accessManager.protocolPermissions.length);
  }
  const semanticKeys = [
    "target",
    "selector",
    "caller",
    "executionDelaySeconds",
    "stateDelaySeconds",
    "stateDelayAnchor",
    "precondition",
    "recipient",
  ];
  for (let index = 0; index < canonical.mutations.length; index += 1) {
    const expected = canonical.mutations[index] as JsonRecord;
    const actual = manifest.accessManager.protocolPermissions[index] as JsonRecord;
    for (const key of semanticKeys) {
      const expectedValue = expected[key] ?? (key === "stateDelaySeconds" ? 0 : "NONE");
      if (actual[key] !== expectedValue) fail(`protocolPermissions.${index}.${key}`, expectedValue, actual[key]);
    }
    const module = manifest.protocolModules[stringField(expected, "target")]!;
    same(`protocolPermissions.${index}.targetAddress`, stringField(module, "deployedAddress"), stringField(actual, "targetAddress"));
    const expectedRoleId = roleIds.get(stringField(expected, "caller")) ?? "0";
    if (stringField(actual, "roleId") !== expectedRoleId) fail(`protocolPermissions.${index}.roleId`, expectedRoleId, actual.roleId);
  }
  if (manifest.accessManager.administrativePermissions.length !== canonical.administrative.length) {
    fail("administrative permission count", canonical.administrative.length, manifest.accessManager.administrativePermissions.length);
  }
  for (let index = 0; index < canonical.administrative.length; index += 1) {
    const expected = canonical.administrative[index] as JsonRecord;
    const actual = manifest.accessManager.administrativePermissions[index] as JsonRecord;
    const signature = stringField(expected, "signature");
    same(`administrativePermissions.${index}.selector`, selector(signature), stringField(actual, "selector"));
    same(`administrativePermissions.${index}.targetAddress`, stringField(manifest.accessManager, "address"), stringField(actual, "targetAddress"));
    for (const [expectedKey, actualKey] of [["module", "target"], ["caller", "caller"], ["recipient", "recipient"]] as const) {
      if (actual[actualKey] !== expected[expectedKey]) fail(`administrativePermissions.${index}.${actualKey}`, expected[expectedKey], actual[actualKey]);
    }
    if (typeof expected.delaySeconds === "number" && actual.executionDelaySeconds !== expected.delaySeconds) {
      fail(`administrativePermissions.${index}.executionDelaySeconds`, expected.delaySeconds, actual.executionDelaySeconds);
    }
    const expectedRoleId = roleIds.get(stringField(expected, "caller")) ?? "0";
    if (stringField(actual, "roleId") !== expectedRoleId) fail(`administrativePermissions.${index}.roleId`, expectedRoleId, actual.roleId);
  }
}

async function verifyMarketProbe(manifest: Manifest, rpc: V2ReadOnlyRpc, blockTag: string): Promise<number> {
  const probe = manifest.livePreflight.marketProbe;
  const poolKey = probe.poolKey as JsonRecord;
  const marketId = stringField(probe, "marketId");
  const poolId = stringField(probe, "poolId");
  const sourceVersion = BigInt(numberField(probe, "sourceVersion"));
  const hook = stringField(manifest.hook, "address");
  same("livePreflight.marketProbe.marketId", stringField(manifest.create2, "marketId"), marketId);
  same("livePreflight.marketProbe.poolKey.hooks", hook, stringField(poolKey, "hooks"));
  same("livePreflight.marketProbe.activeFeeSource", hook, stringField(probe, "activeFeeSource"));
  same("livePreflight.marketProbe.launchLocker", stringField(manifest.create2.components.LOCKER!, "actualAddress"), stringField(probe, "launchLocker"));
  same("livePreflight.marketProbe.poolId", expectedPoolId(poolKey), poolId);

  const registry = stringField(manifest.protocolModules.MarketRegistryV2!, "deployedAddress");
  const active = words(await rpcCall(rpc, registry, callData("activeFeeSource(bytes32)", [marketId.slice(2)]), blockTag, "activeFeeSource"), "activeFeeSource", 2);
  same("activeFeeSource.address", stringField(probe, "activeFeeSource"), wordAddress(active[0] as string));
  if (wordUint(active[1] as string) !== sourceVersion) fail("activeFeeSource.sourceVersion", sourceVersion, wordUint(active[1] as string));

  const canonicalId = words(await rpcCall(rpc, registry, callData("canonicalPoolId(bytes32)", [marketId.slice(2)]), blockTag, "canonicalPoolId"), "canonicalPoolId", 1);
  same("canonicalPoolId", poolId, `0x${canonicalId[0]}`);

  const keyWords = words(await rpcCall(rpc, registry, callData("canonicalPoolKey(bytes32)", [marketId.slice(2)]), blockTag, "canonicalPoolKey"), "canonicalPoolKey", 5);
  same("canonicalPoolKey.currency0", stringField(poolKey, "currency0"), wordAddress(keyWords[0] as string));
  same("canonicalPoolKey.currency1", stringField(poolKey, "currency1"), wordAddress(keyWords[1] as string));
  if (wordUint(keyWords[2] as string) !== 0n) fail("canonicalPoolKey.fee", 0, wordUint(keyWords[2] as string));
  if (wordSigned24(keyWords[3] as string) !== numberField(poolKey, "tickSpacing")) fail("canonicalPoolKey.tickSpacing", numberField(poolKey, "tickSpacing"), wordSigned24(keyWords[3] as string));
  same("canonicalPoolKey.hooks", hook, wordAddress(keyWords[4] as string));

  const market = words(await rpcCall(rpc, registry, callData("market(bytes32)", [marketId.slice(2)]), blockTag, "market"), "market", 24);
  same("market.runtime.poolId", poolId, `0x${market[16]}`);
  if (wordUint(market[17] as string) !== sourceVersion) fail("market.runtime.sourceVersion", sourceVersion, wordUint(market[17] as string));

  const mask = words(await rpcCall(rpc, hook, callData("hookPermissionMask()"), blockTag, "hookPermissionMask"), "hookPermissionMask", 1);
  if (wordUint(mask[0] as string) !== 8260n) fail("hookPermissionMask", 8260, wordUint(mask[0] as string));
  if ((BigInt(hook) & 0x3fffn) !== 0x2044n) fail("hook address low 14 bits", "0x2044", quantity(BigInt(hook) & 0x3fffn));

  const marketOfPool = words(await rpcCall(rpc, hook, callData("marketOfPool(bytes32)", [poolId.slice(2)]), blockTag, "marketOfPool"), "marketOfPool", 1);
  same("hook.marketOfPool", marketId, `0x${marketOfPool[0]}`);
  const binding = words(await rpcCall(rpc, hook, callData("poolBinding(bytes32)", [poolId.slice(2)]), blockTag, "poolBinding"), "poolBinding", 5);
  same("poolBinding.marketId", marketId, `0x${binding[0]}`);
  same("poolBinding.keyHash", poolId, `0x${binding[1]}`);
  if (wordUint(binding[2] as string) !== sourceVersion) fail("poolBinding.sourceVersion", sourceVersion, wordUint(binding[2] as string));
  if (wordUint(binding[4] as string) !== BigInt(numberField(probe, "expectedBindingStatus"))) fail("poolBinding.status", numberField(probe, "expectedBindingStatus"), wordUint(binding[4] as string));

  const stateView = stringField(manifest.externalDependencies.stateView!, "address");
  const slot0 = words(await rpcCall(rpc, stateView, callData("getSlot0(bytes32)", [poolId.slice(2)]), blockTag, "StateView.getSlot0"), "StateView.getSlot0", 4);
  if (wordUint(slot0[2] as string) !== 0n) fail("StateView.protocolFee", 0, wordUint(slot0[2] as string));
  if (wordUint(slot0[3] as string) !== 0n) fail("StateView.lpFee", 0, wordUint(slot0[3] as string));

  const tokenId = BigInt(stringField(probe, "positionTokenId"));
  const positionManager = stringField(manifest.externalDependencies.positionManager!, "address");
  const owner = words(await rpcCall(rpc, positionManager, callData("ownerOf(uint256)", [uintWord(tokenId)]), blockTag, "PositionManager.ownerOf"), "PositionManager.ownerOf", 1);
  same("PositionManager.ownerOf", stringField(probe, "launchLocker"), wordAddress(owner[0] as string));
  const locker = stringField(probe, "launchLocker");
  const locked = words(await rpcCall(rpc, locker, callData("lockedPosition()"), blockTag, "LaunchLocker.lockedPosition"), "LaunchLocker.lockedPosition", 2);
  if (wordUint(locked[0] as string) !== tokenId) fail("LaunchLocker.positionTokenId", tokenId, wordUint(locked[0] as string));
  same("LaunchLocker.poolId", poolId, `0x${locked[1]}`);
  return 10;
}

type RpcLog = { topics: string[]; data: string; blockNumber: string | undefined; transactionIndex: string | undefined; logIndex: string | undefined };

function sortedLogs(value: unknown): RpcLog[] {
  if (!Array.isArray(value)) throw new Error("V2 live preflight eth_getLogs returned non-array");
  const logs = value.map((entry) => {
    if (entry === null || typeof entry !== "object") throw new Error("V2 live preflight malformed log");
    const record = entry as JsonRecord;
    if (!Array.isArray(record.topics) || record.topics.some((topic) => typeof topic !== "string")) throw new Error("V2 live preflight malformed log topics");
    return { topics: record.topics as string[], data: stringField(record, "data"), blockNumber: record.blockNumber as string | undefined, transactionIndex: record.transactionIndex as string | undefined, logIndex: record.logIndex as string | undefined };
  });
  const order = (log: RpcLog) => [log.blockNumber, log.transactionIndex, log.logIndex].map((part) => BigInt(part ?? "0x0"));
  return logs.sort((left, right) => {
    const a = order(left); const b = order(right);
    for (let index = 0; index < a.length; index += 1) {
      if ((a[index] as bigint) < (b[index] as bigint)) return -1;
      if ((a[index] as bigint) > (b[index] as bigint)) return 1;
    }
    return 0;
  });
}

async function verifyAccessManager(manifest: Manifest, rpc: V2ReadOnlyRpc, blockTag: string): Promise<{ permissions: number; administrativePermissions: number; memberships: number; revoked: number; events: number }> {
  const manager = stringField(manifest.accessManager, "address");
  const expectedAssignments = new Map<string, bigint>();
  const targets = new Set<string>();
  for (const [index, permission] of manifest.accessManager.protocolPermissions.entries()) {
    const target = stringField(permission, "targetAddress");
    const functionSelector = stringField(permission, "selector");
    const expectedRole = BigInt(stringField(permission, "roleId"));
    targets.add(target.toLowerCase());
    const result = words(await rpcCall(rpc, manager, callData("getTargetFunctionRole(address,bytes4)", [addressWord(target), bytes4Word(functionSelector)]), blockTag, `permission.${index}`), `permission.${index}`, 1);
    if (wordUint(result[0] as string) !== expectedRole) fail(`permission.${index}.roleId`, expectedRole, wordUint(result[0] as string));
    if (expectedRole !== 0n) expectedAssignments.set(`${target.toLowerCase()}:${functionSelector.toLowerCase()}`, expectedRole);
  }
  for (const target of targets) {
    const closed = words(await rpcCall(rpc, manager, callData("isTargetClosed(address)", [addressWord(target)]), blockTag, `isTargetClosed.${target}`), `isTargetClosed.${target}`, 1);
    if (wordUint(closed[0] as string) !== 0n) fail(`isTargetClosed.${target}`, false, true);
  }

  let memberships = 0;
  const protocolAdminRole = BigInt(stringField(manifest.accessManager.roles.find((role) => role.roleName === "PROTOCOL_ADMIN_ROLE")!, "roleId"));
  const pauseGuardianRole = BigInt(stringField(manifest.accessManager.roles.find((role) => role.roleName === "PAUSE_GUARDIAN_ROLE")!, "roleId"));
  for (const role of manifest.accessManager.roles) {
    const roleId = BigInt(stringField(role, "roleId"));
    const expectedDelay = BigInt(numberField(role, "executionDelaySeconds"));
    for (const member of role.members as string[]) {
      const result = words(await rpcCall(rpc, manager, callData("hasRole(uint64,address)", [uintWord(roleId), addressWord(member)]), blockTag, `hasRole.${roleId}.${member}`), "hasRole", 2);
      if (wordUint(result[0] as string) !== 1n) fail(`hasRole.${roleId}.${member}.member`, true, false);
      if (wordUint(result[1] as string) !== expectedDelay) fail(`hasRole.${roleId}.${member}.delay`, expectedDelay, wordUint(result[1] as string));
      memberships += 1;
    }
    const admin = words(await rpcCall(rpc, manager, callData("getRoleAdmin(uint64)", [uintWord(roleId)]), blockTag, `getRoleAdmin.${roleId}`), "getRoleAdmin", 1);
    if (wordUint(admin[0] as string) !== protocolAdminRole) {
      fail(`getRoleAdmin.${roleId}`, protocolAdminRole, wordUint(admin[0] as string));
    }
    const expectedGuardian = role.roleName === "PAUSE_GUARDIAN_ROLE" ? 0n : pauseGuardianRole;
    const guardian = words(await rpcCall(rpc, manager, callData("getRoleGuardian(uint64)", [uintWord(roleId)]), blockTag, `getRoleGuardian.${roleId}`), "getRoleGuardian", 1);
    if (wordUint(guardian[0] as string) !== expectedGuardian) {
      fail(`getRoleGuardian.${roleId}`, expectedGuardian, wordUint(guardian[0] as string));
    }
  }
  const revokedAccounts = manifest.livePreflight.revokedAccounts;
  if (!revokedAccounts.some((account) => account.toLowerCase() === stringField(manifest.roleHandoff, "deployer").toLowerCase())) {
    throw new Error("V2 live preflight revokedAccounts must include roleHandoff.deployer");
  }
  let revoked = 0;
  for (const account of revokedAccounts) {
    for (const role of manifest.accessManager.roles) {
      const roleId = BigInt(stringField(role, "roleId"));
      const result = words(await rpcCall(rpc, manager, callData("hasRole(uint64,address)", [uintWord(roleId), addressWord(account)]), blockTag, `revoked.${roleId}.${account}`), "revoked hasRole", 2);
      if (wordUint(result[0] as string) !== 0n || wordUint(result[1] as string) !== 0n) fail(`revoked.${roleId}.${account}`, "false,0", `${wordUint(result[0] as string)},${wordUint(result[1] as string)}`);
      revoked += 1;
    }
  }

  const topic0 = `0x${Buffer.from(keccak_256(new TextEncoder().encode("TargetFunctionRoleUpdated(address,bytes4,uint64)"))).toString("hex")}`;
  const rawLogs = await rpc.request("eth_getLogs", [{ address: manager, fromBlock: quantity(stringField(manifest.livePreflight, "accessManagerDeploymentBlockNumber")), toBlock: blockTag, topics: [topic0] }]);
  const logs = sortedLogs(rawLogs);
  const actualAssignments = new Map<string, bigint>();
  for (const [index, log] of logs.entries()) {
    if (log.topics.length !== 3) throw new Error(`V2 live preflight malformed AccessManager event ${index}`);
    const target = wordAddress(normalizedHex(log.topics[1], "event target").slice(2));
    const roleId = wordUint(normalizedHex(log.topics[2], "event role").slice(2));
    const data = words(log.data, "TargetFunctionRoleUpdated.data", 1);
    const functionSelector = `0x${(data[0] as string).slice(0, 8)}`;
    const key = `${target}:${functionSelector}`;
    if (roleId === 0n) actualAssignments.delete(key);
    else actualAssignments.set(key, roleId);
  }
  const render = (map: Map<string, bigint>) => [...map].map(([key, role]) => `${key}:${role}`).sort();
  const expectedRendered = render(expectedAssignments);
  const actualRendered = render(actualAssignments);
  if (JSON.stringify(expectedRendered) !== JSON.stringify(actualRendered)) fail("AccessManager exact selector event diff", JSON.stringify(expectedRendered), JSON.stringify(actualRendered));

  const roleGrantedTopic = `0x${Buffer.from(keccak_256(new TextEncoder().encode("RoleGranted(uint64,address,uint32,uint48,bool)"))).toString("hex")}`;
  const roleRevokedTopic = `0x${Buffer.from(keccak_256(new TextEncoder().encode("RoleRevoked(uint64,address)"))).toString("hex")}`;
  const rawRoleLogs = await rpc.request("eth_getLogs", [{
    address: manager,
    fromBlock: quantity(stringField(manifest.livePreflight, "accessManagerDeploymentBlockNumber")),
    toBlock: blockTag,
    topics: [[roleGrantedTopic, roleRevokedTopic]],
  }]);
  const roleLogs = sortedLogs(rawRoleLogs);
  const actualMembers = new Map<string, bigint>();
  for (const [index, log] of roleLogs.entries()) {
    if (log.topics.length !== 3) throw new Error(`V2 live preflight malformed AccessManager role event ${index}`);
    const eventTopic = normalizedHex(log.topics[0], "role event topic");
    const roleId = wordUint(normalizedHex(log.topics[1], "role event role").slice(2));
    const account = wordAddress(normalizedHex(log.topics[2], "role event account").slice(2));
    const key = `${roleId}:${account}`;
    if (eventTopic === roleGrantedTopic) {
      const data = words(log.data, "RoleGranted.data", 3);
      actualMembers.set(key, wordUint(data[0] as string));
    } else if (eventTopic === roleRevokedTopic) {
      actualMembers.delete(key);
    } else {
      throw new Error(`V2 live preflight unexpected AccessManager role event ${index}`);
    }
  }
  const expectedMembers = new Map<string, bigint>();
  for (const role of manifest.accessManager.roles) {
    const roleId = stringField(role, "roleId");
    const delay = BigInt(numberField(role, "executionDelaySeconds"));
    for (const member of role.members as string[]) expectedMembers.set(`${roleId}:${member.toLowerCase()}`, delay);
  }
  const renderMembers = (map: Map<string, bigint>) => [...map].map(([key, delay]) => `${key}:${delay}`).sort();
  if (JSON.stringify(renderMembers(expectedMembers)) !== JSON.stringify(renderMembers(actualMembers))) {
    fail("AccessManager exact role event diff", JSON.stringify(renderMembers(expectedMembers)), JSON.stringify(renderMembers(actualMembers)));
  }
  return {
    permissions: manifest.accessManager.protocolPermissions.length,
    administrativePermissions: manifest.accessManager.administrativePermissions.length,
    memberships,
    revoked,
    events: logs.length + roleLogs.length,
  };
}

async function verifyRoleHandoffReceipts(
  manifest: Manifest,
  rpc: V2ReadOnlyRpc,
  finalizedBlockNumber: bigint,
): Promise<number> {
  const expectedReceipts: Array<{ transactionHash: string; blockNumber: string; label: string }> = [];
  for (const [index, transaction] of (manifest.roleHandoff.handoffTransactions as JsonRecord[]).entries()) {
    expectedReceipts.push({
      transactionHash: stringField(transaction, "transactionHash"),
      blockNumber: stringField(transaction, "blockNumber"),
      label: `roleHandoff.handoffTransactions.${index}`,
    });
  }
  expectedReceipts.push({
    transactionHash: stringField(manifest.roleHandoff, "deployerRevocationTransactionHash"),
    blockNumber: stringField(manifest.roleHandoff, "deployerRevocationBlock"),
    label: "roleHandoff.deployerRevocation",
  });
  for (const expected of expectedReceipts) {
    const raw = await rpc.request("eth_getTransactionReceipt", [expected.transactionHash]);
    if (raw === null || typeof raw !== "object") {
      throw new Error(`V2 live preflight missing transaction receipt: ${expected.label}`);
    }
    const receipt = raw as JsonRecord;
    same(`${expected.label}.transactionHash`, expected.transactionHash, stringField(receipt, "transactionHash"));
    const receiptBlock = BigInt(stringField(receipt, "blockNumber"));
    if (receiptBlock !== BigInt(expected.blockNumber)) fail(`${expected.label}.blockNumber`, expected.blockNumber, receiptBlock);
    if (receiptBlock > finalizedBlockNumber) fail(`${expected.label}.finality`, `<=${finalizedBlockNumber}`, receiptBlock);
    if (BigInt(stringField(receipt, "status")) !== 1n) fail(`${expected.label}.status`, 1, receipt.status);
    normalizedHex(receipt.blockHash, `${expected.label}.blockHash`);
  }
  return expectedReceipts.length;
}

export async function verifyV2LiveState(candidate: unknown, rpc: V2ReadOnlyRpc): Promise<V2LivePreflightReport> {
  assertV2DeploymentManifest(candidate);
  const manifest = candidate as Manifest;
  verifyProxyEvidence(manifest);
  comparePermissionSemantics(manifest);
  const expectedChainId = BigInt(numberField(manifest.chain, "chainId"));
  const rawChainId = await rpc.request("eth_chainId", []);
  if (typeof rawChainId !== "string" || !/^0x[0-9a-fA-F]+$/.test(rawChainId)) {
    throw new Error("V2 live preflight invalid quantity from eth_chainId");
  }
  const actualChainId = BigInt(rawChainId);
  if (actualChainId !== expectedChainId) fail("chain.chainId", expectedChainId, actualChainId);
  const blockNumber = stringField(manifest.chain, "finalizedBlockNumber");
  const blockTag = quantity(blockNumber);
  const rawBlock = await rpc.request("eth_getBlockByNumber", [blockTag, false]);
  if (rawBlock === null || typeof rawBlock !== "object") throw new Error("V2 live preflight finalized block unavailable");
  const block = rawBlock as JsonRecord;
  if (BigInt(stringField(block, "number")) !== BigInt(blockNumber)) fail("chain.finalizedBlockNumber", blockNumber, block.number);
  const blockHash = stringField(manifest.chain, "finalizedBlockHash");
  same("chain.finalizedBlockHash", blockHash, stringField(block, "hash"));

  const codeExpectations = collectCodeExpectations(manifest);
  for (const check of [
    ...manifest.livePreflight.keyGetterChecks,
    ...manifest.livePreflight.storageChecks,
  ]) {
    const target = stringField(check, "target").toLowerCase();
    if (!codeExpectations.has(target)) {
      throw new Error(`V2 live preflight probe target is not a manifested contract: ${target}`);
    }
  }
  for (const [address, expectation] of codeExpectations) {
    const code = normalizedHex(await rpc.request("eth_getCode", [address, blockTag]), `eth_getCode:${address}`);
    if (code === "0x") throw new Error(`V2 live preflight empty code at ${address} (${expectation.labels.join(", ")})`);
    same(`runtimeCodeHash:${expectation.labels.join("+")}`, expectation.hash, keccakHex(code));
  }

  let getterChecks = 0;
  for (const check of manifest.livePreflight.keyGetterChecks) {
    const result = await rpcCall(rpc, stringField(check, "target"), stringField(check, "callData"), blockTag, stringField(check, "label"));
    same(`keyGetterChecks.${stringField(check, "label")}`, stringField(check, "expectedReturnDataHash"), keccakHex(result));
    getterChecks += 1;
  }
  let storageChecks = 0;
  for (const check of manifest.livePreflight.storageChecks) {
    const actual = normalizedHex(await rpc.request("eth_getStorageAt", [stringField(check, "target"), stringField(check, "slot"), blockTag]), `eth_getStorageAt:${stringField(check, "label")}`);
    same(`storageChecks.${stringField(check, "label")}`, stringField(check, "expectedValue"), actual);
    storageChecks += 1;
  }

  getterChecks += await verifyMarketProbe(manifest, rpc, blockTag);
  const access = await verifyAccessManager(manifest, rpc, blockTag);
  const transactionReceiptsChecked = await verifyRoleHandoffReceipts(
    manifest,
    rpc,
    BigInt(blockNumber),
  );
  return Object.freeze({
    chainId: Number(actualChainId),
    blockNumber,
    blockHash,
    codeHashesChecked: codeExpectations.size,
    getterChecks,
    storageChecks,
    permissionChecks: access.permissions,
    administrativePermissionChecks: access.administrativePermissions,
    roleMembershipChecks: access.memberships,
    revokedMembershipChecks: access.revoked,
    accessManagerEvents: access.events,
    transactionReceiptsChecked,
  });
}

export async function preflightV2Deployment(candidate: unknown, rpc: V2ReadOnlyRpc): Promise<V2LivePreflightReport> {
  assertV2Deployable();
  return verifyV2LiveState(candidate, rpc);
}

export async function preflightProductionManifest(candidate: unknown, rpc: V2ReadOnlyRpc): Promise<V2LivePreflightReport> {
  assertV2Deployable();
  assertV2ProductionReady();
  return verifyV2LiveState(candidate, rpc);
}
