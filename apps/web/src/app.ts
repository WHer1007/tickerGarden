import { tradingRoute, stakerClaimHelp, rewardTab } from "./v1/flowUx.ts";
import { readCreateDraft, writeCreateDraft, clearCreateDraft, type CreateDraft } from "./create/draft.ts";
import {graduationProgress} from "./v1/graduationProgress.ts";
import {PERMIT2,poolRouterAbi,poolQuoterAbi,permit2Abi,poolSwapAbi,assertPoolRouterProfile,poolTradeRoute,poolAmount,buildPoolTrade} from "./v1/poolTrade.ts";
import { assertRecoveredLaunchReceipt } from "./create/launch-confirmation.ts";
import { renderLaunchProgress, closeLaunchProgress } from "./create/launch-progress-dialog.ts";
import { readLaunchState, saveLaunchState, launchStateKey, launchPhaseDisplay, type LaunchState, type LaunchPhase } from "./create/launch-state.ts";
import { ipfsGatewayURL, isIPFSFileURI } from "./create/ipfs.ts";
import { renderListingPanel } from "./create/listing-panel.ts";
import { parseSavedListing, type ListingPackageSnapshot } from "./create/listing-package.ts";
import { DeveloperBuyBalanceCache, developerBuyNotice } from './create/developer-buy.ts';
import { feePreviewTable } from './create/fee-preview.ts';
import { mountFieldValidation } from './ui/fieldValidation.ts';
import { createDisabledReason } from './v1/createAvailability.ts';
import {integrationFeed} from "./v1/integrationFeed.ts";
import {mountDirectTrades} from "./v1/directTradeWidget.ts";
import {directReceipt} from "./v1/directReceipt.ts";
import {DirectMarkets} from "./v1/directMarkets.ts";
import {parseIntegrationBootstrap,bootstrapSync,type IntegrationBootstrap} from "./v1/integrationBootstrap.ts";
import { mountTokenDetail } from './v1/tokenDetailWidget.ts';
import { readDetailMetadata } from './v1/tokenMetadata.ts';
import { mountTradePreview } from './pages/tradePreview.ts';
import { feeDistribution } from './v1/marketDetail.ts';
import { authorizedWalletAccount } from "./ui/wallet-session.ts";
import { createRouter } from "./routing/router.ts";
import { pages } from "./routing/pages.ts";
import { mountPageVisuals } from "./routing/visuals.ts";
import type { PageName, Route } from "./routing/routes.ts";
import { loadWalletAccounts } from "./v1/accounts.ts";
import { mountUserActivity } from "./v1/userActivityWidget.ts";
import { resolveMarketRelease, type MarketRelease } from "./v1/marketRelease.ts";
import { mountTransactionObservation } from "./v1/transactionObservation.ts";
import { createMarketDirectory, type DirectoryQuery } from "./v1/marketDirectory.ts";
import { HOLDER_REWARDS_DISTRIBUTOR_V1_ABI as continuousRewardsAbi, isContinuousHolderRewardMode, buildContinuousHolderClaim } from "./v1/features/continuousRewards.ts";
import { createCoalescedRefresh } from "./v1/coalescedRefresh.ts";
import { statisticsQuoteLabel } from "./v1/statsQuote.ts";
import { mountGlobalHolders } from "./v1/globalHoldersWidget.ts";
import { mountGlobalSeries } from "./v1/globalSeriesWidget.ts";
import { mountGlobalStatistics } from "./v1/globalStatsWidget.ts";
import { mountHolders } from "./v1/holderWidget.ts";
import { mountTrades } from "./v1/tradeWidget.ts";
import { mountCandles } from "./v1/candleWidget.ts";
import { createRenderGeneration } from "./runtime/renderGeneration.ts";
import { createSnapshotPoller, SnapshotRefreshSuperseded } from "./v1/snapshotUpdates.ts";
import { mountDisplayPrice } from "./v1/displayPrices.ts";
import { creatorTaxBps, assertCreatorTaxSupported, DEVELOPER_BUY_SLIPPAGE_BPS } from "./create/options.ts";
import { activePairedConfig, RELEASE_PAIRED_ASSETS, RELEASE_OBSERVED_AT, RELEASE_SUPPLY, releasePairForSelection } from "./create/paired-assets.ts";
import { developerBuyMode, graduationAmount, graduationEconomics } from "./create/economics.ts";
import { metadataOrigin, publishLaunchDetails, readTokenImage } from "./create/metadata.ts";
import { destroyQuotePicker, updateQuotePicker, type QuotePickerOption } from "./create/quote-picker.ts";
import { publicMessage } from "./ui/public-copy.ts";
import { createWalletPicker, type InjectedProvider } from "./ui/wallet-picker.ts";
import { ensureWalletChain } from "./ui/network-support.ts";
import { resolveLaunchFunding, type LaunchFunding } from "./v1/launchFunding.ts";
import { assertCanonicalSnapshotContinuation, mapConcurrent } from "./runtime/snapshot.ts";
import "@phosphor-icons/web/regular";
import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
  encodeFunctionData,
  erc20Abi,
  http,
  parseAbi,
  toHex,
  type Address,
  type Hash,
  type Hex,
  type TransactionReceipt,
} from "viem";

import { robinhoodChain } from "./v1/chain.ts";
import {
  assertCanonicalAssetBinding,
  assertCanonicalFactoryBindings,
  assertCanonicalLaunchBindings,
  assertCanonicalMarketBinding,
  decodeCanonicalFactoryBindings,
  type CanonicalAssetBinding,
  type CanonicalRuntimeBindings,
} from "./v1/chainBindings.ts";
import {
  buildCreateMarketRequest,
  buildCurveBuyRequest,
  buildCurveSellRequest,
  buildLaunchAndBuyRequests,
  deriveCreateMarketParams,
  findCanonicalMarketCreated,
  toCurveProgressViewModel,
  type CreateMarketParams,
  type SelectedLaunchConfig,
} from "./v1/features/launch.ts";
import {
  buildClaimCreator,
  buildTransferCreatorBeneficiary,
} from "./v1/features/creator.ts";
import {
  buildFinalizeRoot,
  buildExpireRoot,
  buildRequestRoot,
  buildRolloverEpoch,
  buildTreasuryClaim,
  buildWithdrawServiceCredit,
  fetchTreasuryClaimProof,
  type TreasuryClaimProof,
} from "./v1/features/treasury.ts";
import {
  buildClaimStaker,
  buildStake,
  validateMarketStake,
  buildUnstakeAndWithdraw,
  buildDirectRageQuit,
  buildRageQuit,
  buildSettleRageQuitRewards,
  buildStockApproval,
} from "./v1/features/vault.ts";
import { v1Abis, V1_EXECUTION_SPEC_ID } from "./v1/generated/abis.ts";
import {
  TickerGardenV1Client,
  type ConfigReadModel,
  type HealthResponse,
  type MarketDetailResponse,
  type MarketReadModel,
  type SyncStatus,
} from "./v1/readApi.ts";
import { parseV1RuntimeConfig } from "./v1/runtimeConfig.ts";
import {
  createContractWriteRequest,
  V1TransactionError,
  V1TransactionExecutor,
  type ContractWriteRequest,
  type ReconciledSnapshot,
  type TransactionUpdate,
  type V1TransactionClients,
} from "./v1/transaction.ts";
import {
  ADDRESS_PATTERN,
  BYTES32_PATTERN,
  ZERO_ADDRESS,
  assertFinalizedSync,
  canonicalAddress,
  canonicalBytes32,
  configNumber,
  configBigInt,
  configString,
  errorText as rawErrorText,
  foldSortedMerkleProof,
  formatTokenAmount,
  minimumAfterSlippage,
  parseSlippageBps,
  parseTokenAmount,
  parseUint32,
  phaseLabel,
  shortHex,
  tupleField,
  tupleBigInt,
  tupleNumber,
  tupleString,
  type MarketMetadata,
} from "./runtime/model.ts";

let integrationBootstrap: IntegrationBootstrap | null = null;
let directMarkets: DirectMarkets | null = null;
const integrationBootstrapPath = import.meta.env.VITE_INTEGRATION_BOOTSTRAP as string | undefined;
type Foundation = Readonly<{
  direct?: true;
  health: HealthResponse;
  sync: SyncStatus;
  assets: readonly ConfigReadModel[];
  quotes: readonly ConfigReadModel[];
  baseline: readonly ConfigReadModel[];
  templates: readonly ConfigReadModel[];
  markets: readonly MarketReadModel[];
  marketNextCursor?: string;
  bindings?: CanonicalRuntimeBindings;
  launchFee?: bigint;
  writeReady: boolean;
  writeReasons: readonly string[];
}>;

interface WalletState {
  readonly account: Address;
  readonly provider: InjectedProvider;
  readonly executor: V1TransactionExecutor;
}

let routeGeneration = 0;
let pageActionPending = false;
let deferredRoute: string | null = null;
let rewardRefreshTimer = 0;
let disposeVisuals: (() => void) | undefined;
let walletPicker: ReturnType<typeof createWalletPicker> | undefined;
let snapshotPoller: ReturnType<typeof createSnapshotPoller> | undefined;
let syncRewardHash: (() => void) | undefined;

async function runPageAction(action: () => Promise<void>): Promise<void> {
  if (pageActionPending || busyOperation || walletConnecting) return;
  pageActionPending = true;
  try { await action(); }
  finally {
    pageActionPending = false;
    if (deferredRoute) { const next = deferredRoute; deferredRoute = null; const navigated=router.navigate(next);
      if(!navigated)setTimeout(()=>void restoreLaunchProgress(),1000);
      if(navigated&&launchProgress?.phase==='complete'){localStorage.removeItem(launchStateKey(robinhoodChain.id));launchProgress=null;}
    }
  }
}

const brandMarkUrl = new URL("../assets/tickergarden-mark.png", import.meta.url).href;
const brandWordmark = `<span class="wordmark" aria-hidden="true"><span>Ticker</span><span>Garden</span></span>`;
const runtimeConfig = parseV1RuntimeConfig(import.meta.env);
const publicClient = createPublicClient({
  chain: robinhoodChain,
  transport: http(import.meta.env.VITE_V1_RPC_URL || robinhoodChain.rpcUrls.default.http[0]),
});
const readApi = runtimeConfig.readApi.available
  ? new TickerGardenV1Client(runtimeConfig.readApi.value)
  : null;

let userActivityWidget: ReturnType<typeof mountUserActivity> | null = null;
let globalHoldersWidget: ReturnType<typeof mountGlobalHolders> | null = null;
let seriesWidget: ReturnType<typeof mountGlobalSeries> | null = null;
let globalStatsWidgets: ReturnType<typeof mountGlobalStatistics>[] = [];
let tokenDetailWidget: ReturnType<typeof mountTokenDetail> | null = null;
let detailContentAbort: AbortController | null = null;
let detailBalancesGeneration=0;
let detailBalanceAccount:string|undefined;
let detailBalances: {quote:bigint;meme:bigint}|null=null;
let holderWidget: ReturnType<typeof mountHolders> | null = null;
let tradeHistoryWidget: ReturnType<typeof mountTrades> | null = null;
let candleWidget: ReturnType<typeof mountCandles> | null = null;
let displayPriceWidget: ReturnType<typeof mountDisplayPrice> | null = null;
let analyticsWidgets: Array<{ refresh(): Promise<void>; stop(): void }> = [];
const analyticsRefresh = createCoalescedRefresh(() => Promise.all(analyticsWidgets.map(widget => widget.refresh())));

function syncUserActivity(): void {
  const panel = document.querySelector<HTMLElement>('[data-rewards-panel="activity"]');
  userActivityWidget?.setContext(wallet?.account ?? null, !!panel && !panel.hidden && document.visibilityState !== "hidden" && navigator.onLine);
}
function mountPageWidgets(): void {
  const base = runtimeConfig.readApi.available ? runtimeConfig.readApi.value : null;
  const detailRoot=query<HTMLElement>(".trade-live");
  tokenDetailWidget=detailRoot?mountTokenDetail(detailRoot,base,robinhoodChain.id,robinhoodChain.blockExplorers.default.url):null;
  const activity = query<HTMLElement>("[data-user-activity]");
  userActivityWidget = activity ? mountUserActivity(activity, base, robinhoodChain.id) : null;
  const holders = query<HTMLElement>("[data-global-holders]");
  globalHoldersWidget = holders ? mountGlobalHolders(holders, base, robinhoodChain.id, query<HTMLElement>("[data-stat-holders]")) : null;
  const series = query<HTMLElement>("[data-global-series]");
  seriesWidget = series ? mountGlobalSeries(series, base, robinhoodChain.id) : null;
  globalStatsWidgets = queryAll<HTMLElement>("[data-global-statistics]").map(element => mountGlobalStatistics(element, base, robinhoodChain.id));
  analyticsWidgets = [...globalStatsWidgets, globalHoldersWidget, seriesWidget].filter((widget): widget is NonNullable<typeof widget> => widget !== null);
  const holder = query<HTMLElement>("[data-market-holders]");
  holderWidget = holder ? mountHolders(holder, base, robinhoodChain.id, (page) => {
    text('[data-detail-holders]', page ? `${page.positiveAddressCount.toLocaleString()} addresses` : 'Unavailable');
    text('[data-detail-supply]', page ? formatTokenAmount(page.totalSupplyRaw, 18) : 'Unavailable');
  }) : null;
  const trades = query<HTMLElement>("[data-market-trades]");
  tradeHistoryWidget = trades ? (integrationBootstrapPath ? mountDirectTrades(trades,base) : mountTrades(trades, base, robinhoodChain.id)) : null;
  const candles = query<HTMLElement>("[data-market-candles]");
  candleWidget = candles ? mountCandles(candles, base, robinhoodChain.id) : null;
  const prices = query<HTMLElement>("[data-display-price]");
  displayPriceWidget = prices ? mountDisplayPrice(prices, base, robinhoodChain.id) : null;
}
function pauseAnalytics(): void {
  analyticsRefresh.cancel();
  analyticsWidgets.forEach(widget => widget.stop());
  tradeHistoryWidget?.stop(); candleWidget?.stop(); holderWidget?.stop();
  statsRender.invalidate();
  clearStatsSnapshotView("Statistics paused or unavailable. Waiting for a verified snapshot.");
  homeRender.invalidate(); clearHomeMarketView();
}
window.addEventListener("pagehide", () => { userActivityWidget?.stop(); pauseAnalytics(); });
window.addEventListener("pagehide", event => { if (!event.persisted) { displayPriceWidget?.stop(); disposeVisuals?.(); } });
window.addEventListener("pageshow", syncUserActivity);
window.addEventListener("offline", () => userActivityWidget?.stop());
window.addEventListener("online", () => { syncUserActivity(); userActivityWidget?.refresh(); });
document.addEventListener("visibilitychange", syncUserActivity);

let foundation: Foundation | null = null;
let foundationError = "";
let wallet: WalletState | null = null;
let walletConnecting = false;
let busyOperation = "";
const metadataCache = new Map<string, Promise<MarketMetadata>>();

const transactionStageLabels: Record<TransactionUpdate["stage"], string> = {
  unknown: "Outcome awaiting verification",
  preflight: "Checking current transaction state",
  simulating_approval: "Simulating token approval",
  awaiting_approval_signature: "Confirm token approval in your wallet",
  approval_submitted: "Approval submitted",
  approval_confirmed: "Approval confirmed",
  simulating: "Simulating protocol call",
  awaiting_signature: "Confirm protocol call in your wallet",
  submitted: "Transaction submitted",
  pending: "Waiting for a canonical receipt",
  replaced: "Wallet replaced the transaction",
  confirming: "Checking fresh on-chain state",
  confirmed: "Transaction confirmed",
  failed: "Transaction stopped",
};

function errorText(error: unknown): string { return publicMessage(rawErrorText(error)); }

function query<T extends Element>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(selector);
}

function queryAll<T extends Element>(selector: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

function required<T extends Element>(selector: string, root: ParentNode = document): T {
  const value = query<T>(selector, root);
  if (!value) throw new Error(`Required page element is missing: ${selector}`);
  return value;
}

function text(selector: string, value: string, root: ParentNode = document): void {
  const element = query<HTMLElement>(selector, root);
  if (element) element.textContent = publicMessage(value);
}

function iconText(selector: string, iconClass: string, value: string): void {
  const element = query<HTMLElement>(selector);
  if (!element) return;
  const icon = document.createElement("i");
  icon.className = `ph ${iconClass}`;
  icon.setAttribute("aria-hidden", "true");
  const message = document.createElement("span");
  message.textContent = publicMessage(value);
  element.replaceChildren(icon, message);
}

function setDisabled(element: HTMLButtonElement | HTMLInputElement | HTMLSelectElement, disabled: boolean): void {
  element.disabled = disabled;
  element.setAttribute("aria-disabled", String(disabled));
}

function currentPage(): PageName {
  const candidate = document.body.dataset.page;
  return (["home", "markets", "trade", "create", "stats", "rewards", "staking", "docs", "privacy", "terms", "risks", "not-found"] as const).includes(candidate as PageName)
    ? candidate as PageName
    : "home";
}

function randomSalt(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

function toast(message: string, tone: "neutral" | "success" | "warning" | "error" = "neutral"): void {
  const node = query<HTMLElement>("[data-toast]");
  if (!node) return;
  node.textContent = publicMessage(message);
  node.dataset.state = tone;
  node.setAttribute("role", tone === "error" ? "alert" : "status");
  node.setAttribute("aria-live", tone === "error" ? "assertive" : "polite");
  node.setAttribute("aria-atomic", "true");
  node.classList.add("show");
  window.setTimeout(() => node.classList.remove("show"), 4_000);
}

function setPageStatus(message: string, tone: "neutral" | "success" | "warning" | "error" = "neutral"): void {
  const target = query<HTMLElement>("[data-page-status]");
  if (!target) return;
  target.textContent = publicMessage(message);
  target.dataset.state = tone;
}

function runtimeReasons(): readonly string[] {
  if (foundationError) return [publicMessage(foundationError)];
  if (!foundation) return runtimeConfig.reasons.length > 0 ? runtimeConfig.reasons.map(publicMessage) : ["Loading market data"];
  return foundation.writeReasons.map(publicMessage);
}

function isRewardsPage(): boolean { return currentPage() === 'rewards' || currentPage() === 'staking'; }
function hasPendingTransaction(): boolean {
  if (!wallet) return false;
  try { return !!wallet.executor.pending(wallet.account); } catch { return true; }
}
function writeReady(): boolean {
  return Boolean(foundation?.writeReady && wallet && !busyOperation && !walletConnecting && !hasPendingTransaction());
}

function treasuryWritesReady(): boolean {
  return writeReady() && runtimeConfig.treasuryWrites.available;
}

function snapshot(sync: SyncStatus): ReconciledSnapshot {
  return { executionSpecId: V1_EXECUTION_SPEC_ID, revision: sync.revision, syncStatus: sync.status, ...(foundation?.direct ? {authority:"direct-chain" as const}: {}) };
}

async function readAllConfig(kind: ConfigReadModel["kind"], revision: string, api = readApi): Promise<readonly ConfigReadModel[]> {
  if (!api) throw new Error("V1 read API is not configured");
  const items: ConfigReadModel[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  while (true) {
    const response = await api.listConfig({ kind, revision, limit: 100, ...(cursor ? { cursor } : {}) });
    assertFinalizedSync(response.sync, revision, `${kind} configuration`);
    items.push(...response.items);
    if (!response.nextCursor) return Object.freeze(items);
    if (seen.has(response.nextCursor)) throw new Error("Read API returned a repeated config cursor");
    seen.add(response.nextCursor);
    cursor = response.nextCursor;
  }
}

async function readMarketPage(revision: string, cursor?: string, api = readApi) {
  if (!api) throw new Error("V1 read API is not configured");
  const response = await api.listMarkets({ revision, limit: 100, ...(cursor ? { cursor } : {}) });
  assertFinalizedSync(response.sync, revision, "market directory");
  return response;
}

let foundationGeneration = 0;
let loadingFoundation: Promise<void> | null = null;
async function loadFoundation(): Promise<void> {
  if (loadingFoundation) return loadingFoundation;
  loadingFoundation = (async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (isStaticPage()) break;
      await loadFoundationAttempt();
      if (foundation || !readApi) break;
    }
  })().finally(() => { loadingFoundation = null; });
  return loadingFoundation;
}

async function loadFoundationAttempt(): Promise<void> {
  const generation = ++foundationGeneration;
  if (!readApi) { foundationError = "V1 read API is unavailable"; return; }
  try {
    const next = await prepareFoundation(readApi);
    if (generation !== foundationGeneration) return;
    invalidateSnapshotReads();
    foundation = next;
    foundationError = "";
  } catch (error) {
    if (generation !== foundationGeneration) return;
    foundation = null;
    foundationError = errorText(error);
    invalidateSnapshotReads();
  }
}

async function prepareFoundation(api: TickerGardenV1Client, expectedSync?: SyncStatus): Promise<Foundation> {
  if (integrationBootstrapPath) {
    if (!runtimeConfig.contracts.available) throw Error("Integration contracts missing");
    if (!integrationBootstrap) {
      if (!integrationBootstrapPath.startsWith("/integration/") || integrationBootstrapPath.includes("..")) throw Error("Invalid integration configuration path");
      const response=await fetch(integrationBootstrapPath);if(!response.ok)throw Error("Integration deployment file unavailable");
      integrationBootstrap=parseIntegrationBootstrap(await response.json(),robinhoodChain.id,runtimeConfig.contracts.value);
    }
    const b=integrationBootstrap,sync=bootstrapSync(b);
    directMarkets ??= new DirectMarkets(b,(address,abi,functionName,args,blockNumber)=>publicClient.readContract({address,abi,functionName,args,blockNumber}),async()=>{const h=await publicClient.getBlock({blockTag:"latest"});return {number:h.number,hash:h.hash};},localStorage);
    return Object.freeze({direct:true,health:({executionSpecId:V1_EXECUTION_SPEC_ID,status:"read-api",readApiImplemented:true,productRuntimeImplemented:true,custody:false,transactionSubmission:false,sync} as HealthResponse),sync,assets:b.assets,quotes:b.configs.filter(c=>c.kind==="quote"),baseline:b.configs.filter(c=>c.kind==="baseline"),templates:b.configs.filter(c=>c.kind==="template"),markets:foundation?.direct ? foundation.markets : [],bindings:b.bindings,launchFee:BigInt(b.launchFee),writeReady:true,writeReasons:[]});
  }
  let health = await api.getHealth();
  if (health.executionSpecId !== V1_EXECUTION_SPEC_ID || health.status !== "read-api" || !health.readApiImplemented) {
    throw new Error("Read API does not advertise this V1 execution contract");
  }
  if (health.custody || health.transactionSubmission) throw new Error("Read API violates the non-custodial read-only boundary");
  assertFinalizedSync(health.sync, undefined, "Read API health");
  if (expectedSync) { assertFinalizedSync(expectedSync); health = { ...health, sync: expectedSync }; }
  const revision = health.sync.revision;
  const [assets, quotes, baseline, templates, marketPage] = await Promise.all([
    readAllConfig("asset", revision, api),
    readAllConfig("quote", revision, api),
    readAllConfig("baseline", revision, api),
    readAllConfig("template", revision, api),
    readMarketPage(revision, undefined, api),
  ]);

  const reasons: string[] = [];
  let bindings: CanonicalRuntimeBindings | undefined;
  let launchFee: bigint | undefined;
  if (!health.productRuntimeImplemented) reasons.push("Read API reports that the V1 product runtime is incomplete");
  if (!runtimeConfig.contracts.available) {
    reasons.push(...runtimeConfig.contracts.reasons);
  } else {
    const configured = runtimeConfig.contracts.value;
    try {
      const [rawBindings, rawLaunchFee, treasury, creatorRegistry] = await Promise.all([
        publicClient.readContract({ abi: v1Abis.TickerGardenFactoryV1, address: configured.factoryAddress, functionName: "runtimeBindings" }),
        publicClient.readContract({ abi: v1Abis.TickerGardenFactoryV1, address: configured.factoryAddress, functionName: "launchFee" }),
        publicClient.readContract({ abi: v1Abis.TickerGardenFactoryV1, address: configured.factoryAddress, functionName: "treasuryDistributor" }),
        publicClient.readContract({ abi: v1Abis.TickerGardenFactoryV1, address: configured.factoryAddress, functionName: "creatorRevenueRegistry" }),
      ]);
      bindings = assertCanonicalFactoryBindings(rawBindings, {
        launchRouter: configured.launchRouterAddress,
        allocationManager: configured.allocationManagerAddress,
        protocolFeeVault: configured.protocolFeeVaultAddress,
      });
      if (treasury.toLowerCase() !== configured.treasuryDistributorAddress) throw new Error("Configured TreasuryDistributor is not the Factory binding");
      if (creatorRegistry.toLowerCase() !== configured.creatorRevenueRegistryAddress) throw new Error("Configured CreatorRevenueRegistry is not the Factory binding");
      const treasuryRegistry = await publicClient.readContract({
        abi: v1Abis.TreasuryDistributorV1,
        address: configured.treasuryDistributorAddress,
        functionName: "marketRegistry",
      });
      if (treasuryRegistry.toLowerCase() !== bindings.marketRegistry) throw new Error("TreasuryDistributor is bound to a different MarketRegistry");
      const addresses = [...new Set([
        configured.factoryAddress,
        configured.creatorRevenueRegistryAddress,
        configured.treasuryDistributorAddress,
        ...Object.values(bindings),
      ])];
      const codes = await Promise.all(addresses.map((address) => publicClient.getCode({ address })));
      if (codes.some((code) => !code || code === "0x")) throw new Error("One or more configured V1 contracts have no runtime code");
      launchFee = rawLaunchFee;
    } catch (error) {
      reasons.push(errorText(error));
    }
  }
  return Object.freeze({
    health,
    sync: health.sync,
    assets,
    quotes,
    baseline,
    templates,
    markets: marketPage.items,
    ...(marketPage.nextCursor ? { marketNextCursor: marketPage.nextCursor } : {}),
    ...(bindings ? { bindings } : {}),
    ...(launchFee !== undefined ? { launchFee } : {}),
    writeReady: health.productRuntimeImplemented && reasons.length === 0,
    writeReasons: Object.freeze(reasons),
  });
}

async function ensureCurrentRevision(expected: string): Promise<string> {
  // Direct operations validate the relevant current contracts before simulation;
  // analytics revisions never authorize these transactions.
  if(foundation?.direct && integrationBootstrap) return expected;
  if (!readApi) throw new V1TransactionError("indexer_unavailable", "The V1 read API is unavailable");
  let current: HealthResponse;
  try {
    current = await readApi.getHealth();
  } catch (error) {
    throw new V1TransactionError("indexer_unavailable", "The V1 read API could not verify the current revision", error);
  }
  try {
    await assertCanonicalSnapshotContinuation(current.sync, expected, async (blockNumber) =>
      (await publicClient.getBlock({ blockNumber })).hash);
  } catch (error) {
    await loadFoundation();
    window.setTimeout(() => { if (!busyOperation) void refreshCurrentPage(); }, 0);
    throw new V1TransactionError("stale_snapshot", "The snapshot was refreshed. Review a new quote before signing; any completed approval remains onchain", error);
  }
  if (
    current.executionSpecId !== V1_EXECUTION_SPEC_ID
    || !current.productRuntimeImplemented
    || current.custody
    || current.transactionSubmission
  ) throw new V1TransactionError("stale_snapshot", "The V1 capability contract changed; refresh before signing");
  return expected;
}

async function ensureCanonicalAsset(config: ConfigReadModel, bindings: ReturnType<typeof assertCanonicalFactoryBindings> | undefined): Promise<CanonicalAssetBinding> {
  if (!bindings) throw new Error("Canonical Factory bindings are unavailable");
  const [rawAsset, minimum] = await Promise.all([
    publicClient.readContract({ abi: v1Abis.OfficialStockRegistryV1, address: bindings.officialStockRegistry, functionName: "asset", args: [config.id] }),
    publicClient.readContract({ abi: v1Abis.OfficialStockRegistryV1, address: bindings.officialStockRegistry, functionName: "minimumAllocation", args: [config.id] }),
  ]);
  return assertCanonicalAssetBinding(config, rawAsset, minimum);
}

const verifiedMarketRuntime = new Map<string, ReturnType<typeof assertCanonicalFactoryBindings>>();
const verifiedMarketReleases = new Map<string, MarketRelease>();
function marketRelease(id: string): MarketRelease {
  const value = verifiedMarketReleases.get(id);
  if (!value) throw new Error("Market release has not been verified");
  return value;
}
async function ensureCanonicalMarket(market: MarketReadModel): Promise<void> {
  if (!foundation?.bindings || !runtimeConfig.contracts.available) throw new Error("Canonical Factory bindings are unavailable");
  const c = runtimeConfig.contracts.value;
  const token = canonicalAddress(market.memeToken, "Market token");
  const [factory, distributor] = await Promise.all([
    publicClient.readContract({ abi: v1Abis.TickerMemeTokenV1, address: token, functionName: "factory" }),
    publicClient.readContract({ abi: v1Abis.TickerMemeTokenV1, address: token, functionName: "treasuryDistributor" }),
  ]);
  const catalog = [...runtimeConfig.releaseCatalog];
  if (factory.toLowerCase() === c.factoryAddress && !catalog.some(r => r.chainId === robinhoodChain.id && r.factory.toLowerCase() === c.factoryAddress)) {
    const record = await publicClient.readContract({abi: v1Abis.MarketRegistryV1, address: foundation.bindings.marketRegistry, functionName: "market", args: [market.marketId]});
    const hook = canonicalAddress(tupleString(tupleField(record, "config", 0), "graduatedHook", 13), "Market hook");
    catalog.push({releaseId: "configured-current", chainId: robinhoodChain.id, factory: c.factoryAddress,
      marketRegistry: foundation.bindings.marketRegistry, hook, feeVault: c.protocolFeeVaultAddress,
      creatorRegistry: c.creatorRevenueRegistryAddress, holderDistributor: c.treasuryDistributorAddress,
      launchRouter: c.launchRouterAddress, allocationManager: c.allocationManagerAddress});
  }
  const release = resolveMarketRelease(catalog, { chainId: robinhoodChain.id, token: { factory } }).release;
  if (distributor.toLowerCase() !== release.holderDistributor) throw new Error("Token reward distributor does not match release");
  const [rawMarket, rawRoute, registryFactory, distributorRegistry, hookVault] = await Promise.all([
    publicClient.readContract({ abi: v1Abis.MarketRegistryV1, address: release.marketRegistry, functionName: "market", args: [market.marketId] }),
    publicClient.readContract({ abi: v1Abis.MarketRegistryV1, address: release.marketRegistry, functionName: "canonicalRoute", args: [market.marketId] }),
    publicClient.readContract({ abi: v1Abis.MarketRegistryV1, address: release.marketRegistry, functionName: "factory" }),
    publicClient.readContract({ abi: v1Abis.TreasuryDistributorV1, address: release.holderDistributor, functionName: "marketRegistry" }),
    publicClient.readContract({ abi: v1Abis.TickerGardenMemeHook, address: release.hook, functionName: "protocolFeeVault" }),
  ]);
  resolveMarketRelease(catalog, { chainId: robinhoodChain.id, token: {factory, hook: canonicalAddress(tupleString(tupleField(rawMarket, "config", 0), "graduatedHook", 13), "Market hook")},
    marketRegistry: {factory: registryFactory}, distributor: {marketRegistry: distributorRegistry}, hook: {feeVault: hookVault} });
  const [runtime, creator, holders] = await Promise.all([
    publicClient.readContract({abi: v1Abis.TickerGardenFactoryV1, address: release.factory, functionName: "runtimeBindings"}),
    publicClient.readContract({abi: v1Abis.TickerGardenFactoryV1, address: release.factory, functionName: "creatorRevenueRegistry"}),
    publicClient.readContract({abi: v1Abis.TickerGardenFactoryV1, address: release.factory, functionName: "treasuryDistributor"}),
  ]);
  const bindings = assertCanonicalFactoryBindings(runtime, {launchRouter: release.launchRouter, allocationManager: release.allocationManager, protocolFeeVault: release.feeVault});
  if (bindings.marketRegistry !== release.marketRegistry || creator.toLowerCase() !== release.creatorRegistry || holders.toLowerCase() !== release.holderDistributor) throw new Error("Factory runtime does not match market release");
  assertCanonicalMarketBinding(market, rawMarket, rawRoute);
  verifiedMarketRuntime.set(market.marketId, bindings);
  verifiedMarketReleases.set(market.marketId, release);
}

async function ensureCanonicalLaunch(selected: SelectedLaunchConfig): Promise<void> {
  if (!foundation?.bindings) throw new Error("Canonical Factory bindings are unavailable");
  const [asset, quote, baseline, template] = await Promise.all([
    selected.stakingEnabled !== false ? publicClient.readContract({ abi: v1Abis.OfficialStockRegistryV1, address: foundation.bindings.officialStockRegistry, functionName: "asset", args: [selected.asset!.assetUid] }) : Promise.resolve(null),
    publicClient.readContract({ abi: v1Abis.ApprovedQuoteRegistry, address: foundation.bindings.approvedQuoteRegistry, functionName: "quoteConfig", args: [selected.quote.configId] }),
    publicClient.readContract({ abi: v1Abis.TickerGardenBaselineRegistry, address: foundation.bindings.tickerGardenBaselineRegistry, functionName: "baseline", args: [selected.baseline.baselineId] }),
    publicClient.readContract({ abi: v1Abis.LaunchTemplateRegistry, address: foundation.bindings.launchTemplateRegistry, functionName: "launchTemplate", args: [selected.template.templateId] }),
  ]);
  assertCanonicalLaunchBindings(selected, { asset, quote, baseline, template });
}

async function allowanceApproval(
  approval: ContractWriteRequest | undefined,
  token: Address,
  spender: Address,
  amount: bigint,
  account: Address,
): Promise<ContractWriteRequest | undefined> {
  if (!approval || token === ZERO_ADDRESS) return undefined;
  const allowance = await publicClient.readContract({ abi: erc20Abi, address: token, functionName: "allowance", args: [account, spender] });
  return allowance >= amount ? undefined : approval;
}

async function verifyLiveWalletContext(expected: WalletState): Promise<void> {
  if (wallet !== expected) {
    throw new V1TransactionError("wrong_account", "wallet context changed; reconnect before signing");
  }
  let rawChainId: unknown;
  let rawAccounts: unknown;
  try {
    [rawChainId, rawAccounts] = await Promise.all([
      expected.provider.request({ method: "eth_chainId" }),
      expected.provider.request({ method: "eth_accounts" }),
    ]);
  } catch (error) {
    throw new V1TransactionError("wrong_account", "live wallet account and chain could not be verified", error);
  }
  const chainId = typeof rawChainId === "string" || typeof rawChainId === "number" ? Number(rawChainId) : Number.NaN;
  if (!Number.isSafeInteger(chainId) || chainId !== robinhoodChain.id) {
    throw new V1TransactionError("unsupported_chain", `wallet must remain on ${robinhoodChain.name} (${robinhoodChain.id})`);
  }
  let account: Address;
  try {
    account = canonicalAddress(String(Array.isArray(rawAccounts) ? rawAccounts[0] ?? "" : ""), "Wallet account");
  } catch (error) {
    throw new V1TransactionError("wrong_account", "wallet no longer exposes the expected account", error);
  }
  if (account !== expected.account || wallet !== expected) {
    throw new V1TransactionError("wrong_account", "wallet account changed; reconnect before signing");
  }
}

async function executeTransaction<T>(input: Readonly<{
  operationKey: string;
  onUpdate?: (update:TransactionUpdate)=>void;
  sync: SyncStatus;
  request: ContractWriteRequest;
  approval?: ContractWriteRequest;
  quoteExpiresAtMs?: number;
  walletContext?: WalletState;
  verifyChain?: () => Promise<unknown>;
  confirm: (receipt: TransactionReceipt, hash: Hash) => Promise<T>;
}>): Promise<T> {
  const activeWallet = input.walletContext ?? wallet;
  if (!foundation?.writeReady || !activeWallet || wallet !== activeWallet) throw new Error(runtimeReasons().join("; ") || "Connect a wallet first");
  if (foundation.direct && !input.verifyChain) throw Error("Direct operation requires a current contract check");
  busyOperation = input.operationKey;
  refreshActionAvailability();
  try {
    return await activeWallet.executor.execute({
      operationKey: input.operationKey,
      expectedAccount: activeWallet.account,
      snapshot: snapshot(input.sync),
      request: input.request,
      ...(input.approval ? { approval: input.approval } : {}),
      ...(input.quoteExpiresAtMs !== undefined ? { quoteExpiresAtMs: input.quoteExpiresAtMs } : {}),
      confirmations: 1,
      verifyWalletContext: () => verifyLiveWalletContext(activeWallet),
      currentRevision: async () => {
        const revision = await ensureCurrentRevision(input.sync.revision);
        if (input.verifyChain) await input.verifyChain();
        return revision;
      },
      confirm: input.confirm,
      onUpdate: (update) => {
        input.onUpdate?.(update);
        showTransactionUpdate(update);
        const detail = update.error ? `${update.error.code}: ${update.error.message}` : update.hash ? shortHex(update.hash, 9, 7) : "";
        toast(`${transactionStageLabels[update.stage]}${detail ? ` — ${detail}` : ""}`, update.stage === "failed" ? "error" : update.stage === "confirmed" ? "success" : "neutral");
      },
    });
  } finally {
    busyOperation = "";
    renderRecoveryControls();
    refreshActionAvailability();
  }
}

function confirmFlowAction(message: string): Promise<boolean> {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog'); dialog.className = 'flow-confirm';
    dialog.setAttribute('aria-label', 'Confirm action');
    const heading = document.createElement('h2'); heading.textContent = 'Confirm action';
    const description = document.createElement('p'); description.textContent = message; description.id = 'flow-confirm-description';
    dialog.setAttribute('aria-describedby', description.id);
    const controls = document.createElement('div');
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel'; cancel.autofocus = true;
    const confirm = document.createElement('button'); confirm.type = 'button'; confirm.textContent = 'Confirm';
    let settled = false;
    const finish = (accepted: boolean) => { if (settled) return; settled = true; dialog.close(); dialog.remove(); resolve(accepted); };
    cancel.onclick = () => finish(false); confirm.onclick = () => finish(true);
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
    dialog.addEventListener('close', () => finish(false));
    controls.append(cancel, confirm); dialog.append(heading, description, controls); document.body.append(dialog); dialog.showModal();
  });
}

