import assert from "node:assert/strict";
import { test } from "node:test";
import { keccak_256 } from "@noble/hashes/sha3.js";

import { HttpV1ReadOnlyRpc, preflightV1Deployment, verifyV1LiveState, type V1ReadOnlyRpc } from "../src/v1/preflight.ts";
import { address, clone, hash, validManifest, type JsonRecord } from "./manifest-fixture.ts";

function bytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.slice(2).match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
}

function keccakHex(hex: string): string {
  return `0x${Buffer.from(keccak_256(bytes(hex))).toString("hex")}`;
}

function keccakUtf8(value: string): string {
  return `0x${Buffer.from(keccak_256(new TextEncoder().encode(value))).toString("hex")}`;
}

function selector(signature: string): string {
  return `0x${Buffer.from(keccak_256(new TextEncoder().encode(signature))).subarray(0, 4).toString("hex")}`;
}

function word(value: bigint | number | string): string {
  return BigInt(value).toString(16).padStart(64, "0");
}

function addressWord(value: string): string {
  return value.slice(2).toLowerCase().padStart(64, "0");
}

function bytes4Word(value: string): string {
  return value.slice(2).toLowerCase().padEnd(64, "0");
}

function signedWord(value: number): string {
  return (value < 0 ? (1n << 256n) + BigInt(value) : BigInt(value)).toString(16).padStart(64, "0");
}

function data(signature: string, arguments_: string[] = []): string {
  return `${selector(signature)}${arguments_.join("")}`;
}

const ERC1967_IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const ERC1967_ADMIN_SLOT = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";
const ERC1967_BEACON_SLOT = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";
const ZERO_STORAGE_WORD = `0x${"00".repeat(32)}`;

function immutableBeaconProxyRuntime(beacon: string): string {
  return `0x6080604052600a600c565b005b60186014601a565b609d565b565b5f7f${"00".repeat(12)}${beacon.slice(2).toLowerCase()}6001600160a01b0316635c60da1b6040518163ffffffff1660e01b8152600401602060405180830381865afa1580156076573d5f803e3d5ffd5b505050506040513d601f19601f820116820180604052508101906098919060ba565b905090565b365f80375f80365f845af43d5f803e80801560b6573d5ff35b3d5ffd5b5f6020828403121560c9575f80fd5b81516001600160a01b038116811460de575f80fd5b939250505056`;
}

function result(words: string[]): string {
  return `0x${words.join("")}`;
}

function resolverBindingResult(manifest: JsonRecord, label: unknown): string | undefined {
  const modules = manifest.protocolModules as JsonRecord;
  const registryByLabel: Readonly<Record<string, string>> = {
    "resolver-approved-quote-registry": "ApprovedQuoteRegistry",
    "resolver-tickergarden-baseline-registry": "TickerGardenBaselineRegistry",
    "resolver-launch-template-registry": "LaunchTemplateRegistry",
  };
  const registryName = registryByLabel[String(label)];
  if (registryName === undefined) return undefined;
  return result([addressWord(String((modules[registryName] as JsonRecord).deployedAddress))]);
}

function treasuryBindingResult(manifest: JsonRecord, label: unknown): string | undefined {
  if (label === "treasury-access-manager-authority") {
    return result([addressWord(String((manifest.accessManager as JsonRecord).address))]);
  }
  if (label === "holder-market-registry") {
    const modules = manifest.protocolModules as JsonRecord;
    return result([addressWord(String((modules.MarketRegistryV1 as JsonRecord).deployedAddress))]);
  }
  return undefined;
}

function registryAuthorityResult(manifest: JsonRecord, label: unknown): string | undefined {
  const registryLabels = new Set([
    "official-stock-registry-access-manager-authority",
    "approved-quote-registry-access-manager-authority",
    "tickergarden-baseline-registry-access-manager-authority",
    "launch-template-registry-access-manager-authority",
  ]);
  if (!registryLabels.has(String(label))) return undefined;
  return result([addressWord(String((manifest.accessManager as JsonRecord).address))]);
}

function quoteRegistryStockBindingResult(manifest: JsonRecord, label: unknown): string | undefined {
  if (label !== "approved-quote-registry-official-stock-registry") return undefined;
  const modules = manifest.protocolModules as JsonRecord;
  return result([addressWord(String((modules.OfficialStockRegistryV1 as JsonRecord).deployedAddress))]);
}

function stockIdentityResult(manifest: JsonRecord, label: unknown): string | undefined {
  const stock = ((manifest.officialStocks as JsonRecord[])[0])!;
  if (label === "stock-uid") return result([String(stock.assetUid).slice(2)]);
  if (label === "stock-decimals") return result([word(stock.decimals as number)]);
  return undefined;
}

function stockQuoteIdentityResult(manifest: JsonRecord, label: unknown): string | undefined {
  const stock = ((manifest.officialStocks as JsonRecord[])[0])!;
  if (label === "official-stock-quote-uid") return result([String(stock.assetUid).slice(2)]);
  if (label === "official-stock-quote-decimals") return result([word(stock.decimals as number)]);
  if (label === "official-stock-quote-beacon-implementation") {
    return result([addressWord(String(stock.implementationAddress))]);
  }
  return undefined;
}

function stockQuoteFingerprintHash(manifest: JsonRecord, stock: JsonRecord): string {
  return keccakHex(`0x${[
    keccakUtf8("TICKERGARDEN_V1_STOCK_QUOTE_FINGERPRINT").slice(2), word(1),
    word((manifest.chain as JsonRecord).chainId as number), String(stock.assetUid).slice(2),
    addressWord(String(stock.tokenAddress)), word(stock.decimals as number), String(stock.runtimeCodeHash).slice(2),
    addressWord(String(stock.beaconAddress)), String(stock.beaconCodeHash).slice(2),
    addressWord(String(stock.implementationAddress)), String(stock.implementationCodeHash).slice(2),
  ].join("")}`);
}

function stockQuoteEconomicsHash(manifest: JsonRecord, quote: JsonRecord): string {
  return keccakHex(`0x${[
    keccakUtf8("TICKERGARDEN_V1_STOCK_QUOTE_ECONOMICS").slice(2), word(1),
    word((manifest.chain as JsonRecord).chainId as number), String(quote.tickerGardenBaselineId).slice(2),
    addressWord(String(quote.tokenAddress)), word(quote.decimals as number), word(quote.phantomQuote as string),
    word(quote.graduationThreshold as string), String(quote.assetUid).slice(2),
    String(quote.stockTokenFingerprintHash).slice(2), String(quote.referenceEvidenceHash).slice(2),
    String(quote.generatorPolicyId).slice(2),
  ].join("")}`);
}

