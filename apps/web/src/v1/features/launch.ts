import v1Abis_TickerMemeTokenV1 from '../generated/contracts/legacy/TickerMemeTokenV1.ts';
import v1Abis_TickerGardenFactoryV1 from '../generated/contracts/legacy/TickerGardenFactoryV1.ts';
import v1Abis_TickerGardenCurve from '../generated/contracts/legacy/TickerGardenCurve.ts';
import currentV4Abis_TickerGardenFactoryV1 from '../generated/contracts/current/TickerGardenFactoryV1.ts';
import currentV4Abis_LaunchAndBuyRouter from '../generated/contracts/current/LaunchAndBuyRouter.ts';
import currentV4Abis_MarketRegistryV1 from '../generated/contracts/current/MarketRegistryV1.ts';
import v1Abis_LaunchAndBuyRouter from '../generated/contracts/legacy/LaunchAndBuyRouter.ts';
import v1Abis_MarketRegistryV1 from '../generated/contracts/legacy/MarketRegistryV1.ts';
import burnV4Abis_TickerGardenFactoryV1 from '../generated/contracts/burn/TickerGardenFactoryV1.ts';
import burnV4Abis_LaunchAndBuyRouter from '../generated/contracts/burn/LaunchAndBuyRouter.ts';
import burnV4Abis_MarketRegistryV1 from '../generated/contracts/burn/MarketRegistryV1.ts';
import { ROBINHOOD_CHAIN_ID } from "../chain.ts";
import { decodeEventLog, keccak256, stringToHex, type Address, type Hex, type TransactionReceipt } from "viem";
import type { MarketDetailResponse, MarketReadModel, SyncStatus } from "../readApi.ts";

