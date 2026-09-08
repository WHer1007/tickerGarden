import type { Address } from "viem";

export type MarketRelease = {
  releaseId: string;
  chainId: number;
  factory: Address;
  marketRegistry: Address;
  hook: Address;
  feeVault: Address;
  creatorRegistry: Address;
  holderDistributor: Address;
  launchRouter: Address;
  allocationManager: Address;
};

/** Chain and address observations read from the deployed market contracts. */
export type MarketReleaseObservation = {
  chainId: number;
  token: { factory: Address; marketRegistry?: Address; hook?: Address; feeVault?: Address };
  distributor?: BindingObservation;
  marketRegistry?: BindingObservation;
  hook?: BindingObservation;
  vault?: BindingObservation;
};

type BindingObservation = { marketRegistry?: Address; hook?: Address; factory?: Address; feeVault?: Address };

export type MarketReleaseBinding = { release: MarketRelease; normalizedFactory: string };

const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const zeroAddress = "0x0000000000000000000000000000000000000000";

function normalizeAddress(value: Address, field: string): string {
  if (typeof value !== "string" || !addressPattern.test(value) || value.toLowerCase() === zeroAddress) {
    throw new Error(`Invalid or zero address for ${field}`);
  }
  return value.toLowerCase();
}

function normalizeRelease(release: MarketRelease): MarketRelease {
  const result = { ...release } as Record<string, unknown>;
  for (const field of ["factory", "marketRegistry", "hook", "feeVault", "creatorRegistry", "holderDistributor", "launchRouter", "allocationManager"]) {
    result[field] = normalizeAddress(release[field as keyof MarketRelease] as Address, `release.${field}`);
  }
  if (typeof release.releaseId !== "string" || !/^[a-zA-Z0-9:_-]{1,128}$/.test(release.releaseId) || !Number.isSafeInteger(release.chainId) || release.chainId <= 0) throw new Error("Invalid release identity");
  return result as unknown as MarketRelease;
}

function assertMatch(observed: Address | undefined, expected: Address, field: string): void {
  if (observed !== undefined && normalizeAddress(observed, `observed.${field}`) !== expected.toLowerCase()) {
    throw new Error(`Observed ${field} does not match selected release`);
  }
}

/** Resolve by observed factory + chain, then verify every supplied cross-binding. */
export function resolveMarketRelease(catalog: readonly MarketRelease[], observed: MarketReleaseObservation): MarketReleaseBinding {
  const releases = catalog.map(normalizeRelease);
  const seen = new Set<string>();
  for (const release of releases) {
    const key = `${release.chainId}:${release.factory}`;
    if (seen.has(key)) throw new Error(`Duplicate factory for chain ${release.chainId}`);
    seen.add(key);
  }
  if (!Number.isSafeInteger(observed.chainId) || observed.chainId <= 0) throw new Error("Invalid observed chain id");
  const observedFactory = normalizeAddress(observed.token.factory, "observed.token.factory");
  const release = releases.find((candidate) => candidate.chainId === observed.chainId && candidate.factory === observedFactory);
  if (!release) throw new Error("Unknown market release factory");

  assertMatch(observed.token.marketRegistry, release.marketRegistry, "token.marketRegistry");
  assertMatch(observed.token.hook, release.hook, "token.hook");
  assertMatch(observed.token.feeVault, release.feeVault, "token.feeVault");
  for (const [name, binding] of [["distributor", observed.distributor], ["marketRegistry", observed.marketRegistry], ["hook", observed.hook], ["vault", observed.vault]] as const) {
    if (!binding) continue;
    assertMatch(binding.factory, release.factory, `${name}.factory`);
    assertMatch(binding.marketRegistry, release.marketRegistry, `${name}.marketRegistry`);
    assertMatch(binding.hook, release.hook, `${name}.hook`);
    assertMatch(binding.feeVault, release.feeVault, `${name}.feeVault`);
  }
  return { release, normalizedFactory: release.factory };
}
