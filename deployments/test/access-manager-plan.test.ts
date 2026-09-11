import assert from "node:assert/strict";
import { test } from "node:test";
import { keccak_256 } from "@noble/hashes/sha3.js";

import { deriveV1AccessManagerPlan, V1_ACCESS_ROLES, type V1AccessManagerPlanInput } from "../src/v1/access-manager-plan.ts";
import { compiled, permissions, address as fixtureAddress } from "./manifest-fixture.ts";

const selector = (signature: string) => `0x${Buffer.from(keccak_256(new TextEncoder().encode(signature))).subarray(0, 4).toString("hex")}`;

function configuredSelectors(data: string): string[] {
  const words = data.slice(10).match(/.{64}/g) ?? [];
  assert.ok(words.length >= 4);
  const count = Number(BigInt(`0x${words[3]}`));
  return words.slice(4, 4 + count).map((word) => `0x${word.slice(0, 8)}`);
}

function input(overrides: Partial<V1AccessManagerPlanInput> = {}): V1AccessManagerPlanInput {
  const moduleAddresses = Object.fromEntries(compiled.modules.map(({ target }) => [target, fixtureAddress(`module:${target}`)]));
  return {
    accessManager: fixtureAddress("access-manager-plan"),
    deployer: fixtureAddress("deployer"),
    governanceSafe: fixtureAddress("governance-safe"),
    guardianSafe: fixtureAddress("guardian-safe"),
    securityOrGovernanceSafe: fixtureAddress("security-safe"),
    moduleAddresses,
    ...overrides,
  };
}

test("derives 19 protocol role selectors and 64 immutable direct selectors from the current manifest", () => {
  const plan = deriveV1AccessManagerPlan(input());
  assert.equal(compiled.modules.length, 18);
  assert.equal(compiled.mutations.length, 83);
  assert.equal(plan.configuredProtocolSelectorCount, 19);
  assert.equal(plan.immutableDirectSelectorCount, 64);
  assert.equal(plan.roles.length, 3);
  assert.deepEqual(plan.roles.map((role) => [role.name, role.roleId, role.executionDelaySeconds]), [
    ["PROTOCOL_ADMIN_ROLE", V1_ACCESS_ROLES.PROTOCOL_ADMIN_ROLE.toString(), 172800],
    ["PAUSE_GUARDIAN_ROLE", V1_ACCESS_ROLES.PAUSE_GUARDIAN_ROLE.toString(), 0],
    ["UNPAUSE_ROLE", V1_ACCESS_ROLES.UNPAUSE_ROLE.toString(), 86400],
  ]);
  assert.equal(plan.permanentlyLockedAdminSelectors.length, 8);
  assert.equal(new Set(plan.permanentlyLockedAdminSelectors).size, 8);
});