import { createContractWriteRequest, type ContractWriteRequest } from "../transaction.ts";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const HEX32 = /^0x[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const ACTIVE = 1;
const NOT_GRADUATED = 0;
const ZERO_HEX32 = `0x${"0".repeat(64)}` as Hex;
const MAX_UINT256 = (1n << 256n) - 1n;

export type CreateMarketParams = Readonly<{
  assetUid: Hex;
  tickerGardenBaselineId: Hex;
  quoteAssetConfigId: Hex;
  launchTemplateId: Hex;
  expectedEconomics: Hex;
  creatorRevenueBeneficiary: Address;
  name: string;
  symbol: string;
  metadataURI: string;
  salt: Hex;
  creatorTaxBps: number;
  creatorFeesToHolders: boolean;
  stakingEnabled: boolean;
  burnMemeFees?: boolean;
  lpFeePips?: number;
}>;

export type SelectedLaunchConfig = Readonly<{
  asset?: Readonly<{ assetUid: Hex; status: number }>;
  quote: Readonly<{ configId: Hex; economicsHash: Hex; quoteAsset: Address; tickerGardenBaselineId: Hex; status: number }>;
  baseline: Readonly<{ baselineId: Hex; status: number }>;
  template: Readonly<{ templateId: Hex; status: number }>;
  creatorRevenueBeneficiary: Address;
  name: string;
  symbol: string;
  metadataURI: string;
  salt: Hex;
  creatorTaxBps?: number;
  creatorFeesToHolders?: boolean;
  stakingEnabled?: boolean;
  burnMemeFees?: boolean;
  lpFeePips?: number;
}>;

export type LaunchRequestSet = Readonly<{
  params: CreateMarketParams;
  request: ContractWriteRequest;
  approval?: ContractWriteRequest;
}>;

export type MarketCreatedConfirmation = Readonly<{
  marketId: Hex;
  memeToken: Address;
  curve: Address;
  gauge: Address;
}>;

export type CurveViewModel = Readonly<{
  marketId: Hex;
  curve: Address;
  quoteAsset: Address;
  memeToken: Address;
  quoteAssetKind: "native" | "erc20";
  launchPhase: number;
  curveTradingEnabled: boolean;
  realQuoteReserve: bigint;
  sellableTokens: bigint;
  reservedTokens: bigint;
  accruedCurveFees: bigint;
  readyToGraduate: boolean;
  launchFeeSource: "factory/chain";
  firstBuyExemption: "creator-or-launch-beneficiary-and-authenticated-router";
  partialRefundPossible: true;
  sync: SyncStatus;
}>;

function canonicalHex(value: string, label: string): Hex {
  if (!HEX32.test(value)) throw new TypeError(`${label} must be lowercase canonical bytes32`);
  return value as Hex;
}

function canonicalAddress(value: string, label: string): Address {
  if (!ADDRESS.test(value)) throw new TypeError(`${label} must be lowercase canonical address`);
  return value as Address;
}

function contractAddress(value: string, label: string): Address {
  const result = canonicalAddress(value, label);
  if (result === ZERO_ADDRESS) throw new TypeError(`${label} cannot be zero`);
  return result;
}

function positive(value: bigint, label: string): void {
  if (value <= 0n || value > MAX_UINT256) throw new RangeError(`${label} must be a positive uint256`);
}

function uint256(value: bigint, label: string): void {
  if (value < 0n || value > MAX_UINT256) throw new RangeError(`${label} must be a uint256`);
}

function active(status: number, label: string): void {
  if (status !== ACTIVE) throw new Error(`${label} must be ACTIVE`);
}

function assertSynced(sync: SyncStatus, displayOnly = false): void {
  if (sync.chainId !== ROBINHOOD_CHAIN_ID || sync.status !== "synced" || (sync.finality !== "finalized" && !(displayOnly && sync.finality === "head")) || sync.blockNumber === null || sync.blockHash === null || !/^\d+$/.test(sync.blockNumber) || !HEX32.test(sync.blockHash) || !/^\d+:0x[0-9a-f]{64}$/.test(sync.revision)) {
    throw new Error("chain snapshot must be synced and finalized");
  }
  if (sync.revision !== `${sync.blockNumber}:${sync.blockHash}`) throw new Error("chain snapshot revision drift");
}

function nonNegative(value: string, label: string): bigint {
  if (!/^\d+$/.test(value)) throw new TypeError(`${label} must be non-negative decimal`);
  return BigInt(value);
}

function assertAddressPair(market: MarketReadModel): void {
  contractAddress(market.curve, "market.curve");
  canonicalAddress(market.quoteAsset, "market.quoteAsset");
  contractAddress(market.memeToken, "market.memeToken");
  contractAddress(market.canonicalRoute.hook, "canonicalRoute.hook");
  contractAddress(market.canonicalRoute.launchLocker, "canonicalRoute.launchLocker");
  contractAddress(market.canonicalRoute.graduationExecutor, "canonicalRoute.graduationExecutor");
}

function assertCanonicalSource(source: MarketReadModel["source"], label: string): void {
  if (
    source.chainId !== ROBINHOOD_CHAIN_ID ||
    !/^\d+$/.test(source.blockNumber) ||
    !HEX32.test(source.blockHash) ||
    !HEX32.test(source.transactionHash) ||
    !Number.isSafeInteger(source.transactionIndex) || source.transactionIndex < 0 ||
    !Number.isSafeInteger(source.logIndex) || source.logIndex < 0
  ) {
    throw new Error(`${label} source is not canonical`);
  }
}

export function deriveCreateMarketParams(config: SelectedLaunchConfig): CreateMarketParams {
  const stakingEnabled = config.stakingEnabled ?? true;
  if (typeof stakingEnabled !== "boolean") throw new TypeError("stakingEnabled must be boolean");
  const suppliedAssetUid = config.asset?.assetUid;
  if (stakingEnabled) {
    if (!config.asset) throw new Error("asset is required when staking is enabled");
    active(config.asset.status, "asset");
    if (canonicalHex(config.asset.assetUid, "assetUid") === ZERO_HEX32) throw new Error("Enabled staking requires a nonzero stock asset");
  } else if (suppliedAssetUid !== undefined && canonicalHex(suppliedAssetUid, "assetUid") !== ZERO_HEX32) {
    throw new Error("disabled staking requires assetUid to be zero");
  }
  active(config.quote.status, "quote");
  active(config.baseline.status, "baseline baseline");
  active(config.template.status, "launch template");
  const assetUid = stakingEnabled ? canonicalHex(config.asset!.assetUid, "assetUid") : ZERO_HEX32;
  const tickerGardenBaselineId = canonicalHex(config.baseline.baselineId, "tickerGardenBaselineId");
  const quoteAssetConfigId = canonicalHex(config.quote.configId, "quoteAssetConfigId");
  const launchTemplateId = canonicalHex(config.template.templateId, "launchTemplateId");
  const quoteEconomicsHash = canonicalHex(config.quote.economicsHash, "quote.economicsHash");
  const quoteBaselineId = canonicalHex(config.quote.tickerGardenBaselineId, "quote.tickerGardenBaselineId");
  if (quoteBaselineId.toLowerCase() !== tickerGardenBaselineId.toLowerCase()) throw new Error("quote/baseline baseline mismatch");
  if (quoteAssetConfigId.toLowerCase() !== quoteEconomicsHash.toLowerCase()) throw new Error("quote configId/economicsHash mismatch");
  if (config.quote.quoteAsset !== ZERO_ADDRESS) canonicalAddress(config.quote.quoteAsset, "quoteAsset");
  if (config.creatorRevenueBeneficiary === ZERO_ADDRESS) throw new Error("creatorRevenueBeneficiary cannot be zero");
  contractAddress(config.creatorRevenueBeneficiary, "creatorRevenueBeneficiary");
  if (config.creatorFeesToHolders !== undefined && typeof config.creatorFeesToHolders !== "boolean") throw new TypeError("Holder fee sharing must be boolean");
  const tax = config.creatorTaxBps ?? 0;
  if (!Number.isInteger(tax) || tax < 0 || tax > 500) throw new RangeError("Creator tax must be between 0 and 500 bps");
  if (config.burnMemeFees !== undefined && typeof config.burnMemeFees !== "boolean") throw new RangeError("Invalid token fee burn choice");
  if (config.lpFeePips !== undefined && ![0,1000,2000,3000].includes(config.lpFeePips)) throw new RangeError("Invalid LP fee tier");
  return Object.freeze({
    ...(config.lpFeePips === undefined ? {} : {lpFeePips:config.lpFeePips}),
    ...(config.burnMemeFees === undefined ? {} : { burnMemeFees: config.burnMemeFees }),
    creatorTaxBps: tax,
    creatorFeesToHolders: config.creatorFeesToHolders ?? false,
    stakingEnabled,
    assetUid, tickerGardenBaselineId, quoteAssetConfigId, launchTemplateId, expectedEconomics: ZERO_HEX32,
    creatorRevenueBeneficiary: config.creatorRevenueBeneficiary,
    name: config.name, symbol: config.symbol, metadataURI: config.metadataURI,
    salt: canonicalHex(config.salt, "salt"),
  });
}

export type PreviewMarketEconomics = (draft: CreateMarketParams) => Promise<Hex>;

export async function previewCreateMarketParams(
  config: SelectedLaunchConfig,
  preview: PreviewMarketEconomics,
): Promise<CreateMarketParams> {
  const draft = deriveCreateMarketParams(config);
  const previewed = canonicalHex(await preview(draft), "previewMarketEconomics");
  if (previewed === ZERO_HEX32) throw new Error("previewMarketEconomics returned zero economics");
  return Object.freeze({ ...draft, expectedEconomics: previewed });
}

export async function buildCreateMarketRequest(input: Readonly<{
  factory: Address;
  launchFee: bigint;
  config: SelectedLaunchConfig;
  previewMarketEconomics: PreviewMarketEconomics;
}>): Promise<Readonly<{ params: CreateMarketParams; request: ContractWriteRequest }>> {
  const params = await previewCreateMarketParams(input.config, input.previewMarketEconomics);
  contractAddress(input.factory, "factory");
  uint256(input.launchFee, "launchFee");
  const request = createContractWriteRequest({
    abi: launchAbis(input.config).TickerGardenFactoryV1,
    address: input.factory,
    functionName: "createMarket",
    args: [params],
    value: input.launchFee,
  });
  return Object.freeze({ params, request });
}

export async function buildLaunchAndBuyRequests(input: Readonly<{
  router: Address;
  launchFee: bigint;
  quoteIn: bigint;
  minTokensOut: bigint;
  recipient: Address;
  config: SelectedLaunchConfig;
  previewMarketEconomics: PreviewMarketEconomics;
}>): Promise<LaunchRequestSet> {
  const params = await previewCreateMarketParams(input.config, input.previewMarketEconomics);
  positive(input.quoteIn, "quoteIn");
  positive(input.minTokensOut, "minTokensOut");
  uint256(input.launchFee, "launchFee");
  contractAddress(input.router, "router");
  contractAddress(input.recipient, "recipient");
  const native = input.config.quote.quoteAsset === ZERO_ADDRESS;
  if (native && input.launchFee > MAX_UINT256 - input.quoteIn) throw new RangeError("native launch value exceeds uint256");
  const request = createContractWriteRequest({
    abi: launchAbis(input.config).LaunchAndBuyRouter,
    address: input.router,
    functionName: "launchAndBuy",
    args: [params, input.quoteIn, input.minTokensOut, input.recipient],
    value: native ? input.launchFee + input.quoteIn : input.launchFee,
  });
  if (native) return Object.freeze({ params, request });
  const approval = createContractWriteRequest({
    abi: v1Abis_TickerMemeTokenV1,
    address: input.config.quote.quoteAsset,
    functionName: "approve",
    args: [input.router, input.quoteIn],
  });
  return Object.freeze({ params, request, approval });
}

export function findCanonicalMarketCreated(
  receipt: Pick<TransactionReceipt, "logs">,
  factory: Address,
  expected: Readonly<{ params: CreateMarketParams; quoteAsset: Address }>,
): MarketCreatedConfirmation {
  const expectedFactory = contractAddress(factory.toLowerCase(), "factory");
  const expectedQuote = canonicalAddress(expected.quoteAsset.toLowerCase(), "quoteAsset");
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== expectedFactory) continue;
    try {
      const decoded = decodeEventLog({
        abi: v1Abis_TickerGardenFactoryV1,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName !== "MarketCreated") continue;
      const args = decoded.args as Record<string, unknown>;
      const marketId = canonicalHex(String(args.marketId).toLowerCase(), "MarketCreated.marketId");
      const assetUid = canonicalHex(String(args.assetUid).toLowerCase(), "MarketCreated.assetUid");
      const memeToken = contractAddress(String(args.memeToken).toLowerCase(), "MarketCreated.memeToken");
      const curve = contractAddress(String(args.curve).toLowerCase(), "MarketCreated.curve");
      const rawGauge = canonicalAddress(String(args.gauge).toLowerCase(), "MarketCreated.gauge");
      const quoteAsset = canonicalAddress(String(args.quoteAsset).toLowerCase(), "MarketCreated.quoteAsset");
      const tickerGardenBaselineId = canonicalHex(String(args.tickerGardenBaselineId).toLowerCase(), "MarketCreated.tickerGardenBaselineId");
      const quoteAssetConfigId = canonicalHex(String(args.quoteAssetConfigId).toLowerCase(), "MarketCreated.quoteAssetConfigId");
      const expectedEconomics = canonicalHex(String(args.expectedEconomics).toLowerCase(), "MarketCreated.expectedEconomics");
      if (
        assetUid !== expected.params.assetUid
        || (expected.params.stakingEnabled ? rawGauge === ZERO_ADDRESS : rawGauge !== ZERO_ADDRESS)
        || quoteAsset !== expectedQuote
        || tickerGardenBaselineId !== expected.params.tickerGardenBaselineId
        || quoteAssetConfigId !== expected.params.quoteAssetConfigId
        || expectedEconomics !== expected.params.expectedEconomics
      ) continue;
      return Object.freeze({ marketId, memeToken, curve, gauge: rawGauge });
    } catch {
      // A receipt can contain unrelated logs from the Router, tokens and Curve.
    }
  }
  throw new Error("The receipt did not contain the expected canonical Factory MarketCreated event");
}