function showTransactionUpdate(update: TransactionUpdate): void {
  if (launchProgress) return;
  let panel = query<HTMLElement>('[data-transaction-progress]');
  if (!panel) {
    panel = document.createElement('section'); panel.dataset.transactionProgress = ''; panel.className = 'runtime-recovery';
    panel.setAttribute('role', 'status'); panel.setAttribute('aria-live', 'polite');
    (query<HTMLElement>('main') ?? document.body).prepend(panel);
  }
  panel.replaceChildren();
  const status = document.createElement('strong'); status.textContent = transactionStageLabels[update.stage]; panel.append(status);
  const note = document.createElement('span');
  note.textContent = update.error ? errorText(update.error) : update.stage === 'confirmed' ? 'Confirmed. Your balances are being refreshed.' : update.hash ? 'You can refresh this page. Check the existing transaction before submitting again.' : 'Review the request in your wallet. No transaction has been confirmed yet.';
  panel.append(note);
  if (update.hash) { const link = document.createElement('a'); link.href = `${robinhoodChain.blockExplorers.default.url}/tx/${update.hash}`; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'View transaction'; panel.append(link); }
}

function receiptEvent(
  receipt: Pick<TransactionReceipt, "logs">,
  address: Address,
  abi: readonly unknown[],
  eventName: string,
  predicate: (args: Record<string, unknown>) => boolean,
): Record<string, unknown> {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== address) continue;
    try {
      const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics });
      if (decoded.eventName === eventName && predicate(decoded.args as Record<string, unknown>)) return decoded.args as Record<string, unknown>;
    } catch {
      // Receipts legitimately contain logs from several protocol components.
    }
  }
  throw new Error(`Canonical ${eventName} event was not found in the receipt`);
}

function setupShell(): void {
  const page = currentPage();
  const nav: readonly [PageName, string, string][] = [
    ["markets", "Explore", "/explore"],
    ["create", "Create", "/create"],
    ["stats", "Stats", "/stats"],
    ["rewards", "Claim", "/claim"],
    ["staking", "Stake", "/stake"],
    ["docs", "Docs", "/docs"],
  ];
  const header = required<HTMLElement>("[data-shell-header]");
  const footerLink = (id: PageName, label: string, url: string): string =>
    `<a class="${page === id ? "active" : ""}" ${page === id ? "aria-current=\"page\"" : ""} href="${url}">${label}</a>`;
  header.classList.remove("nav-open");
  header.innerHTML = `
    <a class="brand" href="/" aria-label="TickerGarden home">
      <img src="${brandMarkUrl}" alt="">${brandWordmark}
    </a>
    <nav aria-label="Primary navigation">${nav.map(([id, label, url]) => `<a class="${page === id ? "active" : ""}" ${page === id ? "aria-current=\"page\"" : ""} ${(id === "rewards" || id === "staking") ? "data-wallet-only hidden" : ""} href="${url}">${label}</a>`).join("")}</nav>
    <div class="header-actions">
      <button class="wallet" type="button" data-wallet><i class="ph ph-wallet" aria-hidden="true"></i><span>Connect Wallet</span></button>
      <button class="menu" type="button" data-menu aria-label="Open navigation" aria-expanded="false"><i class="ph ph-list" aria-hidden="true"></i></button>
    </div>`;
  required<HTMLElement>("[data-shell-footer]").innerHTML = `
    <div class="footer-intro">
      <a class="brand" href="/" aria-label="TickerGarden home"><img src="${brandMarkUrl}" alt="">${brandWordmark}</a>
      <p>Where stock communities meet meme culture—and new onchain possibilities take root.</p>
    </div>
    <nav class="footer-navigation" aria-label="Footer navigation">
      <section><strong>Garden</strong>${footerLink("markets", "Explore", "/explore")}${footerLink("create", "Create", "/create")}</section>
      <section><strong>Community</strong><span data-wallet-only hidden>${footerLink("rewards", "Claim", "/claim")}</span>${footerLink("stats", "Stats", "/stats")}${footerLink("docs", "Docs", "/docs")}</section>
      <section><strong>Legal</strong>${footerLink("privacy", "Privacy", "/privacy")}${footerLink("terms", "Terms", "/terms")}${footerLink("risks", "Risk", "/risks")}</section>
    </nav>
    <div class="footer-meta">
      <span>© 2026 TickerGarden</span>
      <span class="chain-tag" title="${robinhoodChain.name}"><i class="ph ph-link" aria-hidden="true"></i>Robinhood Chain</span>
    </div>`;

  walletPicker ??= createWalletPicker({ connect: connectWallet, restore: restoreWallet, disconnect: disconnectWallet, account: () => wallet?.account ?? null });
  required<HTMLButtonElement>("[data-wallet]").addEventListener("click", () => {
    if (busyOperation) { toast("Wait for the current transaction before changing wallets.", "warning"); return; }
    walletPicker!.open();
  });
  required<HTMLButtonElement>("[data-menu]").addEventListener("click", (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const open = !header.classList.contains("nav-open");
    header.classList.toggle("nav-open", open);
    button.setAttribute("aria-expanded", String(open));
  });
}

function renderWallet(): void {
  renderDeveloperBuyBalance();
  if(tradeMarket&&detailBalanceAccount!==wallet?.account)void loadDetailBalances();
  if (accountBalancesWallet !== wallet?.account) { accountBalancesWallet = wallet?.account; clearAccountBalances(); }
  const button = query<HTMLButtonElement>("[data-wallet]");
  if (!button) return;
  const label = query<HTMLElement>("span", button);
  if (label) label.textContent = wallet ? shortHex(wallet.account) : "Connect Wallet";
  button.dataset.state = wallet ? "connected" : "disconnected";
  button.setAttribute("aria-label", wallet ? "Manage connected wallet" : "Connect wallet");
  button.title = wallet?.account ?? "";
  queryAll<HTMLElement>("[data-wallet-only]").forEach(element => { element.hidden = !wallet; });
}

function invalidateWallet(): void {
  walletPicker?.forget();
  stopTransactionObservation?.();
  wallet?.provider.removeListener?.("accountsChanged", invalidateWallet);
  wallet?.provider.removeListener?.("chainChanged", invalidateWallet);
  wallet = null;
  invalidateWalletReads();
  renderWallet();
  refreshCurrentPage();
  toast("Wallet account or chain changed. Reconnect before signing.", "warning");
}

function installWallet(provider: InjectedProvider, account: Address): void {
  const walletClient = createWalletClient({ account, chain: robinhoodChain, transport: custom(provider) });
  const executor = new V1TransactionExecutor({
    publicClient: (integrationBootstrapPath ? {...publicClient,waitForTransactionReceipt: ({hash}: {hash: Hex})=>directReceipt(hash=>publicClient.getTransactionReceipt({hash}),hash)} : publicClient) as unknown as V1TransactionClients["publicClient"],
    walletClient: walletClient as unknown as V1TransactionClients["walletClient"],
  });
  wallet?.provider.removeListener?.("accountsChanged", invalidateWallet);
  wallet?.provider.removeListener?.("chainChanged", invalidateWallet);
  wallet = { account, provider, executor };
  invalidateWalletReads();
  provider.on?.("accountsChanged", invalidateWallet);
  provider.on?.("chainChanged", invalidateWallet);
  renderWallet();
  refreshCurrentPage();
}

async function restoreWallet(provider: InjectedProvider, current: () => boolean): Promise<void> {
  const raw = await authorizedWalletAccount(provider, robinhoodChain.id);
  if (!raw || !current() || wallet || walletConnecting || busyOperation) return;
  installWallet(provider, canonicalAddress(raw, "Wallet account"));
}

async function connectWallet(provider: InjectedProvider, reportStatus: (message: string) => void = () => {}): Promise<void> {
  if (walletConnecting || busyOperation) throw new Error("Finish the current wallet operation first.");
  walletConnecting = true;
  refreshActionAvailability();
  try {
    await ensureWalletChain(provider, robinhoodChain, reportStatus);
    const rawAccounts = await provider.request({ method: "eth_requestAccounts" });
    const account = canonicalAddress(String(Array.isArray(rawAccounts) ? rawAccounts[0] ?? "" : ""), "Wallet account");
    installWallet(provider, account);
    toast(`Wallet connected — ${shortHex(account)}`, "success");
  } catch (error) {
    toast(`Wallet connection failed — ${errorText(error)}`, "error");
    throw error;
  } finally {
    walletConnecting = false;
    refreshActionAvailability();
  }
}

function disconnectWallet(): void {
  walletPicker?.forget();
  stopTransactionObservation?.();
  if (wallet) {
    wallet.provider.removeListener?.("accountsChanged", invalidateWallet);
    wallet.provider.removeListener?.("chainChanged", invalidateWallet);
  }
  wallet = null;
  invalidateWalletReads();
  renderWallet();
  refreshCurrentPage();
  toast("Wallet disconnected locally", "neutral");
}

function refreshActionAvailability(): void {
  queryAll<HTMLButtonElement>("[data-requires-write]").forEach((button) => setDisabled(button, !writeReady()));
  if (currentPage() === "trade") updateTradeAvailability();
  if (currentPage() === "create") updateCreateAvailability();
  if (isRewardsPage()) updateRewardsAvailability();
}

let marketStockSymbols = new Map<string, string>();

function configLabel(config: ConfigReadModel): string {
  const preferredKeys = config.kind === "asset"
    ? ["tokenSymbol", "symbol", "tokenName"]
    : config.kind === "quote"
      ? ["symbol", "tokenSymbol", "name"]
      : ["name", "label"];
  for (const key of preferredKeys) {
    const value = config.values[key];
    if (typeof value === "string" && value.trim()) return `${value.trim()} · ${shortHex(config.id)}`;
  }
  if (config.kind === "asset") {
    const token = config.values.stockToken;
    if (typeof token === "string") return `${shortHex(token)} · ${shortHex(config.id)}`;
  }
  if (config.kind === "quote") {
    const token = config.values.quoteAsset;
    if (token === ZERO_ADDRESS) return `Native ETH · ${shortHex(config.id)}`;
    if (typeof token === "string") return `${shortHex(token)} · ${shortHex(config.id)}`;
  }
  return shortHex(config.id, 8, 6);
}

function stockToken(config: ConfigReadModel): string | null {
  const value = config.values.stockToken;
  return typeof value === "string" && ADDRESS_PATTERN.test(value) ? value : null;
}

function stockCategoryLabel(config: ConfigReadModel): string {
  const token = stockToken(config);
  const symbol = token ? marketStockSymbols.get(token) : undefined;
  return token ? `${symbol ? `${symbol} · ` : ""}${shortHex(token, 8, 6)} · ${shortHex(config.id, 8, 6)}` : `Unavailable token · ${shortHex(config.id, 8, 6)}`;
}

function formatMarketUSD(value: string | null | undefined): string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)) return "Unavailable";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return `$${value}`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: amount >= 1_000_000 ? "compact" : "standard", maximumFractionDigits: amount < 1 ? 4 : 2 }).format(amount);
}

function findAsset(assetUid: string): ConfigReadModel {
  const asset = foundation?.assets.find((item) => item.id === assetUid);
  if (!asset) throw new Error(`Unknown STOCK asset ${shortHex(assetUid)}`);
  return asset;
}

function findQuote(configId: string): ConfigReadModel {
  const quote = foundation?.quotes.find((item) => item.id === configId);
  if (!quote) throw new Error(`Unknown Quote configuration ${shortHex(configId)}`);
  return quote;
}

async function marketMetadata(market: MarketReadModel): Promise<MarketMetadata> {
  const key = `${robinhoodChain.id}:${foundation?.sync.revision ?? "unavailable"}:${market.marketId}`;
  const existing = metadataCache.get(key);
  if (existing) return existing;
  const pending = (async () => {
    const quoteConfig = findQuote(market.quoteAssetConfigId);
    const [name, symbol] = await Promise.all([
      publicClient.readContract({ abi: erc20Abi, address: canonicalAddress(market.memeToken, "Meme token"), functionName: "name" }),
      publicClient.readContract({ abi: erc20Abi, address: canonicalAddress(market.memeToken, "Meme token"), functionName: "symbol" }),
    ]);
    if (market.quoteAsset === ZERO_ADDRESS) return Object.freeze({ name, symbol, quoteSymbol: "ETH", quoteDecimals: 18 });
    const quoteAsset = canonicalAddress(market.quoteAsset, "Quote token");
    const [quoteSymbol, quoteDecimals] = await Promise.all([
      publicClient.readContract({ abi: erc20Abi, address: quoteAsset, functionName: "symbol" }),
      publicClient.readContract({ abi: erc20Abi, address: quoteAsset, functionName: "decimals" }),
    ]);
    const expectedDecimals = quoteConfig.values.quoteDecimals;
    if (typeof expectedDecimals === "number" && expectedDecimals !== quoteDecimals) {
      throw new Error("Quote decimals drifted from the approved configuration");
    }
    if (quoteDecimals < 6 || quoteDecimals > 18) throw new Error("Quote decimals are outside the approved 6–18 range");
    return Object.freeze({ name, symbol, quoteSymbol, quoteDecimals });
  })();
  metadataCache.set(key, pending);
  try {
    return await pending;
  } catch (error) {
    if (metadataCache.get(key) === pending) metadataCache.delete(key);
    throw error;
  }
}

const homeRender = createRenderGeneration(() => foundation);
const marketsRender = createRenderGeneration(() => foundation);
const statsRender = createRenderGeneration(() => foundation?.sync.revision);

function clearHomeMarketView(): void {
  const rail = query<HTMLElement>("[data-home-markets]");
  if (!rail) return;
  rail.querySelectorAll("[data-runtime-market]").forEach(item => item.remove());
  rail.setAttribute("aria-busy", "false");
  for (const selector of ["[data-home-markets-loading]", "[data-home-markets-empty]"]) {
    const item = query<HTMLElement>(selector, rail);
    if (item) item.hidden = true;
  }
  const locked = query<HTMLElement>("[data-home-markets-locked]", rail);
  if (locked) {
    locked.hidden = false;
    locked.textContent = "Market snapshot unavailable. Waiting for verified market data…";
  }
}

async function renderHome(): Promise<void> {
  const render = homeRender.begin();
  const rail = query<HTMLElement>("[data-home-markets]");
  if (!rail) return;
  const loading = query<HTMLElement>("[data-home-markets-loading]", rail);
  const empty = query<HTMLElement>("[data-home-markets-empty]", rail);
  const locked = query<HTMLElement>("[data-home-markets-locked]", rail);
  if (!foundation) {
    clearHomeMarketView();
    if (loading) loading.hidden = true;
    if (empty) empty.hidden = true;
    if (locked) {
      locked.hidden = false;
      locked.textContent = `Market data unavailable — ${runtimeReasons().join("; ")}`;
    }
    return;
  }
  rail.querySelectorAll("[data-runtime-market]").forEach((item) => item.remove());
  if (loading) loading.hidden = true;
  if (locked) locked.hidden = true;
  if (empty) empty.hidden = foundation.markets.length > 0;
  rail.setAttribute("aria-busy", "false");

  const recent = [...foundation.markets]
    .sort((left, right) => Number(BigInt(right.source.blockNumber) - BigInt(left.source.blockNumber)))
    .slice(0, 10);
  await Promise.all(recent.map(async (market) => {
    let metadata: MarketMetadata | null = null;
    try { metadata = await marketMetadata(market); } catch { /* Identity remains available without optional ERC-20 metadata. */ }
    if (!render.isCurrent()) return;
    const link = document.createElement("a");
    link.className = "garden-card home-market-card";
    link.dataset.runtimeMarket = market.marketId;
    link.href = `/trade?marketId=${encodeURIComponent(market.marketId)}`;
    const heading = document.createElement("h3");
    heading.textContent = metadata ? metadata.name : `Market ${shortHex(market.marketId)}`;
    const detail = document.createElement("p");
    detail.textContent = `${phaseLabel(market.launchPhase)} · ${market.gauge === ZERO_ADDRESS ? "No stock staking" : `STOCK ${shortHex(market.assetUid)}`} · ${metadata?.quoteSymbol ?? shortHex(market.quoteAsset)}`;
    const identity = document.createElement("small");
    identity.textContent = market.marketId;
    link.append(heading, detail, identity);
    rail.append(link);

  }));
}

const marketDirectory=createMarketDirectory((params,signal)=>{
 if(!runtimeConfig.readApi.available)throw new Error("Read API unavailable");
 return new TickerGardenV1Client(runtimeConfig.readApi.value,(input,init)=>fetch(input,{...init,signal})).listMarkets(params);
});
function clearMarketDirectoryView():void {
 const list=query<HTMLElement>("[data-market-list]");if(!list)return;
 list.querySelectorAll("[data-runtime-market]").forEach(item=>item.remove());
 list.setAttribute("aria-busy","false");
 for(const selector of ["[data-market-loading]","[data-market-empty]"]){const item=query<HTMLElement>(selector,list);if(item)item.hidden=true;}
 const locked=query<HTMLElement>("[data-market-locked]",list);if(locked){locked.hidden=false;locked.textContent="Market snapshot unavailable. Waiting for verified directory data…";}
 const more=query<HTMLButtonElement>("[data-market-query-more]");if(more)more.hidden=true;
 const badge=query<HTMLElement>(".hero-badge span");if(badge)badge.textContent="Waiting for canonical market data";
}
window.addEventListener("pagehide",()=>{marketDirectory.reset();clearMarketDirectoryView();});
let marketPhaseFilter = "bloomed";
let statsPeriod: "24h" | "all" = "24h";

async function loadMarketStockSymbols(): Promise<void> {
  if (!runtimeConfig.readApi.available) return;
  try {
    const response = await new TickerGardenV1Client(runtimeConfig.readApi.value).listDisplayPriceReferences();
    if (response.chainId !== robinhoodChain.id || !Array.isArray(response.references)) return;
    const next = new Map<string, string>();
    const duplicates = new Set<string>();
    for (const reference of response.references) {
      if (!ADDRESS_PATTERN.test(reference.token) || !/^[A-Z][A-Z0-9.\-]{0,15}$/.test(reference.symbol) || duplicates.has(reference.token)) continue;
      if (next.has(reference.token)) { next.delete(reference.token); duplicates.add(reference.token); }
      else next.set(reference.token, reference.symbol);
    }
    marketStockSymbols = next;
    if (currentPage() === "markets") void renderMarkets();
  } catch { /* The address-based STOCK catalog remains usable without display metadata. */ }
}

function setupMarkets(): void {
  queryAll<HTMLButtonElement>("[data-market-filter]").forEach((button) => button.addEventListener("click", () => {
    marketPhaseFilter = button.dataset.marketFilter ?? "bloomed";
    queryAll<HTMLButtonElement>("[data-market-filter]").forEach((item) => {
      const active = item === button;
      item.classList.toggle("active", active);
      item.setAttribute("aria-selected", String(active));
    });
    void renderMarkets();
  }));
  query<HTMLInputElement>("[data-market-search]")?.addEventListener("input", () => { void renderMarkets(); });
  query<HTMLInputElement>("[data-market-stock-search]")?.addEventListener("input", () => { void renderMarkets(); });
  query<HTMLSelectElement>("[data-market-asset]")?.addEventListener("change", () => { void renderMarkets(); });
  query<HTMLSelectElement>("[data-market-sort]")?.addEventListener("change", () => { void renderMarkets(); });
  void loadMarketStockSymbols();
}

async function renderMarkets(append=false): Promise<void> {
  const render = marketsRender.begin();
  const revision=foundation?.sync.revision;
  const list = query<HTMLElement>("[data-market-list]");
  if (!list) return;
  let more=query<HTMLButtonElement>("[data-market-query-more]");
  if(!more){more=document.createElement("button");more.type="button";more.dataset.marketQueryMore="";more.textContent="Load next matching markets";more.onclick=()=>void renderMarkets(true);list.insertAdjacentElement("afterend",more);}
  more.hidden=true;
  list.setAttribute("aria-busy","true");
  const empty = query<HTMLElement>("[data-market-empty]", list);
  const locked = query<HTMLElement>("[data-market-locked]", list);
  const loading = query<HTMLElement>("[data-market-loading]", list);
  list.querySelectorAll("[data-runtime-market]").forEach((item) => item.remove());
  if (!foundation||!revision) {
    marketDirectory.reset();list.setAttribute("aria-busy","false");
    if (loading) loading.hidden = true;
    if (empty) empty.hidden = true;
    if (locked) { locked.hidden = false; locked.textContent = `Market directory unavailable — ${runtimeReasons().join("; ")}`; }
    setPageStatus("Canonical market records are unavailable.", "error");
    return;
  }
  const assetSelect = required<HTMLSelectElement>("[data-market-asset]");
  const selectedAsset = assetSelect.value;
  const stockSearch = (query<HTMLInputElement>("[data-market-stock-search]")?.value ?? "").trim().toLowerCase();
  const matchingAssets = foundation.assets.filter(asset => {
    const token = stockToken(asset);
    const symbol = token ? marketStockSymbols.get(token)?.toLowerCase() : undefined;
    return !stockSearch || asset.id.includes(stockSearch) || token?.includes(stockSearch) || symbol?.includes(stockSearch);
  });
  assetSelect.replaceChildren(new Option("All STOCK Tokens", ""), ...matchingAssets.map(asset => new Option(stockCategoryLabel(asset), asset.id)));
  if (matchingAssets.some(asset => asset.id === selectedAsset)) assetSelect.value = selectedAsset;
  const search = (query<HTMLInputElement>("[data-market-search]")?.value ?? "").trim();
  if (search.toLowerCase().startsWith("0x") && !ADDRESS_PATTERN.test(search.toLowerCase())) {
    marketDirectory.reset();
    list.setAttribute("aria-busy", "false");
    if (loading) loading.hidden = true;
    if (empty) { empty.hidden = false; empty.textContent = "Enter the complete 42-character Meme Token contract address."; }
    if (locked) locked.hidden = true;
    setPageStatus("Contract address search is waiting for a complete address.", "neutral");
    return;
  }
  const asset = assetSelect.value;
  const order = query<HTMLSelectElement>("[data-market-sort]")?.value ?? "recent";
  const params: DirectoryQuery = {
    revision,
    sort: order === "volume24h" ? "volume24hUsd_desc" : order === "marketCap" ? "marketCapUsd_desc" : "createdAt_desc",
    ...(search ? { search } : {}),
    ...(asset ? { assetUid: canonicalBytes32(asset, "STOCK filter") } : {}),
    launchPhase: marketPhaseFilter === "growing" ? 0 as const : 1 as const,
  };
  if(loading)loading.hidden=false;if(empty){empty.hidden=true;empty.textContent="No market records match these filters.";}if(locked)locked.hidden=true;
  let page;
  try{page=foundation.direct ? {items:foundation.markets,nextCursor:null,sync:foundation.sync} : await marketDirectory.load(params,append);}catch(error){
   if(!render.isCurrent())return;
   if(loading)loading.hidden=true;if(locked){locked.hidden=false;locked.textContent=`Market query unavailable — ${errorText(error)}. Refresh to restart the query.`;}
   list.setAttribute("aria-busy","false");setPageStatus("Market query unavailable; no partial directory results shown.","error");return;
  }
  if(!page||!render.isCurrent())return;
  const filtered = foundation.direct ? page.items.filter(m=>m.launchPhase===params.launchPhase&&(!params.assetUid||m.assetUid===params.assetUid)&&(!search||`${m.memeToken} ${m.identity?.name??""} ${m.identity?.symbol??""}`.toLowerCase().includes(search.toLowerCase()))) : page.items;
  if(!render.isCurrent())return;
  if (loading) loading.hidden = true;
  if (locked) locked.hidden = true;
  if (empty) empty.hidden = filtered.length > 0;
  const template = required<HTMLTemplateElement>("[data-market-item-template]", list);
  for (const market of filtered) {
    const fragment = template.content.cloneNode(true) as DocumentFragment;
    const card = required<HTMLAnchorElement>("[data-market-card]", fragment);
    card.dataset.runtimeMarket = market.marketId;
    card.dataset.category = market.launchPhase === 1 ? "pool" : "curve";
    card.href = `/trade?marketId=${encodeURIComponent(market.marketId)}`;
    text("[data-market-name]", market.identity ? `${market.identity.name} (${market.identity.symbol})` : `Market ${shortHex(market.marketId)}`, fragment);
    const stock = foundation.assets.find(asset => asset.id === market.assetUid);
    const stockAddress = stock ? stockToken(stock) : null;
    text("[data-market-asset-label]", stock ? `STOCK ${stockCategoryLabel(stock)}` : `STOCK ${shortHex(market.assetUid, 8, 6)}`, fragment);
    text("[data-market-phase]", phaseLabel(market.launchPhase), fragment);
    text("[data-market-volume]", formatMarketUSD(market.metrics?.volume24hUsd), fragment);
    text("[data-market-cap]", formatMarketUSD(market.metrics?.marketCapUsd), fragment);
    text("[data-market-stock]", stockAddress ? shortHex(stockAddress, 8, 6) : "Unavailable", fragment);
    list.append(fragment);
  }
  list.setAttribute("aria-busy", "false");
  more.hidden=page.nextCursor===null;
  setPageStatus(foundation.direct ? `${filtered.length} markets observed in this integration session.` : `${filtered.length} matching markets loaded${page.nextCursor ? " (more available)" : " (all matches)"} · server-wide query · finalized block ${page.sync.blockNumber}`, "success");
  const badge = query<HTMLElement>(".hero-badge span");
  if (badge) badge.textContent = `${filtered.length} matching records${page.nextCursor ? "+" : ""} at ${page.sync.revision}`;
}

function clearStatsSnapshotView(message: string): void {
  for (const selector of ["[data-stat-volume]", "[data-stat-launches]", "[data-stat-bloomed]"]) text(selector, "—");
  for (const selector of ["[data-stats-phase-list]", "[data-stats-quote-list]"]) {
    const container = query<HTMLElement>(selector);
    if (container) {
      const pending = document.createElement("p");
      pending.textContent = message;
      container.replaceChildren(pending);
    }
  }
  query<HTMLElement>("[data-stats-summary]")?.setAttribute("aria-busy", "false");
}

function sumMarketVolumeUSD(markets: readonly MarketReadModel[]): string | null {
  const values = markets.map(market => market.metrics?.volume24hUsd);
  if (values.some(value => typeof value !== "string" || !/^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value))) return null;
  const scale = Math.max(0, ...values.map(value => value!.split(".")[1]?.length ?? 0));
  const total = values.reduce((sum, value) => {
    const [whole, fraction = ""] = value!.split(".");
    return sum + BigInt(`${whole}${fraction.padEnd(scale, "0")}`);
  }, 0n);
  if (scale === 0) return total.toString();
  const digits = total.toString().padStart(scale + 1, "0");
  const fraction = digits.slice(-scale).replace(/0+$/, "");
  return fraction ? `${digits.slice(0, -scale)}.${fraction}` : digits.slice(0, -scale);
}

function setupStats(): void {
  queryAll<HTMLButtonElement>("[data-stats-period]").forEach(button => button.addEventListener("click", () => {
    statsPeriod = button.dataset.statsPeriod === "all" ? "all" : "24h";
    queryAll<HTMLButtonElement>("[data-stats-period]").forEach(item => {
      const selected = item === button;
      item.classList.toggle("active", selected);
      item.setAttribute("aria-selected", String(selected));
    });
    void renderStats();
  }));
}

async function renderStats(): Promise<void> {
  if (foundation?.direct) {clearStatsSnapshotView("Statistics are not available yet. Launching and trading remain available.");return;}
  const render = statsRender.begin();
  const isAllTime = statsPeriod === "all";
  text("[data-stat-volume-label]", isAllTime ? "All-time trading volume (USD)" : "24h trading volume (USD)");
  text("[data-stat-launches-label]", isAllTime ? "All-time token launches" : "Token launches in 24h");
  text("[data-stats-source]", isAllTime
    ? "Current market totals from finalized on-chain data. All-time USD history is unavailable until the scheduled Dune dataset is configured."
    : "Rolling 24h USD volume from finalized executions and exact-address Quote Token prices.");
  clearStatsSnapshotView(foundation ? "Loading complete market snapshot…" : "Market snapshot unavailable. Connect a working read API to view these totals.");
  if (!foundation) {
    setPageStatus(`Statistics unavailable — ${runtimeReasons().join("; ")}`, "error");
    return;
  }
  // Aggregate the full directory only on the statistics page, never during shared startup.
  while (foundation?.marketNextCursor) {
    try { await appendMarketPage(); } catch (error) {
      if (!render.isCurrent()) return;
      text("[data-stats-phase-list]", "Complete market snapshot unavailable. Try again later.");
      text("[data-stats-quote-list]", "Complete market snapshot unavailable. Try again later.");
      throw error;
    }
    if (!render.isCurrent()) return;
  }
  if (!foundation || !render.isCurrent()) return;
  const groups = new Map<string, bigint>();
  const phaseCounts = new Map<number, number>();
  foundation.markets.forEach((market) => {
    groups.set(market.quoteAsset, (groups.get(market.quoteAsset) ?? 0n) + BigInt(market.curveProgress.realQuoteReserve));
    phaseCounts.set(market.launchPhase, (phaseCounts.get(market.launchPhase) ?? 0) + 1);
  });
  const rollingVolume = isAllTime ? null : sumMarketVolumeUSD(foundation.markets);
  const rollingFrom = Math.floor(Date.now() / 1000) - 86400;
  const launchTimes = foundation.markets.map(market => market.identity?.deployedAt);
  const launches = isAllTime
    ? foundation.markets.length
    : launchTimes.every(value => typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value))
      ? launchTimes.filter(value => BigInt(value!) >= BigInt(rollingFrom) && BigInt(value!) <= BigInt(Math.floor(Date.now() / 1000))).length
      : null;
  text("[data-stat-volume]", rollingVolume === null ? "Unavailable" : formatMarketUSD(rollingVolume));
  text("[data-stat-launches]", launches === null ? "Unavailable" : String(launches));
  text("[data-stat-bloomed]", String(phaseCounts.get(1) ?? 0));
  const phaseList = query<HTMLElement>("[data-stats-phase-list]");
  if (phaseList) {
    phaseList.replaceChildren(...[...phaseCounts.entries()].sort(([a], [b]) => a - b).map(([phase, count]) => {
      const row = document.createElement("div");
      row.className = "activity-row";
      const label = document.createElement("span"); label.textContent = phaseLabel(phase);
      const value = document.createElement("strong"); value.textContent = String(count);
      row.append(label, value);
      return row;
    }));
  }
  const quoteList = query<HTMLElement>("[data-stats-quote-list]");
  if (quoteList) {
    quoteList.replaceChildren();
    for (const [address, amount] of groups) {
      const display = await statisticsQuoteLabel(address, amount, () => Promise.all([
        publicClient.readContract({ abi: erc20Abi, address: canonicalAddress(address, "Quote token"), functionName: "symbol" }),
        publicClient.readContract({ abi: erc20Abi, address: canonicalAddress(address, "Quote token"), functionName: "decimals" }),
      ]));
      if (!render.isCurrent()) return;
      const row = document.createElement("div");
      row.className = "activity-row";
      const label = document.createElement("span"); label.textContent = display.label;
      const value = document.createElement("strong"); value.textContent = display.amount;
      row.append(label, value);
      quoteList.append(row);
    }
    if (groups.size === 0) {
      const empty = document.createElement("p"); empty.textContent = "No quote-asset records are available yet."; quoteList.append(empty);
    }
  }
  if (!render.isCurrent()) return;
  query<HTMLElement>("[data-stats-summary]")?.setAttribute("aria-busy", "false");
  setPageStatus(`Finalized snapshot ${foundation.sync.revision} · ${isAllTime ? "all-time market totals" : "rolling 24-hour activity"}.`, "success");
}

function setupDocs(): void {
  const search = query<HTMLInputElement>("[data-docs-search]");
  let topic = "all";
  const apply = () => {
    const needle = (search?.value ?? "").trim().toLowerCase();
    queryAll<HTMLDetailsElement>("details").forEach((item) => {
      const topicMatches = topic === "all" || item.dataset.topic === topic;
      item.hidden = !topicMatches || Boolean(needle && !item.textContent?.toLowerCase().includes(needle));
    });
  };
  search?.addEventListener("input", apply);
  queryAll<HTMLButtonElement>("[data-docs-filter]").forEach((button) => button.addEventListener("click", () => {
    topic = button.dataset.docsFilter ?? "all";
    queryAll<HTMLButtonElement>("[data-docs-filter]").forEach((item) => item.classList.toggle("active", item === button));
    apply();
  }));
}

type TradeQuote = Readonly<{
  side: "buy" | "sell";
  marketId: Hex;
  input: bigint;
  output: bigint;
  spent: bigint | null;
  refund: bigint | null;
  fee: bigint | null;
  minimum: bigint;
  slippageBps: number;
  revision: string;
  expiresAtMs: number;
}>;

let tradeMarket: MarketDetailResponse | null = null;
let tradeMetadata: MarketMetadata | null = null;
let tradeSide: "buy" | "sell" = "buy";
let tradeQuote: TradeQuote | null = null;
let tradeLoadGeneration = 0;
let tradeQuoteGeneration = 0;
let tradeQuoteTimer = 0;
let tradeQuoteExpiryTimer = 0;
let tradePhaseTimer = 0;
let tradePhaseLoading = false;

