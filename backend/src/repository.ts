import type { ConfigReadModel, MarketReadModel, SyncStatus, UserPositionReadModel } from "./models.ts";

export type ConfigKind = ConfigReadModel["kind"];

export interface ReadModelRepository {
  syncStatus(): SyncStatus;
  markets(): readonly MarketReadModel[];
  market(marketId: string): MarketReadModel | undefined;
  configs(kind: ConfigKind): readonly ConfigReadModel[];
  positions(user: string): readonly UserPositionReadModel[];
}

export interface VerifiedReadModelSnapshot {
  readonly executionSpecId: "V2-EXEC-5";
  readonly reconciliationAlerts: readonly [];
  readonly sync: SyncStatus;
  readonly markets?: readonly MarketReadModel[];
  readonly configs?: readonly ConfigReadModel[];
  readonly positions?: readonly UserPositionReadModel[];
}

const HEX = /^0x[0-9a-f]+$/;
const UINT = /^(0|[1-9][0-9]*)$/;

function assertHex(value: string, bytes: number, label: string): void {
  if (value.length !== 2 + bytes * 2 || !HEX.test(value)) throw new Error(`${label} must be lowercase 0x-prefixed ${bytes}-byte hex`);
}

function assertUint(value: string | null, label: string): void {
  if (value !== null && !UINT.test(value)) throw new Error(`${label} must be a base-10 unsigned integer string`);
}

function validateSource(source: MarketReadModel["source"], sync: SyncStatus): void {
  assertUint(source.blockNumber, "source.blockNumber");
  assertHex(source.blockHash, 32, "source.blockHash");
  assertHex(source.transactionHash, 32, "source.transactionHash");
  if (!Number.isSafeInteger(source.transactionIndex) || source.transactionIndex < 0 || !Number.isSafeInteger(source.logIndex) || source.logIndex < 0) {
    throw new Error("source transaction/log indexes must be non-negative integers");
  }
  if (sync.blockNumber !== null && BigInt(source.blockNumber) > BigInt(sync.blockNumber)) throw new Error("entity source cannot be newer than sync tip");
}

function validateMarket(market: MarketReadModel, sync: SyncStatus): void {
  assertHex(market.marketId, 32, "marketId"); assertHex(market.assetUid, 32, "assetUid");
  for (const [label, value] of Object.entries({ memeToken: market.memeToken, curve: market.curve, gauge: market.gauge, quoteAsset: market.quoteAsset })) assertHex(value, 20, label);
  assertHex(market.quoteAssetConfigId, 32, "quoteAssetConfigId"); assertHex(market.ponsBaselineId, 32, "ponsBaselineId");
  for (const [label, value] of Object.entries({ realQuoteReserve: market.curveProgress.realQuoteReserve, sellableTokens: market.curveProgress.sellableTokens, reservedTokens: market.curveProgress.reservedTokens, accruedCurveFees: market.curveProgress.accruedCurveFees, sweptAt: market.curveProgress.sweptAt })) assertUint(value, label);
  const route = market.canonicalRoute;
  for (const [label, value] of Object.entries({ router: route.router, quoter: route.quoter, hook: route.hook, launchLocker: route.launchLocker, graduationExecutor: route.graduationExecutor })) assertHex(value, 20, label);
  if (route.sourceVersion !== market.sourceVersion || route.launchPhase !== market.launchPhase || route.marketStatus !== market.marketStatus) throw new Error("canonicalRoute lifecycle snapshot mismatch");
  if (market.poolId === null !== (market.poolKey === null)) throw new Error("poolId and poolKey must become available together");
  if (market.poolId && market.poolKey) {
    assertHex(market.poolId, 32, "poolId");
    for (const [label, value] of Object.entries({ currency0: market.poolKey.currency0, currency1: market.poolKey.currency1, hooks: market.poolKey.hooks })) assertHex(value, 20, label);
    if (market.poolKey.hooks !== route.hook) throw new Error("PoolKey hook must equal canonicalRoute hook");
    const currencies = [market.quoteAsset, market.memeToken].sort();
    if (market.poolKey.currency0 !== currencies[0] || market.poolKey.currency1 !== currencies[1]) throw new Error("PoolKey currencies must be the sorted canonical Quote/Meme pair");
  }
  validateSource(market.source, sync);
}