// A database head view is not transaction authority. Only a successful live
// canonical-contract check grants this exact, isolated snapshot to the builders.
// JSON fields cannot forge this process-local grant; mutation invalidates it.
const verifiedCurveResponses=new WeakMap<MarketDetailResponse,string>();
export async function verifyCurveTradeResponse(response:MarketDetailResponse,verify:(market:MarketReadModel)=>Promise<void>):Promise<MarketDetailResponse>{
  const snapshot:MarketDetailResponse={market:structuredClone(response.market),sync:structuredClone(response.sync)};
  const market=validateCurveResponse(snapshot,true);
  const fingerprint=JSON.stringify(snapshot);
  await verify(market);
  if(JSON.stringify(snapshot)!==fingerprint)throw Error('Trade changed during verification');
  verifiedCurveResponses.set(snapshot,fingerprint);
  return snapshot;
}

function validateCurveResponse(response: MarketDetailResponse, displayOnly = false): MarketReadModel {
  if ("observation" in response && response.observation === "direct-chain") {
    const s=response.sync;
    if(s.chainId!==ROBINHOOD_CHAIN_ID||s.status!=="synced"||s.finality!=="head"||!s.blockNumber||!s.blockHash||s.revision!==`${s.blockNumber}:${s.blockHash}`)throw Error("Invalid direct market observation");
  } else assertSynced(response.sync, displayOnly || verifiedCurveResponses.get(response)===JSON.stringify(response));
  const market = response.market;
  canonicalHex(market.marketId, "marketId");
  canonicalHex(market.assetUid, "assetUid");
  canonicalHex(market.quoteAssetConfigId, "quoteAssetConfigId");
  canonicalHex(market.tickerGardenBaselineId, "tickerGardenBaselineId");
  assertAddressPair(market);
  assertCanonicalSource(market.source, "market");
  if (
    market.canonicalRoute.sourceVersion !== market.sourceVersion ||
    market.canonicalRoute.launchPhase !== market.launchPhase
  ) {
    throw new Error("canonical route lifecycle drift");
  }
  if (BigInt(market.source.blockNumber) > BigInt(response.sync.blockNumber as string)) {
    throw new Error("market source is newer than finalized sync");
  }
  return market;
}