function setupTrade(): void {
  tradePhaseTimer = window.setInterval(async () => {
    const current = tradeMarket;
    if (document.hidden || busyOperation || pageActionPending || tradePhaseLoading || !current || !foundation?.direct || !directMarkets) return;
    tradePhaseLoading = true;
    try {
      const fresh = await directMarkets.market(current.market.marketId);
      if (tradeMarket !== current || currentPage() !== 'trade') return;
      if (fresh.market.launchPhase !== current.market.launchPhase || fresh.market.sourceVersion !== current.market.sourceVersion) await loadTradeMarket(current.market.marketId);
    } catch { text('[data-detail-phase-note]', 'Market update unavailable. Refresh the quote before trading.'); }
    finally { tradePhaseLoading = false; }
  }, 30_000);

  query<HTMLButtonElement>("[data-trade-requote]")?.addEventListener("click", scheduleTradeQuote);
  query<HTMLButtonElement>('[data-detail-connect]')?.addEventListener('click',()=>query<HTMLButtonElement>('[data-wallet]')?.click());
  query<HTMLButtonElement>('[data-detail-fee-details]')?.addEventListener('click',()=>{const node=query<HTMLElement>('[data-detail-fee-rows]')?.closest<HTMLElement>('section');node?.scrollIntoView({behavior:'smooth',block:'center'});node?.focus({preventScroll:true});});
  query<HTMLButtonElement>('[data-trade-reverse]')?.addEventListener('click',()=>query<HTMLButtonElement>(`[data-trade-side="${tradeSide==='buy'?'sell':'buy'}"]`)?.click());
  queryAll<HTMLButtonElement>('[data-detail-tab]').forEach(button => button.addEventListener('click', () => {
    queryAll<HTMLButtonElement>('[data-detail-tab]').forEach(tab => {
      tab.classList.toggle('active', tab === button);
      tab.setAttribute('aria-selected', String(tab === button));
    });
    queryAll<HTMLElement>('[data-detail-panel]').forEach(panel => { panel.hidden = panel.dataset.detailPanel !== button.dataset.detailTab; });
  }));
  query<HTMLButtonElement>('[data-detail-copy]')?.addEventListener('click', async () => {
    if (!tradeMarket) return;
    try { await navigator.clipboard.writeText(tradeMarket.market.memeToken); setPageStatus('Token address copied.', 'success'); }
    catch { setPageStatus('Unable to copy token address.', 'warning'); }
  });
  const params = new URLSearchParams(window.location.search);
  const marketId = params.get("marketId")?.toLowerCase() ?? "";
  const input = query<HTMLInputElement>("[data-market-id]");
  if (input && BYTES32_PATTERN.test(marketId)) input.value = marketId;
  query<HTMLButtonElement>("[data-load-market]")?.addEventListener("click", () => { void loadTradeMarket(); });
  input?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); void loadTradeMarket(); }
  });
  queryAll<HTMLButtonElement>("[data-trade-side]").forEach((button) => button.addEventListener("click", () => {
    tradeSide = button.dataset.tradeSide === "sell" ? "sell" : "buy";
    queryAll<HTMLButtonElement>("[data-trade-side]").forEach((item) => {item.classList.toggle("active", item === button);item.setAttribute("aria-pressed",String(item===button));});
    tradeQuote = null;
    renderTradeQuote();
    scheduleTradeQuote();
  }));
  query<HTMLInputElement>("[data-trade-amount]")?.addEventListener("input", scheduleTradeQuote);
  query<HTMLInputElement>("[data-trade-slippage]")?.addEventListener("input", scheduleTradeQuote);
  query<HTMLFormElement>("[data-trade-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void runPageAction(submitTrade);
  });
  if (marketId) void loadTradeMarket(marketId);
  else updateTradeAvailability();
}

function clearTradeMarketState(): void {
  tradeMarket = null;
  text('[data-detail-phase]','Loading market');text('[data-detail-phase-note]','');text('[data-detail-trading-pool]','Trading route unavailable');
  const graduation=query<HTMLElement>('[data-detail-graduation]');if(graduation)graduation.hidden=true;
  tokenDetailWidget?.setMarket(null);
  detailContentAbort?.abort();detailContentAbort=null;
  ++detailBalancesGeneration;detailBalances=null;
  queryAll<HTMLElement>('[data-detail-symbol]').forEach(el=>el.textContent='Unavailable');
  text('[data-detail-description]','No description available.');
  const avatar=query<HTMLImageElement>('[data-detail-image]');if(avatar){const fallback=new URL('../assets/token-placeholder.svg',import.meta.url).href;avatar.onerror=()=>{avatar.onerror=null;avatar.src=fallback;};avatar.src=fallback;}
  for(const key of ['website','x']){const link=query<HTMLAnchorElement>(`[data-detail-${key}]`);if(link){link.hidden=true;link.removeAttribute('href');}}
  const linksEmpty=query<HTMLElement>('[data-detail-links-empty]');if(linksEmpty)linksEmpty.hidden=false;
  text('[data-detail-stock-label]','Unavailable');text('[data-detail-venue]','Unavailable');
  for (const key of ['symbol', 'token', 'created', 'creator', 'supply', 'volume', 'cap', 'holders', 'fees', 'fee-rules']) text(`[data-detail-${key}]`, 'Unavailable');
  text('[data-detail-fee-note]', 'Load a verified market to view fee allocation rules.');
  const explorer = query<HTMLAnchorElement>('[data-detail-explorer]');
  if (explorer) { explorer.hidden = true; explorer.removeAttribute('href'); }
  const copy = query<HTMLButtonElement>('[data-detail-copy]'); if (copy) copy.disabled = true;
  tradeMetadata = null;
  tradeQuote = null;
  displayPriceWidget?.setToken(null);
  candleWidget?.setMarket(null);
  tradeHistoryWidget?.setMarket(null);
  holderWidget?.setMarket(null);
  text("[data-trade-market-name]", "Market details");
  for (const selector of ["[data-trade-stock]", "[data-trade-quote]", "[data-trade-phase]", "[data-trade-summary-id]"]) text(selector, "—");
  text("[data-trade-market-note]", "Only values returned by the on-chain/read API are displayed.");
  text("[data-trade-route-status]", "Load a market to determine whether its route is available.");
  const stakeLink = query<HTMLAnchorElement>("[data-market-stake-link]");
  if (stakeLink) stakeLink.href = "/stake#positions";
  renderTradeQuote();
}

async function loadDetailContent(market:MarketReadModel,generation:number):Promise<void>{
  const abort=new AbortController();detailContentAbort?.abort();detailContentAbort=abort;const timeout=setTimeout(()=>abort.abort(),10000);
  try{const value=await readDetailMetadata(market.identity?.metadataURI??'',launchMetadataOrigin,abort.signal,import.meta.env.VITE_IPFS_GATEWAY);if(!value||generation!==tradeLoadGeneration||abort.signal.aborted)return;
    text('[data-detail-description]',value.description||'No description available.');const image=query<HTMLImageElement>('[data-detail-image]');if(image&&value.image)image.src=value.image;
    for(const key of ['website','x'] as const){const link=query<HTMLAnchorElement>(`[data-detail-${key}]`);if(link&&value[key]){link.href=value[key];link.hidden=false;link.target='_blank';link.rel='noopener noreferrer';}}
    const empty=query<HTMLElement>('[data-detail-links-empty]');if(empty)empty.hidden=!!(value.website||value.x);
  }catch{/* Optional metadata does not block the market. */}finally{clearTimeout(timeout);}
}
function renderDetailBalances():void{
 if(detailBalanceAccount!==wallet?.account)detailBalances=null;
 const pay=tradeSide==='buy'?detailBalances?.quote:detailBalances?.meme,receive=tradeSide==='buy'?detailBalances?.meme:detailBalances?.quote;
 text('[data-detail-pay-balance]',pay===undefined||!tradeMetadata?'—':formatTokenAmount(pay,tradeSide==='buy'?tradeMetadata.quoteDecimals:18));
 text('[data-detail-receive-balance]',receive===undefined||!tradeMetadata?'—':formatTokenAmount(receive,tradeSide==='buy'?18:tradeMetadata.quoteDecimals));
}
async function loadDetailBalances():Promise<void>{
 const generation=++detailBalancesGeneration,market=tradeMarket,account=wallet?.account;detailBalanceAccount=account;detailBalances=null;renderDetailBalances();if(!market||!account)return;
 try{const blockNumber=(await publicClient.getBlock({blockTag:"latest"})).number;const [quote,meme]=await Promise.all([
 market.market.quoteAsset===ZERO_ADDRESS?publicClient.getBalance({address:account,blockNumber}):publicClient.readContract({abi:erc20Abi,address:canonicalAddress(market.market.quoteAsset,'Quote token'),functionName:'balanceOf',args:[account],blockNumber}),
 publicClient.readContract({abi:erc20Abi,address:canonicalAddress(market.market.memeToken,'Meme token'),functionName:'balanceOf',args:[account],blockNumber})]);
 if(generation!==detailBalancesGeneration||wallet?.account!==account||tradeMarket!==market)return;detailBalances={quote,meme};renderDetailBalances();}catch{/* Unavailable balances remain blank. */}
}

async function loadTradeMarket(explicit?: string): Promise<void> {
  // Clear the old target before parsing or any prerequisite can fail.
  clearTradeMarketState();
  const generation = ++tradeLoadGeneration;
  tradeQuoteGeneration += 1;
  window.clearTimeout(tradeQuoteTimer);
  const raw = explicit ?? query<HTMLInputElement>("[data-market-id]")?.value ?? "";
  let marketId: Hex;
  try { marketId = canonicalBytes32(raw.trim().toLowerCase(), "marketId"); }
  catch (error) { text("[data-detail-phase]", "Choose a market"); text("[data-detail-phase-note]", "Open a token from Explore to view its trading pool."); setPageStatus(errorText(error), "error"); return; }
  if (!foundation || !readApi) {
    setPageStatus(`Market data unavailable — ${runtimeReasons().join("; ")}`, "error");
    return;
  }
  setPageStatus(foundation.direct ? "Loading current market state…" : "Loading the finalized market record and verifying its Registry binding…");
  tradeQuote = null;
  displayPriceWidget?.setToken(null);
  try {
    const response = foundation.direct && directMarkets ? await directMarkets.market(marketId) : await readApi.getMarket({ marketId, revision: foundation.sync.revision });
    if (generation !== tradeLoadGeneration) return;
    if (response.market.marketId !== marketId) throw new Error("Read API returned a different market identity");
    if (!foundation.direct) assertFinalizedSync(response.sync, foundation.sync.revision, "market detail");
    if (foundation.bindings) await ensureCanonicalMarket(response.market);
    const view = toCurveProgressViewModel(response);
    const metadata = await marketMetadata(response.market);
    if (generation !== tradeLoadGeneration) return;
    tradeMarket = response;
    tradeMetadata = metadata;
    queryAll<HTMLElement>('[data-detail-symbol]').forEach(el=>el.textContent=metadata.symbol);
    const baseline=foundation.baseline.find(c=>c.kind==='baseline'&&c.id===response.market.tickerGardenBaselineId);
    const supply=baseline?.values.supply;
    const graduated=response.market.launchPhase===1;
    text('[data-detail-phase]',graduated?'Bloomed · Uniswap v4':'Growing');
    text('[data-detail-phase-note]',graduated?'Trading has moved to the canonical liquidity pool.':view.readyToGraduate?'Ready to bloom':'While Growing, trades take place on the bonding curve.');
    const graduation=query<HTMLElement>('[data-detail-graduation]');if(graduation)graduation.hidden=graduated;
    const progress=typeof supply==='string'?graduationProgress(BigInt(supply),view.reservedTokens,view.sellableTokens):null;
    text('[data-detail-progress-label]',progress===null?'Unavailable':`${progress.toFixed(2)}%`);
    const bar=query<HTMLProgressElement>('[data-detail-progress]');if(bar){if(progress===null)bar.removeAttribute('value');else bar.value=progress;}
    text('[data-detail-trading-pool]',graduated?`Uniswap v4 pool · ${shortHex(response.market.poolId??'')}`:`Bonding curve · ${shortHex(response.market.curve)}`);
    text('[data-detail-supply]',typeof supply==='string'?formatTokenAmount(BigInt(supply),18):'Unavailable');
    tokenDetailWidget?.setMarket({marketId:response.market.marketId,memeToken:response.market.memeToken,quoteAsset:response.market.quoteAsset,quoteDecimals:metadata.quoteDecimals,symbol:metadata.symbol,quoteSymbol:metadata.quoteSymbol,createdAt:Number(response.market.identity?.deployedAt)||undefined});
    void loadDetailContent(response.market,generation);
    void loadDetailBalances();
    text('[data-detail-token]', shortHex(response.market.memeToken));
    const deployed = response.market.identity?.deployedAt;
    const date = deployed && /^\d+$/.test(deployed) ? new Date(Number(deployed) * 1000) : null;
    text('[data-detail-created]', date && Number.isFinite(date.getTime()) ? date.toLocaleDateString('en-US', {year:'numeric', month:'short', day:'numeric'}) : 'Unavailable');
    // Detail analytics owns volume and circulating cap; directory metrics use FDV.
    const explorer = query<HTMLAnchorElement>('[data-detail-explorer]');
    if (explorer) { explorer.href = `${robinhoodChain.blockExplorers.default.url}/token/${response.market.memeToken}`; explorer.hidden = false; }
    const copy = query<HTMLButtonElement>('[data-detail-copy]'); if (copy) copy.disabled = false;
    void renderTradeFeeDetails(response.market, generation);
 candleWidget?.setMarket({marketId:response.market.marketId,memeAsset:response.market.memeToken,quoteAsset:response.market.quoteAsset,quoteDecimals:metadata.quoteDecimals});
 holderWidget?.setMarket({marketId:response.market.marketId,memeToken:response.market.memeToken});
 tradeHistoryWidget?.setMarket({marketId:response.market.marketId,memeAsset:response.market.memeToken,quoteAsset:response.market.quoteAsset,quoteDecimals:metadata.quoteDecimals});
    const idInput = query<HTMLInputElement>("[data-market-id]");
    if (idInput) idInput.value = marketId;
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("marketId", marketId);
    router.replaceLocation(nextUrl.href);
    text("[data-trade-market-name]", metadata.name);
    const stakeLink = query<HTMLAnchorElement>("[data-market-stake-link]");
    if (stakeLink) stakeLink.href = `/stake?marketId=${encodeURIComponent(response.market.marketId)}#positions`;
    text("[data-trade-stock]", shortHex(response.market.assetUid, 9, 7));
    text('[data-detail-venue]',response.market.launchPhase===0?'Bonding curve':'Uniswap v4');
    if(response.market.gauge===ZERO_ADDRESS)text('[data-detail-stock-label]','Staking disabled');
    else {const asset=findAsset(response.market.assetUid);const token=stockToken(asset);text('[data-detail-stock-label]',token?shortHex(token):'Unavailable');
      if(token)void publicClient.readContract({abi:erc20Abi,address:canonicalAddress(token,'Stock token'),functionName:'symbol'}).then(symbol=>{if(generation===tradeLoadGeneration)text('[data-detail-stock-label]',symbol);}).catch(()=>{});}

    displayPriceWidget?.setToken(response.market.quoteAsset);
    text("[data-trade-quote]", metadata.quoteSymbol);
    text("[data-trade-phase]", phaseLabel(response.market.launchPhase));
    text("[data-trade-summary-id]", marketId);
    text("[data-trade-market-note]", `Real Quote reserve ${formatTokenAmount(view.realQuoteReserve, metadata.quoteDecimals)} ${metadata.quoteSymbol}; sellable Meme ${formatTokenAmount(view.sellableTokens, 18)} ${metadata.symbol}.`);
    const route = response.market.canonicalRoute;
    text("[data-trade-route-status]", route.curveTradingEnabled
      ? `Curve route verified at ${shortHex(response.market.curve, 9, 7)}. Quotes expire after 30 seconds.`
      : route.poolTradingEnabled
        ? `Canonical Uniswap v4 pool ${shortHex(response.market.poolId)}. Quotes expire after 30 seconds.`
        : `No user trading route is enabled during ${phaseLabel(response.market.launchPhase)}.`);
    setPageStatus(foundation.direct ? "Market loaded from current contract state. Final confirmation pending." : `Market verified at finalized snapshot ${response.sync.revision}`, foundation.writeReady ? "success" : "warning");
    renderTradeQuote();
    updateTradeAvailability();
    if (query<HTMLInputElement>("[data-trade-amount]")?.value.trim()) scheduleTradeQuote();
  } catch (error) {
    if (generation !== tradeLoadGeneration) return;
    clearTradeMarketState();
    text("[data-detail-phase]", "Market unavailable");
    text("[data-detail-phase-note]", errorText(error));
    setPageStatus(`Market load failed — ${errorText(error)}`, "error");
    text("[data-trade-route-status]", "The route could not be verified; trading remains locked.");
    updateTradeAvailability();
  }
}

async function renderTradeFeeDetails(market: MarketReadModel, generation: number): Promise<void> {
  try {
    const release = marketRelease(market.marketId);
    if (tradeMarket?.market.marketId !== market.marketId || !tradeMarket.sync.blockNumber) return;
    const observedBlock = BigInt(tradeMarket.sync.blockNumber);
    const raw = await publicClient.readContract({abi: v1Abis.MarketRegistryV1, address: release.marketRegistry, functionName: 'market', args: [market.marketId],blockNumber:observedBlock});
    if (generation !== tradeLoadGeneration || tradeMarket?.market.marketId !== market.marketId) return;
    const config = raw.config;
    const fees = feeDistribution(market.launchPhase, config.stakingEnabled, config.creatorFeesToHolders, config.creatorTaxBps);
    let active:boolean|null=false;
    if(market.launchPhase===1&&config.stakingEnabled){try{active=(await publicClient.readContract({abi:v1Abis.MemeStockGauge,address:canonicalAddress(market.gauge,'Gauge'),functionName:'effectiveTotalActiveStock',blockNumber:observedBlock}))>0n;}catch{active=null;}}
    if(generation!==tradeLoadGeneration)return;
    tokenDetailWidget?.setFeeConfig({phase:market.launchPhase,stakingEnabled:config.stakingEnabled,holders:config.creatorFeesToHolders,active,taxBps:config.creatorTaxBps});
    text('[data-detail-fees]', fees.summary);
    // The detail widget renders verified fee rules and asset-separated credits.
    text('[data-detail-creator]', shortHex(config.creatorRevenueBeneficiaryAtCreation));
  } catch {
    if (generation !== tradeLoadGeneration) return;
    text('[data-detail-fees]', 'Unavailable');
    text('[data-detail-fee-note]', 'Fee configuration could not be verified.');
  }
}

function scheduleTradeQuote(): void {
  window.clearTimeout(tradeQuoteTimer);
  const generation = ++tradeQuoteGeneration;
  tradeQuote = null;
  renderTradeQuote();
  tradeQuoteTimer = window.setTimeout(() => { void quoteTrade(generation); }, 300);
}

async function quoteTrade(generation: number): Promise<void> {
  if (!tradeMarket || !tradeMetadata || !wallet || !foundation?.writeReady) {
    updateTradeAvailability();
    return;
  }
  if(foundation.direct&&directMarkets){
    const current=tradeMarket;
    try {
      const fresh=await directMarkets.market(current.market.marketId);
      if(generation!==tradeQuoteGeneration||tradeMarket!==current)return;
      if(fresh.market.launchPhase!==current.market.launchPhase||fresh.market.sourceVersion!==current.market.sourceVersion){await loadTradeMarket(current.market.marketId);return;}
    } catch(error){if(generation===tradeQuoteGeneration)text('[data-trade-status]',`Market state unavailable — ${errorText(error)}`);return;}
  }
  if(!tradeMarket||!tradeMetadata||!wallet)return;
  const market = tradeMarket;
  const metadata = tradeMetadata;
  const activeWallet = wallet;
  const side = tradeSide;
  if (!tradingRoute(market.market.launchPhase, market.market.canonicalRoute)) {
    text("[data-trade-status]", "The trading route is unavailable. Refresh the market before trying again.");
    updateTradeAvailability();
    return;
  }
  try {
    const amountInput = required<HTMLInputElement>("[data-trade-amount]").value;
    const slippageBps = parseSlippageBps(required<HTMLInputElement>("[data-trade-slippage]").value);
    const inputDecimals = side === "buy" ? metadata.quoteDecimals : 18;
    const amount = parseTokenAmount(amountInput, inputDecimals, side === "buy" ? "Quote input" : "Meme input");
    await ensureCurrentRevision(market.sync.revision);
    await ensureCanonicalMarket(market.market);
    await verifyLiveWalletContext(activeWallet);
    let quote: TradeQuote;
    if (market.market.launchPhase===1) {
      assertPoolRouterProfile(robinhoodChain.id,market.market.canonicalRoute.router);
      const route=poolTradeRoute(market.market,side);
      poolAmount(amount);
      const result=await publicClient.simulateContract({abi:poolQuoterAbi,address:route.quoter,functionName:'quoteExactInputSingle',args:[{poolKey:route.poolKey,zeroForOne:route.zeroForOne,exactAmount:amount,hookData:'0x'}],account:activeWallet.account});
      const output=poolAmount(result.result[0]);
      quote=Object.freeze({side,marketId:market.market.marketId,input:amount,output,spent:side==='buy'?amount:null,refund:null,fee:null,minimum:minimumAfterSlippage(output,slippageBps),slippageBps,revision:market.sync.revision,expiresAtMs:Date.now()+30_000});
    } else if (side === "buy") {
      const [tokensOut, quoteSpent, refund] = await publicClient.readContract({
        abi: v1Abis.TickerGardenCurve,
        address: canonicalAddress(market.market.curve, "Curve"),
        functionName: "quoteBuy",
        args: [amount, activeWallet.account],
        account: activeWallet.account,
      });
      if (tokensOut <= 0n) throw new Error("Curve returned zero Meme output");
      quote = Object.freeze({
        side: "buy", marketId: market.market.marketId, input: amount, output: tokensOut,
        spent: quoteSpent, refund, fee: null, minimum: minimumAfterSlippage(tokensOut, slippageBps),
        slippageBps, revision: market.sync.revision, expiresAtMs: Date.now() + 30_000,
      });
    } else {
      const [quoteOut, fee] = await publicClient.readContract({
        abi: v1Abis.TickerGardenCurve,
        address: canonicalAddress(market.market.curve, "Curve"),
        functionName: "quoteSell",
        args: [amount],
        account: activeWallet.account,
      });
      if (quoteOut <= 0n) throw new Error("Curve returned zero Quote output");
      quote = Object.freeze({
        side: "sell", marketId: market.market.marketId, input: amount, output: quoteOut,
        spent: null, refund: null, fee, minimum: minimumAfterSlippage(quoteOut, slippageBps),
        slippageBps, revision: market.sync.revision, expiresAtMs: Date.now() + 30_000,
      });
    }
    if (
      generation !== tradeQuoteGeneration
      || wallet !== activeWallet
      || tradeMarket !== market
      || tradeMetadata !== metadata
      || tradeSide !== side
    ) return;
    tradeQuote = quote;
    window.clearTimeout(tradeQuoteExpiryTimer);
    tradeQuoteExpiryTimer = window.setTimeout(() => {
      if (tradeQuote !== quote) return;
      tradeQuote = null;
      renderTradeQuote();
      if (!pageActionPending && !busyOperation) text('[data-trade-status]', 'Quote expired. Refresh quote to continue.');
    }, Math.max(0, quote.expiresAtMs - Date.now()));
    renderTradeQuote();
    await renderTradeAllowance(quote, market, activeWallet, generation);
  } catch (error) {
    if (generation !== tradeQuoteGeneration) return;
    tradeQuote = null;
    text("[data-trade-status]", `Quote unavailable — ${errorText(error)}`);
    updateTradeAvailability();
  }
}

function renderTradeQuote(): void {
  const form=query<HTMLElement>('[data-trade-form]');if(form)form.dataset.refMode=tradeSide;
  const connect=query<HTMLButtonElement>('[data-detail-connect]');if(connect)connect.hidden=!!wallet;
  renderDetailBalances();
  const inputAsset = query<HTMLElement>("[data-trade-input-asset]");
  const outputAsset = query<HTMLElement>("[data-trade-output-asset]");
  if (inputAsset) inputAsset.textContent = tradeSide === "buy" ? tradeMetadata?.quoteSymbol ?? "Quote" : tradeMetadata?.symbol ?? "Meme";
  if (outputAsset) outputAsset.textContent = tradeSide === "buy" ? tradeMetadata?.symbol ?? "Meme" : tradeMetadata?.quoteSymbol ?? "Quote";
  const submit = query<HTMLButtonElement>("[data-trade-submit]");
  if (submit) {
    submit.className = `action-button ${tradeSide}`;
    submit.hidden=!wallet;
    submit.textContent = tradeSide === "buy" ? "Buy Ticker Meme" : "Sell Ticker Meme";
  }
  if (!tradeQuote || !tradeMetadata) {
    text("[data-trade-output]", "—");
    text("[data-trade-rate]", "—");
    text("[data-trade-fee]", "—");
    text("[data-trade-impact]", "Not exposed");
    text("[data-trade-minimum]", "—");
    text("[data-trade-approval]", "Enter an amount and slippage to read an on-chain quote.");
    text("[data-trade-status]", wallet ? "A fresh on-chain quote is required before submitting." : "Connect a wallet before requesting a buyer-specific quote.");
    updateTradeAvailability();
    return;
  }
  const outputDecimals = tradeQuote.side === "buy" ? 18 : tradeMetadata.quoteDecimals;
  const outputSymbol = tradeQuote.side === "buy" ? tradeMetadata.symbol : tradeMetadata.quoteSymbol;
  text("[data-trade-output]", formatTokenAmount(tradeQuote.output, outputDecimals));
  const meme=tradeQuote.side==='buy'?tradeQuote.output:tradeQuote.input;
  const quoteAmount=tradeQuote.side==='buy'?(tradeQuote.spent??tradeQuote.input):tradeQuote.output;
  text("[data-trade-rate]",`${formatTokenAmount(quoteAmount*10n**18n/meme,tradeMetadata.quoteDecimals)} ${tradeMetadata.quoteSymbol} / ${tradeMetadata.symbol}`);
  text("[data-trade-fee]", tradeQuote.fee === null ? (tradeMarket?.market.launchPhase===1?"Included in pool quote":"Included in Curve quote") : `${formatTokenAmount(tradeQuote.fee, tradeMetadata.quoteDecimals)} ${tradeMetadata.quoteSymbol}`);
  text("[data-trade-impact]", tradeQuote.refund && tradeQuote.refund > 0n ? `Partial fill; ${formatTokenAmount(tradeQuote.refund, tradeMetadata.quoteDecimals)} ${tradeMetadata.quoteSymbol} refund` : "Not separately exposed");
  text("[data-trade-minimum]", `${formatTokenAmount(tradeQuote.minimum, outputDecimals)} ${outputSymbol}`);
  text("[data-trade-status]", `Quote valid for 30 seconds at ${tradeQuote.slippageBps} bps slippage. Transaction is simulated again before signature.`);
  updateTradeAvailability();
}

async function renderTradeAllowance(
  quote: TradeQuote,
  market: MarketDetailResponse,
  activeWallet: WalletState,
  generation: number,
): Promise<void> {
  const token = quote.side === "buy" ? market.market.quoteAsset : market.market.memeToken;
  if (token === ZERO_ADDRESS) {
    if (generation === tradeQuoteGeneration) text("[data-trade-approval]", "Native ETH input — no ERC-20 approval required.");
    return;
  }
  const spender = market.market.launchPhase===1?PERMIT2:canonicalAddress(market.market.curve, "Curve");
  if(market.market.launchPhase===1){text('[data-trade-approval]','Pool trades use exact-amount token and Permit2 approvals when needed.');return;}
  const allowance = await publicClient.readContract({ abi: erc20Abi, address: canonicalAddress(token, "Input token"), functionName: "allowance", args: [activeWallet.account, spender] });
  if (generation !== tradeQuoteGeneration || tradeQuote !== quote || wallet !== activeWallet || tradeMarket !== market) return;
  text("[data-trade-approval]", allowance >= quote.input ? "Current allowance is sufficient." : "One exact-amount approval will be requested before the trade.");
}

function updateTradeAvailability(): void {
  const submit = query<HTMLButtonElement>("[data-trade-submit]");
  if (!submit) return;
  const quoteFresh = Boolean(
    tradeQuote
    && tradeQuote.expiresAtMs > Date.now()
    && tradeMarket
    && tradeQuote.marketId === tradeMarket.market.marketId
    && tradeQuote.side === tradeSide,
  );
  const routeReady = tradeMarket && tradingRoute(tradeMarket.market.launchPhase, tradeMarket.market.canonicalRoute);
  const balance = detailBalanceAccount === wallet?.account ? (tradeSide === 'buy' ? detailBalances?.quote : detailBalances?.meme) : undefined;
  const insufficient = !!tradeQuote && balance !== undefined && tradeQuote.input > balance;
  setDisabled(submit, !writeReady() || !quoteFresh || !routeReady || insufficient);
  const retry = query<HTMLButtonElement>('[data-trade-requote]');
  if (retry) { retry.hidden = !wallet || !tradeMarket; retry.disabled = !writeReady() || !routeReady; }
  if (insufficient) text('[data-trade-status]', 'Insufficient balance for this amount. Reduce the amount and keep ETH for network fees.');
}

async function submitTrade(): Promise<void> {
  try {
    if (!foundation || !wallet || !tradeMarket || !tradeQuote) throw new Error("Connect a wallet, load a Curve market and request a fresh quote");
    const activeWallet = wallet;
    const market = tradeMarket;
    const quote = tradeQuote;
    const side = tradeSide;
    await verifyLiveWalletContext(activeWallet);
    if (quote.expiresAtMs <= Date.now() || quote.side !== side || quote.marketId !== market.market.marketId) {
      throw new Error("The quote expired or no longer matches the form");
    }
    const metadata = tradeMetadata;
    if (!metadata) throw new Error("Trade metadata is unavailable");
    const currentInput = parseTokenAmount(
      required<HTMLInputElement>("[data-trade-amount]").value,
      side === "buy" ? metadata.quoteDecimals : 18,
      side === "buy" ? "Quote input" : "Meme input",
    );
    const currentSlippageBps = parseSlippageBps(required<HTMLInputElement>("[data-trade-slippage]").value);
    if (currentInput !== quote.input || currentSlippageBps !== quote.slippageBps) {
      throw new Error("The trade form changed after quoting; request a fresh quote");
    }
    if (!tradingRoute(market.market.launchPhase, market.market.canonicalRoute)) throw new Error("Trading route changed. Refresh the market and quote.");
    if(market.market.launchPhase===1){await submitPoolTrade(market,quote,activeWallet);return;}
    const curve = canonicalAddress(market.market.curve, "Curve");
    const account = activeWallet.account;
    const built = side === "buy"
      ? buildCurveBuyRequest({ marketResponse: market, quoteIn: quote.input, minTokensOut: quote.minimum, recipient: account })
      : buildCurveSellRequest({ marketResponse: market, tokensIn: quote.input, minQuoteOut: quote.minimum, recipient: account });
    const inputToken = side === "buy" ? built.view.quoteAsset : built.view.memeToken;
    const approval = await allowanceApproval(built.approval, inputToken, curve, quote.input, account);
    await executeTransaction({
      operationKey: `trade:${quote.side}:${quote.marketId}:${quote.input}:${quote.revision}`,
      sync: market.sync,
      request: built.request,
      ...(approval ? { approval } : {}),
      quoteExpiresAtMs: quote.expiresAtMs,
      walletContext: activeWallet,
      verifyChain: () => ensureCanonicalMarket(market.market),
      confirm: async (receipt) => {
        if (quote.side === "buy") {
          receiptEvent(receipt, curve, v1Abis.TickerGardenCurve, "CurveBuy", (args) =>
            String(args.buyer).toLowerCase() === account
            && String(args.recipient).toLowerCase() === account
            && typeof args.quoteIn === "bigint"
            && args.quoteIn > 0n
            && args.quoteIn <= quote.input
            && typeof args.tokensOut === "bigint"
            && args.tokensOut >= quote.minimum,
          );
        } else {
          receiptEvent(receipt, curve, v1Abis.TickerGardenCurve, "CurveSell", (args) =>
            String(args.seller).toLowerCase() === account
            && String(args.recipient).toLowerCase() === account
            && args.tokensIn === quote.input
            && typeof args.quoteOut === "bigint"
            && args.quoteOut >= quote.minimum,
          );
        }
        return true;
      },
    });
    directMarkets?.cache.delete(market.market.marketId);
    const amountInput = query<HTMLInputElement>("[data-trade-amount]");
    if (amountInput) amountInput.value = "";
    tradeQuote = null;
    renderTradeQuote();
    toast("Trade confirmed from its canonical Curve event", "success");
    const generation = routeGeneration;
    window.setTimeout(() => { if (generation === routeGeneration && tradeMarket) void loadTradeMarket(tradeMarket.market.marketId); }, 1_500);
  } catch (error) {
    toast(`Trade requires attention — ${errorText(error)}`, "warning");
  }
}

async function submitPoolTrade(market:MarketDetailResponse,initial:TradeQuote,activeWallet:WalletState):Promise<void>{
  assertPoolRouterProfile(robinhoodChain.id,market.market.canonicalRoute.router);
  const route=poolTradeRoute(market.market,initial.side),account=activeWallet.account;
  const verify=()=>ensureCanonicalMarket(market.market);
  const [manager,quoterManager]=await Promise.all([
    publicClient.readContract({abi:poolRouterAbi,address:route.router,functionName:'poolManager'}),
    publicClient.readContract({abi:poolQuoterAbi,address:route.quoter,functionName:'poolManager'}),
  ]);
  if(manager.toLowerCase()!==quoterManager.toLowerCase()||manager===ZERO_ADDRESS)throw Error('Pool router and quoter do not share a PoolManager');
  if(route.input!==ZERO_ADDRESS){
    await ensureStandaloneApproval({abi:erc20Abi,address:route.input,functionName:'approve',args:[PERMIT2,initial.input]},route.input,PERMIT2,initial.input,market.sync,verify,activeWallet);
    const [allowance,expiration]=await publicClient.readContract({abi:permit2Abi,address:PERMIT2,functionName:'allowance',args:[account,route.input,route.router]});
    if(allowance<initial.input||expiration<Math.floor(Date.now()/1000)+120){
      const expiry=Math.floor(Date.now()/1000)+600;
      await executeTransaction({operationKey:`pool-approval:${market.market.marketId}:${initial.input}:${expiry}`,sync:market.sync,request:{abi:permit2Abi,address:PERMIT2,functionName:'approve',args:[route.input,route.router,initial.input,expiry]},walletContext:activeWallet,verifyChain:verify,confirm:async receipt=>{
        const [amount,until]=await publicClient.readContract({abi:permit2Abi,address:PERMIT2,functionName:'allowance',args:[account,route.input,route.router],blockNumber:receipt.blockNumber});
        if(amount<initial.input||until!==expiry)throw Error('Pool spending approval was not confirmed');return true;
      }});
    }
  }
  // Approvals may take longer than the quote window. Always refresh before signing the swap.
  await quoteTrade(++tradeQuoteGeneration);
  const quote=tradeQuote;
  if(wallet!==activeWallet||tradeMarket!==market||!quote||quote.input!==initial.input||quote.side!==initial.side||quote.slippageBps!==initial.slippageBps)throw Error('Trade changed during approval. Review the new quote.');
  const request=buildPoolTrade(market.market,quote.side,quote.input,quote.minimum,BigInt(Math.floor(quote.expiresAtMs/1000)));
  await executeTransaction({operationKey:`pool-trade:${quote.side}:${quote.marketId}:${quote.input}:${quote.expiresAtMs}`,sync:market.sync,request,quoteExpiresAtMs:quote.expiresAtMs,walletContext:activeWallet,verifyChain:verify,confirm:async receipt=>{
    receiptEvent(receipt,canonicalAddress(manager,'PoolManager'),poolSwapAbi,'Swap',args=>String(args.id).toLowerCase()===market.market.poolId&&String(args.sender).toLowerCase()===route.router.toLowerCase()&&typeof args.amount0==='bigint'&&typeof args.amount1==='bigint'&&(route.zeroForOne?args.amount0<0n&&args.amount1>0n:args.amount1<0n&&args.amount0>0n));
    directMarkets?.receipt(receipt);return true;
  }});
  const input=query<HTMLInputElement>('[data-trade-amount]');if(input)input.value='';
  tradeQuote=null;renderTradeQuote();toast('Pool trade confirmed','success');
  if(tradeMarket===market)await loadTradeMarket(market.market.marketId);
}

type LaunchPreview = Readonly<{
  creator: Address;
  selected: SelectedLaunchConfig;
  params: CreateMarketParams;
  marketId: Hex;
  memeToken: Address;
  curve: Address;
  gauge: Address;
  launchLocker: Address;
}>;

