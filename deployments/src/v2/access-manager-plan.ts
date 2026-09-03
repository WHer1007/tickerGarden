import { readFileSync } from "node:fs";

import { keccak_256 } from "@noble/hashes/sha3.js";

type JsonRecord = Record<string, unknown>;

export const V2_ACCESS_ROLES = Object.freeze({
  PROTOCOL_ADMIN_ROLE: 1n,
  PAUSE_GUARDIAN_ROLE: 2n,
  UNPAUSE_ROLE: 3n,
  RECOVERY_ROLE: 4n,
});

const ROLE_DELAYS = Object.freeze({
  PROTOCOL_ADMIN_ROLE: 172800,
  PAUSE_GUARDIAN_ROLE: 0,
  UNPAUSE_ROLE: 86400,
  RECOVERY_ROLE: 86400,
});

export type V2AccessManagerPlanInput = Readonly<{
  accessManager: string;
  deployer: string;
  governanceSafe: string;
  guardianSafe: string;
  securityOrGovernanceSafe: string;
  recoverySafe: string;
  moduleAddresses: Readonly<Record<string, string>>;
}>;

export type V2AccessManagerAction = Readonly<{
  phase: "BOOTSTRAP_GUARDIANS" | "PROTOCOL_SELECTORS" | "ROLE_GRANTS" | "FREEZE_ADMIN_SURFACE" | "RENOUNCE_DEPLOYER";
  target: string;
  signature: string;
  data: string;
  description: string;
}>;

export type V2AccessManagerPlan = Readonly<{
  roles: ReadonlyArray<Readonly<{ name: keyof typeof V2_ACCESS_ROLES; roleId: string; member: string; executionDelaySeconds: number }>>;
  actions: ReadonlyArray<V2AccessManagerAction>;
  configuredProtocolSelectorCount: number;
  immutableDirectSelectorCount: number;
  permanentlyLockedAdminSelectors: readonly string[];
}>;

const compiled = JSON.parse(
  readFileSync(new URL("../../../spec/v2_compiled_interface_manifest.json", import.meta.url), "utf8"),
) as { modules: Array<{ target: string }>; mutations: JsonRecord[] };

const permissions = JSON.parse(
  readFileSync(new URL("../../../spec/v2_permissions_matrix.json", import.meta.url), "utf8"),
) as { functions: JsonRecord[] };

const ADMIN_CONFIG_SIGNATURES = Object.freeze([
  "setTargetFunctionRole(address,bytes4[],uint64)",
  "grantRole(uint64,address,uint32)",
  "revokeRole(uint64,address)",
]);
const SET_TARGET_FUNCTION_ROLE = "setTargetFunctionRole(address,bytes4[],uint64)";

const LOCKED_ADMIN_SIGNATURES = Object.freeze([
  "labelRole(uint64,string)",
  "setRoleAdmin(uint64,uint64)",
  "setRoleGuardian(uint64,uint64)",
  "setGrantDelay(uint64,uint32)",
  "setTargetAdminDelay(address,uint32)",
  "setTargetClosed(address,bool)",
  "setTargetFunctionRole(address,bytes4[],uint64)",
  "updateAuthority(address,address)",
]);

function selector(signature: string): string {
  return Buffer.from(keccak_256(new TextEncoder().encode(signature))).subarray(0, 4).toString("hex");
}

function address(value: string, label: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/i.test(value)) throw new Error(`Invalid ${label}: ${value}`);
  return value.toLowerCase();
}

function word(value: bigint | number): string {
  return BigInt(value).toString(16).padStart(64, "0");
}

function addressWord(value: string): string {
  return value.slice(2).padStart(64, "0");
}

function bytes4Word(value: string): string {
  return value.replace(/^0x/, "").padEnd(64, "0");
}

function staticCall(signature: string, words: readonly string[]): string {
  return `0x${selector(signature)}${words.join("")}`;
}

function setTargetRoleCall(target: string, selectors: readonly string[], roleId: bigint): string {
  return `0x${selector(SET_TARGET_FUNCTION_ROLE)}${addressWord(target)}${word(96)}${word(roleId)}${word(selectors.length)}${selectors.map(bytes4Word).join("")}`;
}