export function toCurveProgressViewModel(response: MarketDetailResponse): CurveViewModel {
  // Display projections may follow the verified head; transaction builders below
  // retain their separate finalized/direct-chain validation.
  const market = validateCurveResponse(response, true);
  const quoteAsset = canonicalAddress(market.quoteAsset, "quoteAsset");
  return Object.freeze({
    marketId: canonicalHex(market.marketId, "marketId"), curve: contractAddress(market.curve, "curve"),
    quoteAsset, memeToken: contractAddress(market.memeToken, "memeToken"),
    quoteAssetKind: quoteAsset === ZERO_ADDRESS ? "native" : "erc20",
    launchPhase: market.launchPhase,
    curveTradingEnabled: market.canonicalRoute.curveTradingEnabled,
    realQuoteReserve: nonNegative(market.curveProgress.realQuoteReserve, "realQuoteReserve"),
    sellableTokens: nonNegative(market.curveProgress.sellableTokens, "sellableTokens"),
    reservedTokens: nonNegative(market.curveProgress.reservedTokens, "reservedTokens"),
    accruedCurveFees: nonNegative(market.curveProgress.accruedCurveFees, "accruedCurveFees"),
    readyToGraduate: market.curveProgress.readyToGraduate,
    launchFeeSource: "factory/chain", firstBuyExemption: "creator-or-launch-beneficiary-and-authenticated-router",
    partialRefundPossible: true, sync: response.sync,
  });
}