function prepareManifest(): JsonRecord {
  const manifest = clone(validManifest());
  const codeHash = keccakHex("0x60006000");
  for (const dependency of Object.values(manifest.externalDependencies as JsonRecord)) {
    (dependency as JsonRecord).runtimeCodeHash = codeHash;
  }
  for (const module of Object.values(manifest.protocolModules as JsonRecord)) {
    (module as JsonRecord).runtimeCodeHash = codeHash;
  }
  (manifest.hook as JsonRecord).runtimeCodeHash = codeHash;
  (manifest.accessManager as JsonRecord).runtimeCodeHash = codeHash;
  for (const stock of manifest.officialStocks as JsonRecord[]) {
    stock.runtimeCodeHash = keccakHex(immutableBeaconProxyRuntime(String(stock.beaconAddress)));
    stock.beaconCodeHash = codeHash;
    stock.implementationCodeHash = codeHash;
  }
  const components = (manifest.create2 as JsonRecord).components as JsonRecord;
  for (const component of Object.values(components)) (component as JsonRecord).runtimeCodeHash = codeHash;
  (components.GAUGE as JsonRecord).implementationCodeHash = codeHash;

  const live = manifest.livePreflight as JsonRecord;
  const getterResult = result([word(123n)]);
  const stockImplementation = String(((manifest.officialStocks as JsonRecord[])[0] as JsonRecord).implementationAddress);
  for (const check of live.keyGetterChecks as JsonRecord[]) {
    const expectedResult = resolverBindingResult(manifest, check.label) ?? registryAuthorityResult(manifest, check.label)
      ?? quoteRegistryStockBindingResult(manifest, check.label)
      ?? treasuryBindingResult(manifest, check.label)
      ?? stockIdentityResult(manifest, check.label)
      ?? stockQuoteIdentityResult(manifest, check.label) ?? (check.label === "gauge-clone-identity"
      ? result(Array.from({ length: 8 }, () => word(123n)))
      : check.category === "PROXY_OR_BEACON_LINKAGE"
        ? result([addressWord(stockImplementation)])
        : getterResult);
    check.expectedReturnDataHash = keccakHex(expectedResult);
    if (check.label === "gauge-clone-identity") {
      (components.GAUGE as JsonRecord).immutableArgsHash = check.expectedReturnDataHash;
    }
  }
  const probe = live.marketProbe as JsonRecord;
  probe.launchLocker = ((components.LOCKER as JsonRecord).actualAddress as string);
  const key = probe.poolKey as JsonRecord;
  const encodedKey = result([
    addressWord(key.currency0 as string),
    addressWord(key.currency1 as string),
    word(key.fee as number),
    signedWord(key.tickSpacing as number),
    addressWord(key.hooks as string),
  ]);
  probe.poolId = keccakHex(encodedKey);
  return manifest;
}

function prepareImmutableErc20QuoteManifest(): JsonRecord {
  const manifest = prepareManifest();
  const quoteConfigId = hash("immutable-erc20-quote");
  const token = address("immutable-erc20-quote-token");
  const runtimeCodeHash = keccakHex("0x60006000");
  (manifest.configSnapshot as JsonRecord).quoteConfigIds = [quoteConfigId];
  manifest.quoteAssets = [{
    configId: quoteConfigId,
    tickerGardenBaselineId: hash("baseline"),
    economicsHash: hash("immutable-erc20-economics"),
    assetKind: "ERC20",
    tokenAddress: token,
    decimals: 6,
    phantomQuote: "1000000",
    graduationThreshold: "2000000",
    runtimeCodeHash,
    proxyKind: "NONE",
    implementationAddress: token,
    implementationCodeHash: runtimeCodeHash,
    observationBlockHash: hash("immutable-erc20-observation"),
    exactBalanceDeltaEvidenceHash: hash("immutable-erc20-balance-delta"),
  }];
  const live = manifest.livePreflight as JsonRecord;
  (live.keyGetterChecks as JsonRecord[]).push({
    label: "immutable-erc20-quote-decimals",
    category: "EXTERNAL_IDENTITY",
    target: token,
    callData: selector("decimals()"),
    expectedReturnDataHash: keccakHex(`0x${word(6)}`),
  });
  (live.storageChecks as JsonRecord[]).push(
    { label: "immutable-erc20-quote-implementation-slot", target: token, slot: ERC1967_IMPLEMENTATION_SLOT, expectedValue: ZERO_STORAGE_WORD },
    { label: "immutable-erc20-quote-admin-slot", target: token, slot: ERC1967_ADMIN_SLOT, expectedValue: ZERO_STORAGE_WORD },
    { label: "immutable-erc20-quote-beacon-slot", target: token, slot: ERC1967_BEACON_SLOT, expectedValue: ZERO_STORAGE_WORD },
  );
  return manifest;
}

function prepareOfficialStockQuoteManifest(): JsonRecord {
  const manifest = prepareManifest();
  const stock = (manifest.officialStocks as JsonRecord[])[0]!;
  const quote: JsonRecord = {
    assetKind: "OFFICIAL_STOCK", assetUid: stock.assetUid, tokenAddress: stock.tokenAddress, decimals: stock.decimals,
    phantomQuote: "1000000", graduationThreshold: "2000000", tickerGardenBaselineId: hash("baseline"),
    runtimeCodeHash: stock.runtimeCodeHash, proxyKind: stock.proxyKind, beaconAddress: stock.beaconAddress,
    beaconCodeHash: stock.beaconCodeHash, implementationAddress: stock.implementationAddress,
    implementationCodeHash: stock.implementationCodeHash, referenceEvidenceHash: hash("stock-quote-reference"),
    generatorPolicyId: hash("stock-quote-generator"), stockTokenFingerprintHash: "0x" + "00".repeat(32),
    configId: "0x" + "00".repeat(32), economicsHash: "0x" + "00".repeat(32),
    observationBlockHash: hash("stock-quote-observation"), exactBalanceDeltaEvidenceHash: hash("stock-quote-balance-delta"),
  };
  quote.stockTokenFingerprintHash = stockQuoteFingerprintHash(manifest, stock);
  quote.configId = stockQuoteEconomicsHash(manifest, quote);
  quote.economicsHash = quote.configId;
  (manifest.configSnapshot as JsonRecord).quoteConfigIds = [quote.configId];
  manifest.quoteAssets = [quote];
  const live = manifest.livePreflight as JsonRecord;
  (live.keyGetterChecks as JsonRecord[]).push(
    { label: "official-stock-quote-uid", category: "EXTERNAL_IDENTITY", target: quote.tokenAddress, callData: selector("uid()"), expectedReturnDataHash: keccakHex(result([String(stock.assetUid).slice(2)])) },
    { label: "official-stock-quote-decimals", category: "EXTERNAL_IDENTITY", target: quote.tokenAddress, callData: selector("decimals()"), expectedReturnDataHash: keccakHex(result([word(stock.decimals as number)])) },
    { label: "official-stock-quote-beacon-implementation", category: "PROXY_OR_BEACON_LINKAGE", target: quote.beaconAddress, callData: selector("implementation()"), expectedReturnDataHash: keccakHex(result([addressWord(String(stock.implementationAddress))])) },
  );
  (live.storageChecks as JsonRecord[]).push({ label: "official-stock-quote-beacon-slot", target: quote.tokenAddress, slot: ERC1967_BEACON_SLOT, expectedValue: `0x${String(quote.beaconAddress).slice(2).padStart(64, "0")}` });
  return manifest;
}

