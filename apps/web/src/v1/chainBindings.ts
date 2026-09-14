import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";
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
  readonly tickerGardenBaselineRegistry: Address;
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

/** Decode the immutable Factory registry graph without relying on an indexer response. */
export function decodeCanonicalFactoryBindings(raw: unknown): CanonicalRuntimeBindings {
  return Object.freeze({
    officialStockRegistry: address(field(raw, "output0", 0), "Factory.officialStockRegistry"),
    approvedQuoteRegistry: address(field(raw, "output1", 1), "Factory.approvedQuoteRegistry"),
    tickerGardenBaselineRegistry: address(field(raw, "output2", 2), "Factory.tickerGardenBaselineRegistry"),
    launchTemplateRegistry: address(field(raw, "output3", 3), "Factory.launchTemplateRegistry"),
    marketRegistry: address(field(raw, "output4", 4), "Factory.marketRegistry"),
    protocolFeeVault: address(field(raw, "output5", 5), "Factory.protocolFeeVault"),
    allocationManager: address(field(raw, "output6", 6), "Factory.allocationManager"),
    launchRouter: address(field(raw, "output7", 7), "Factory.launchRouter"),
  });
}

export function assertCanonicalFactoryBindings(
  raw: unknown,
  expected: Readonly<{
    launchRouter: Address;
    allocationManager: Address;
    protocolFeeVault: Address;
  }>,
): CanonicalRuntimeBindings {
  const result = decodeCanonicalFactoryBindings(raw);
  same(result.launchRouter, address(expected.launchRouter, "configured LaunchRouter"), "configured LaunchRouter");
  same(result.allocationManager, address(expected.allocationManager, "configured AllocationManager"), "configured AllocationManager");
  same(result.protocolFeeVault, address(expected.protocolFeeVault, "configured ProtocolFeeVault"), "configured ProtocolFeeVault");
  return result;
}