function validatePosition(position: UserPositionReadModel, markets: readonly MarketReadModel[], sync: SyncStatus): void {
  assertHex(position.user, 20, "position.user"); assertHex(position.assetUid, 32, "position.assetUid"); assertHex(position.marketId, 32, "position.marketId");
  for (const [label, value] of Object.entries({ free: position.free, allocated: position.allocated, pending: position.pending, active: position.active, activationAt: position.activationAt, unlockAt: position.unlockAt })) assertUint(value, label);
  if (BigInt(position.allocated) !== BigInt(position.pending) + BigInt(position.active)) throw new Error("position allocated must equal pending plus active");
  const market = markets.find(({ marketId }) => marketId === position.marketId);
  if (!market || market.assetUid !== position.assetUid) throw new Error("position must reference its canonical market and asset");
  if (position.claimable.length !== 2 || position.claimable[0].kind !== "quote" || position.claimable[1].kind !== "meme") throw new Error("position claimable must contain canonical Quote and Meme entries");
  if (position.claimable[0].asset !== market.quoteAsset || position.claimable[1].asset !== market.memeToken) throw new Error("position claimable assets must match canonical market assets");
  for (const claim of position.claimable) { assertHex(claim.asset, 20, "claim.asset"); assertUint(claim.amount, "claim.amount"); }
  validateSource(position.source, sync);
}

function validateConfig(config: ConfigReadModel, sync: SyncStatus): void {
  assertHex(config.id, 32, "config.id");
  if (config.kind === "asset") {
    const minimumAllocation = config.values.minimumAllocation;
    if (typeof minimumAllocation !== "string" || !UINT.test(minimumAllocation) || BigInt(minimumAllocation) < 414n) {
      throw new Error("asset minimumAllocation must be a base-10 raw-unit string of at least 414");
    }
  }
  validateSource(config.source, sync);
}

export class InMemoryReadModelRepository implements ReadModelRepository {
  readonly #sync: SyncStatus;
  readonly #markets: readonly MarketReadModel[];
  readonly #configs: readonly ConfigReadModel[];
  readonly #positions: readonly UserPositionReadModel[];

  constructor(input: VerifiedReadModelSnapshot) {
    if (input.executionSpecId !== "V2-EXEC-5" || input.reconciliationAlerts.length !== 0) throw new Error("read model snapshot is not V2-reconciled");
    assertUint(input.sync.blockNumber, "sync.blockNumber"); assertUint(input.sync.headBlockNumber, "sync.headBlockNumber"); assertUint(input.sync.lagBlocks, "sync.lagBlocks");
    if (input.sync.blockHash) assertHex(input.sync.blockHash, 32, "sync.blockHash");
    if (input.sync.headBlockHash) assertHex(input.sync.headBlockHash, 32, "sync.headBlockHash");
    this.#sync = input.sync;
    this.#markets = [...input.markets ?? []];
    this.#configs = [...input.configs ?? []];
    this.#positions = [...input.positions ?? []];
    this.#markets.forEach((market) => validateMarket(market, this.#sync));
    this.#configs.forEach((config) => validateConfig(config, this.#sync));
    this.#positions.forEach((position) => validatePosition(position, this.#markets, this.#sync));
    for (const collection of [this.#markets.map(({ marketId }) => marketId), this.#configs.map(({ kind, id }) => `${kind}:${id}`), this.#positions.map(({ user, assetUid, marketId }) => `${user}:${assetUid}:${marketId}`)]) {
      if (new Set(collection).size !== collection.length) throw new Error("read model snapshot contains duplicate canonical identities");
    }
  }

  syncStatus(): SyncStatus { return this.#sync; }
  markets(): readonly MarketReadModel[] { return this.#markets; }
  market(marketId: string): MarketReadModel | undefined {
    const normalized = marketId.toLowerCase();
    return this.#markets.find((market) => market.marketId.toLowerCase() === normalized);
  }
  configs(kind: ConfigKind): readonly ConfigReadModel[] { return this.#configs.filter((config) => config.kind === kind); }
  positions(user: string): readonly UserPositionReadModel[] {
    const normalized = user.toLowerCase();
    return this.#positions.filter((position) => position.user.toLowerCase() === normalized);
  }
}

export const EMPTY_REPOSITORY = new InMemoryReadModelRepository({
  executionSpecId: "V2-EXEC-5", reconciliationAlerts: [],
  sync: { chainId: 4663, status: "unavailable", blockNumber: null, blockHash: null, finality: "unavailable", headBlockNumber: null, headBlockHash: null, lagBlocks: null, revision: "empty" },
});
