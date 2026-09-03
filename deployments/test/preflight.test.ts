import assert from "node:assert/strict";
import { test } from "node:test";
import { keccak_256 } from "@noble/hashes/sha3.js";

import { HttpV2ReadOnlyRpc, preflightV2Deployment, verifyV2LiveState, type V2ReadOnlyRpc } from "../src/v2/preflight.ts";
import { address, clone, validManifest, type JsonRecord } from "./manifest-fixture.ts";

function bytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.slice(2).match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
}

function keccakHex(hex: string): string {
  return `0x${Buffer.from(keccak_256(bytes(hex))).toString("hex")}`;
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

function result(words: string[]): string {
  return `0x${words.join("")}`;
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
    stock.runtimeCodeHash = codeHash;
    stock.beaconCodeHash = codeHash;
    stock.implementationCodeHash = codeHash;
  }
  const components = (manifest.create2 as JsonRecord).components as JsonRecord;
  for (const component of Object.values(components)) (component as JsonRecord).runtimeCodeHash = codeHash;

  const live = manifest.livePreflight as JsonRecord;
  const getterResult = result([word(123n)]);
  const stockImplementation = String(((manifest.officialStocks as JsonRecord[])[0] as JsonRecord).implementationAddress);
  for (const check of live.keyGetterChecks as JsonRecord[]) {
    const expectedResult = check.category === "PROXY_OR_BEACON_LINKAGE"
      ? result([addressWord(stockImplementation)])
      : getterResult;
    check.expectedReturnDataHash = keccakHex(expectedResult);
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

type Faults = Partial<{
  chainId: string;
  blockHash: string;
  code: string;
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
}>;

class MockRpc implements V2ReadOnlyRpc {
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
      const callResult = check.category === "PROXY_OR_BEACON_LINKAGE"
        ? result([addressWord(stockImplementation)])
        : result([word(123n)]);
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
      return this.#faults.code ?? "0x60006000";
    }
    if (method === "eth_getStorageAt") {
      assert.equal(params[2], this.#blockTag);
      const check = (((this.#manifest.livePreflight as JsonRecord).storageChecks as JsonRecord[])[0])!;
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
  const report = await verifyV2LiveState(manifest, rpc);
  assert.equal(report.chainId, 4663);
  assert.equal(report.permissionChecks, 80);
  assert.equal(report.administrativePermissionChecks, 6);
  assert.equal(report.roleMembershipChecks, 4);
  assert.equal(report.revokedMembershipChecks, 4);
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
    await assert.rejects(verifyV2LiveState(manifest, new MockRpc(manifest, faults)), expected, label);
  }
});

test("deployment entry remains blocked by central readiness before any RPC call", async () => {
  const manifest = prepareManifest();
  const rpc = new MockRpc(manifest);
  await assert.rejects(preflightV2Deployment(manifest, rpc), /deployment gates/);
  assert.deepEqual(rpc.methods, []);
});

test("rejects manifest-level proxy linkage and permission semantic drift before RPC", async () => {
  const badBeacon = prepareManifest();
  const storage = ((badBeacon.livePreflight as JsonRecord).storageChecks as JsonRecord[])[0]!;
  storage.expectedValue = `0x${addressWord(address("wrong-beacon"))}`;
  const beaconRpc = new MockRpc(badBeacon);
  await assert.rejects(verifyV2LiveState(badBeacon, beaconRpc), /beaconSlot/);
  assert.deepEqual(beaconRpc.methods, []);

  const badPermission = prepareManifest();
  const permission = (((badPermission.accessManager as JsonRecord).protocolPermissions as JsonRecord[]).find(
    (row) => row.stateDelaySeconds === 604800,
  ))!;
  permission.stateDelaySeconds = 0;
  const permissionRpc = new MockRpc(badPermission);
  await assert.rejects(verifyV2LiveState(badPermission, permissionRpc), /stateDelaySeconds/);
  assert.deepEqual(permissionRpc.methods, []);
});

test("rejects every canonical permission semantic and role-handoff drift before RPC", async () => {
  const cases: Array<[string, (manifest: JsonRecord) => void]> = [
    ["missing selector", (manifest) => { ((manifest.accessManager as JsonRecord).protocolPermissions as JsonRecord[]).splice(0, 1); }],
    ["extra selector", (manifest) => { const rows = (manifest.accessManager as JsonRecord).protocolPermissions as JsonRecord[]; rows.push(clone(rows[0]!)); }],
    ["role", (manifest) => { (((manifest.accessManager as JsonRecord).protocolPermissions as JsonRecord[])[0]!).roleId = "99"; }],
    ["member", (manifest) => { (((manifest.accessManager as JsonRecord).roles as JsonRecord[])[0]!).members = [address("wrong-member")]; }],
    ["execution delay", (manifest) => { (((manifest.accessManager as JsonRecord).protocolPermissions as JsonRecord[])[0]!).executionDelaySeconds = 99; }],
    ["state delay", (manifest) => { const row = ((manifest.accessManager as JsonRecord).protocolPermissions as JsonRecord[]).find((item) => item.stateDelaySeconds === 604800)!; row.stateDelaySeconds = 0; }],
    ["recipient", (manifest) => { (((manifest.accessManager as JsonRecord).protocolPermissions as JsonRecord[])[0]!).recipient = "arbitrary"; }],
    ["precondition", (manifest) => { (((manifest.accessManager as JsonRecord).protocolPermissions as JsonRecord[])[0]!).precondition = "BYPASS"; }],
    ["deployer alias", (manifest) => { (manifest.roleHandoff as JsonRecord).deployer = (manifest.roleHandoff as JsonRecord).governanceSafe; }],
    ["module alias", (manifest) => { ((manifest.protocolModules as JsonRecord).OfficialStockRegistryV2 as JsonRecord).deployedAddress = (manifest.roleHandoff as JsonRecord).recoverySafe; }],
  ];
  for (const [label, mutate] of cases) {
    const manifest = prepareManifest();
    mutate(manifest);
    const rpc = new MockRpc(manifest);
    await assert.rejects(verifyV2LiveState(manifest, rpc), undefined, label);
    assert.deepEqual(rpc.methods, [], label);
  }
});

test("HTTP transport rejects write RPC methods before network access", async () => {
  const rpc = new HttpV2ReadOnlyRpc("https://rpc.release.invalid");
  await assert.rejects(rpc.request("eth_sendRawTransaction", ["0x00"]), /non-read-only RPC method/);
});
