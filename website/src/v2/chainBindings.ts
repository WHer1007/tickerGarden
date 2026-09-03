import type { Address, Hex } from "viem";
import type { ConfigReadModel, MarketReadModel } from "./generated/read-api.ts";
import type { SelectedLaunchConfig } from "./features/launch.ts";

const ADDRESS = /^0x[0-9a-f]{40}$/;
const HEX32 = /^0x[0-9a-f]{64}$/;
const UINT = /^(0|[1-9][0-9]*)$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_HEX32 = `0x${"0".repeat(64)}`;

export interface CanonicalRuntimeBindings {
  readonly officialStockRegistry: Address;
  readonly approvedQuoteRegistry: Address;
  readonly ponsBaselineRegistry: Address;
  readonly launchTemplateRegistry: Address;
  readonly marketRegistry: Address;
  readonly protocolFeeVault: Address;
  readonly allocationManager: Address;
  readonly launchRouter: Address;
}

export interface CanonicalAssetBinding {
  readonly assetUid: Hex;
  readonly stockToken: Address;
  readonly userStockVault: Address;
  readonly tokenDecimals: number;
  readonly status: number;
  readonly minimumAllocation: bigint;
}

function field(value: unknown, name: string, index: number): unknown {
  if (Array.isArray(value)) return value[index];
  if (value !== null && typeof value === "object" && name in value) {
    return (value as Record<string, unknown>)[name];
  }
  throw new Error(`onchain ${name} is missing`);
}

function address(value: unknown, label: string, allowZero = false): Address {
  if (typeof value !== "string") throw new Error(`${label} is not an address`);
  const normalized = value.toLowerCase();
  if (!ADDRESS.test(normalized) || (!allowZero && normalized === ZERO_ADDRESS)) {
    throw new Error(`${label} is not a canonical contract address`);
  }
  return normalized as Address;
}

function bytes32(value: unknown, label: string, allowZero = true): Hex {
  if (typeof value !== "string") throw new Error(`${label} is not bytes32`);
  const normalized = value.toLowerCase();
  if (!HEX32.test(normalized) || (!allowZero && normalized === ZERO_HEX32)) {
    throw new Error(`${label} is not canonical bytes32`);
  }
  return normalized as Hex;
}

function integer(value: unknown, label: string): number {
  const result = typeof value === "bigint" ? Number(value) : value;
  if (typeof result !== "number" || !Number.isSafeInteger(result) || result < 0) {
    throw new Error(`${label} is not a safe unsigned integer`);
  }
  return result;
}