test("binds all five roles to the intended Safe members and exposes no delayed terminal rescue", () => {
  const plan = deriveV1AccessManagerPlan(input());
  assert.deepEqual(plan.roles.map((role) => role.member), [
    fixtureAddress("governance-safe").toLowerCase(),
    fixtureAddress("guardian-safe").toLowerCase(),
    fixtureAddress("security-safe").toLowerCase(),
  ]);
  assert.ok(compiled.mutations.every((row) => row.stateDelaySeconds === 0));
  for (const removedSignature of [
    "retryGraduation(bytes32)",
    "rescueSweptLaunch(bytes32)",
    "markSwept(bytes32)",
    "markRescued(bytes32)",
  ]) {
    assert.equal(compiled.mutations.some((row) => row.displaySignature === removedSignature), false);
  }
  assert.equal(plan.actions.filter((action) => action.phase === "PROTOCOL_SELECTORS").reduce((n, action) => n + Number(action.description.match(/\((\d+) selector/)?.[1] ?? 0), 0), 19);
  assert.equal(plan.actions.filter((action) => action.phase === "BOOTSTRAP_GUARDIANS").length, 2);
});

test("configures only current privileged selectors and leaves lifecycle operations direct", () => {
  const plan = deriveV1AccessManagerPlan(input());
  const protocolActions = plan.actions.filter((action) => action.phase === "PROTOCOL_SELECTORS");
  const configured = protocolActions.flatMap((action) => configuredSelectors(action.data));
  assert.equal(configured.length, plan.configuredProtocolSelectorCount);
  for (const directSignature of [
    "activateMarket(bytes32)",
    "fundQuoteTreasury(bytes32,uint256,bytes32)",
    "burnMeme(bytes32,uint256,bytes32)",
    "setFundingInterval(bytes32,uint256)",
    "fundCreatorFees(bytes32,uint32,uint256)",
    "claim(bytes32)",
  ]) {
    assert.ok(!configured.includes(selector(directSignature)), directSignature);
  }
});

test("freezes V1 role admins before the final deployer renounce", () => {
  const plan = deriveV1AccessManagerPlan(input());
  const phases = plan.actions.map((action) => action.phase);
  const freeze = phases.indexOf("FREEZE_ADMIN_SURFACE");
  const renounce = phases.indexOf("RENOUNCE_DEPLOYER");
  assert.ok(freeze >= 0 && renounce > freeze);
  assert.equal(plan.actions.filter((action) => action.phase === "FREEZE_ADMIN_SURFACE").length, 3);
  assert.ok(plan.actions.filter((action) => action.phase === "FREEZE_ADMIN_SURFACE").every((action) => action.signature === "setRoleAdmin(uint64,uint64)"));
  assert.equal(plan.actions[renounce]?.signature, "renounceRole(uint64,address)");
  assert.equal(plan.actions[renounce]?.data.slice(0, 10), selector("renounceRole(uint64,address)"));
  const canonicalAdmin = permissions.functions.filter((row) => row.module === "AccessManager");
  assert.deepEqual(canonicalAdmin.filter((row) => row.caller === "PROTOCOL_ADMIN_ROLE").map((row) => row.signature), [
    "grantRole(uint64,address,uint32)", "revokeRole(uint64,address)",
  ]);
  assert.equal(canonicalAdmin.find((row) => row.signature === "setTargetFunctionRole(address,bytes4[],uint64)")?.caller, "ADMIN_ROLE_BOOTSTRAP_ONLY");
  const frozen = plan.permanentlyLockedAdminSelectors;
  for (const signature of ["labelRole(uint64,string)", "setRoleAdmin(uint64,uint64)", "setRoleGuardian(uint64,uint64)", "setGrantDelay(uint64,uint32)", "setTargetAdminDelay(address,uint32)", "setTargetClosed(address,bool)", "setTargetFunctionRole(address,bytes4[],uint64)", "updateAuthority(address,address)"]) {
    assert.ok(frozen.includes(selector(signature)), signature);
  }
});

test("fails closed for missing, extra, aliased, and zero deployment addresses", () => {
  const base = input();
  const missing = { ...base, moduleAddresses: { ...base.moduleAddresses } };
  delete missing.moduleAddresses[compiled.modules[0]!.target];
  assert.throws(() => deriveV1AccessManagerPlan(missing), /Missing V1 module address/);
  assert.throws(() => deriveV1AccessManagerPlan({ ...base, moduleAddresses: { ...base.moduleAddresses, Extra: fixtureAddress("extra") } }), /Unexpected V1 module address/);
  const aliased = { ...base, moduleAddresses: { ...base.moduleAddresses, [compiled.modules[1]!.target]: base.moduleAddresses[compiled.modules[0]!.target]! } };
  assert.throws(() => deriveV1AccessManagerPlan(aliased), /Aliased V1 deployment address/);
  assert.throws(() => deriveV1AccessManagerPlan({ ...base, guardianSafe: "0x0000000000000000000000000000000000000000" }), /Invalid guardianSafe/);
  assert.throws(() => deriveV1AccessManagerPlan({ ...base, deployer: base.governanceSafe }), /deployer must not retain/);
  assert.throws(() => deriveV1AccessManagerPlan({ ...base, accessManager: base.securityOrGovernanceSafe }), /AccessManager must not alias/);
  assert.throws(() => deriveV1AccessManagerPlan({ ...base, guardianSafe: base.governanceSafe }), /independent Safe/);
  assert.doesNotThrow(() => deriveV1AccessManagerPlan({ ...base, securityOrGovernanceSafe: base.governanceSafe }));
  assert.throws(() => deriveV1AccessManagerPlan({ ...base, moduleAddresses: { ...base.moduleAddresses, [compiled.modules[0]!.target]: base.guardianSafe } }), /Aliased V1 deployment address/);
  assert.throws(() => deriveV1AccessManagerPlan({ ...base, moduleAddresses: { ...base.moduleAddresses, [compiled.modules[0]!.target]: "0x0000000000000000000000000000000000000000" } }), /Invalid moduleAddresses/);
});

test("configurable Holder interval uses delayed protocol admin before bootstrap closure", () => {
  const base = deriveV1AccessManagerPlan(input());
  const plan = deriveV1AccessManagerPlan(input({holderRewardsDistributor: fixtureAddress("holder-v3")}));
  assert.equal(plan.configuredProtocolSelectorCount, base.configuredProtocolSelectorCount + 1);
  const index = plan.actions.findIndex(a => a.phase === "PROTOCOL_SELECTORS" && configuredSelectors(a.data).includes(selector("setFundingInterval(bytes32,uint256)")));
  assert.ok(index >= 0);
  assert.ok(index < plan.actions.findIndex(a => a.phase === "RENOUNCE_DEPLOYER"));
  assert.equal(plan.roles.find(r => r.name === "PROTOCOL_ADMIN_ROLE")?.executionDelaySeconds, 172800);
  assert.throws(() => deriveV1AccessManagerPlan(input({holderRewardsDistributor: fixtureAddress("governance-safe")})), /Aliased/);
});