export function toCurveViewModel(response: MarketDetailResponse): CurveViewModel {
  validateCurveResponse(response);
  const view = toCurveProgressViewModel(response);
  if (view.launchPhase !== NOT_GRADUATED || !view.curveTradingEnabled) {
    throw new Error("market is not an available, not-graduated curve");
  }
  return view;
}

export function buildCurveBuyRequest(input: Readonly<{
  marketResponse: MarketDetailResponse;
  quoteIn: bigint;
  minTokensOut: bigint;
  recipient: Address;
}>): Readonly<{ request: ContractWriteRequest; approval?: ContractWriteRequest; view: CurveViewModel }> {
  const view = toCurveViewModel(input.marketResponse);
  positive(input.quoteIn, "quoteIn"); uint256(input.minTokensOut, "minTokensOut");
  const baseRequest = {
    abi: v1Abis_TickerGardenCurve, address: view.curve, functionName: "buy",
    args: [input.quoteIn, input.minTokensOut, contractAddress(input.recipient, "recipient")],
  } as const;
  const request = view.quoteAssetKind === "native"
    ? createContractWriteRequest({ ...baseRequest, value: input.quoteIn })
    : createContractWriteRequest(baseRequest);
  if (view.quoteAssetKind === "native") return Object.freeze({ request, view });
  const approval = createContractWriteRequest({
    abi: v1Abis_TickerMemeTokenV1, address: view.quoteAsset, functionName: "approve", args: [view.curve, input.quoteIn],
  });
  return Object.freeze({ request, approval, view });
}