let launchProgress: LaunchState | null = null;
let launchRecoveryBusy=false;
let launchRecoveryTimer:ReturnType<typeof setTimeout>|undefined;
function drawLaunchProgress():void{
 if(!launchProgress)return;
 const display=launchProgress.phase==='paused'&&!launchProgress.hash?{step:'Confirm in wallet',percent:60}:launchPhaseDisplay[launchProgress.phase];
 renderLaunchProgress({title:launchProgress.phase==='failed'?'Launch stopped':'Launching your token',...display,detail:launchProgress.detail,hash:launchProgress.hash,
  explorer:launchProgress.hash?`${robinhoodChain.blockExplorers.default.url}/tx/${launchProgress.hash}`:'',needsHash:launchProgress.phase==='paused'||(launchProgress.phase==='wallet'&&!launchSubmitting),canDismiss:launchProgress.phase==='failed'},
 {onHash:hash=>{if(!launchProgress||launchSubmitting)return;launchProgress.hash=hash;updateLaunchProgress('pending','Checking the transaction you provided…');void restoreLaunchProgress();},
 onDismiss:()=>{if(launchProgress?.phase!=='failed')return;localStorage.removeItem(launchStateKey(robinhoodChain.id));launchProgress=null;closeLaunchProgress();updateCreateAvailability();}});
}
function updateLaunchProgress(phase:LaunchPhase,detail:string):void{
 if(!launchProgress)return;launchProgress={...launchProgress,phase,detail};
 saveLaunchState(localStorage,launchProgress);drawLaunchProgress();
}
function handleLaunchTransactionUpdate(update:TransactionUpdate):void{
 if(!launchProgress)return;
 if(update.hash)launchProgress.hash=update.hash;
 if(update.replacementReason==='cancelled')launchProgress.cancelled=true;
 if(update.stage==='awaiting_signature')updateLaunchProgress('wallet','Confirm the launch transaction in your wallet. Do not submit a second launch.');
 else if(['submitted','pending','replaced'].includes(update.stage))updateLaunchProgress('pending','Transaction submitted. Waiting for chain confirmation. You may refresh this page.');
 else if(update.stage==='confirming')updateLaunchProgress('confirming','Transaction mined. Verifying your new token…');
 else if((update.stage==='simulating'||update.stage==='preflight')&&launchProgress.phase!=='approval')updateLaunchProgress('preparing','Preparing and checking your launch transaction…');
 else if(update.stage==='failed'&&['user_rejected','transaction_reverted','replacement_cancelled','simulation_failed'].includes(update.error?.code??''))updateLaunchProgress('failed',update.error?.message??'The transaction did not complete.');
 else if(update.stage==='unknown')updateLaunchProgress('paused','Confirmation is taking longer. Keep tracking this transaction; do not launch again.');
}
function navigateCompletedLaunch(state:LaunchState):void{
 if(!state.expected)return;
 if(pageActionPending||busyOperation||walletConnecting||launchSubmitting){drawLaunchProgress();launchRecoveryTimer=setTimeout(()=>void restoreLaunchProgress(),1000);return;}
 if(router.navigate(`/trade?marketId=${encodeURIComponent(state.expected.marketId)}`)){
  closeLaunchProgress();const saved=readLaunchState(localStorage,state.chainId);
  if(saved?.id===state.id)localStorage.removeItem(launchStateKey(state.chainId));launchProgress=null;
 }
}
function finishRecoveredLaunch(state:LaunchState,receipt:TransactionReceipt):void{
 const expected=state.expected;if(!expected)throw Error('Saved launch identity is missing');
 assertRecoveredLaunchReceipt(state,receipt);
 directMarkets?.receipt(receipt);
 if(state.listing){latestListing={snapshot:{...state.listing,txHash:receipt.transactionHash},marketId:expected.marketId};localStorage.setItem(`tg-listing:${robinhoodChain.id}`,JSON.stringify(latestListing));}
 // Clear only a matching executor journal, never an unrelated approval/trade.
 const key=`tickergarden:pending:${state.chainId}:${state.account.toLowerCase()}`;
 try {
  const pending=JSON.parse(localStorage.getItem(key)??'null');
  if(pending?.intent===state.intent)localStorage.removeItem(key);
 } catch { /* Preserve unrelated or unreadable recovery data. */ }
 clearCreateDraft(localStorage, state.chainId); pendingCreateDraft = null;
 launchProgress={...state,phase:'complete',hash:receipt.transactionHash,detail:'Your token is ready. Opening its market…'};
 saveLaunchState(localStorage,launchProgress);navigateCompletedLaunch(launchProgress);
}
async function restoreLaunchProgress():Promise<void>{
 if(launchSubmitting||launchRecoveryBusy)return;
 if(launchRecoveryTimer){clearTimeout(launchRecoveryTimer);launchRecoveryTimer=undefined;}
 try{launchProgress=readLaunchState(localStorage,robinhoodChain.id);}catch(error){
  renderLaunchProgress({title:'Launch recovery needs attention',step:'Check saved launch',detail:errorText(error),percent:0,explorer:robinhoodChain.blockExplorers.default.url},{});return;
 }
 const state=launchProgress;if(!state){closeLaunchProgress();updateCreateAvailability();return;}
 if(state.phase==='complete'&&state.expected){
  navigateCompletedLaunch(state);return;
 }
 // Recover the narrow gap between executor persistence and the UI callback.
 if(!state.hash&&state.intent){
  try{const pending=JSON.parse(localStorage.getItem(`tickergarden:pending:${state.chainId}:${state.account.toLowerCase()}`)??'null');
   if(pending?.intent===state.intent&&!pending.approval&&/^0x[\da-f]{64}$/i.test(pending.hash)){state.hash=pending.hash;state.cancelled=pending.cancelled;state.phase='pending';saveLaunchState(localStorage,state);}
  }catch{/* Retain the launch guard when wallet history is uncertain. */}
 }
 if(state.phase==='failed'){drawLaunchProgress();return;}
 const lockSnapshot=await navigator.locks?.query();
 if(lockSnapshot?.held?.some(l=>l.name===`tg-launch:${state.chainId}`)){
  drawLaunchProgress();launchRecoveryTimer=setTimeout(()=>void restoreLaunchProgress(),10000);return;
 }
 if(!state.hash){
  // A tab holding the launch lock may still be uploading or waiting on its wallet.
  if(state.phase==='wallet'||state.phase==='paused')updateLaunchProgress('paused','This page was refreshed before the wallet returned a transaction hash. Check wallet activity and enter the launch hash below. Do not publish again.');
  else updateLaunchProgress('failed','Preparation was interrupted before the launch was sent. Return to the form to continue. Any asset approval is a separate transaction.');
  return;
 }
 launchRecoveryBusy=true;drawLaunchProgress();
 let receiptFound=false;
 try{
  const receipt=await publicClient.getTransactionReceipt({hash:state.hash as Hash});
  receiptFound=true;
  if(launchProgress?.hash!==state.hash)return;
  const target=state.intent?JSON.parse(state.intent)[0]:null;
  if(receipt.from.toLowerCase()!==state.account.toLowerCase()||!target||receipt.to?.toLowerCase()!==target)throw Error('Receipt does not match the saved launch sender and destination');
  if(receipt.status==='reverted'||state.cancelled){
   const transaction=await publicClient.getTransaction({hash:state.hash as Hash});
   if(!state.data||transaction.input.toLowerCase()!==state.data.toLowerCase())throw Error('Reverted transaction calldata does not match this launch');
   const key=`tickergarden:pending:${state.chainId}:${state.account.toLowerCase()}`;
   const pending=JSON.parse(localStorage.getItem(key)??'null');if(pending?.intent===state.intent)localStorage.removeItem(key);
   updateLaunchProgress('failed',state.cancelled?'The launch transaction was cancelled.':'The launch transaction reverted. No token was created.');return;}
  finishRecoveredLaunch(state,receipt);
 }catch{
  updateLaunchProgress('paused',receiptFound?'A receipt was found, but it could not be matched to this launch. Check the launch hash in your wallet.':'Still checking this launch transaction. We will check again shortly. If your wallet replaced it, enter the new hash.');
  if(!receiptFound)launchRecoveryTimer=setTimeout(()=>void restoreLaunchProgress(),10000);
 }finally{launchRecoveryBusy=false;}
}
window.addEventListener('storage',event=>{
 if(event.key!==launchStateKey(robinhoodChain.id)||launchSubmitting)return;
 if(event.newValue){try{
  const completed=readLaunchState({getItem:()=>event.newValue},robinhoodChain.id);
  if(completed?.phase==='complete'&&completed.expected){launchProgress=completed;navigateCompletedLaunch(completed);return;}
 }catch{/* Restore displays a blocking recovery error. */}}
 void restoreLaunchProgress();
});

let launchSalt = randomSalt();
let launchPreview: LaunchPreview | null = null;
let launchPreviewGeneration = 0;
let launchPreviewTimer = 0;
let launchSubmitting = false;
let launchFunding: (LaunchFunding & Readonly<{ gasCost: bigint; totalRequired: bigint; quoteDecimals: number }>) | null = null;
let launchImage: string | undefined;
let launchImageGeneration = 0;
let launchImageReading = false;
let preparedMetadataURI = "";
let preparedMetadata: Record<string, unknown> | undefined;
let latestListing: {snapshot:ListingPackageSnapshot;marketId:string} | null = null;
let preparedMetadataKey = "";
const launchMetadataOrigin = (() => { try { return metadataOrigin(import.meta.env.VITE_LAUNCH_METADATA_ORIGIN); } catch { return null; } })();

const developerBuyBalances = new DeveloperBuyBalanceCache();

function renderDeveloperBuyBalance(): void {
  const label = query<HTMLElement>("[data-developer-buy-balance]");
  const notice = query<HTMLElement>("[data-developer-buy-notice]");
  if (!label || !notice) return;
  notice.hidden = true;
  notice.textContent = "";
  const account = wallet?.account;
  if (!account) { label.textContent = "Connect wallet to see balance"; return; }
  const selection = query<HTMLSelectElement>("[name=quoteAssetConfigId]")?.value ?? "";
  const asset = releasePairForSelection(selection, foundation?.quotes ?? []);
  if (!asset) { label.textContent = "Balance unavailable"; return; }
  const native = asset.tokenAddress === ZERO_ADDRESS;
  const key = `${robinhoodChain.id}:${account}:${asset.tokenAddress}`;
  const pageGeneration = routeGeneration;
  label.textContent = `Balance: loading ${asset.symbol}…`;
  void developerBuyBalances.read(key, () => native
    ? publicClient.getBalance({ address: account })
    : publicClient.readContract({ address: asset.tokenAddress as Address, abi: erc20Abi, functionName: "balanceOf", args: [account] })
  ).then(balance => {
    if (routeGeneration !== pageGeneration || wallet?.account !== account || query<HTMLSelectElement>("[name=quoteAssetConfigId]")?.value !== selection) return;
    label.textContent = balance === null ? `Balance unavailable · ${asset.symbol}` : `Balance: ${formatTokenAmount(balance, asset.decimals)} ${asset.symbol}`;
    if (balance === null) return;
    try {
      const raw = query<HTMLInputElement>("[name=firstBuyAmount]")?.value.trim() ?? "";
      const amount = raw ? parseTokenAmount(raw, asset.decimals, "Developer buy") : 0n;
      notice.textContent = developerBuyNotice({ amount, balance, symbol: asset.symbol,
        displayAmount: formatTokenAmount(amount, asset.decimals), native,
        autoBuy: Boolean(asset.nativeQuotePoolFee && asset.nativeQuoteTickSpacing && activePairedConfig(asset, foundation?.quotes ?? [], robinhoodChain.id)),
      });
      notice.hidden = !notice.textContent;
    } catch { /* Field validation explains invalid amounts. */ }
  });
}

function launchDetails() {
  const value = (name: string) => query<HTMLInputElement | HTMLTextAreaElement>(`[name=${name}]`)?.value.trim() ?? "";
  return { name: value("name"), symbol: value("symbol"), description: value("description"), x: value("x"), website: value("website"), creatorFeesToHolders: query<HTMLInputElement>("[name=treasuryEnabled]")?.checked ?? false, creatorTaxBps: (() => { try { return creatorTaxBps(value("creatorTax")); } catch { return 0; } })(), image: launchImage };
}
function currentMetadataURI(): string {
  return preparedMetadataKey === JSON.stringify(launchDetails()) ? preparedMetadataURI : "";
}
async function prepareLaunchMetadata(): Promise<void> {
  if (currentMetadataURI()) return;
  if (!launchMetadataOrigin) throw new Error("Token detail storage is not available yet. Please try again once publishing is enabled.");
  const details = launchDetails();
  const key = JSON.stringify(details);
  text("[data-create-preview]", "Saving your token details and image…");
  const published = await publishLaunchDetails(launchMetadataOrigin, details);
  if (key !== JSON.stringify(launchDetails())) throw new Error("Token details changed while saving. Review and launch again.");
  if (!published.metadata) throw new Error("Update the metadata service before launching: published details are missing.");
  if (isIPFSFileURI(published.metadataURI) && !ipfsGatewayURL(published.metadataURI,import.meta.env.VITE_IPFS_GATEWAY)) throw new Error("Configure the public IPFS gateway before launching.");
  preparedMetadataKey = key;
  preparedMetadataURI = published.metadataURI;
  preparedMetadata = published.metadata;
}


function populateSelect(select: HTMLSelectElement, items: readonly ConfigReadModel[], placeholder: string): void {
  const prior = select.value;
  select.replaceChildren(new Option(placeholder, ""));
  select.options[0]!.disabled = true;
  items.forEach((item) => select.add(new Option(configLabel(item), item.id)));
  if (items.some((item) => item.id === prior)) select.value = prior;
  else if (items[0]) select.value = items[0].id;
}

function renderSelectedTokenImage(image?: string, file?: File, dimensions?: { width: number; height: number }): void {
  const previewImage = required<HTMLImageElement>("[data-token-image]");
  previewImage.hidden = !image;
  if (image) previewImage.src = image; else previewImage.removeAttribute("src");
  required<HTMLElement>("[data-token-placeholder]").hidden = Boolean(image);
  required<HTMLElement>("[data-preview-image-frame]").classList.toggle("has-image", Boolean(image));
  const thumbnail = required<HTMLImageElement>("[data-upload-thumbnail]");
  thumbnail.hidden = !image;
  if (image) thumbnail.src = image; else thumbnail.removeAttribute("src");
  required<HTMLElement>("[data-upload-icon]").hidden = Boolean(image);
  required<HTMLElement>("[data-upload-action]").hidden = !image;
  text("[data-upload-title]", image && file ? file.name : "Choose an image");
  text("[data-upload-info]", image && file && dimensions
    ? `${file.type.replace("image/", "").toUpperCase()} · ${file.size >= 1048576 ? (file.size / 1048576).toFixed(2) + " MB" : Math.max(1, Math.round(file.size / 1024)) + " KB"} · ${dimensions.width} × ${dimensions.height} px`
    : "PNG, JPG or WebP · up to 2 MB");
  text("[data-image-status]", image ? "Image ready." : "");
}

function showLatestListing(): void {
 const host=query<HTMLElement>("[data-listing-package]");
 if(host&&latestListing){
  renderListingPanel(host,latestListing.snapshot,latestListing.marketId,robinhoodChain.blockExplorers.default.url,robinhoodChain.testnet,import.meta.env.VITE_IPFS_GATEWAY);
  const layout=query<HTMLElement>(".create-layout");if(layout)layout.hidden=true;
  const again=document.createElement('button');again.type='button';again.textContent='Create another token';host.append(again);
  again.onclick=()=>{latestListing=null;try{localStorage.removeItem(`tg-listing:${robinhoodChain.id}`);}catch{}host.hidden=true;if(layout)layout.hidden=false;};
 }
}
let pendingCreateDraft: CreateDraft | null = null;
let draftImageMissing = false;
function applyCreateDraft(configReady: boolean): void {
  if (!pendingCreateDraft) return;
  const form = query<HTMLFormElement>('[data-create-form]'); if (!form) return;
  const unavailable: string[] = [];
  for (const [key,value] of Object.entries(pendingCreateDraft)) {
    if (['tickerGardenBaselineId', 'launchTemplateId', 'launchMode'].includes(key)) continue;
    const field = form.elements.namedItem(key);
    if (field instanceof HTMLSelectElement) { if (configReady && typeof value === 'string') {
      if (value && !Array.from(field.options).some(option => option.value === value)) {
        unavailable.push(key);
      } else field.value = value;
    } }
    else if (field instanceof HTMLInputElement && field.type === 'checkbox' && typeof value === 'boolean') field.checked = value;
    else if ((field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) && typeof value === 'string') field.value = value;
  }
  if (configReady) {
    pendingCreateDraft = null;
    const paired = query<HTMLSelectElement>('[name=quoteAssetConfigId]'); if (paired) populatePairedAssets();
    const stock = query<HTMLSelectElement>('[name=assetUid]');
    for (const name of unavailable) {
      const field = form.elements.namedItem(name);
      if (field instanceof HTMLSelectElement) {
        const option = new Option('Previous asset unavailable — choose again', '');
        field.prepend(option); field.value = '';
        field.setCustomValidity('Your previous asset is no longer available. Choose an active asset.');
      }
    }
    if (unavailable.length) text('[data-create-draft-status]', 'Draft restored. A previous asset is unavailable; choose an active asset again.');
    if (stock && foundation) updateQuotePicker(stock, foundation.assets.filter(a=>a.status===1).map(a=>({value:a.id,symbol:String(a.values.tokenSymbol??'STOCK'),name:String(a.values.tokenName??'Stock'),pending:false})));
  }
}
function saveCurrentCreateDraft(): void {
  const form = query<HTMLFormElement>('[data-create-form]'); if (!form || launchSubmitting) return;
  const values: Record<string,string|boolean> = {};
  for (const field of Array.from(form.elements)) {
    if (field instanceof HTMLInputElement && field.type === 'checkbox') values[field.name] = field.checked;
    else if ((field instanceof HTMLInputElement && field.type !== 'file') || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement) values[field.name] = field.value;
  }
  const saved = writeCreateDraft(localStorage, robinhoodChain.id, {...values,hadImage:draftImageMissing || !!launchImage || !!query<HTMLInputElement>('[name=tokenImage]')?.files?.length});
  text('[data-create-draft-status]', saved ? 'Draft saved on this device. Images need to be selected again after a refresh.' : 'Draft could not be saved in this browser. Keep this page open until you finish.');
}

function setupCreate(): void {
 if(!latestListing){try{latestListing=parseSavedListing(localStorage.getItem(`tg-listing:${robinhoodChain.id}`),robinhoodChain.id);}catch{/* Browser storage may be disabled. */}}
 showLatestListing();
  const form = query<HTMLFormElement>("[data-create-form]");
  if (!form) return;
  pendingCreateDraft = readCreateDraft(localStorage, robinhoodChain.id);
  draftImageMissing = pendingCreateDraft?.hadImage === true;
  const draftNote = document.createElement('p'); draftNote.dataset.createDraftStatus = ''; draftNote.setAttribute('role', 'status');
  draftNote.textContent = pendingCreateDraft ? `Draft restored.${pendingCreateDraft.hadImage ? ' Please choose your image again.' : ''}` : 'Your form is saved on this device as you edit.';
  form.prepend(draftNote);
  const clearDraft = document.createElement('button'); clearDraft.type = 'button'; clearDraft.textContent = 'Clear draft'; clearDraft.dataset.clearCreateDraft = '';
  clearDraft.onclick = async () => {
    if (launchSubmitting || launchProgress || !await confirmFlowAction('Clear this form and start a new draft?')) return;
    clearCreateDraft(localStorage, robinhoodChain.id); pendingCreateDraft = null; draftImageMissing = false;
    form.reset();
    for (const field of Array.from(form.elements)) if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement) field.setCustomValidity('');
    const skip = query<HTMLButtonElement>('[data-skip-draft-image]'); if (skip) skip.hidden = true;
    ++launchImageGeneration; launchImage = undefined; launchImageReading = false; renderSelectedTokenImage();
    preparedMetadataURI = ''; preparedMetadataKey = ''; renderCreateConfig(); text('[data-create-draft-status]', 'Draft cleared.');
  };
  draftNote.insertAdjacentElement('afterend', clearDraft);
  const skipImage = document.createElement('button'); skipImage.type = 'button'; skipImage.textContent = 'Continue without the previous image'; skipImage.hidden = !draftImageMissing; skipImage.dataset.skipDraftImage = '';
  skipImage.onclick = () => { draftImageMissing = false; skipImage.hidden = true; saveCurrentCreateDraft(); updateCreateAvailability(); };
  clearDraft.insertAdjacentElement('afterend', skipImage);
  applyCreateDraft(false);
  form.addEventListener('input', saveCurrentCreateDraft);
  form.addEventListener('change', saveCurrentCreateDraft);
  query<HTMLInputElement>("[name=firstBuyAmount]", form)?.addEventListener("focus", renderDeveloperBuyBalance);
  form.addEventListener("input", () => {
    updateLaunchMode();
    const symbol = query<HTMLInputElement>("[name=symbol]", form);
    if (symbol) symbol.value = symbol.value.toUpperCase();
    renderCreateIdentity();
    scheduleLaunchPreview();
  });
  query<HTMLInputElement>("[name=tokenImage]", form)?.addEventListener("change", async (event) => {
    const input = event.currentTarget as HTMLInputElement;
    const generation = ++launchImageGeneration;
    launchImageReading = true;
    updateCreateAvailability();
    input.setCustomValidity("");
    launchImage = undefined;
    renderSelectedTokenImage();
    text("[data-image-status]", "Reading image…");
    try {
      const file = input.files?.[0];
      const image = await readTokenImage(file);
      let dimensions: { width: number; height: number } | undefined;
      if (image) {
        const decoded = new Image();
        decoded.src = image;
        await decoded.decode();
        dimensions = { width: decoded.naturalWidth, height: decoded.naturalHeight };
      }
      if (generation !== launchImageGeneration) return;
      launchImage = image;
      draftImageMissing = false; const skip = query<HTMLButtonElement>("[data-skip-draft-image]"); if (skip) skip.hidden = true; saveCurrentCreateDraft();
      renderSelectedTokenImage(image, file, dimensions);
    } catch (error) { if (generation === launchImageGeneration) { input.setCustomValidity(errorText(error)); text("[data-image-status]", errorText(error)); } }
    if (generation !== launchImageGeneration) return;
    launchImageReading = false;
    scheduleLaunchPreview();
  });
  form.addEventListener("change", (event) => {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    if ((target.name === "quoteAssetConfigId" || target.name === "assetUid") && target.value) target.setCustomValidity("");
    if (target.name === "quoteAssetConfigId") alignBaselineToQuote();
    updateLaunchMode();
    renderCreateIdentity();
    scheduleLaunchPreview();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void runPageAction(submitLaunch);
  });
  updateLaunchMode();
  renderCreateIdentity();
}

function populatePairedAssets(): void {
  const select = query<HTMLSelectElement>("[name=quoteAssetConfigId]");
  if (!select) return;
  const previous = releasePairForSelection(select.value, foundation?.quotes ?? []);
  const priorValue = select.value;
  const pickerOptions: QuotePickerOption[] = [];
  select.replaceChildren();
  for (const asset of RELEASE_PAIRED_ASSETS) {
    const config = activePairedConfig(asset, foundation?.quotes ?? [], robinhoodChain.id);
    const option = new Option(`${asset.symbol} — ${asset.name}${config ? "" : " · Pending activation"}`, config?.id ?? `pending:${asset.symbol}`);
    select.add(option);
    pickerOptions.push({ value: option.value, symbol: asset.symbol, name: asset.name, pending: !config });
    if (previous?.symbol === asset.symbol || priorValue === option.value) select.value = option.value;
  }
  updateQuotePicker(select, pickerOptions);
}

function renderCreateConfig(): void {
  const form = query<HTMLFormElement>("[data-create-form]");
  if (!form) return;
  populatePairedAssets();
  if (foundation?.direct && foundation.assets.length===0) {const stock=query<HTMLInputElement>("[name=stakingEnabled]",form);if(stock){stock.checked=false;stock.disabled=true;}}
  if (!foundation) {
    const stockSelect = required<HTMLSelectElement>("[name=assetUid]", form);
    stockSelect.replaceChildren(new Option("Staking assets unavailable", ""));
    updateQuotePicker(stockSelect, []);
    renderCreateIdentity();
    text("[data-create-config-status]", "Launch unavailable. Asset preview only.");
    updateCreateAvailability();
    return;
  }
  const stockSelect = required<HTMLSelectElement>("[name=assetUid]", form);
  const activeStocks = foundation.assets.filter((item) => item.status === 1);
  populateSelect(stockSelect, activeStocks, "No eligible staking assets");
  updateQuotePicker(stockSelect, activeStocks.map((stock) => ({
    value: stock.id,
    symbol: typeof stock.values.tokenSymbol === "string" ? stock.values.tokenSymbol : configLabel(stock).split(" · ")[0]!,
    name: typeof stock.values.tokenName === "string" ? stock.values.tokenName : "STOCK",
    pending: false,
  })));
  populateSelect(required<HTMLSelectElement>("[name=tickerGardenBaselineId]", form), foundation.baseline.filter((item) => item.status === 1), "Select an active TickerGarden baseline");
  populateSelect(required<HTMLSelectElement>("[name=launchTemplateId]", form), foundation.templates.filter((item) => item.status === 1), "Select an active launch template");
  applyCreateDraft(true);
  alignBaselineToQuote();
  text("[data-create-config-status]", foundation.writeReady
    ? "Launch settings ready."
    : "Preview only. Launch is not available yet.");
  updateLaunchMode();
  renderCreateIdentity();
  scheduleLaunchPreview();
}

function alignBaselineToQuote(): void {
  if (!foundation) return;
  const quoteId = query<HTMLSelectElement>("[name=quoteAssetConfigId]")?.value;
  const baselineSelect = query<HTMLSelectElement>("[name=tickerGardenBaselineId]");
  const quote = foundation.quotes.find((item) => item.id === quoteId);
  if (!quote || !baselineSelect) return;
  try {
    const baselineId = configString(quote, "tickerGardenBaselineId").toLowerCase();
    if ([...baselineSelect.options].some((option) => option.value === baselineId)) baselineSelect.value = baselineId;
  } catch { /* The launch validator reports the missing field. */ }
}

function updateLaunchMode(): void {
  const amount = query<HTMLInputElement>("[name=firstBuyAmount]");
  let mode: "create" | "create-buy" = "create";
  try { mode = developerBuyMode(amount?.value ?? ""); amount?.setCustomValidity(""); }
  catch (error) { amount?.setCustomValidity(errorText(error)); }
  const select = query<HTMLSelectElement>("[name=launchMode]");
  if (select) select.value = mode;
  const tax = query<HTMLInputElement>("[name=creatorTax]");
  if (tax) {
    try { const bps = creatorTaxBps(tax.value); assertCreatorTaxSupported(bps); tax.setCustomValidity(""); }
    catch(error) { tax.setCustomValidity(errorText(error)); }
  }
}

function renderCreateIdentity(): void {
  renderDeveloperBuyBalance();
  const details = launchDetails();
  text("[data-preview-creator-tax]", `${formatTokenAmount(BigInt(details.creatorTaxBps), 2)}%`);
  text("[data-preview-treasury]", details.creatorFeesToHolders ? "50% of creator base fees" : "Off");
  text("[data-treasury-option-status]", "Share 50% of your base fee earnings. Fixed at launch; creator tax stays yours.");
  const treasuryDetails = query<HTMLElement>("#treasury-details");
  if (treasuryDetails) treasuryDetails.hidden = !details.creatorFeesToHolders;
  text("[data-token-name]", details.name || "Your next big idea");
  text("[data-token-symbol]", details.symbol || "ticker");
  text("[data-token-description]", details.description);
  const stakingEnabled = query<HTMLInputElement>("[name=stakingEnabled]")?.checked ?? true;
  const stockSelect = query<HTMLSelectElement>("[name=assetUid]");
  if (stockSelect) { stockSelect.required = stakingEnabled; stockSelect.disabled = !stakingEnabled; }
  const stockField = query<HTMLElement>("[data-staking-stock-field]");
  if (stockField) stockField.hidden = !stakingEnabled;
  const feeTable = query<HTMLElement>("[data-fee-current-table]");
  const feeSettings = `${details.creatorFeesToHolders}:${stakingEnabled}`;
  if (feeTable && feeTable.dataset.settings !== feeSettings) {
    feeTable.innerHTML = feePreviewTable(details.creatorFeesToHolders, stakingEnabled);
    feeTable.dataset.settings = feeSettings;
  }
  try {
    const tax = creatorTaxBps(query<HTMLInputElement>("[name=creatorTax]")?.value ?? "0");
    assertCreatorTaxSupported(tax);
    text("[data-fee-tax]", `${formatTokenAmount(BigInt(tax), 2)}%`);
  } catch { text("[data-fee-tax]", "Invalid rate"); }
  text("[data-fee-staking-note]", stakingEnabled
    ? "Staker fees start once the market is Bloomed and a stake is active."
    : "Staking is off. Your fee split stays the same once the market is Bloomed.");
  text("[data-preview-asset]", !stakingEnabled ? "Not enabled" : stockSelect?.value ? stockSelect.selectedOptions[0]?.textContent?.split(" · ")[0] ?? "—" : "—");
  const selection = query<HTMLSelectElement>("[name=quoteAssetConfigId]")?.value ?? "";
  const quote = foundation?.quotes.find(item => item.id === selection);
  const releaseAsset = releasePairForSelection(selection, foundation?.quotes ?? []);
  displayPriceWidget?.setToken(typeof quote?.values.quoteAsset === "string" ? quote.values.quoteAsset : null);
  text("[data-preview-launch-fee]", foundation?.launchFee === undefined ? "—" : `${formatTokenAmount(foundation.launchFee, 18)} ETH`);
  text("[data-preview-trade-fee]", "—");
  text("[data-preview-graduation]", "—");
  text("[data-graduation-caption]", "Loading bloom target…");
  text("[data-graduation-exact]", "");
  const symbol = releaseAsset?.symbol ?? "—";
  text("[data-preview-quote]", symbol);
  text("[data-buy-symbol]", symbol);
  const amount = query<HTMLInputElement>("[name=firstBuyAmount]")?.value.trim() ?? "";
  text("[data-preview-mode]", query<HTMLSelectElement>("[name=launchMode]")?.value === "create-buy" ? `${amount} ${symbol}` : "None");
  if (!quote) {
    if (releaseAsset) {
      const amount = graduationAmount(BigInt(releaseAsset.graduationThreshold), releaseAsset.decimals);
      const economics = graduationEconomics(RELEASE_SUPPLY, BigInt(releaseAsset.phantomQuote), BigInt(releaseAsset.graduationThreshold));
      text("[data-graduation-caption]", `Bloom target: ${amount.display} ${symbol}`);
      text("[data-preview-graduation]", `${amount.display} ${symbol}`);
      text("[data-graduation-exact]", `Release target · observed ${RELEASE_OBSERVED_AT.slice(0, 10)}. Pending activation on this network. Exact curve minimum: ${graduationAmount(economics.requiredNet, releaseAsset.decimals).exact} ${symbol}.`);
    }
    return;
  }
  try {
    const baseline = foundation?.baseline.find(item => item.id === configString(quote, "tickerGardenBaselineId"));
    if (!baseline) throw new Error("Launch economics are unavailable");
    const decimals = configNumber(quote, "quoteDecimals");
    const threshold = configBigInt(quote, "graduationThreshold");
    const result = graduationEconomics(configBigInt(baseline, "supply"), configBigInt(quote, "phantomQuote"), threshold);
    const formatted = graduationAmount(threshold, decimals);
    text("[data-graduation-caption]", `Bloom target: ${formatted.display} ${symbol}`);
    text("[data-preview-graduation]", `${formatted.display} ${symbol}`);
    text("[data-graduation-exact]", `Exact minimum after curve rounding: ${graduationAmount(result.requiredNet, decimals).exact} ${symbol}.`);
    const feeBps = configBigInt(baseline, "curveFeeBps");
    text("[data-preview-trade-fee]", `${formatTokenAmount(feeBps, 2)}% base`);
    text("[data-creator-fee-note]", `Base trading fee: ${formatTokenAmount(feeBps, 2)}%. Extra fees may apply to buys in the first 5 seconds; your developer buy is exempt.`);
  } catch { text("[data-graduation-caption]", "Bloom target unavailable."); }
}

function selectedLaunchConfig(allowPendingMetadata = false): SelectedLaunchConfig {
  if (!foundation || !wallet) throw new Error("Connect a wallet and load the V1 registries");
  const form = required<HTMLFormElement>("[data-create-form]");
  const stakingEnabled = required<HTMLInputElement>("[name=stakingEnabled]", form).checked;
  const assetUid = required<HTMLSelectElement>("[name=assetUid]", form).value;
  const quoteId = required<HTMLSelectElement>("[name=quoteAssetConfigId]", form).value;
  const baselineId = required<HTMLSelectElement>("[name=tickerGardenBaselineId]", form).value;
  const templateId = required<HTMLSelectElement>("[name=launchTemplateId]", form).value;
  const asset = foundation.assets.find((item) => item.id === assetUid);
  const quote = foundation.quotes.find((item) => item.id === quoteId);
  const baseline = foundation.baseline.find((item) => item.id === baselineId);
  const template = foundation.templates.find((item) => item.id === templateId);
  if ((stakingEnabled && !asset) || !quote || !baseline || !template) throw new Error("Selected launch settings are not active yet");
  const releasedPair = releasePairForSelection(quoteId, foundation.quotes);
  if (!releasedPair || activePairedConfig(releasedPair, [quote], robinhoodChain.id)?.id !== quoteId) throw new Error("Paired asset does not match the release whitelist on this network");
  const beneficiary = canonicalAddress(required<HTMLInputElement>("[name=beneficiary]", form).value.trim() || wallet.account, "Creator beneficiary");
  const name = required<HTMLInputElement>("[name=name]", form).value.trim();
  const symbol = required<HTMLInputElement>("[name=symbol]", form).value.trim();
  assertCreatorTaxSupported(creatorTaxBps(required<HTMLInputElement>("[name=creatorTax]", form).value));
  const metadataURI = currentMetadataURI() || (allowPendingMetadata ? "ipfs://pending-launch-preview" : "");
  if (!name || name.length > 64) throw new Error("Meme name must contain 1–64 characters");
  if (!/^[A-Z0-9]{1,16}$/.test(symbol)) throw new Error("Symbol must contain 1–16 uppercase letters or digits");
  if (!metadataURI) throw new Error("Token details will be saved when you launch");
  return Object.freeze({
    stakingEnabled,
    asset: stakingEnabled && asset ? { assetUid: asset.id, status: asset.status } : undefined,
    quote: {
      configId: quote.id,
      economicsHash: canonicalBytes32(configString(quote, "economicsHash"), "Quote economicsHash"),
      quoteAsset: canonicalAddress(configString(quote, "quoteAsset"), "Quote asset", true),
      tickerGardenBaselineId: canonicalBytes32(configString(quote, "tickerGardenBaselineId"), "Quote TickerGarden baseline"),
      status: quote.status,
    },
    baseline: { baselineId: baseline.id, status: baseline.status },
    template: { templateId: template.id, status: template.status },
    creatorRevenueBeneficiary: beneficiary,
    name,
    symbol,
    metadataURI,
    salt: launchSalt,
    creatorTaxBps: creatorTaxBps(required<HTMLInputElement>("[name=creatorTax]", form).value),
    creatorFeesToHolders: query<HTMLInputElement>("[name=treasuryEnabled]", form)?.checked ?? false,
  });
}