export function assertCanonicalLaunchBindings(
  selected: SelectedLaunchConfig,
  raw: Readonly<{ asset: unknown; quote: unknown; baseline: unknown; template: unknown }>,
): void {
  if (selected.stakingEnabled !== false) {
    if (!selected.asset) throw new Error("Select a staking asset");
    bytes32(selected.asset.assetUid, "selected assetUid", false);
    same(statusOf(raw.asset, 3, "asset"), selected.asset.status, "asset status");
  }
  bytes32(selected.quote.configId, "selected quote configId", false);
  bytes32(selected.baseline.baselineId, "selected TickerGarden baselineId", false);
  bytes32(selected.template.templateId, "selected launch templateId", false);

  same(bytes32(field(raw.quote, "tickerGardenBaselineId", 0), "Quote.tickerGardenBaselineId", false), selected.quote.tickerGardenBaselineId, "Quote TickerGarden baseline");
  same(address(field(raw.quote, "quoteAsset", 1), "Quote.quoteAsset", true), selected.quote.quoteAsset, "Quote asset");
  same(bytes32(field(raw.quote, "economicsHash", 5), "Quote.economicsHash", false), selected.quote.economicsHash, "Quote economics hash");
  same(statusOf(raw.quote, 6, "quote"), selected.quote.status, "Quote status");
  same(statusOf(raw.baseline, 9, "TickerGarden baseline"), selected.baseline.status, "TickerGarden baseline status");
  same(statusOf(raw.template, 12, "launch template"), selected.template.status, "launch template status");
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
  const apiPoolIdIsNull = api.poolId === null;
  const apiPoolKeyIsNull = api.poolKey === null;
  if (apiPoolIdIsNull !== apiPoolKeyIsNull) {
    throw new Error("API poolId and poolKey nullability drifted");
  }
  const config = field(rawMarket, "config", 0);
  const runtime = field(rawMarket, "runtime", 1);
  const stakingEnabled = boolean(field(config, "stakingEnabled", 16), "Market.stakingEnabled");
  const disabledStaking = !stakingEnabled;
  if (disabledStaking && (api.assetUid !== ZERO_HEX32 || api.gauge !== "0x0000000000000000000000000000000000000000")) throw new Error("Disabled staking has a stock or Gauge binding");
  const apiMarketId = bytes32(api.marketId, "API marketId", false);
  bytes32(apiMarketId, "API marketId", false);

  same(bytes32(field(config, "assetUid", 0), "Market.assetUid", disabledStaking), bytes32(api.assetUid, "API assetUid", disabledStaking), "market assetUid");
  same(bytes32(field(config, "tickerGardenBaselineId", 1), "Market.tickerGardenBaselineId", false), bytes32(api.tickerGardenBaselineId, "API tickerGardenBaselineId", false), "market TickerGarden baseline");
  same(bytes32(field(config, "quoteAssetConfigId", 2), "Market.quoteAssetConfigId", false), bytes32(api.quoteAssetConfigId, "API quoteAssetConfigId", false), "market Quote config");
  same(address(field(config, "memeToken", 9), "Market.memeToken"), address(api.memeToken, "API memeToken"), "market created token");
  same(address(field(config, "curve", 10), "Market.curve"), address(api.curve, "API curve"), "market Curve");
  same(address(field(config, "gauge", 11), "Market.gauge", disabledStaking), address(api.gauge, "API gauge", disabledStaking), "market Gauge");
  same(address(field(config, "quoteAsset", 12), "Market.quoteAsset", true), address(api.quoteAsset, "API quoteAsset", true), "market Quote asset");

  const sourceVersion = integer(field(runtime, "sourceVersion", 1), "Market.sourceVersion");
  const launchPhase = integer(field(runtime, "launchPhase", 2), "Market.launchPhase");
  same(sourceVersion, api.sourceVersion, "market sourceVersion");
  same(launchPhase, api.launchPhase, "market launch phase");
  const runtimePoolId = bytes32(field(runtime, "poolId", 0), "Market.poolId");
  same(runtimePoolId, api.poolId === null ? ZERO_HEX32 as Hex : bytes32(api.poolId, "API poolId", false), "market runtime poolId");

  // Older deployed releases include two service fields. They are not protocol invariants.
  const legacyRoute = Array.isArray(rawRoute) ? rawRoute.length === 14 : Object.hasOwn(rawRoute as object, 'swapRouter');
  const routeOffset = legacyRoute ? 2 : 0;
  const routeHook = address(field(rawRoute, "hook", 2 + routeOffset), "Route.hook");
  same(routeHook, address(api.canonicalRoute.hook, "API route.hook"), "route hook");
  same(routeHook, address(field(config, "graduatedHook", 13), "Market.graduatedHook"), "market graduated hook");
  same(address(field(rawRoute, "quoteAsset", 3 + routeOffset), "Route.quoteAsset", true), address(api.quoteAsset, "API quoteAsset", true), "route Quote asset");
  same(address(field(rawRoute, "memeToken", 4 + routeOffset), "Route.memeToken"), address(api.memeToken, "API memeToken"), "route created token");
  same(address(field(rawRoute, "gauge", 5 + routeOffset), "Route.gauge", disabledStaking), address(api.gauge, "API gauge", disabledStaking), "route Gauge");
  same(address(field(rawRoute, "curve", 6 + routeOffset), "Route.curve"), address(api.curve, "API curve"), "route Curve");
  same(address(field(rawRoute, "launchLocker", 7 + routeOffset), "Route.launchLocker"), address(api.canonicalRoute.launchLocker, "API route.launchLocker"), "route LaunchLocker");
  same(integer(field(rawRoute, "sourceVersion", 8 + routeOffset), "Route.sourceVersion"), api.sourceVersion, "route sourceVersion");
  same(integer(field(rawRoute, "launchPhase", 9 + routeOffset), "Route.launchPhase"), api.launchPhase, "route launch phase");
  same(boolean(field(rawRoute, "curveTradingEnabled", 10 + routeOffset), "Route.curveTradingEnabled"), api.canonicalRoute.curveTradingEnabled, "route Curve flag");
  same(boolean(field(rawRoute, "poolTradingEnabled", 11 + routeOffset), "Route.poolTradingEnabled"), api.canonicalRoute.poolTradingEnabled, "route pool flag");

  const routePoolId = bytes32(field(rawRoute, "poolId", 1), "Route.poolId", false);
  const key = field(rawRoute, "poolKey", 0);
  const routeCurrency0 = address(field(key, "currency0", 0), "Route.poolKey.currency0", true);
  const routeCurrency1 = address(field(key, "currency1", 1), "Route.poolKey.currency1", true);
  const routeFee = integer(field(key, "fee", 2), "Route.poolKey.fee");
  const routeTickSpacing = integer(field(key, "tickSpacing", 3), "Route.poolKey.tickSpacing");
  const routeKeyHook = address(field(key, "hooks", 4), "Route.poolKey.hooks");
  const quoteAsset = address(api.quoteAsset, "API quoteAsset", true);
  const memeToken = address(api.memeToken, "API memeToken");
  const expectedCurrency0 = quoteAsset < memeToken ? quoteAsset : memeToken;
  const expectedCurrency1 = quoteAsset < memeToken ? memeToken : quoteAsset;
  same(routeCurrency0, expectedCurrency0, "pool currency0 paired-asset/token ordering");
  same(routeCurrency1, expectedCurrency1, "pool currency1 paired-asset/token ordering");
  const configuredLpFee = Array.isArray(config) ? config[18] : (config as Record<string,unknown>).lpFeePips;
  const expectedLpFee = configuredLpFee === undefined ? 0 : integer(configuredLpFee, "Market.lpFeePips");
  if (![0, 1000, 2000, 3000].includes(expectedLpFee) || routeFee !== expectedLpFee) throw new Error("pool fee does not match market config");
  same(routeKeyHook, routeHook, "pool key hook");
  const encodedPoolKey = encodeAbiParameters(
    [
      { type: "address" }, { type: "address" }, { type: "uint24" },
      { type: "int24" }, { type: "address" },
    ],
    [routeCurrency0, routeCurrency1, routeFee, routeTickSpacing, routeKeyHook],
  );
  same(keccak256(encodedPoolKey), routePoolId, "route poolId does not match keccak256(abi.encode(PoolKey))");
  if (!apiPoolIdIsNull) same(routePoolId, bytes32(api.poolId, "API poolId", false), "route poolId");
  if (!apiPoolKeyIsNull) {
    const apiKey = api.poolKey;
    same(routeCurrency0, address(apiKey.currency0, "API poolKey.currency0", true), "pool currency0");
    same(routeCurrency1, address(apiKey.currency1, "API poolKey.currency1", true), "pool currency1");
    same(routeFee, apiKey.fee, "pool fee");
    same(routeTickSpacing, apiKey.tickSpacing, "pool tick spacing");
    same(routeKeyHook, address(apiKey.hooks, "API poolKey.hooks"), "pool hook");
  }
}