export function buildCurveSellRequest(input: Readonly<{
  marketResponse: MarketDetailResponse;
  tokensIn: bigint;
  minQuoteOut: bigint;
  recipient: Address;
}>): Readonly<{ request: ContractWriteRequest; approval: ContractWriteRequest; view: CurveViewModel }> {
  const view = toCurveViewModel(input.marketResponse);
  positive(input.tokensIn, "tokensIn"); uint256(input.minQuoteOut, "minQuoteOut");
  const request = createContractWriteRequest({
    abi: v1Abis_TickerGardenCurve, address: view.curve, functionName: "sell",
    args: [input.tokensIn, input.minQuoteOut, contractAddress(input.recipient, "recipient")],
  });
  const approval = createContractWriteRequest({
    abi: v1Abis_TickerMemeTokenV1, address: view.memeToken, functionName: "approve", args: [view.curve, input.tokensIn],
  });
  return Object.freeze({ request, approval, view });
}

export const MEME_FEE_BURN_MODE = keccak256(stringToHex("TICKERGARDEN_MEME_FEE_BURN_ON_SETTLEMENT_V1"));
export function launchAbis(config: Pick<SelectedLaunchConfig, "burnMemeFees" | "lpFeePips">) {
  const current = {TickerGardenFactoryV1:currentV4Abis_TickerGardenFactoryV1, LaunchAndBuyRouter:currentV4Abis_LaunchAndBuyRouter, MarketRegistryV1:currentV4Abis_MarketRegistryV1};
  const legacy = {TickerGardenFactoryV1:v1Abis_TickerGardenFactoryV1, LaunchAndBuyRouter:v1Abis_LaunchAndBuyRouter, MarketRegistryV1:v1Abis_MarketRegistryV1};
  const burn = {TickerGardenFactoryV1:burnV4Abis_TickerGardenFactoryV1, LaunchAndBuyRouter:burnV4Abis_LaunchAndBuyRouter, MarketRegistryV1:burnV4Abis_MarketRegistryV1};
  return config.lpFeePips !== undefined ? current : config.burnMemeFees === undefined ? legacy : burn;
}
/** Called only while preparing a wallet launch. Never silently drop an enabled burn choice on an older Factory. */
export async function resolveBurnLaunchConfig(config: SelectedLaunchConfig, probe: () => Promise<Hex>): Promise<SelectedLaunchConfig> {
  let mode: Hex | undefined;
  try { mode = await probe(); } catch { /* The legacy preview below still has to succeed. */ }
  if (mode === MEME_FEE_BURN_MODE) return Object.freeze({ ...config, burnMemeFees: config.burnMemeFees ?? false });
  if (config.burnMemeFees === true) throw new Error("This deployment does not support token fee burning yet");
  const { burnMemeFees: _fee, ...legacy } = config;
  return Object.freeze(legacy);
}

export const LP_FEE_MODE = keccak256(stringToHex("TICKERGARDEN_CREATOR_STATIC_LP_FEE_V1"));
export async function resolveLpLaunchConfig(config: SelectedLaunchConfig, probe: () => Promise<Hex>): Promise<SelectedLaunchConfig> {
  let mode: Hex | undefined;
  try { mode = await probe(); } catch { /* Older deployments use their exact legacy tuple. */ }
  if (mode === LP_FEE_MODE) return Object.freeze({...config,lpFeePips:config.lpFeePips ?? 0,burnMemeFees:config.burnMemeFees ?? false});
  if ((config.lpFeePips ?? 0) !== 0) throw new Error("This deployment does not support configurable LP fees yet");
  const {lpFeePips: _fee,...older}=config;
  return Object.freeze(older);
}
