import type { Address } from "viem";

const READ_API_URL = "VITE_V2_READ_API_URL";
const ADDRESS_KEYS = [
  ["VITE_V2_FACTORY_ADDRESS", "factoryAddress"],
  ["VITE_V2_LAUNCH_ROUTER_ADDRESS", "launchRouterAddress"],
  ["VITE_V2_ALLOCATION_MANAGER_ADDRESS", "allocationManagerAddress"],
  ["VITE_V2_PROTOCOL_FEE_VAULT_ADDRESS", "protocolFeeVaultAddress"],
] as const;

const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/;
const ZERO_ADDRESS = `0x${"0".repeat(40)}`;

export type V2RuntimeConfig =
  | {
      readonly available: false;
      readonly reasons: readonly string[];
    }
  | {
      readonly available: true;
      readonly baseUrl: string;
      readonly factoryAddress: Address;
      readonly launchRouterAddress: Address;
      readonly allocationManagerAddress: Address;
      readonly protocolFeeVaultAddress: Address;
    };

function missingOrInvalid(value: string | boolean | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function normalizeBaseUrl(value: string): string | undefined {
  // URL parsing is intentionally kept local to this pure function. In
  // particular, this module never consults process.env or any Vite globals.
  if (value !== value.trim()) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }

  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    || parsed.hostname.length === 0
    || parsed.username.length > 0
    || parsed.password.length > 0
    || parsed.pathname !== "/"
    || parsed.search.length > 0
    || parsed.hash.length > 0
  ) return undefined;

  // Generated API routes are rooted at /health and /v2. Accepting a base path
  // here would silently discard it when URL resolves those absolute routes.
  return parsed.origin;
}

function parseAddress(value: string | boolean | undefined): Address | undefined {
  if (!missingOrInvalid(value) || !ADDRESS_PATTERN.test(value) || value === ZERO_ADDRESS) return undefined;
  return value as Address;
}

/**
 * Parse the explicit V2 runtime settings supplied by the caller.
 *
 * This parser fails closed: a single missing or malformed setting makes the
 * whole configuration unavailable, and it never throws for malformed input.
 */
export function parseV2RuntimeConfig(env: Record<string, string | boolean | undefined>): V2RuntimeConfig {
  const reasons: string[] = [];
  const rawBaseUrl = env[READ_API_URL];
  const baseUrl = missingOrInvalid(rawBaseUrl) ? normalizeBaseUrl(rawBaseUrl) : undefined;
  if (rawBaseUrl === undefined || rawBaseUrl === "") {
    reasons.push(`${READ_API_URL} is missing`);
  } else if (baseUrl === undefined) {
    reasons.push(`${READ_API_URL} must be a valid http or https origin URL`);
  }

  const addresses: Partial<Record<(typeof ADDRESS_KEYS)[number][1], Address>> = {};
  for (const [key, name] of ADDRESS_KEYS) {
    const parsed = parseAddress(env[key]);
    if (parsed === undefined) {
      const raw = env[key];
      reasons.push(raw === undefined || raw === "" ? `${key} is missing` : `${key} must be a lowercase, non-zero 20-byte hex address`);
    } else {
      addresses[name] = parsed;
    }
  }

  if (reasons.length > 0) {
    return Object.freeze({ available: false, reasons: Object.freeze(reasons) });
  }

  return Object.freeze({
    available: true,
    baseUrl: baseUrl!,
    factoryAddress: addresses.factoryAddress!,
    launchRouterAddress: addresses.launchRouterAddress!,
    allocationManagerAddress: addresses.allocationManagerAddress!,
    protocolFeeVaultAddress: addresses.protocolFeeVaultAddress!,
  });
}
