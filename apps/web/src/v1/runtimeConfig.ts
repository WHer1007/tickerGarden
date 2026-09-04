import type { Address } from "viem";

const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/;
const ZERO_ADDRESS = `0x${"0".repeat(40)}`;

export type Availability<T> =
  | Readonly<{ available: true; value: T }>
  | Readonly<{ available: false; reasons: readonly string[] }>;

export interface V1ContractAddresses {
  readonly factoryAddress: Address;
  readonly launchRouterAddress: Address;
  readonly allocationManagerAddress: Address;
  readonly protocolFeeVaultAddress: Address;
  readonly creatorRevenueRegistryAddress: Address;
  readonly treasuryDistributorAddress: Address;
}

export interface V1RuntimeConfig {
  readonly readApi: Availability<string>;
  readonly contracts: Availability<V1ContractAddresses>;
  readonly rageQuitFactory: Availability<Address>;
  readonly treasuryProofApi: Availability<string>;
  readonly treasuryWrites: Availability<true>;
  readonly reasons: readonly string[];
}

export const V1_TREASURY_RELEASE_APPROVAL = "V1-TREASURY-EXEC-1:DEPLOYED_E2E_APPROVED";

const ADDRESS_KEYS = [
  ["VITE_V1_FACTORY_ADDRESS", "factoryAddress"],
  ["VITE_V1_LAUNCH_ROUTER_ADDRESS", "launchRouterAddress"],
  ["VITE_V1_ALLOCATION_MANAGER_ADDRESS", "allocationManagerAddress"],
  ["VITE_V1_PROTOCOL_FEE_VAULT_ADDRESS", "protocolFeeVaultAddress"],
  ["VITE_V1_CREATOR_REVENUE_REGISTRY_ADDRESS", "creatorRevenueRegistryAddress"],
  ["VITE_V1_TREASURY_DISTRIBUTOR_ADDRESS", "treasuryDistributorAddress"],
] as const;

function parseOrigin(value: string | boolean | undefined, key: string): Availability<string> {
  if (typeof value !== "string" || value.length === 0) {
    return Object.freeze({ available: false, reasons: Object.freeze([`${key} is missing`]) });
  }
  if (value !== value.trim()) {
    return Object.freeze({ available: false, reasons: Object.freeze([`${key} must not contain whitespace`]) });
  }
  try {
    const parsed = new URL(value);
    if (
      !["http:", "https:"].includes(parsed.protocol)
      || parsed.hostname.length === 0
      || parsed.username.length > 0
      || parsed.password.length > 0
      || parsed.pathname !== "/"
      || parsed.search.length > 0
      || parsed.hash.length > 0
    ) throw new Error("not an origin");
    return Object.freeze({ available: true, value: parsed.origin });
  } catch {
    return Object.freeze({ available: false, reasons: Object.freeze([`${key} must be a valid http or https origin URL`]) });
  }
}

function parseAddress(value: string | boolean | undefined, key: string): Availability<Address> {
  if (typeof value !== "string" || value.length === 0) {
    return Object.freeze({ available: false, reasons: Object.freeze([`${key} is missing`]) });
  }
  if (!ADDRESS_PATTERN.test(value) || value === ZERO_ADDRESS) {
    return Object.freeze({
      available: false,
      reasons: Object.freeze([`${key} must be a lowercase, non-zero 20-byte hex address`]),
    });
  }
  return Object.freeze({ available: true, value: value as Address });
}

/** Parse independent read, write, and Treasury proof capabilities without ever falling back to demo data. */
export function parseV1RuntimeConfig(env: Record<string, string | boolean | undefined>): V1RuntimeConfig {
  const readApi = parseOrigin(env.VITE_V1_READ_API_URL, "VITE_V1_READ_API_URL");
  // The caller-only Vault escape intentionally needs only the configured Factory.
  // It must remain usable when the read API, Gauge, Rewards, or unrelated V1 UI
  // addresses are unavailable.
  const rageQuitFactory = parseAddress(env.VITE_V1_FACTORY_ADDRESS, "VITE_V1_FACTORY_ADDRESS");
  const treasuryProofApi = parseOrigin(
    env.VITE_V1_TREASURY_PROOF_API_URL,
    "VITE_V1_TREASURY_PROOF_API_URL",
  );
  const addressResults = ADDRESS_KEYS.map(([key, field]) => ({ key, field, parsed: parseAddress(env[key], key) }));
  const contractReasons = addressResults.flatMap(({ parsed }) => parsed.available ? [] : [...parsed.reasons]);
  const contracts: Availability<V1ContractAddresses> = contractReasons.length > 0
    ? Object.freeze({ available: false, reasons: Object.freeze(contractReasons) })
    : Object.freeze({
        available: true,
        value: Object.freeze(Object.fromEntries(
          addressResults.map(({ field, parsed }) => [field, parsed.available ? parsed.value : ZERO_ADDRESS]),
        ) as unknown as V1ContractAddresses),
      });
  const treasuryWrites: Availability<true> = env.VITE_V1_TREASURY_RELEASE_APPROVAL === V1_TREASURY_RELEASE_APPROVAL
    ? Object.freeze({ available: true, value: true })
    : Object.freeze({
        available: false,
        reasons: Object.freeze([
          `VITE_V1_TREASURY_RELEASE_APPROVAL must equal ${V1_TREASURY_RELEASE_APPROVAL} after deployment and live E2E approval`,
        ]),
      });
  const reasons = [
    ...(readApi.available ? [] : readApi.reasons),
    ...(contracts.available ? [] : contracts.reasons),
    ...(treasuryProofApi.available ? [] : treasuryProofApi.reasons),
  ];
  return Object.freeze({ readApi, contracts, rageQuitFactory, treasuryProofApi, treasuryWrites, reasons: Object.freeze(reasons) });
}