function uint(value: unknown, label: string): bigint {
  try {
    const result = typeof value === "bigint"
      ? value
      : typeof value === "number" && Number.isSafeInteger(value)
        ? BigInt(value)
        : typeof value === "string" && UINT.test(value)
          ? BigInt(value)
          : -1n;
    if (result < 0n) throw new Error();
    return result;
  } catch {
    throw new Error(`${label} is not an unsigned integer`);
  }
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} is not boolean`);
  return value;
}

function apiValue(config: ConfigReadModel, key: string): unknown {
  if (!(key in config.values)) throw new Error(`API ${config.kind}.${key} is missing`);
  return config.values[key];
}

function same<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) throw new Error(`${label} drifted from the canonical onchain record`);
}

function statusOf(record: unknown, index: number, label: string): number {
  return integer(field(record, "status", index), `${label}.status`);
}

export function assertCanonicalFactoryBindings(
  raw: unknown,
  expected: Readonly<{
    launchRouter: Address;
    allocationManager: Address;
    protocolFeeVault: Address;
  }>,
): CanonicalRuntimeBindings {
  const result = Object.freeze({
    officialStockRegistry: address(field(raw, "output0", 0), "Factory.officialStockRegistry"),
    approvedQuoteRegistry: address(field(raw, "output1", 1), "Factory.approvedQuoteRegistry"),
    ponsBaselineRegistry: address(field(raw, "output2", 2), "Factory.ponsBaselineRegistry"),
    launchTemplateRegistry: address(field(raw, "output3", 3), "Factory.launchTemplateRegistry"),
    marketRegistry: address(field(raw, "output4", 4), "Factory.marketRegistry"),
    protocolFeeVault: address(field(raw, "output5", 5), "Factory.protocolFeeVault"),
    allocationManager: address(field(raw, "output6", 6), "Factory.allocationManager"),
    launchRouter: address(field(raw, "output7", 7), "Factory.launchRouter"),
  });
  same(result.launchRouter, address(expected.launchRouter, "configured LaunchRouter"), "configured LaunchRouter");
  same(result.allocationManager, address(expected.allocationManager, "configured AllocationManager"), "configured AllocationManager");
  same(result.protocolFeeVault, address(expected.protocolFeeVault, "configured ProtocolFeeVault"), "configured ProtocolFeeVault");
  return result;
}

export function assertCanonicalLaunchBindings(
  selected: SelectedLaunchConfig,
  raw: Readonly<{ asset: unknown; quote: unknown; pons: unknown; template: unknown }>,
): void {
  bytes32(selected.asset.assetUid, "selected assetUid", false);
  bytes32(selected.quote.configId, "selected quote configId", false);
  bytes32(selected.pons.baselineId, "selected Pons baselineId", false);
  bytes32(selected.template.templateId, "selected launch templateId", false);

  same(statusOf(raw.asset, 3, "asset"), selected.asset.status, "asset status");
  same(bytes32(field(raw.quote, "ponsBaselineId", 0), "Quote.ponsBaselineId", false), selected.quote.ponsBaselineId, "Quote Pons baseline");
  same(address(field(raw.quote, "quoteAsset", 1), "Quote.quoteAsset", true), selected.quote.quoteAsset, "Quote asset");
  same(bytes32(field(raw.quote, "economicsHash", 5), "Quote.economicsHash", false), selected.quote.economicsHash, "Quote economics hash");
  same(statusOf(raw.quote, 6, "quote"), selected.quote.status, "Quote status");
  same(statusOf(raw.pons, 9, "Pons baseline"), selected.pons.status, "Pons baseline status");
  same(statusOf(raw.template, 13, "launch template"), selected.template.status, "launch template status");
}

export function assertCanonicalAssetBinding(
  config: ConfigReadModel,
  raw: unknown,
  rawMinimumAllocation: unknown,
): CanonicalAssetBinding {
  if (config.kind !== "asset") throw new Error("API config is not an asset record");
  const result = Object.freeze({
    assetUid: bytes32(config.id, "API assetUid", false),
    stockToken: address(field(raw, "stockToken", 0), "Asset.stockToken"),
    userStockVault: address(field(raw, "userStockVault", 1), "Asset.userStockVault"),
    tokenDecimals: integer(field(raw, "tokenDecimals", 2), "Asset.tokenDecimals"),
    status: statusOf(raw, 3, "asset"),
    minimumAllocation: uint(rawMinimumAllocation, "Asset.minimumAllocation"),
  });
  same(result.stockToken, address(apiValue(config, "stockToken"), "API asset.stockToken"), "asset STOCK token");
  same(result.userStockVault, address(apiValue(config, "userStockVault"), "API asset.userStockVault"), "asset Vault");
  same(result.tokenDecimals, integer(apiValue(config, "tokenDecimals"), "API asset.tokenDecimals"), "asset decimals");
  same(result.status, config.status, "asset status");
  same(result.minimumAllocation, uint(apiValue(config, "minimumAllocation"), "API asset.minimumAllocation"), "asset minimum allocation");
  if (result.tokenDecimals < 6 || result.tokenDecimals > 18) throw new Error("asset decimals are outside the frozen 6-18 domain");
  if (result.minimumAllocation < 414n) throw new Error("asset minimum allocation is below the canonical safety floor");
  return result;
}

export function assertCanonicalMarketBinding(
  api: MarketReadModel,
  rawMarket: unknown,
  rawRoute: unknown,
): void {
  const config = field(rawMarket, "config", 0);
  const runtime = field(rawMarket, "runtime", 1);
  const apiMarketId = bytes32(api.marketId, "API marketId", false);
  bytes32(apiMarketId, "API marketId", false);

  same(bytes32(field(config, "assetUid", 0), "Market.assetUid", false), bytes32(api.assetUid, "API assetUid", false), "market assetUid");
  same(bytes32(field(config, "ponsBaselineId", 1), "Market.ponsBaselineId", false), bytes32(api.ponsBaselineId, "API ponsBaselineId", false), "market Pons baseline");
  same(bytes32(field(config, "quoteAssetConfigId", 2), "Market.quoteAssetConfigId", false), bytes32(api.quoteAssetConfigId, "API quoteAssetConfigId", false), "market Quote config");
  same(address(field(config, "memeToken", 9), "Market.memeToken"), address(api.memeToken, "API memeToken"), "market Meme token");
  same(address(field(config, "curve", 10), "Market.curve"), address(api.curve, "API curve"), "market Curve");
  same(address(field(config, "gauge", 11), "Market.gauge"), address(api.gauge, "API gauge"), "market Gauge");
  same(address(field(config, "quoteAsset", 12), "Market.quoteAsset", true), address(api.quoteAsset, "API quoteAsset", true), "market Quote asset");

  const sourceVersion = integer(field(runtime, "sourceVersion", 1), "Market.sourceVersion");
  const launchPhase = integer(field(runtime, "launchPhase", 6), "Market.launchPhase");
  const marketStatus = integer(field(runtime, "marketStatus", 7), "Market.marketStatus");
  same(sourceVersion, api.sourceVersion, "market sourceVersion");
  same(launchPhase, api.launchPhase, "market launch phase");
  same(marketStatus, api.marketStatus, "market status");
  const runtimePoolId = bytes32(field(runtime, "poolId", 0), "Market.poolId");
  same(runtimePoolId, api.poolId === null ? ZERO_HEX32 as Hex : bytes32(api.poolId, "API poolId", false), "market runtime poolId");
  const sweptAt = uint(field(runtime, "sweptAt", 3), "Market.sweptAt");
  same(sweptAt, api.curveProgress.sweptAt === null ? 0n : uint(api.curveProgress.sweptAt, "API sweptAt"), "market sweptAt");

  same(address(field(rawRoute, "swapRouter", 2), "Route.swapRouter"), address(api.canonicalRoute.router, "API route.router"), "route router");
  same(address(field(rawRoute, "quoter", 3), "Route.quoter"), address(api.canonicalRoute.quoter, "API route.quoter"), "route quoter");
  const routeHook = address(field(rawRoute, "hook", 4), "Route.hook");
  same(routeHook, address(api.canonicalRoute.hook, "API route.hook"), "route hook");
  same(routeHook, address(field(config, "graduatedHook", 13), "Market.graduatedHook"), "market graduated hook");
  same(address(field(rawRoute, "quoteAsset", 5), "Route.quoteAsset", true), address(api.quoteAsset, "API quoteAsset", true), "route Quote asset");
  same(address(field(rawRoute, "memeToken", 6), "Route.memeToken"), address(api.memeToken, "API memeToken"), "route Meme token");
  same(address(field(rawRoute, "gauge", 7), "Route.gauge"), address(api.gauge, "API gauge"), "route Gauge");
  same(address(field(rawRoute, "curve", 8), "Route.curve"), address(api.curve, "API curve"), "route Curve");
  same(address(field(rawRoute, "launchLocker", 9), "Route.launchLocker"), address(api.canonicalRoute.launchLocker, "API route.launchLocker"), "route LaunchLocker");
  same(integer(field(rawRoute, "sourceVersion", 10), "Route.sourceVersion"), api.sourceVersion, "route sourceVersion");
  same(integer(field(rawRoute, "launchPhase", 11), "Route.launchPhase"), api.launchPhase, "route launch phase");
  same(integer(field(rawRoute, "marketStatus", 12), "Route.marketStatus"), api.marketStatus, "route market status");
  same(boolean(field(rawRoute, "curveTradingEnabled", 13), "Route.curveTradingEnabled"), api.canonicalRoute.curveTradingEnabled, "route Curve flag");
  same(boolean(field(rawRoute, "poolTradingEnabled", 14), "Route.poolTradingEnabled"), api.canonicalRoute.poolTradingEnabled, "route pool flag");

  const routePoolId = bytes32(field(rawRoute, "poolId", 1), "Route.poolId", false);
  if (api.poolId !== null) same(routePoolId, bytes32(api.poolId, "API poolId", false), "route poolId");
  if (api.poolKey !== null) {
    const key = field(rawRoute, "poolKey", 0);
    same(address(field(key, "currency0", 0), "Route.poolKey.currency0", true), address(api.poolKey.currency0, "API poolKey.currency0", true), "pool currency0");
    same(address(field(key, "currency1", 1), "Route.poolKey.currency1", true), address(api.poolKey.currency1, "API poolKey.currency1", true), "pool currency1");
    same(integer(field(key, "fee", 2), "Route.poolKey.fee"), api.poolKey.fee, "pool fee");
    same(integer(field(key, "tickSpacing", 3), "Route.poolKey.tickSpacing"), api.poolKey.tickSpacing, "pool tick spacing");
    same(address(field(key, "hooks", 4), "Route.poolKey.hooks"), address(api.poolKey.hooks, "API poolKey.hooks"), "pool hook");
  }
}