async function previewLaunch(walletContext?: WalletState, allowPendingMetadata = false): Promise<LaunchPreview> {
  const activeWallet = walletContext ?? wallet;
  if (!foundation?.writeReady || !runtimeConfig.contracts.available || !activeWallet || wallet !== activeWallet) throw new Error(runtimeReasons().join("; ") || "Connect a wallet first");
  await verifyLiveWalletContext(activeWallet);
  const selected = selectedLaunchConfig(allowPendingMetadata);
  await ensureCurrentRevision(foundation.sync.revision);
  await ensureCanonicalLaunch(selected);
  const draft = deriveCreateMarketParams(selected);
  const expectedEconomics = await publicClient.readContract({
    abi: v1Abis.TickerGardenFactoryV1,
    address: runtimeConfig.contracts.value.factoryAddress,
    functionName: "previewMarketEconomics",
    args: [draft],
    account: activeWallet.account,
  });
  const params = Object.freeze({ ...draft, expectedEconomics: canonicalBytes32(expectedEconomics, "Expected economics") });
  const predicted = await publicClient.readContract({
    abi: v1Abis.TickerGardenFactoryV1,
    address: runtimeConfig.contracts.value.factoryAddress,
    functionName: "predictMarketAddresses",
    args: [activeWallet.account, params],
    account: activeWallet.account,
  });
  await verifyLiveWalletContext(activeWallet);
  return Object.freeze({
    creator: activeWallet.account,
    selected,
    params,
    marketId: canonicalBytes32(predicted[0], "Predicted marketId"),
    memeToken: canonicalAddress(predicted[1], "Predicted Meme token"),
    curve: canonicalAddress(predicted[2], "Predicted Curve"),
    gauge: canonicalAddress(predicted[3], "Predicted Gauge", !params.stakingEnabled),
    launchLocker: canonicalAddress(predicted[4], "Predicted LaunchLocker"),
  });
}

function scheduleLaunchPreview(): void {
  window.clearTimeout(launchPreviewTimer);
  const generation = ++launchPreviewGeneration;
  launchPreview = null;
  launchFunding = null;
  updateCreateAvailability();
  launchPreviewTimer = window.setTimeout(() => { void refreshLaunchPreview(generation); }, 350);
}

async function refreshLaunchPreview(generation: number): Promise<void> {
  try {
    const preview = await previewLaunch(undefined, true);
    const funding = await calculateLaunchFunding(preview);
    if (generation !== launchPreviewGeneration) return;
    launchPreview = preview;
    launchFunding = funding;
    renderLaunchFunding(funding);
    text("[data-create-preview]", `Ready to launch ${preview.selected.symbol}. The payment route was selected automatically from your live balances.`);
    renderCreateIdentity();
    updateCreateAvailability();
  } catch (error) {
    if (generation !== launchPreviewGeneration) return;
    launchPreview = null;
    launchFunding = null;
    const panel = query<HTMLElement>("[data-launch-funding]");
    if (panel) panel.hidden = true;
    text("[data-create-preview]", !wallet ? "Connect a wallet to launch your token." : `Preview unavailable — ${errorText(error)}`);
    updateCreateAvailability();
  }
}

function updateCreateAvailability(): void {
  const button = query<HTMLButtonElement>("[data-create-submit]");
  const form = query<HTMLFormElement>("[data-create-form]");
  if (!button || !form) return;
  const buyMode = query<HTMLSelectElement>("[name=launchMode]")?.value === "create-buy";
  const invalid = [...form.elements].find((e): e is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
    (e instanceof HTMLInputElement || e instanceof HTMLSelectElement || e instanceof HTMLTextAreaElement) && !e.disabled && !e.validity.valid);
  const labels: Record<string,string> = {name:"Name",symbol:"Ticker",assetUid:"Staking asset",quoteAssetConfigId:"Paired asset",website:"Website",x:"X profile",firstBuyAmount:"Developer buy",creatorTax:"Creator tax",beneficiary:"Creator beneficiary",tickerGardenBaselineId:"Market pricing",launchTemplateId:"Launch settings",tokenImage:"Token image"};
  const reason = draftImageMissing ? "Choose your previous image again, or continue without it above." : createDisabledReason({submitting:launchSubmitting||Boolean(launchProgress&&launchProgress.phase!=="complete"),imageReading:launchImageReading,
    runtimeReady:Boolean(foundation?.writeReady),runtimeReason:runtimeReasons().join("; "),walletConnected:Boolean(wallet),busy:Boolean(busyOperation||walletConnecting||hasPendingTransaction()),
    pendingQuote:query<HTMLSelectElement>("[name=quoteAssetConfigId]")?.value.startsWith("pending:")===true,
    invalidField:invalid ? labels[invalid.name] ?? invalid.name : undefined,metadataReady:Boolean(launchMetadataOrigin),buyMode,
    fundingReady:Boolean(launchFunding),insufficientEth:Boolean(launchFunding&&launchFunding.ethBalance<launchFunding.totalRequired)});
  setDisabled(button, Boolean(reason));
  const clear = query<HTMLButtonElement>("[data-clear-create-draft]"); if (clear) clear.disabled = launchSubmitting || !!launchProgress;
  let hint = query<HTMLElement>("[data-create-blocker]",form);
  if(!hint){hint=document.createElement("p");hint.dataset.createBlocker="";hint.id="create-blocker";hint.setAttribute("role","status");button.insertAdjacentElement("afterend",hint);}
  hint.textContent=reason??"";hint.hidden=!reason;
  if(reason)button.setAttribute("aria-describedby",hint.id);else button.removeAttribute("aria-describedby");
}

// RH public replay: 8m fails while 16m succeeds for the complete atomic launch.
const CONSERVATIVE_LAUNCH_GAS = robinhoodChain.id === 46630 ? 16_000_000n : 3_000_000n;

async function calculateLaunchFunding(preview: LaunchPreview): Promise<LaunchFunding & Readonly<{ gasCost: bigint; totalRequired: bigint; quoteDecimals: number }>> {
  if (!foundation?.bindings || foundation.launchFee === undefined) throw new Error("Launch funding bindings are unavailable");
  const decimals = await quoteDecimalsFor(preview.selected);
  const amountText = query<HTMLInputElement>("[name=firstBuyAmount]")?.value.trim() ?? "";
  const quoteAmount = developerBuyMode(amountText) === "create-buy" ? parseTokenAmount(amountText, decimals, "First buy amount") : 0n;
  const releaseAsset = releasePairForSelection(preview.selected.quote.configId, foundation.quotes);
  const quoter = canonicalAddress(await publicClient.readContract({ abi: v1Abis.MarketRegistryV1, address: foundation.bindings.marketRegistry, functionName: "quoter" }), "V4 Quoter");
  if (preview.selected.quote.quoteAsset !== ZERO_ADDRESS && quoteAmount > 0n && (!releaseAsset?.nativeQuotePoolFee || !releaseAsset.nativeQuoteTickSpacing) ) {
    const quoteBalance = await publicClient.readContract({ abi: erc20Abi, address: preview.selected.quote.quoteAsset, functionName: "balanceOf", args: [preview.creator] });
    if (quoteBalance < quoteAmount) throw new Error(`${releaseAsset?.symbol ?? "This Quote"} has no approved direct ETH route on this network`);
  }
  const funding = await resolveLaunchFunding({
    client: publicClient as never,
    account: preview.creator,
    quoteAsset: preview.selected.quote.quoteAsset,
    quoteAmount,
    quoter,
    poolFee: releaseAsset?.nativeQuotePoolFee ?? 10_000,
    tickSpacing: releaseAsset?.nativeQuoteTickSpacing ?? 200,
  });
  if (funding.mode === "native-fallback") {
    const routerManager = await publicClient.readContract({ address: foundation.bindings.launchRouter, abi: v1Abis.LaunchAndBuyRouter, functionName: "poolManager" });
    const quoterManager = await publicClient.readContract({ address: quoter, abi: [{ type: "function", name: "poolManager", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }], functionName: "poolManager" });
    if (routerManager.toLowerCase() !== quoterManager.toLowerCase() || routerManager === ZERO_ADDRESS) throw new Error("Native first-buy router and quoter bindings do not match");
  }
  const fees = await publicClient.estimateFeesPerGas();
  const feePerGas = fees.maxFeePerGas ?? fees.gasPrice;
  if (feePerGas === undefined) throw new Error("Network gas price is unavailable");
  const gasCost = CONSERVATIVE_LAUNCH_GAS * feePerGas;
  const transactionValue = foundation.launchFee + (funding.mode === "native" ? quoteAmount : funding.maxNativeQuoteInput ?? 0n);
  return Object.freeze({ ...funding, gasCost, totalRequired: transactionValue + gasCost, quoteDecimals: decimals });
}

function renderLaunchFunding(funding: LaunchFunding & Readonly<{ gasCost: bigint; totalRequired: bigint; quoteDecimals: number }>): void {
  const panel = query<HTMLElement>("[data-launch-funding]");
  if (panel) panel.hidden = false;
  const symbol = releasePairForSelection(query<HTMLSelectElement>("[name=quoteAssetConfigId]")?.value ?? "", foundation?.quotes ?? [])?.symbol ?? "Quote";
  text("[data-funding-route]", funding.mode === "native-fallback" ? `Automatic ETH → ${symbol}` : funding.mode === "quote" ? `Wallet ${symbol}` : "ETH");
  text("[data-funding-quote-balance]", funding.mode === "native" ? "Native asset" : `${formatTokenAmount(funding.quoteBalance, funding.quoteDecimals)} ${symbol}`);
  text("[data-funding-swap]", funding.mode === "native-fallback" ? `${formatTokenAmount(funding.maxNativeQuoteInput ?? 0n, 18)} ETH max` : funding.mode === "native" ? `${formatTokenAmount(funding.quotedNativeInput, 18)} ETH` : "0 ETH");
  text("[data-funding-gas]", `${formatTokenAmount(funding.gasCost, 18)} ETH allowance`);
  text("[data-funding-total]", `${formatTokenAmount(funding.totalRequired, 18)} ETH`);
  text("[data-funding-balance]", `${formatTokenAmount(funding.ethBalance, 18)} ETH`);
  text("[data-funding-status]", funding.ethBalance >= funding.totalRequired ? "Balance sufficient. Amounts rechecked before signing." : `Insufficient ETH. Add at least ${formatTokenAmount(funding.totalRequired - funding.ethBalance, 18)} ETH.`);
}

async function quoteDecimalsFor(selected: SelectedLaunchConfig): Promise<number> {
  if (selected.quote.quoteAsset === ZERO_ADDRESS) return 18;
  const result = await publicClient.readContract({ abi: erc20Abi, address: selected.quote.quoteAsset, functionName: "decimals" });
  if (result < 6 || result > 18) throw new Error("Quote decimals are outside the approved 6–18 range");
  return result;
}

function simulationTuple(result: unknown, index: number, label: string): bigint {
  if (!Array.isArray(result) || typeof result[index] !== "bigint") throw new Error(`Launch simulation did not return ${label}`);
  return result[index] as bigint;
}

async function ensureStandaloneApproval(
  approval: ContractWriteRequest,
  token: Address,
  spender: Address,
  amount: bigint,
  sync: SyncStatus,
  verifyChain: () => Promise<unknown>,
  activeWallet: WalletState,
): Promise<void> {
  if (wallet !== activeWallet) throw new Error("Wallet changed before approval");
  const requiredApproval = await allowanceApproval(approval, token, spender, amount, activeWallet.account);
  if (!requiredApproval) return;
  if(launchSubmitting)updateLaunchProgress("approval","Approve the paired asset in your wallet. This is not the token launch.");
  await executeTransaction({
    operationKey: `approval:${token}:${spender}:${amount}:${sync.revision}`,
    sync,
    request: requiredApproval,
    walletContext: activeWallet,
    verifyChain,
    confirm: async (receipt) => {
      const allowance = await publicClient.readContract({ abi: erc20Abi, address: token, functionName: "allowance", args: [activeWallet.account, spender], blockNumber: receipt.blockNumber });
      if (allowance < amount) throw new Error("Fresh allowance is below the requested amount");
      if(launchSubmitting)updateLaunchProgress("approval","Asset approved. Preparing the launch transaction…");
      return allowance;
    },
  });
}

