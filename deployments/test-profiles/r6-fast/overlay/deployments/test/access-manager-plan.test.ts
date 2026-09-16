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
    rootPublisherSafe: fixtureAddress("root-publisher-safe"),
    rootReviewerSafe: fixtureAddress("root-reviewer-safe"),
    moduleAddresses,
    ...overrides,
  };
}

test("derives 23 protocol role selectors and 76 immutable direct selectors from the 19-module manifest", () => {
  const plan = deriveV1AccessManagerPlan(input());
  assert.equal(compiled.modules.length, 19);
  assert.equal(compiled.mutations.length, 99);
  assert.equal(plan.configuredProtocolSelectorCount, 23);
  assert.equal(plan.immutableDirectSelectorCount, 76);
  assert.equal(plan.roles.length, 5);
  assert.deepEqual(plan.roles.map((role) => [role.name, role.roleId, role.executionDelaySeconds]), [
    ["PROTOCOL_ADMIN_ROLE", V1_ACCESS_ROLES.PROTOCOL_ADMIN_ROLE.toString(), 172800],
    ["PAUSE_GUARDIAN_ROLE", V1_ACCESS_ROLES.PAUSE_GUARDIAN_ROLE.toString(), 0],
    ["UNPAUSE_ROLE", V1_ACCESS_ROLES.UNPAUSE_ROLE.toString(), 1200],
    ["ROOT_PUBLISHER_ROLE", V1_ACCESS_ROLES.ROOT_PUBLISHER_ROLE.toString(), 0],
    ["ROOT_REVIEW_ROLE", V1_ACCESS_ROLES.ROOT_REVIEW_ROLE.toString(), 0],
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
    fixtureAddress("root-publisher-safe").toLowerCase(),
    fixtureAddress("root-reviewer-safe").toLowerCase(),
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
  assert.equal(plan.actions.filter((action) => action.phase === "PROTOCOL_SELECTORS").reduce((n, action) => n + Number(action.description.match(/\((\d+) selector/)?.[1] ?? 0), 0), 23);
  assert.equal(plan.actions.filter((action) => action.phase === "BOOTSTRAP_GUARDIANS").length, 4);
});

test("configures only the four privileged Treasury selectors and leaves lifecycle operations direct", () => {
  const values = input();
  const plan = deriveV1AccessManagerPlan(values);
  const treasury = values.moduleAddresses.TreasuryDistributorV1!.toLowerCase();
  const treasuryActions = plan.actions.filter(
    (action) => action.phase === "PROTOCOL_SELECTORS" && action.description.includes(`-> ${treasury}`),
  );
  assert.equal(treasuryActions.length, 3);

  const actionFor = (role: keyof typeof V1_ACCESS_ROLES) => treasuryActions.find(
    (action) => action.description.startsWith(`${role} ->`),
  )!;
  assert.deepEqual(configuredSelectors(actionFor("PROTOCOL_ADMIN_ROLE").data), [
    selector("registerMarket(bytes32,address,address,bytes32)"),
    selector("setRootServiceFee(address,uint128)"),
  ]);
  assert.deepEqual(configuredSelectors(actionFor("ROOT_PUBLISHER_ROLE").data), [
    selector("publishRoot(bytes32,uint32,bytes32,bytes32,uint256,uint32,uint256)"),
  ]);
  assert.deepEqual(configuredSelectors(actionFor("ROOT_REVIEW_ROLE").data), [
    selector("cancelPendingRoot(bytes32,uint32,bytes32)"),
  ]);

  const configured = treasuryActions.flatMap((action) => configuredSelectors(action.data));
  for (const directSignature of [
    "activateMarket(bytes32)",
    "fundQuoteTreasury(bytes32,uint256,bytes32)",
    "burnMeme(bytes32,uint256,bytes32)",
    "requestRoot(bytes32,uint32)",
    "finalizeRoot(bytes32,uint32)",
    "expireRootRequest(bytes32,uint32)",
    "claim(bytes32,uint32,uint256,address,uint256,uint256,bytes32[])",
    "rolloverExpiredEpoch(bytes32,uint32)",
    "withdrawServiceCredit(address)",
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
  assert.equal(plan.actions.filter((action) => action.phase === "FREEZE_ADMIN_SURFACE").length, 5);
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
  assert.throws(() => deriveV1AccessManagerPlan({ ...base, rootReviewerSafe: base.rootPublisherSafe }), /Treasury Root publisher and reviewer/);
  assert.throws(() => deriveV1AccessManagerPlan({ ...base, rootPublisherSafe: base.governanceSafe }), /Treasury Root publisher and reviewer/);
  assert.throws(() => deriveV1AccessManagerPlan({ ...base, moduleAddresses: { ...base.moduleAddresses, [compiled.modules[0]!.target]: base.guardianSafe } }), /Aliased V1 deployment address/);
  assert.throws(() => deriveV1AccessManagerPlan({ ...base, moduleAddresses: { ...base.moduleAddresses, [compiled.modules[0]!.target]: "0x0000000000000000000000000000000000000000" } }), /Invalid moduleAddresses/);
});