export function deriveV2AccessManagerPlan(unchecked: V2AccessManagerPlanInput): V2AccessManagerPlan {
  const input = {
    accessManager: address(unchecked.accessManager, "accessManager"),
    deployer: address(unchecked.deployer, "deployer"),
    governanceSafe: address(unchecked.governanceSafe, "governanceSafe"),
    guardianSafe: address(unchecked.guardianSafe, "guardianSafe"),
    securityOrGovernanceSafe: address(unchecked.securityOrGovernanceSafe, "securityOrGovernanceSafe"),
    recoverySafe: address(unchecked.recoverySafe, "recoverySafe"),
  };
  const roleMembers = [input.governanceSafe, input.guardianSafe, input.securityOrGovernanceSafe, input.recoverySafe];
  if (roleMembers.includes(input.deployer)) {
    throw new Error("Bootstrap deployer must not retain a V2 role");
  }
  if (roleMembers.includes(input.accessManager) || input.deployer === input.accessManager) {
    throw new Error("AccessManager must not alias a V2 actor");
  }
  if (
    input.guardianSafe === input.governanceSafe || input.guardianSafe === input.securityOrGovernanceSafe
    || input.guardianSafe === input.recoverySafe || input.recoverySafe === input.governanceSafe
    || input.recoverySafe === input.securityOrGovernanceSafe
  ) {
    throw new Error("Guardian and recovery roles require independent Safe members");
  }
  const reservedAddresses = new Set([input.accessManager, input.deployer, ...roleMembers]);
  const moduleAddresses = new Map<string, string>();
  for (const { target } of compiled.modules) {
    const candidate = unchecked.moduleAddresses[target];
    if (candidate === undefined) throw new Error(`Missing V2 module address: ${target}`);
    const normalized = address(candidate, `moduleAddresses.${target}`);
    if (reservedAddresses.has(normalized) || [...moduleAddresses.values()].includes(normalized)) {
      throw new Error(`Aliased V2 deployment address: ${target}`);
    }
    moduleAddresses.set(target, normalized);
  }
  if (Object.keys(unchecked.moduleAddresses).length !== moduleAddresses.size) {
    throw new Error("Unexpected V2 module address");
  }

  const members = {
    PROTOCOL_ADMIN_ROLE: input.governanceSafe,
    PAUSE_GUARDIAN_ROLE: input.guardianSafe,
    UNPAUSE_ROLE: input.securityOrGovernanceSafe,
    RECOVERY_ROLE: input.recoverySafe,
  } as const;
  const roles = (Object.keys(V2_ACCESS_ROLES) as Array<keyof typeof V2_ACCESS_ROLES>).map((name) => Object.freeze({
    name,
    roleId: V2_ACCESS_ROLES[name].toString(),
    member: members[name],
    executionDelaySeconds: ROLE_DELAYS[name],
  }));

  const actions: V2AccessManagerAction[] = [];
  for (const roleName of ["PROTOCOL_ADMIN_ROLE", "UNPAUSE_ROLE", "RECOVERY_ROLE"] as const) {
    actions.push(Object.freeze({
      phase: "BOOTSTRAP_GUARDIANS",
      target: input.accessManager,
      signature: "setRoleGuardian(uint64,uint64)",
      data: staticCall("setRoleGuardian(uint64,uint64)", [word(V2_ACCESS_ROLES[roleName]), word(V2_ACCESS_ROLES.PAUSE_GUARDIAN_ROLE)]),
      description: `Freeze PAUSE_GUARDIAN_ROLE as guardian of ${roleName}`,
    }));
  }

  const grouped = new Map<string, { target: string; roleName: keyof typeof V2_ACCESS_ROLES; selectors: string[] }>();
  let direct = 0;
  for (const mutation of compiled.mutations) {
    const roleName = String(mutation.caller) as keyof typeof V2_ACCESS_ROLES;
    if (!(roleName in V2_ACCESS_ROLES)) {
      direct += 1;
      continue;
    }
    const targetName = String(mutation.target);
    const target = moduleAddresses.get(targetName);
    if (target === undefined) throw new Error(`Unknown compiled target: ${targetName}`);
    const key = `${target}:${roleName}`;
    const group = grouped.get(key) ?? { target, roleName, selectors: [] };
    group.selectors.push(String(mutation.selector));
    grouped.set(key, group);
  }
  for (const group of grouped.values()) {
    actions.push(Object.freeze({
      phase: "PROTOCOL_SELECTORS",
      target: input.accessManager,
      signature: SET_TARGET_FUNCTION_ROLE,
      data: setTargetRoleCall(group.target, group.selectors, V2_ACCESS_ROLES[group.roleName]),
      description: `${group.roleName} -> ${group.target} (${group.selectors.length} selector(s))`,
    }));
  }

  for (const role of roles) {
    actions.push(Object.freeze({
      phase: "ROLE_GRANTS",
      target: input.accessManager,
      signature: "grantRole(uint64,address,uint32)",
      data: staticCall("grantRole(uint64,address,uint32)", [word(BigInt(role.roleId)), addressWord(role.member), word(role.executionDelaySeconds)]),
      description: `Grant ${role.name} only to its frozen Safe`,
    }));
  }

  const adminRows = permissions.functions.filter((row) => row.module === "AccessManager");
  if (JSON.stringify(adminRows.slice(3).map((row) => row.signature)) !== JSON.stringify(ADMIN_CONFIG_SIGNATURES)) {
    throw new Error("Canonical AccessManager administrative surface drift");
  }
  for (const role of roles) {
    actions.push(Object.freeze({
      phase: "FREEZE_ADMIN_SURFACE",
      target: input.accessManager,
      signature: "setRoleAdmin(uint64,uint64)",
      data: staticCall("setRoleAdmin(uint64,uint64)", [word(BigInt(role.roleId)), word(V2_ACCESS_ROLES.PROTOCOL_ADMIN_ROLE)]),
      description: `Make delayed PROTOCOL_ADMIN_ROLE the immutable admin of ${role.name}`,
    }));
  }
  actions.push(Object.freeze({
    phase: "RENOUNCE_DEPLOYER",
    target: input.accessManager,
    signature: "renounceRole(uint64,address)",
    data: staticCall("renounceRole(uint64,address)", [word(0), addressWord(input.deployer)]),
    description: "Permanently remove the bootstrap deployer from ADMIN_ROLE",
  }));

  const configured = [...grouped.values()].reduce((total, group) => total + group.selectors.length, 0);
  return Object.freeze({
    roles: Object.freeze(roles),
    actions: Object.freeze(actions),
    configuredProtocolSelectorCount: configured,
    immutableDirectSelectorCount: direct,
    permanentlyLockedAdminSelectors: Object.freeze(LOCKED_ADMIN_SIGNATURES.map((value) => `0x${selector(value)}`)),
  });
}