function prepareDirectOfficialStockManifest(): JsonRecord {
  const manifest = prepareManifest();
  const stock = (manifest.officialStocks as JsonRecord[])[0]!;
  const token = String(stock.tokenAddress);
  stock.proxyKind = "DIRECT";
  stock.runtimeCodeHash = keccakHex("0x60006000");
  stock.implementationAddress = token;
  stock.implementationCodeHash = stock.runtimeCodeHash;
  delete stock.beaconAddress;
  delete stock.beaconCodeHash;
  const live = manifest.livePreflight as JsonRecord;
  live.keyGetterChecks = (live.keyGetterChecks as JsonRecord[]).filter((entry) => entry.label !== "stock-beacon-implementation");
  const beaconSlot = (live.storageChecks as JsonRecord[]).find((entry) => entry.label === "stock-beacon-slot")!;
  beaconSlot.label = "stock-beacon-slot";
  beaconSlot.expectedValue = ZERO_STORAGE_WORD;
  (live.storageChecks as JsonRecord[]).push(
    { label: "stock-implementation-slot", target: token, slot: ERC1967_IMPLEMENTATION_SLOT, expectedValue: ZERO_STORAGE_WORD },
    { label: "stock-admin-slot", target: token, slot: ERC1967_ADMIN_SLOT, expectedValue: ZERO_STORAGE_WORD },
  );
  return manifest;
}

type Faults = Partial<{
  chainId: string;
  blockHash: string;
  code: string;
  codeByAddress: Readonly<Record<string, string>>;
  getterResult: string;
  storageValue: string;
  sourceVersion: bigint;
  protocolFee: bigint;
  revokeLeak: boolean;
  extraPermissionEvent: boolean;
  missingPermissionEvent: boolean;
  extraRoleMember: boolean;
  roleAdmin: bigint;
  roleGuardian: bigint;
  permissionRole: bigint;
  membershipDelay: bigint;
  receiptStatus: string;
  stockUidResult: string;
  stockDecimalsResult: string;
  quoteUidResult: string;
  quoteDecimalsResult: string;
  quoteBeaconImplementationResult: string;
}>;

class MockRpc implements V1ReadOnlyRpc {
  readonly methods: string[] = [];
  readonly #manifest: JsonRecord;
  readonly #faults: Faults;
  readonly #calls = new Map<string, string>();
  readonly #permissionRoles = new Map<string, bigint>();
  readonly #memberRoles = new Map<string, { member: boolean; delay: bigint }>();
  readonly #targetLogs: JsonRecord[] = [];
  readonly #roleLogs: JsonRecord[] = [];
  readonly #blockTag: string;

