import assert from "node:assert/strict";
import { test } from "node:test";
import { keccak_256 } from "@noble/hashes/sha3.js";

import { deriveV2AccessManagerPlan, V2_ACCESS_ROLES, type V2AccessManagerPlanInput } from "../src/v2/access-manager-plan.ts";
import { compiled, permissions, address as fixtureAddress } from "./manifest-fixture.ts";

const selector = (signature: string) => `0x${Buffer.from(keccak_256(new TextEncoder().encode(signature))).subarray(0, 4).toString("hex")}`;

function input(overrides: Partial<V2AccessManagerPlanInput> = {}): V2AccessManagerPlanInput {
  const moduleAddresses = Object.fromEntries(compiled.modules.map(({ target }) => [target, fixtureAddress(`module:${target}`)]));
  return {
    accessManager: fixtureAddress("access-manager-plan"),
    deployer: fixtureAddress("deployer"),
    governanceSafe: fixtureAddress("governance-safe"),
    guardianSafe: fixtureAddress("guardian-safe"),
    securityOrGovernanceSafe: fixtureAddress("security-safe"),
    recoverySafe: fixtureAddress("recovery-safe"),
    moduleAddresses,
    ...overrides,
  };
}

test("derives 23 protocol role selectors and 62 immutable direct selectors from the 19-module manifest", () => {
  const plan = deriveV2AccessManagerPlan(input());
  assert.equal(compiled.modules.length, 19);
  assert.equal(compiled.mutations.length, 85);
  assert.equal(plan.configuredProtocolSelectorCount, 23);
  assert.equal(plan.immutableDirectSelectorCount, 62);
  assert.equal(plan.roles.length, 4);
  assert.deepEqual(plan.roles.map((role) => [role.name, role.roleId, role.executionDelaySeconds]), [
    ["PROTOCOL_ADMIN_ROLE", V2_ACCESS_ROLES.PROTOCOL_ADMIN_ROLE.toString(), 172800],
    ["PAUSE_GUARDIAN_ROLE", V2_ACCESS_ROLES.PAUSE_GUARDIAN_ROLE.toString(), 0],
    ["UNPAUSE_ROLE", V2_ACCESS_ROLES.UNPAUSE_ROLE.toString(), 86400],
    ["RECOVERY_ROLE", V2_ACCESS_ROLES.RECOVERY_ROLE.toString(), 86400],
  ]);
  assert.equal(plan.permanentlyLockedAdminSelectors.length, 8);
  assert.equal(new Set(plan.permanentlyLockedAdminSelectors).size, 8);
});

test("binds the four roles to the intended Safe members and keeps 7d rescue as state delay only", () => {
  const plan = deriveV2AccessManagerPlan(input());
  assert.deepEqual(plan.roles.map((role) => role.member), [
    fixtureAddress("governance-safe").toLowerCase(),
    fixtureAddress("guardian-safe").toLowerCase(),
    fixtureAddress("security-safe").toLowerCase(),
    fixtureAddress("recovery-safe").toLowerCase(),
  ]);
  const rescue = compiled.mutations.find((row) => row.displaySignature === "rescueSweptLaunch(bytes32)");
  assert.equal(rescue?.stateDelaySeconds, 604800);
  assert.equal(rescue?.executionDelaySeconds, 0);
  assert.equal(plan.actions.filter((action) => action.phase === "PROTOCOL_SELECTORS").reduce((n, action) => n + Number(action.description.match(/\((\d+) selector/)?.[1] ?? 0), 0), 23);
  assert.equal(plan.actions.filter((action) => action.phase === "BOOTSTRAP_GUARDIANS").length, 3);
});

test("freezes V2 role admins before the final deployer renounce", () => {
  const plan = deriveV2AccessManagerPlan(input());
  const phases = plan.actions.map((action) => action.phase);
  const freeze = phases.indexOf("FREEZE_ADMIN_SURFACE");
  const renounce = phases.indexOf("RENOUNCE_DEPLOYER");
  assert.ok(freeze >= 0 && renounce > freeze);
  assert.equal(plan.actions.filter((action) => action.phase === "FREEZE_ADMIN_SURFACE").length, 4);
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
  assert.throws(() => deriveV2AccessManagerPlan(missing), /Missing V2 module address/);
  assert.throws(() => deriveV2AccessManagerPlan({ ...base, moduleAddresses: { ...base.moduleAddresses, Extra: fixtureAddress("extra") } }), /Unexpected V2 module address/);
  const aliased = { ...base, moduleAddresses: { ...base.moduleAddresses, [compiled.modules[1]!.target]: base.moduleAddresses[compiled.modules[0]!.target]! } };
  assert.throws(() => deriveV2AccessManagerPlan(aliased), /Aliased V2 deployment address/);
  assert.throws(() => deriveV2AccessManagerPlan({ ...base, guardianSafe: "0x0000000000000000000000000000000000000000" }), /Invalid guardianSafe/);
  assert.throws(() => deriveV2AccessManagerPlan({ ...base, deployer: base.governanceSafe }), /deployer must not retain/);
  assert.throws(() => deriveV2AccessManagerPlan({ ...base, accessManager: base.recoverySafe }), /AccessManager must not alias/);
  assert.throws(() => deriveV2AccessManagerPlan({ ...base, guardianSafe: base.governanceSafe }), /independent Safe/);
  assert.doesNotThrow(() => deriveV2AccessManagerPlan({ ...base, securityOrGovernanceSafe: base.governanceSafe }));
  assert.throws(() => deriveV2AccessManagerPlan({ ...base, moduleAddresses: { ...base.moduleAddresses, [compiled.modules[0]!.target]: base.recoverySafe } }), /Aliased V2 deployment address/);
  assert.throws(() => deriveV2AccessManagerPlan({ ...base, moduleAddresses: { ...base.moduleAddresses, [compiled.modules[0]!.target]: "0x0000000000000000000000000000000000000000" } }), /Invalid moduleAddresses/);
});