async function submitLaunch(): Promise<void> {
 if(!navigator.locks)throw Error("This browser cannot protect against duplicate launches. Use an up-to-date browser.");
 await navigator.locks.request(`tg-launch:${robinhoodChain.id}`,{ifAvailable:true},async lock=>{
  if(!lock){void restoreLaunchProgress();return;}
  if(readLaunchState(localStorage,robinhoodChain.id)){void restoreLaunchProgress();return;}
  await performLaunch();
 });
}
async function performLaunch(): Promise<void> {
  if (launchSubmitting) return;
  launchSubmitting = true;
  updateCreateAvailability();
  const form = required<HTMLFormElement>("[data-create-form]");
  const fields = [...form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea")];
  const disabledBefore = fields.map(field => field.disabled);
  try {
    if (!required<HTMLFormElement>("[data-create-form]").reportValidity()) return;
    if (!foundation?.writeReady || !runtimeConfig.contracts.available || !wallet || foundation.launchFee === undefined) {
      throw new Error(runtimeReasons().join("; ") || "Connect a wallet first");
    }
    if (launchImageReading) throw new Error("Wait for the image to finish loading");
    launchProgress={version:1,id:crypto.randomUUID(),chainId:robinhoodChain.id,account:wallet.account,phase:'publishing',detail:'Publishing your token details and image. Keep this page open.'};
    saveLaunchState(localStorage,launchProgress);
    drawLaunchProgress();
    fields.forEach(field => { field.disabled = true; });
    const activeWallet = wallet;
    const contracts = runtimeConfig.contracts.value;
    await prepareLaunchMetadata();
    if (wallet !== activeWallet) throw new Error("Wallet changed while saving token details");
    updateLaunchProgress("preparing","Checking the launch settings and preparing your transaction.");
    const submittedDetails = launchDetails();
    const submittedMetadata = preparedMetadata;
    const preview = await previewLaunch(activeWallet);
    launchPreview = preview;
    const propsForProgress=submittedMetadata?.properties as Record<string,unknown>|undefined;
    launchProgress!.expected={factory:contracts.factoryAddress,marketId:preview.marketId,token:preview.memeToken,curve:preview.curve,gauge:preview.gauge};
    launchProgress!.listing={chainId:robinhoodChain.id,chainName:robinhoodChain.name,tokenAddress:preview.memeToken,name:submittedDetails.name,symbol:submittedDetails.symbol,
      logo:typeof submittedMetadata?.image==='string'?submittedMetadata.image:'',website:typeof propsForProgress?.website==='string'?propsForProgress.website:submittedDetails.website,
      x:typeof propsForProgress?.x==='string'?propsForProgress.x:submittedDetails.x,metadataURI:preview.params.metadataURI,txHash:''};
    saveLaunchState(localStorage,launchProgress!);
    const verifyChain = () => ensureCanonicalLaunch(preview.selected);
    const previewEconomics = async () => preview.params.expectedEconomics;
    const mode = required<HTMLSelectElement>("[name=launchMode]").value;
    let request: ContractWriteRequest;
    let expectedSpent: bigint | null = null;
    let expectedMinimum: bigint | null = null;
    let requestedQuote: bigint | null = null;
    if (mode === "create") {
      const built = await buildCreateMarketRequest({
        factory: contracts.factoryAddress,
        launchFee: foundation.launchFee,
        config: preview.selected,
        previewMarketEconomics: previewEconomics,
      });
      request = built.request;
    } else {
      const decimals = await quoteDecimalsFor(preview.selected);
      const quoteIn = parseTokenAmount(required<HTMLInputElement>("[name=firstBuyAmount]").value, decimals, "First buy amount");
      requestedQuote = quoteIn;
      const slippageBps = DEVELOPER_BUY_SLIPPAGE_BPS;
      const freshFunding = await calculateLaunchFunding(preview);
      launchFunding = freshFunding;
      renderLaunchFunding(freshFunding);
      if (freshFunding.ethBalance < freshFunding.totalRequired) throw new Error("ETH balance is below the estimated total required");
      const probe = await buildLaunchAndBuyRequests({
        router: foundation.bindings!.launchRouter,
        launchFee: foundation.launchFee,
        quoteIn,
        minTokensOut: 1n,
        recipient: preview.creator,
        config: preview.selected,
        previewMarketEconomics: previewEconomics,
        maxNativeQuoteInput: freshFunding.mode === "native-fallback" ? freshFunding.maxNativeQuoteInput : undefined,
      });
      if (probe.approval) {
        await ensureStandaloneApproval(probe.approval, preview.selected.quote.quoteAsset, foundation.bindings!.launchRouter, quoteIn, foundation.sync, verifyChain, activeWallet);
      }
      await ensureCurrentRevision(foundation.sync.revision);
      await verifyChain();
      await verifyLiveWalletContext(activeWallet);
      const simulated = await publicClient.simulateContract({ ...probe.request, account: preview.creator } as never) as { result: unknown };
      const tokensOut = simulationTuple(simulated.result, 2, "first-buy output");
      const refund = simulationTuple(simulated.result, 3, "first-buy refund");
      if (tokensOut <= 0n || refund > (freshFunding.mode === "native-fallback" ? freshFunding.maxNativeQuoteInput! : quoteIn)) throw new Error("Launch simulation returned an invalid first-buy result");
      expectedSpent = freshFunding.mode === "native-fallback" ? null : quoteIn - refund;
      expectedMinimum = minimumAfterSlippage(tokensOut, slippageBps);
      const built = await buildLaunchAndBuyRequests({
        router: foundation.bindings!.launchRouter,
        launchFee: foundation.launchFee,
        quoteIn,
        minTokensOut: expectedMinimum,
        recipient: preview.creator,
        config: preview.selected,
        previewMarketEconomics: previewEconomics,
        maxNativeQuoteInput: freshFunding.mode === "native-fallback" ? freshFunding.maxNativeQuoteInput : undefined,
      });
      request = built.request;
    }
    const estimatedLaunchGas = await publicClient.estimateContractGas({ ...request, account: preview.creator } as never);
    const paddedLaunchGas = (estimatedLaunchGas * 120n + 99n) / 100n;
    const gas = paddedLaunchGas > CONSERVATIVE_LAUNCH_GAS ? paddedLaunchGas : CONSERVATIVE_LAUNCH_GAS;
    const signingFees = await publicClient.estimateFeesPerGas();
    const signingFeePerGas = signingFees.maxFeePerGas ?? signingFees.gasPrice;
    if (signingFeePerGas === undefined) throw new Error("Network gas price is unavailable");
    if (await publicClient.getBalance({ address: preview.creator }) < (request.value ?? 0n) + gas * signingFeePerGas) throw new Error("ETH balance is below the transaction value plus current Gas budget");
    request = { ...request, gas };
    launchProgress!.data=encodeFunctionData({abi:request.abi,functionName:request.functionName,args:request.args} as never);
    launchProgress!.intent=JSON.stringify([request.address.toLowerCase(),request.functionName,request.args??[],request.value??0n],(_key,value)=>typeof value==='bigint'?value.toString():value);
    saveLaunchState(localStorage,launchProgress!);
    let confirmedHash = "";
    const created = await executeTransaction({
      operationKey: `launch:${mode}:${preview.marketId}:${foundation.sync.revision}`,
      onUpdate:handleLaunchTransactionUpdate,
      sync: foundation.sync,
      request,
      quoteExpiresAtMs: Date.now() + 90_000,
      walletContext: activeWallet,
      verifyChain,
      confirm: async (receipt) => {
        const result = findCanonicalMarketCreated(receipt, contracts.factoryAddress, {
          params: preview.params,
          quoteAsset: preview.selected.quote.quoteAsset,
        });
        if (result.marketId !== preview.marketId || result.memeToken !== preview.memeToken || result.curve !== preview.curve || result.gauge !== preview.gauge) {
          throw new Error("Created addresses differ from the Factory prediction");
        }
        if (mode === "create-buy") {
          receiptEvent(receipt, result.curve, v1Abis.TickerGardenCurve, "CurveBuy", (args) =>
            String(args.buyer).toLowerCase() === foundation!.bindings!.launchRouter
            && String(args.recipient).toLowerCase() === preview.creator
            && (expectedSpent === null ? typeof args.quoteIn === "bigint" && args.quoteIn > 0n && requestedQuote !== null && args.quoteIn <= requestedQuote : args.quoteIn === expectedSpent)
            && typeof args.tokensOut === "bigint"
            && expectedMinimum !== null
            && args.tokensOut >= expectedMinimum,
          );
        }
        const [code, quoteAsset, createdMarket] = await Promise.all([
          publicClient.getCode({ address: result.curve }),
          publicClient.readContract({ abi: v1Abis.TickerGardenCurve, address: result.curve, functionName: "quoteAsset" }),
          publicClient.readContract({ abi: v1Abis.MarketRegistryV1, address: foundation!.bindings!.marketRegistry, functionName: "market", args: [result.marketId], blockNumber: receipt.blockNumber }),
        ]);
        if (!code || code === "0x" || quoteAsset.toLowerCase() !== preview.selected.quote.quoteAsset) throw new Error("Fresh Curve deployment does not match the selected Quote");
        if (tupleField(tupleField(createdMarket, "config", 0), "stakingEnabled", 16) !== preview.params.stakingEnabled) throw new Error("Created staking mode differs from the signed choice");
        if (tupleField(tupleField(createdMarket, "config", 0), "creatorFeesToHolders", 15) !== preview.params.creatorFeesToHolders) throw new Error("Created holder fee sharing differs from the signed choice");
        directMarkets?.receipt(receipt);
        confirmedHash = receipt.transactionHash;
        return result;
      },
    });
    clearCreateDraft(localStorage, robinhoodChain.id); pendingCreateDraft = null;
    launchSalt = randomSalt();
    launchPreview = null;
    toast(`Market created and verified — ${shortHex(created.marketId, 9, 7)}`, "success");
    const props = submittedMetadata?.properties as Record<string,unknown> | undefined;
    latestListing = {marketId:created.marketId,snapshot:{chainId:robinhoodChain.id,chainName:robinhoodChain.name,tokenAddress:created.memeToken,
      name:submittedDetails.name,symbol:submittedDetails.symbol,logo:typeof submittedMetadata?.image==='string'?submittedMetadata.image:'',
      website:typeof props?.website==='string'?props.website:submittedDetails.website,
      x:typeof props?.x==='string'?props.x:submittedDetails.x,metadataURI:preview.params.metadataURI,txHash:confirmedHash}};
    try { localStorage.setItem(`tg-listing:${robinhoodChain.id}`,JSON.stringify(latestListing)); } catch { /* Downloads still work without browser storage. */ }
    if(launchProgress?.listing)launchProgress.listing.txHash=confirmedHash;
    updateLaunchProgress('complete','Your token is ready. Opening its market…');
    closeLaunchProgress();
    deferredRoute=`/trade?marketId=${encodeURIComponent(created.marketId)}`;
  } catch (error) {
    if(launchProgress){
      if(launchProgress.phase!=='failed'&&(launchProgress.hash||launchProgress.phase==='wallet'||launchProgress.phase==='pending'||launchProgress.phase==='confirming')){
       updateLaunchProgress('paused','The transaction outcome is not confirmed yet. We will keep tracking it; do not launch again.');
       setTimeout(()=>void restoreLaunchProgress(),0);
      } else updateLaunchProgress('failed',errorText(error));
    }
    toast(launchProgress?.phase==='paused'?'Launch is still being tracked. Do not publish again.':`Launch stopped — ${errorText(error)}`,launchProgress?.phase==='paused'?'warning':'error');
    scheduleLaunchPreview();
  } finally {
    fields.forEach((field, index) => { field.disabled = disabledBefore[index]!; });
    launchSubmitting = false;
    updateCreateAvailability();
  }
}

type RewardPositionState = Readonly<{
  detail: MarketDetailResponse;
  metadata: MarketMetadata;
  assetConfig: ConfigReadModel;
  asset: CanonicalAssetBinding;
  free: bigint;
  walletBalance: bigint;
  allocated: bigint;
  active: bigint;
  pending: bigint;
  unlockAt: bigint;
  quoteClaimable: bigint;
  memeClaimable: bigint;
  rawExitAt: bigint;
  settlementPrincipal: bigint;
  now: bigint;
}>;

type CreatorRewardState = Readonly<{
  marketId: Hex;
  epoch: number;
  beneficiary: Address;
  currentEpoch: number;
  currentBeneficiary: Address;
  pendingBeneficiary: Address | null;
  feeAsset: Address;
  liability: bigint;
  creatorFeesToHolders: boolean;
  memeLiability: bigint;
  memeAsset: Address;
  rawExitAt: bigint;
  now: bigint;
}>;

type TreasuryRewardState = Readonly<{
  detail: MarketDetailResponse;
  metadata: MarketMetadata;
  epochId: number;
  currentEpochId: number;
  status: number;
  requestedAt: bigint;
  publishBy: bigint;
  finalizeAfter: bigint;
  claimUntil: bigint;
  leafCount: number;
  requester: Address;
  merkleRoot: Hex;
  datasetHash: Hex;
  quoteAmount: bigint;
  claimedAmount: bigint;
  epochQuoteAmount: bigint;
  pendingHolderQuote: bigint;
  pendingHolderMeme: bigint;
  windowStart: bigint;
  windowEnd: bigint;
  serviceFeeAsset: Address;
  serviceFeeAmount: bigint;
  serviceFeeAllowance: bigint | null;
  serviceCreditAsset: Address;
  serviceCreditAmount: bigint;
  holderBalance: bigint;
  requestReadyAt: bigint;
  permissionlessRequestAt: bigint;
  accountClaimed: boolean;
  proof: TreasuryClaimProof | null;
  now: bigint;
}>;

type DirectEscapeState = Readonly<{
  factory: Address;
  bindings: CanonicalRuntimeBindings;
  marketId: Hex;
  assetUid: Hex;
  stockToken: Address;
  vault: Address;
  tokenDecimals: number;
  allocated: bigint;
  revision: string;
}>;

let rewardPosition: RewardPositionState | null = null;
let creatorReward: CreatorRewardState | null = null;
let treasuryReward: TreasuryRewardState | null = null;
let continuousReward: Readonly<{ marketId: Hex; quote: Address; account: Address; claimable: bigint }> | null = null;
let directEscape: DirectEscapeState | null = null;
let rewardLoadGeneration = 0;
let creatorLoadGeneration = 0;
let treasuryLoadGeneration = 0;
let directEscapeLoadGeneration = 0;
let directEscapeRefreshTimer = 0;

const treasuryStatusLabels = ["Not requested", "Root requested", "Root under review", "Claiming", "Rolled over"] as const;

const rewardMarketLabels = new Map<string, { label: string; search: string }>();

function filterStakeMarkets(): void {
  const select = query<HTMLSelectElement>("[data-position-market]");
  if (!select || !foundation) return;
  const search = query<HTMLInputElement>("[data-position-search]")?.value.trim().toLowerCase() ?? "";
  const previous = select.value;
  const matches = foundation.markets.filter((market) => market.gauge !== ZERO_ADDRESS &&
    `${rewardMarketLabels.get(market.marketId)?.search ?? ""} ${market.marketId} ${market.assetUid}`.toLowerCase().includes(search));
  select.replaceChildren(new Option(matches.length ? "Select a market" : "No matching markets", ""));
  matches.forEach((market) => select.add(new Option(rewardMarketLabels.get(market.marketId)?.label ?? rewardMarketOptionLabel(market), market.marketId)));
  if (matches.some((market) => market.marketId === previous)) select.value = previous;
  text("[data-position-search-status]", `${matches.length} matching markets in ${foundation.markets.length} loaded.${foundation.marketNextCursor ? " Load the next page above to search more markets." : ""}`);
  if (previous && select.value !== previous) void refreshRewardPosition();
}

function validStakeAmount(): bigint | null {
  if (!rewardPosition) return null;
  try {
    const value = query<HTMLInputElement>("#stake-amount")?.value ?? "";
    const amount = parseTokenAmount(value, rewardPosition.asset.tokenDecimals, "Stake amount");
    validateMarketStake(amount, rewardPosition.walletBalance, rewardPosition.allocated, rewardPosition.asset.minimumAllocation);
    return amount;
  } catch { return null; }
}

function updateStakePreview(): void {
  if (!rewardPosition) {
    text("[data-stake-preview]", "Connect a wallet and select a market to preview your stake.");
    return;
  }
  const state = rewardPosition;
  const amount = validStakeAmount();
  const field = query<HTMLInputElement>('#stake-amount');
  let amountError = '';
  if (field?.value.trim()) {
    try { const parsed = parseTokenAmount(field.value, state.asset.tokenDecimals, 'Stake amount'); validateMarketStake(parsed,state.walletBalance,state.allocated,state.asset.minimumAllocation); }
    catch(error) { amountError = errorText(error); }
  }
  const open = state.asset.status === 1 && state.detail.market.launchPhase === 1 && state.settlementPrincipal === 0n;
  text("[data-stake-preview]", !open
    ? "New stakes are unavailable: the market must be Bloomed, STOCK active, and any emergency reward cleanup complete."
    : amount === null
      ? amountError || `Enter a positive amount within your wallet balance. Minimum total position: ${formatTokenAmount(state.asset.minimumAllocation, state.asset.tokenDecimals)} STOCK.`
      : `New total: ${formatTokenAmount(state.allocated + amount, state.asset.tokenDecimals)} STOCK. The entire position locks for 24 hours from confirmation.`);
}

function setupRewards(): void {
  query<HTMLInputElement>("[data-position-search]")?.addEventListener("input", filterStakeMarkets);
  query<HTMLButtonElement>('[data-copy-beneficiary]')?.addEventListener('click', async () => {
    if (!creatorReward) return;
    try { await navigator.clipboard.writeText(creatorReward.beneficiary); toast('Recipient address copied', 'success'); }
    catch { toast('Unable to copy. Select the recipient address instead.', 'warning'); }
  });
  query<HTMLButtonElement>("[data-rewards-connect]")?.addEventListener("click", () => query<HTMLButtonElement>("[data-wallet]")?.click());
  query<HTMLDetailsElement>("[data-emergency-recovery]")?.addEventListener("toggle", event => { if ((event.currentTarget as HTMLDetailsElement).open) void refreshDirectEscape(); });
  query<HTMLInputElement>("#stake-amount")?.addEventListener("input", () => { updateStakePreview(); updateRewardsAvailability(); });
  queryAll<HTMLFormElement>("[data-reward-form]").forEach((form) => form.addEventListener("submit", (event) => {
    event.preventDefault();
    const button = form.querySelector<HTMLButtonElement>("[data-reward-action]");
    if (button && !button.disabled) void runPageAction(() => runRewardAction(button));
  }));
  rewardRefreshTimer = window.setInterval(() => {
    if (isRewardsPage() && document.visibilityState === "visible" && wallet && foundation && !busyOperation) {
      void refreshActiveReward();
    }
  }, 30_000);
  query<HTMLButtonElement>("[data-rewards-refresh]")?.addEventListener("click", () => { void refreshActiveReward(); });
  const tabs = queryAll<HTMLButtonElement>("[data-rewards-tab]");
  const selectTab = (next: HTMLButtonElement, focus = false) => {
    const id = next.dataset.rewardsTab ?? "positions";
    tabs.forEach((tab) => {
      const selected = tab === next;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    queryAll<HTMLElement>("[data-rewards-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.rewardsPanel !== id;
    });
    syncUserActivity();
    if (focus) next.focus();
    const changed = rewardTab(window.location.hash) !== id;
    router.replaceLocation(`#${id}`);
    if (changed) void refreshActiveReward();
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectTab(tab));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const nextIndex = event.key === "Home" ? 0
        : event.key === "End" ? tabs.length - 1
          : (index + (["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1) + tabs.length) % tabs.length;
      const next = tabs[nextIndex];
      if (next) selectTab(next, true);
    });
  });
  syncRewardHash = () => {
    const requestedTab = window.location.hash.slice(1);
    const initial = tabs.find(tab => tab.dataset.rewardsTab === requestedTab) ?? tabs[0];
    if (initial) selectTab(initial);
  };
  syncRewardHash();

  queryAll<HTMLSelectElement>("[data-position-market],[data-staker-market],[data-settle-market]").forEach((select) => {
    select.addEventListener("change", () => {
      if (select.matches('[data-staker-market]')) { const search = query<HTMLInputElement>('[data-position-search]'); if (search) search.value = ''; filterStakeMarkets(); }
      const position = query<HTMLSelectElement>("[data-position-market]");
      if (select.matches("[data-position-market]")) syncRewardMarketSelections(select.value, "position");
      else if (position) {
        position.value = select.value;
        syncRewardMarketSelections(select.value, "position");
      }
      void refreshRewardPosition();
    });
  });
  const directMarket = query<HTMLInputElement>("[data-direct-vault-market]");
  directMarket?.addEventListener("input", () => {
    directEscape = null;
    text("[data-direct-vault-asset]", "—");
    text("[data-direct-vault-principal]", "—");
    text("[data-direct-vault-status]", "Enter a complete canonical marketId to verify the independent principal route.");
    updateRewardsAvailability();
    window.clearTimeout(directEscapeRefreshTimer);
    if (BYTES32_PATTERN.test(directMarket.value.trim().toLowerCase())) {
      directEscapeRefreshTimer = window.setTimeout(() => { void refreshDirectEscape(); }, 250);
    }
  });
  query<HTMLSelectElement>("[data-creator-market]")?.addEventListener("change", (event) => {
    const marketId = (event.currentTarget as HTMLSelectElement).value;
    const epoch = query<HTMLInputElement>("[data-creator-epoch]"); if (epoch) epoch.value = "";
    syncRewardMarketSelections(marketId, "creator");
    const market = foundation?.markets.find((entry) => entry.marketId === marketId);
    const feeAsset = query<HTMLInputElement>("[data-creator-fee-asset]");
    if (market && feeAsset) feeAsset.value = market.quoteAsset;
    void refreshCreatorReward();
  });
  query<HTMLButtonElement>("[data-creator-current]")?.addEventListener("click", () => { const epoch = query<HTMLInputElement>("[data-creator-epoch]"); if (epoch) epoch.value = ""; void refreshCreatorReward(); });
  query<HTMLInputElement>("[data-creator-epoch]")?.addEventListener("change", () => { void refreshCreatorReward(); });
  query<HTMLInputElement>("[data-creator-fee-asset]")?.addEventListener("change", () => { void refreshCreatorReward(); });
  query<HTMLSelectElement>("[data-treasury-market]")?.addEventListener("change", (event) => {
    syncRewardMarketSelections((event.currentTarget as HTMLSelectElement).value, "treasury");
    void refreshTreasuryReward(true);
  });
  query<HTMLInputElement>("[data-treasury-epoch]")?.addEventListener("change", () => { void refreshTreasuryReward(false); });
  query<HTMLInputElement>("[data-treasury-service-credit-asset]")?.addEventListener("change", () => { void refreshTreasuryReward(false); });
  queryAll<HTMLButtonElement>("[data-reward-action]").forEach((button) => {
    setDisabled(button, true);
    button.addEventListener("click", () => { void runPageAction(() => runRewardAction(button)); });
  });
  const settleUser = query<HTMLInputElement>("[data-settle-user]");
  settleUser?.addEventListener("input", updateRewardsAvailability);
  query<HTMLInputElement>("[data-creator-new-beneficiary]")?.addEventListener("input", updateRewardsAvailability);
}

function rewardMarketOptionLabel(market: MarketReadModel): string {
  return `${shortHex(market.marketId, 8, 6)} · ${phaseLabel(market.launchPhase)} · ${market.gauge === ZERO_ADDRESS ? "No stock staking" : `STOCK ${shortHex(market.assetUid)}`}`;
}

function populateRewardMarkets(): void {
  if (!foundation) return;
  const selects = queryAll<HTMLSelectElement>("[data-position-market],[data-staker-market],[data-settle-market],[data-creator-market],[data-treasury-market]");
  selects.forEach((select) => {
    const prior = select.value;
    const placeholder = select.matches("[data-direct-vault-market],[data-settle-market]") ? "Use selected market" : currentPage() === "rewards" ? "Select a token" : "Select a configured market";
    select.replaceChildren(new Option(placeholder, ""));
    foundation!.markets.filter((market) => !select.matches("[data-position-market],[data-staker-market],[data-settle-market]") || market.gauge !== ZERO_ADDRESS).forEach((market) => select.add(new Option(rewardMarketOptionLabel(market), market.marketId)));
    if (foundation!.markets.some((market) => market.marketId === prior)) select.value = prior;
  });
  filterStakeMarkets();
  const directory = foundation;
  void mapConcurrent(foundation.markets, async (market) => {
    try {
      const metadata = await marketMetadata(market);
      if (foundation !== directory) return;
      rewardMarketLabels.set(market.marketId, {
        label: `${metadata.symbol} · ${phaseLabel(market.launchPhase)} · ${shortHex(market.marketId)}`,
        search: `${metadata.symbol} ${metadata.name}`,
      });
      selects.forEach((select) => {
        const option = [...select.options].find((item) => item.value === market.marketId);
        if (option) option.textContent = `${metadata.symbol} · ${phaseLabel(market.launchPhase)} · ${shortHex(market.marketId)}`;
      });
      filterStakeMarkets();
    } catch {
      // Canonical market identity remains selectable if optional token metadata fails.
    }
  });
}

function syncRewardMarketSelections(marketId: string, source: "position" | "creator" | "treasury"): void {
  if (!marketId && source !== "position") return;
  if (source === "position") {
    queryAll<HTMLSelectElement>("[data-staker-market],[data-settle-market]").forEach((select) => { select.value = marketId; });
    const direct = query<HTMLInputElement>("[data-direct-vault-market]");
    if (direct) direct.value = marketId;
  }
  const position = query<HTMLSelectElement>("[data-position-market]");
  const creator = query<HTMLSelectElement>("[data-creator-market]");
  const treasury = query<HTMLSelectElement>("[data-treasury-market]");
  if (position && !position.value) position.value = marketId;
  if (creator && !creator.value) creator.value = marketId;
  if (treasury && !treasury.value) treasury.value = marketId;
}

function directEscapeRevision(state: Omit<DirectEscapeState, "revision">, account: Address): string {
  return [
    "direct-vault-rage-quit",
    V1_EXECUTION_SPEC_ID,
    state.factory,
    state.bindings.officialStockRegistry,
    state.bindings.marketRegistry,
    state.bindings.allocationManager,
    state.marketId,
    state.assetUid,
    state.vault,
    state.stockToken,
    account,
    state.allocated.toString(),
  ].join(":");
}

/**
 * Resolve the caller-only principal exit exclusively from immutable Factory and
 * canonical on-chain Registry/Vault facts. Reward, Gauge, indexer, phase, lock,
 * admission status, and minimumAllocation state are deliberately not queried.
 */
async function readDirectEscapeState(marketId: Hex, account: Address): Promise<DirectEscapeState> {
  if (!runtimeConfig.rageQuitFactory.available) {
    throw new Error(runtimeConfig.rageQuitFactory.reasons.join("; "));
  }
  const factory = runtimeConfig.rageQuitFactory.value;
  const [factoryCode, rawBindings] = await Promise.all([
    publicClient.getCode({ address: factory }),
    publicClient.readContract({ abi: v1Abis.TickerGardenFactoryV1, address: factory, functionName: "runtimeBindings" }),
  ]);
  if (!factoryCode || factoryCode === "0x") throw new Error("Configured Factory has no runtime code");
  const bindings = decodeCanonicalFactoryBindings(rawBindings);
  const [rawMarket, factoryDependencyCodes] = await Promise.all([
    publicClient.readContract({ abi: v1Abis.MarketRegistryV1, address: bindings.marketRegistry, functionName: "market", args: [marketId] }),
    Promise.all([
      bindings.officialStockRegistry,
      bindings.marketRegistry,
      bindings.allocationManager,
    ].map((address) => publicClient.getCode({ address }))),
  ]);
  if (factoryDependencyCodes.some((code) => !code || code === "0x")) {
    throw new Error("rageQuit Factory dependencies are not deployed contracts");
  }
  const marketConfig = tupleField(rawMarket, "config", 0);
  if (tupleField(marketConfig, "stakingEnabled", 16) !== true) throw new Error("Stock staking is not enabled for this market");
  const assetUid = canonicalBytes32(tupleString(marketConfig, "assetUid", 0), "Market assetUid");
  const rawAsset = await publicClient.readContract({
    abi: v1Abis.OfficialStockRegistryV1,
    address: bindings.officialStockRegistry,
    functionName: "asset",
    args: [assetUid],
  });
  const stockToken = canonicalAddress(tupleString(rawAsset, "stockToken", 0), "Canonical STOCK token");
  const vault = canonicalAddress(tupleString(rawAsset, "userStockVault", 1), "Canonical UserStockVault");
  const tokenDecimals = tupleNumber(rawAsset, "tokenDecimals", 2);
  const assetStatus = tupleNumber(rawAsset, "status", 3);
  if (tokenDecimals < 6 || tokenDecimals > 18 || assetStatus < 1 || assetStatus > 3) {
    throw new Error("Canonical STOCK identity is invalid for principal exit");
  }
  const [stockCode, vaultCode, rawVaultIdentity, registeredSchema, allocated] = await Promise.all([
    publicClient.getCode({ address: stockToken }),
    publicClient.getCode({ address: vault }),
    publicClient.readContract({ abi: v1Abis.UserStockVault, address: vault, functionName: "vaultIdentity" }),
    publicClient.readContract({ abi: v1Abis.OfficialStockRegistryV1, address: bindings.officialStockRegistry, functionName: "vaultSchemaId", args: [vault] }),
    publicClient.readContract({ abi: v1Abis.UserStockVault, address: vault, functionName: "allocation", args: [assetUid, account, marketId] }),
  ]);
  if (!stockCode || stockCode === "0x" || !vaultCode || vaultCode === "0x") {
    throw new Error("Canonical STOCK token or Vault has no runtime code");
  }
  const reportedRegistry = canonicalAddress(tupleString(rawVaultIdentity, "output0", 0), "Vault Stock Registry");
  const reportedMarketRegistry = canonicalAddress(tupleString(rawVaultIdentity, "output1", 1), "Vault Market Registry");
  const reportedAllocationManager = canonicalAddress(tupleString(rawVaultIdentity, "output2", 2), "Vault AllocationManager");
  const schemaId = canonicalBytes32(tupleString(rawVaultIdentity, "output3", 3), "Vault schema");
  if (
    reportedRegistry !== bindings.officialStockRegistry
    || reportedMarketRegistry !== bindings.marketRegistry
    || reportedAllocationManager !== bindings.allocationManager
    || canonicalBytes32(registeredSchema, "Registered Vault schema") !== schemaId
  ) throw new Error("Vault immutable identity differs from the Factory registry graph");
  const vaultForSchema = await publicClient.readContract({
    abi: v1Abis.OfficialStockRegistryV1,
    address: bindings.officialStockRegistry,
    functionName: "vaultForSchema",
    args: [schemaId],
  });
  if (canonicalAddress(vaultForSchema, "Registered schema Vault") !== vault) {
    throw new Error("Vault schema does not resolve back to the canonical Vault");
  }
  const withoutRevision = Object.freeze({ factory, bindings, marketId, assetUid, stockToken, vault, tokenDecimals, allocated });
  return Object.freeze({ ...withoutRevision, revision: directEscapeRevision(withoutRevision, account) });
}

async function refreshDirectEscape(): Promise<void> {
  const generation = ++directEscapeLoadGeneration;
  directEscape = null;
  text("[data-direct-vault-asset]", "—");
  text("[data-direct-vault-principal]", "—");
  updateRewardsAvailability();
  if (!wallet) {
    text("[data-direct-vault-status]", "Connect a wallet to verify the independent principal route.");
    return;
  }
  if (!runtimeConfig.rageQuitFactory.available) {
    text("[data-direct-vault-status]", `Direct principal exit locked — ${runtimeConfig.rageQuitFactory.reasons.join("; ")}.`);
    return;
  }
  const rawMarketId = query<HTMLInputElement>("[data-direct-vault-market]")?.value.trim().toLowerCase() ?? "";
  if (!rawMarketId) {
    text("[data-direct-vault-status]", "Enter a canonical marketId to verify the independent principal route.");
    return;
  }
  try {
    const marketId = canonicalBytes32(rawMarketId, "Direct escape marketId");
    text("[data-direct-vault-status]", "Verifying Factory, Registry, STOCK and Vault identities directly on-chain…");
    const account = wallet.account;
    const state = await readDirectEscapeState(marketId, account);
    if (generation !== directEscapeLoadGeneration || wallet?.account !== account) return;
    directEscape = state;
    text("[data-direct-vault-asset]", state.assetUid);
    text("[data-direct-vault-principal]", `${formatTokenAmount(state.allocated, state.tokenDecimals)} (${state.allocated} raw)`);
    text("[data-direct-vault-status]", state.allocated > 0n
      ? "Independent route verified. This action returns the full allocated principal and forfeits all unclaimed rewards."
      : "No allocated principal exists for this wallet and market.");
  } catch (error) {
    if (generation !== directEscapeLoadGeneration) return;
    text("[data-direct-vault-status]", `Direct escape locked — ${errorText(error)}`);
  }
  updateRewardsAvailability();
}

function selectedRewardMarket(selector: string): MarketReadModel {
  if (!foundation) throw new Error("V1 runtime is unavailable");
  const id = canonicalBytes32(required<HTMLSelectElement>(selector).value, "marketId");
  const market = foundation.markets.find((item) => item.marketId === id);
  if (!market) throw new Error("The selected market is not in the finalized directory");
  return market;
}

async function getRewardMarketDetail(market: MarketReadModel): Promise<MarketDetailResponse> {
  if (!foundation || !readApi) throw new Error("V1 read runtime is unavailable");
  const detail = foundation.direct && directMarkets ? await directMarkets.market(market.marketId) : await readApi.getMarket({ marketId: market.marketId, revision: foundation.sync.revision });
  if (!foundation.direct) assertFinalizedSync(detail.sync, foundation.sync.revision, "reward market detail");
  if (detail.market.marketId !== market.marketId) throw new Error("Read API returned a different reward market");
  await ensureCanonicalMarket(detail.market);
  return detail;
}

async function readRewardPositionState(detail: MarketDetailResponse): Promise<RewardPositionState> {
  if (!wallet) throw new Error("Connect a wallet to load your position");
  if (detail.market.gauge === ZERO_ADDRESS) throw new Error("Stock staking is not enabled for this market");
  const assetConfig = findAsset(detail.market.assetUid);
  const asset = await ensureCanonicalAsset(assetConfig, verifiedMarketRuntime.get(detail.market.marketId));
  const account = wallet.account;
  const block = await publicClient.getBlock({ blockTag: "latest" });
  const blockNumber = block.number;
  const [free, allocated, rawPosition, settlementPrincipal, walletBalance, rawExitAt] = await Promise.all([
    publicClient.readContract({ blockNumber, abi: v1Abis.UserStockVault, address: asset.userStockVault, functionName: "freeBalanceOf", args: [asset.assetUid, account] }),
    publicClient.readContract({ blockNumber, abi: v1Abis.UserStockVault, address: asset.userStockVault, functionName: "allocation", args: [asset.assetUid, account, detail.market.marketId] }),
    publicClient.readContract({ blockNumber, abi: v1Abis.MemeStockGauge, address: canonicalAddress(detail.market.gauge, "Gauge"), functionName: "positionOf", args: [account] }),
    publicClient.readContract({ blockNumber, abi: v1Abis.UserStockVault, address: asset.userStockVault, functionName: "rageQuitSettlementPrincipal", args: [asset.assetUid, account, detail.market.marketId] }),
    publicClient.readContract({ blockNumber, abi: erc20Abi, address: asset.stockToken, functionName: "balanceOf", args: [account] }),
    publicClient.readContract({ blockNumber, abi: v1Abis.ProtocolFeeVault, address: marketRelease(detail.market.marketId).feeVault, functionName: "rawRewardExitAt", args: [detail.market.marketId, account] }),
  ]);
  const active = tupleBigInt(rawPosition, "activeAmount", 0);
  const pending = tupleBigInt(rawPosition, "pendingAmount", 1);
  const unlockAt = tupleBigInt(rawPosition, "unlockAt", 3);
  const quoteClaimable = tupleBigInt(rawPosition, "quoteClaimable", 4);
  const memeClaimable = tupleBigInt(rawPosition, "memeClaimable", 5);
  const gaugePrincipal = active + pending;
  if (settlementPrincipal === 0n && allocated !== gaugePrincipal) throw new Error("Vault and Gauge allocation ledgers disagree");
  if (settlementPrincipal > 0n && (allocated !== 0n || (gaugePrincipal !== 0n && gaugePrincipal !== settlementPrincipal))) {
    throw new Error("Deferred rage-quit settlement is internally inconsistent");
  }
  return Object.freeze({
    detail,
    metadata: await marketMetadata(detail.market),
    assetConfig,
    asset,
    free,
    walletBalance,
    allocated,
    active,
    pending,
    unlockAt,
    quoteClaimable,
    memeClaimable,
    rawExitAt,
    settlementPrincipal,
    now: block.timestamp,
  });
}

function renderRewardPosition(state: RewardPositionState): void {
  const stock = (amount: bigint) => formatTokenAmount(amount, state.asset.tokenDecimals);
  const unlock = state.unlockAt === 0n ? "not set" : new Date(Number(state.unlockAt) * 1_000).toLocaleString();
  const settlement = state.settlementPrincipal > 0n
    ? ` Reward cleanup pending for ${stock(state.settlementPrincipal)}; principal has already been returned.`
    : "";
  iconText("[data-position-summary]", "ph-check-circle", `Wallet ${stock(state.walletBalance)} STOCK · staked ${stock(state.allocated)} (active ${stock(state.active)}, pending ${stock(state.pending)}) · minimum non-zero position ${stock(state.asset.minimumAllocation)} · normal unlock ${unlock}.${settlement}`);
  text("[data-unstake-preview]", state.allocated === 0n ? "No staked principal in this market." : `Full return: ${stock(state.allocated)} STOCK. ${state.now >= state.unlockAt ? "Unlocked — ready to return to wallet." : `Unlocks ${unlock}.`}`);
  updateStakePreview();
  text("[data-staker-claimable=quote]", `${formatTokenAmount(state.quoteClaimable, state.metadata.quoteDecimals)} ${state.metadata.quoteSymbol}`);
  text("[data-staker-claimable=meme]", `${formatTokenAmount(state.memeClaimable, 18)} ${state.metadata.symbol}`);
  text("[data-rewards-total]", `${formatTokenAmount(state.quoteClaimable, state.metadata.quoteDecimals)} ${state.metadata.quoteSymbol} · ${formatTokenAmount(state.memeClaimable, 18)} ${state.metadata.symbol}`);
  iconText("[data-staker-status]", "ph-check-circle", `Rewards for ${state.metadata.symbol}. Settled rewards are paid in ${state.metadata.quoteSymbol}; pending tokens are awaiting conversion.`);
  text("[data-staker-conversion-status]", rawExitStatus(state.rawExitAt, state.now));
  text("[data-ragequit-estimate]", `Principal: ${stock(state.allocated)} STOCK. Estimated unclaimed rewards forfeited to the platform: ${formatTokenAmount(state.quoteClaimable, state.metadata.quoteDecimals)} ${state.metadata.quoteSymbol} + ${formatTokenAmount(state.memeClaimable, 18)} ${state.metadata.symbol}. Final reward amounts may change before execution.`);
  const directAsset = query<HTMLInputElement>("[data-direct-vault-asset]");
  if (directAsset) { directAsset.value = state.asset.assetUid; directAsset.readOnly = true; }
  const settleUser = query<HTMLInputElement>("[data-settle-user]");
  if (settleUser && !settleUser.value && wallet) settleUser.value = wallet.account;
}

async function refreshRewardPosition(): Promise<void> {
  const generation = ++rewardLoadGeneration;
  rewardPosition = null;
  updateStakePreview();
  text("[data-unstake-preview]", "Select a market to load your staked balance and unlock time.");
  text("[data-ragequit-estimate]", "Load a verified position to see principal and estimated forfeited rewards.");
  text("[data-staker-claimable=quote]", "Locked — verified position required");
  text("[data-staker-claimable=meme]", "Locked — verified position required");
  text("[data-rewards-total]", "—");
  text("[data-staker-conversion-status]", "Load a verified position to see conversion status.");
  updateRewardsAvailability();
  if (!foundation || !wallet) {
    const reason = !foundation ? runtimeReasons().join("; ") : "connect a wallet";
    iconText("[data-position-summary]", "ph-lock-key", `Position unavailable — ${reason}.`);
    text("[data-rewards-status]", `Rewards locked — ${reason}.`);
    return;
  }
  const select = query<HTMLSelectElement>("[data-position-market]");
  if (!select?.value) {
    iconText("[data-position-summary]", "ph-info", "Select a market to load your wallet balance, stake and rewards.");
    text("[data-rewards-status]", "Choose a canonical market to load position and reward state.");
    return;
  }
  try {
    text("[data-rewards-status]", "Verifying the selected market, Vault, Gauge and account ledgers…");
    const market = selectedRewardMarket("[data-position-market]");
    const detail = await getRewardMarketDetail(market);
    const state = await readRewardPositionState(detail);
    if (generation !== rewardLoadGeneration) return;
    rewardPosition = state;
    renderRewardPosition(state);
    text("[data-rewards-status]", `Balances updated for ${shortHex(wallet.account)} at ${new Date().toLocaleTimeString()}.`);
    updateRewardsAvailability();
  } catch (error) {
    if (generation !== rewardLoadGeneration) return;
    iconText("[data-position-summary]", "ph-warning", `Position locked — ${errorText(error)}`);
    text("[data-rewards-status]", `Position verification failed — ${errorText(error)}`);
    updateRewardsAvailability();
  }
}

function configuredCreatorFeeAsset(market: MarketReadModel): Address {
  const input = required<HTMLInputElement>("[data-creator-fee-asset]");
  input.value = market.quoteAsset;
  return canonicalAddress(input.value.trim(), "Creator fee asset", true);
}

async function refreshCreatorReward(): Promise<void> {
  const generation = ++creatorLoadGeneration;
  creatorReward = null;
  text("[data-creator-receive-asset]", "—");
  text("[data-creator-status]", "");
  text("[data-creator-beneficiary]", "—");
  text("[data-creator-pending-beneficiary]", "—");
  text("[data-creator-current-beneficiary]", "—");
  text("[data-creator-market-summary]", "—");
  text("[data-creator-epoch-summary]", "—");
  text("[data-creator-status-summary]", "Locked");
  text("[data-creator-quote-asset]", "—");
  text("[data-creator-pending-meme]", "—");
  text("[data-creator-conversion-status]", "Load verified creator rewards to see conversion status.");
  updateRewardsAvailability();
  if (!foundation || !wallet || !runtimeConfig.contracts.available) {
    text("[data-creator-status]", !wallet ? "" : `Connection unavailable — ${runtimeReasons().join("; ")}`);
    return;
  }
  const select = query<HTMLSelectElement>("[data-creator-market]");
  if (!select?.value) return;
  try {
    const market = selectedRewardMarket("[data-creator-market]");
    await getRewardMarketDetail(market);
    const registry = marketRelease(market.marketId).creatorRegistry;
    const block = await publicClient.getBlock({ blockTag: "latest" });
    const blockNumber = block.number;
    const currentEpoch = await publicClient.readContract({ blockNumber, abi: v1Abis.CreatorRevenueRegistry, address: registry, functionName: "currentCreatorEpoch", args: [market.marketId] });
    if (generation !== creatorLoadGeneration) return;
    if (currentEpoch <= 0) throw new Error("Creator revenue has not been initialized for this market");
    const epochInput = required<HTMLInputElement>("[data-creator-epoch]");
    if (!epochInput.value) epochInput.value = String(currentEpoch);
    const epoch = parseUint32(epochInput.value, "Creator epoch");
    epochInput.max = String(currentEpoch);
    if (epoch > currentEpoch) throw new Error("Creator epoch is newer than the on-chain current epoch");
    const feeAsset = configuredCreatorFeeAsset(market);
    const [beneficiary, currentBeneficiary, liability, rawMarket] = await Promise.all([
      publicClient.readContract({ blockNumber, abi: v1Abis.CreatorRevenueRegistry, address: registry, functionName: "creatorBeneficiaryAt", args: [market.marketId, epoch] }),
      publicClient.readContract({ blockNumber, abi: v1Abis.CreatorRevenueRegistry, address: registry, functionName: "creatorBeneficiaryAt", args: [market.marketId, currentEpoch] }),
      publicClient.readContract({ blockNumber, abi: v1Abis.ProtocolFeeVault, address: marketRelease(market.marketId).feeVault, functionName: "creatorLiability", args: [market.marketId, epoch, feeAsset] }),
      publicClient.readContract({ blockNumber, abi: v1Abis.MarketRegistryV1, address: marketRelease(market.marketId).marketRegistry, functionName: "market", args: [market.marketId] }),
    ]);
    const canonicalBeneficiary = canonicalAddress(beneficiary, "Creator beneficiary");
    const canonicalCurrentBeneficiary = canonicalAddress(currentBeneficiary, "Current creator beneficiary");
    const memeAsset = canonicalAddress(market.memeToken, "Meme asset");
    const [memeLiability, rawExitAt, metadata] = await Promise.all([
      publicClient.readContract({ blockNumber, abi: v1Abis.ProtocolFeeVault, address: marketRelease(market.marketId).feeVault, functionName: "creatorLiability", args: [market.marketId, epoch, memeAsset] }),
      publicClient.readContract({ blockNumber, abi: v1Abis.ProtocolFeeVault, address: marketRelease(market.marketId).feeVault, functionName: "rawRewardExitAt", args: [market.marketId, canonicalBeneficiary] }),
      marketMetadata(market),
    ]);
    if (generation !== creatorLoadGeneration) return;
    const pendingBeneficiary = await publicClient.readContract({blockNumber, abi: v1Abis.CreatorRevenueRegistry, address: registry, functionName: "pendingCreatorRevenueBeneficiary", args: [market.marketId]}).catch(() => null);
    if (generation !== creatorLoadGeneration || !wallet) return;
    text("[data-creator-pending-beneficiary]", pendingBeneficiary === null ? "Two-step handoff unavailable: unsupported release or RPC read failure" : pendingBeneficiary === ZERO_ADDRESS ? "No pending handoff" : pendingBeneficiary);
    const creatorFeesToHolders = tupleField(tupleField(rawMarket, "config", 0), "creatorFeesToHolders", 15) === true;
    creatorReward = Object.freeze({ pendingBeneficiary, creatorFeesToHolders, marketId: market.marketId, epoch, beneficiary: canonicalBeneficiary, currentEpoch, currentBeneficiary: canonicalCurrentBeneficiary, feeAsset, liability, memeAsset, memeLiability, rawExitAt, now: block.timestamp });
    text("[data-creator-quote-asset]", `${formatTokenAmount(liability, metadata.quoteDecimals)} ${metadata.quoteSymbol}`);
    text("[data-creator-pending-meme]", `${formatTokenAmount(memeLiability, 18)} ${metadata.symbol}`);
    text("[data-creator-conversion-status]", rawExitStatus(rawExitAt, block.timestamp));
    text("[data-creator-receive-asset]", metadata.quoteSymbol);
    text("[data-creator-beneficiary]", canonicalBeneficiary);
    text("[data-creator-current-beneficiary]", canonicalCurrentBeneficiary);
    text("[data-creator-market-summary]", shortHex(market.marketId, 9, 7));
    text("[data-creator-epoch-summary]", String(epoch));
    text("[data-creator-status]", `${formatTokenAmount(liability, metadata.quoteDecimals)} ${metadata.quoteSymbol} available; payment goes to ${shortHex(canonicalBeneficiary)}.${creatorFeesToHolders ? " Holder fee sharing is enabled: this amount covers only the creator's retained base fee share and all creator tax; holder rewards are claimed separately." : ""}`);
    text("[data-creator-status-summary]", wallet.account === canonicalCurrentBeneficiary ? "Current future-revenue controller" : wallet.account === canonicalBeneficiary ? "Selected historical-epoch beneficiary" : "Read / permissionless claim only");
    updateRewardsAvailability();
  } catch (error) {
    if (generation !== creatorLoadGeneration) return;
    text("[data-creator-status]", `Locked — ${errorText(error)}`);
    text("[data-creator-status-summary]", "Locked");
    updateRewardsAvailability();
  }
}

function clearTreasuryProof(): void {
  const values: readonly [string, string][] = [
    ["[data-treasury-leaf-index]", ""],
    ["[data-treasury-leaf-account]", wallet?.account ?? ""],
    ["[data-treasury-twab]", ""],
    ["[data-treasury-claim-amount]", ""],
    ["[data-treasury-proof-input]", ""],
  ];
  values.forEach(([selector, value]) => {
    const element = query<HTMLInputElement | HTMLTextAreaElement>(selector);
    if (element) element.value = value;
  });
  text("[data-treasury-recipient]", "Leaf account only");
}

async function verifiedTreasuryProof(state: Omit<TreasuryRewardState, "proof">): Promise<TreasuryClaimProof | null> {
  if (!runtimeConfig.treasuryProofApi.available || !wallet || state.status !== 3 || state.accountClaimed) return null;
  const proof = await fetchTreasuryClaimProof({
    baseUrl: runtimeConfig.treasuryProofApi.value,
    marketId: state.detail.market.marketId,
    epochId: state.epochId,
    account: wallet.account,
  });
  const distributor = marketRelease(state.detail.market.marketId).holderDistributor;
  if (
    proof.distributor !== distributor
    || proof.merkleRoot !== state.merkleRoot
    || proof.datasetHash !== state.datasetHash
  ) throw new Error("Proof commitments do not match the live holder fee-sharing epoch");
  const leaf = await publicClient.readContract({
    abi: v1Abis.TreasuryDistributorV1,
    address: distributor,
    functionName: "claimLeaf",
    args: [proof.marketId, proof.epochId, proof.leafIndex, proof.account, proof.twab, proof.amount],
  });
  if (foldSortedMerkleProof(canonicalBytes32(leaf, "holder fee-sharing leaf"), proof.proof) !== state.merkleRoot) {
    throw new Error("Proof does not reconstruct the live holder fee-sharing Merkle Root");
  }
  return proof;
}

function renderTreasuryProof(proof: TreasuryClaimProof | null, metadata: MarketMetadata): void {
  clearTreasuryProof();
  if (!proof) return;
  const values: readonly [string, string][] = [
    ["[data-treasury-leaf-index]", String(proof.leafIndex)],
    ["[data-treasury-leaf-account]", proof.account],
    ["[data-treasury-twab]", String(proof.twab)],
    ["[data-treasury-claim-amount]", formatTokenAmount(proof.amount, metadata.quoteDecimals)],
    ["[data-treasury-proof-input]", JSON.stringify(proof.proof, null, 2)],
  ];
  values.forEach(([selector, value]) => {
    const element = query<HTMLInputElement | HTMLTextAreaElement>(selector);
    if (element) element.value = value;
  });
  text("[data-treasury-recipient]", proof.account);
}

function populateTreasuryEpochs(current: number, resetEpoch: boolean): number {
  const input = required<HTMLInputElement>("[data-treasury-epoch]");
  const prior = resetEpoch ? "" : input.value;
  input.max = String(current);
  if (!prior) input.value = String(current > 1 ? current - 1 : current);
  const epoch = parseUint32(input.value, "holder fee-sharing epoch");
  if (epoch > current) throw new Error("Holder fee-sharing epoch cannot be newer than the current epoch");
  return epoch;
}

async function refreshTreasuryReward(resetEpoch: boolean): Promise<void> {
  const generation = ++treasuryLoadGeneration;
  treasuryReward = null;
  continuousReward = null;
  setContinuousRewardsView(false);
  clearTreasuryProof();
  text("[data-treasury-status]", "Locked");
  text("[data-treasury-epoch-id]", "—");
  text("[data-treasury-root]", "—");
  text("[data-treasury-fee]", "Locked — live configuration required");
  text("[data-treasury-fee-asset]", "Locked — live configuration required");
  text("[data-treasury-fee-allowance]", "Locked — live allowance required");
  text("[data-treasury-service-credit]", "Locked — live credit required");
  text("[data-treasury-claimable]", "Unavailable");
  text("[data-treasury-proof]", "No verified proof loaded");
  updateRewardsAvailability();
  if (!foundation || !wallet || !runtimeConfig.contracts.available) {
    text("[data-treasury-status-note]", `Holder fee sharing locked — ${runtimeReasons().join("; ") || "connect a wallet"}.`);
    return;
  }
  const select = query<HTMLSelectElement>("[data-treasury-market]");
  if (!select?.value) return;
  try {
    const detail = await getRewardMarketDetail(selectedRewardMarket("[data-treasury-market]"));

    const distributor = marketRelease(detail.market.marketId).holderDistributor;
    // Mode comes from the bound on-chain distributor, never an API display hint.
    const mode = await publicClient.readContract({ abi: continuousRewardsAbi, address: distributor, functionName: "rewardMode" }).catch(() => null);
    if (generation !== treasuryLoadGeneration) return;
    if (mode !== null && !isContinuousHolderRewardMode(mode)) throw new Error("Unsupported holder reward mode");
    if (isContinuousHolderRewardMode(mode)) {
      const account = wallet.account;
      const block = await publicClient.getBlock({ blockTag: "latest" });
      const marketId = detail.market.marketId;
      const [state, amount, pendingQuote, pendingMeme, metadata, releaseInfo, lastFunding, unswept] = await Promise.all([
        publicClient.readContract({ blockNumber: block.number, abi: continuousRewardsAbi, address: distributor, functionName: "marketState", args: [marketId] }),
        publicClient.readContract({ blockNumber: block.number, abi: continuousRewardsAbi, address: distributor, functionName: "claimable", args: [marketId, account] }),
        publicClient.readContract({ blockNumber: block.number, abi: v1Abis.ProtocolFeeVault, address: marketRelease(detail.market.marketId).feeVault, functionName: "holderLiability", args: [marketId, 1, detail.market.quoteAsset] }),
        publicClient.readContract({ blockNumber: block.number, abi: v1Abis.ProtocolFeeVault, address: marketRelease(detail.market.marketId).feeVault, functionName: "holderLiability", args: [marketId, 1, detail.market.memeToken] }),
        marketMetadata(detail.market),
        publicClient.readContract({blockNumber: block.number, abi: continuousRewardsAbi, address: distributor, functionName: "releaseState", args: [marketId]}),
        publicClient.readContract({blockNumber: block.number, abi: continuousRewardsAbi, address: distributor, functionName: "lastFundingAt", args: [marketId]}),
        publicClient.readContract({blockNumber: block.number, abi: v1Abis.TickerGardenCurve, address: detail.market.curve, functionName: "accruedCurveFees"}),
      ]);
      if (state.token.toLowerCase() !== detail.market.memeToken || state.quote.toLowerCase() !== detail.market.quoteAsset
          || state.vault.toLowerCase() !== marketRelease(detail.market.marketId).feeVault.toLowerCase()) throw new Error("Holder stream canonical binding mismatch");
      if (generation !== treasuryLoadGeneration || wallet?.account !== account) return;
      continuousReward = Object.freeze({ marketId, quote: state.quote, account, claimable: amount });
      setContinuousRewardsView(true);
      text("[data-continuous-claimable]", `${formatTokenAmount(amount, metadata.quoteDecimals)} ${metadata.quoteSymbol}`);
      text("[data-continuous-unswept]", `Uncollected base fees in the market curve: ${formatTokenAmount(unswept, metadata.quoteDecimals)} ${metadata.quoteSymbol} (market total, not your rewards; creator tax excluded).`);
      text("[data-continuous-pending]", `Pending holder-pool injection: ${formatTokenAmount(pendingQuote, metadata.quoteDecimals)} ${metadata.quoteSymbol} · Pending swap: ${formatTokenAmount(pendingMeme, 18)} ${metadata.symbol}`);
      text("[data-continuous-release]", `Market release in progress: ${formatTokenAmount(releaseInfo[0], metadata.quoteDecimals)} ${metadata.quoteSymbol}; held in reserve: ${formatTokenAmount(releaseInfo[1], metadata.quoteDecimals)}. This is not a fixed future return.`);
      text("[data-continuous-funding]", lastFunding === 0n ? "No rewards injected yet" : `Last injection: ${new Date(Number(lastFunding) * 1000).toLocaleString()}; on-chain read time: ${new Date(Number(block.timestamp) * 1000).toLocaleString()}`);
      text("[data-continuous-status]", state.supply === 0n ? "There are no eligible holders. Rewards are retained and continue releasing when holdings resume." : "Each received reward releases over 24 hours. Accumulated rewards can be claimed at any time, including after selling.");
      updateRewardsAvailability();
      return;
    }
    const rawTreasuryMarket = await publicClient.readContract({ abi: v1Abis.TreasuryDistributorV1, address: distributor, functionName: "market", args: [detail.market.marketId] });
    if (generation !== treasuryLoadGeneration) return;
    const memeToken = canonicalAddress(tupleString(rawTreasuryMarket, "memeToken", 0), "holder fee-sharing Meme token");
    const quoteToken = canonicalAddress(tupleString(rawTreasuryMarket, "quoteToken", 1), "holder fee-sharing Quote token", true);
    const activatedAt = tupleBigInt(rawTreasuryMarket, "activatedAt", 3);
    if (memeToken !== detail.market.memeToken || quoteToken !== detail.market.quoteAsset || activatedAt <= 0n) {
      throw new Error("Holder fee-sharing registration or activation does not match the canonical market");
    }
    const currentEpochId = await publicClient.readContract({ abi: v1Abis.TreasuryDistributorV1, address: distributor, functionName: "currentEpochId", args: [detail.market.marketId] });
    const epochId = populateTreasuryEpochs(currentEpochId, resetEpoch);
    const [rawEpoch, epochQuoteAmount, rawWindow, rawFee, holderBalance, accountClaimed, block, finalityDelay, publicationWindow, pendingHolderQuote, pendingHolderMeme] = await Promise.all([
      publicClient.readContract({ abi: v1Abis.TreasuryDistributorV1, address: distributor, functionName: "epoch", args: [detail.market.marketId, epochId] }),
      publicClient.readContract({ abi: v1Abis.TreasuryDistributorV1, address: distributor, functionName: "epochQuoteAmount", args: [detail.market.marketId, epochId] }),
      publicClient.readContract({ abi: v1Abis.TreasuryDistributorV1, address: distributor, functionName: "epochWindow", args: [detail.market.marketId, epochId] }),
      publicClient.readContract({ abi: v1Abis.TreasuryDistributorV1, address: distributor, functionName: "rootServiceFee" }),
      publicClient.readContract({ abi: erc20Abi, address: memeToken, functionName: "balanceOf", args: [wallet.account] }),
      publicClient.readContract({ abi: v1Abis.TreasuryDistributorV1, address: distributor, functionName: "accountClaimed", args: [detail.market.marketId, epochId, wallet.account] }),
      publicClient.getBlock({ blockTag: "latest" }),
      publicClient.readContract({ abi: parseAbi(["function finalityDelaySeconds() view returns (uint32)"]), address: distributor, functionName: "finalityDelaySeconds" }),
      publicClient.readContract({ abi: parseAbi(["function rootPublicationWindow() view returns (uint32)"]), address: distributor, functionName: "rootPublicationWindow" }),
      publicClient.readContract({ abi: v1Abis.ProtocolFeeVault, address: marketRelease(detail.market.marketId).feeVault, functionName: "holderLiability", args: [detail.market.marketId, epochId, quoteToken] }),
      publicClient.readContract({ abi: v1Abis.ProtocolFeeVault, address: marketRelease(detail.market.marketId).feeVault, functionName: "holderLiability", args: [detail.market.marketId, epochId, memeToken] }),
    ]);
    const status = tupleNumber(rawEpoch, "status", 6);
    if (status < 0 || status >= treasuryStatusLabels.length) throw new Error("Holder fee sharing returned an unknown epoch status");
    if (generation !== treasuryLoadGeneration) return;
    const serviceFeeAsset = canonicalAddress(tupleString(rawFee, "asset", 0), "Root service fee asset", true);
    const serviceFeeAmount = tupleBigInt(rawFee, "amount", 1);
    const serviceCreditInput = required<HTMLInputElement>("[data-treasury-service-credit-asset]");
    if (!serviceCreditInput.value) serviceCreditInput.value = serviceFeeAsset;
    const serviceCreditAsset = canonicalAddress(serviceCreditInput.value.trim(), "Service credit asset", true);
    const [serviceFeeAllowance, serviceCreditAmount] = await Promise.all([
      serviceFeeAsset === ZERO_ADDRESS
        ? Promise.resolve(null)
        : publicClient.readContract({ abi: erc20Abi, address: serviceFeeAsset, functionName: "allowance", args: [wallet.account, distributor] }),
      publicClient.readContract({ abi: v1Abis.TreasuryDistributorV1, address: distributor, functionName: "serviceCredit", args: [serviceCreditAsset, wallet.account] }),
    ]);
    const metadata = await marketMetadata(detail.market);
    const base = Object.freeze({
      detail,
      metadata,
      epochId,
      currentEpochId,
      status,
      requestedAt: tupleBigInt(rawEpoch, "requestedAt", 0),
      publishBy: tupleBigInt(rawEpoch, "publishBy", 1),
      finalizeAfter: tupleBigInt(rawEpoch, "finalizeAfter", 2),
      claimUntil: tupleBigInt(rawEpoch, "claimUntil", 3),
      leafCount: tupleNumber(rawEpoch, "leafCount", 5),
      requester: canonicalAddress(tupleString(rawEpoch, "requester", 7), "holder fee-sharing Root requester", true),
      merkleRoot: canonicalBytes32(tupleString(rawEpoch, "merkleRoot", 11), "holder fee-sharing Merkle Root", true),
      datasetHash: canonicalBytes32(tupleString(rawEpoch, "datasetHash", 12), "holder fee-sharing dataset hash", true),
      quoteAmount: tupleBigInt(rawEpoch, "quoteAmount", 13),
      claimedAmount: tupleBigInt(rawEpoch, "claimedAmount", 14),
      epochQuoteAmount,
      pendingHolderQuote, pendingHolderMeme,
      windowStart: tupleBigInt(rawWindow, "output0", 0),
      windowEnd: tupleBigInt(rawWindow, "output1", 1),
      serviceFeeAsset,
      serviceFeeAmount,
      serviceFeeAllowance,
      serviceCreditAsset,
      serviceCreditAmount,
      holderBalance,
      requestReadyAt: tupleBigInt(rawWindow, "output1", 1) + BigInt(finalityDelay),
      permissionlessRequestAt: tupleBigInt(rawWindow, "output1", 1) + BigInt(finalityDelay) + BigInt(publicationWindow),
      accountClaimed,
      now: block.timestamp,
    });
    let proof: TreasuryClaimProof | null = null;
    let proofStatus = runtimeConfig.treasuryProofApi.available ? "No claim proof for this account / epoch" : runtimeConfig.treasuryProofApi.reasons.join("; ");
    try {
      proof = await verifiedTreasuryProof(base);
      if (proof) proofStatus = "Proof fetched and verified against the live Merkle Root";
      else if (accountClaimed) proofStatus = "This account already claimed the epoch";
      else if (status !== 3) proofStatus = "Proof becomes actionable after Root finalization";
    } catch (error) {
      proofStatus = `Proof unavailable — ${errorText(error)}`;
    }
    if (generation !== treasuryLoadGeneration) return;
    treasuryReward = Object.freeze({ ...base, proof });
    text("[data-treasury-status]", treasuryStatusLabels[status] ?? `Status ${status}`);
    text("[data-treasury-epoch-id]", `${epochId} · ${new Date(Number(base.windowStart) * 1_000).toLocaleDateString()} – ${new Date(Number(base.windowEnd) * 1_000).toLocaleDateString()}`);
    text("[data-treasury-root]", base.merkleRoot);
    text("[data-treasury-fee]", `${base.serviceFeeAmount} raw · ${base.serviceFeeAsset === ZERO_ADDRESS ? "native ETH" : shortHex(base.serviceFeeAsset)}`);
    text("[data-treasury-fee-asset]", base.serviceFeeAsset === ZERO_ADDRESS ? "Native ETH" : base.serviceFeeAsset);
    text("[data-treasury-fee-allowance]", base.serviceFeeAllowance === null ? "Not applicable" : `${base.serviceFeeAllowance} raw${base.serviceFeeAllowance >= base.serviceFeeAmount ? " · sufficient" : " · approval required"}`);
    text("[data-treasury-service-credit]", `${base.serviceCreditAmount} raw · ${base.serviceCreditAsset === ZERO_ADDRESS ? "native ETH" : shortHex(base.serviceCreditAsset)}`);
    text("[data-treasury-claimable]", proof ? `${formatTokenAmount(proof.amount, metadata.quoteDecimals)} ${metadata.quoteSymbol}` : accountClaimed ? "Already claimed" : "No verified claim loaded");
    text("[data-treasury-proof]", proofStatus);
    const releaseGate = runtimeConfig.treasuryWrites.available
      ? " Holder fee-sharing writes are release-approved."
      : ` Read-only: ${runtimeConfig.treasuryWrites.reasons.join("; ")}.`;
    text("[data-treasury-status-note]", `Epoch Quote ${formatTokenAmount(base.epochQuoteAmount, metadata.quoteDecimals)} ${metadata.quoteSymbol}; ${base.claimedAmount} of ${base.quoteAmount} raw allocated amount claimed. Current holder balance ${formatTokenAmount(base.holderBalance, 18)} ${metadata.symbol}. Pending settlement credit: ${formatTokenAmount(base.pendingHolderQuote, metadata.quoteDecimals)} ${metadata.quoteSymbol}; pending swap: ${formatTokenAmount(base.pendingHolderMeme, 18)} ${metadata.symbol}.${releaseGate}`);
    renderTreasuryProof(proof, metadata);
    updateRewardsAvailability();
  } catch (error) {
    if (generation !== treasuryLoadGeneration) return;
    text("[data-treasury-status]", "Locked");
    text("[data-treasury-status-note]", `Holder fee sharing locked — ${errorText(error)}`);
    text("[data-treasury-proof]", "No verified proof loaded");
    updateRewardsAvailability();
  }
}

function rewardActionButton(action: string, route?: string): HTMLButtonElement | null {
  const selector = route ? `[data-reward-action="${action}"][data-reward-route="${route}"]` : `[data-reward-action="${action}"]`;
  return query<HTMLButtonElement>(selector);
}

function setContinuousRewardsView(enabled: boolean): void {
  queryAll<HTMLElement>("[data-legacy-treasury]").forEach((el) => { el.hidden = enabled; });
  queryAll<HTMLElement>("[data-continuous-treasury]").forEach((el) => { el.hidden = !enabled; });
}

function updateRewardsAvailability(): void {
  const copy = query<HTMLButtonElement>("[data-copy-beneficiary]"); if (copy) copy.disabled = !creatorReward;
  const connect = query<HTMLButtonElement>("[data-rewards-connect]"); if (connect) connect.hidden = !!wallet;
  const prerequisite = !wallet ? 'Connect your wallet to continue.' : busyOperation ? 'A transaction is in progress. Check its status above.' : hasPendingTransaction() ? 'Check the existing transaction above before submitting another.' : !foundation?.writeReady ? 'Transactions are unavailable until the market connection is restored.' : '';
  text('[data-staker-action-help]', prerequisite || (rewardPosition ? stakerClaimHelp(rewardPosition) : 'Choose a market to view your stake and rewards.'));
  text('[data-creator-action-help]', prerequisite || (!creatorReward ? 'Choose a market to view creator rewards.' : creatorReward.liability > 0n ? `Ready to claim. Funds go to ${shortHex(creatorReward.beneficiary)}, the beneficiary for this version.` : creatorReward.memeLiability > 0n ? 'Rewards are awaiting conversion. See original-token options below if conversion cannot complete.' : 'No creator revenue to claim for this beneficiary version yet.'));
  text('[data-holder-action-help]', prerequisite || (continuousReward ? continuousReward.claimable > 0n ? 'Rewards are ready to claim to your wallet.' : 'Nothing claimable yet. Check the release and funding status below.' : treasuryReward ? treasuryReward.accountClaimed ? 'You have already claimed this reward cycle.' : treasuryReward.status === 3 && treasuryReward.proof ? treasuryReward.now > treasuryReward.claimUntil ? 'This reward cycle has expired.' : 'Your verified reward is ready to claim.' : 'Rewards will be available after this cycle closes and its distribution is ready. See cycle status below.' : 'Choose a market to load its reward schedule.'));

  queryAll<HTMLButtonElement>("[data-reward-action]").forEach((button) => setDisabled(button, true));
  const direct = rewardActionButton("directVaultRageQuit");
  if (direct) {
    setDisabled(
      direct,
      !wallet
        || Boolean(busyOperation)
        || !runtimeConfig.rageQuitFactory.available
        || !directEscape
        || directEscape.allocated <= 0n
        || directEscape.marketId !== (query<HTMLInputElement>("[data-direct-vault-market]")?.value.trim().toLowerCase() ?? ""),
    );
  }
  if (!writeReady()) return;
  if (continuousReward && writeReady() && runtimeConfig.continuousHolderWrites.available && wallet?.account === continuousReward.account) {
    const claim = rewardActionButton("claimContinuous");
    if (claim) setDisabled(claim, continuousReward.claimable <= 0n);
  }
  if (rewardPosition) {
    const normalClaimReady = rewardPosition.allocated === 0n || (rewardPosition.unlockAt > 0n && rewardPosition.now >= rewardPosition.unlockAt);
    const allocationOpen = rewardPosition.asset.status === 1 && rewardPosition.detail.market.launchPhase === 1 && rewardPosition.settlementPrincipal === 0n;
    setDisabled(rewardActionButton("stake")!, !allocationOpen || !validStakeAmount());
    setDisabled(rewardActionButton("unstakeAndWithdraw")!, rewardPosition.allocated <= 0n || rewardPosition.detail.market.launchPhase !== 1 || rewardPosition.unlockAt === 0n || rewardPosition.now < rewardPosition.unlockAt);
    setDisabled(rewardActionButton("rageQuit", "allocation-manager")!, rewardPosition.allocated <= 0n);
    queryAll<HTMLButtonElement>("[data-reward-action=claimStaker]").forEach((button) => {
      const amount = button.dataset.rewardAsset === "meme" ? rewardPosition!.memeClaimable : rewardPosition!.quoteClaimable;
      setDisabled(button, amount <= 0n || !normalClaimReady || rewardPosition!.settlementPrincipal > 0n || (button.dataset.rewardAsset === "meme" && !rawExitReady(rewardPosition!.rawExitAt, rewardPosition!.now)));
    });
    setDisabled(rewardActionButton("requestStakerRawExit")!, rewardPosition.rawExitAt !== 0n || rewardPosition.memeClaimable <= 0n);
    setDisabled(rewardActionButton("cancelStakerRawExit")!, rewardPosition.rawExitAt === 0n);
    const settleUser = query<HTMLInputElement>("[data-settle-user]")?.value.trim().toLowerCase() ?? "";
    const settle = rewardActionButton("settleRageQuitRewards");
    if (settle) setDisabled(settle, !ADDRESS_PATTERN.test(settleUser));
  }
  if (creatorReward) {
    const claim = rewardActionButton("claimCreator");
    if (claim) setDisabled(claim, creatorReward.liability <= 0n);
    setDisabled(rewardActionButton("claimCreatorRaw")!, creatorReward.memeLiability <= 0n || !rawExitReady(creatorReward.rawExitAt, creatorReward.now));
    setDisabled(rewardActionButton("requestCreatorRawExit")!, wallet?.account !== creatorReward.beneficiary || creatorReward.rawExitAt !== 0n || creatorReward.memeLiability <= 0n);
    setDisabled(rewardActionButton("cancelCreatorRawExit")!, wallet?.account !== creatorReward.beneficiary || creatorReward.rawExitAt === 0n);
    const next = query<HTMLInputElement>("[data-creator-new-beneficiary]")?.value.trim().toLowerCase() ?? "";
    const transfer = rewardActionButton("transferCreatorRevenueBeneficiary");
    if (transfer) setDisabled(transfer, creatorReward.pendingBeneficiary === null || wallet?.account !== creatorReward.currentBeneficiary || !ADDRESS_PATTERN.test(next) || next === ZERO_ADDRESS || next === creatorReward.currentBeneficiary);
  }
  if (creatorReward) {
    setDisabled(rewardActionButton("acceptCreatorRevenueBeneficiary")!, !creatorReward.pendingBeneficiary || creatorReward.pendingBeneficiary === ZERO_ADDRESS || wallet?.account !== creatorReward.pendingBeneficiary.toLowerCase());
    setDisabled(rewardActionButton("cancelCreatorRevenueBeneficiaryTransfer")!, !creatorReward.pendingBeneficiary || creatorReward.pendingBeneficiary === ZERO_ADDRESS || wallet?.account !== creatorReward.currentBeneficiary);
  }
  if (treasuryReward && treasuryWritesReady()) {
    const state = treasuryReward;
    const request = rewardActionButton("requestRoot");
    if (request) setDisabled(request, state.status !== 0 || state.pendingHolderQuote > 0n || state.pendingHolderMeme > 0n || state.epochId >= state.currentEpochId || state.epochQuoteAmount <= 0n || state.now < state.requestReadyAt || (state.holderBalance <= 0n && state.now < state.permissionlessRequestAt));
    const claim = rewardActionButton("claim");
    if (claim) setDisabled(claim, state.status !== 3 || !state.proof || state.accountClaimed || state.now > state.claimUntil);
    const finalize = rewardActionButton("finalizeRoot");
    if (finalize) setDisabled(finalize, state.status !== 2 || state.now < state.finalizeAfter);
    const expire = rewardActionButton("expireRootRequest");
    if (expire) setDisabled(expire, state.status !== 1 || state.now <= state.publishBy);
    const rollover = rewardActionButton("rolloverExpiredEpoch");
    if (rollover) setDisabled(rollover, state.status !== 3 || state.now <= state.claimUntil || state.currentEpochId <= state.epochId);
    const withdrawCredit = rewardActionButton("withdrawServiceCredit");
    if (withdrawCredit) setDisabled(withdrawCredit, state.serviceCreditAmount <= 0n);
  }
  // Protocol funding/burn, Root publication and reviewer cancellation are intentionally never user actions.
  queryAll<HTMLButtonElement>("[data-reward-action=fundQuote],[data-reward-action=burnMeme]").forEach((button) => setDisabled(button, true));
}

async function freshPositionValue(
  state: RewardPositionState,
  name: "free" | "allocated" | "settlement",
  account: Address,
  blockNumber?: bigint,
): Promise<bigint> {
  const functionName = name === "free" ? "freeBalanceOf" : name === "allocated" ? "allocation" : "rageQuitSettlementPrincipal";
  const args = name === "free"
    ? [state.asset.assetUid, account] as const
    : [state.asset.assetUid, account, state.detail.market.marketId] as const;
  return publicClient.readContract({
    abi: v1Abis.UserStockVault,
    address: state.asset.userStockVault,
    functionName,
    args,
    ...(blockNumber === undefined ? {} : { blockNumber }),
  } as never) as Promise<bigint>;
}

async function executePositionAction(action: string, button: HTMLButtonElement): Promise<void> {
  if (!foundation || !wallet || !rewardPosition) throw new Error("Load a verified wallet position first");
  const activeWallet = wallet;
  const account = activeWallet.account;
  await verifyLiveWalletContext(activeWallet);
  const state = rewardPosition;
  const marketId = state.detail.market.marketId;
  const verifyChain = async () => { await ensureCanonicalMarket(state.detail.market); await ensureCanonicalAsset(state.assetConfig, verifiedMarketRuntime.get(state.detail.market.marketId)); };
  const form = button.closest<HTMLFormElement>("form");
  const amountFrom = (name: string, label: string) => parseTokenAmount(required<HTMLInputElement>(`[name=${name}]`, form ?? document).value, state.asset.tokenDecimals, label);
  let request: ContractWriteRequest;
  let approval: ContractWriteRequest | undefined;
  let confirm: (receipt: TransactionReceipt) => Promise<unknown>;
  if (action === "stake") {
    const amount = amountFrom("amount", "Stake amount");
    validateMarketStake(amount, state.walletBalance, state.allocated, state.asset.minimumAllocation);
    request = buildStake(marketRelease(marketId).allocationManager, marketId, amount);
    approval = await allowanceApproval(buildStockApproval(state.asset.stockToken, state.asset.userStockVault, amount), state.asset.stockToken, state.asset.userStockVault, amount, account);
    confirm = async (receipt) => {
      receiptEvent(receipt, state.asset.userStockVault, v1Abis.UserStockVault, "StockDeposited", (args) => args.assetUid === state.asset.assetUid && String(args.user).toLowerCase() === account && args.amount === amount);
      receiptEvent(receipt, state.asset.userStockVault, v1Abis.UserStockVault, "AllocationLocked", (args) => args.assetUid === state.asset.assetUid && String(args.user).toLowerCase() === account && args.marketId === marketId && args.amount === amount);
      const [free, allocated] = await Promise.all([
        freshPositionValue(state, "free", account, receipt.blockNumber),
        freshPositionValue(state, "allocated", account, receipt.blockNumber),
      ]);
      if (free !== state.free || allocated !== state.allocated + amount) throw new Error("Confirmed principal does not reflect the exact stake");
      return allocated;
    };
  } else if (action === "unstakeAndWithdraw") {
    if (state.allocated <= 0n) throw new Error("There is no stake to withdraw");
    request = buildUnstakeAndWithdraw(marketRelease(marketId).allocationManager, marketId);
    confirm = async (receipt) => {
      receiptEvent(receipt, state.asset.userStockVault, v1Abis.UserStockVault, "AllocationReleased", (args) => args.assetUid === state.asset.assetUid && String(args.user).toLowerCase() === account && args.marketId === marketId && args.amount === state.allocated);
      receiptEvent(receipt, state.asset.userStockVault, v1Abis.UserStockVault, "StockWithdrawn", (args) => args.assetUid === state.asset.assetUid && String(args.user).toLowerCase() === account && args.amount === state.allocated);
      const [allocated, free] = await Promise.all([
        freshPositionValue(state, "allocated", account, receipt.blockNumber),
        freshPositionValue(state, "free", account, receipt.blockNumber),
      ]);
      if (allocated !== 0n || free !== state.free) throw new Error("Confirmed principal does not reflect full withdrawal to wallet");
      return allocated;
    };
  } else if (action === "rageQuit") {
    if (state.allocated <= 0n) throw new Error("There is no principal to escape");
    const walletBalanceBefore = await publicClient.readContract({ abi: erc20Abi, address: state.asset.stockToken, functionName: "balanceOf", args: [account] });
    request = buildRageQuit(marketRelease(marketId).allocationManager, marketId);
    confirm = async (receipt) => {
      receiptEvent(receipt, state.asset.userStockVault, v1Abis.UserStockVault, "AllocationRageQuit", (args) => args.assetUid === state.asset.assetUid && String(args.user).toLowerCase() === account && args.marketId === marketId && args.amount === state.allocated);
      const [afterAllocation, afterBalance, settlement] = await Promise.all([
        freshPositionValue(state, "allocated", account, receipt.blockNumber),
        publicClient.readContract({ abi: erc20Abi, address: state.asset.stockToken, functionName: "balanceOf", args: [account], blockNumber: receipt.blockNumber }),
        freshPositionValue(state, "settlement", account, receipt.blockNumber),
      ]);
      if (afterAllocation !== 0n || afterBalance !== walletBalanceBefore + state.allocated) throw new Error("Immediate principal escape was not reflected exactly");
      return settlement;
    };
  } else {
    throw new Error("Unknown position action");
  }
  await executeTransaction({
    operationKey: `reward:${action}:${marketId}:${account}:${foundation.sync.revision}`,
    sync: foundation.sync,
    request,
    ...(approval ? { approval } : {}),
    walletContext: activeWallet,
    verifyChain,
    confirm,
  });
  if (action === "stake") { const input = query<HTMLInputElement>("#stake-amount"); if (input) input.value = ""; }
  toast(action === "rageQuit" ? "Principal returned immediately; reward cleanup state refreshed" : "Market position updated; principal verified on chain", "success");
  await refreshRewardPosition();
}

async function executeDirectVaultRageQuit(): Promise<void> {
  if (!wallet) throw new Error("Connect a wallet first");
  const activeWallet = wallet;
  const marketId = canonicalBytes32(
    required<HTMLInputElement>("[data-direct-vault-market]").value.trim().toLowerCase(),
    "Direct escape marketId",
  );
  const state = await readDirectEscapeState(marketId, activeWallet.account);
  if (state.allocated <= 0n) throw new Error("There is no allocated principal to escape");
  const walletBalanceBefore = await publicClient.readContract({
    abi: erc20Abi,
    address: state.stockToken,
    functionName: "balanceOf",
    args: [activeWallet.account],
  });
  busyOperation = `reward:direct-vault-rage-quit:${marketId}:${activeWallet.account}:${state.allocated}`;
  refreshActionAvailability();
  try {
    await activeWallet.executor.execute({
      operationKey: busyOperation,
      expectedAccount: activeWallet.account,
      snapshot: { executionSpecId: V1_EXECUTION_SPEC_ID, revision: state.revision, syncStatus: "synced" },
      request: buildDirectRageQuit(state.vault, state.assetUid, state.marketId),
      confirmations: 1,
      verifyWalletContext: () => verifyLiveWalletContext(activeWallet),
      currentRevision: async () => (await readDirectEscapeState(state.marketId, activeWallet.account)).revision,
      confirm: async (receipt) => {
        receiptEvent(receipt, state.vault, v1Abis.UserStockVault, "AllocationRageQuit", (args) =>
          args.assetUid === state.assetUid
          && String(args.user).toLowerCase() === activeWallet.account
          && args.marketId === state.marketId
          && args.amount === state.allocated,
        );
        receiptEvent(receipt, state.vault, v1Abis.UserStockVault, "StockWithdrawn", (args) =>
          args.assetUid === state.assetUid
          && String(args.user).toLowerCase() === activeWallet.account
          && args.amount === state.allocated,
        );
        const [afterAllocation, afterBalance] = await Promise.all([
          publicClient.readContract({
            abi: v1Abis.UserStockVault,
            address: state.vault,
            functionName: "allocation",
            args: [state.assetUid, activeWallet.account, state.marketId],
            blockNumber: receipt.blockNumber,
          }),
          publicClient.readContract({
            abi: erc20Abi,
            address: state.stockToken,
            functionName: "balanceOf",
            args: [activeWallet.account],
            blockNumber: receipt.blockNumber,
          }),
        ]);
        if (afterAllocation !== 0n || afterBalance !== walletBalanceBefore + state.allocated) {
          throw new Error("Immediate direct-Vault principal escape was not reflected exactly");
        }
        return state.allocated;
      },
      onUpdate: (update) => {
        const detail = update.error ? `${update.error.code}: ${update.error.message}` : update.hash ? shortHex(update.hash, 9, 7) : "";
        const message = `${transactionStageLabels[update.stage]}${detail ? ` — ${detail}` : ""}`;
        text("[data-direct-vault-status]", message);
        toast(message, update.stage === "failed" ? "error" : update.stage === "confirmed" ? "success" : "neutral");
      },
    });
    toast("Full allocated STOCK principal returned through the independent Vault escape", "success");
  } finally {
    busyOperation = "";
    refreshActionAvailability();
  }
  await refreshDirectEscape();
  await refreshRewardPosition();
}

async function executeSettlement(): Promise<void> {
  if (!foundation || !wallet || !rewardPosition) throw new Error("Load a verified market first");
  const activeWallet = wallet;
  const state = rewardPosition;
  await verifyLiveWalletContext(activeWallet);
  const marketId = canonicalBytes32(required<HTMLSelectElement>("[data-settle-market]").value, "Settlement market");
  if (marketId !== state.detail.market.marketId) throw new Error("Settlement market differs from the verified position market");
  const user = canonicalAddress(required<HTMLInputElement>("[data-settle-user]").value.trim(), "Position owner");
  const principal = await publicClient.readContract({ abi: v1Abis.UserStockVault, address: state.asset.userStockVault, functionName: "rageQuitSettlementPrincipal", args: [state.asset.assetUid, user, marketId] });
  if (principal <= 0n) throw new Error("No deferred rage-quit reward settlement exists for this account");
  await executeTransaction({
    operationKey: `reward:settle:${marketId}:${user}:${foundation.sync.revision}`,
    sync: foundation.sync,
    request: buildSettleRageQuitRewards(marketRelease(marketId).allocationManager, marketId, user),
    walletContext: activeWallet,
    verifyChain: () => ensureCanonicalMarket(state.detail.market),
    confirm: async (receipt) => {
      receiptEvent(receipt, marketRelease(marketId).allocationManager, v1Abis.AllocationManager, "RageQuitRewardSettlementFinalized", (args) => String(args.user).toLowerCase() === user && args.marketId === marketId && args.principal === principal);
      const after = await publicClient.readContract({ abi: v1Abis.UserStockVault, address: state.asset.userStockVault, functionName: "rageQuitSettlementPrincipal", args: [state.asset.assetUid, user, marketId], blockNumber: receipt.blockNumber });
      if (after !== 0n) throw new Error("Deferred settlement tombstone remains after settlement");
      return after;
    },
  });
  toast("Forfeited rewards settled; principal was not transferred twice", "success");
  await refreshRewardPosition();
}

function rawExitReady(at: bigint, now: bigint): boolean { return at > 0n && now >= at; }
function rawExitStatus(at: bigint, now: bigint): string {
  return at === 0n ? "Automatic Quote settlement. If conversion stalls, request original-token access after a 7-day waiting period."
    : rawExitReady(at, now) ? "Original-token access is ready. Automatic conversion is paused for your rewards in this market; existing claim locks still apply."
    : `Original-token access opens ${new Date(Number(at) * 1000).toLocaleString()}. Automatic conversion may complete before then.`;
}
async function executeRawRewardExit(action: string): Promise<void> {
  if (!foundation?.bindings || !wallet) throw new Error("Connect a wallet and verify the market first");
  await verifyLiveWalletContext(wallet);
  const creator = action.includes("Creator");
  const market = creator ? selectedRewardMarket("[data-creator-market]") : rewardPosition?.detail.market;
  if (!market || (creator && creatorReward?.beneficiary !== wallet.account)) throw new Error("Only the reward owner can change original-token access");
  const cancel = action.startsWith("cancel");
  const account = wallet.account;
  await ensureCanonicalMarket(market);
  const feeVault = marketRelease(market.marketId).feeVault;
  await executeTransaction({
    operationKey: `reward:raw-exit:${market.marketId}:${account}:${cancel}:${foundation.sync.revision}`,
    sync: foundation.sync,
    request: createContractWriteRequest({abi:v1Abis.ProtocolFeeVault,address:feeVault,
      functionName:cancel ? "cancelRawRewardExit" : "requestRawRewardExit",args:[market.marketId]}),
    walletContext: wallet,
    verifyChain: () => ensureCanonicalMarket(market),
    confirm: async receipt => {
      const at = await publicClient.readContract({abi:v1Abis.ProtocolFeeVault,address:feeVault,functionName:"rawRewardExitAt",args:[market.marketId,account],blockNumber:receipt.blockNumber});
      if (cancel ? at !== 0n : at === 0n) throw new Error("Original-token access state did not match the request");
      return at;
    },
  });
  toast(cancel ? "Automatic settlement restored" : "Original-token waiting period started", "success");
  await Promise.allSettled([refreshRewardPosition(), refreshCreatorReward()]);
}

async function executeStakerClaim(button: HTMLButtonElement): Promise<void> {
  if (!foundation || !wallet || !rewardPosition) throw new Error("Load a verified reward position first");
  const activeWallet = wallet;
  const account = activeWallet.account;
  const state = rewardPosition;
  await verifyLiveWalletContext(activeWallet);
  const meme = button.dataset.rewardAsset === "meme";
  const asset = canonicalAddress(meme ? state.detail.market.memeToken : state.detail.market.quoteAsset, "Staker fee asset", true);
  const before = meme ? state.memeClaimable : state.quoteClaimable;
  if (before <= 0n) throw new Error("This fee asset has no claimable balance");
  await executeTransaction({
    operationKey: `reward:staker:${state.detail.market.marketId}:${asset}:${account}:${foundation.sync.revision}`,
    sync: foundation.sync,
    request: buildClaimStaker(marketRelease(state.detail.market.marketId).feeVault, state.detail.market.marketId, asset),
    walletContext: activeWallet,
    verifyChain: () => ensureCanonicalMarket(state.detail.market),
    confirm: async (receipt) => {
      receiptEvent(receipt, marketRelease(state.detail.market.marketId).feeVault, v1Abis.ProtocolFeeVault, "FeeClaimed", (args) => Number(args.beneficiaryType) === 1 && String(args.beneficiary).toLowerCase() === account && args.marketId === state.detail.market.marketId && String(args.feeAsset).toLowerCase() === asset && typeof args.amount === "bigint" && args.amount > 0n);
      const position = await publicClient.readContract({ abi: v1Abis.MemeStockGauge, address: canonicalAddress(state.detail.market.gauge, "Gauge"), functionName: "positionOf", args: [account], blockNumber: receipt.blockNumber });
      const after = tupleBigInt(position, meme ? "memeClaimable" : "quoteClaimable", meme ? 5 : 4);
      // Later transactions in the receipt block can accrue or convert new rewards.
      // The authenticated FeeClaimed receipt proves this claim; retain the fresh balance.
      return after;
    },
  });
  toast("Staker reward paid to the connected account", "success");
  await refreshRewardPosition();
}

async function executeCreatorAction(action: string): Promise<void> {
  if (!foundation || !wallet || !creatorReward || !runtimeConfig.contracts.available) throw new Error("Load verified creator revenue state first");
  const activeWallet = wallet;
  await verifyLiveWalletContext(activeWallet);
  const state = action === "claimCreatorRaw" ? {...creatorReward, feeAsset: creatorReward.memeAsset, liability: creatorReward.memeLiability} : creatorReward;
  const creatorRegistry = marketRelease(state.marketId).creatorRegistry;
  await ensureCanonicalMarket(selectedRewardMarket("[data-creator-market]"));
  if (action === "claimCreator" || action === "claimCreatorRaw") {
    if (state.liability <= 0n) throw new Error("The selected creator liability is zero");
    await executeTransaction({
      operationKey: `reward:creator-claim:${state.marketId}:${state.epoch}:${state.feeAsset}:${foundation.sync.revision}`,
      sync: foundation.sync,
      request: buildClaimCreator({ feeVault: marketRelease(state.marketId).feeVault, marketId: state.marketId, epoch: state.epoch, asset: state.feeAsset }),
      walletContext: activeWallet,
      verifyChain: () => ensureCanonicalMarket(selectedRewardMarket("[data-creator-market]")),
      confirm: async (receipt) => {
        return receiptEvent(receipt, marketRelease(state.marketId).feeVault, v1Abis.ProtocolFeeVault, "FeeClaimed", (args) => Number(args.beneficiaryType) === 0 && String(args.beneficiary).toLowerCase() === state.beneficiary && args.marketId === state.marketId && Number(args.beneficiaryEpoch) === state.epoch && String(args.feeAsset).toLowerCase() === state.feeAsset && typeof args.amount === "bigint" && args.amount > 0n);
      },
    });
    toast("Creator revenue paid to the recorded beneficiary", "success");
  } else {
    if (state.pendingBeneficiary === null) throw new Error("This release does not support two-step handoff");
    const accept = action === "acceptCreatorRevenueBeneficiary";
    const cancel = action === "cancelCreatorRevenueBeneficiaryTransfer";
    if (activeWallet.account !== (accept ? state.pendingBeneficiary.toLowerCase() : state.currentBeneficiary)) throw new Error("Wallet is not authorized for this handoff step");
    const next = accept ? state.pendingBeneficiary : cancel ? ZERO_ADDRESS : canonicalAddress(required<HTMLInputElement>("[data-creator-new-beneficiary]").value.trim(), "New beneficiary");
    await executeTransaction({
      operationKey: `reward:creator-handoff:${state.marketId}:${action}:${next}:${foundation.sync.revision}`,
      sync: foundation.sync, walletContext: activeWallet,
      request: accept || cancel ? createContractWriteRequest({abi: v1Abis.CreatorRevenueRegistry, address: creatorRegistry,
        functionName: accept ? "acceptCreatorRevenueBeneficiary" : "cancelCreatorRevenueBeneficiaryTransfer", args: [state.marketId]})
        : buildTransferCreatorBeneficiary({registry: creatorRegistry, marketId: state.marketId, nextBeneficiary: next}),
      verifyChain: () => ensureCanonicalMarket(selectedRewardMarket("[data-creator-market]")),
      confirm: async receipt => {
        const event = accept ? "CreatorRevenueBeneficiaryUpdated" : cancel ? "CreatorRevenueBeneficiaryTransferCancelled" : "CreatorRevenueBeneficiaryProposed";
        receiptEvent(receipt, creatorRegistry, v1Abis.CreatorRevenueRegistry, event, args => args.marketId === state.marketId);
        const pending = await publicClient.readContract({abi: v1Abis.CreatorRevenueRegistry, address: creatorRegistry, functionName: "pendingCreatorRevenueBeneficiary", args: [state.marketId], blockNumber: receipt.blockNumber});
        const epoch = await publicClient.readContract({abi: v1Abis.CreatorRevenueRegistry, address: creatorRegistry, functionName: "currentCreatorEpoch", args: [state.marketId], blockNumber: receipt.blockNumber});
        if (pending.toLowerCase() !== (accept || cancel ? ZERO_ADDRESS : next.toLowerCase()) || epoch !== state.currentEpoch + (accept ? 1 : 0)) throw new Error("Handoff receipt state mismatch");
        return epoch;
      },
    });
    if (accept) required<HTMLInputElement>("[data-creator-epoch]").value = String(state.currentEpoch + 1);
    toast(accept ? "Future revenue handoff accepted" : cancel ? "Handoff cancelled" : "Recipient nominated; new wallet must accept", "success");
  }

  await refreshCreatorReward();
}

async function ensureTreasuryActionState(state: TreasuryRewardState, action: string, account: Address): Promise<void> {
  if (!runtimeConfig.contracts.available || !runtimeConfig.treasuryWrites.available) {
    throw new Error(runtimeConfig.treasuryWrites.available ? "Holder fee-sharing contracts are not configured" : runtimeConfig.treasuryWrites.reasons.join("; "));
  }
  const distributor = marketRelease(state.detail.market.marketId).holderDistributor;
  if (action === "withdrawServiceCredit") {
    const amount = await publicClient.readContract({ abi: v1Abis.TreasuryDistributorV1, address: distributor, functionName: "serviceCredit", args: [state.serviceCreditAsset, account] });
    if (amount !== state.serviceCreditAmount || amount <= 0n) throw new Error("Holder fee-sharing service credit changed; refresh before signing");
    return;
  }
  await ensureCanonicalMarket(state.detail.market);
  const [rawMarket, rawEpoch] = await Promise.all([
    publicClient.readContract({ abi: v1Abis.TreasuryDistributorV1, address: distributor, functionName: "market", args: [state.detail.market.marketId] }),
    publicClient.readContract({ abi: v1Abis.TreasuryDistributorV1, address: distributor, functionName: "epoch", args: [state.detail.market.marketId, state.epochId] }),
  ]);
  if (
    canonicalAddress(tupleString(rawMarket, "memeToken", 0), "holder fee-sharing Meme token") !== state.detail.market.memeToken
    || canonicalAddress(tupleString(rawMarket, "quoteToken", 1), "holder fee-sharing Quote token", true) !== state.detail.market.quoteAsset
    || tupleBigInt(rawMarket, "activatedAt", 3) <= 0n
  ) throw new Error("Holder fee-sharing market binding changed; refresh before signing");
  if (tupleNumber(rawEpoch, "status", 6) !== state.status) throw new Error("Holder fee-sharing epoch status changed; refresh before signing");
  if (action === "requestRoot") {
    const [rawFee, quoteAmount] = await Promise.all([
      publicClient.readContract({ abi: v1Abis.TreasuryDistributorV1, address: distributor, functionName: "rootServiceFee" }),
      publicClient.readContract({ abi: v1Abis.TreasuryDistributorV1, address: distributor, functionName: "epochQuoteAmount", args: [state.detail.market.marketId, state.epochId] }),
    ]);
    if (
      canonicalAddress(tupleString(rawFee, "asset", 0), "Root service fee asset", true) !== state.serviceFeeAsset
      || tupleBigInt(rawFee, "amount", 1) !== state.serviceFeeAmount
      || quoteAmount !== state.epochQuoteAmount
    ) throw new Error("Holder fee-sharing fee or epoch funding changed; refresh before approving or signing");
  }
  if (["claim", "finalizeRoot"].includes(action) && (
    canonicalBytes32(tupleString(rawEpoch, "merkleRoot", 11), "holder fee-sharing Merkle Root", true) !== state.merkleRoot
    || canonicalBytes32(tupleString(rawEpoch, "datasetHash", 12), "holder fee-sharing dataset hash", true) !== state.datasetHash
    || tupleNumber(rawEpoch, "leafCount", 5) !== state.leafCount
  )) throw new Error("Holder fee-sharing Root commitment changed; refresh before signing");
  if (action === "rolloverExpiredEpoch" && (
    tupleBigInt(rawEpoch, "quoteAmount", 13) !== state.quoteAmount
    || tupleBigInt(rawEpoch, "claimedAmount", 14) !== state.claimedAmount
  )) throw new Error("Holder fee-sharing epoch balance changed; refresh before signing");
}

async function executeContinuousHolderClaim(): Promise<void> {
  if (!foundation || !wallet || !continuousReward || !runtimeConfig.contracts.available || !writeReady() || !runtimeConfig.continuousHolderWrites.available) throw new Error("Load verified holder rewards first");
  const state = continuousReward;
  const activeWallet = wallet;
  const distributor = marketRelease(state.marketId).holderDistributor;
  await verifyLiveWalletContext(activeWallet);
  if (state.account !== activeWallet.account) throw new Error("Holder wallet changed");
  await executeTransaction({
    operationKey: `reward:continuous:${state.marketId}:${state.account}:${foundation.sync.revision}`,
    sync: foundation.sync,
    walletContext: activeWallet,
    request: buildContinuousHolderClaim({ distributor, marketId: state.marketId }),
    verifyChain: async () => {
      const mode = await publicClient.readContract({ abi: continuousRewardsAbi, address: distributor, functionName: "rewardMode" });
      if (!isContinuousHolderRewardMode(mode)) throw new Error("Holder reward mode changed");
      const amount = await publicClient.readContract({ abi: continuousRewardsAbi, address: distributor, functionName: "claimable", args: [state.marketId, state.account] });
      if (amount <= 0n) throw new Error("No accrued holder rewards");
    },
    confirm: async (receipt) => receiptEvent(receipt, distributor, continuousRewardsAbi, "HolderStreamClaimed", (event) =>
      event.marketId === state.marketId && String(event.account).toLowerCase() === state.account
      && String(event.asset).toLowerCase() === state.quote.toLowerCase() && typeof event.amount === "bigint" && event.amount > 0n),
  });
  toast("Holder rewards claimed", "success");
  await refreshTreasuryReward(false);
}

async function executeTreasuryAction(action: string): Promise<void> {
  if (!foundation || !wallet || !treasuryReward || !runtimeConfig.contracts.available) throw new Error("Load a verified holder fee-sharing epoch first");
  if (!runtimeConfig.treasuryWrites.available) throw new Error(runtimeConfig.treasuryWrites.reasons.join("; "));
  const activeWallet = wallet;
  const account = activeWallet.account;
  await verifyLiveWalletContext(activeWallet);
  const state = treasuryReward;
  const distributor = marketRelease(state.detail.market.marketId).holderDistributor;
  const marketId = state.detail.market.marketId;
  let request: ContractWriteRequest;
  let approval: ContractWriteRequest | undefined;
  let eventName: string;
  let serviceAssetBalanceBefore: bigint | null = null;
  if (action === "requestRoot") {
    if (state.holderBalance <= 0n) throw new Error("The connected wallet is not a current Meme holder");
    const built = buildRequestRoot({ distributor, marketId, epochId: state.epochId, serviceFeeAsset: state.serviceFeeAsset, serviceFeeAmount: state.serviceFeeAmount });
    request = built.request;
    approval = await allowanceApproval(built.approval, state.serviceFeeAsset, distributor, state.serviceFeeAmount, account);
    eventName = "RootRequested";
  } else if (action === "claim") {
    if (!state.proof) throw new Error("No locally verified holder fee-sharing proof is loaded");
    request = buildTreasuryClaim({ distributor, expectedAccount: account, proof: state.proof });
    eventName = "TreasuryClaimed";
  } else if (action === "finalizeRoot") {
    request = buildFinalizeRoot(distributor, marketId, state.epochId);
    eventName = "RootFinalized";
  } else if (action === "expireRootRequest") {
    request = buildExpireRoot(distributor, marketId, state.epochId);
    eventName = "RootRequestExpired";
  } else if (action === "rolloverExpiredEpoch") {
    request = buildRolloverEpoch(distributor, marketId, state.epochId);
    eventName = "EpochRemainderRolledOver";
  } else if (action === "withdrawServiceCredit") {
    if (state.serviceCreditAmount <= 0n) throw new Error("The connected wallet has no service credit in this asset");
    if (state.serviceCreditAsset !== ZERO_ADDRESS) {
      serviceAssetBalanceBefore = await publicClient.readContract({ abi: erc20Abi, address: state.serviceCreditAsset, functionName: "balanceOf", args: [account] });
    }
    request = buildWithdrawServiceCredit(distributor, state.serviceCreditAsset);
    eventName = "ServiceCreditWithdrawn";
  } else {
    throw new Error("This holder fee-sharing action is not exposed to holders");
  }
  await executeTransaction({
    operationKey: `reward:treasury:${action}:${marketId}:${state.epochId}:${foundation.sync.revision}`,
    sync: foundation.sync,
    request,
    ...(approval ? { approval } : {}),
    walletContext: activeWallet,
    verifyChain: () => ensureTreasuryActionState(state, action, account),
    confirm: async (receipt) => {
      if (action === "withdrawServiceCredit") {
        const event = receiptEvent(receipt, distributor, v1Abis.TreasuryDistributorV1, eventName, (eventArgs) =>
          String(eventArgs.asset).toLowerCase() === state.serviceCreditAsset
          && String(eventArgs.beneficiary).toLowerCase() === account
          && eventArgs.amount === state.serviceCreditAmount,
        );
        const creditAfter = await publicClient.readContract({ abi: v1Abis.TreasuryDistributorV1, address: distributor, functionName: "serviceCredit", args: [state.serviceCreditAsset, account], blockNumber: receipt.blockNumber });
        if (creditAfter !== 0n) throw new Error("Holder fee-sharing service credit is not zero at the receipt block");
        if (serviceAssetBalanceBefore !== null) {
          const balanceAfter = await publicClient.readContract({ abi: erc20Abi, address: state.serviceCreditAsset, functionName: "balanceOf", args: [account], blockNumber: receipt.blockNumber });
          if (balanceAfter !== serviceAssetBalanceBefore + state.serviceCreditAmount) throw new Error("ERC-20 service credit was not paid exactly");
        }
        return event;
      }
      const args = receiptEvent(receipt, distributor, v1Abis.TreasuryDistributorV1, eventName, (eventArgs) => eventArgs.marketId === marketId && Number(eventArgs.epochId ?? eventArgs.fromEpochId) === state.epochId);
      if (action === "requestRoot" && (
        String(args.requester).toLowerCase() !== account
        || args.quoteAmount !== state.epochQuoteAmount
        || String(args.serviceFeeAsset).toLowerCase() !== state.serviceFeeAsset
        || args.serviceFeeAmount !== state.serviceFeeAmount
      )) throw new Error("Root request event differs from the verified holder, funding, or service fee");
      if (action === "claim") {
        if (!state.proof || String(args.account).toLowerCase() !== account || args.leafIndex !== state.proof.leafIndex || args.twab !== state.proof.twab || args.amount !== state.proof.amount) throw new Error("Holder fee-sharing claim event differs from the verified leaf");
        const claimed = await publicClient.readContract({ abi: v1Abis.TreasuryDistributorV1, address: distributor, functionName: "accountClaimed", args: [marketId, state.epochId, account], blockNumber: receipt.blockNumber });
        if (!claimed) throw new Error("Fresh holder fee-sharing account claim flag is false");
      }
      if (action === "finalizeRoot" && (args.merkleRoot !== state.merkleRoot || typeof args.claimUntil !== "bigint" || (state.leafCount === 0 ? args.claimUntil !== 0n : args.claimUntil <= state.now))) {
        throw new Error("Finalized Root event differs from the verified commitment");
      }
      if (action === "expireRootRequest" && String(args.requester).toLowerCase() !== state.requester) {
        throw new Error("Expired Root request event differs from the recorded requester");
      }
      if (action === "rolloverExpiredEpoch" && (
        Number(args.toEpochId) <= state.epochId
        || args.amount !== state.quoteAmount - state.claimedAmount
      )) throw new Error("Holder fee-sharing rollover event differs from the expired epoch remainder");
      if (action === "finalizeRoot" && state.leafCount === 0) {
        receiptEvent(receipt, distributor, v1Abis.TreasuryDistributorV1, "EpochRemainderRolledOver", (event) =>
          event.marketId === marketId && Number(event.fromEpochId) === state.epochId && Number(event.toEpochId) > state.epochId && event.amount === state.quoteAmount);
      }
      const freshEpoch = await publicClient.readContract({ abi: v1Abis.TreasuryDistributorV1, address: distributor, functionName: "epoch", args: [marketId, state.epochId], blockNumber: receipt.blockNumber });
      const expectedStatus = action === "requestRoot" ? 1 : action === "expireRootRequest" ? 0 : action === "rolloverExpiredEpoch" || (action === "finalizeRoot" && state.leafCount === 0) ? 4 : 3;
      if (tupleNumber(freshEpoch, "status", 6) !== expectedStatus) throw new Error("Holder fee-sharing receipt-block state does not match the confirmed action");
      if (action === "finalizeRoot" && tupleBigInt(freshEpoch, "claimUntil", 3) !== args.claimUntil) {
        throw new Error("Holder fee-sharing receipt-block claim window differs from the finalized event");
      }
      return args;
    },
  });
  toast(`Holder fee-sharing ${action} confirmed from its canonical event`, "success");
  await refreshTreasuryReward(false);
}

async function runRewardAction(button: HTMLButtonElement): Promise<void> {
  const action = button.dataset.rewardAction ?? "";
  if (['rageQuit','directVaultRageQuit'].includes(action) && !await confirmFlowAction('Return all principal immediately? All unclaimed rewards in this position will be permanently forfeited to the platform.')) return;
  if (action === 'stake' && rewardPosition && rewardPosition.allocated > 0n && !await confirmFlowAction('Adding stake restarts the 24-hour lock for your entire position and normal reward claims. Continue?')) return;
  if (action === 'transferCreatorRevenueBeneficiary' && !await confirmFlowAction('Nominate this wallet to receive future creator revenue? The change takes effect only when it accepts. Past earnings stay with the recorded beneficiary.')) return;
  text("[data-rewards-action-status]", "Preparing your transaction…");
  try {
    const form = button.closest<HTMLFormElement>("form");
    if (form && !form.reportValidity()) {
      toast("Complete the highlighted Rewards fields before continuing", "error");
      return;
    }
    if (["fundQuote", "burnMeme"].includes(action)) throw new Error("Protocol integration actions are not exposed to users");
    if (action === "directVaultRageQuit") {
      await executeDirectVaultRageQuit();
    } else if (["stake", "unstakeAndWithdraw", "rageQuit"].includes(action)) {
      await executePositionAction(action, button);
    } else if (action === "settleRageQuitRewards") {
      await executeSettlement();
    } else if (action === "claimStaker") {
      await executeStakerClaim(button);
    } else if (["requestStakerRawExit", "cancelStakerRawExit", "requestCreatorRawExit", "cancelCreatorRawExit"].includes(action)) {
      await executeRawRewardExit(action);
    } else if (["claimCreator", "claimCreatorRaw", "transferCreatorRevenueBeneficiary", "acceptCreatorRevenueBeneficiary", "cancelCreatorRevenueBeneficiaryTransfer"].includes(action)) {
      await executeCreatorAction(action);
    } else if (action === "claimContinuous") {
      await executeContinuousHolderClaim();
    } else if (["requestRoot", "claim", "finalizeRoot", "expireRootRequest", "rolloverExpiredEpoch", "withdrawServiceCredit"].includes(action)) {
      await executeTreasuryAction(action);
    } else {
      throw new Error("Unknown Rewards action");
    }
    text("[data-rewards-action-status]", "Transaction confirmed. Balances refreshed.");
  } catch (error) {
    text("[data-rewards-action-status]", `Action stopped — ${errorText(error)}`);
    toast(`Rewards action stopped — ${errorText(error)}`, "error");
    updateRewardsAvailability();
  }
}

let rewardDeepLinkApplied = false;
let rewardTabLoading = false;
let rewardRefreshQueued = false;
async function refreshActiveReward(): Promise<void> {
  if (rewardTabLoading) { rewardRefreshQueued = true; return; }
  if (busyOperation || document.hidden || !isRewardsPage()) return;
  rewardTabLoading = true;
  const generation = routeGeneration;
  const button = query<HTMLButtonElement>('[data-rewards-refresh]');
  if (button) button.disabled = true;
  try {
    const tab = rewardTab(window.location.hash);
    if (tab === 'positions' || tab === 'staker') await refreshRewardPosition();
    else if (tab === 'creator') await refreshCreatorReward();
    else if (tab === 'treasury') await refreshTreasuryReward(false);
    else syncUserActivity();
  } finally {
    rewardTabLoading = false;
    if (generation === routeGeneration && button) button.disabled = false;
    if (rewardRefreshQueued) { rewardRefreshQueued = false; void refreshActiveReward(); }
  }
}
let accountBalancesRequest: AbortController | undefined;
let accountBalancesWallet: string | undefined;
function clearAccountBalances(): void {
  accountBalancesRequest?.abort(); accountBalancesRequest = undefined;
  text("[data-account-balances]", wallet ? "Finalized Vault balances unavailable." : "Connect a wallet to view finalized Vault balances.");
}
window.addEventListener("pagehide", clearAccountBalances);
document.addEventListener("visibilitychange", () => { if (document.hidden) clearAccountBalances(); });

async function refreshAccountBalances(): Promise<void> {
  const target = query<HTMLElement>("[data-account-balances]");
  if (!target) return;
  clearAccountBalances();
  const current = foundation, active = wallet;
  if (document.hidden || !current || !active || !runtimeConfig.readApi.available) return;
  const request = new AbortController(); accountBalancesRequest = request;
  const timeout = window.setTimeout(() => { request.abort(); if (accountBalancesRequest === request) target.textContent = "Vault balances unavailable. Refresh to retry."; }, 15000);
  target.textContent = "Loading finalized Vault balances…";
  try {
    const api = new TickerGardenV1Client(runtimeConfig.readApi.value, (input, init) => fetch(input, { ...init, signal: request.signal }));
    const address = active.account.toLowerCase() as Address;
    const rows = await loadWalletAccounts({ wallet: address, sync: current.sync, assets: current.assets, signal: request.signal,
      fetchPage: cursor => api.listUserAccounts({ address, revision: current.sync.revision, limit: 100, ...(cursor ? { cursor } : {}) }) });
    if (request.signal.aborted || foundation !== current || wallet !== active || accountBalancesRequest !== request) return;
    target.replaceChildren();
    if (!rows.length) target.textContent = "No Vault accounts at this finalized snapshot.";
    for (const row of rows) {
      const line = document.createElement("span"); line.style.display = "block";
      const config = current.assets.find(asset => asset.id === row.assetUid);
      const decimals = Number(config?.values.tokenDecimals);
      const amount = (raw: string) => Number.isInteger(decimals) && decimals >= 0 && decimals <= 18 ? formatTokenAmount(BigInt(raw), decimals) : `${raw} raw`;
      line.textContent = `Asset ${shortHex(row.assetUid)} · deposited ${amount(row.deposited)} · allocated ${amount(row.allocated)} · free ${amount(row.free)}`;
      line.title = `Asset ${row.assetUid}; Vault ${row.vault}`; target.append(line);
    }
  } catch {
    if (!request.signal.aborted && accountBalancesRequest === request && wallet === active && foundation === current) target.textContent = "Vault balances unavailable. Refresh to retry.";
  } finally { window.clearTimeout(timeout); }
}

async function renderRewards(): Promise<void> {
  const pageGeneration = routeGeneration;
  if (rewardTab(window.location.hash) === "positions") void refreshAccountBalances();
  const requestedMarket = new URLSearchParams(window.location.search).get("marketId")?.toLowerCase();
  if (foundation && readApi && requestedMarket && !rewardDeepLinkApplied) {
    try {
      const marketId = canonicalBytes32(requestedMarket, "Linked marketId");
      if (!foundation.markets.some((market) => market.marketId === marketId)) {
        const current = foundation;
        const detail = current.direct && directMarkets ? await directMarkets.market(marketId) : await readApi.getMarket({ marketId, revision: current.sync.revision });
        if (!current.direct) assertFinalizedSync(detail.sync, current.sync.revision, "linked staking market");
        if (pageGeneration !== routeGeneration) return;
        if (foundation !== current || detail.market.marketId !== marketId) throw new Error("Linked market snapshot changed");
        await ensureCanonicalMarket(detail.market);
        if (pageGeneration !== routeGeneration) return;
        if (foundation !== current) throw new Error("Linked market snapshot changed");
        foundation = Object.freeze({ ...current, markets: [...current.markets, detail.market] });
      }
      populateRewardMarkets();
      const select = query<HTMLSelectElement>("[data-position-market]");
      if (select) select.value = marketId;
      syncRewardMarketSelections(marketId, "position");
      queryAll<HTMLSelectElement>("[data-creator-market],[data-treasury-market]").forEach(select => { select.value = marketId; });
      rewardDeepLinkApplied = true;
    } catch (error) {
      if (pageGeneration !== routeGeneration) return;
      rewardPosition = null;
      text("[data-rewards-status]", `Linked market unavailable — ${errorText(error)}`);
      updateRewardsAvailability();
      return;
    }
  }
  populateRewardMarkets();
  text('[data-rewards-runtime-title]', wallet ? 'Your rewards' : 'Connect your wallet');
  const empty = query<HTMLElement>('[data-rewards-empty]');
  if (empty) empty.hidden = !foundation || foundation.markets.length > 0;
  if (!foundation) {
    text("[data-rewards-status]", `Rewards unavailable — ${runtimeReasons().join("; ")}`);
    if (currentPage() === "staking") await refreshDirectEscape();
    updateRewardsAvailability();
    return;
  }
  text("[data-rewards-status]", wallet
    ? "Choose a market to view your position and rewards. Each transaction is checked before signing."
    : currentPage() === "staking" ? "Connect your wallet to view positions and staking rewards." : "Connect your wallet to view and claim rewards.");
  if (!wallet) {
    if (currentPage() === "staking") await refreshDirectEscape();
    updateRewardsAvailability();
    return;
  }
  const defaultMarket = foundation.markets.find((market) => market.marketId === requestedMarket)?.marketId ?? foundation.markets.find((market) => market.launchPhase === 1)?.marketId ?? foundation.markets[0]?.marketId ?? "";
  queryAll<HTMLSelectElement>("[data-position-market],[data-staker-market],[data-settle-market],[data-creator-market]").forEach((select) => {
    if (!select.value && defaultMarket) select.value = defaultMarket;
  });
  const directMarket = query<HTMLInputElement>("[data-direct-vault-market]");
  if (directMarket && !directMarket.value && defaultMarket) directMarket.value = defaultMarket;
  const treasuryMarket = query<HTMLSelectElement>("[data-treasury-market]");
  const defaultTreasuryMarket = foundation.markets.find((market) => market.launchPhase === 1)?.marketId ?? defaultMarket;
  if (treasuryMarket && !treasuryMarket.value && defaultTreasuryMarket) treasuryMarket.value = defaultTreasuryMarket;
  const settleUser = query<HTMLInputElement>("[data-settle-user]");
  if (settleUser && !settleUser.value) settleUser.value = wallet.account;
  await refreshActiveReward();
  updateRewardsAvailability();
}

async function appendMarketPage(): Promise<void> {
  const current = foundation;
  if (!current?.marketNextCursor) return;
  const page = await readMarketPage(current.sync.revision, current.marketNextCursor);
  if (foundation !== current) throw new Error("Directory snapshot changed; refresh the list");
  if (page.nextCursor === current.marketNextCursor) throw new Error("Read API returned a repeated cursor");
  const { marketNextCursor: _cursor, ...rest } = current;
  foundation = Object.freeze({ ...rest, markets: [...new Map([...current.markets, ...page.items].map((market) => [market.marketId, market])).values()], ...(page.nextCursor ? { marketNextCursor: page.nextCursor } : {}) });
}

let stopTransactionObservation: (() => void) | undefined;
window.addEventListener("pagehide", () => stopTransactionObservation?.());

function renderRecoveryControls(): void {
  const generation = routeGeneration;
  stopTransactionObservation?.();
  stopTransactionObservation = undefined;
  let panel = query<HTMLElement>("[data-runtime-recovery]");
  if (!panel) {
    panel = document.createElement("div");
    panel.dataset.runtimeRecovery = "";
    panel.className = "runtime-recovery";
    (query<HTMLElement>("main") ?? document.body).prepend(panel);
  }
  panel.replaceChildren();
  if (foundation?.marketNextCursor && isRewardsPage()) {
    const more = document.createElement("button");
    more.textContent = "Load next 100 markets";
    more.onclick = async () => {
      more.disabled = true;
      try { await appendMarketPage(); if (generation === routeGeneration) await refreshCurrentPage(true); }
      catch (error) { if (generation === routeGeneration) toast(`${errorText(error)}. Reload the page to restart the market list.`, "warning"); more.disabled = false; }
    };
    panel.append(more);
  }
  if (isRewardsPage() && foundation && readApi) {
    const marketInput = document.createElement("input");
    marketInput.placeholder = "Load a reward market by marketId";
    marketInput.name="marketId"; marketInput.required=true; marketInput.pattern="0x[0-9a-fA-F]{64}";
    marketInput.setAttribute("aria-label", "Reward market ID");
    const load = document.createElement("button");
    load.textContent = "Load market ID";
    load.onclick = async () => {
      load.disabled = true;
      try {
        const marketId = canonicalBytes32(marketInput.value.trim().toLowerCase(), "marketId");
        const current = foundation!;
        const detail = current.direct && directMarkets ? await directMarkets.market(marketId) : await readApi!.getMarket({ marketId, revision: current.sync.revision });
        if (generation !== routeGeneration) return;
        if (!current.direct) assertFinalizedSync(detail.sync, current.sync.revision, "reward directory lookup");
        if (detail.market.marketId !== marketId || foundation !== current) throw new Error("Market identity or snapshot changed");
        if (!current.markets.some((market) => market.marketId === marketId)) foundation = { ...current, markets: [...current.markets, detail.market] };
        const search = query<HTMLInputElement>("[data-position-search]");
        if (search) search.value = "";
        populateRewardMarkets();
        queryAll<HTMLSelectElement>("[data-position-market],[data-staker-market],[data-settle-market],[data-creator-market],[data-treasury-market]").forEach((select) => { select.value = marketId; });
        await refreshActiveReward();
      } catch (error) { if (generation === routeGeneration) toast(errorText(error), "warning"); }
      finally { load.disabled = false; }
    };
    const advanced = document.createElement("details"); const summary = document.createElement("summary"); summary.textContent = "Find a market by ID"; advanced.append(summary, marketInput, load);
    const lookup = query<HTMLElement>("[data-claim-market-lookup]");
    if (lookup) lookup.replaceChildren(advanced); else panel.append(advanced);
  }
  if (wallet) {
    const active = wallet;
    let pending: ReturnType<typeof active.executor.pending> = null;
    try { pending = active.executor.pending(active.account); }
    catch { const note = document.createElement('p'); note.textContent = 'Your saved transaction record cannot be read. Check wallet history before trying another transaction; no transaction has been resent.'; panel.append(note); }
    if (pending && !launchProgress) {
      const description = document.createElement("span");
      description.textContent = `${pending.approval ? 'Token approval' : 'Transaction'} awaiting confirmation. `;
      const explorer = document.createElement('a'); explorer.textContent = 'View transaction'; explorer.href = `${robinhoodChain.blockExplorers.default.url}/tx/${pending.hash}`; explorer.target = '_blank'; explorer.rel = 'noopener noreferrer'; panel.append(explorer);
      const recover = document.createElement("button");
      recover.textContent = "Check existing transaction";
      recover.onclick = () => { void runPageAction(async () => {
        recover.disabled = true;
        try {
          const result = await active.executor.reconcilePending(active.account);
          const succeeded = result?.receipt.status === "success" && !result.cancelled;
          toast(result?.cancelled ? "Existing transaction was cancelled." : succeeded
            ? result.approval ? "Approval confirmed. The business transaction has not been resubmitted; request a fresh quote." : "Existing transaction succeeded. Review refreshed balances before creating another order."
            : "Existing transaction reverted; no replacement was submitted.", succeeded ? "success" : "warning");
          await loadFoundation();
          await refreshCurrentPage();
        } catch (error) { toast(`Still unconfirmed — ${errorText(error)}`, "warning"); recover.disabled = false; }
      }); };
      panel.append(description, recover);
      if (runtimeConfig.readApi.available) {
        stopTransactionObservation = mountTransactionObservation(panel, runtimeConfig.readApi.value, robinhoodChain.id, pending.hash);
      }
    }
  }
  panel.hidden = panel.childElementCount === 0;
}

async function refreshCurrentPage(preserveSnapshot = false): Promise<void> {
  const generation = routeGeneration;
  if (isStaticPage()) { renderWallet(); return; }
  if (integrationBootstrapPath && !foundation) await loadFoundation();
  if (!integrationBootstrapPath && readApi && !busyOperation && !preserveSnapshot) {
    try {
      const health = await readApi.getHealth();
      if (generation !== routeGeneration) return;
      if (!foundation || health.sync.revision !== foundation.sync.revision) await loadFoundation();
    } catch (error) {
      if (generation !== routeGeneration) return;
      foundation = null; foundationError = errorText(error); invalidateSnapshotReads();
    }
  }
  if (generation !== routeGeneration) return;
  renderWallet();
  renderRecoveryControls();
  switch (currentPage()) {
    case "home": await renderHome(); break;
    case "markets": await renderMarkets(); break;
    case "trade":
      if (tradeMarket) await loadTradeMarket(tradeMarket.market.marketId);
      else {
        const marketId = query<HTMLInputElement>("[data-market-id]")?.value.trim().toLowerCase() ?? "";
        if (BYTES32_PATTERN.test(marketId)) await loadTradeMarket(marketId);
        else { text("[data-detail-phase]", "Choose a market"); text("[data-detail-phase-note]", "Open a token from Explore to trade."); updateTradeAvailability(); }
      }
      break;
    case "create": renderCreateConfig(); break;
    case "stats": await renderStats(); break;
    case "staking":
    case "rewards": await renderRewards(); break;
    case "docs": setPageStatus("Docs loaded. Runtime-dependent actions are documented as fail-closed.", "success"); break;
  }
  refreshActionAvailability();
  if (foundation?.direct) void refreshDirectDirectory();
}

function invalidateWalletReads(): void {
  syncUserActivity();
  invalidateSnapshotReads();
  ++directEscapeLoadGeneration;
  directEscape = null;
  refreshActionAvailability();
}

function invalidateSnapshotReads(): void {
  clearAccountBalances();
  if (currentPage() === "trade") clearTradeMarketState();
  else displayPriceWidget?.setToken(null);
  homeRender.invalidate();
  clearHomeMarketView();
  marketsRender.invalidate();
  marketDirectory.reset();
  clearMarketDirectoryView();
  statsRender.invalidate();
  clearStatsSnapshotView("Market snapshot unavailable. Waiting for a verified snapshot.");
  metadataCache.clear();
  verifiedMarketReleases.clear();
  verifiedMarketRuntime.clear();
  ++tradeLoadGeneration;
  ++tradeQuoteGeneration;
  ++launchPreviewGeneration;
  ++rewardLoadGeneration;
  ++creatorLoadGeneration;
  ++treasuryLoadGeneration;
  tradeQuote = null;
  launchPreview = null;
  rewardPosition = null;
  creatorReward = null;
  treasuryReward = null;
  continuousReward = null;
  setContinuousRewardsView(false);
  window.clearTimeout(tradeQuoteTimer);
  window.clearTimeout(tradeQuoteExpiryTimer);
  window.clearTimeout(launchPreviewTimer);
}

function startSnapshotUpdates(): void {
  if (integrationBootstrapPath || !runtimeConfig.readApi.available || snapshotPoller) return;
  const baseUrl = runtimeConfig.readApi.value;
  const poller = createSnapshotPoller({
    chainId: robinhoodChain.id,
    canPoll: () => !isStaticPage() && !pageActionPending && !busyOperation && !walletConnecting && !loadingFoundation && !document.hidden,
    fetchUpdate: (since, signal) => new TickerGardenV1Client(baseUrl, (input, init) => fetch(input, { ...init, signal })).getSnapshotUpdates(since && foundation ? { since } : {}),
    prepare: async (update, signal) => {
      const generation = ++foundationGeneration;
      const activeWallet = wallet;
      const api = new TickerGardenV1Client(baseUrl, (input, init) => fetch(input, { ...init, signal }));
      const next = await prepareFoundation(api, update.sync);
      return () => {
        if (generation !== foundationGeneration || busyOperation || activeWallet !== wallet) throw new SnapshotRefreshSuperseded("Snapshot refresh superseded");
        invalidateSnapshotReads();
        foundation = next;
        foundationError = "";
        analyticsRefresh.request();
        refreshActionAvailability();
        void refreshCurrentPage(true).catch(error => {
          if (foundation !== next) return;
          foundation = null;
          foundationError = errorText(error);
          pauseAnalytics();
          invalidateSnapshotReads();
          refreshActionAvailability();
          poller.reconnect();
        });
      };
    },
    unavailable: error => {
      if (busyOperation) return;
      ++foundationGeneration;
      foundation = null;
      foundationError = errorText(error);
      pauseAnalytics();
      invalidateSnapshotReads();
      refreshActionAvailability();
      setPageStatus("Live data unavailable. Reconnecting…", "warning");
    },
  });
  window.addEventListener("online", () => poller.reconnect());
  window.addEventListener("offline", () => {
    poller.stop();
    if (busyOperation) return;
    ++foundationGeneration;
    foundation = null;
    foundationError = "Network unavailable";
    pauseAnalytics();
    invalidateSnapshotReads();
    refreshActionAvailability();
  });
  window.addEventListener("pagehide", () => poller.stop());
  window.addEventListener("pageshow", event => { if (event.persisted) poller.reconnect(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) { poller.stop(); pauseAnalytics(); marketsRender.invalidate(); marketDirectory.reset(); clearMarketDirectoryView(); } else poller.reconnect(); });
  snapshotPoller = poller;
  if (!isStaticPage()) poller.start();
}

function isStaticPage(): boolean {
  const page = currentPage();
  return page === "privacy" || page === "terms" || page === "risks" || page === "docs" || page === "not-found";
}

let disposeFieldValidation: (() => void) | undefined;
function unmountPage(): void {
  disposeFieldValidation?.(); disposeFieldValidation=undefined;
  snapshotPoller?.stop();
  ++foundationGeneration;
  pauseAnalytics();
  userActivityWidget?.stop();
  displayPriceWidget?.stop();
  stopTransactionObservation?.(); stopTransactionObservation = undefined;
  disposeVisuals?.(); disposeVisuals = undefined;
  queryAll<HTMLSelectElement>("[data-quote-picker] select").forEach(destroyQuotePicker);
  window.clearInterval(rewardRefreshTimer);
  window.clearInterval(tradePhaseTimer);
  window.clearTimeout(directEscapeRefreshTimer);
  invalidateSnapshotReads();
  ++directEscapeLoadGeneration; directEscape = null;
  ++launchImageGeneration; launchImageReading = false; launchImage = undefined;
  preparedMetadataURI = ""; preparedMetadataKey = "";
  launchSalt = randomSalt();
  tradeMarket = null; tradeMetadata = null; tradeSide = "buy";
  marketPhaseFilter = "bloomed"; statsPeriod = "24h"; rewardDeepLinkApplied = false; syncRewardHash = undefined;
  userActivityWidget = null; globalHoldersWidget = null; seriesWidget = null;
  globalStatsWidgets = []; analyticsWidgets = [];
  tokenDetailWidget?.stop();tokenDetailWidget=null;detailContentAbort?.abort();detailContentAbort=null;
  holderWidget = null; tradeHistoryWidget = null; candleWidget = null; displayPriceWidget = null;
}

function mountRoute(route: Route): void {
  const generation = ++routeGeneration;
  unmountPage();
  const page = pages[route.page];
  document.body.dataset.page = route.page;
  document.title = page.title;
  const outlet = required<HTMLElement>("[data-route-outlet]");
  if (route.page === "trade" && new URLSearchParams(route.search).get("preview") === "sample") {
    document.title = "Garden Cat — Sample preview — TickerGarden";
    mountTradePreview(outlet);
    setupShell();
    renderWallet();
    query<HTMLButtonElement>("[data-wallet]")?.addEventListener("click", event => {
      event.stopImmediatePropagation();
      required<HTMLDialogElement>(".ref-dialog").showModal();
    }, { capture: true });
    return;
  }
  outlet.innerHTML = page.html;
  setupShell();
  renderWallet();
  mountPageWidgets();
  disposeFieldValidation=mountFieldValidation(outlet,field=>{
    if(field.matches('[data-reward-amount]'))return rewardPosition?.asset.tokenDecimals;
    if(field.matches('[data-trade-amount]'))return tradeSide==='sell'?18:tradeMetadata?.quoteDecimals;
    if(field.name==='firstBuyAmount'){const id=query<HTMLSelectElement>('[name=quoteAssetConfigId]')?.value;return Number(foundation?.quotes.find(q=>q.id===id)?.values.quoteDecimals??18);}
    return undefined;
  });
  disposeVisuals = mountPageVisuals(outlet);
  switch (route.page) {
    case "markets": setupMarkets(); break;
    case "trade": setupTrade(); break;
    case "create": setupCreate(); break;
    case "stats": setupStats(); break;
    case "staking":
    case "rewards": setupRewards(); break;
    case "docs": setupDocs(); break;
  }
  if (isStaticPage()) { refreshActionAvailability(); return; }
  void (async () => {
    if (!foundation) await loadFoundation();
    if (generation !== routeGeneration) return;
    await refreshCurrentPage();
    if (generation === routeGeneration) snapshotPoller?.reconnect();
  })().catch(error => {
    if (generation !== routeGeneration) return;
    foundationError = errorText(error);
    setPageStatus(`Runtime initialization failed — ${foundationError}`, "error");
    text("[data-rewards-status]", `Runtime initialization failed — ${foundationError}`);
    refreshActionAvailability();
  });
}

const router = createRouter({
  render: mountRoute,
  canNavigate: () => !pageActionPending && !busyOperation && !walletConnecting && !launchSubmitting,
  blocked: () => toast("Finish the current wallet operation before leaving this page.", "warning"),
  hashChanged: () => { if (isRewardsPage()) syncRewardHash?.(); },
});
router.start();
void restoreLaunchProgress();
startSnapshotUpdates();
if (import.meta.hot) import.meta.hot.dispose(() => { if(launchRecoveryTimer)clearTimeout(launchRecoveryTimer);closeLaunchProgress();router.stop(); unmountPage(); });

let directDirectoryBusy=false;
let directDirectoryReadAt=0;
async function refreshDirectDirectory():Promise<void>{
 if(directDirectoryBusy||!directMarkets||!runtimeConfig.readApi.available||document.hidden||isStaticPage())return;
 directDirectoryBusy=true;
 try{
  const feed=await integrationFeed(runtimeConfig.readApi.value);
  for(const e of feed.events){const l=e.payload;directMarkets.observe({address:l.address,topics:l.topics,data:l.data,blockNumber:BigInt(e.blockNumber),blockHash:e.blockHash as Hex,transactionHash:l.transactionHash,transactionIndex:Number(BigInt(l.transactionIndex)),logIndex:Number(BigInt(l.logIndex))});}
  if((currentPage()==="home"||currentPage()==="markets"||isRewardsPage())&&foundation?.direct){
   const refreshStates=Date.now()-directDirectoryReadAt>10*60_000;
   const previous=new Map(foundation.markets.map(m=>[m.marketId,m]));
   const records=await mapConcurrent([...directMarkets.sources.keys()].slice(currentPage()==="home"?-10:-20),async id=>!refreshStates&&previous.has(id)?previous.get(id)!:await directMarkets!.market(id).then(x=>x.market).catch(()=>null),2);
   if(refreshStates)directDirectoryReadAt=Date.now();
   const markets=records.filter((x):x is MarketReadModel=>x!==null);
   if(JSON.stringify(foundation.markets)!==JSON.stringify(markets)){foundation=Object.freeze({...foundation,markets});if(currentPage()==="home")await renderHome();else if(isRewardsPage())populateRewardMarkets();else await renderMarkets();}
  }
 }catch{/* Query history is optional and cannot disable wallet interactions. */}finally{directDirectoryBusy=false;}
}
if(integrationBootstrapPath)setInterval(()=>void refreshDirectDirectory(),5_000);