  constructor(manifest: JsonRecord, faults: Faults = {}) {
    this.#manifest = manifest;
    this.#faults = faults;
    const chain = manifest.chain as JsonRecord;
    this.#blockTag = `0x${BigInt(chain.finalizedBlockNumber as string).toString(16)}`;
    const live = manifest.livePreflight as JsonRecord;
    for (const check of live.keyGetterChecks as JsonRecord[]) {
      const stockImplementation = String((((manifest.officialStocks as JsonRecord[])[0])!).implementationAddress);
      const canonicalStockResult = stockIdentityResult(manifest, check.label);
      const stockResult = check.label === "stock-uid"
        ? faults.stockUidResult ?? canonicalStockResult
        : check.label === "stock-decimals"
          ? faults.stockDecimalsResult ?? canonicalStockResult
          : check.label === "official-stock-quote-uid"
            ? faults.quoteUidResult ?? stockQuoteIdentityResult(manifest, check.label)
          : check.label === "official-stock-quote-decimals"
            ? faults.quoteDecimalsResult ?? stockQuoteIdentityResult(manifest, check.label)
            : check.label === "official-stock-quote-beacon-implementation"
              ? faults.quoteBeaconImplementationResult ?? stockQuoteIdentityResult(manifest, check.label)
          : canonicalStockResult;
      const callResult = resolverBindingResult(manifest, check.label) ?? registryAuthorityResult(manifest, check.label)
        ?? quoteRegistryStockBindingResult(manifest, check.label)
        ?? treasuryBindingResult(manifest, check.label)
        ?? stockResult ?? (check.label === "gauge-clone-identity"
        ? result(Array.from({ length: 8 }, () => word(123n)))
        : check.label === "immutable-erc20-quote-decimals"
          ? result([word(6)])
        : check.category === "PROXY_OR_BEACON_LINKAGE"
          ? result([addressWord(stockImplementation)])
          : result([word(123n)]));
      this.#calls.set(`${String(check.target).toLowerCase()}:${String(check.callData).toLowerCase()}`, callResult);
    }
    const access = manifest.accessManager as JsonRecord;
    for (const permission of access.protocolPermissions as JsonRecord[]) {
      const target = String(permission.targetAddress).toLowerCase();
      const functionSelector = String(permission.selector).toLowerCase();
      const role = BigInt(permission.roleId as string);
      this.#permissionRoles.set(`${target}:${functionSelector}`, role);
      if (role !== 0n) {
        this.#targetLogs.push({
          topics: [
            `0x${Buffer.from(keccak_256(new TextEncoder().encode("TargetFunctionRoleUpdated(address,bytes4,uint64)"))).toString("hex")}`,
            `0x${addressWord(target)}`,
            `0x${word(role)}`,
          ],
          data: `0x${bytes4Word(functionSelector)}`,
          blockNumber: "0x1e208",
          transactionIndex: "0x0",
          logIndex: `0x${this.#targetLogs.length.toString(16)}`,
        });
      }
    }
    const roleGrantedTopic = `0x${Buffer.from(keccak_256(new TextEncoder().encode("RoleGranted(uint64,address,uint32,uint48,bool)"))).toString("hex")}`;
    const roleRevokedTopic = `0x${Buffer.from(keccak_256(new TextEncoder().encode("RoleRevoked(uint64,address)"))).toString("hex")}`;
    const deployer = String((manifest.roleHandoff as JsonRecord).deployer);
    this.#roleLogs.push({
      topics: [roleGrantedTopic, `0x${word(0)}`, `0x${addressWord(deployer)}`],
      data: result([word(0), word(1), word(1)]),
      blockNumber: "0x1e208",
      transactionIndex: "0x0",
      logIndex: "0x0",
    });
    for (const role of access.roles as JsonRecord[]) {
      const roleId = String(role.roleId);
      for (const member of role.members as string[]) {
        this.#memberRoles.set(`${roleId}:${member.toLowerCase()}`, { member: true, delay: BigInt(role.executionDelaySeconds as number) });
        this.#roleLogs.push({
          topics: [roleGrantedTopic, `0x${word(roleId)}`, `0x${addressWord(member)}`],
          data: result([word(role.executionDelaySeconds as number), word(1), word(1)]),
          blockNumber: "0x1e209",
          transactionIndex: "0x0",
          logIndex: `0x${this.#roleLogs.length.toString(16)}`,
        });
      }
    }
    this.#roleLogs.push({
      topics: [roleRevokedTopic, `0x${word(0)}`, `0x${addressWord(deployer)}`],
      data: "0x",
      blockNumber: "0x1e20a",
      transactionIndex: "0x0",
      logIndex: `0x${this.#roleLogs.length.toString(16)}`,
    });
  }

  async request(method: string, params: readonly unknown[]): Promise<unknown> {
    this.methods.push(method);
    if (method === "eth_chainId") return this.#faults.chainId ?? "0x1237";
    if (method === "eth_getBlockByNumber") {
      assert.equal(params[0], this.#blockTag);
      return { number: this.#blockTag, hash: this.#faults.blockHash ?? (this.#manifest.chain as JsonRecord).finalizedBlockHash };
    }
    if (method === "eth_getCode") {
      assert.equal(params[1], this.#blockTag);
      const target = String(params[0]).toLowerCase();
      const stock = (this.#manifest.officialStocks as JsonRecord[]).find(
        (entry) => String(entry.tokenAddress).toLowerCase() === target,
      );
      const stockRuntime = stock !== undefined && stock.proxyKind === "IMMUTABLE_BEACON"
        ? immutableBeaconProxyRuntime(String(stock.beaconAddress))
        : undefined;
      return this.#faults.codeByAddress?.[String(params[0]).toLowerCase()]
        ?? this.#faults.code
        ?? stockRuntime
        ?? "0x60006000";
    }
    if (method === "eth_getStorageAt") {
      assert.equal(params[2], this.#blockTag);
      const target = String(params[0]).toLowerCase();
      const slot = String(params[1]).toLowerCase();
      const check = ((this.#manifest.livePreflight as JsonRecord).storageChecks as JsonRecord[]).find(
        (entry) => String(entry.target).toLowerCase() === target && String(entry.slot).toLowerCase() === slot,
      );
      if (check === undefined) throw new Error(`unexpected storage check ${target}:${slot}`);
      return this.#faults.storageValue ?? check.expectedValue;
    }
    if (method === "eth_getLogs") {
      const filter = params[0] as JsonRecord;
      assert.equal(filter.toBlock, this.#blockTag);
      if (Array.isArray((filter.topics as unknown[])[0])) {
        if (!this.#faults.extraRoleMember) return this.#roleLogs;
        const roleGrantedTopic = ((filter.topics as unknown[])[0] as string[])[0]!;
        return [...this.#roleLogs, {
          topics: [roleGrantedTopic, `0x${word(99n)}`, `0x${addressWord(address("unexpected-role-member"))}`],
          data: result([word(0), word(1), word(1)]),
          blockNumber: this.#blockTag,
          transactionIndex: "0x0",
          logIndex: "0xffff",
        }];
      }
      if (this.#faults.missingPermissionEvent) return this.#targetLogs.slice(1);
      if (!this.#faults.extraPermissionEvent) return this.#targetLogs;
      return [...this.#targetLogs, {
        topics: [(filter.topics as string[])[0], `0x${addressWord(address("unexpected-target"))}`, `0x${word(99n)}`],
        data: `0x${bytes4Word("0xdeadbeef")}`,
        blockNumber: this.#blockTag,
        transactionIndex: "0x0",
        logIndex: "0xffff",
      }];
    }
    if (method === "eth_getTransactionReceipt") {
      const transactionHash = String(params[0]);
      const handoff = this.#manifest.roleHandoff as JsonRecord;
      const transaction = (handoff.handoffTransactions as JsonRecord[]).find((item) => item.transactionHash === transactionHash);
      const blockNumber = transaction === undefined ? String(handoff.deployerRevocationBlock) : String(transaction.blockNumber);
      return { transactionHash, blockNumber: `0x${BigInt(blockNumber).toString(16)}`, blockHash: (this.#manifest.chain as JsonRecord).finalizedBlockHash, status: this.#faults.receiptStatus ?? "0x1" };
    }
    if (method !== "eth_call") throw new Error(`unexpected method ${method}`);
    assert.equal(params[1], this.#blockTag);
    const call = params[0] as JsonRecord;
    const to = String(call.to).toLowerCase();
    const callData = String(call.data).toLowerCase();
    const generic = this.#calls.get(`${to}:${callData}`);
    if (generic !== undefined) return this.#faults.getterResult ?? generic;

    const signature = callData.slice(0, 10);
    const probe = ((this.#manifest.livePreflight as JsonRecord).marketProbe as JsonRecord);
    const poolKey = probe.poolKey as JsonRecord;
    const sourceVersion = this.#faults.sourceVersion ?? BigInt(probe.sourceVersion as number);
    if (signature === selector("activeFeeSource(bytes32)")) return result([addressWord(probe.activeFeeSource as string), word(sourceVersion)]);
    if (signature === selector("canonicalPoolId(bytes32)")) return result([(probe.poolId as string).slice(2)]);
    if (signature === selector("canonicalPoolKey(bytes32)")) return result([addressWord(poolKey.currency0 as string), addressWord(poolKey.currency1 as string), word(0), signedWord(poolKey.tickSpacing as number), addressWord(poolKey.hooks as string)]);
    if (signature === selector("market(bytes32)")) {
      const output = Array.from({ length: 24 }, () => word(0));
      output[16] = (probe.poolId as string).slice(2);
      output[17] = word(sourceVersion);
      return result(output);
    }
    if (signature === selector("hookPermissionMask()")) return result([word(8260)]);
    if (signature === selector("marketOfPool(bytes32)")) return result([(probe.marketId as string).slice(2)]);
    if (signature === selector("poolBinding(bytes32)")) return result([(probe.marketId as string).slice(2), (probe.poolId as string).slice(2), word(sourceVersion), word(1), word(probe.expectedBindingStatus as number)]);
    if (signature === selector("getSlot0(bytes32)")) return result([word(1), word(0), word(this.#faults.protocolFee ?? 0n), word(0)]);
    if (signature === selector("ownerOf(uint256)")) return result([addressWord(probe.launchLocker as string)]);
    if (signature === selector("lockedPosition()")) return result([word(probe.positionTokenId as string), (probe.poolId as string).slice(2)]);
    if (signature === selector("isTargetClosed(address)")) return result([word(0)]);
    if (signature === selector("getRoleAdmin(uint64)")) return result([word(this.#faults.roleAdmin ?? 1n)]);
    if (signature === selector("getRoleGuardian(uint64)")) {
      const roleId = BigInt(`0x${callData.slice(10, 74)}`);
      return result([word(this.#faults.roleGuardian ?? (roleId === 2n ? 0n : 2n))]);
    }
    if (signature === selector("getTargetFunctionRole(address,bytes4)")) {
      const target = `0x${callData.slice(10 + 24, 10 + 64)}`;
      const functionSelector = `0x${callData.slice(10 + 64, 10 + 72)}`;
      return result([word(this.#faults.permissionRole ?? this.#permissionRoles.get(`${target}:${functionSelector}`) ?? 0n)]);
    }
    if (signature === selector("hasRole(uint64,address)")) {
      const roleId = BigInt(`0x${callData.slice(10, 74)}`).toString();
      const account = `0x${callData.slice(10 + 64 + 24, 10 + 128)}`;
      const known = this.#memberRoles.get(`${roleId}:${account}`);
      if (known !== undefined) return result([word(1), word(this.#faults.membershipDelay ?? known.delay)]);
      if (this.#faults.revokeLeak) return result([word(1), word(0)]);
      return result([word(0), word(0)]);
    }
    throw new Error(`unexpected eth_call ${to} ${callData}`);
  }
}

test("verifies complete live state at one finalized block using read-only RPC only", async () => {
  const manifest = prepareManifest();
  const rpc = new MockRpc(manifest);
  const report = await verifyV1LiveState(manifest, rpc);
  assert.equal(report.chainId, 4663);
  assert.equal(report.permissionChecks, 83);
  assert.equal(report.administrativePermissionChecks, 6);
  assert.equal(report.roleMembershipChecks, 3);
  assert.equal(report.revokedMembershipChecks, 3);
  assert.ok(report.codeHashesChecked >= 30);
  assert.ok(report.getterChecks >= 12);
  assert.equal(report.transactionReceiptsChecked, 2);
  assert.deepEqual(new Set(rpc.methods), new Set(["eth_chainId", "eth_getBlockByNumber", "eth_getCode", "eth_call", "eth_getStorageAt", "eth_getLogs", "eth_getTransactionReceipt"]));
});

test("fails closed on chain, code, getter, storage, source, fee, role and selector-event drift", async () => {
  const cases: Array<[string, Faults, RegExp]> = [
    ["chain", { chainId: "0x1" }, /chain\.chainId/],
    ["block", { blockHash: `0x${"ab".repeat(32)}` }, /finalizedBlockHash/],
    ["code", { code: "0x6001" }, /runtimeCodeHash/],
    ["getter", { getterResult: result([word(999)]) }, /keyGetterChecks/],
    ["storage", { storageValue: `0x${"ab".repeat(32)}` }, /storageChecks/],
    ["source", { sourceVersion: 3n }, /sourceVersion/],
    ["protocol fee", { protocolFee: 1n }, /protocolFee/],
    ["revoked role", { revokeLeak: true }, /revoked/],
    ["extra selector", { extraPermissionEvent: true }, /exact selector event diff/],
    ["missing selector", { missingPermissionEvent: true }, /exact selector event diff/],
    ["wrong selector role", { permissionRole: 99n }, /permission\.0\.roleId/],
    ["extra role member", { extraRoleMember: true }, /exact role event diff/],
    ["wrong member delay", { membershipDelay: 99n }, /\.delay/],
    ["wrong role admin", { roleAdmin: 4n }, /getRoleAdmin/],
    ["wrong role guardian", { roleGuardian: 4n }, /getRoleGuardian/],
    ["failed handoff", { receiptStatus: "0x0" }, /status/],
  ];
  for (const [label, faults, expected] of cases) {
    const manifest = prepareManifest();
    await assert.rejects(verifyV1LiveState(manifest, new MockRpc(manifest, faults)), expected, label);
  }
});

test("deployment entry verifies the reviewed candidate with live bindings", async () => {
  const manifest = prepareManifest();
  const rpc = new MockRpc(manifest);
  await preflightV1Deployment(manifest, rpc);
  assert.ok(rpc.methods.length > 0);
});

test("rejects manifest-level proxy linkage and permission semantic drift before RPC", async () => {
  const badBeacon = prepareManifest();
  const storage = ((badBeacon.livePreflight as JsonRecord).storageChecks as JsonRecord[])[0]!;
  storage.expectedValue = `0x${addressWord(address("wrong-beacon"))}`;
  const beaconRpc = new MockRpc(badBeacon);
  await assert.rejects(verifyV1LiveState(badBeacon, beaconRpc), /beaconSlot/);
  assert.deepEqual(beaconRpc.methods, []);

  const badPermission = prepareManifest();
  const permission = ((badPermission.accessManager as JsonRecord).protocolPermissions as JsonRecord[])[0]!;
  permission.stateDelaySeconds = 1;
  const permissionRpc = new MockRpc(badPermission);
  await assert.rejects(verifyV1LiveState(badPermission, permissionRpc), /stateDelaySeconds/);
  assert.deepEqual(permissionRpc.methods, []);
});

test("rejects an immutable Beacon runtime whose embedded Beacon disagrees with manifested linkage", async () => {
  const manifest = prepareManifest();
  const stock = (manifest.officialStocks as JsonRecord[])[0]!;
  const wrongRuntime = immutableBeaconProxyRuntime(address("wrong-embedded-beacon"));
  stock.runtimeCodeHash = keccakHex(wrongRuntime);
  await assert.rejects(
    verifyV1LiveState(
      manifest,
      new MockRpc(manifest, {
        codeByAddress: { [String(stock.tokenAddress).toLowerCase()]: wrongRuntime },
      }),
    ),
    /immutableBeaconRuntime/,
  );
});

test("rejects decoy Beacon code even when its runtime hash and storage linkage are approved", async () => {
  const manifest = prepareManifest();
  const stock = (manifest.officialStocks as JsonRecord[])[0]!;
  const decoy = `0x365f5f375f5f365f5f545af43d5f5f3e3d5ff37f${"00".repeat(12)}${String(stock.beaconAddress).slice(2)}6001600160a01b0316635c60da1b`;
  stock.runtimeCodeHash = keccakHex(decoy);
  await assert.rejects(verifyV1LiveState(manifest, new MockRpc(manifest, {
    codeByAddress: { [String(stock.tokenAddress).toLowerCase()]: decoy },
  })), /immutable Beacon proxy runtime is unrecognized/);
});

test("fails closed when finalized stock UID or decimals evidence is missing or drifts", async () => {
  for (const label of ["stock-uid", "stock-decimals"]) {
    const missing = prepareManifest();
    const live = missing.livePreflight as JsonRecord;
    live.keyGetterChecks = (live.keyGetterChecks as JsonRecord[]).filter((entry) => entry.label !== label);
    const missingRpc = new MockRpc(missing);
    await assert.rejects(
      verifyV1LiveState(missing, missingRpc),
      new RegExp(`officialStocks\\.0\\.${label === "stock-uid" ? "uidGetter" : "decimalsGetter"}`),
    );
    assert.deepEqual(missingRpc.methods, [], label);

    const drifted = prepareManifest();
    const faults = label === "stock-uid"
      ? { stockUidResult: result([word(999n)]) }
      : { stockDecimalsResult: result([word(999n)]) };
    const driftedRpc = new MockRpc(drifted, faults);
    await assert.rejects(verifyV1LiveState(drifted, driftedRpc), new RegExp(`keyGetterChecks\\.${label}`));
    assert.ok(driftedRpc.methods.includes("eth_call"), label);
  }
});

test("rejects Gauge clone implementation and immutable-identity drift before RPC", async () => {
  const wrongImplementation = prepareManifest();
  const gauge = (((wrongImplementation.create2 as JsonRecord).components as JsonRecord).GAUGE as JsonRecord);
  gauge.implementationAddress = address("wrong-gauge-implementation");
  const implementationRpc = new MockRpc(wrongImplementation);
  await assert.rejects(verifyV1LiveState(wrongImplementation, implementationRpc), /implementationAddress/);
  assert.deepEqual(implementationRpc.methods, []);

  const wrongIdentity = prepareManifest();
  const identityCheck = ((wrongIdentity.livePreflight as JsonRecord).keyGetterChecks as JsonRecord[])
    .find((check) => check.label === "gauge-clone-identity")!;
  identityCheck.expectedReturnDataHash = keccakHex(result(Array.from({ length: 8 }, () => word(456n))));
  const identityRpc = new MockRpc(wrongIdentity);
  await assert.rejects(verifyV1LiveState(wrongIdentity, identityRpc), /immutableArgsHash/);
  assert.deepEqual(identityRpc.methods, []);

  const wrongResolver = prepareManifest();
  const resolverCheck = ((wrongResolver.livePreflight as JsonRecord).keyGetterChecks as JsonRecord[])
    .find((check) => check.label === "resolver-approved-quote-registry")!;
  resolverCheck.expectedReturnDataHash = keccakHex(result([addressWord(address("wrong-quote-registry"))]));
  const resolverRpc = new MockRpc(wrongResolver);
  await assert.rejects(verifyV1LiveState(wrongResolver, resolverRpc), /approvedQuoteRegistry/);
  assert.deepEqual(resolverRpc.methods, []);
});

test("rejects missing or drifted Holder MarketRegistry bindings before RPC", async () => {
  const cases: Array<[string, RegExp, RegExp]> = [
    [
      "holder-market-registry",
      /HolderRewardsDistributorV1 lacks marketRegistry\(\) evidence/,
      /HolderRewardsDistributorV1\.marketRegistry\(\)/,
    ],
  ];
  for (const [label, missingError, driftError] of cases) {
    const missing = prepareManifest();
    const live = missing.livePreflight as JsonRecord;
    live.keyGetterChecks = (live.keyGetterChecks as JsonRecord[]).filter((entry) => entry.label !== label);
    const missingRpc = new MockRpc(missing);
    await assert.rejects(verifyV1LiveState(missing, missingRpc), missingError);
    assert.deepEqual(missingRpc.methods, [], label);

    const drifted = prepareManifest();
    const check = ((drifted.livePreflight as JsonRecord).keyGetterChecks as JsonRecord[])
      .find((entry) => entry.label === label)!;
    check.expectedReturnDataHash = keccakHex(result([addressWord(address(`wrong-${label}`))]));
    const driftedRpc = new MockRpc(drifted);
    await assert.rejects(verifyV1LiveState(drifted, driftedRpc), driftError);
    assert.deepEqual(driftedRpc.methods, [], label);
  }
});

test("rejects missing or drifted Registry AccessManager bindings before RPC", async () => {
  const registries = [
    ["OfficialStockRegistryV1", "official-stock-registry-access-manager-authority"],
    ["ApprovedQuoteRegistry", "approved-quote-registry-access-manager-authority"],
    ["TickerGardenBaselineRegistry", "tickergarden-baseline-registry-access-manager-authority"],
    ["LaunchTemplateRegistry", "launch-template-registry-access-manager-authority"],
  ] as const;
  for (const [registryName, label] of registries) {
    const missing = prepareManifest();
    const live = missing.livePreflight as JsonRecord;
    live.keyGetterChecks = (live.keyGetterChecks as JsonRecord[]).filter((entry) => entry.label !== label);
    const missingRpc = new MockRpc(missing);
    await assert.rejects(verifyV1LiveState(missing, missingRpc), new RegExp(`${registryName} lacks authority\\(\\) evidence`), registryName);
    assert.deepEqual(missingRpc.methods, [], `${registryName} missing`);

    const drifted = prepareManifest();
    const check = ((drifted.livePreflight as JsonRecord).keyGetterChecks as JsonRecord[])
      .find((entry) => entry.label === label)!;
    check.expectedReturnDataHash = keccakHex(result([addressWord(address(`wrong-${registryName}`))]));
    const driftedRpc = new MockRpc(drifted);
    await assert.rejects(verifyV1LiveState(drifted, driftedRpc), new RegExp(`protocolModules\\.${registryName}\\.authority\\(\\)`), registryName);
    assert.deepEqual(driftedRpc.methods, [], `${registryName} drifted`);

    const miscategorized = prepareManifest();
    const miscategorizedCheck = ((miscategorized.livePreflight as JsonRecord).keyGetterChecks as JsonRecord[])
      .find((entry) => entry.label === label)!;
    miscategorizedCheck.category = "EXTERNAL_IDENTITY";
    const miscategorizedRpc = new MockRpc(miscategorized);
    await assert.rejects(
      verifyV1LiveState(miscategorized, miscategorizedRpc),
      new RegExp(`${registryName} lacks authority\\(\\) evidence`),
      `${registryName} category`,
    );
    assert.deepEqual(miscategorizedRpc.methods, [], `${registryName} category`);
  }
});

test("accepts a direct immutable ERC20 Quote with pinned runtime and empty proxy slots", async () => {
  const manifest = prepareImmutableErc20QuoteManifest();
  const rpc = new MockRpc(manifest);
  const report = await verifyV1LiveState(manifest, rpc);
  assert.equal(report.storageChecks, 4);
  assert.ok(report.getterChecks >= 13);
  assert.ok(rpc.methods.includes("eth_getStorageAt"));
});

test("accepts a direct immutable Official Stock and rejects linkage, slots, and forbidden runtime", async () => {
  const manifest = prepareDirectOfficialStockManifest();
  const rpc = new MockRpc(manifest);
  const report = await verifyV1LiveState(manifest, rpc);
  assert.equal(report.storageChecks, 3);

  const badLink = prepareDirectOfficialStockManifest();
  (badLink.officialStocks as JsonRecord[])[0]!.implementationAddress = address("wrong-direct-implementation");
  await assert.rejects(verifyV1LiveState(badLink, new MockRpc(badLink)), /officialStocks\.0\.implementationAddress/);

  const badSlot = prepareDirectOfficialStockManifest();
  const slot = ((badSlot.livePreflight as JsonRecord).storageChecks as JsonRecord[]).find((entry) => entry.label === "stock-admin-slot")!;
  slot.expectedValue = `0x${address("unexpected-direct-slot").slice(2).padStart(64, "0")}`;
  await assert.rejects(verifyV1LiveState(badSlot, new MockRpc(badSlot)), /officialStocks\.0\.adminSlot/);

  const badRuntime = prepareDirectOfficialStockManifest();
  const direct = (badRuntime.officialStocks as JsonRecord[])[0]!;
  const forbidden = "0xf400";
  direct.runtimeCodeHash = keccakHex(forbidden);
  direct.implementationCodeHash = direct.runtimeCodeHash;
  await assert.rejects(verifyV1LiveState(badRuntime, new MockRpc(badRuntime, { codeByAddress: { [String(direct.tokenAddress).toLowerCase()]: forbidden } })), /direct Official Stock runtime contains forbidden opcode 0xf4/);
});

test("accepts unreachable literal data between INVALID and CBOR", async () => {
  const manifest = prepareDirectOfficialStockManifest();
  const stock = (manifest.officialStocks as JsonRecord[])[0]!;
  // CRM has literal data (including f4) after INVALID and before CBOR.
  const runtime = "0x600000fe112233f4a26469706673";
  stock.runtimeCodeHash = keccakHex(runtime);
  stock.implementationCodeHash = stock.runtimeCodeHash;
  const report = await verifyV1LiveState(manifest, new MockRpc(manifest, {
    codeByAddress: { [String(stock.tokenAddress).toLowerCase()]: runtime },
  }));
  assert.ok(report.codeHashesChecked > 0);
});

test("rejects a forbidden opcode in a jumpable INVALID suffix", async () => {
  const manifest = prepareDirectOfficialStockManifest();
  const stock = (manifest.officialStocks as JsonRecord[])[0]!;
  // JUMPDEST makes the suffix executable again; f4 must remain rejected.
  const runtime = "0xfe5bf4";
  stock.runtimeCodeHash = keccakHex(runtime);
  stock.implementationCodeHash = stock.runtimeCodeHash;
  await assert.rejects(
    verifyV1LiveState(manifest, new MockRpc(manifest, {
      codeByAddress: { [String(stock.tokenAddress).toLowerCase()]: runtime },
    })),
    /direct Official Stock runtime contains forbidden opcode 0xf4/,
  );
});

test("reviewed ERC20 proxy slots may be nonzero and remain checked against observed evidence", async () => {
  const manifest = prepareImmutableErc20QuoteManifest();
  const quote = (manifest.quoteAssets as JsonRecord[])[0]!;
  quote.proxyKind = "ERC1967";
  const checks = (manifest.livePreflight as JsonRecord).storageChecks as JsonRecord[];
  const implementationSlot = checks.find(entry => entry.label === "immutable-erc20-quote-implementation-slot")!;
  implementationSlot.expectedValue = `0x${String(quote.implementationAddress).slice(2).padStart(64, "0")}`;
  await verifyV1LiveState(manifest, new MockRpc(manifest));
  await assert.rejects(verifyV1LiveState(manifest, new MockRpc(manifest, { storageValue: ZERO_STORAGE_WORD })), /storageChecks/);
});

test("verifies OFFICIAL_STOCK Quote binding and fingerprint/economics domains", async () => {
  const manifest = prepareOfficialStockQuoteManifest();
  const report = await verifyV1LiveState(manifest, new MockRpc(manifest));
  assert.ok(report.codeHashesChecked >= 30);

  const driftCases: Array<[string, (quote: JsonRecord) => void, RegExp]> = [
    ["canonical token", (quote) => { quote.tokenAddress = address("wrong-stock-token"); }, /quoteAssets\.0\.(tokenAddress|decimalsGetter|stockTokenFingerprintHash)/],
    ["canonical UID", (quote) => { quote.assetUid = hash("wrong-stock-uid"); }, /quoteAssets\.0\.(assetUid|officialStockLink|uidGetter|stockTokenFingerprintHash)/],
    ["beacon", (quote) => { quote.beaconAddress = address("wrong-stock-beacon"); }, /quoteAssets\.0\.(beaconAddress|beaconSlot)/],
    ["implementation", (quote) => { quote.implementationAddress = address("wrong-stock-implementation"); }, /quoteAssets\.0\.(implementationAddress|beaconImplementationGetter)/],
    ["fingerprint", (quote) => { quote.stockTokenFingerprintHash = hash("wrong-fingerprint"); }, /quoteAssets\.0\.stockTokenFingerprintHash/],
    ["economics", (quote) => { quote.configId = hash("wrong-config"); }, /quoteAssets\.0\.configId/],
  ];
  for (const [label, mutate, expected] of driftCases) {
    const drifted = prepareOfficialStockQuoteManifest();
    mutate((drifted.quoteAssets as JsonRecord[])[0]!);
    await assert.rejects(verifyV1LiveState(drifted, new MockRpc(drifted)), expected, label);
  }
});

test("fails closed when OFFICIAL_STOCK Quote Beacon getter or slot evidence drifts", async () => {
  const implementationDrift = prepareOfficialStockQuoteManifest();
  await assert.rejects(
    verifyV1LiveState(implementationDrift, new MockRpc(implementationDrift, { quoteBeaconImplementationResult: result([addressWord(address("wrong-implementation"))]) })),
    /quoteAssets\.0\.beaconImplementationGetter|keyGetterChecks\.stock-beacon-implementation/,
  );
  const beaconSlotDrift = prepareOfficialStockQuoteManifest();
  await assert.rejects(
    verifyV1LiveState(beaconSlotDrift, new MockRpc(beaconSlotDrift, { storageValue: `0x${address("wrong-beacon-slot").slice(2).padStart(64, "0")}` })),
    /quoteAssets\.0\.beaconSlot|storageChecks\.stock-beacon-slot/,
  );
});

test("fails closed when immutable ERC20 Quote decimals evidence is missing or drifts", async () => {
  const missing = prepareImmutableErc20QuoteManifest();
  const live = missing.livePreflight as JsonRecord;
  live.keyGetterChecks = (live.keyGetterChecks as JsonRecord[]).filter((entry) => entry.label !== "immutable-erc20-quote-decimals");
  const missingRpc = new MockRpc(missing);
  await assert.rejects(verifyV1LiveState(missing, missingRpc), /quoteAssets\.0\.decimalsGetter/);
  assert.deepEqual(missingRpc.methods, []);

  const drifted = prepareImmutableErc20QuoteManifest();
  const check = ((drifted.livePreflight as JsonRecord).keyGetterChecks as JsonRecord[])
    .find((entry) => entry.label === "immutable-erc20-quote-decimals")!;
  check.expectedReturnDataHash = keccakHex(`0x${word(18)}`);
  const driftedRpc = new MockRpc(drifted);
  await assert.rejects(
    verifyV1LiveState(drifted, driftedRpc),
    /quoteAssets\.0\.decimalsGetter|keyGetterChecks\.immutable-erc20-quote-decimals/,
  );
});

test("accepts administrator-reviewed delegate runtime in an ERC20 Quote at the finalized block", async () => {
  const manifest = prepareImmutableErc20QuoteManifest();
  const quote = (manifest.quoteAssets as JsonRecord[])[0]!;
  const token = String(quote.tokenAddress).toLowerCase();
  const delegateRuntime = "0xf400";
  const delegateRuntimeHash = keccakHex(delegateRuntime);
  quote.runtimeCodeHash = delegateRuntimeHash;
  quote.implementationCodeHash = delegateRuntimeHash;

  const report = await verifyV1LiveState(manifest, new MockRpc(manifest, { codeByAddress: { [token]: delegateRuntime } }));
  assert.ok(report.codeHashesChecked > 0);
});

test("rejects every canonical permission semantic and role-handoff drift before RPC", async () => {
  const cases: Array<[string, (manifest: JsonRecord) => void]> = [
    ["missing selector", (manifest) => { ((manifest.accessManager as JsonRecord).protocolPermissions as JsonRecord[]).splice(0, 1); }],
    ["extra selector", (manifest) => { const rows = (manifest.accessManager as JsonRecord).protocolPermissions as JsonRecord[]; rows.push(clone(rows[0]!)); }],
    ["role", (manifest) => { (((manifest.accessManager as JsonRecord).protocolPermissions as JsonRecord[])[0]!).roleId = "99"; }],
    ["member", (manifest) => { (((manifest.accessManager as JsonRecord).roles as JsonRecord[])[0]!).members = [address("wrong-member")]; }],
    ["execution delay", (manifest) => { (((manifest.accessManager as JsonRecord).protocolPermissions as JsonRecord[])[0]!).executionDelaySeconds = 99; }],
    ["state delay", (manifest) => { ((manifest.accessManager as JsonRecord).protocolPermissions as JsonRecord[])[0]!.stateDelaySeconds = 1; }],
    ["recipient", (manifest) => { (((manifest.accessManager as JsonRecord).protocolPermissions as JsonRecord[])[0]!).recipient = "arbitrary"; }],
    ["precondition", (manifest) => { (((manifest.accessManager as JsonRecord).protocolPermissions as JsonRecord[])[0]!).precondition = "BYPASS"; }],
    ["deployer alias", (manifest) => { (manifest.roleHandoff as JsonRecord).deployer = (manifest.roleHandoff as JsonRecord).governanceSafe; }],
    ["module alias", (manifest) => { ((manifest.protocolModules as JsonRecord).OfficialStockRegistryV1 as JsonRecord).deployedAddress = (manifest.roleHandoff as JsonRecord).guardianSafe; }],
  ];
  for (const [label, mutate] of cases) {
    const manifest = prepareManifest();
    mutate(manifest);
    const rpc = new MockRpc(manifest);
    await assert.rejects(verifyV1LiveState(manifest, rpc), undefined, label);
    assert.deepEqual(rpc.methods, [], label);
  }
});

test("HTTP transport rejects write RPC methods before network access", async () => {
  const rpc = new HttpV1ReadOnlyRpc("https://rpc.release.invalid");
  await assert.rejects(rpc.request("eth_sendRawTransaction", ["0x00"]), /non-read-only RPC method/);
});
