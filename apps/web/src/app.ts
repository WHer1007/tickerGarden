import { rewardClaimDialog } from './ui/reward-claim-dialog.ts';
import { userClaimsAbi, USER_CLAIM_MODE, DUAL_HOLDER_MODE, userClaimOutcome } from './v1/features/userClaims.ts';
import {statisticsUSD, statisticsFresh} from "./v1/statisticsValue.ts";
import {cachedStatistics} from './v1/statisticsCache.ts';
import {createExplorePager} from './v1/explorePaging.ts';
import {tokenAge} from './ui/token-age.ts';
import {setupExploreStockPicker} from './ui/explore-stock-picker.ts';
import {authorizeUpload} from './create/upload-auth.ts';
import {searchHolderMarkets, type HolderMarket} from './v1/holderMarkets.ts';
import {loadCreatorMarkets} from './v1/creatorMarkets.ts';
import {ownsCreatorRewards} from './v1/creatorOwnership.ts';
import {stakeProgress,stakeLockLabel} from './ui/stake-progress.ts';
import {explorerStakeStatistics,explorerFeeDistribution} from './v1/stakeStatistics.ts';
import {bindStakeAmountInput} from './ui/stake-amount-input.ts';
import {decodeRecentTrade,explorerRecentTrades,explorerCurveVolume24h} from './v1/recentTrades.ts';
import {encodeAbiParameters,keccak256,parseUnits} from 'viem';
import {overviewJson,explorerHolders,nativeUsd,poolSpotPrice,type MarketOverview} from './v1/marketOverview.ts';
import {displayPriceView} from './v1/displayPrices.ts';
import {createTradeTransactionStatus} from './ui/trade-transaction-status.ts';
import {watchWalletAccount} from './ui/wallet-account-sync.ts';
import {curveTradeMetrics, curveBuyFee, antiSnipeBps, formatTradePrice} from './v1/tradePricing.ts';
import {confirmLaunch} from './create/confirm-launch.ts';
import {quoteIconUrl, assetLogoUrl} from './create/quote-icons.ts';
import {stakingAssetForConfig, isListedStakingAsset} from './create/staking-assets.ts';
import {allocatedFeeTotals, validateStakePositions, stakeHistoryEvent, stakeAfter, stakeShare} from './v1/stakingView.ts';
import {validateTokenDetail, displayDecimal} from './v1/tokenDetail.ts';
import {validateUserActivity} from './v1/userActivity.ts';
import type {PositionPage, UserActivityPage} from './v1/generated/read-api.ts';
import { tradingRoute, stakerClaimHelp, rewardTab } from "./v1/flowUx.ts";
import { readCreateDraft, writeCreateDraft, clearCreateDraft, type CreateDraft } from "./create/draft.ts";
import {graduationProgress} from "./v1/graduationProgress.ts";
import {PERMIT2,poolSlot0,poolStateAbi,poolProtocolFee,formatPoolProtocolFee,poolRouterAbi,poolQuoterAbi,permit2Abi,poolSwapAbi,assertPoolRouterProfile,poolTradeRoute,poolAmount,buildPoolTrade} from "./v1/poolTrade.ts";
import { assertRecoveredLaunchReceipt } from "./create/launch-confirmation.ts";
import { renderLaunchProgress, closeLaunchProgress } from "./create/launch-progress-dialog.ts";
import { readLaunchState, saveLaunchState, launchStateKey, launchPhaseDisplay, type LaunchState, type LaunchPhase } from "./create/launch-state.ts";
import { ipfsGatewayURL, isIPFSFileURI } from "./create/ipfs.ts";
import { renderListingPanel } from "./create/listing-panel.ts";
import { parseSavedListing, type ListingPackageSnapshot } from "./create/listing-package.ts";
import { DeveloperBuyBalanceCache, developerBuyNotice } from './create/developer-buy.ts';
import { feePreviewTable } from './create/fee-preview.ts';
import { mountFieldValidation, fieldError } from './ui/fieldValidation.ts';
import { createDisabledReason, createDisabledLevel, type CreateAvailability, type CreateNoticeLevel } from './v1/createAvailability.ts';
import {integrationFeed,integrationMarketDirectory} from "./v1/integrationFeed.ts";
import {mountDirectTrades} from "./v1/directTradeWidget.ts";
import {directReceipt} from "./v1/directReceipt.ts";
import {DirectMarkets} from "./v1/directMarkets.ts";
import {parseIntegrationBootstrap,bootstrapSync,type IntegrationBootstrap} from "./v1/integrationBootstrap.ts";
import { mountTokenDetail } from './v1/tokenDetailWidget.ts';
import { readDetailMetadata } from './v1/tokenMetadata.ts';
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
import { HOLDER_REWARDS_DISTRIBUTOR_V1_ABI as continuousRewardsAbi, isContinuousHolderRewardMode } from "./v1/features/continuousRewards.ts";
import { createCoalescedRefresh } from "./v1/coalescedRefresh.ts";
import { summarizeMarkets, sumStatisticsUSD } from "./v1/statsSummary.ts";
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
  formatUnits,
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
const runtimeRpcUrl = import.meta.env.PROD && typeof window !== 'undefined'
  ? new URL('/api/rpc', window.location.origin).toString()
  : import.meta.env.VITE_V1_RPC_URL || robinhoodChain.rpcUrls.default.http[0];
const publicClient = createPublicClient({
  chain: robinhoodChain,
  transport: http(runtimeRpcUrl),
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
let detailBalances: {quote?:bigint;meme?:bigint}|null=null;
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
  seriesWidget = series ? mountGlobalSeries(series, base, robinhoodChain.id, address=>statsAsset(address).label) : null;
  globalStatsWidgets = [];
  queryAll<HTMLElement>("[data-global-statistics]").forEach(element=>{
    const disclosure=element.closest('details');
    if(element.hasAttribute('data-stats-lazy')&&disclosure){let mounted=false;disclosure.addEventListener('toggle',()=>{if(disclosure.open&&!mounted){mounted=true;const widget=mountGlobalStatistics(element,base,robinhoodChain.id);globalStatsWidgets.push(widget);analyticsWidgets.push({refresh:()=>disclosure.open?widget.refresh():Promise.resolve(),stop:()=>widget.stop()});}});}
    else globalStatsWidgets.push(mountGlobalStatistics(element,base,robinhoodChain.id));
  });
  analyticsWidgets = [...globalStatsWidgets, globalHoldersWidget, seriesWidget].filter((widget): widget is NonNullable<typeof widget> => widget !== null);
  const holder = query<HTMLElement>("[data-market-holders]");
  holderWidget = holder ? mountHolders(holder, base, robinhoodChain.id, (page) => {
    text('[data-detail-holders]', page ? `${page.positiveAddressCount.toLocaleString()} addresses` : '-');
    text('[data-detail-supply]', page ? formatTokenAmount(page.totalSupplyRaw, 18) : '-');
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
  if (element) {const next=publicMessage(value);if(element.textContent!==next)element.textContent=next;}
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
  if (!foundation) return ["Loading Market Data"];
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
    directMarkets ??= new DirectMarkets(b,(address,abi,functionName,args,blockNumber)=>publicClient.readContract({address,abi,functionName,args,blockNumber}),async()=>{const h=await publicClient.getBlock({blockTag:"latest"});return {number:h.number,hash:h.hash};},localStorage,async(id)=>{
      // Reuse the gateway's persisted Factory receipt evidence; no historical block scan.
      const endpoint=new URL(`/market-creation/${id}`,import.meta.env.VITE_V1_RPC_URL || robinhoodChain.rpcUrls.default.http[0]);
      const response=await fetch(endpoint,{signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw Error('Market discovery unavailable. Retry shortly.');
      const result=await response.json();
      if(typeof result.transactionHash==='string'&&/^0x[0-9a-f]{64}$/.test(result.transactionHash)){
        directMarkets?.receipt(await publicClient.getTransactionReceipt({hash:result.transactionHash as Hex}));
      }
    });
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
        readHolderDistributor(configured.factoryAddress),
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
    readHolderDistributor(token),
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
    readHolderDistributor(release.factory),
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
        if(tradeSubmitting||stakeSubmitting)return;
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

function confirmFlowAction(message: string, options:{title?:string;confirmLabel?:string;content?:HTMLElement}={}): Promise<boolean> {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog'); dialog.className = 'flow-confirm';
    dialog.setAttribute('aria-label', options.title ?? 'Confirm action');
    const heading = document.createElement('h2'); heading.textContent = options.title ?? 'Confirm action';
    const description = options.content ?? document.createElement('p');
    if (!options.content) { description.textContent = message; description.style.whiteSpace='pre-line'; }
    else dialog.classList.add('launch-confirm');
    description.id = 'flow-confirm-description';
    dialog.setAttribute('aria-describedby', description.id);
    const controls = document.createElement('div'); controls.className = 'flow-confirm-controls';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel'; cancel.autofocus = true;
    const confirm = document.createElement('button'); confirm.type = 'button'; confirm.textContent = options.confirmLabel ?? 'Confirm';
    let settled = false;
    const finish = (accepted: boolean) => { if (settled) return; settled = true; dialog.close(); dialog.remove(); resolve(accepted); };
    cancel.onclick = () => finish(false); confirm.onclick = () => finish(true);
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
    dialog.addEventListener('close', () => finish(false));
    controls.append(cancel, confirm); dialog.append(heading, description, controls); document.body.append(dialog); dialog.showModal();
  });
}

const tradeTxStatus=createTradeTransactionStatus(robinhoodChain.blockExplorers.default.url);
let tradeSubmitting=false;
let tradeSubmittingLabel='Preparing…';
let tradeAwaitingConfirmation=false;
let stakeSubmitting=false;
let stakeSubmittingLabel='Preparing Stake…';
function renderStakeSubmit():void {
  const button=query<HTMLButtonElement>('[data-reward-action="stake"]');if(!button)return;
  const label=stakeSubmitting?stakeSubmittingLabel:'Stake';
  button.setAttribute('aria-busy',String(stakeSubmitting));
  if(button.dataset.progressLabel===label)return;
  button.dataset.progressLabel=label;button.replaceChildren();
  if(stakeSubmitting){const icon=document.createElement('i');icon.className='ph ph-spinner-gap trade-tx-spinner';icon.setAttribute('aria-hidden','true');button.append(icon);}
  button.append(document.createTextNode(label));
}
function showTransactionUpdate(update: TransactionUpdate): void {
  if(stakeSubmitting){
    const progress=stakeProgress(update.stage);stakeSubmittingLabel=progress.label;
    text('[data-stake-transaction-status]',progress.message);
    const status=query<HTMLElement>('[data-stake-transaction-status]');if(status)status.dataset.state=update.stage==='failed'?'error':'pending';
    renderStakeSubmit();return;
  }
  if(currentPage()==='staking'){
    text('[data-rewards-action-status]',update.stage==='confirmed'?'Transaction Confirmed':transactionStageLabels[update.stage]);
    return;
  }
  if(tradeSubmitting){
    tradeSubmittingLabel=['awaiting_signature','awaiting_approval_signature'].includes(update.stage)?'Confirm In Wallet…':['submitted','pending','replaced','approval_submitted'].includes(update.stage)?'Confirming…':update.stage==='confirmed'?'Confirmed':'Processing…';
    if(update.hash&&['submitted','pending','replaced','approval_submitted'].includes(update.stage))tradeAwaitingConfirmation=true;
    if(['confirmed','failed'].includes(update.stage))tradeAwaitingConfirmation=false;
    tradeTxStatus.update(update,tradeMetadata?{side:tradeSide,symbol:tradeMetadata.symbol,inputSymbol:tradeSide==='buy'?tradeMetadata.quoteSymbol:tradeMetadata.symbol}:undefined);updateTradeAvailability();return;
  }
  if (launchProgress) return;
  text('[data-stake-transaction-status]',`${transactionStageLabels[update.stage]}${update.error ? ': '+errorText(update.error) : ''}`);
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
    button.setAttribute("aria-label",open?"Close Navigation":"Open Navigation");
  });
  header.onkeydown=(event)=>{if(event.key==='Escape'&&header.classList.contains('nav-open')){header.classList.remove('nav-open');const menu=header.querySelector<HTMLButtonElement>('[data-menu]');menu?.setAttribute('aria-expanded','false');menu?.setAttribute('aria-label','Open Navigation');menu?.focus();}};
}

function renderWallet(): void {
  walletPicker?.refresh();
  if(tradeMarket && tradeStakeAccount!==wallet?.account) void refreshTradeStake();
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

let stopWalletAccountSync:(()=>void)|undefined;

function invalidateWallet(): void {
  walletPicker?.forget();
  stopTransactionObservation?.();
  stopWalletAccountSync?.();stopWalletAccountSync=undefined;
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
  stopWalletAccountSync?.();stopWalletAccountSync=undefined;
  wallet = { account, provider, executor };
  invalidateWalletReads();
  stopWalletAccountSync=watchWalletAccount(provider,robinhoodChain.id,{
    invalidate(){wallet=null;stopTransactionObservation?.();invalidateWalletReads();renderWallet();},
    update(account){installWallet(provider,canonicalAddress(account,'Wallet account'));},
    disconnect:invalidateWallet,
  });
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
  stopWalletAccountSync?.();stopWalletAccountSync=undefined;
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

function formatMarketUSD(value: string | null | undefined, compact = false, compactDigits = 1): string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)) return "-";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return `$${value}`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: amount >= (compact ? 1_000 : 1_000_000) ? "compact" : "standard", minimumFractionDigits: compact && amount >= 1_000 ? 0 : undefined, maximumFractionDigits: compact && amount >= 1_000 ? compactDigits : amount < 1 ? 4 : 2 }).format(amount);
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
  const key = `${robinhoodChain.id}:${market.memeToken}:${market.quoteAssetConfigId}`;
  const existing = metadataCache.get(key);
  if (existing) return existing;
  const pending = (async () => {
    const quoteConfig = findQuote(market.quoteAssetConfigId);
    const [name, symbol, metadataURI, deployedAt] = await Promise.all([
      market.identity ? Promise.resolve(market.identity.name) : publicClient.readContract({ abi: erc20Abi, address: canonicalAddress(market.memeToken, "Meme token"), functionName: "name" }),
      market.identity ? Promise.resolve(market.identity.symbol) : publicClient.readContract({ abi: erc20Abi, address: canonicalAddress(market.memeToken, "Meme token"), functionName: "symbol" }),
      market.identity ? Promise.resolve(market.identity.metadataURI) : publicClient.readContract({abi:v1Abis.TickerMemeTokenV1,address:canonicalAddress(market.memeToken,'Meme token'),functionName:'metadataURI'}),
      market.identity ? Promise.resolve(market.identity.deployedAt) : publicClient.readContract({abi:v1Abis.TickerMemeTokenV1,address:canonicalAddress(market.memeToken,'Meme token'),functionName:'deployedAt'}).then(String),
    ]);
    if (market.quoteAsset === ZERO_ADDRESS) return Object.freeze({ name, symbol, metadataURI, deployedAt, quoteSymbol: "ETH", quoteDecimals: 18 });
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
    return Object.freeze({ name, symbol, metadataURI, deployedAt, quoteSymbol, quoteDecimals });
  })();
  metadataCache.set(key, pending);
  if (metadataCache.size > 256) metadataCache.delete(metadataCache.keys().next().value!);
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
const exploreCreatedAt=new Map<string,string>();
type ExploreStat={marketId:string;metrics?:MarketReadModel['metrics'];lastBuy?:MarketReadModel['lastBuy'];observedAt:number;launchPhase?:string};
let exploreStatistics:Record<string,ExploreStat>={};
let exploreStatisticsAt=0;
let exploreStatisticsRequest:Promise<boolean>|null=null;
const exploreVisiblePage:{0:number;1:number}={0:1,1:1};
const exploreFrozenRows=new Map<string,MarketReadModel[]>();
async function refreshExploreStatistics():Promise<boolean>{
 if(!foundation||!runtimeConfig.readApi.available||Date.now()-exploreStatisticsAt<15_000)return false;
 if(exploreStatisticsRequest)return exploreStatisticsRequest;
 const markets=foundation.markets.map(m=>m.marketId);
 const statisticsBase=runtimeConfig.readApi.value;
 exploreStatisticsRequest=(async()=>{
  let merged:Record<string,ExploreStat>={};
  for(let i=0;i<Math.max(markets.length,1);i+=100){
   const url=new URL('/v1/market-statistics',statisticsBase);url.searchParams.set('markets',markets.slice(i,i+100).join(','));
   const response=await fetch(url,{signal:AbortSignal.timeout(15_000)});if(!response.ok)return false;
   const data=await response.json();if(data.chainId!==robinhoodChain.id||data.displayOnly!==true||!data.items||typeof data.items!=='object')return false;
   for(const [id,raw]of Object.entries(data.items)){
    const value=raw as ExploreStat;if(value.marketId!==id||!/^0x[0-9a-f]{64}$/.test(id))continue;
    if(value.metrics?.marketCapUsd!=null&&!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value.metrics.marketCapUsd))continue;
    if(value.lastBuy&&!['blockNumber','transactionIndex','logIndex','timestamp'].every(key=>/^(0|[1-9][0-9]*)$/.test((value.lastBuy as unknown as Record<string,string>)[key]??'')))continue;
    merged[id]=value;
   }
  }
  const ranking=(items:Record<string,ExploreStat>)=>JSON.stringify(Object.keys(items).sort().map(id=>[id,items[id]!.metrics?.marketCapUsd,items[id]!.lastBuy]));
  const changed=ranking(merged)!==ranking(exploreStatistics);exploreStatistics=merged;exploreStatisticsAt=Date.now();return changed;
 })().catch(()=>false).finally(()=>{exploreStatisticsRequest=null;});
 return exploreStatisticsRequest;
}

async function fetchExplorePage(params:DirectoryQuery,cursor:string|undefined,limit:number,signal:AbortSignal){
 if(!foundation)throw Error('Market Directory Unavailable');
 if(!foundation.direct){
  if(!runtimeConfig.readApi.available)throw Error('Read API Unavailable');
  const page=await new TickerGardenV1Client(runtimeConfig.readApi.value,(input,init)=>fetch(input,{...init,signal})).listMarkets({...params,limit,...(cursor?{cursor}:{})});
  assertFinalizedSync(page.sync,params.revision,'explore page');
  if(page.items.some(m=>m.launchPhase!==params.launchPhase))throw Error('Unexpected Market Stage');
  return {...page,items:page.items.map(market=>{
   const statistics=exploreStatistics[market.marketId];
   return statistics?{...market,metrics:statistics.metrics,lastBuy:statistics.lastBuy}:market;
  })};
 }
 const search=(params.search??'').toLowerCase();
 const frozenKey=JSON.stringify(params);
 const directory=cursor?exploreFrozenRows.get(frozenKey)??foundation.markets:foundation.markets.map(m=>({...m,...(exploreStatistics[m.marketId]?{metrics:exploreStatistics[m.marketId]!.metrics,lastBuy:exploreStatistics[m.marketId]!.lastBuy}:{})}));
 if(!cursor)exploreFrozenRows.set(frozenKey,[...directory]);
 const rows=directory.filter(m=>m.launchPhase===params.launchPhase&&(!params.assetUid||m.assetUid===params.assetUid)&&(!search||`${m.memeToken} ${m.identity?.name??exploreIdentities.get(m.memeToken)?.name??''} ${m.identity?.symbol??exploreIdentities.get(m.memeToken)?.symbol??''}`.toLowerCase().includes(search)));
 const compareDecimal=(a:string|undefined|null,b:string|undefined|null)=>{
  const valid=(v:unknown):v is string=>typeof v==='string'&&/^\d+(\.\d+)?$/.test(v);
  if(!valid(a))return valid(b)?1:0;if(!valid(b))return -1;
  const [ai,af='']=a.split('.'),[bi,bf='']=b.split('.');const precision=Math.max(af.length,bf.length);
  const av=BigInt(ai!+af.padEnd(precision,'0')),bv=BigInt(bi!+bf.padEnd(precision,'0'));return av===bv?0:av>bv?-1:1;
 };
 const compareRecentBuy=(a:MarketReadModel,b:MarketReadModel)=>{
  type RecentBuy={blockNumber:string;transactionIndex:string;logIndex:string;timestamp:string};
  const left=(a as MarketReadModel&{lastBuy?:RecentBuy}).lastBuy;
  const right=(b as MarketReadModel&{lastBuy?:RecentBuy}).lastBuy;
  if(!left||!right)return left? -1:right?1: a.marketId.localeCompare(b.marketId);
  for(const key of ['blockNumber','transactionIndex','logIndex','timestamp'] as const){
   const av=BigInt(left[key]??'0'),bv=BigInt(right[key]??'0');
   if(av!==bv)return av>bv?-1:1;
  }
  return a.marketId.localeCompare(b.marketId);
 };
 rows.sort((a,b)=>{
  if(params.sort==='marketCapUsd_desc')return compareDecimal(a.metrics?.marketCapUsd,b.metrics?.marketCapUsd)||a.marketId.localeCompare(b.marketId);
  if(String(params.sort)==='recentBuy_desc')return compareRecentBuy(a,b);
  // Factory event order is the creation order; no per-token RPC is needed to sort.
  for(const field of ['blockNumber','transactionIndex','logIndex'] as const){
   const av=BigInt(a.source[field]),bv=BigInt(b.source[field]);
   if(av!==bv)return (av>bv?1:-1)*(params.sort==='createdAt_asc'?1:-1);
  }
  return a.marketId.localeCompare(b.marketId);
 });
 const offset=cursor?Number(cursor):0;if(!Number.isSafeInteger(offset)||offset<0)throw Error('Invalid Page');
 return {items:rows.slice(offset,offset+limit),nextCursor:offset+limit<rows.length?String(offset+limit):null};
}
const explorePagers={0:createExplorePager<MarketReadModel>(40,fetchExplorePage),1:createExplorePager<MarketReadModel>(10,fetchExplorePage)};
const explorePageGeneration={0:0,1:0};
function resetExplorePages(){exploreFrozenRows.clear();explorePagers[0].reset();explorePagers[1].reset();explorePageGeneration[0]++;explorePageGeneration[1]++;}
function clearMarketDirectoryView(resetPages=true):void {
 if(resetPages)resetExplorePages();
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

type ExploreIdentity={name:string;symbol:string;metadataURI:string;deployedAt:string};
let exploreStockPicker:ReturnType<typeof setupExploreStockPicker>|undefined;
let exploreDirectorySnapshot:readonly MarketReadModel[]|undefined;
const exploreIdentities=new Map<string,ExploreIdentity>();
const exploreIdentityRequests=new Map<string,Promise<ExploreIdentity>>();
function exploreIdentity(market:MarketReadModel):Promise<ExploreIdentity>{
 const key=market.memeToken;
 if(market.identity)return Promise.resolve(market.identity);
 if(exploreIdentities.has(key))return Promise.resolve(exploreIdentities.get(key)!);
 const pending=exploreIdentityRequests.get(key);if(pending)return pending;
 const request=Promise.all([
  publicClient.readContract({abi:erc20Abi,address:market.memeToken,functionName:'name'}),
  publicClient.readContract({abi:erc20Abi,address:market.memeToken,functionName:'symbol'}),
  publicClient.readContract({abi:v1Abis.TickerMemeTokenV1,address:market.memeToken,functionName:'metadataURI'}),
  exploreCreatedAt.has(key)?Promise.resolve(exploreCreatedAt.get(key)!):publicClient.readContract({abi:v1Abis.TickerMemeTokenV1,address:market.memeToken,functionName:'deployedAt'}).then(String),
 ]).then(([name,symbol,metadataURI,deployedAt])=>{const value={name,symbol,metadataURI,deployedAt};exploreIdentities.set(key,value);return value;}).finally(()=>exploreIdentityRequests.delete(key));
 exploreIdentityRequests.set(key,request);return request;
}

function setupMarkets(): void {
  let searchTimer:number|undefined;
  for(const selector of ['[data-market-search]','[data-market-stock-search]'])query<HTMLInputElement>(selector)?.addEventListener('input',()=>{window.clearTimeout(searchTimer);searchTimer=window.setTimeout(()=>{if(currentPage()==='markets')void renderMarkets();},250);});
  query<HTMLButtonElement>('[data-market-reset]')?.addEventListener('click',()=>{
    window.clearTimeout(searchTimer);
    for(const selector of ['[data-market-search]','[data-market-stock-search]','[data-market-asset]']){const input=query<HTMLInputElement|HTMLSelectElement>(selector);if(input)input.value='';}
    const sort=query<HTMLSelectElement>('[data-market-sort]');if(sort)sort.value='recent';
    void renderMarkets();
  });
  query<HTMLSelectElement>("[data-market-asset]")?.addEventListener("change", () => { void renderMarkets(); });
  queryAll<HTMLButtonElement>('[data-growing-sort]').forEach(button=>button.addEventListener('click',()=>{
   if(button.getAttribute('aria-pressed')==='true')return;
   queryAll<HTMLButtonElement>('[data-growing-sort]').forEach(option=>option.setAttribute('aria-pressed',String(option===button)));
   void renderExploreStage(0);
  }));
  for(const phase of [0,1] as const){query<HTMLButtonElement>(`[data-stage-prev="${phase}"]`)?.addEventListener('click',()=>{void renderExploreStage(phase,'previous');});query<HTMLButtonElement>(`[data-stage-next="${phase}"]`)?.addEventListener('click',()=>{void renderExploreStage(phase,'next');});}
  void loadMarketStockSymbols();
}

async function renderMarkets():Promise<void>{
 // Direct discovery publishes an initial preview before the complete directory.
 // Its chain revision stays the same, so invalidate pages when the rows change.
 if(foundation?.direct&&exploreDirectorySnapshot!==foundation.markets){
  exploreDirectorySnapshot=foundation.markets;
  resetExplorePages();
 }
 const statistics=refreshExploreStatistics();
 if(foundation?.direct&&!foundation.markets.length)void refreshDirectDirectory();
 const list=query<HTMLElement>('[data-market-list]');if(!list)return;
 if(!foundation){setPageStatus('Loading Tokens…');return;}
 const select=required<HTMLSelectElement>('[data-market-asset]');
 const options=[{value:'',symbol:'All Stocks',name:'',logo:undefined as string|undefined},...foundation.assets.map(asset=>({value:asset.id,symbol:stockSymbol(asset),name:stakingAssetForConfig(robinhoodChain.id,asset)?.name??stockToken(asset)??'',logo:stockLogo(asset)}))];
 if(exploreStockPicker)exploreStockPicker.update(options);else exploreStockPicker=setupExploreStockPicker(select,options);
 const search=query<HTMLInputElement>('[data-market-search]')?.value.trim()??'';
 const reset=query<HTMLButtonElement>('[data-market-reset]');if(reset)reset.hidden=!search&&!select.value;
 for(const key of ['loading','empty','locked']){const node=query<HTMLElement>(`[data-market-${key}]`);if(node)node.hidden=true;}
 setPageStatus('');
 await Promise.all([renderExploreStage(1),renderExploreStage(0)]);
 void statistics.then(changed=>{
  if(!changed||currentPage()!=='markets')return;
  for(const phase of [0,1] as const)if(exploreVisiblePage[phase]===1){explorePagers[phase].reset();void renderExploreStage(phase);}
 });
}
async function renderExploreStage(phase:0|1,direction:'current'|'next'|'previous'|number='current'):Promise<void>{
 const list=query<HTMLElement>('[data-market-list]'),grid=query<HTMLElement>(`[data-stage-grid="${phase}"]`);
 if(!foundation||!list||!grid)return;
 const generation=++explorePageGeneration[phase];const current=foundation;
 const search=query<HTMLInputElement>('[data-market-search]')?.value.trim()??'';
 const asset=query<HTMLSelectElement>('[data-market-asset]')?.value??'';
 const selectedSort=query<HTMLButtonElement>('[data-growing-sort][aria-pressed="true"]')?.dataset.growingSort;
 const sort=phase===1||selectedSort==='marketCapUsd_desc'?'marketCapUsd_desc':selectedSort==='createdAt_asc'?'createdAt_asc':selectedSort==='recentBuy_desc'?'recentBuy_desc':'createdAt_desc';
 const params:DirectoryQuery={revision:current.sync.revision,launchPhase:phase,sort:sort as DirectoryQuery['sort'],...(search?{search}:{}),...(asset?{assetUid:canonicalBytes32(asset,'Stock')}:{})};
 const previous=query<HTMLButtonElement>(`[data-stage-prev="${phase}"]`),next=query<HTMLButtonElement>(`[data-stage-next="${phase}"]`),empty=query<HTMLElement>(`[data-stage-empty="${phase}"]`);
 const wasPreviousDisabled=previous?.disabled??true,wasNextDisabled=next?.disabled??true;
 let retry=query<HTMLButtonElement>(`[data-stage-retry="${phase}"]`);
 if(!retry){retry=document.createElement('button');retry.type='button';retry.dataset.stageRetry=String(phase);retry.textContent='Retry';retry.hidden=true;retry.onclick=()=>{void renderExploreStage(phase,direction);};grid.insertAdjacentElement('afterend',retry);}
 retry.hidden=true;
 if(previous)previous.disabled=true;if(next)next.disabled=true;grid.setAttribute('aria-busy','true');
 try{
  const page=await explorePagers[phase].load(params,direction);
  if(!page||generation!==explorePageGeneration[phase]||!grid.isConnected)return;
  exploreVisiblePage[phase]=page.page;
  const filtered=page.items;
  grid.querySelectorAll('[data-runtime-market]').forEach(node=>node.remove());
  text(`[data-stage-count="${phase}"]`,String(filtered.length));
  if(empty){empty.hidden=filtered.length>0;empty.textContent=directDirectoryBusy&&current.direct?'Loading Tokens…':search||asset?'No Matching Tokens':phase===1?'No Bloomed Tokens Yet':'No Growing Tokens Yet';}
  const template=required<HTMLTemplateElement>('[data-market-item-template]',list);
  for (const market of filtered) {
    const fragment = template.content.cloneNode(true) as DocumentFragment;
    const card = required<HTMLElement>("[data-market-card]", fragment);
    const cardLink = required<HTMLAnchorElement>("[data-market-link]", fragment);
    card.dataset.runtimeMarket = market.marketId;
    card.dataset.category = market.launchPhase === 1 ? "pool" : "curve";
    cardLink.href = `/trade?marketId=${encodeURIComponent(market.marketId)}`;
    cardLink.setAttribute("aria-label", `View ${market.identity?.name ?? "Token"}`);
    text("[data-market-name]", market.identity?.name ?? `Token ${shortHex(market.memeToken)}`, fragment);
    text('[data-market-symbol]',market.identity?.symbol?`$${market.identity.symbol}`:'-',fragment);
    text('[data-market-age]',tokenAge(market.identity?.deployedAt),fragment);
    const mark=query<HTMLElement>('[data-market-tone]',fragment);
    if(mark){
      const image=document.createElement('img');image.alt='';image.loading='lazy';
      const fallback=new URL('../assets/token-placeholder.svg',import.meta.url).href;
      const imageArea=required<HTMLElement>('.explore-card-image',fragment);
      const loading=required<HTMLElement>('[data-market-image-loading]',fragment);
      const finish=()=>{loading.hidden=true;imageArea.setAttribute('aria-busy','false');};
      image.onload=finish;
      image.onerror=()=>{if(image.src!==fallback){image.src=fallback;}else{finish();}};
      const showImage=(url:string)=>{image.src=url;if(image.complete&&image.naturalWidth>0)finish();};
      mark.append(image);
      void exploreIdentity(market).then(async identity=>{
        if(!card.isConnected)return;
        text('[data-market-name]',identity.name,card);text('[data-market-symbol]',`$${identity.symbol}`,card);
        cardLink.setAttribute('aria-label',`View ${identity.name}`);
        const age=query<HTMLTimeElement>('[data-market-age]',card);if(age){age.textContent=tokenAge(identity.deployedAt);const at=new Date(Number(identity.deployedAt)*1000);if(Number.isFinite(at.getTime())){age.dateTime=at.toISOString();age.title=at.toLocaleString();}}
        const detail=await readDetailMetadata(identity.metadataURI,launchMetadataOrigin,AbortSignal.timeout(8000),import.meta.env.VITE_IPFS_GATEWAY);
        if(card.isConnected)showImage(detail?.image||fallback);
      }).catch(()=>{if(card.isConnected)showImage(fallback);});
    }
    const stock = foundation.assets.find(asset => asset.id === market.assetUid);
    const stockAddress = stock ? stockToken(stock) : null;
    text("[data-market-asset-label]", stockAddress ? `${(stock?stakingAssetForConfig(robinhoodChain.id,stock)?.symbol:undefined)??marketStockSymbols.get(stockAddress)??shortHex(stockAddress)}` : "-", fragment);
    const stockImage=query<HTMLImageElement>('[data-market-asset-icon]',fragment);const stockImageURL=stock?stockLogo(stock):undefined;
    if(stockImage&&stockImageURL){stockImage.src=stockImageURL;stockImage.hidden=false;stockImage.onerror=()=>{stockImage.hidden=true;};}
    text("[data-market-phase]", phaseLabel(market.launchPhase), fragment);
    text("[data-market-volume]", formatMarketUSD(market.metrics?.volume24hUsd), fragment);
    text("[data-market-cap]", formatMarketUSD(market.metrics?.marketCapUsd, true, 2), fragment);
    const cap = market.metrics?.marketCapUsd;
    if (cap != null && Number.isFinite(Number(cap)) && Number(cap) >= 0) {
      const fullCap = new Intl.NumberFormat('en-US', {style:'currency',currency:'USD',maximumFractionDigits:2}).format(Number(cap));
      cardLink.title = `Market Cap: ${fullCap}`;
      required<HTMLElement>('[data-market-cap]', fragment).title = fullCap;
    }
    text("[data-market-stock]", stockAddress ? shortHex(stockAddress, 8, 6) : "-", fragment);
    const addressLink=required<HTMLAnchorElement>('[data-market-address]',card);
    addressLink.textContent=shortHex(market.memeToken,10,8);
    addressLink.href=`${robinhoodChain.blockExplorers.default.url}/token/${market.memeToken}`;
    addressLink.title=market.memeToken;
    addressLink.setAttribute('aria-label',`View ${market.memeToken} In Explorer (New Tab)`);
    if (market.launchPhase === 0) {
      addressLink.hidden = true;
      const progressArea = required<HTMLElement>('[data-market-progress]', card);
      progressArea.hidden = false;
      const supply = foundation.baseline.find(config => config.kind === 'baseline' && config.id === market.tickerGardenBaselineId)?.values.supply;
      const curve = market.curveProgress;
      const progress = typeof supply === 'string' && /^\d+$/.test(supply) && /^\d+$/.test(curve.reservedTokens) && /^\d+$/.test(curve.sellableTokens)
        ? graduationProgress(BigInt(supply), BigInt(curve.reservedTokens), BigInt(curve.sellableTokens)) : null;
      const bar = required<HTMLProgressElement>('progress', progressArea);
      bar.value = progress ?? 0;
      bar.hidden = progress === null;
      text('[data-market-progress-label]', progress === null ? '-' : `${progress.toFixed(2)}%`, progressArea);
      progressArea.title = progress === null ? 'Bloom Progress Pending' : `${progress.toFixed(2)}% To Bloom`;
    }
    const target=query<HTMLElement>(`[data-stage-grid="${market.launchPhase}"]`,list);target?.append(fragment);
  }

  const pageNumbers=query<HTMLElement>(`[data-stage-page="${phase}"]`);
  if(pageNumbers){
   pageNumbers.replaceChildren();
   const visiblePages=Array.from(new Set([1,page.availablePages,...Array.from({length:5},(_,i)=>page.page+i-2)]))
    .filter(number=>number>=1&&number<=page.availablePages).sort((a,b)=>a-b);
   let last=0;
   for(const number of visiblePages){
    if(last&&number-last>1){const dots=document.createElement('span');dots.textContent='…';dots.setAttribute('aria-hidden','true');pageNumbers.append(dots);}
    const button=document.createElement('button');button.type='button';button.textContent=String(number);button.setAttribute('aria-label',`Page ${number}`);
    if(number===page.page)button.setAttribute('aria-current','page');
    button.onclick=()=>{if(grid.getAttribute('aria-busy')!=='true'&&number!==page.page)void renderExploreStage(phase,number);};
    pageNumbers.append(button);last=number;
   }
  }
  if(previous)previous.disabled=!page.hasPrevious;if(next)next.disabled=!page.hasNext;
 }catch(error){if(generation===explorePageGeneration[phase]){if(empty){empty.hidden=false;empty.textContent='Unable To Load Tokens. Please Try Again.';}if(previous)previous.disabled=wasPreviousDisabled;if(next)next.disabled=wasNextDisabled;if(retry){retry.hidden=false;retry.onclick=()=>{void renderExploreStage(phase,direction);};}}}
 finally{if(generation===explorePageGeneration[phase])grid.setAttribute('aria-busy','false');}
}

function clearStatsSnapshotView(_message: string): void {
  for(const selector of ['[data-stat-market-cap]','[data-stat-volume]','[data-stat-launches]','[data-stat-bloomed]','[data-stat-total-markets]'])text(selector,'-');
  for(const selector of ['[data-stats-phase-list]','[data-stats-stock-list]','[data-stats-quote-list]']){
    const container=query<HTMLElement>(selector);if(container){const empty=document.createElement('p');empty.className='stats-empty';empty.textContent='Data Is Not Available Yet';container.replaceChildren(empty);}
  }
  for(const selector of ['[data-stats-growing-bar]','[data-stats-bloomed-bar]']){const bar=query<HTMLElement>(selector);if(bar)bar.style.width='0%';}
  query<HTMLElement>('[data-stats-summary]')?.setAttribute('aria-busy','false');
}
let statsWarmupUntil=0;
function setupStats(): void {
 statsWarmupUntil=Date.now()+180000;
  const buttons=queryAll<HTMLButtonElement>('[data-stats-period]');
  for(const button of buttons){
    button.addEventListener('click',()=>{
      const next=button.dataset.statsPeriod==='all'?'all':'24h';if(next===statsPeriod)return;statsPeriod=next;
      for(const item of buttons){const selected=item===button;item.setAttribute('aria-selected',String(selected));item.tabIndex=selected?0:-1;}
      void renderStats();
    });
    button.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const index=buttons.indexOf(button),next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;buttons[next]?.focus();buttons[next]?.click();});
  }
}
function statsAsset(address:string):{label:string;icon?:string}{
 if(address==='0x'+'0'.repeat(40))return{label:'ETH',icon:quoteIconUrl('ETH')};
 const asset=foundation?.assets.find(c=>stockToken(c)?.toLowerCase()===address.toLowerCase());
 const listed=asset?stakingAssetForConfig(robinhoodChain.id,asset):undefined;
 return{label:listed?.symbol??marketStockSymbols.get(address)??shortHex(address,6,4),icon:asset?stockLogo(asset):undefined};
}
function renderStatsDistribution(selector:string,groups:Map<string,{label:string;icon?:string;count:number}>,total:number){
 const list=query<HTMLElement>(selector);if(!list)return;
 if(!groups.size){const empty=document.createElement('p');empty.className='stats-empty';empty.textContent='No Markets Yet';list.replaceChildren(empty);return;}
 const fragment=document.createDocumentFragment();
 for(const group of [...groups.values()].sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label))){
  const wrapper=document.createElement('div'),row=document.createElement('div');row.className='stats-distribution-row';
  const label=document.createElement('span');label.className='stats-asset-label';
  if(group.icon){const image=document.createElement('img');image.src=group.icon;image.alt='';image.onerror=()=>image.remove();label.append(image);}
  const name=document.createElement('span');name.textContent=group.label;label.append(name);
  const value=document.createElement('span');value.className='stats-distribution-value';const count=document.createElement('strong');count.textContent=group.count.toLocaleString();const percent=document.createElement('small');percent.textContent=`${total?Math.round(group.count/total*100):0}%`;value.append(count,percent);row.append(label,value);
  const track=document.createElement('div');track.className='stats-distribution-track';track.setAttribute('aria-hidden','true');const fill=document.createElement('span');fill.style.width=`${total?group.count/total*100:0}%`;track.append(fill);wrapper.append(row,track);fragment.append(wrapper);
 }
 list.replaceChildren(fragment);
}
async function renderStockStatistics(current:()=>boolean,valuations:any,summary:any):Promise<boolean>{
 const assets=[...new Map((foundation?.assets??[]).map(asset=>[asset.id,asset])).values()];
 const fresh=statisticsFresh(summary.stakingObservedAt,Date.now());
 const rows=assets.map(asset=>{
  const token=stockToken(asset),info=token?statsAsset(token):{label:shortHex(asset.id)},decimals=Number(asset.values.tokenDecimals);
  const raw=summary.stockAmounts?.[asset.id];
  const amount=fresh&&typeof raw==='string'&&/^(0|[1-9][0-9]*)$/.test(raw)?BigInt(raw):null;
  const value=amount===null?null:statisticsUSD(raw,decimals,valuations.prices?.[token?.toLowerCase()??''],valuations.expiresAt?.[token?.toLowerCase()??''],Date.now());
  return {...info,value,amount,decimals};
 });
 if(!current())return false;
 text('[data-stat-stock-value]',formatMarketUSD(sumStatisticsUSD(rows.map(row=>row.value)),true));
 const list=query<HTMLElement>('[data-stats-staking-values]');if(!list)return false;
 const elements=rows.map(item=>{const row=document.createElement('div');row.className='stats-fee-row';const label=document.createElement('span');label.className='stats-asset-label';if(item.icon){const icon=document.createElement('img');icon.src=item.icon;icon.alt='';icon.addEventListener('error',()=>icon.remove(),{once:true});label.append(icon);}label.append(document.createTextNode(item.label));const value=document.createElement('strong');value.textContent=formatMarketUSD(item.value,true);if(item.amount!==null)value.title=`${formatUnits(item.amount,item.decimals)} ${item.label}`;row.append(label,value);return row;});
 list.replaceChildren(...elements);
 return rows.every(row=>row.value!==null);
}
async function renderProtocolStatistics(current:()=>boolean,attempt=0):Promise<void>{
 if(!runtimeConfig.readApi.available)return;const base=runtimeConfig.readApi.value;
 try{const [summary,prices]=await Promise.all([fetch(`${base}/v1/protocol-statistics`,{signal:AbortSignal.timeout(5000)}).then(r=>{if(!r.ok)throw Error('Statistics Missing');return r.json();}),fetch(`${base}/v1/statistics-prices`,{signal:AbortSignal.timeout(5000)}).then(r=>{if(!r.ok)throw Error('Prices Missing');return r.json();}).catch(()=>({chainId:robinhoodChain.id,displayOnly:true,prices:{},expiresAt:{}}))]);
 if(!current()||summary.chainId!==robinhoodChain.id||summary.displayOnly!==true||prices.chainId!==robinhoodChain.id||prices.displayOnly!==true)return;
 const pending=summary.reason==='statistics_pending'||summary.feeCoverage!==true||!statisticsFresh(summary.observedAt,Date.now())||!statisticsFresh(summary.stakingObservedAt,Date.now());
 const fresh=statisticsFresh(summary.observedAt,Date.now());
 text('[data-stat-market-cap]',fresh&&summary.valuationCoverage===true&&typeof summary.marketCapUsd==='string'?formatMarketUSD(summary.marketCapUsd,true):'-');
 text('[data-stat-volume]',fresh&&summary.historicalUsdCoverage===true&&typeof summary.volume24hUsd==='string'?formatMarketUSD(summary.volume24hUsd,true):'-');
 text('[data-stat-launches]',fresh&&Number.isSafeInteger(summary.launches24h)&&summary.launches24h>=0?summary.launches24h.toLocaleString():'-');
 text('[data-stat-total-markets]',fresh&&Number.isSafeInteger(summary.marketCount)&&summary.marketCount>=0?String(summary.marketCount):'-');
 text('[data-stat-bloomed]',fresh&&Number.isSafeInteger(summary.bloomedMarketCount)&&summary.bloomedMarketCount>=0?String(summary.bloomedMarketCount):'-');
 text('[data-stat-staking-wallets]',statisticsFresh(summary.stakingObservedAt,Date.now())&&Number.isSafeInteger(summary.stakingWallets)&&summary.stakingWallets>=0?String(summary.stakingWallets):'-');
 const totals:Record<string,string[]>=Object.fromEntries(['creator','staker','holder','platform'].map(k=>[k,[]]));let valid=fresh&&summary.feeCoverage===true;
 for(const [asset,buckets]of Object.entries(summary.feeAssets??{})){for(const bucket of Object.keys(totals)){
  const value=statisticsUSD((buckets as Record<string,string>)[bucket],summary.feeDecimals?.[asset],prices.prices?.[asset],prices.expiresAt?.[asset],Date.now());
  if(value===null)valid=false;else totals[bucket]!.push(value);
 }}
 for(const bucket of Object.keys(totals))text(`[data-stat-fee-${bucket}]`,valid?formatMarketUSD(sumStatisticsUSD(totals[bucket]!),true):'-');
 const feeTotals = summary.feeTotals as Record<string,string> | undefined;
 const revenue = fresh && summary.feeCoverage===true && summary.feeBasis==='TRADE_TIME' && feeTotals ? sumStatisticsUSD(Object.entries(feeTotals).map(([asset,amount])=>statisticsUSD(amount,summary.feeDecimals?.[asset],prices.prices?.[asset],prices.expiresAt?.[asset],Date.now()))) : null;
 text('[data-stat-fee-revenue]',formatMarketUSD(revenue,true));
 const stocksReady=await renderStockStatistics(current,prices,summary);
 if((pending||!valid||!stocksReady)&&attempt<18)setTimeout(()=>{if(current()&&currentPage()==='stats')void renderProtocolStatistics(current,attempt+1);},attempt<6?5000:10000);
 }catch{
  if(!current())return;
  for(const key of ['staking-wallets','stock-value','fee-revenue','fee-creator','fee-staker','fee-holder','fee-platform'])text(`[data-stat-${key}]`,'-');
  if(attempt<6)setTimeout(()=>{if(current()&&currentPage()==='stats')void renderProtocolStatistics(current,attempt+1);},10000);
 }
}
async function renderStats():Promise<void>{
 const render=statsRender.begin(),all=false;statsPeriod='24h';
 text('[data-stat-volume-period]',all?'All Time · USD':'Last 24 Hours · USD');text('[data-stat-launches-label]',all?'All Time':'Last 24 Hours');
 queryAll<HTMLButtonElement>('[data-stats-period]').forEach(button=>{const selected=button.dataset.statsPeriod===statsPeriod;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;});
 if(!foundation){clearStatsSnapshotView('');setPageStatus('Unable To Load Statistics','error');return;}
 try{
  if(!render.isCurrent())return;
  await renderProtocolStatistics(()=>render.isCurrent());
  if(!render.isCurrent())return;
  query<HTMLElement>('[data-stats-summary]')?.setAttribute('aria-busy','false');setPageStatus('','success');
 }catch{if(render.isCurrent()){clearStatsSnapshotView('');setPageStatus('Unable To Load Statistics','error');}}
}

function setupDocs(): void {
  const search = query<HTMLInputElement>("[data-docs-search]");
  const apply = () => {
    const needle = (search?.value ?? "").trim().toLowerCase();
    const articles = queryAll<HTMLElement>("[data-docs-article]");
    articles.forEach((item) => {
      item.hidden = Boolean(needle && !item.textContent?.toLowerCase().includes(needle));
    });
    queryAll<HTMLElement>("[data-docs-section]").forEach((section) => {
      section.hidden = !Array.from(section.querySelectorAll<HTMLElement>("[data-docs-article]")).some(item => !item.hidden);
    });
    const empty = query<HTMLElement>("[data-docs-empty]");
    if (empty) empty.hidden = articles.some((item) => !item.hidden);
  };
  search?.addEventListener("input", apply);
  queryAll<HTMLAnchorElement>(".docs-toc a").forEach((link) => link.addEventListener("click", () => {
    if (search) search.value = "";
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
  impactBps?: bigint;
  poolProtocolPips?: number;
  ownFeeBps?: number;
  minimum: bigint;
  revision: string;
  expiresAtMs: number;
}>;

let tradeMarket: MarketDetailResponse | null = null;
let tradeMetadata: MarketMetadata | null = null;
let tradeSide: "buy" | "sell" = "buy";
let tradeQuote: TradeQuote | null = null;
type CurvePricing={marketId:string;blockNumber:bigint;timestamp:bigint;quoteReserve:bigint;tokenReserve:bigint;baseBps:bigint;taxBps:bigint;at:number};
let curvePricing:CurvePricing|null=null;
let curvePricingPending: {marketId:string;promise:Promise<CurvePricing>}|null=null;
async function loadCurvePricing(market:MarketReadModel):Promise<CurvePricing>{
 if(curvePricing?.marketId===market.marketId&&Date.now()-curvePricing.at<15000)return curvePricing;
 if(curvePricingPending?.marketId===market.marketId)return curvePricingPending.promise;
 const promise=(async()=>{
  const baseline=foundation?.baseline.find(c=>c.id===market.tickerGardenBaselineId);if(!baseline)throw Error('Fee configuration missing');
  const baseBps=configBigInt(baseline,'curveFeeBps');
  const block=await publicClient.getBlock({blockTag:'latest'});
  const args={address:canonicalAddress(market.curve,'Curve'),abi:v1Abis.TickerGardenCurve,blockNumber:block.number};
  const [reserves,tax]=await Promise.all([publicClient.readContract({...args,functionName:'getReserves'}),publicClient.readContract({...args,functionName:'creatorTaxBps'})]);
  const result={marketId:market.marketId,blockNumber:block.number,timestamp:block.timestamp,quoteReserve:reserves[0],tokenReserve:reserves[1],baseBps,taxBps:BigInt(tax),at:Date.now()};
  if(tradeMarket?.market===market)curvePricing=result;
  return result;
 })();
 curvePricingPending={marketId:market.marketId,promise};
 try{return await promise;}finally{if(curvePricingPending?.promise===promise)curvePricingPending=null;}
}

const poolQuoteBindings=new Map<string,Promise<{manager:Address;taxBps:number}>>();
async function loadPoolQuoteBindings(market:MarketReadModel,blockNumber:bigint){
 const route=poolTradeRoute(market,'buy');
 const cacheKey=`${route.router}:${route.quoter}:${market.curve}`;
 const previous=poolQuoteBindings.get(cacheKey);if(previous)return previous;
 const pending=(async()=>{
  const [manager,quoterManager,taxBps]=await Promise.all([
   publicClient.readContract({abi:poolRouterAbi,address:route.router,functionName:'poolManager',blockNumber}),
   publicClient.readContract({abi:poolQuoterAbi,address:route.quoter,functionName:'poolManager',blockNumber}),
   publicClient.readContract({abi:v1Abis.TickerGardenCurve,address:canonicalAddress(market.curve,'Curve'),functionName:'creatorTaxBps',blockNumber})]);
  if(manager.toLowerCase()!==quoterManager.toLowerCase()||manager===ZERO_ADDRESS||taxBps>500)throw Error('Invalid pool quote binding');
  return {manager,taxBps};
 })();
 if(poolQuoteBindings.size>=32)poolQuoteBindings.delete(poolQuoteBindings.keys().next().value!);
 poolQuoteBindings.set(cacheKey,pending);
 try{return await pending;}catch(error){if(poolQuoteBindings.get(cacheKey)===pending)poolQuoteBindings.delete(cacheKey);throw error;}
}

let tradeLoadGeneration = 0;
let tradeQuoteGeneration = 0;
let tradeQuoteTimer = 0;
let tradeQuoteExpiryTimer = 0;
let tradePhaseTimer = 0;
let tradePhaseLoading = false;

function setupTrade(): void {
  query<HTMLElement>('.ref-links')?.addEventListener('click',event=>{
    const button=event.target instanceof Element?event.target.closest<HTMLButtonElement>('button[data-external-url]'):null;
    if(!button||button.hidden||button.disabled||!button.dataset.externalUrl)return;
    try{const url=new URL(button.dataset.externalUrl);if(!['https:','http:'].includes(url.protocol))return;window.open(url.href,'_blank','noopener,noreferrer');}catch{/* Invalid metadata links stay inert. */}
  },{capture:true});
  tradePhaseTimer = window.setInterval(async () => {
    if (document.hidden || currentPage() !== 'trade') return;
    const current = tradeMarket;
    void refreshMarketOverview();
    void refreshRecentTrades();
    if (document.hidden || busyOperation || pageActionPending || tradePhaseLoading || !current || !foundation || !readApi) return;
    tradePhaseLoading = true;
    try {
      const fresh = foundation.direct && directMarkets ? await directMarkets.market(current.market.marketId) : await readApi.getMarket({marketId:current.market.marketId,revision:foundation.sync.revision});
      if (tradeMarket !== current || currentPage() !== 'trade') return;
      await refreshTradeFields(fresh, true);
    } catch { /* Keep current fields; the next background pass retries. */ }
    finally { tradePhaseLoading = false; }
  }, 30_000);

  queryAll<HTMLButtonElement>('[data-fill-trade-balance]').forEach(button=>button.addEventListener('click',()=>{
    if(!wallet||!tradeMetadata||detailBalanceAccount!==wallet.account||busyOperation||pageActionPending)return;
    const side=button.dataset.fillTradeBalance==='receive'?(tradeSide==='buy'?'sell':'buy'):tradeSide;
    const balance=side==='buy'?detailBalances?.quote:detailBalances?.meme;
    if(balance===undefined||balance<=0n)return;
    const amount=query<HTMLInputElement>('[data-trade-amount]');if(!amount)return;
    amount.value=formatUnits(balance,side==='buy'?tradeMetadata.quoteDecimals:18);
    if(side!==tradeSide)query<HTMLButtonElement>(`[data-trade-side="${side}"]`)?.click();
    else amount.dispatchEvent(new Event('input',{bubbles:true}));
    amount.focus();
  }));
  query<HTMLButtonElement>('[data-detail-connect]')?.addEventListener('click',()=>query<HTMLButtonElement>('[data-wallet]')?.click());
  query<HTMLButtonElement>('[data-detail-fee-details]')?.addEventListener('click',()=>{const node=query<HTMLElement>('[data-detail-fee-rows]')?.closest<HTMLElement>('section');node?.scrollIntoView({behavior:'smooth',block:'center'});node?.focus({preventScroll:true});});
  let tradeReverseRotation=0;
  query<HTMLButtonElement>('[data-trade-reverse]')?.addEventListener('click',event=>{
    const button=event.currentTarget as HTMLButtonElement;
    tradeReverseRotation+=180;
    const icon=button.querySelector<HTMLElement>('.ph');if(icon)icon.style.transform=`rotate(${tradeReverseRotation}deg)`;
    query<HTMLButtonElement>(`[data-trade-side="${tradeSide==='buy'?'sell':'buy'}"]`)?.click();
  });
  queryAll<HTMLButtonElement>('[data-detail-tab]').forEach(button => button.addEventListener('click', () => {
    queryAll<HTMLButtonElement>('[data-detail-tab]').forEach(tab => {
      tab.classList.toggle('active', tab === button);
      tab.setAttribute('aria-selected', String(tab === button));
    });
    queryAll<HTMLElement>('[data-detail-panel]').forEach(panel => { panel.hidden = panel.dataset.detailPanel !== button.dataset.detailTab; });
  }));
  query<HTMLButtonElement>('[data-detail-copy]')?.addEventListener('click', () => {
    if (!tradeMarket) return;
    window.open(`${robinhoodChain.blockExplorers.default.url}/token/${tradeMarket.market.memeToken}`, '_blank', 'noopener,noreferrer');
  });
  const params = new URLSearchParams(window.location.search);
  const marketId = params.get("marketId")?.toLowerCase() ?? "";
  queryAll<HTMLButtonElement>("[data-trade-side]").forEach((button) => button.addEventListener("click", () => {
    tradeSide = button.dataset.tradeSide === "sell" ? "sell" : "buy";
    queryAll<HTMLButtonElement>("[data-trade-side]").forEach((item) => {item.classList.toggle("active", item === button);item.setAttribute("aria-pressed",String(item===button));});
    tradeQuote = null;
    renderTradeQuote();
    scheduleTradeQuote();
  }));
  const tradeAmountInput=query<HTMLInputElement>('[data-trade-amount]');
  if(tradeAmountInput){
    let lastAmount=tradeAmountInput.value;
    const decimal=/^[0-9]*(?:\.[0-9]*)?$/;
    const accepts=(insert:string)=>{
      const start=tradeAmountInput.selectionStart??tradeAmountInput.value.length,end=tradeAmountInput.selectionEnd??start;
      return decimal.test(tradeAmountInput.value.slice(0,start)+insert+tradeAmountInput.value.slice(end));
    };
    tradeAmountInput.addEventListener('beforeinput',event=>{if(event.data!==null&&!accepts(event.data))event.preventDefault();});
    tradeAmountInput.addEventListener('paste',event=>{const value=event.clipboardData?.getData('text');if(value!==undefined&&!accepts(value))event.preventDefault();});
    tradeAmountInput.addEventListener('input',()=>{
      if(!decimal.test(tradeAmountInput.value)){
        tradeAmountInput.value=lastAmount;
        tradeAmountInput.dispatchEvent(new Event('input',{bubbles:true}));return;
      }
      lastAmount=tradeAmountInput.value;
      scheduleTradeQuote();
    });
  }
  query<HTMLFormElement>("[data-trade-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void runPageAction(submitTrade);
  });
  queryAll<HTMLButtonElement>('[data-trade-stake-action]').forEach(button=>button.addEventListener('click',()=>{
    if(!tradeMarket)return;
    router.navigate(`/stake?marketId=${encodeURIComponent(tradeMarket.market.marketId)}&action=${button.dataset.tradeStakeAction}#positions`);
  }));
  if (marketId) void loadTradeMarket(marketId);
  else updateTradeAvailability();
}

async function readMarketVolume(marketId:string):Promise<string>{
 if(!runtimeConfig.readApi.available)throw Error('Volume Unavailable');
 const r=await fetch(`${runtimeConfig.readApi.value}/v1/market-statistics?markets=${encodeURIComponent(marketId)}`,{signal:AbortSignal.timeout(8000)});
 if(!r.ok)throw Error('Volume Unavailable');
 const payload=await r.json(),item=payload.items?.[marketId];
 if(payload.chainId!==robinhoodChain.id||payload.displayOnly!==true||item?.marketId!==marketId||!statisticsFresh(item.volumeObservedAt,Date.now())||typeof item.volume24hQuote!=='string'||!/^\d+(?:\.\d+)?$/.test(item.volume24hQuote))throw Error('Volume Pending');
 return item.volume24hQuote;
}
const overviewLoads=new Map<string,number>();
async function refreshMarketOverview(preserve=false):Promise<void>{
 const detail=tradeMarket,metadata=tradeMetadata;
 if(!detail||!metadata||document.hidden)return;
 const market=detail.market,key=market.marketId;

 if(Date.now()-(overviewLoads.get(key)??0)<600000)return;
 const firstLoad=!overviewLoads.has(key);
 overviewLoads.set(key,Date.now());
 if(!preserve&&firstLoad)tokenDetailWidget?.setOverview({supply:undefined,maximum:undefined,price:undefined,usd:undefined,volume24h:undefined,holders:undefined});
 const generation=tradeLoadGeneration;
 if(runtimeConfig.contracts.available&&runtimeConfig.readApi.available)void explorerFeeDistribution({apiBase:runtimeConfig.readApi.value,market,decimals:metadata.quoteDecimals,feeVault:runtimeConfig.contracts.value.protocolFeeVaultAddress}).then(rows=>{if(tradeMarket===detail&&generation===tradeLoadGeneration)tokenDetailWidget?.setFeeTotals(rows);}).catch(()=>{});
 const update=(value:MarketOverview)=>{if(tradeMarket===detail&&generation===tradeLoadGeneration)tokenDetailWidget?.setOverview(value);};
 let incomplete=false;
 const report=async<T>(promise:Promise<T>,map:(value:T)=>MarketOverview)=>{try{update(map(await promise));}catch{incomplete=true;/* Independent display sources never block trading. */}};
 await Promise.allSettled([
  report(publicClient.readContract({abi:erc20Abi,address:market.memeToken,functionName:'totalSupply'}),supply=>({supply:supply.toString()})),
  report(publicClient.readContract({abi:parseAbi(['function initialSupply() view returns (uint256)']),address:market.memeToken,functionName:'initialSupply'}),maximum=>({maximum:maximum.toString()})),
  report((async()=>{
   if(market.launchPhase===0){const pricing=await loadCurvePricing(market);if(pricing.tokenReserve<=0n)throw Error('Empty Curve');return formatUnits(pricing.quoteReserve*10n**18n*10n**18n/pricing.tokenReserve,metadata.quoteDecimals+18);}
   const route=poolTradeRoute(market,'buy');
   const manager=await publicClient.readContract({abi:poolRouterAbi,address:route.router,functionName:'poolManager'});
   // Uniswap v4 StateLibrary: pools mapping at slot 6, sqrtPriceX96 in low 160 bits.
   const slot=keccak256(encodeAbiParameters([{type:'bytes32'},{type:'uint256'}],[market.poolId!,6n]));
   const raw=await publicClient.readContract({abi:parseAbi(['function extsload(bytes32 slot) view returns (bytes32)']),address:manager,functionName:'extsload',args:[slot]});
   return poolSpotPrice(BigInt(raw)&((1n<<160n)-1n),market.memeToken.toLowerCase()===route.poolKey.currency0,metadata.quoteDecimals);
  })(),price=>({price})),
  report((async()=>{
   if(market.quoteAsset===ZERO_ADDRESS)return nativeUsd();
   if(!runtimeConfig.readApi.available)throw Error('USD Reference Missing');
   const payload=await overviewJson(`${runtimeConfig.readApi.value.replace(/\/$/,'')}/v1/prices/references`);
   const view=displayPriceView(payload,robinhoodChain.id,market.quoteAsset.toLowerCase(),Date.now());
   if(view.status!=='available')throw Error('USD Reference Missing');
   const reference=payload.references.find((r:any)=>r.token===market.quoteAsset.toLowerCase());
   return formatUnits((parseUnits(reference.bidUsd,18)+parseUnits(reference.askUsd,18))/2n,18);
  })(),usd=>({usd})),
  report(explorerHolders(robinhoodChain.blockExplorers.default.url,market.memeToken),holders=>({holders})),
  report(readMarketVolume(market.marketId),volume24h=>({volume24h}))
 ]);
 if(incomplete&&tradeMarket===detail&&generation===tradeLoadGeneration)overviewLoads.set(key,Date.now()-540000);
}

let tradeStakeAccount:Address|undefined;
let tradeStakeGeneration=0;
const tradeStakeTotals=new Map<string,{at:number;value:bigint}>();
const tradeStakeTotalRequests=new Map<string,Promise<bigint>>();
async function refreshTradeStake():Promise<void>{
  const generation=++tradeStakeGeneration;
  const detail=tradeMarket,account=wallet?.account;
  tradeStakeAccount=account;
  const panel=query<HTMLElement>('[data-trade-stake-summary]');
  if(!panel)return;
  panel.hidden=!detail||detail.market.gauge===ZERO_ADDRESS;
  queryAll<HTMLElement>('[data-trade-stake-base]').forEach(element=>{element.hidden=panel.hidden;});
  if(panel.hidden||!detail)return;
  text('[data-trade-stake-total]','-');text('[data-trade-stake-user]','-');
  const market=detail.market;
  const add=query<HTMLButtonElement>('[data-trade-stake-action="add"]');
  const withdraw=query<HTMLButtonElement>('[data-trade-stake-action="withdraw"]');
  if(add)add.disabled=market.launchPhase!==1;
  if(withdraw)withdraw.disabled=true;
  text('[data-trade-stake-note]',market.launchPhase!==1?'Staking Opens After Blooming':!account?'Connect Wallet To View Your Stake':'');
  try{
    const config=findAsset(market.assetUid);
    const decimals=Number(config.values.tokenDecimals);
    if(!Number.isInteger(decimals)||decimals<0||decimals>18)throw Error('Invalid Stock Decimals');
    const vault=canonicalAddress(String(config.values.userStockVault),'Stock Vault');
    const key=`${vault}:${market.marketId}`;
    const cached=tradeStakeTotals.get(key);
    let total=tradeStakeTotalRequests.get(key);
    if(!total){
      total=cached&&Date.now()-cached.at<600000?Promise.resolve(cached.value):publicClient.readContract({abi:v1Abis.UserStockVault,address:vault,functionName:'marketAllocated',args:[market.assetUid,market.marketId]}).then(value=>{tradeStakeTotals.set(key,{at:Date.now(),value});return value;});
      tradeStakeTotalRequests.set(key,total);
      void total.finally(()=>tradeStakeTotalRequests.delete(key)).catch(()=>{});
    }
    const current=()=>generation===tradeStakeGeneration&&tradeMarket===detail&&wallet?.account===account;
    const display=(value:bigint)=>`${formatTokenAmount(value,decimals)} ${stockSymbol(config)}`;
    await Promise.allSettled([
      total.then(value=>{if(current())text('[data-trade-stake-total]',display(value));}),
      account?publicClient.readContract({abi:v1Abis.UserStockVault,address:vault,functionName:'allocation',args:[market.assetUid,account,market.marketId]}).then(value=>{
        if(!current())return;
        text('[data-trade-stake-user]',display(value));
        if(withdraw)withdraw.disabled=value===0n;
      }):Promise.resolve()
    ]);
  }catch{/* Display-only reads never block trading. */}
}

function renderDetailStakingSymbol(symbol: string, logoUrl?: string): void {
  text('[data-detail-staking-symbol]',symbol);
  for(const image of queryAll<HTMLImageElement>('[data-detail-staking-logo], [data-detail-stock-logo]')){
    const url=logoUrl??quoteIconUrl(symbol);image.hidden=!url;image.alt=url?`${symbol} Logo`:'';image.onerror=()=>{image.hidden=true;};if(url)image.src=url;else image.removeAttribute('src');
  }
}

function clearTradeMarketState(): void {
  ++tradeStakeGeneration;
  if(tradeMarket)overviewLoads.delete(tradeMarket.market.marketId);
  queryAll<HTMLElement>('[data-trade-stake-base]').forEach(element=>{element.hidden=true;});
  const stakeSummary=query<HTMLElement>('[data-trade-stake-summary]');if(stakeSummary)stakeSummary.hidden=true;
  const stakingBadge=query<HTMLElement>('[data-detail-staking-badge]');if(stakingBadge)stakingBadge.hidden=true;
  renderDetailStakingSymbol('-');
  const quoteLogo=query<HTMLImageElement>('[data-detail-quote-logo]');if(quoteLogo){quoteLogo.hidden=true;quoteLogo.removeAttribute('src');quoteLogo.alt='';}
  tradeMarket = null;
  curvePricing=null;
  query<HTMLElement>('.ref-hero')?.setAttribute('aria-busy','true');
  query<HTMLElement>('[data-detail-phase]')?.classList.remove('is-bloomed');
  text('[data-detail-phase]','Loading market');text('[data-detail-phase-note]','');text('[data-detail-trading-pool]','Loading Trading Route…');
  const graduation=query<HTMLElement>('[data-detail-graduation]');if(graduation)graduation.hidden=true;
  tokenDetailWidget?.setMarket(null);
  detailContentAbort?.abort();detailContentAbort=null;
  ++detailBalancesGeneration;detailBalances=null;
  queryAll<HTMLElement>('[data-detail-symbol]').forEach(el=>el.textContent='-');
  text('[data-detail-description]','Loading Description…');
  const avatar=query<HTMLImageElement>('[data-detail-image]');if(avatar){const fallback=new URL('../assets/token-placeholder.svg',import.meta.url).href;avatar.onerror=()=>{avatar.onerror=null;avatar.src=fallback;};avatar.src=fallback;}
  for(const key of ['website','x']){const link=query<HTMLButtonElement>(`[data-detail-${key}]`);if(link){link.hidden=false;link.disabled=true;delete link.dataset.externalUrl;link.removeAttribute('title');}}
  text('[data-detail-stock-label]','-');text('[data-detail-venue]','-');
  for (const key of ['symbol', 'token', 'created', 'creator', 'supply', 'volume', 'cap', 'holders', 'fees', 'fee-rules']) text(`[data-detail-${key}]`, '-');
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
  for (const selector of ["[data-trade-stock]", "[data-trade-quote]", "[data-trade-phase]", "[data-trade-summary-id]"]) text(selector, "-");
  text("[data-trade-market-note]", "");
  text("[data-trade-route-status]", "Load a market to determine whether its route is available.");
  renderTradeQuote();
}

async function loadDetailContent(market:MarketReadModel,generation:number):Promise<void>{
  const abort=new AbortController();detailContentAbort?.abort();detailContentAbort=abort;const timeout=setTimeout(()=>abort.abort(),10000);
  try{const value=await readDetailMetadata(market.identity?.metadataURI??tradeMetadata?.metadataURI??'',launchMetadataOrigin,abort.signal,import.meta.env.VITE_IPFS_GATEWAY);if(generation!==tradeLoadGeneration||abort.signal.aborted)return;if(!value){text('[data-detail-description]','No Description Added');return;}
    text('[data-detail-description]',value.description||'No description available.');const image=query<HTMLImageElement>('[data-detail-image]');if(image&&value.image)image.src=value.image;
    for(const key of ['website','x'] as const){const link=query<HTMLButtonElement>(`[data-detail-${key}]`);if(link&&value[key]){link.dataset.externalUrl=value[key];link.title=value[key];link.hidden=false;link.disabled=false;}}
  }catch{if(generation===tradeLoadGeneration){text('[data-detail-description]','Description Could Not Be Loaded');}}finally{clearTimeout(timeout);}
}
function renderDetailBalances():void{
 if(detailBalanceAccount!==wallet?.account)detailBalances=null;
 const pay=tradeSide==='buy'?detailBalances?.quote:detailBalances?.meme,receive=tradeSide==='buy'?detailBalances?.meme:detailBalances?.quote;
 text('[data-detail-pay-balance]',pay===undefined||!tradeMetadata?'-':`${formatTokenAmount(pay,tradeSide==='buy'?tradeMetadata.quoteDecimals:18)} ${tradeSide==='buy'?tradeMetadata.quoteSymbol:tradeMetadata.symbol}`);
 text('[data-detail-receive-balance]',receive===undefined||!tradeMetadata?'-':`${formatTokenAmount(receive,tradeSide==='buy'?18:tradeMetadata.quoteDecimals)} ${tradeSide==='buy'?tradeMetadata.symbol:tradeMetadata.quoteSymbol}`);
 for(const [side,balance] of [['pay',pay],['receive',receive]] as const){const button=query<HTMLButtonElement>(`[data-fill-trade-balance="${side}"]`);if(button){button.disabled=!wallet||!tradeMetadata||balance===undefined||balance<=0n;button.setAttribute('aria-label',side==='pay'?'Use Pay Asset Balance':'Switch Direction And Use Balance');}}

}
async function loadDetailBalances(preserve=true):Promise<void>{
 const generation=++detailBalancesGeneration,market=tradeMarket,account=wallet?.account;if(!preserve||detailBalanceAccount!==account)detailBalances=null;detailBalanceAccount=account;renderDetailBalances();if(!market||!account)return;
 try{const [quote,meme]=await Promise.allSettled([
 market.market.quoteAsset===ZERO_ADDRESS?publicClient.getBalance({address:account}):publicClient.readContract({abi:erc20Abi,address:canonicalAddress(market.market.quoteAsset,'Quote token'),functionName:'balanceOf',args:[account]}),
 publicClient.readContract({abi:erc20Abi,address:canonicalAddress(market.market.memeToken,'Meme token'),functionName:'balanceOf',args:[account]})]);
 if(generation!==detailBalancesGeneration||wallet?.account!==account||tradeMarket!==market)return;const next={quote:quote.status==='fulfilled'?quote.value:detailBalances?.quote,meme:meme.status==='fulfilled'?meme.value:detailBalances?.meme};const changed=next.quote!==detailBalances?.quote||next.meme!==detailBalances?.meme;detailBalances=next;if(changed)renderDetailBalances();updateTradeAvailability();}catch{/* Unavailable balances remain blank. */}
}

let tradeLoadingTimeout:ReturnType<typeof setTimeout>|undefined;
function setTradePageLoading(loading:boolean):void{
 clearTimeout(tradeLoadingTimeout);
 const overlay=query<HTMLElement>('[data-trade-page-loading]');if(!overlay)return;
 overlay.hidden=!loading;
 overlay.parentElement?.setAttribute('aria-busy',String(loading));
 // Slow optional or failed services must not hold the whole page indefinitely.
 if(loading)tradeLoadingTimeout=setTimeout(()=>setTradePageLoading(false),10000);
}
async function loadTradeMarket(explicit?: string): Promise<void> {
  const requested = explicit ?? new URL(window.location.href).searchParams.get('marketId') ?? '';
  if (tradeMarket && tradeMarket.market.marketId === requested.trim().toLowerCase()) {
    await refreshTradeFields(undefined, true);
    return;
  }
  // Clear the old target before parsing or any prerequisite can fail.
  setTradePageLoading(false);
  clearTradeMarketState();
  const generation = ++tradeLoadGeneration;
  tradeQuoteGeneration += 1;
  window.clearTimeout(tradeQuoteTimer);
  const raw = explicit ?? new URL(window.location.href).searchParams.get("marketId") ?? "";
  let marketId: Hex;
  try { marketId = canonicalBytes32(raw.trim().toLowerCase(), "marketId"); }
  catch (error) { text("[data-detail-phase]", "Choose a market"); text("[data-detail-phase-note]", "Open a token from Explore to view its trading pool."); setPageStatus(errorText(error), "error"); return; }
  if (!foundation || !readApi) {
    setPageStatus(`Market data unavailable — ${runtimeReasons().join("; ")}`, "error");
    return;
  }
  setTradePageLoading(true);
  setPageStatus(foundation.direct ? "Loading current market state…" : "Loading the finalized market record and verifying its Registry binding…");
  tradeQuote = null;
  displayPriceWidget?.setToken(null);
  try {
    // Directory identity is already scoped to this deployment. Start immutable
    // metadata while current trading state is read; never wait for it serially.
    const known = foundation.markets.find(m => m.marketId === marketId);
    const earlyMetadata = known ? marketMetadata(known) : null;
    void earlyMetadata?.catch(()=>{});
    const response = foundation.direct && directMarkets ? await directMarkets.market(marketId) : await readApi.getMarket({ marketId, revision: foundation.sync.revision });
    if (generation !== tradeLoadGeneration) return;
    if (response.market.marketId !== marketId) throw new Error("Read API returned a different market identity");
    if (!foundation.direct) assertFinalizedSync(response.sync, foundation.sync.revision, "market detail");
    const [metadata] = await Promise.all([earlyMetadata && known?.memeToken === response.market.memeToken && known.quoteAssetConfigId === response.market.quoteAssetConfigId ? earlyMetadata : marketMetadata(response.market),foundation.bindings ? ensureCanonicalMarket(response.market) : Promise.resolve()]);
    const view = toCurveProgressViewModel(response);
    if (generation !== tradeLoadGeneration) return;
    tradeMarket = response;
    query<HTMLElement>('.ref-hero')?.setAttribute('aria-busy','false');
    tradeMetadata = metadata;
    const quoteLogo=query<HTMLImageElement>('[data-detail-quote-logo]');
    if(quoteLogo){const url=quoteIconUrl(metadata.quoteSymbol);quoteLogo.hidden=!url;quoteLogo.alt=`${metadata.quoteSymbol} Logo`;quoteLogo.onerror=()=>{quoteLogo.hidden=true;};if(url)quoteLogo.src=url;else quoteLogo.removeAttribute('src');}
    queryAll<HTMLElement>('[data-detail-symbol]').forEach(el=>el.textContent=metadata.symbol);
    const baseline=foundation.baseline.find(c=>c.kind==='baseline'&&c.id===response.market.tickerGardenBaselineId);
    const supply=baseline?.values.supply;
    const graduated=response.market.launchPhase===1;
    renderTradePhase(graduated);
    const progressLabel=query<HTMLElement>('[data-detail-progress-label]');if(progressLabel)progressLabel.hidden=graduated;
    text('[data-detail-phase-note]','');
    const graduation=query<HTMLElement>('[data-detail-graduation]');if(graduation)graduation.hidden=graduated;
    const progress=typeof supply==='string'?graduationProgress(BigInt(supply),view.reservedTokens,view.sellableTokens):null;
    text('[data-detail-progress-label]',progress===null?'-':`${progress.toFixed(2)}%`);
    const bar=query<HTMLProgressElement>('[data-detail-progress]');if(bar){if(progress===null)bar.removeAttribute('value');else bar.value=progress;}
    renderTradePoolAddress(response.market);
    text('[data-detail-supply]',typeof supply==='string'?formatTokenAmount(BigInt(supply),18):'-');
    tokenDetailWidget?.setMarket({marketId:response.market.marketId,memeToken:response.market.memeToken,quoteAsset:response.market.quoteAsset,quoteDecimals:metadata.quoteDecimals,symbol:metadata.symbol,quoteSymbol:metadata.quoteSymbol,createdAt:Number(response.market.identity?.deployedAt??metadata.deployedAt)||undefined});
    void refreshMarketOverview();
    void refreshRecentTrades(true);
    void loadDetailContent(response.market,generation);
    void loadDetailBalances();
    text('[data-detail-token]', shortHex(response.market.memeToken));
    const deployed = response.market.identity?.deployedAt??metadata.deployedAt;
    const date = deployed && /^\d+$/.test(deployed) ? new Date(Number(deployed) * 1000) : null;
    text('[data-detail-created]', date && Number.isFinite(date.getTime()) ? date.toLocaleDateString('en-US', {year:'numeric', month:'short', day:'numeric'}) : '-');
    // Detail analytics owns volume and circulating cap; directory metrics use FDV.
    const explorer = query<HTMLAnchorElement>('[data-detail-explorer]');
    if (explorer) { explorer.href = `${robinhoodChain.blockExplorers.default.url}/token/${response.market.memeToken}`; explorer.hidden = false; }
    const copy = query<HTMLButtonElement>('[data-detail-copy]'); if (copy) copy.disabled = false;
    void renderTradeFeeDetails(response.market, generation);
    if(response.market.launchPhase===0)void loadCurvePricing(response.market).then(()=>{if(generation===tradeLoadGeneration&&!tradeQuote)renderTradeQuote();}).catch(()=>{});
 candleWidget?.setMarket({marketId:response.market.marketId,memeAsset:response.market.memeToken,quoteAsset:response.market.quoteAsset,quoteDecimals:metadata.quoteDecimals});
 holderWidget?.setMarket({marketId:response.market.marketId,memeToken:response.market.memeToken});
 tradeHistoryWidget?.setMarket({marketId:response.market.marketId,memeAsset:response.market.memeToken,quoteAsset:response.market.quoteAsset,quoteDecimals:metadata.quoteDecimals});
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("marketId", marketId);
    router.replaceLocation(nextUrl.href);
    text("[data-trade-market-name]", metadata.name);
    text("[data-trade-stock]", shortHex(response.market.assetUid, 9, 7));
    text('[data-detail-venue]',response.market.launchPhase===0?'Bonding curve':'Uniswap v4');
    void refreshTradeStake();
    if(response.market.gauge===ZERO_ADDRESS)text('[data-detail-stock-label]','Staking disabled');
    else {const asset=findAsset(response.market.assetUid);const token=stockToken(asset);text('[data-detail-stock-label]',token?shortHex(token):'-');renderDetailStakingSymbol(stockSymbol(asset),stockLogo(asset));
      const listed=stakingAssetForConfig(robinhoodChain.id,asset);if(listed)text('[data-detail-stock-label]',listed.symbol);else if(token)void publicClient.readContract({abi:erc20Abi,address:canonicalAddress(token,'Stock token'),functionName:'symbol'}).then(symbol=>{if(generation===tradeLoadGeneration){text('[data-detail-stock-label]',symbol);renderDetailStakingSymbol(symbol);}}).catch(()=>{});}

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
    renderTradeQuote();
    updateTradeAvailability();
    if (query<HTMLInputElement>("[data-trade-amount]")?.value.trim()) scheduleTradeQuote();
  } catch (error) {
    if (generation !== tradeLoadGeneration) return;
    clearTradeMarketState();
    text("[data-detail-phase]", "Market unavailable");
    query<HTMLElement>('.ref-hero')?.setAttribute('aria-busy','false');
    tokenDetailWidget?.setUnavailable();
    text('[data-detail-description]','Token Details Could Not Be Loaded');
    text("[data-detail-phase-note]", errorText(error));
    setPageStatus(`Market load failed — ${errorText(error)}`, "error");
    text("[data-trade-route-status]", "The route could not be verified; trading remains locked.");
    updateTradeAvailability();
  } finally {
    if(generation===tradeLoadGeneration)setTradePageLoading(false);
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
    const stakingBadge=query<HTMLElement>('[data-detail-staking-badge]');
    if(stakingBadge){stakingBadge.hidden=!config.stakingEnabled;stakingBadge.classList.toggle('is-pending',market.launchPhase!==1);}
    text('[data-detail-staking-status]',market.launchPhase===1?'Staking Enabled':'Stake Opens After Blooming');
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
    text('[data-detail-fees]', '-');
    text('[data-detail-fee-note]', 'Fee configuration could not be verified.');
  }
}

function scheduleTradeQuote(): void {
  window.clearTimeout(tradeQuoteExpiryTimer);
  window.clearTimeout(tradeQuoteTimer);
  const generation = ++tradeQuoteGeneration;
  tradeQuote = null;
  renderTradeQuote();
  tradeQuoteTimer = window.setTimeout(() => { void quoteTrade(generation); }, 300);
}

let tradeAutoRefreshPending=false;
async function refreshTradeQuote():Promise<void>{
  window.clearTimeout(tradeQuoteExpiryTimer);
  if(currentPage()!=='trade'||!tradeQuote||!wallet||document.hidden||tradeAutoRefreshPending)return;
  updateTradeAvailability();
  if(pageActionPending||busyOperation){tradeQuoteExpiryTimer=window.setTimeout(()=>{void refreshTradeQuote();},30000);return;}
  const previous=tradeQuote;
  tradeAutoRefreshPending=true;
  const generation=++tradeQuoteGeneration;
  try{await quoteTrade(generation);}finally{
    tradeAutoRefreshPending=false;
    if(generation===tradeQuoteGeneration&&tradeQuote===previous&&currentPage()==='trade'&&!document.hidden){
      tradeQuoteExpiryTimer=window.setTimeout(()=>{void refreshTradeQuote();},30000);
    }
  }
}
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){window.clearTimeout(tradeQuoteExpiryTimer);return;}
  if(currentPage()==='trade'&&tradeQuote){
    window.clearTimeout(tradeQuoteExpiryTimer);
    tradeQuoteExpiryTimer=window.setTimeout(()=>{void refreshTradeQuote();},Math.max(0,tradeQuote.expiresAtMs-Date.now()));
  }
});

async function quoteTrade(generation: number): Promise<void> {
  if (!tradeMarket || !tradeMetadata || !wallet || !foundation) {
    updateTradeAvailability();
    return;
  }
  const input = query<HTMLInputElement>('[data-trade-amount]')?.value.trim() ?? '';
  if (!input) { text('[data-trade-status]', ''); return; }
  const decimals = tradeSide === 'buy' ? tradeMetadata.quoteDecimals : 18;
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(input) || !/[1-9]/.test(input)) {
    text('[data-trade-status]', 'Enter A Valid Amount'); return;
  }
  if ((input.split('.')[1]?.length ?? 0) > decimals) {
    text('[data-trade-status]', `Use Up To ${decimals} Decimal Places`); return;
  }
  if(foundation.direct&&directMarkets){
    const current=tradeMarket;
    try {
      const fresh=await directMarkets.market(current.market.marketId);
      if(generation!==tradeQuoteGeneration||tradeMarket!==current)return;
      if(fresh.market.launchPhase!==current.market.launchPhase||fresh.market.sourceVersion!==current.market.sourceVersion){await refreshTradeFields(fresh);return;}
    } catch(error){if(generation===tradeQuoteGeneration)text('[data-trade-status]','Could Not Load Market. Try Again.');return;}
  }
  if(!tradeMarket||!tradeMetadata||!wallet)return;
  const market = tradeMarket;
  const metadata = tradeMetadata;
  const activeWallet = wallet;
  const side = tradeSide;
  if (!tradingRoute(market.market.launchPhase, market.market.canonicalRoute)) {
    text("[data-trade-status]", "Trading Is Temporarily Unavailable");
    updateTradeAvailability();
    return;
  }
  try {
    const amountInput = required<HTMLInputElement>("[data-trade-amount]").value;
    const inputDecimals = side === "buy" ? metadata.quoteDecimals : 18;
    const amount = parseTokenAmount(amountInput, inputDecimals, side === "buy" ? "Quote input" : "Meme input");
    // Read-only quotes do not need the transaction submission preflight.
    let pricing:CurvePricing|undefined;
    if(market.market.launchPhase===0)pricing=await loadCurvePricing(market.market);
    let quote: TradeQuote;
    if (market.market.launchPhase===1) {
      assertPoolRouterProfile(robinhoodChain.id,market.market.canonicalRoute.router);
      const route=poolTradeRoute(market.market,side);
      poolAmount(amount);
      const blockNumber=await publicClient.getBlockNumber({cacheTime:0});
      const binding=await loadPoolQuoteBindings(market.market,blockNumber);
      // The fee shown and the executable quote use the same block, refreshed together every 30 seconds.
      const [result,slot0]=await Promise.all([
       publicClient.simulateContract({abi:poolQuoterAbi,address:route.quoter,functionName:'quoteExactInputSingle',args:[{poolKey:route.poolKey,zeroForOne:route.zeroForOne,exactAmount:amount,hookData:'0x'}],account:activeWallet.account,blockNumber}),
       publicClient.readContract({abi:poolStateAbi,address:binding.manager,functionName:'extsload',args:[poolSlot0(market.market.poolId!)],blockNumber})]);
      const poolProtocolPips=poolProtocolFee(slot0,route.zeroForOne);
      const output=poolAmount(result.result[0]);
      quote=Object.freeze({side,marketId:market.market.marketId,input:amount,output,spent:side==='buy'?amount:null,refund:null,fee:null,poolProtocolPips,ownFeeBps:100+binding.taxBps,minimum:0n,revision:market.sync.revision,expiresAtMs:Date.now()+30_000});
    } else if (side === "buy") {
      const [tokensOut, quoteSpent, refund] = await publicClient.readContract({
        abi: v1Abis.TickerGardenCurve,
        address: canonicalAddress(market.market.curve, "Curve"),
        functionName: "quoteBuy",
        blockNumber: pricing!.blockNumber,
        args: [amount, activeWallet.account],
        account: activeWallet.account,
      });
      if (tokensOut <= 0n) throw new Error("Curve returned zero Meme output");
      if(!metadata.deployedAt)throw Error('Launch time missing');
      const elapsed=pricing!.timestamp-BigInt(metadata.deployedAt);
      let exempt=false;
      if(elapsed<5n){const release=marketRelease(market.market.marketId);const [creator,record]=await Promise.all([
        publicClient.readContract({address:canonicalAddress(market.market.memeToken,'Token'),abi:v1Abis.TickerMemeTokenV1,functionName:'creator',blockNumber:pricing!.blockNumber}),
        publicClient.readContract({address:release.marketRegistry,abi:v1Abis.MarketRegistryV1,functionName:'market',args:[market.market.marketId],blockNumber:pricing!.blockNumber})]);
        exempt=[creator,record.config.creatorRevenueBeneficiaryAtCreation].some(a=>a.toLowerCase()===activeWallet.account.toLowerCase());}
      const fee=curveBuyFee(quoteSpent,pricing!.baseBps,pricing!.taxBps,antiSnipeBps(elapsed,exempt,pricing!.baseBps,pricing!.taxBps));
      const metrics=curveTradeMetrics('buy',amount,tokensOut,quoteSpent,pricing!.quoteReserve,pricing!.tokenReserve,fee);
      quote = Object.freeze({
        side: "buy", marketId: market.market.marketId, input: amount, output: tokensOut,
        spent: quoteSpent, refund, fee, impactBps:metrics.impactBps, minimum: 0n,
        revision: market.sync.revision, expiresAtMs: Date.now() + 30_000,
      });
    } else {
      const [quoteOut, fee] = await publicClient.readContract({
        abi: v1Abis.TickerGardenCurve,
        address: canonicalAddress(market.market.curve, "Curve"),
        functionName: "quoteSell",
        blockNumber: pricing!.blockNumber,
        args: [amount],
        account: activeWallet.account,
      });
      if (quoteOut <= 0n) throw new Error("Curve returned zero Quote output");
      quote = Object.freeze({
        side: "sell", marketId: market.market.marketId, input: amount, output: quoteOut,
        spent: null, refund: null, fee, impactBps:curveTradeMetrics('sell',amount,quoteOut,0n,pricing!.quoteReserve,pricing!.tokenReserve,fee).impactBps, minimum: 0n,
        revision: market.sync.revision, expiresAtMs: Date.now() + 30_000,
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
    tradeQuoteExpiryTimer = window.setTimeout(() => { void refreshTradeQuote(); }, Math.max(0, quote.expiresAtMs - Date.now()));
    renderTradeQuote();
  } catch (error) {
    if (generation !== tradeQuoteGeneration) return;
    const message = errorText(error);
    text("[data-trade-status]", /zero .*output/i.test(message) ? 'Amount Too Small' : /insufficient.*(balance|funds)/i.test(message) ? 'Insufficient Balance' : /revert/i.test(message) ? 'Quote Unavailable. Try A Different Amount.' : 'Could Not Load Quote. Try Again.');
    updateTradeAvailability();
  }
}

function renderTradeImpact(bps?:bigint):void{
  const node=query<HTMLElement>('[data-trade-impact]');if(!node)return;
  node.textContent=bps===undefined?'-':`${Number(bps)/100}%`;
  node.dataset.impactLevel=bps===undefined||bps<100n?'normal':bps<1000n?'warning':'danger';
}

function renderTradePhase(graduated:boolean):void{
  const label=query<HTMLElement>('[data-detail-phase]');
  if(!label)return;
  label.classList.toggle('is-bloomed',graduated);
  if(graduated)iconText('[data-detail-phase]','ph-flower','Bloomed');
  else label.textContent='Growing';
}

function renderTradePoolAddress(market:MarketReadModel):void{
  const node=query<HTMLElement>('[data-detail-trading-pool]');if(!node)return;
  const value=market.launchPhase===1?market.poolId:market.curve;
  node.replaceChildren(document.createTextNode(market.launchPhase===1?'Uniswap v4 Pool ID: ':'Bonding curve: '));
  if(!value){node.append(document.createTextNode('-'));return;}
  const address=document.createElement('em');address.textContent=shortHex(value);address.title=value;
  const copy=document.createElement('button');copy.type='button';copy.className='trade-pool-copy';
  const label=market.launchPhase===1?'Copy Pool ID':'Copy Curve Address';
  copy.title=label;copy.setAttribute('aria-label',label);
  const icon=document.createElement('i');icon.className='ph ph-copy';icon.setAttribute('aria-hidden','true');copy.append(icon);
  copy.onclick=async()=>{
    try{await navigator.clipboard.writeText(value);icon.className='ph ph-check';copy.title='Copied';copy.setAttribute('aria-label','Copied');}
    catch{icon.className='ph ph-warning-circle';copy.title='Could Not Copy';copy.setAttribute('aria-label','Could Not Copy');}
    window.setTimeout(()=>{icon.className='ph ph-copy';copy.title=label;copy.setAttribute('aria-label',label);},1800);
  };
  node.append(address,copy);
}

function renderTradePrice(value:string|null):void{
  tokenDetailWidget?.setTradePrice(value);
  const node=query<HTMLElement>('[data-trade-rate]');if(!node)return;
  if(value===null||!tradeMetadata){node.textContent='-';node.removeAttribute('title');return;}
  const unit=`${tradeMetadata.quoteSymbol} / ${tradeMetadata.symbol}`;
  node.textContent=`${formatTradePrice(value)} ${unit}`;
  node.title=`${value} ${unit}`;
}

function renderTradeQuote(): void {
  const protocolRow=query<HTMLElement>('[data-trade-protocol-fee-row]');
  if(protocolRow)protocolRow.hidden=tradeQuote?.poolProtocolPips===undefined;
  text('[data-trade-protocol-fee]',tradeQuote?.poolProtocolPips===undefined?'-':formatPoolProtocolFee(tradeQuote.poolProtocolPips));
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
    submit.textContent = `${tradeSide === "buy" ? "Buy" : "Sell"}${tradeMetadata?.symbol ? ` ${tradeMetadata.symbol}` : ""}`;
  }
  if (!tradeQuote || !tradeMetadata) {
    text("[data-trade-output]", "-");
    query<HTMLOutputElement>('[data-trade-output]')?.removeAttribute('title');
    const pricing=curvePricing?.marketId===tradeMarket?.market.marketId?curvePricing:null;
    renderTradePrice(pricing&&pricing.tokenReserve>0n&&tradeMetadata?formatUnits(pricing.quoteReserve*10n**18n/pricing.tokenReserve,tradeMetadata.quoteDecimals):null);
    text("[data-trade-fee]",pricing?`${Number(pricing.baseBps+pricing.taxBps)/100}%`:'-');
    renderTradeImpact();
    text("[data-trade-minimum]", "-");
    text("[data-trade-status]", wallet ? "" : "Connect Your Wallet");
    updateTradeAvailability();
    return;
  }
  const outputDecimals = tradeQuote.side === "buy" ? 18 : tradeMetadata.quoteDecimals;
  const outputSymbol = tradeQuote.side === "buy" ? tradeMetadata.symbol : tradeMetadata.quoteSymbol;
  text("[data-trade-output]", formatTokenAmount(tradeQuote.output, outputDecimals));
  const outputNode=query<HTMLOutputElement>('[data-trade-output]');if(outputNode)outputNode.title=formatUnits(tradeQuote.output,outputDecimals);
  const meme=tradeQuote.side==='buy'?tradeQuote.output:tradeQuote.input;
  const quoteAmount=tradeQuote.side==='buy'?(tradeQuote.spent??tradeQuote.input):tradeQuote.output;
  renderTradePrice(formatUnits(quoteAmount*10n**18n/meme,tradeMetadata.quoteDecimals));
  text("[data-trade-fee]", tradeQuote.fee === null ? (tradeQuote.ownFeeBps!==undefined?`${tradeQuote.ownFeeBps/100}%`:"Included in Quote") : `${formatUnits(tradeQuote.fee, tradeMetadata.quoteDecimals)} ${tradeMetadata.quoteSymbol}`);
  renderTradeImpact(tradeQuote.impactBps);
  text("[data-trade-minimum]", `${formatTokenAmount(tradeQuote.minimum, outputDecimals)} ${outputSymbol}`);
  text("[data-trade-status]", "");
  updateTradeAvailability();
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
  const loading=tradeSubmitting||(tradeAwaitingConfirmation&&hasPendingTransaction());
  submit.classList.toggle('is-loading',loading);submit.setAttribute('aria-busy',String(loading));
  if(loading){submit.replaceChildren();const spinner=document.createElement('i');spinner.className='ph ph-spinner-gap trade-tx-spinner';spinner.setAttribute('aria-hidden','true');submit.append(spinner,document.createTextNode(tradeSubmittingLabel));}
  else submit.textContent=`${tradeSide==='buy'?'Buy':'Sell'}${tradeMetadata?.symbol?` ${tradeMetadata.symbol}`:''}`;
  setDisabled(submit, loading || !writeReady() || !quoteFresh || !routeReady || insufficient);
  if (insufficient) text('[data-trade-status]', `Insufficient ${tradeSide === 'buy' ? tradeMetadata?.quoteSymbol ?? 'Balance' : tradeMetadata?.symbol ?? 'Balance'}`);
}

let recentTradeLoading=false;
let recentTradeLoadedAt=0;
const poolTradeCursors=new Map<string,bigint>();
async function refreshRecentTrades(force=false):Promise<void>{
 const current=tradeMarket,metadata=tradeMetadata,page=routeGeneration;
 if(!current||!metadata||document.hidden||recentTradeLoading||(!force&&Date.now()-recentTradeLoadedAt<25000))return;
 recentTradeLoading=true;recentTradeLoadedAt=Date.now();
 const market=current.market;
 const update=(rows:Parameters<NonNullable<typeof tokenDetailWidget>['addRecentTrades']>[0])=>{if(page===routeGeneration&&tradeMarket?.market.marketId===market.marketId)tokenDetailWidget?.addRecentTrades(rows);};
 try{
  await Promise.allSettled([
   (async()=>{const manager=market.launchPhase===1?await cachedStatistics(`pool-manager:${market.canonicalRoute?.router}`,()=>publicClient.readContract({abi:poolRouterAbi,address:poolTradeRoute(market,'buy').router,functionName:'poolManager'})):undefined;return explorerRecentTrades(robinhoodChain.blockExplorers.default.url,market,metadata.quoteDecimals,manager,market.source.blockNumber);})().then(update),
   (async()=>{
    if(market.launchPhase!==1||!market.poolId)return;
    const route=poolTradeRoute(market,'buy');
    const manager=await publicClient.readContract({abi:poolRouterAbi,address:route.router,functionName:'poolManager'});
    const head=await publicClient.getBlockNumber(),previous=poolTradeCursors.get(market.marketId);
    const from=previous!==undefined?previous+1n:head>2000n?head-2000n:0n;
    if(from>head)return;
    // One market-filtered range request. Empty ranges advance the cursor too.
    const logs=await publicClient.getLogs({address:manager,event:poolSwapAbi[0],args:{id:market.poolId},fromBlock:from,toBlock:head});
    const blocks=new Map<bigint,bigint>();
    await Promise.all([...new Set(logs.slice(-30).map(log=>log.blockNumber))].map(async number=>{const block=await publicClient.getBlock({blockNumber:number});blocks.set(number,block.timestamp);}));
    update(logs.slice(-30).flatMap(log=>{const row=decodeRecentTrade(log,market,metadata.quoteDecimals,Number(blocks.get(log.blockNumber)),manager);return row?[row]:[];}));
    poolTradeCursors.set(market.marketId,head);
   })()
  ]);
 }finally{recentTradeLoading=false;}
}
function showReceiptTrades(receipt:TransactionReceipt,market:MarketReadModel,decimals:number,poolManager?:string):void{
 const page=routeGeneration;
 void publicClient.getBlock({blockNumber:receipt.blockNumber}).then(block=>{
  if(page!==routeGeneration||tradeMarket?.market.marketId!==market.marketId)return;
  tokenDetailWidget?.addRecentTrades(receipt.logs.flatMap(log=>{if(log.logIndex===null)return [];const row=decodeRecentTrade({...log,transactionHash:receipt.transactionHash,logIndex:log.logIndex},market,decimals,Number(block.timestamp),poolManager);return row?[row]:[];}));
 }).catch(()=>{void refreshRecentTrades(true);});
}

let tradeFieldsGeneration=0;
async function refreshTradeFields(fresh?:MarketDetailResponse,background=false):Promise<void>{
 const current=tradeMarket,own=++tradeFieldsGeneration,page=routeGeneration;
 if(!current||!foundation||!readApi)return;
 try{
  const response=fresh??(foundation.direct&&directMarkets?await directMarkets.market(current.market.marketId):await readApi.getMarket({marketId:current.market.marketId,revision:foundation.sync.revision}));
  if(own!==tradeFieldsGeneration||page!==routeGeneration||tradeMarket!==current||response.market.marketId!==current.market.marketId||response.market.memeToken!==current.market.memeToken)return;
  tradeMarket=response;
  const changed=response.market.launchPhase!==current.market.launchPhase || response.market.sourceVersion!==current.market.sourceVersion;
  const view=toCurveProgressViewModel(response),graduated=response.market.launchPhase===1;
  const baseline=foundation.baseline.find(c=>c.id===response.market.tickerGardenBaselineId),supply=baseline?.values.supply;
  renderTradePhase(graduated);
  for(const selector of ['[data-detail-progress-label]','[data-detail-graduation]']){const node=query<HTMLElement>(selector);if(node)node.hidden=graduated;}
  const progress=typeof supply==='string'?graduationProgress(BigInt(supply),view.reservedTokens,view.sellableTokens):null;
  text('[data-detail-progress-label]',progress===null?'-':`${progress.toFixed(2)}%`);
  const bar=query<HTMLProgressElement>('[data-detail-progress]');if(bar){if(progress===null)bar.removeAttribute('value');else bar.value=progress;}
  renderTradePoolAddress(response.market);
  text('[data-detail-venue]',graduated?'Uniswap v4':'Bonding curve');
  text('[data-detail-phase-note]','');
  curvePricing=null;
  // Keep identity, metadata, chart selection and existing statistics mounted.
  void loadDetailBalances(true);
  if(changed){void refreshTradeStake();void renderTradeFeeDetails(response.market,tradeLoadGeneration);}
  if(!graduated){try{await loadCurvePricing(response.market);}catch{/* Keep the existing display while the RPC recovers. */}}
  if(own!==tradeFieldsGeneration||page!==routeGeneration||tradeMarket!==response)return;
  if(!background || changed)overviewLoads.delete(response.market.marketId);
  void refreshMarketOverview(!background || changed);
  if(!background || changed){
    tradeQuote=null;renderTradeQuote();
    if(query<HTMLInputElement>('[data-trade-amount]')?.value.trim())scheduleTradeQuote();
  }else if(!tradeQuote){
    renderTradeQuote();
    if(query<HTMLInputElement>('[data-trade-amount]')?.value.trim())scheduleTradeQuote();
  }
 }catch{/* A display refresh must never turn a confirmed trade into an error. */}
}
function completeTradeDisplay(market:MarketDetailResponse):void{
 if(tradeMarket!==market)return;
 directMarkets?.cache.delete(market.market.marketId);
 window.clearTimeout(tradeQuoteExpiryTimer);window.clearTimeout(tradeQuoteTimer);++tradeQuoteGeneration;
 const input=query<HTMLInputElement>('[data-trade-amount]');if(input)input.value='';
 tradeQuote=null;renderTradeQuote();
 void refreshTradeFields();
}

async function submitTrade(): Promise<void> {
  if(tradeSubmitting)return;
  tradeSubmitting=true;tradeSubmittingLabel='Preparing…';updateTradeAvailability();
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
    if (currentInput !== quote.input) {
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
        showReceiptTrades(receipt,market.market,metadata.quoteDecimals);
        return true;
      },
    });
    completeTradeDisplay(market);
  } catch (error) {
    toast(`Trade requires attention — ${errorText(error)}`, "warning");
  } finally {tradeSubmitting=false;updateTradeAvailability();}
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
  if(wallet!==activeWallet||tradeMarket!==market||!quote||quote.input!==initial.input||quote.side!==initial.side||quote.minimum!==initial.minimum)throw Error('Trade changed during approval. Review the new quote.');
  const request=buildPoolTrade(market.market,quote.side,quote.input,quote.minimum,BigInt(Math.floor(quote.expiresAtMs/1000)));
  await executeTransaction({operationKey:`pool-trade:${quote.side}:${quote.marketId}:${quote.input}:${quote.expiresAtMs}`,sync:market.sync,request,quoteExpiresAtMs:quote.expiresAtMs,walletContext:activeWallet,verifyChain:verify,confirm:async receipt=>{
    receiptEvent(receipt,canonicalAddress(manager,'PoolManager'),poolSwapAbi,'Swap',args=>String(args.id).toLowerCase()===market.market.poolId&&String(args.sender).toLowerCase()===route.router.toLowerCase()&&typeof args.amount0==='bigint'&&typeof args.amount1==='bigint'&&(route.zeroForOne?args.amount0<0n&&args.amount1>0n:args.amount1<0n&&args.amount0>0n));
    showReceiptTrades(receipt,market.market,tradeMetadata?.quoteDecimals??18,manager);
    directMarkets?.receipt(receipt);return true;
  }});
  const input=query<HTMLInputElement>('[data-trade-amount]');if(input)input.value='';
  completeTradeDisplay(market);
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
 renderLaunchProgress({title:launchProgress.phase==='complete'?'Launch Successful':launchProgress.phase==='confirming'?'Token Created':launchProgress.phase==='pending'?'Launch Submitted':launchProgress.phase==='failed'?'Launch Stopped':'Launching Your Token',...display,detail:launchProgress.detail,hash:launchProgress.hash,
  explorer:launchProgress.hash?`${robinhoodChain.blockExplorers.default.url}/tx/${launchProgress.hash}`:'',needsHash:launchProgress.phase==='paused'||(launchProgress.phase==='wallet'&&!launchSubmitting),canDismiss:launchProgress.phase==='failed',outcome:['pending','confirming','complete'].includes(launchProgress.phase),complete:launchProgress.phase==='complete',tokenName:launchProgress.listing?.name},
 {onViewToken:()=>{if(launchProgress?.phase==='complete')navigateCompletedLaunch(launchProgress);},onHash:hash=>{if(!launchProgress||launchSubmitting)return;launchProgress.hash=hash;updateLaunchProgress('pending','Checking the transaction you provided…');void restoreLaunchProgress();},
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
 if(pageActionPending||busyOperation||walletConnecting||launchSubmitting){drawLaunchProgress();return;}
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
 launchProgress={...state,phase:'complete',hash:receipt.transactionHash,detail:'Confirmed On Chain. Your Token Is Ready.'};
 saveLaunchState(localStorage,launchProgress);drawLaunchProgress();
}
async function restoreLaunchProgress():Promise<void>{
 if(launchSubmitting||launchRecoveryBusy)return;
 if(launchRecoveryTimer){clearTimeout(launchRecoveryTimer);launchRecoveryTimer=undefined;}
 try{launchProgress=readLaunchState(localStorage,robinhoodChain.id);}catch(error){
  renderLaunchProgress({title:'Launch recovery needs attention',step:'Check saved launch',detail:errorText(error),percent:0,explorer:robinhoodChain.blockExplorers.default.url},{});return;
 }
 const state=launchProgress;if(!state){closeLaunchProgress();updateCreateAvailability();return;}
 if(state.phase==='complete'&&state.expected){
  drawLaunchProgress();return;
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
 if(!state.hash&&state.expected&&runtimeConfig.readApi.available){
  launchRecoveryBusy=true;
  try{const recovered=await new TickerGardenV1Client(runtimeConfig.readApi.value,(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(5000)})).getLaunchRecovery({marketId:state.expected.marketId as Hex});
   if(recovered.chainId===state.chainId&&recovered.displayOnly===true&&recovered.marketId===state.expected.marketId&&/^0x[0-9a-f]{64}$/.test(recovered.transactionHash)){state.hash=recovered.transactionHash;state.phase='pending';saveLaunchState(localStorage,state);}
  }catch{/* Receipt recovery remains available; no launch is resubmitted. */}finally{launchRecoveryBusy=false;}
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
  if(completed?.phase==='complete'&&completed.expected){launchProgress=completed;drawLaunchProgress();return;}
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
  if (!account) { label.textContent = "Connect wallet for balance"; return; }
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
  if(!launchImage||launchImageReading)throw new Error("Add a token image.");
  if (currentMetadataURI()) return;
  if (!launchMetadataOrigin) throw new Error("Publishing unavailable. Try again later.");
  const details = launchDetails();
  const key = JSON.stringify(details);
  setCreateNoticeLevel("[data-create-preview]", "info");
  text("[data-create-preview]", "Publishing details and image…");
  const activeWallet=wallet;if(!activeWallet)throw Error('Connect Your Wallet');
  await verifyLiveWalletContext(activeWallet);
  text('[data-create-preview]','Confirm Upload In Your Wallet…');
  const authorization=await authorizeUpload(launchMetadataOrigin,JSON.stringify(details),activeWallet.account,robinhoodChain.id,async message=>{
    await verifyLiveWalletContext(activeWallet);
    const encoded='0x'+[...new TextEncoder().encode(message)].map(b=>b.toString(16).padStart(2,'0')).join('');
    const signature=await activeWallet.provider.request({method:'personal_sign',params:[encoded,activeWallet.account]});
    await verifyLiveWalletContext(activeWallet);return String(signature);
  });
  if(key!==JSON.stringify(launchDetails()))throw Error('Details Changed. Review And Retry.');
  text('[data-create-preview]','Publishing Details And Image…');
  const published = await publishLaunchDetails(launchMetadataOrigin, details,authorization);
  if (key !== JSON.stringify(launchDetails())) throw new Error("Details changed. Review and retry.");
  if (!published.metadata) throw new Error("Published details missing. Try again later.");
  if (isIPFSFileURI(published.metadataURI) && !ipfsGatewayURL(published.metadataURI,import.meta.env.VITE_IPFS_GATEWAY)) throw new Error("Image gateway unavailable. Try again later.");
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
  text("[data-image-status]", "");
}

function showLatestListing(): void {
 const host=query<HTMLElement>("[data-listing-package]");
 if(host&&latestListing){
  renderListingPanel(host,latestListing.snapshot,latestListing.marketId,robinhoodChain.blockExplorers.default.url,robinhoodChain.testnet,import.meta.env.VITE_IPFS_GATEWAY,url=>{router.navigate(url);});
  const layout=query<HTMLElement>(".create-layout");if(layout)layout.hidden=true;
  const again=document.createElement('button');again.type='button';again.textContent='Create New Token';again.className='listing-create-another';host.append(again);
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
        const option = new Option('Asset unavailable — select another', '');
        field.prepend(option); field.value = '';
        field.setCustomValidity('Asset unavailable. Select another.');
      }
    }
    if (stock && foundation) updateQuotePicker(stock, foundation.assets.filter(a=>isListedStakingAsset(robinhoodChain.id,a)).map(a=>({value:a.id,symbol:stockSymbol(a),name:stakingAssetForConfig(robinhoodChain.id,a)?.name??'Stock',logoUrl:stockLogo(a),pending:false})));
  }
}
function saveCurrentCreateDraft(): void {
  const form = query<HTMLFormElement>('[data-create-form]'); if (!form || launchSubmitting) return;
  const values: Record<string,string|boolean> = {};
  for (const field of Array.from(form.elements)) {
    if (field instanceof HTMLInputElement && field.type === 'checkbox') values[field.name] = field.checked;
    else if ((field instanceof HTMLInputElement && field.type !== 'file') || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement) values[field.name] = field.value;
  }
  writeCreateDraft(localStorage, robinhoodChain.id, {...values,hadImage:draftImageMissing || !!launchImage || !!query<HTMLInputElement>('[name=tokenImage]')?.files?.length});
}

function setupCreate(): void {
 if(!latestListing){try{latestListing=parseSavedListing(localStorage.getItem(`tg-listing:${robinhoodChain.id}`),robinhoodChain.id);}catch{/* Browser storage may be disabled. */}}
 showLatestListing();
  const form = query<HTMLFormElement>("[data-create-form]");
  if (!form) return;
  pendingCreateDraft = readCreateDraft(localStorage, robinhoodChain.id);
  draftImageMissing = pendingCreateDraft?.hadImage === true;
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
    input.dispatchEvent(new Event("invalid", { cancelable: true }));
    launchImage = undefined;
    renderSelectedTokenImage();
    setCreateNoticeLevel("[data-image-status]", "info");
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
      draftImageMissing = false; saveCurrentCreateDraft();
      renderSelectedTokenImage(image, file, dimensions);
    } catch (error) { if (generation === launchImageGeneration) { input.setCustomValidity(errorText(error)); text("[data-image-status]", ""); input.dispatchEvent(new Event("invalid", { cancelable: true })); } }
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
    text("[data-create-config-status]", "Launch unavailable.");
    updateCreateAvailability();
    return;
  }
  const stockSelect = required<HTMLSelectElement>("[name=assetUid]", form);
  const activeStocks = foundation.assets.filter((item) => isListedStakingAsset(robinhoodChain.id, item));
  populateSelect(stockSelect, activeStocks, "No eligible staking assets");
  updateQuotePicker(stockSelect, activeStocks.map((stock) => ({
    value: stock.id,
    symbol: stockSymbol(stock),
    logoUrl: stockLogo(stock),
    name: stakingAssetForConfig(robinhoodChain.id,stock)?.name ?? String(stock.values.tokenName ?? "STOCK"),
    pending: false,
  })));
  populateSelect(required<HTMLSelectElement>("[name=tickerGardenBaselineId]", form), foundation.baseline.filter((item) => item.status === 1), "Select an active TickerGarden baseline");
  populateSelect(required<HTMLSelectElement>("[name=launchTemplateId]", form), foundation.templates.filter((item) => item.status === 1), "Select an active launch template");
  applyCreateDraft(true);
  alignBaselineToQuote();
  text("[data-create-config-status]", foundation.writeReady
    ? ""
    : "Launch unavailable.");
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
  text("[data-treasury-option-status]", "Share 50% of base fees with holders. Creator tax stays yours. Permanent at launch.");
  const treasuryDetails = query<HTMLElement>("#treasury-details");
  if (treasuryDetails) treasuryDetails.hidden = !details.creatorFeesToHolders;
  text("[data-token-name]", details.name || "Your next big idea");
  text("[data-token-symbol]", details.symbol || "ticker");
  text("[data-token-description]", details.description);
  const description=query<HTMLTextAreaElement>('[name=description]');
  if(description){
    const error=fieldError(description.value,{kind:'description'});
    description.setCustomValidity(error);
    if(error)description.setAttribute('aria-invalid','true');
    text('[data-description-count]',`${description.value.length} / 300`);
  }
  const stakingEnabled = query<HTMLInputElement>("[name=stakingEnabled]")?.checked ?? false;
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
    const recipient=query<HTMLElement>("[data-creator-tax-recipient]");if(recipient)recipient.hidden=tax===0;
  } catch { text("[data-fee-tax]", "Invalid rate");const recipient=query<HTMLElement>("[data-creator-tax-recipient]");if(recipient)recipient.hidden=true; }
  text("[data-fee-staking-note]", stakingEnabled
    ? "Staker fees apply after Bloomed, with active stake."
    : "Staking is off. Fee split stays unchanged.");
  text("[data-preview-asset]", !stakingEnabled ? "Staking disabled" : stockSelect?.value ? stockSelect.selectedOptions[0]?.textContent?.split(" · ")[0] ?? "-" : "-");
  const selection = query<HTMLSelectElement>("[name=quoteAssetConfigId]")?.value ?? "";
  const quote = foundation?.quotes.find(item => item.id === selection);
  const releaseAsset = releasePairForSelection(selection, foundation?.quotes ?? []);
  displayPriceWidget?.setToken(typeof quote?.values.quoteAsset === "string" ? quote.values.quoteAsset : null);
  text("[data-preview-launch-fee]", foundation?.launchFee === undefined ? "-" : `${formatTokenAmount(foundation.launchFee, 18)} ETH`);
  text("[data-preview-trade-fee]", "-");
  text("[data-preview-graduation]", "-");
  text("[data-graduation-caption]", "Loading bloom target…");
  text("[data-graduation-exact]", "");
  const symbol = releaseAsset?.symbol ?? "-";
  text("[data-preview-quote]", symbol);
  text("[data-buy-symbol]", symbol);
  const amount = query<HTMLInputElement>("[name=firstBuyAmount]")?.value.trim() ?? "";
  text("[data-preview-mode]", query<HTMLSelectElement>("[name=launchMode]")?.value === "create-buy" ? `${amount} ${symbol}` : "-");
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
  const asset = foundation.assets.find((item) => item.id === assetUid && isListedStakingAsset(robinhoodChain.id,item));
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
  text("[data-create-preview]", "");
  updateCreateAvailability();
  launchPreviewTimer = window.setTimeout(() => { void refreshLaunchPreview(generation); }, 350);
}

async function refreshLaunchPreview(generation: number): Promise<void> {
  const form=query<HTMLFormElement>('[data-create-form]');
  // An unfinished form is normal. Do not run RPC previews or report it as a failure.
  if(!form||!wallet||!foundation?.writeReady||[...form.elements].some(field=>
    (field instanceof HTMLInputElement||field instanceof HTMLSelectElement||field instanceof HTMLTextAreaElement)&&!field.disabled&&!field.validity.valid)){
    if(generation===launchPreviewGeneration){text('[data-create-preview]','');const funding=query<HTMLElement>('[data-launch-funding]');if(funding)funding.hidden=true;}
    return;
  }
  try {
    const preview = await previewLaunch(undefined, true);
    const funding = await calculateLaunchFunding(preview);
    if (generation !== launchPreviewGeneration) return;
    launchPreview = preview;
    launchFunding = funding;
    renderLaunchFunding(funding);
    text("[data-create-preview]", "");
    setCreateNoticeLevel("[data-create-preview]", "info");
    renderCreateIdentity();
    updateCreateAvailability();
  } catch (error) {
    if (generation !== launchPreviewGeneration) return;
    launchPreview = null;
    launchFunding = null;
    const panel = query<HTMLElement>("[data-launch-funding]");
    if (panel) panel.hidden = true;
    text("[data-create-preview]", errorText(error));
    setCreateNoticeLevel("[data-create-preview]", "error");
    updateCreateAvailability();
  }
}

function setCreateNoticeLevel(selector:string,level:CreateNoticeLevel):void {
  const notice=query<HTMLElement>(selector);if(!notice)return;
  notice.classList.add('create-notice');
  notice.classList.toggle('create-notice-warning',level==='warning');
  notice.classList.toggle('create-notice-error',level==='error');
  notice.dataset.noticeLevel=level;
}

function updateCreateAvailability(): void {
  const button = query<HTMLButtonElement>("[data-create-submit]");
  const form = query<HTMLFormElement>("[data-create-form]");
  if (!button || !form) return;
  const buyMode = query<HTMLSelectElement>("[name=launchMode]")?.value === "create-buy";
  const invalid = [...form.elements].find((e): e is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
    (e instanceof HTMLInputElement || e instanceof HTMLSelectElement || e instanceof HTMLTextAreaElement) && !e.disabled && !e.validity.valid);
  const labels: Record<string,string> = {name:"Name",symbol:"Ticker",description:"Description",assetUid:"Staking asset",quoteAssetConfigId:"Paired asset",website:"Website",x:"X profile",firstBuyAmount:"Developer buy",creatorTax:"Creator tax",beneficiary:"Creator beneficiary",tickerGardenBaselineId:"Market pricing",launchTemplateId:"Launch settings",tokenImage:"Token image"};
  const availability:CreateAvailability={submitting:launchSubmitting||Boolean(launchProgress&&launchProgress.phase!=="complete"),imageReading:launchImageReading,imageReady:Boolean(launchImage),
    runtimeReady:Boolean(foundation?.writeReady),runtimeReason:runtimeReasons().join("; "),walletConnected:Boolean(wallet),busy:Boolean(busyOperation||walletConnecting||hasPendingTransaction()),
    pendingQuote:query<HTMLSelectElement>("[name=quoteAssetConfigId]")?.value.startsWith("pending:")===true,
    invalidField:invalid ? labels[invalid.name] ?? invalid.name : undefined,metadataReady:Boolean(launchMetadataOrigin),buyMode,
    fundingReady:Boolean(launchFunding),insufficientEth:Boolean(launchFunding&&launchFunding.ethBalance<launchFunding.totalRequired)};
  const reason=draftImageMissing ? "Reselect your image." : createDisabledReason(availability);
  setDisabled(button, Boolean(reason));
  let hint = query<HTMLElement>("[data-create-blocker]",form);
  if(!hint){hint=document.createElement("p");hint.dataset.createBlocker="";hint.id="create-blocker";hint.setAttribute("role","status");button.insertAdjacentElement("beforebegin",hint);}
  const fieldError=reason?.startsWith('Check ')===true;
  const showReason=!!reason&&(!fieldError||invalid?.getAttribute('aria-invalid')==='true');
  setCreateNoticeLevel('[data-create-blocker]',draftImageMissing ? 'error' : createDisabledLevel(availability));
  hint.textContent=showReason ? reason! : '';hint.hidden=!showReason;
  if(showReason)button.setAttribute("aria-describedby",hint.id);else button.removeAttribute("aria-describedby");
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
  // The sidebar already shows the pair and developer-buy amount. Only call out a conversion here.
  const conversion=funding.mode==='native-fallback';
  for(const selector of ['[data-funding-route]','[data-funding-swap]']){
    const row=query<HTMLElement>(selector)?.parentElement;if(row)row.hidden=!conversion;
  }
  text("[data-funding-route]", funding.mode === "native-fallback" ? `Automatic ETH → ${symbol}` : funding.mode === "quote" ? `Wallet ${symbol}` : "ETH");
  text("[data-funding-quote-balance]", funding.mode === "native" ? "ETH" : `${formatTokenAmount(funding.quoteBalance, funding.quoteDecimals)} ${symbol}`);
  text("[data-funding-swap]", funding.mode === "native-fallback" ? `${formatTokenAmount(funding.maxNativeQuoteInput ?? 0n, 18)} ETH max` : funding.mode === "native" ? `${formatTokenAmount(funding.quotedNativeInput, 18)} ETH` : "0 ETH");
  text("[data-funding-gas]", `${formatTokenAmount(funding.gasCost, 18)} ETH allowance`);
  text("[data-funding-total]", `${formatTokenAmount(funding.totalRequired, 18)} ETH`);
  text("[data-funding-balance]", `${formatTokenAmount(funding.ethBalance, 18)} ETH`);
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
  const form=required<HTMLFormElement>('[data-create-form]');
  if(!form.reportValidity())return;
  if(!launchImage||launchImageReading||!wallet){updateCreateAvailability();return;}
  const snapshot=()=>JSON.stringify({chainId:robinhoodChain.id,account:wallet?.account,details:launchDetails(),fields:[...new FormData(form).entries()].filter(([,value])=>typeof value==='string')});
  const details=launchDetails();
  const pair=query<HTMLElement>('[data-preview-quote]')?.textContent ?? '-';
  const buy=query<HTMLElement>('[data-preview-mode]')?.textContent ?? '-';
  const staking=query<HTMLInputElement>('[name=stakingEnabled]')?.checked;
  const stock=query<HTMLElement>('[data-preview-asset]')?.textContent ?? '-';
  const content=document.createElement('section');content.className='launch-confirm-content';
  const identity=document.createElement('div');identity.className='launch-confirm-identity';
  const image=document.createElement('img');image.src=launchImage;image.alt='';
  const identityText=document.createElement('div');
  const name=document.createElement('strong');name.textContent=details.name;
  const ticker=document.createElement('span');ticker.textContent=`$${details.symbol}`;
  identityText.append(name,ticker);identity.append(image,identityText);content.append(identity);
  const addRows=(rows:readonly (readonly [string,string])[],className='')=>{
    const list=document.createElement('dl');list.className=`launch-confirm-rows ${className}`;
    for(const [label,value] of rows){const row=document.createElement('div');const term=document.createElement('dt');term.textContent=label;const definition=document.createElement('dd');definition.textContent=value;if(label==='Wallet'){definition.title=value;definition.textContent=shortHex(value,7,5);}row.append(term,definition);list.append(row);}
    content.append(list);
  };
  addRows([['Network',robinhoodChain.name],['Wallet',wallet.account]]);
  addRows([['Paired Asset',pair],['Developer Buy',buy],['Staking Rewards',staking ? stock : 'Disabled'],['Creator Tax',`${details.creatorTaxBps/100}%`],['Holder Fee Sharing',details.creatorFeesToHolders ? 'Enabled' : 'Disabled']]);
  if(launchFunding)addRows([['Estimated Total',`${formatTokenAmount(launchFunding.totalRequired,18)} ETH`]],'launch-confirm-total');
  try {
    await confirmLaunch(snapshot,()=>confirmFlowAction('',{title:'Confirm Launch',confirmLabel:'Confirm And Launch',content}),performLaunch);
  } catch(error){text('[data-create-preview]',errorText(error));setCreateNoticeLevel('[data-create-preview]','error');updateCreateAvailability();}
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
    if (launchImageReading) throw new Error("Loading image…");
    if (!launchImage) throw new Error("Add a token image.");
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
    creatorDirectoryAt=0;
    try { localStorage.setItem(`tg-listing:${robinhoodChain.id}`,JSON.stringify(latestListing)); } catch { /* Downloads still work without browser storage. */ }
    if(launchProgress?.listing)launchProgress.listing.txHash=confirmedHash;
    updateLaunchProgress('complete','Confirmed On Chain. Your Token Is Ready.');
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
  observedBlock: bigint;
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
let continuousReward: Readonly<{ marketId: Hex; mode: Hex; quote: Address; account: Address; claimable: bigint; memeClaimable: bigint }> | null = null;
let directEscape: DirectEscapeState | null = null;
let rewardLoadGeneration = 0;
let creatorLoadGeneration = 0;
let treasuryLoadGeneration = 0;
let directEscapeLoadGeneration = 0;
let directEscapeRefreshTimer = 0;

const treasuryStatusLabels = ["Not requested", "Root requested", "Root under review", "Claiming", "Rolled over"] as const;

const rewardMarketLabels = new Map<string, { label: string; search: string; symbol?:string }>();

// Statistics are display-only, cached for ten minutes, and never gate transactions.
type StakeStats = {title:string;description:string;quoteSymbol:string;phase:string;volume:string;fees:string;total:string;totalRaw:bigint|null;status:string;expiresAt:number};
const stakeStatsCache = new Map<string,{at:number;data:StakeStats}>();
const stakeStatsRequests = new Map<string,Promise<StakeStats>>();
let stakeStatsGeneration = 0;
let stakeStatisticsTimer=0;
let stakePageListeners:AbortController|undefined;
function stakeAssetAmount(selector:string,amount:string,config:ConfigReadModel):void {
 const symbol=stockSymbol(config),logo=stockLogo(config);
 queryAll<HTMLElement>(selector).forEach(target=>{
  const signature=JSON.stringify([amount,symbol,logo]);
  if(target.dataset.assetAmount===signature&&target.querySelector('.stake-amount-unit'))return;
  target.dataset.assetAmount=signature;
  if(amount==='-'){target.textContent='-';return;}
  const number=document.createElement('span');number.className='stake-amount-number';number.textContent=amount;
  const unit=document.createElement('span');unit.className='stake-amount-unit';
  unit.append(document.createTextNode(symbol));
  if(logo){const image=document.createElement('img');image.src=logo;image.alt='';image.width=12;image.height=12;image.onerror=()=>{image.hidden=true;};unit.append(image);}
  target.replaceChildren(number,unit);
 });
}
function stakeText(selector:string,value:string):void { queryAll<HTMLElement>(selector).forEach(el=>{const next=publicMessage(value);if(el.textContent!==next)el.textContent=next;}); }
function stockSymbol(config:ConfigReadModel):string {return stakingAssetForConfig(robinhoodChain.id,config)?.symbol ?? String(config.values.tokenSymbol ?? 'STOCK');}
function stockLogo(config:ConfigReadModel):string|undefined {const asset=stakingAssetForConfig(robinhoodChain.id,config);return asset?assetLogoUrl(asset.logo):quoteIconUrl(stockSymbol(config));}
async function refreshStakeStatistics():Promise<void>{
  if(currentPage()!=='staking'||document.hidden)return;
  const generation=++stakeStatsGeneration;
  const id=query<HTMLSelectElement>('[data-position-market]')?.value;
  const market=foundation?.markets.find(m=>m.marketId===id);
  const card=query<HTMLElement>('.staking-page .market-card');
  const sameMarket=!!market&&card?.dataset.marketId===market.marketId;
  const detailsButton=query<HTMLButtonElement>('[data-stake-token-details]');
  if(detailsButton)detailsButton.hidden=!market;
  const quoteAsset=query<HTMLElement>('[data-stake-quote-asset]');
  const stockIcon=query<HTMLImageElement>('[data-stake-stock-icon]');
  if(!sameMarket){
    if(card)card.dataset.marketId=market?.marketId??'';
    if(quoteAsset)quoteAsset.hidden=true;
    stakeText('[data-stake-share]','-');
    stakeText('[data-stake-market-title],[data-stake-modal-market]',market ? rewardMarketLabels.get(market.marketId)?.label??shortHex(market.marketId):'Select a market');
    stakeText('[data-stake-market-description]','Choose a market to see its staking activity.');
    stakeText('[data-stake-modal-stock]','-');
    if(stockIcon){stockIcon.hidden=true;stockIcon.removeAttribute('src');}
    for(const key of ['volume','fees','total'])stakeText(`[data-stake-${key}]`,'-');
    stakeText('[data-stake-stats-status]',market?'Loading Market Statistics…':'Search Or Select A Market');
  }
  stakeText('[data-stake-phase]',market?phaseLabel(market.launchPhase):'-');
  renderSelectedStakeLogo();
  if(!market)return;
  loadStakeMarketIcon(market);
  const config=foundation?.assets.find(a=>a.id===market.assetUid);
  stakeText('[data-stake-modal-stock]',config?stockSymbol(config):'STOCK');
  const iconUrl=config?stockLogo(config):null;if(stockIcon&&iconUrl){if(stockIcon.getAttribute('src')!==iconUrl)stockIcon.src=iconUrl;stockIcon.hidden=false;}
  const load=async():Promise<StakeStats>=>{
    const metadata=await marketMetadata(market);
    const data:StakeStats={title:metadata.symbol,description:metadata.name,quoteSymbol:metadata.quoteSymbol,phase:phaseLabel(market.launchPhase),volume:'-',fees:'-',total:'-',totalRaw:null,status:'Statistics unavailable. Your position can still load independently.',expiresAt:Date.now()+600000};
    const results=await Promise.allSettled([
      (async()=>{
        if(!runtimeConfig.readApi.available)throw Error('Analytics unavailable');
        if(!runtimeConfig.contracts.available)throw Error('Market configuration unavailable');
        return explorerStakeStatistics({apiBase:runtimeConfig.readApi.value,market,decimals:metadata.quoteDecimals,feeVault:runtimeConfig.contracts.value.protocolFeeVaultAddress});
      })(),
      (async()=>{
        // Display-only aggregate from the configured Vault; signing uses canonical bindings separately.
        if(!config)throw Error('Stock configuration unavailable');
        const decimals=Number(config.values.tokenDecimals);
        if(!Number.isInteger(decimals)||decimals<0||decimals>18)throw Error('Stock decimals unavailable');
        const vault=canonicalAddress(String(config.values.userStockVault),'Stock Vault');
        const total=await publicClient.readContract({abi:v1Abis.UserStockVault,address:vault,functionName:'marketAllocated',args:[market.assetUid,market.marketId]});
        return {raw:total,label:`${formatTokenAmount(total,decimals)} ${stockSymbol(config)}`};
      })()
    ]);
    const analytics=results[0];
    if(analytics.status==='fulfilled'){
      const stats=analytics.value;
      if(stats.volume!=='')data.volume=`${displayDecimal(stats.volume)} ${metadata.quoteSymbol}`;
      if(stats.fees)data.fees=stats.fees.size?[...stats.fees].map(([asset,amount])=>{
        if(asset!==market.quoteAsset.toLowerCase()&&asset!==market.memeToken.toLowerCase())throw Error('Unexpected fee asset');
        return `${formatTokenAmount(amount,asset===market.quoteAsset.toLowerCase()?metadata.quoteDecimals:18)} ${asset===market.quoteAsset.toLowerCase()?metadata.quoteSymbol:metadata.symbol}`;
      }).join('\n'):`0 ${metadata.quoteSymbol}`;
      data.status='Updated Every 10–20 Minutes';
    }
    if(results[1].status==='fulfilled'){data.total=results[1].value.label;data.totalRaw=results[1].value.raw;}
    return data;
  };
  try{
    let cached=stakeStatsCache.get(market.marketId);
    if(!cached||Date.now()-cached.at>=600000||Date.now()>=cached.data.expiresAt){
      let request=stakeStatsRequests.get(market.marketId);
      if(!request){request=load();stakeStatsRequests.set(market.marketId,request);void request.finally(()=>stakeStatsRequests.delete(market.marketId)).catch(()=>{});}
      cached={at:Date.now(),data:await request};stakeStatsCache.set(market.marketId,cached);
    }
    if(generation!==stakeStatsGeneration||currentPage()!=='staking')return;
    const data=cached.data;
    renderStakeShare();
    stakeText('[data-stake-market-title],[data-stake-modal-market]',data.title);
    stakeText('[data-stake-market-description]',data.description);
    stakeText('[data-stake-quote-symbol]',data.quoteSymbol);
    if(quoteAsset)quoteAsset.hidden=false;
    const quoteIcon=query<HTMLImageElement>('[data-stake-quote-icon]');
    const quoteUrl=quoteIconUrl(data.quoteSymbol);
    if(quoteIcon){quoteIcon.hidden=!quoteUrl;if(quoteUrl&&quoteIcon.getAttribute('src')!==quoteUrl)quoteIcon.src=quoteUrl;}
    for(const key of ['volume','fees','status'] as const)stakeText(key==='status'?'[data-stake-stats-status]':`[data-stake-${key}]`,data[key]);
    if(config){const suffix=` ${stockSymbol(config)}`;stakeAssetAmount('[data-stake-total]',data.total.endsWith(suffix)?data.total.slice(0,-suffix.length):data.total,config);}else stakeText('[data-stake-total]',data.total);
  }catch{if(generation===stakeStatsGeneration)stakeText('[data-stake-stats-status]','Market statistics unavailable. Refresh to retry.');}
}

type StakeDirectoryRow={marketId:string;assetUid:string;label:string};
let stakeDirectoryAccount='';
let stakeDirectoryAt=0;
let stakeDirectoryGeneration=0;
let stakeDirectoryBusy=false;
let stakePositionsPage:PositionPage|undefined;
let stakeActivityPage:UserActivityPage|undefined;
const stakePositionIds=new Set<string>();
const stakeDirectoryRows=new Map<string,StakeDirectoryRow>();
const stakeMarketIcons=new Map<string,string>();
const stakeMarketIconRequests=new Set<string>();
function renderSelectedStakeLogo():void {
  const id=query<HTMLSelectElement>('[data-position-market]')?.value;
  const fallback=new URL('../assets/token-placeholder.svg',import.meta.url).href;
  const url=(id&&stakeMarketIcons.get(id))||fallback;
  for(const image of queryAll<HTMLImageElement>('[data-stake-token-logo]')){
    image.hidden=false;
    if(image.dataset.logoUrl===url)continue;
    image.dataset.logoUrl=url;
    image.onerror=()=>{image.onerror=null;image.src=fallback;};
    image.src=url;
  }
}
function loadStakeMarketIcon(market:MarketReadModel):void {
  if(stakeMarketIconRequests.has(market.marketId))return;
  stakeMarketIconRequests.add(market.marketId);
  void (async()=>{
    const metadata=await marketMetadata(market);
    const previous=rewardMarketLabels.get(market.marketId);
    rewardMarketLabels.set(market.marketId,{label:previous?.label??metadata.symbol,search:previous?.search??`${metadata.symbol} ${metadata.name}`,symbol:metadata.symbol});
    if(currentPage()==='staking'){renderStakeDirectory();updateStakeSearchIdentity(market.marketId);}
    const detail=await readDetailMetadata(metadata.metadataURI??'',launchMetadataOrigin,AbortSignal.timeout(8000),import.meta.env.VITE_IPFS_GATEWAY);
    if(detail?.image){stakeMarketIcons.set(market.marketId,detail.image);if(currentPage()==='staking'){renderStakeDirectory();updateStakeSearchIdentity(market.marketId);renderSelectedStakeLogo();}}
  })().catch(()=>{/* Keep the neutral token icon when optional metadata cannot load. */});
}
function renderStakeDirectory():void{
  const target=query<HTMLElement>('[data-stake-my-markets]');if(!target)return;
  const signature=JSON.stringify({account:stakeDirectoryAccount,busy:stakeDirectoryBusy,positionCursor:stakePositionsPage?.nextCursor,activityCursor:stakeActivityPage?.nextCursor,selected:query<HTMLSelectElement>('[data-position-market]')?.value,rows:[...stakeDirectoryRows.values()].map(row=>[row.marketId,row.assetUid,rewardMarketLabels.get(row.marketId)?.symbol,stakeMarketIcons.get(row.marketId)])});
  if(target.dataset.rendered===signature)return;
  target.dataset.rendered=signature;target.replaceChildren();
  const search=currentPage()==='staking'?'':query<HTMLInputElement>('[data-position-search]')?.value.toLowerCase().trim()??'';
  for(const row of stakeDirectoryRows.values()){
    const label=rewardMarketLabels.get(row.marketId)?.label ?? shortHex(row.marketId,8,6);
    if(!`${label} ${row.marketId} ${row.assetUid}`.toLowerCase().includes(search))continue;
    const button=document.createElement('button');button.type='button';button.className='stake-market-item';
    button.setAttribute('aria-pressed',String(query<HTMLSelectElement>('[data-position-market]')?.value===row.marketId));
    const market=foundation?.markets.find(item=>item.marketId===row.marketId);
    const asset=foundation?.assets.find(item=>item.id===row.assetUid);
    const mark=document.createElement('span');mark.className='stake-market-logo';
    const image=document.createElement('img');image.alt='';image.src=stakeMarketIcons.get(row.marketId)??new URL('../assets/token-placeholder.svg',import.meta.url).href;
    image.onerror=()=>{image.onerror=null;image.src=new URL('../assets/token-placeholder.svg',import.meta.url).href;};mark.append(image);
    const copy=document.createElement('span');copy.className='stake-market-copy';
    const name=document.createElement('strong');name.textContent=rewardMarketLabels.get(row.marketId)?.symbol??shortHex(row.marketId);
    const note=document.createElement('small');note.textContent=asset?stockSymbol(asset):'Stock';copy.append(name,note);button.append(mark,copy);
    if(market)loadStakeMarketIcon(market);
    button.addEventListener('click',()=>{
      const select=query<HTMLSelectElement>('[data-position-market]');
      if(select && [...select.options].some(o=>o.value===row.marketId)){select.value=row.marketId;select.dispatchEvent(new Event('change'));renderStakeDirectory();}
      else router.navigate(`/stake?marketId=${encodeURIComponent(row.marketId)}#positions`);
    });target.append(button);
  }


  if(!target.childElementCount){
    const empty=document.createElement('div');empty.className='stake-markets-empty';
    const mark=document.createElement('span');mark.className='stake-empty-mark';
    const icon=document.createElement('i');icon.className='ph ph-plant';icon.setAttribute('aria-hidden','true');mark.append(icon);
    const title=document.createElement('strong');title.textContent='Your Markets Appear Here';
    const hint=document.createElement('p');hint.textContent='Select A Market To Start Staking.';
    const browse=document.createElement('button');browse.type='button';browse.textContent='Explore Markets';
    const arrow=document.createElement('i');arrow.className='ph ph-arrow-right';arrow.setAttribute('aria-hidden','true');browse.append(arrow);
    browse.addEventListener('click',()=>{query<HTMLInputElement>('[data-position-search]')?.focus();});
    empty.append(mark,title,hint,browse);target.append(empty);
  }

  const more=query<HTMLButtonElement>('[data-stake-history-more]');if(more){more.hidden=!stakePositionsPage?.nextCursor&&!stakeActivityPage?.nextCursor;more.disabled=stakeDirectoryBusy;}
}
async function refreshStakeDirectory(more=false,force=false):Promise<void>{
  if(currentPage()!=='staking')return;
  const account=wallet?.account.toLowerCase()??'';
  if(account!==stakeDirectoryAccount){stakeDirectoryAccount=account;stakeDirectoryRows.clear();stakePositionIds.clear();stakePositionsPage=undefined;stakeActivityPage=undefined;stakeDirectoryAt=0;stakeDirectoryBusy=false;++stakeDirectoryGeneration;}
  renderStakeDirectory();
  if(!account){stakeText('[data-stake-history-status]','');return;}
  if(stakeDirectoryBusy||(!more&&!force&&Date.now()-stakeDirectoryAt<600000))return;
  if(!runtimeConfig.readApi.available){stakeText('[data-stake-history-status]','Recorded history unavailable. You can select a market directly.');return;}
  stakeDirectoryBusy=true;const generation=++stakeDirectoryGeneration;renderStakeDirectory();
  stakeText('[data-stake-history-status]','Loading recorded positions…');
  const api=new TickerGardenV1Client(runtimeConfig.readApi.value,(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(12000)}));
  try{
    const results=await Promise.allSettled([
      more&&!stakePositionsPage?.nextCursor ? Promise.resolve(undefined) : api.listUserPositions({address:account as Address,limit:100,...(more&&stakePositionsPage ? {cursor:stakePositionsPage.nextCursor!,revision:stakePositionsPage.sync.revision} : {})}),
      more&&!stakeActivityPage?.nextCursor ? Promise.resolve(undefined) : api.listUserActivity({address:account as Address,limit:100,...(more&&stakeActivityPage ? {cursor:stakeActivityPage.nextCursor!} : {})})
    ]);
    if(generation!==stakeDirectoryGeneration||wallet?.account.toLowerCase()!==account||currentPage()!=='staking')return;
    const errors:string[]=[];
    const positions=results[0];
    if(positions.status==='fulfilled'&&positions.value){try{
      const page=positions.value;assertFinalizedSync(page.sync,more&&stakePositionsPage ? stakePositionsPage.sync.revision : page.sync.revision,'staking directory');
      validateStakePositions(page.items,account,robinhoodChain.id,more?stakePositionIds:undefined,{blockNumber:page.sync.blockNumber!,blockHash:page.sync.blockHash!});
      if(page.nextCursor!==null&&(typeof page.nextCursor!=='string'||!page.nextCursor||(more&&page.nextCursor===stakePositionsPage?.nextCursor)))throw Error('Invalid continuation');
      if(!more){stakeDirectoryRows.clear();stakePositionIds.clear();}
      for(const p of page.items){stakePositionIds.add(p.marketId);stakeDirectoryRows.set(p.marketId,{marketId:p.marketId,assetUid:p.assetUid,label:BigInt(p.allocated)>0n ? 'Staked · indexed position' : 'No active stake · indexed position'});}
      stakePositionsPage=page;
    }catch{errors.push('Positions unavailable');}}else if(positions.status==='rejected')errors.push('Positions unavailable');
    const activity=results[1];
    if(activity.status==='fulfilled'&&activity.value){try{
      const page=validateUserActivity(activity.value,robinhoodChain.id,account,100,more ? stakeActivityPage : undefined);
      for(const event of page.items){const row=stakeHistoryEvent(event,account);if(row&&!stakeDirectoryRows.has(row.marketId))stakeDirectoryRows.set(row.marketId,{...row,label:row.exited?'Exited · recorded history':'Staked before · recorded history'});}
      stakeActivityPage=page;
    }catch{errors.push('History unavailable');}}else if(activity.status==='rejected')errors.push('History unavailable');
    stakeDirectoryAt=Date.now();
    const coverage=stakeActivityPage ? `Recorded blocks ${stakeActivityPage.indexedFrom}–${stakeActivityPage.sourceBlockNumber}.` : 'Historical coverage unavailable.';
    stakeText('[data-stake-history-status]',[...errors,coverage,(stakeActivityPage?.nextCursor||stakePositionsPage?.nextCursor)?'More records available below.':''].filter(Boolean).join(' '));
    if(rewardPosition)recordLiveStake(rewardPosition);
  }finally{if(generation===stakeDirectoryGeneration){stakeDirectoryBusy=false;renderStakeDirectory();}}
}
function recordLiveStake(state:RewardPositionState):void{
  if(stakeDirectoryAccount!==wallet?.account.toLowerCase())return;
  if(state.allocated>0n||stakeDirectoryRows.has(state.detail.market.marketId))stakeDirectoryRows.set(state.detail.market.marketId,{marketId:state.detail.market.marketId,assetUid:state.asset.assetUid,label:state.allocated>0n ? `${formatTokenAmount(state.allocated,state.asset.tokenDecimals)} ${stockSymbol(state.assetConfig)} staked` : 'No active stake · verified'});
  renderStakeDirectory();
}

function updateStakeSearchIdentity(id:string):void {
  const row=query<HTMLElement>(`[data-stake-search-market="${id}"]`);if(!row)return;
  const symbol=rewardMarketLabels.get(id)?.symbol;
  const label=row.querySelector<HTMLElement>('[data-search-symbol]');if(label&&symbol)label.textContent=symbol;
  const image=row.querySelector<HTMLImageElement>('[data-search-token-icon]');const url=stakeMarketIcons.get(id);
  if(image&&url&&image.getAttribute('src')!==url)image.src=url;
}
function filterStakeMarkets(): void {
  const select = query<HTMLSelectElement>("[data-position-market]");
  if (!select || !foundation) return;
  const search = query<HTMLInputElement>("[data-position-search]")?.value.trim().toLowerCase() ?? "";
  const previous = select.value;
  const matches = foundation.markets.filter((market) => market.gauge !== ZERO_ADDRESS &&
    `${rewardMarketLabels.get(market.marketId)?.search ?? ""} ${market.memeToken} ${market.marketId} ${market.assetUid} ${foundation?.assets.find(asset=>asset.id===market.assetUid)?stockSymbol(foundation.assets.find(asset=>asset.id===market.assetUid)!):''}`.toLowerCase().includes(search));
  const results=query<HTMLElement>('[data-stake-search-results]');
  if(results){
    results.replaceChildren();
    const input=query<HTMLInputElement>('[data-position-search]');
    for(const market of matches.slice(0,30)){
      const button=document.createElement('button');button.type='button';button.setAttribute('role','option');button.setAttribute('aria-selected',String(select.value===market.marketId));
      button.dataset.stakeSearchMarket=market.marketId;
      const icon=document.createElement('img');icon.dataset.searchTokenIcon='';icon.alt='';icon.className='stake-search-token-icon';
      const fallback=new URL('../assets/token-placeholder.svg',import.meta.url).href;icon.src=stakeMarketIcons.get(market.marketId)??fallback;icon.onerror=()=>{icon.onerror=null;icon.src=fallback;};
      const symbol=document.createElement('strong');symbol.dataset.searchSymbol='';symbol.textContent=rewardMarketLabels.get(market.marketId)?.symbol??'-';
      const address=document.createElement('span');address.className='stake-search-address';address.textContent=shortHex(market.memeToken,6,4);address.title=market.memeToken;
      const stock=document.createElement('span');stock.className='stake-search-stock';
      const config=foundation.assets.find(asset=>asset.id===market.assetUid);
      if(config){const url=stockLogo(config);if(url){const logo=document.createElement('img');logo.src=url;logo.alt='';logo.onerror=()=>{logo.hidden=true;};stock.append(logo);}stock.append(document.createTextNode(stockSymbol(config)));}
      else stock.textContent='Stock';
      button.append(icon,symbol,address,stock);
      if(!results.hidden)loadStakeMarketIcon(market);
      button.onclick=()=>{select.value=market.marketId;select.dispatchEvent(new Event('change'));if(input){input.value='';input.setAttribute('aria-expanded','false');input.focus();}results.hidden=true;};
      results.append(button);
    }
    if(!matches.length){const empty=document.createElement('p');empty.textContent='No Matching Markets';results.append(empty);}
    return;
  }
  select.replaceChildren(new Option(matches.length ? "Select a market" : "No matching markets", ""));
  matches.forEach((market) => select.add(new Option(rewardMarketLabels.get(market.marketId)?.label ?? rewardMarketOptionLabel(market), market.marketId)));
  if (matches.some((market) => market.marketId === previous)) select.value = previous;
  text("[data-position-search-status]", `${matches.length} matching markets in ${foundation.markets.length} loaded.${foundation.marketNextCursor ? " Load the next page above to search more markets." : ""}`);
  renderStakeDirectory();
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
  const relock = query<HTMLElement>('[data-stake-modal-relock]');
  if (relock) relock.hidden = !rewardPosition || rewardPosition.allocated === 0n;
  stakeText('[data-stake-modal-unlock]', rewardPosition
    ? `Expected Unlock: ${new Date(Date.now() + 24 * 3600_000).toLocaleString(undefined, {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false})}`
    : 'Expected Unlock: —');
  const after=rewardPosition ? stakeAfter(rewardPosition.allocated,validStakeAmount()) : null;
  stakeText('[data-stake-modal-after]',after===null ? '-' : `${formatTokenAmount(after,rewardPosition!.asset.tokenDecimals)} ${stockSymbol(rewardPosition!.assetConfig)}`);
  const amountField=query<HTMLInputElement>('#stake-amount');
  if(amountField){amountField.disabled=!rewardPosition||!!busyOperation||stakeSubmitting;amountField.setCustomValidity('');amountField.removeAttribute('aria-invalid');}
  query<HTMLElement>('[data-stake-preview]')?.classList.remove('is-error');
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
    catch(error) {
      const symbol=stockSymbol(state.assetConfig);
      try{const parsed=parseTokenAmount(field.value,state.asset.tokenDecimals,'Amount');amountError=parsed>state.walletBalance?`Insufficient ${symbol}`:state.allocated+parsed<state.asset.minimumAllocation?`Minimum Total Stake: ${formatTokenAmount(state.asset.minimumAllocation,state.asset.tokenDecimals)} ${symbol}`:'Amount Too Large';}
      catch{amountError=/^0+(?:\.0*)?$/.test(field.value.trim())?'Enter An Amount Greater Than Zero.':'Enter A Valid Amount';}
    }
  }
  if(field){field.setCustomValidity(amountError);if(amountError)field.setAttribute('aria-invalid','true');}
  query<HTMLElement>('[data-stake-preview]')?.classList.toggle('is-error',!!amountError);
  const open = state.asset.status === 1 && state.detail.market.launchPhase === 1 && state.settlementPrincipal === 0n;
  text("[data-stake-preview]", amountError || (!open
    ? state.detail.market.launchPhase!==1?"Staking Opens After Blooming":"Staking Is Unavailable"
    : amount === null ? `Minimum Total Stake: ${formatTokenAmount(state.asset.minimumAllocation,state.asset.tokenDecimals)} ${stockSymbol(state.assetConfig)}` : ""));
}

function setupRewards(): void {
  window.clearInterval(stakeCountdownTimer);
  if(currentPage()==='staking')stakeCountdownTimer=window.setInterval(renderStakeCountdown,1000);
  query<HTMLButtonElement>('[data-stake-token-details]')?.addEventListener('click',()=>{
    const id=query<HTMLSelectElement>('[data-position-market]')?.value;
    if(id&&foundation?.markets.some(m=>m.marketId===id))router.navigate(`/trade?marketId=${encodeURIComponent(id)}`);
  });
  if(currentPage()==='staking'){
    stakePageListeners=new AbortController();
    stakeStatisticsTimer=window.setInterval(()=>{if(!document.hidden)void refreshStakeStatistics();},60000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden){void refreshStakeStatistics();void refreshActiveReward();void refreshStakeDirectory();}},{signal:stakePageListeners.signal});
  }
  const dialog=query<HTMLDialogElement>('[data-stake-dialog]');
  query<HTMLButtonElement>('[data-open-stake]')?.addEventListener('click',()=>{if(!wallet){query<HTMLButtonElement>('[data-wallet]')?.click();return;}if(!rewardPosition)return;text('[data-stake-transaction-status]','');updateStakePreview();updateRewardsAvailability();dialog?.showModal();});
  queryAll<HTMLButtonElement>('[data-close-stake]').forEach(button=>button.addEventListener('click',()=>{if(!busyOperation&&!stakeSubmitting)dialog?.close();}));
  dialog?.addEventListener('cancel',event=>{if(busyOperation||stakeSubmitting)event.preventDefault();});
  query<HTMLButtonElement>('[data-stake-max]')?.addEventListener('click',()=>{const field=query<HTMLInputElement>('#stake-amount');if(field&&rewardPosition){field.value=formatUnits(rewardPosition.walletBalance,rewardPosition.asset.tokenDecimals);field.dispatchEvent(new Event('input',{bubbles:true}));}});
  query<HTMLButtonElement>('[data-stake-history-more]')?.addEventListener('click',()=>void refreshStakeDirectory(true));
  const marketSearch=query<HTMLInputElement>('[data-position-search]');
  const searchResults=query<HTMLElement>('[data-stake-search-results]');
  const openSearch=()=>{if(searchResults)searchResults.hidden=false;filterStakeMarkets();marketSearch?.setAttribute('aria-expanded','true');};
  const closeSearch=()=>{if(searchResults)searchResults.hidden=true;marketSearch?.setAttribute('aria-expanded','false');};
  marketSearch?.addEventListener('input',searchResults?openSearch:filterStakeMarkets);
  if(searchResults){
    marketSearch?.addEventListener('focus',openSearch);
    marketSearch?.addEventListener('keydown',event=>{if(event.key==='Escape')closeSearch();if(event.key==='ArrowDown'){event.preventDefault();openSearch();searchResults.querySelector<HTMLButtonElement>('button')?.focus();}if(event.key==='Enter'){event.preventDefault();searchResults.querySelector<HTMLButtonElement>('button')?.click();}});
    searchResults.addEventListener('keydown',event=>{const buttons=[...searchResults.querySelectorAll<HTMLButtonElement>('button')],index=buttons.indexOf(document.activeElement as HTMLButtonElement);if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();buttons[(index+(event.key==='ArrowDown'?1:buttons.length-1))%buttons.length]?.focus();}if(event.key==='Escape'){marketSearch?.focus();closeSearch();}});
    query<HTMLElement>('.stake-market-search')?.addEventListener('focusout',event=>{if(!event.currentTarget||!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node|null))closeSearch();});
  }
  query<HTMLButtonElement>('[data-copy-beneficiary]')?.addEventListener('click', async () => {
    if (!creatorReward) return;
    try { await navigator.clipboard.writeText(creatorReward.beneficiary); toast('Recipient address copied', 'success'); }
    catch { toast('Unable to copy. Select the recipient address instead.', 'warning'); }
  });
  queryAll<HTMLButtonElement>("[data-rewards-connect]").forEach(button=>button.addEventListener("click", () => query<HTMLButtonElement>("[data-wallet]")?.click()));
  query<HTMLDetailsElement>("[data-emergency-recovery]")?.addEventListener("toggle", event => { if ((event.currentTarget as HTMLDetailsElement).open) void refreshDirectEscape(); });
  const stakeAmountField=query<HTMLInputElement>('#stake-amount');
  if(stakeAmountField)bindStakeAmountInput(stakeAmountField,()=>rewardPosition?.asset.tokenDecimals??18,()=>{updateStakePreview();updateRewardsAvailability();});
  stakeAmountField?.addEventListener('invalid',event=>{
    event.preventDefault();
    text('[data-stake-preview]',stakeAmountField.validity.valueMissing?'Enter An Amount Greater Than Zero.':stakeAmountField.validationMessage||'Enter A Valid Amount');
    query<HTMLElement>('[data-stake-preview]')?.classList.add('is-error');
    stakeAmountField.setAttribute('aria-invalid','true');
    stakeAmountField.focus();
  });
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
  query<HTMLButtonElement>("[data-rewards-refresh]")?.addEventListener("click", () => { void refreshActiveReward(); void refreshStakeDirectory(false,true); });
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
  renderRecentHolderMarkets();

  queryAll<HTMLSelectElement>("[data-position-market],[data-staker-market],[data-settle-market]").forEach((select) => {
    select.addEventListener("change", () => {
      const stakeAmount=query<HTMLInputElement>('#stake-amount');if(stakeAmount){stakeAmount.value="";stakeAmount.setCustomValidity("");}
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
    text("[data-direct-vault-asset]", "-");
    text("[data-direct-vault-principal]", "-");
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
  const holderSearch=query<HTMLInputElement>('[data-holder-search]');
  let holderSearchTimer:number|undefined;
  holderSearch?.addEventListener('input',()=>{window.clearTimeout(holderSearchTimer);holderSearchRequest?.abort();holderSearchTimer=window.setTimeout(()=>{void renderHolderSearch();},300);});
  holderSearch?.addEventListener('focus',()=>{void renderHolderSearch();});
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
  if(currentPage()==='rewards')return `${rewardMarketLabels.get(market.marketId)?.symbol??'Token'} · ${shortHex(market.marketId)}`;
  return `${shortHex(market.marketId, 8, 6)} · ${phaseLabel(market.launchPhase)} · ${market.gauge === ZERO_ADDRESS ? "No stock staking" : `STOCK ${shortHex(market.assetUid)}`}`;
}

const holderHistoryCache=new Map<string,{at:number,claimed:bigint}>();
async function loadHolderRewardHistory(marketId:Hex,account:Address,block:bigint,quote:Address,decimals:number,symbol:string,amount:bigint):Promise<void>{
 const key=`${robinhoodChain.id}:${marketId}:${account.toLowerCase()}`;
 const dual=continuousReward?.mode===DUAL_HOLDER_MODE;
 const generation=treasuryLoadGeneration;
 const current=()=>generation===treasuryLoadGeneration&&wallet?.account.toLowerCase()===account.toLowerCase()&&continuousReward?.marketId===marketId&&currentPage()==='rewards';
 const show=(paid:bigint)=>{if(current()){text('[data-continuous-claimed]',`${formatTokenAmount(paid,decimals)} ${symbol}`);text('[data-continuous-earned]',`${formatTokenAmount(paid+amount,decimals)} ${symbol}`);}};
 const cached=holderHistoryCache.get(key);if(!dual&&cached&&Date.now()-cached.at<600000){show(cached.claimed);return;}
 text('[data-continuous-claimed]','-');text('[data-continuous-earned]','-');
 if(!runtimeConfig.readApi.available)return;
 try{
  for(let attempt=0;attempt<4&&current();attempt++){
  const v=await new TickerGardenV1Client(runtimeConfig.readApi.value,(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(5000)}))
   .getHolderRewardHistory({marketId,account:account.toLowerCase() as Address,throughBlock:String(block)});
  if(!current()||v.chainId!==robinhoodChain.id||v.marketId!==marketId||v.account!==account.toLowerCase()||v.throughBlock!==String(block)||v.displayOnly!==true)return;
  if(v.complete!==true){if(attempt<3)await new Promise(resolve=>setTimeout(resolve,5000));continue;}
  const market=selectedRewardMarket('[data-treasury-market]');
  if(!v.claimed||typeof v.claimed!=='object'||Object.entries(v.claimed).some(([a,n])=>(a!==quote.toLowerCase()&&(!dual||a!==market.memeToken))||typeof n!=='string'||!/^\d+$/.test(n)))return;
  if(dual){
   const metadata=await marketMetadata(market);if(!current())return;
   const qp=BigInt(v.claimed[quote.toLowerCase()]??'0'),mp=BigInt(v.claimed[market.memeToken]??'0');
   text('[data-continuous-claimed]',`${formatTokenAmount(qp,decimals)} ${symbol} + ${formatTokenAmount(mp,18)} ${metadata.symbol}`);
   text('[data-continuous-earned]',`${formatTokenAmount(qp+amount,decimals)} ${symbol} + ${formatTokenAmount(mp+(continuousReward?.memeClaimable??0n),18)} ${metadata.symbol}`);
   return;
  }
  const paid=BigInt(v.claimed[quote.toLowerCase()]??'0');if(holderHistoryCache.size>=100)holderHistoryCache.clear();holderHistoryCache.set(key,{at:Date.now(),claimed:paid});show(paid);return;
  }
 }catch{/* History is display-only; claim stays available from chain state. */}
}
function holderRecentKey():string{return `tg:holder-markets:${robinhoodChain.id}:${wallet?.account.toLowerCase()??'disconnected'}`;}
function recentHolderMarkets():HolderMarket[]{try{const v=JSON.parse(localStorage.getItem(holderRecentKey())??'[]');return Array.isArray(v)?v.filter(x=>x&&/^0x[0-9a-f]{64}$/.test(x.marketId)&&/^0x[0-9a-f]{40}$/.test(x.memeToken)&&typeof x.name==='string'&&typeof x.symbol==='string').slice(0,20):[];}catch{return [];}}
function rememberHolderMarket(item:HolderMarket):void{if(!wallet)return;try{localStorage.setItem(holderRecentKey(),JSON.stringify([item,...recentHolderMarkets().filter(x=>x.marketId!==item.marketId)].slice(0,20)));}catch{}renderRecentHolderMarkets();}
const walletHolderCandidates=new Map<string,{at:number;items:HolderMarket[]}>();
const walletHolderPending=new Set<string>();
function renderRecentHolderMarkets():void{
 const area=query<HTMLElement>('[data-holder-recent]');if(!area)return;area.replaceChildren();
 const account=wallet?.account.toLowerCase(),key=account??'',saved=walletHolderCandidates.get(key);
 if(account&&runtimeConfig.readApi.available&&!walletHolderPending.has(key)&&(!saved||Date.now()-saved.at>600000)){
  walletHolderPending.add(key);
  void new TickerGardenV1Client(runtimeConfig.readApi.value,(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(5000)})).listWalletHolderMarkets({account:account as Address}).then(data=>{if(data.chainId!==robinhoodChain.id||data.displayOnly!==true||data.account!==account||!Array.isArray(data.items))throw Error('Invalid reward history');
   const items=data.items.filter((x:any)=>/^0x[0-9a-f]{64}$/.test(x.marketId)&&/^0x[0-9a-f]{40}$/.test(x.memeToken)&&typeof x.name==='string'&&typeof x.symbol==='string');walletHolderCandidates.set(key,{at:Date.now(),items});if(wallet?.account.toLowerCase()===account)renderRecentHolderMarkets();
  }).catch(()=>{walletHolderCandidates.set(key,{at:Date.now(),items:saved?.items??[]});}).finally(()=>walletHolderPending.delete(key));
 }
 const candidates=[...new Map([...recentHolderMarkets(),...(saved?.items??[])].map(x=>[x.marketId,x])).values()];
 for(const item of candidates){const button=document.createElement('button');button.type='button';button.textContent=item.symbol;button.title='Rewards Remain Claimable After Selling';button.addEventListener('click',()=>{const input=query<HTMLInputElement>('[data-holder-search]'),results=query<HTMLElement>('[data-holder-search-results]');if(input&&results)void selectHolderSearchResult(item,input,results);});area.append(button);}
}

let holderSearchRequest:AbortController|undefined;
async function renderHolderSearch():Promise<void>{
 const input=query<HTMLInputElement>('[data-holder-search]');const results=query<HTMLElement>('[data-holder-search-results]');
 if(!input||!results||!runtimeConfig.readApi.available)return;
 holderSearchRequest?.abort();const request=new AbortController();holderSearchRequest=request;
 results.textContent='Searching…';
 try{
  const items=await searchHolderMarkets(runtimeConfig.readApi.value,robinhoodChain.id,input.value,request.signal);
  if(request.signal.aborted||!results.isConnected)return;
  results.replaceChildren();
  if(!items.length){results.textContent='No Tokens Found';return;}
  for(const item of items){
   const button=document.createElement('button');button.type='button';button.setAttribute('role','option');
   const label=document.createElement('span');label.textContent=`${item.symbol} · ${item.name}`;
   const address=document.createElement('small');address.textContent=shortHex(item.memeToken);address.title=item.memeToken;
   button.append(label,address);button.addEventListener('click',()=>{void selectHolderSearchResult(item,input,results);});results.append(button);
  }
 }catch(error){if(!request.signal.aborted&&results.isConnected)results.textContent='Unable To Search Tokens';}
}
async function selectHolderSearchResult(item:HolderMarket,input:HTMLInputElement,results:HTMLElement):Promise<void>{
 const generation=routeGeneration;
 try{
  if(!foundation||!readApi)return;
  results.textContent='Loading Token…';
  let market=foundation.markets.find(m=>m.marketId===item.marketId);
  if(!market){const current=foundation;const detail=current.direct&&directMarkets?await directMarkets.market(item.marketId as Hex):await readApi.getMarket({marketId:item.marketId as Hex,revision:current.sync.revision});
   if(routeGeneration!==generation||foundation!==current)return;
   if(!current.direct)assertFinalizedSync(detail.sync,current.sync.revision,'holder market');
   market=detail.market;if(market.memeToken.toLowerCase()!==item.memeToken)throw Error('Token Mismatch');
   foundation=Object.freeze({...current,markets:[...current.markets,market]});
  }
  if(routeGeneration!==generation||!input.isConnected)return;
  const select=query<HTMLSelectElement>('[data-treasury-market]');if(!select)return;
  select.replaceChildren(new Option(item.symbol,item.marketId));select.value=item.marketId;
  input.value=item.symbol;results.replaceChildren();
  const epoch=query<HTMLInputElement>('[data-treasury-epoch]');if(epoch)epoch.value='';
  rememberHolderMarket(item);
  await refreshTreasuryReward(true);
 }catch(error){if(routeGeneration===generation)results.textContent='Unable To Load Token';}
}
const creatorMarketIds=new Set<string>();
let creatorDirectoryAccount='';
let creatorDirectoryAt=0;
let creatorDirectoryRequest:AbortController|undefined;
let creatorDirectoryError='';
function clearCreatorDirectory():void {
  creatorDirectoryRequest?.abort();creatorDirectoryRequest=undefined;
  creatorDirectoryAccount='';creatorDirectoryAt=0;creatorDirectoryError='';creatorMarketIds.clear();
  const select=query<HTMLSelectElement>('[data-creator-market]');if(select){select.replaceChildren(new Option('Select a token',''));select.disabled=true;}
}
async function refreshCreatorDirectory():Promise<void>{
  if(currentPage()!=='rewards'||!wallet||!foundation||!runtimeConfig.readApi.available)return;
  const account=wallet.account.toLowerCase();
  if(creatorDirectoryAccount===account&&Date.now()-creatorDirectoryAt<600000)return;
  if(creatorDirectoryRequest&&creatorDirectoryAccount===account)return;
  clearCreatorDirectory();creatorDirectoryAccount=account;
  const request=new AbortController();creatorDirectoryRequest=request;
  try{
    const rows=await loadCreatorMarkets(runtimeConfig.readApi.value,robinhoodChain.id,account,request.signal);
    if(request.signal.aborted||wallet?.account.toLowerCase()!==account||currentPage()!=='rewards')return;
    for(const row of rows){
      let market:MarketReadModel|undefined=foundation?.markets.find(m=>m.marketId===row.marketId);
      if(!market&&foundation?.direct&&directMarkets){const detail=await directMarkets.market(row.marketId as Hex);if(request.signal.aborted||wallet?.account.toLowerCase()!==account)return;market=detail.market;if(foundation)foundation=Object.freeze({...foundation,markets:[...foundation.markets,market]});}
      if(market&&market.memeToken.toLowerCase()===row.memeToken.toLowerCase())creatorMarketIds.add(market.marketId);
    }
    creatorDirectoryAt=Date.now();
  }catch(error){if(!request.signal.aborted){creatorDirectoryError='Unable To Load Your Tokens.';creatorDirectoryAt=Date.now()-570000;}}
  finally{if(creatorDirectoryRequest===request){creatorDirectoryRequest=undefined;populateRewardMarkets();}}
}
function populateRewardMarkets(): void {
  if (!foundation) return;
  const selects = queryAll<HTMLSelectElement>("[data-position-market],[data-staker-market],[data-settle-market],[data-creator-market],[data-treasury-market]");
  selects.forEach((select) => {
    if(select.matches('[data-treasury-market]'))return;
    const prior = select.value;
    if(select.matches('[data-creator-market]')){
      const markets=creatorDirectoryAccount===wallet?.account.toLowerCase()?foundation!.markets.filter(m=>creatorMarketIds.has(m.marketId)):[];
      select.replaceChildren(new Option('Select a token',''));
      markets.forEach(m=>select.add(new Option(rewardMarketOptionLabel(m),m.marketId)));
      select.disabled=!markets.length;
      const requested=new URLSearchParams(location.search).get('marketId');
      select.value=markets.some(m=>m.marketId===prior)?prior:markets.some(m=>m.marketId===requested)?requested!:markets[0]?.marketId??'';
      return;
    }
    const placeholder = select.matches("[data-direct-vault-market],[data-settle-market]") ? "Use selected market" : currentPage() === "rewards" ? "Select a token" : "Select a configured market";
    select.replaceChildren(new Option(placeholder, ""));
    foundation!.markets.filter((market) => !select.matches("[data-position-market],[data-staker-market],[data-settle-market]") || market.gauge !== ZERO_ADDRESS).forEach((market) => select.add(new Option(rewardMarketOptionLabel(market), market.marketId)));
    if (foundation!.markets.some((market) => market.marketId === prior)) select.value = prior;
  });
  filterStakeMarkets();
  const directory = foundation;
  const metadataMarkets=currentPage()==='rewards'&&rewardTab(location.hash)==='creator'?foundation.markets.filter(m=>creatorMarketIds.has(m.marketId)):foundation.markets;
  void mapConcurrent(metadataMarkets, async (market) => {
    try {
      const metadata = await marketMetadata(market);
      if (foundation !== directory) return;
      rewardMarketLabels.set(market.marketId, {
        symbol:metadata.symbol,
        label: `${metadata.symbol} · ${phaseLabel(market.launchPhase)} · ${shortHex(market.marketId)}`,
        search: `${metadata.symbol} ${metadata.name}`,
      });
      selects.forEach((select) => {
        const option = [...select.options].find((item) => item.value === market.marketId);
        if (option) option.textContent = currentPage()==='rewards' ? `${metadata.symbol} · ${shortHex(market.marketId)}` : `${metadata.symbol} · ${phaseLabel(market.launchPhase)} · ${shortHex(market.marketId)}`;
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
  if(!query('[data-direct-vault-market]'))return;
  const generation = ++directEscapeLoadGeneration;
  directEscape = null;
  text("[data-direct-vault-asset]", "-");
  text("[data-direct-vault-principal]", "-");
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

// Claim mode is immutable for each verified release vault; share the probe across reward panels.
const rewardModes = new Map<Address, Promise<boolean>>();
function usesUserClaims(feeVault: Address, blockNumber?: bigint): Promise<boolean> {
  const known = rewardModes.get(feeVault);
  if (known) return known;
  const pending = publicClient.readContract({abi:userClaimsAbi,address:feeVault,functionName:'userClaimMode',blockNumber})
    .then(mode => { if (mode !== USER_CLAIM_MODE) throw Error('Unsupported Reward Claim Mode'); return true; });
  rewardModes.set(feeVault, pending);
  void pending.catch(() => rewardModes.delete(feeVault));
  return pending;
}
async function readHolderDistributor(address: Address): Promise<Address> {
  return publicClient.readContract({address,abi:[{type:'function',name:'holderRewardsDistributor',stateMutability:'view',inputs:[],outputs:[{type:'address'}]}],functionName:'holderRewardsDistributor'});
}

async function readRewardPositionState(detail: MarketDetailResponse): Promise<RewardPositionState> {
  if (!wallet) throw new Error("Connect a wallet to load your position");
  if (detail.market.gauge === ZERO_ADDRESS) throw new Error("Stock staking is not enabled for this market");
  const assetConfig = findAsset(detail.market.assetUid);
  const asset = await ensureCanonicalAsset(assetConfig, verifiedMarketRuntime.get(detail.market.marketId));
  const account = wallet.account;
  const block = await publicClient.getBlock({ blockTag: "latest" });
  const blockNumber = block.number;
  const [free, allocated, rawPosition, settlementPrincipal, walletBalance] = await Promise.all([
    publicClient.readContract({ blockNumber, abi: v1Abis.UserStockVault, address: asset.userStockVault, functionName: "freeBalanceOf", args: [asset.assetUid, account] }),
    publicClient.readContract({ blockNumber, abi: v1Abis.UserStockVault, address: asset.userStockVault, functionName: "allocation", args: [asset.assetUid, account, detail.market.marketId] }),
    publicClient.readContract({ blockNumber, abi: v1Abis.MemeStockGauge, address: canonicalAddress(detail.market.gauge, "Gauge"), functionName: "positionOf", args: [account] }),
    publicClient.readContract({ blockNumber, abi: v1Abis.UserStockVault, address: asset.userStockVault, functionName: "rageQuitSettlementPrincipal", args: [asset.assetUid, account, detail.market.marketId] }),
    publicClient.readContract({ blockNumber, abi: erc20Abi, address: asset.stockToken, functionName: "balanceOf", args: [account] }),
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
    observedBlock: blockNumber,
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
    settlementPrincipal,
    now: block.timestamp,
  });
}

function renderStakeShare():void {
  const id=query<HTMLSelectElement>('[data-position-market]')?.value;
  const total=id?stakeStatsCache.get(id)?.data.totalRaw:null;
  const matches=!!rewardPosition&&!!wallet&&rewardPositionOwner===wallet.account&&rewardPosition.detail.market.marketId===id;
  stakeText('[data-stake-share]',matches?stakeShare(rewardPosition!.allocated,total??null):'-');
}
const stakeRewardHistoryCache=new Map<string,{at:number;signature:string;claimed:string;earned:string}>();
const stakeRewardHistoryPending=new Set<string>();
async function loadStakeRewardHistory(state:RewardPositionState):Promise<void>{
 if(!wallet||!runtimeConfig.readApi.available||currentPage()!=='staking')return;
 const account=wallet.account.toLowerCase(),marketId=state.detail.market.marketId,key=`${robinhoodChain.id}:${marketId}:${account}`;
 const signature=`${state.quoteClaimable}:${state.memeClaimable}:${state.settlementPrincipal}`;
 const current=()=>currentPage()==='staking'&&wallet?.account.toLowerCase()===account&&rewardPosition?.detail.market.marketId===marketId&&`${rewardPosition.quoteClaimable}:${rewardPosition.memeClaimable}:${rewardPosition.settlementPrincipal}`===signature;
 const cached=stakeRewardHistoryCache.get(key);
 if(cached&&cached.signature===signature&&Date.now()-cached.at<600000){if(current()){text('[data-staker-earned]',cached.earned);text('[data-staker-claimed]',cached.claimed);}return;}
 if(stakeRewardHistoryPending.has(key))return;
 stakeRewardHistoryPending.add(key);
 text('[data-staker-earned]','-');text('[data-staker-claimed]','-');
 try{
  for(let attempt=0;attempt<4&&current();attempt++){
   const result=await new TickerGardenV1Client(runtimeConfig.readApi.value,(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(5000)}))
    .getStakerRewardHistory({marketId,account:account as Address,throughBlock:String(state.observedBlock)});
   if(!current())return;
   if(result.chainId!==robinhoodChain.id||result.displayOnly!==true||result.marketId!==marketId||result.account!==account||result.throughBlock!==String(state.observedBlock))throw Error('Reward History Mismatch');
   if(result.complete!==true){await new Promise(resolve=>setTimeout(resolve,5000));continue;}
   if(!result.claimed||typeof result.claimed!=='object')throw Error('Invalid Reward History');
   const quote=state.detail.market.quoteAsset.toLowerCase(),meme=state.detail.market.memeToken.toLowerCase();
   for(const [asset,value]of Object.entries(result.claimed))if(![quote,meme].includes(asset)||typeof value!=='string'||!/^\d+$/.test(value))throw Error('Invalid Reward Amount');
   const paidQuote=BigInt(result.claimed[quote]??'0'),paidMeme=BigInt(result.claimed[meme]??'0');
   const label=(q:bigint,m:bigint)=>[q>0n||m===0n?`${formatTokenAmount(q,state.metadata.quoteDecimals)} ${state.metadata.quoteSymbol}`:'',m>0n?`${formatTokenAmount(m,18)} ${state.metadata.symbol}`:''].filter(Boolean).join('\n');
   const claimed=label(paidQuote,paidMeme),earned=label(paidQuote+(state.settlementPrincipal===0n?state.quoteClaimable:0n),paidMeme+(state.settlementPrincipal===0n?state.memeClaimable:0n));
   stakeRewardHistoryCache.set(key,{at:Date.now(),signature,claimed,earned});
   if(stakeRewardHistoryCache.size>100)stakeRewardHistoryCache.delete(stakeRewardHistoryCache.keys().next().value!);
   text('[data-staker-claimed]',claimed);text('[data-staker-earned]',earned);return;
  }
 }catch{/* Missing history stays unknown; current balances remain usable. */}
 finally{stakeRewardHistoryPending.delete(key);}
}
function renderRewardPosition(state: RewardPositionState): void {
  renderStakeShare();
  const unit=stockSymbol(state.assetConfig);
  stakeAssetAmount('[data-stake-wallet]',formatTokenAmount(state.walletBalance,state.asset.tokenDecimals),state.assetConfig);
  stakeText('[data-stake-modal-wallet]',`${formatTokenAmount(state.walletBalance,state.asset.tokenDecimals)} ${unit}`);
  stakeAssetAmount('[data-stake-allocated]',formatTokenAmount(state.allocated,state.asset.tokenDecimals),state.assetConfig);
  stakeText('[data-stake-active-breakdown]',`${formatTokenAmount(state.active,state.asset.tokenDecimals)} Active · ${formatTokenAmount(state.pending,state.asset.tokenDecimals)} Pending`);
  stakeText('[data-stake-unlock-at]',state.allocated>0n&&state.unlockAt>0n?new Date(Number(state.unlockAt)*1000).toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}):'');
  stakeText('[data-stake-modal-current]',`${formatTokenAmount(state.allocated,state.asset.tokenDecimals)} ${unit}`);
  stakeText('[data-stake-modal-stock]',unit);
  renderStakeCountdown();
  recordLiveStake(state);
  const stock = (amount: bigint) => formatTokenAmount(amount, state.asset.tokenDecimals);
  const unlock = state.unlockAt === 0n ? "not set" : new Date(Number(state.unlockAt) * 1_000).toLocaleString();
  const settlement = state.settlementPrincipal > 0n
    ? ` Reward cleanup pending for ${stock(state.settlementPrincipal)}; principal has already been returned.`
    : "";
  iconText("[data-position-summary]", "ph-check-circle", `Wallet ${stock(state.walletBalance)} STOCK · staked ${stock(state.allocated)} (active ${stock(state.active)}, pending ${stock(state.pending)}) · minimum non-zero position ${stock(state.asset.minimumAllocation)} · normal unlock ${unlock}.${settlement}`);
  text("[data-unstake-preview]", state.allocated === 0n ? "No staked principal in this market." : `Full return: ${stock(state.allocated)} STOCK. ${state.now >= state.unlockAt ? "Unlocked — ready to return to wallet." : `Unlocks ${unlock}.`}`);
  updateStakePreview();
  const claimableNow=state.settlementPrincipal===0n&&(state.allocated===0n||(state.unlockAt>0n&&state.now>=state.unlockAt));
  text('[data-staker-locked-note]',!claimableNow&&state.quoteClaimable>0n&&state.settlementPrincipal===0n?`${formatTokenAmount(state.quoteClaimable,state.metadata.quoteDecimals)} ${state.metadata.quoteSymbol} Locked`: '');
  text("[data-staker-claimable=quote]", `${formatTokenAmount(claimableNow?state.quoteClaimable:0n, state.metadata.quoteDecimals)} ${state.metadata.quoteSymbol}`);
  text("[data-staker-claimable=meme]", `${formatTokenAmount(state.memeClaimable, 18)} ${state.metadata.symbol}`);
  text("[data-rewards-total]", `${formatTokenAmount(state.quoteClaimable, state.metadata.quoteDecimals)} ${state.metadata.quoteSymbol} · ${formatTokenAmount(state.memeClaimable, 18)} ${state.metadata.symbol}`);
  iconText("[data-staker-status]", "ph-check-circle", `Rewards for ${state.metadata.symbol}. Settled rewards are paid in ${state.metadata.quoteSymbol}; pending tokens are awaiting conversion.`);
  text("[data-ragequit-estimate]", `Principal: ${stock(state.allocated)} STOCK. Estimated unclaimed rewards forfeited to the platform: ${formatTokenAmount(state.quoteClaimable, state.metadata.quoteDecimals)} ${state.metadata.quoteSymbol} + ${formatTokenAmount(state.memeClaimable, 18)} ${state.metadata.symbol}. Final reward amounts may change before execution.`);
  const directAsset = query<HTMLInputElement>("[data-direct-vault-asset]");
  if (directAsset) { directAsset.value = state.asset.assetUid; directAsset.readOnly = true; }
  const settleUser = query<HTMLInputElement>("[data-settle-user]");
  if (settleUser && !settleUser.value && wallet) settleUser.value = wallet.account;
}

let stakeCountdownTimer=0;
let stakeClockReadAt=0;
function renderStakeCountdown():void {
 const target=query<HTMLElement>('[data-stake-unlock]');if(!target)return;
 const state=rewardPosition;
 if(!state||!wallet||rewardPositionOwner!==wallet.account||state.detail.market.marketId!==query<HTMLSelectElement>('[data-position-market]')?.value){stakeText('[data-stake-unlock]','-');return;}
 const elapsed=BigInt(Math.max(0,Math.floor((performance.now()-stakeClockReadAt)/1000)));
 const label=stakeLockLabel(state.allocated,state.now+elapsed,state.unlockAt);
 if(!label.startsWith('Unlocks In ')){stakeText('[data-stake-unlock]',label);return;}
 let value=target.querySelector<HTMLElement>('[data-stake-countdown]');
 if(!value){const caption=document.createElement('small');caption.className='stake-unlock-caption';caption.textContent='Unlocks In';value=document.createElement('span');value.dataset.stakeCountdown='';target.replaceChildren(caption,value);}
 const duration=label.slice('Unlocks In '.length);if(value.textContent!==duration)value.textContent=duration;
}
let rewardPositionOwner='';
let rewardPositionReadAt=0;
async function refreshRewardPosition(force=true): Promise<void> {
  void refreshStakeStatistics();
  const previous=rewardPosition;
  const samePosition=!!previous&&!!wallet&&rewardPositionOwner===wallet.account&&previous.detail.market.marketId===query<HTMLSelectElement>('[data-position-market]')?.value;
  // The page and dialog share rewardPosition; background reads must not disturb editing.
  if(!force&&samePosition&&(query<HTMLDialogElement>('[data-stake-dialog]')?.open||Date.now()-rewardPositionReadAt<30_000))return;
  const generation=++rewardLoadGeneration;
  if(!samePosition){
  for(const key of ['wallet','allocated','unlock','modal-wallet','modal-current','unlock-at','active-breakdown'])stakeText(`[data-stake-${key}]`,'-');
  rewardPosition = null;
  renderStakeShare();
  updateStakePreview();
  text("[data-unstake-preview]", "Select a market to load your staked balance and unlock time.");
  text("[data-ragequit-estimate]", "Load a verified position to see principal and estimated forfeited rewards.");
  text("[data-staker-claimable=quote]", "-");
  text("[data-staker-claimable=meme]", "-");
  text("[data-staker-earned]", "-");text("[data-staker-claimed]", "-");text("[data-staker-locked-note]", "");
  text("[data-rewards-total]", "-");
  text("[data-staker-conversion-status]", "Load a verified position to see conversion status.");
  updateRewardsAvailability();
  }
  if (!foundation || !wallet) {
    const reason = !foundation ? runtimeReasons().join("; ") : "connect a wallet";
    iconText("[data-position-summary]", "ph-lock-key", `Position unavailable — ${reason}.`);
    text("[data-rewards-status]", `Rewards locked — ${reason}.`);
    return;
  }
  const select = query<HTMLSelectElement>("[data-position-market]");
  if (!select?.value) {
    iconText("[data-position-summary]", "ph-info", "Select a market to load your wallet balance, stake and rewards.");
    text("[data-rewards-status]", "Select A Market To View Your Rewards.");
    return;
  }
  try {
    if(!samePosition)text("[data-rewards-status]", "Loading Your Balances…");
    const market = selectedRewardMarket("[data-position-market]");
    const detail = await getRewardMarketDetail(market);
    const state = await readRewardPositionState(detail);
    if (generation !== rewardLoadGeneration) return;
    if(!force&&samePosition&&query<HTMLDialogElement>('[data-stake-dialog]')?.open)return;
    rewardPosition = state;
    stakeClockReadAt=performance.now();
    rewardPositionReadAt=Date.now();
    rewardPositionOwner=wallet.account;
    if(samePosition&&previous&&previous.allocated!==state.allocated){stakeStatsCache.delete(state.detail.market.marketId);void refreshStakeStatistics();}
    const visible=(value:RewardPositionState)=>JSON.stringify({wallet:value.walletBalance,allocated:value.allocated,active:value.active,pending:value.pending,free:value.free,quote:value.quoteClaimable,meme:value.memeClaimable,unlock:value.unlockAt,unlocked:value.now>=value.unlockAt,lockLabel:stakeLockLabel(value.allocated,value.now,value.unlockAt),settlement:value.settlementPrincipal,status:value.asset.status,minimum:value.asset.minimumAllocation,phase:value.detail.market.launchPhase},(_,value)=>typeof value==='bigint'?value.toString():value);
    if(!samePosition||!previous||visible(previous)!==visible(state))renderRewardPosition(state);
    void loadStakeRewardHistory(state);
    text("[data-rewards-status]", `Balances updated for ${shortHex(wallet.account)} at ${new Date().toLocaleTimeString()}.`);
    updateRewardsAvailability();
  } catch (error) {
    if (generation !== rewardLoadGeneration) return;
    iconText("[data-position-summary]", "ph-warning", `Position locked — ${errorText(error)}`);
    text("[data-rewards-status]", `Unable To Load Your Position — ${errorText(error)}`);
    updateRewardsAvailability();
  }
}

function configuredCreatorFeeAsset(market: MarketReadModel): Address {
  const input = required<HTMLInputElement>("[data-creator-fee-asset]");
  input.value = market.quoteAsset;
  return canonicalAddress(input.value.trim(), "Creator fee asset", true);
}

let creatorRewardNotOwned=false;
function clearCreatorRewardView():void {
  creatorReward = null;
  creatorRewardNotOwned=false;
  text("[data-creator-receive-asset]", "-");
  text("[data-creator-status]", "");
  text("[data-creator-beneficiary]", "-");
  text("[data-creator-pending-beneficiary]", "-");
  text("[data-creator-current-beneficiary]", "-");
  text("[data-creator-market-summary]", "-");
  text("[data-creator-epoch-summary]", "-");
  text("[data-creator-status-summary]", "Locked");
  text("[data-creator-quote-asset]", "-");
  text("[data-creator-pending-meme]", "-");
  text("[data-creator-conversion-status]", "Load verified creator rewards to see conversion status.");
  const claim=rewardActionButton('claimCreator');if(claim)setDisabled(claim,true);
  const copy=query<HTMLButtonElement>('[data-copy-beneficiary]');if(copy)copy.disabled=true;
}
async function refreshCreatorReward(): Promise<void> {
  const generation=++creatorLoadGeneration;
  updateRewardsAvailability();
  if (!foundation || !wallet || !runtimeConfig.contracts.available) {
    text("[data-creator-status]", !wallet ? "" : `Connection unavailable — ${runtimeReasons().join("; ")}`);
    return;
  }
  const activeWallet=wallet;
  const select = query<HTMLSelectElement>("[data-creator-market]");
  if(creatorReward&&creatorReward.marketId!==select?.value)clearCreatorRewardView();
  if (!select?.value||creatorDirectoryAccount!==activeWallet.account.toLowerCase()||!creatorMarketIds.has(select.value)) return;
  try {
    const market = selectedRewardMarket("[data-creator-market]");
    await getRewardMarketDetail(market);
    const registry = marketRelease(market.marketId).creatorRegistry;
    const block = await publicClient.getBlock({ blockTag: "latest" });
    const blockNumber = block.number;
    const currentEpoch = await publicClient.readContract({ blockNumber, abi: v1Abis.CreatorRevenueRegistry, address: registry, functionName: "currentCreatorEpoch", args: [market.marketId] });
    if (generation !== creatorLoadGeneration || wallet!==activeWallet) return;
    if (currentEpoch <= 0) throw new Error("Creator revenue has not been initialized for this market");
    const epochInput = required<HTMLInputElement>("[data-creator-epoch]");
    if (!epochInput.value) epochInput.value = String(currentEpoch);
    const epoch = parseUint32(epochInput.value, "Creator epoch");
    epochInput.max = String(currentEpoch);
    if (epoch > currentEpoch) throw new Error("Creator epoch is newer than the on-chain current epoch");
    const feeAsset = configuredCreatorFeeAsset(market);
    const [beneficiary, currentBeneficiary] = await Promise.all([
      publicClient.readContract({ blockNumber, abi: v1Abis.CreatorRevenueRegistry, address: registry, functionName: "creatorBeneficiaryAt", args: [market.marketId, epoch] }),
      publicClient.readContract({ blockNumber, abi: v1Abis.CreatorRevenueRegistry, address: registry, functionName: "creatorBeneficiaryAt", args: [market.marketId, currentEpoch] }),
    ]);
    const canonicalBeneficiary = canonicalAddress(beneficiary, "Creator beneficiary");
    const canonicalCurrentBeneficiary = canonicalAddress(currentBeneficiary, "Current creator beneficiary");
    if(generation!==creatorLoadGeneration||wallet!==activeWallet||select.value!==market.marketId)return;
    if(!ownsCreatorRewards(activeWallet.account,canonicalBeneficiary)){
      creatorRewardNotOwned=true;
      updateRewardsAvailability();
      return;
    }
    const memeAsset = canonicalAddress(market.memeToken, "Meme asset");
    const [memeLiability, metadata,liability,rawMarket] = await Promise.all([
      publicClient.readContract({ blockNumber, abi: v1Abis.ProtocolFeeVault, address: marketRelease(market.marketId).feeVault, functionName: "creatorLiability", args: [market.marketId, epoch, memeAsset] }),
      marketMetadata(market),
      publicClient.readContract({ blockNumber, abi: v1Abis.ProtocolFeeVault, address: marketRelease(market.marketId).feeVault, functionName: "creatorLiability", args: [market.marketId, epoch, feeAsset] }),
      publicClient.readContract({ blockNumber, abi: v1Abis.MarketRegistryV1, address: marketRelease(market.marketId).marketRegistry, functionName: "market", args: [market.marketId] }),
    ]);
    if (generation !== creatorLoadGeneration || wallet!==activeWallet) return;
    const pendingBeneficiary = await publicClient.readContract({blockNumber, abi: v1Abis.CreatorRevenueRegistry, address: registry, functionName: "pendingCreatorRevenueBeneficiary", args: [market.marketId]}).catch(() => null);
    if (generation !== creatorLoadGeneration || wallet!==activeWallet || select.value!==market.marketId) return;
    text("[data-creator-pending-beneficiary]", pendingBeneficiary === null ? "Two-step handoff unavailable: unsupported release or RPC read failure" : pendingBeneficiary === ZERO_ADDRESS ? "No pending handoff" : pendingBeneficiary);
    const creatorFeesToHolders = tupleField(tupleField(rawMarket, "config", 0), "creatorFeesToHolders", 15) === true;
    creatorReward = Object.freeze({ pendingBeneficiary, creatorFeesToHolders, marketId: market.marketId, epoch, beneficiary: canonicalBeneficiary, currentEpoch, currentBeneficiary: canonicalCurrentBeneficiary, feeAsset, liability, memeAsset, memeLiability, now: block.timestamp });
    text("[data-creator-quote-asset]", `${formatTokenAmount(liability, metadata.quoteDecimals)} ${metadata.quoteSymbol}`);
    text("[data-creator-pending-meme]", `${formatTokenAmount(memeLiability, 18)} ${metadata.symbol}`);
    text("[data-creator-receive-asset]", metadata.quoteSymbol);
    text("[data-creator-beneficiary]", canonicalBeneficiary);
    text("[data-creator-current-beneficiary]", canonicalCurrentBeneficiary);
    text("[data-creator-market-summary]", shortHex(market.marketId, 9, 7));
    text("[data-creator-epoch-summary]", String(epoch));
    text("[data-creator-status]", `${formatTokenAmount(liability, metadata.quoteDecimals)} ${metadata.quoteSymbol} available; payment goes to ${shortHex(canonicalBeneficiary)}.${creatorFeesToHolders ? " Holder fee sharing is enabled: this amount covers only the creator's retained base fee share and all creator tax; holder rewards are claimed separately." : ""}`);
    text("[data-creator-status-summary]", wallet.account === canonicalCurrentBeneficiary ? "Current future-revenue controller" : wallet.account === canonicalBeneficiary ? "Selected historical-epoch beneficiary" : "Read / permissionless claim only");
    updateRewardsAvailability();
  } catch (error) {
    if (generation !== creatorLoadGeneration || wallet!==activeWallet) return;
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
  const preserveContinuous=continuousReward?.account===wallet?.account&&continuousReward?.marketId===query<HTMLSelectElement>('[data-treasury-market]')?.value;
  treasuryReward = null;
  renderRecentHolderMarkets();
  continuousReward = null;
  if(!preserveContinuous){setContinuousRewardsView(false);queryAll<HTMLElement>('[data-legacy-treasury]').forEach(el=>el.hidden=true);}
  clearTreasuryProof();
  text("[data-treasury-status]", wallet?"Select A Token":"Connect Wallet");
  text("[data-treasury-epoch-id]", "-");
  text("[data-treasury-root]", "-");
  text("[data-treasury-fee]", "Locked — live configuration required");
  text("[data-treasury-fee-asset]", "Locked — live configuration required");
  text("[data-treasury-fee-allowance]", "Locked — live allowance required");
  text("[data-treasury-service-credit]", "Locked — live credit required");
  text("[data-treasury-claimable]", "-");
  text("[data-treasury-proof]", "No verified proof loaded");
  updateRewardsAvailability();
  if (!foundation || !wallet || !runtimeConfig.contracts.available) {
    text("[data-treasury-status-note]", wallet?"Unable To Load Rewards":"");
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
      const [state, amount, pendingQuote, pendingMeme, metadata, releaseInfo, lastFunding, unswept, unsweptTax] = await Promise.all([
        publicClient.readContract({ blockNumber: block.number, abi: continuousRewardsAbi, address: distributor, functionName: "marketState", args: [marketId] }),
        publicClient.readContract({ blockNumber: block.number, abi: continuousRewardsAbi, address: distributor, functionName: "claimable", args: [marketId, account] }),
        publicClient.readContract({ blockNumber: block.number, abi: v1Abis.ProtocolFeeVault, address: marketRelease(detail.market.marketId).feeVault, functionName: "holderLiability", args: [marketId, 1, detail.market.quoteAsset] }),
        publicClient.readContract({ blockNumber: block.number, abi: v1Abis.ProtocolFeeVault, address: marketRelease(detail.market.marketId).feeVault, functionName: "holderLiability", args: [marketId, 1, detail.market.memeToken] }),
        marketMetadata(detail.market),
        publicClient.readContract({blockNumber: block.number, abi: continuousRewardsAbi, address: distributor, functionName: "releaseState", args: [marketId]}),
        publicClient.readContract({blockNumber: block.number, abi: continuousRewardsAbi, address: distributor, functionName: "lastFundingAt", args: [marketId]}),
        publicClient.readContract({blockNumber: block.number, abi: v1Abis.TickerGardenCurve, address: detail.market.curve, functionName: "accruedCurveFees"}),
        publicClient.readContract({blockNumber: block.number, abi: v1Abis.TickerGardenCurve, address: detail.market.curve, functionName: "accruedCreatorTax"}),
      ]);
      if (state.token.toLowerCase() !== detail.market.memeToken || state.quote.toLowerCase() !== detail.market.quoteAsset
          || state.vault.toLowerCase() !== marketRelease(detail.market.marketId).feeVault.toLowerCase()) throw new Error("Holder stream canonical binding mismatch");
      if (generation !== treasuryLoadGeneration || wallet?.account !== account) return;
      const memeClaimable=mode===DUAL_HOLDER_MODE ? (await publicClient.readContract({abi:userClaimsAbi,address:distributor,functionName:'claimableAssets',args:[marketId,account],blockNumber:block.number}))[1] : 0n;
      if (generation !== treasuryLoadGeneration || wallet?.account !== account) return;
      continuousReward = Object.freeze({ marketId, mode, quote: state.quote, account, claimable: amount, memeClaimable });
      text('[data-continuous-meme]',`${formatTokenAmount(memeClaimable,18)} ${metadata.symbol}`);
      setContinuousRewardsView(true);
      text("[data-continuous-claimable]", `${formatTokenAmount(amount, metadata.quoteDecimals)} ${metadata.quoteSymbol}`);
      text("[data-continuous-asset]", metadata.quoteSymbol);
      text("[data-continuous-unswept]", `${formatTokenAmount(((unswept - unsweptTax) - (unswept - unsweptTax) * 30n / 100n) / 2n, metadata.quoteDecimals)} ${metadata.quoteSymbol}`);
      text("[data-continuous-conversion]", `${formatTokenAmount(pendingMeme, 18)} ${metadata.symbol}`);
      text("[data-continuous-pending]", `${formatTokenAmount(pendingQuote, metadata.quoteDecimals)} ${metadata.quoteSymbol}`);
      text("[data-continuous-release]", `${formatTokenAmount(releaseInfo[0], metadata.quoteDecimals)} ${metadata.quoteSymbol}`);
      text("[data-continuous-idle]", `${formatTokenAmount(releaseInfo[1], metadata.quoteDecimals)} ${metadata.quoteSymbol}`);
      text("[data-continuous-funding]", lastFunding === 0n ? "-" : new Date(Number(lastFunding) * 1000).toLocaleString());
      text("[data-continuous-status]", state.supply === 0n ? "Rewards Resume When Eligible Holdings Return." : "Earned Rewards Remain Yours After Selling.");
      void loadHolderRewardHistory(marketId, account, block.number, state.quote, metadata.quoteDecimals, metadata.quoteSymbol, amount);
      updateRewardsAvailability();
      return;
    }
    setContinuousRewardsView(false);
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
    const serviceCreditInput = query<HTMLInputElement>("[data-treasury-service-credit-asset]");
    if (serviceCreditInput && !serviceCreditInput.value) serviceCreditInput.value = serviceFeeAsset;
    const serviceCreditAsset = canonicalAddress(serviceCreditInput?.value.trim() || serviceFeeAsset, "Service credit asset", true);
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
    text("[data-treasury-status]", wallet?"Select A Token":"Connect Wallet");
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
  renderStakeSubmit();
  const stakeInput=query<HTMLInputElement>('#stake-amount');if(stakeInput)stakeInput.disabled=!rewardPosition||!!busyOperation||stakeSubmitting;
  const max=query<HTMLButtonElement>('[data-stake-max]');if(max)max.disabled=!rewardPosition||!!busyOperation||stakeSubmitting;
  const open=query<HTMLButtonElement>('[data-open-stake]');if(open){open.disabled=!!busyOperation||stakeSubmitting||!!wallet&&!rewardPosition;open.innerHTML=wallet?'<i class="ph ph-plus" aria-hidden="true"></i> Add Stake':'<i class="ph ph-wallet" aria-hidden="true"></i> Connect Wallet';}
  queryAll<HTMLButtonElement>('[data-close-stake]').forEach(button=>{button.disabled=!!busyOperation||stakeSubmitting;});
  const copy = query<HTMLButtonElement>("[data-copy-beneficiary]"); if (copy) copy.disabled = !creatorReward;
  queryAll<HTMLButtonElement>("[data-rewards-connect]").forEach(button=>button.hidden=!!wallet);
  if(!wallet)queryAll<HTMLElement>("[data-legacy-treasury],[data-continuous-treasury]").forEach(panel=>panel.hidden=true);
  const prerequisite = !wallet ? 'Connect your wallet.' : busyOperation ? 'A transaction is in progress. Check its status above.' : hasPendingTransaction() ? 'Check the existing transaction above before submitting another.' : !foundation?.writeReady ? 'Transactions are unavailable until the market connection is restored.' : '';
  text('[data-staker-action-help]', prerequisite || (rewardPosition ? stakerClaimHelp(rewardPosition) : 'Choose a market to view your stake and rewards.'));
  text('[data-creator-action-help]', prerequisite || (creatorDirectoryError||(!creatorMarketIds.size?'No Tokens Created By This Wallet.':creatorRewardNotOwned?'No Creator Rewards For This Wallet.':!creatorReward ? 'Choose a market to view creator rewards.' : creatorReward.liability > 0n ? `Ready to claim. Funds go to ${shortHex(creatorReward.beneficiary)}, the beneficiary for this version.` : creatorReward.memeLiability > 0n ? 'Choose How To Receive Your Rewards.' : 'No creator revenue to claim for this beneficiary version yet.')));
  text('[data-holder-action-help]', prerequisite || (continuousReward ? continuousReward.claimable > 0n ? '' : 'No Rewards Available Yet.' : treasuryReward ? treasuryReward.accountClaimed ? 'You have already claimed this reward cycle.' : treasuryReward.status === 3 && treasuryReward.proof ? treasuryReward.now > treasuryReward.claimUntil ? 'This reward cycle has expired.' : 'Your verified reward is ready to claim.' : 'Rewards will be available after this cycle closes and its distribution is ready. See cycle status below.' : 'Select A Token To View Rewards.'));

  queryAll<HTMLButtonElement>("[data-reward-action]").forEach((button) => {setDisabled(button, true);if(currentPage()==='rewards')button.hidden=!wallet;});
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
  if (!writeReady()||stakeSubmitting||rewardChoicePending) return;
  if (continuousReward && writeReady() && runtimeConfig.continuousHolderModes.includes(continuousReward.mode) && wallet?.account === continuousReward.account) {
    const claim = rewardActionButton("claimContinuous");
    if (claim) setDisabled(claim, continuousReward.claimable <= 0n && continuousReward.memeClaimable <= 0n);
  }
  if (rewardPosition) {
    const normalClaimReady = rewardPosition.allocated === 0n || (rewardPosition.unlockAt > 0n && rewardPosition.now >= rewardPosition.unlockAt);
    const allocationOpen = rewardPosition.asset.status === 1 && rewardPosition.detail.market.launchPhase === 1 && rewardPosition.settlementPrincipal === 0n;
    setDisabled(rewardActionButton("stake")!, !allocationOpen || !validStakeAmount());
    setDisabled(rewardActionButton("unstakeAndWithdraw")!, rewardPosition.allocated <= 0n || rewardPosition.detail.market.launchPhase !== 1 || rewardPosition.unlockAt === 0n || rewardPosition.now < rewardPosition.unlockAt);
    const rageQuit=rewardActionButton("rageQuit", "allocation-manager");if(rageQuit)setDisabled(rageQuit,rewardPosition.allocated<=0n);
    queryAll<HTMLButtonElement>("[data-reward-action=claimStaker]").forEach((button) => {
      const amount = rewardPosition!.memeClaimable + rewardPosition!.quoteClaimable;
      setDisabled(button, amount <= 0n || !normalClaimReady || rewardPosition!.settlementPrincipal > 0n);
    });
    const settleUser = query<HTMLInputElement>("[data-settle-user]")?.value.trim().toLowerCase() ?? "";
    const settle = rewardActionButton("settleRageQuitRewards");
    if (settle) setDisabled(settle, !ADDRESS_PATTERN.test(settleUser));
  }
  if (creatorReward) {
    const claim = rewardActionButton("claimCreator");
    if (claim) setDisabled(claim, !ownsCreatorRewards(wallet?.account,creatorReward.beneficiary)||(creatorReward.liability <= 0n && creatorReward.memeLiability <= 0n));
    const next = query<HTMLInputElement>("[data-creator-new-beneficiary]")?.value.trim().toLowerCase() ?? "";
    const transfer = rewardActionButton("transferCreatorRevenueBeneficiary");
    if (transfer) setDisabled(transfer, creatorReward.pendingBeneficiary === null || wallet?.account !== creatorReward.currentBeneficiary || !ADDRESS_PATTERN.test(next) || next === ZERO_ADDRESS || next === creatorReward.currentBeneficiary);
  }
  if (creatorReward) {
    const acceptCreatorRevenueBeneficiaryButton=rewardActionButton("acceptCreatorRevenueBeneficiary");if(acceptCreatorRevenueBeneficiaryButton)setDisabled(acceptCreatorRevenueBeneficiaryButton,!creatorReward.pendingBeneficiary || creatorReward.pendingBeneficiary === ZERO_ADDRESS || wallet?.account !== creatorReward.pendingBeneficiary.toLowerCase());
    const cancelCreatorRevenueBeneficiaryTransferButton=rewardActionButton("cancelCreatorRevenueBeneficiaryTransfer");if(cancelCreatorRevenueBeneficiaryTransferButton)setDisabled(cancelCreatorRevenueBeneficiaryTransferButton,!creatorReward.pendingBeneficiary || creatorReward.pendingBeneficiary === ZERO_ADDRESS || wallet?.account !== creatorReward.currentBeneficiary);
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

  stakeStatsCache.delete(marketId);
  stakeDirectoryAt=0;
  if(action!=="stake")toast(action === "rageQuit" ? "Principal returned immediately; reward cleanup state refreshed" : "Position Updated", "success");
  tradeStakeTotals.clear();
  await refreshRewardPosition();
  if(action==='stake'){
    const input=query<HTMLInputElement>('#stake-amount');if(input)input.value='';
    updateStakePreview();query<HTMLDialogElement>('[data-stake-dialog]')?.close();
    text('[data-rewards-action-status]','Stake Added');
  }
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
  tradeStakeTotals.clear();
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
  tradeStakeTotals.clear();
  await refreshRewardPosition();
}

let rewardClaimOutcomeMessage='';
let rewardChoicePending=false;
async function executeUserClaim(market: Parameters<typeof marketMetadata>[0],role: 0|1|2,epoch=0): Promise<void> {
  if(rewardChoicePending)throw Error('A Claim Is Already In Progress');
  rewardChoicePending=true;
  rewardClaimOutcomeMessage='';
  queryAll<HTMLButtonElement>('[data-reward-action^=claim]').forEach(button=>{button.disabled=true;button.setAttribute('aria-busy','true');});
  try {
  if(!foundation||!wallet)throw Error('Connect Wallet');
  const activeWallet=wallet, feeVault=marketRelease(market.marketId).feeVault;
  await usesUserClaims(feeVault);
  const metadata=await marketMetadata(market);
  const balances=role===0?[creatorReward?.liability??0n,creatorReward?.memeLiability??0n]:role===1?[rewardPosition?.quoteClaimable??0n,rewardPosition?.memeClaimable??0n]:[continuousReward?.claimable??0n,continuousReward?.memeClaimable??0n];
  const rawLabel=(assets: 1|2|3)=>[
    assets & 1 ? `${formatTokenAmount(balances[0]!,metadata.quoteDecimals)} ${metadata.quoteSymbol}` : '',
    assets & 2 ? `${formatTokenAmount(balances[1]!,18)} ${metadata.symbol}` : '',
  ].filter(Boolean).join(' + ');
  const choice=await rewardClaimDialog(async(assets)=>{
    const block=await publicClient.getBlock();
    const preview=await publicClient.simulateContract({abi:userClaimsAbi,address:feeVault,functionName:'claimUserRewardAssets',account:activeWallet.account,args:[market.marketId,role,epoch,assets,true,false,block.timestamp+240n]});
    return `Estimated: ${formatTokenAmount(preview.result[0],metadata.quoteDecimals)} ${metadata.quoteSymbol}${preview.result[2]>0n?' · Remaining Meme Will Be Retained':''}`;
  },rawLabel,{quote:metadata.quoteSymbol,meme:metadata.symbol});
  if(!choice){rewardClaimOutcomeMessage='Claim Cancelled';return;}
  await verifyLiveWalletContext(activeWallet);
  const block=await publicClient.getBlock();
  const outcome=await executeTransaction({
    operationKey:`reward:user-claim:${market.marketId}:${role}:${epoch}:${activeWallet.account}:${foundation.sync.revision}`,
    sync:foundation.sync,walletContext:activeWallet,
    request:createContractWriteRequest({abi:userClaimsAbi,address:feeVault,functionName:'claimUserRewardAssets',args:[market.marketId,role,epoch,choice.assets,choice.convert,choice.rawFallback,block.timestamp+240n]}),
    verifyChain:()=>ensureCanonicalMarket(market),
    confirm:async receipt=>receiptEvent(receipt,feeVault,userClaimsAbi,'UserRewardsClaimed',args=>args.marketId===market.marketId&&String(args.user).toLowerCase()===activeWallet.account&&Number(args.role)===role&&Number(args.creatorEpoch)===epoch),
  });
  tradeStakeTotals.clear();
  rewardClaimOutcomeMessage=userClaimOutcome(outcome);
  text('[data-rewards-action-status]',rewardClaimOutcomeMessage);
  await refreshActiveReward();
  } finally { rewardChoicePending=false;queryAll<HTMLButtonElement>('[data-reward-action^=claim]').forEach(button=>button.removeAttribute('aria-busy'));updateRewardsAvailability(); }
}

async function executeStakerClaim(): Promise<void> {
  if (!foundation || !wallet || !rewardPosition) throw new Error("Load A Reward Position First");
  await executeUserClaim(rewardPosition.detail.market, 1);
  await refreshRewardPosition();
}

async function executeCreatorAction(action: string): Promise<void> {
  if (!foundation || !wallet || !creatorReward || !runtimeConfig.contracts.available) throw new Error("Load verified creator revenue state first");
  const activeWallet = wallet;
  await verifyLiveWalletContext(activeWallet);
  const state = creatorReward;
  const creatorRegistry = marketRelease(state.marketId).creatorRegistry;
  await ensureCanonicalMarket(selectedRewardMarket("[data-creator-market]"));
  if (action === "claimCreator") {
    if(!ownsCreatorRewards(activeWallet.account,state.beneficiary))throw Error("No Creator Rewards For This Wallet");
    await executeUserClaim(selectedRewardMarket("[data-creator-market]"),0,state.epoch);
    await refreshCreatorReward();
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
  if (!foundation || !wallet || !continuousReward || !runtimeConfig.contracts.available || !writeReady() || !runtimeConfig.continuousHolderModes.includes(continuousReward.mode)) throw new Error("Load verified holder rewards first");
  const state = continuousReward;
  const activeWallet = wallet;
  const distributor = marketRelease(state.marketId).holderDistributor;
  await verifyLiveWalletContext(activeWallet);
  if (state.account !== activeWallet.account) throw new Error("Holder wallet changed");
  if(state.mode!==DUAL_HOLDER_MODE) throw Error('Unsupported Reward Claim Mode');
  await executeUserClaim(selectedRewardMarket("[data-treasury-market]"),2);
  holderHistoryCache.clear();
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

  if (action === 'transferCreatorRevenueBeneficiary' && !await confirmFlowAction('Nominate this wallet to receive future creator revenue? The change takes effect only when it accepts. Past earnings stay with the recorded beneficiary.')) return;
  if(action==='stake'){
    if(stakeSubmitting)return;
    const form=button.closest<HTMLFormElement>('form');if(form&&!form.reportValidity())return;
    stakeSubmitting=true;stakeSubmittingLabel='Preparing Stake…';
    text('[data-stake-transaction-status]','Preparing Your Stake…');
    const status=query<HTMLElement>('[data-stake-transaction-status]');if(status)status.dataset.state='pending';
    updateRewardsAvailability();
  }else text('[data-rewards-action-status]','Preparing Your Transaction…');
  try {
    if(action==='stake'&&rewardPosition&&rewardPosition.allocated>0n){
      if(!await confirmFlowAction('Adding stake restarts the 24-hour lock for your entire position and reward claims.',{title:'Confirm Stake',confirmLabel:'Stake'})){text('[data-stake-transaction-status]','');return;}
    }
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
      await executeStakerClaim();

    } else if (["claimCreator", "transferCreatorRevenueBeneficiary", "acceptCreatorRevenueBeneficiary", "cancelCreatorRevenueBeneficiaryTransfer"].includes(action)) {
      await executeCreatorAction(action);
    } else if (action === "claimContinuous") {
      await executeContinuousHolderClaim();
    } else if (["requestRoot", "claim", "finalizeRoot", "expireRootRequest", "rolloverExpiredEpoch", "withdrawServiceCredit"].includes(action)) {
      await executeTreasuryAction(action);
    } else {
      throw new Error("Unknown Rewards action");
    }
    if(action!=='stake')text('[data-rewards-action-status]',rewardClaimOutcomeMessage||'Transaction Confirmed');
    rewardClaimOutcomeMessage='';
  } catch (error) {
    if(action==='stake'){
      const message=hasPendingTransaction()?'Confirmation Pending. Check Your Wallet.':/reject|denied|cancel/i.test(errorText(error))?'Transaction Cancelled.':'Unable To Stake. Please Try Again.';
      text('[data-stake-transaction-status]',message);
      const status=query<HTMLElement>('[data-stake-transaction-status]');if(status)status.dataset.state='error';
    }else{
      text('[data-rewards-action-status]',`Action stopped — ${errorText(error)}`);
      toast(`Rewards action stopped — ${errorText(error)}`,'error');
    }
  }finally{
    if(action==='stake')stakeSubmitting=false;
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
    if (tab === 'positions' || tab === 'staker') await refreshRewardPosition(false);
    else if (tab === 'creator') {await refreshCreatorDirectory();await refreshCreatorReward();}
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
  if(currentPage()==='rewards')await refreshCreatorDirectory();
  if(pageGeneration!==routeGeneration)return;
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
      queryAll<HTMLSelectElement>("[data-creator-market]").forEach(select => { select.value = marketId; });
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
  if(currentPage()==='staking' && rewardDeepLinkApplied){
    const url=new URL(window.location.href);
    const action=url.searchParams.get('action');
    if(action==='add')query<HTMLButtonElement>('[data-open-stake]')?.click();
    if(action==='withdraw'){
      const position=query<HTMLElement>('.position-card');
      if(position){position.tabIndex=-1;position.focus({preventScroll:true});position.scrollIntoView({block:'center',behavior:'smooth'});}
    }
    if(action==='rewards')query<HTMLElement>('.rewards-card')?.scrollIntoView({block:'center',behavior:'smooth'});
    if(action){url.searchParams.delete('action');router.replaceLocation(`${url.pathname}${url.search}${url.hash}`);}
  }
  void refreshStakeDirectory();
  void refreshStakeStatistics();
  text('[data-rewards-runtime-title]', wallet ? 'Your rewards' : 'Connect your wallet');
  const empty = query<HTMLElement>('[data-rewards-empty]');
  if (empty) empty.hidden = !foundation || foundation.markets.length > 0;
  if (!foundation) {
    text("[data-rewards-status]", `Rewards unavailable — ${runtimeReasons().join("; ")}`);
    if (currentPage() === "staking") await refreshDirectEscape();
    updateRewardsAvailability();
    return;
  }
  if (!wallet) {
    if (currentPage() === "staking") { await refreshRewardPosition(); await refreshDirectEscape(); }
    updateRewardsAvailability();
    return;
  }
  const defaultMarket = foundation.markets.find((market) => market.marketId === requestedMarket)?.marketId ?? foundation.markets.find((market) => market.launchPhase === 1)?.marketId ?? foundation.markets[0]?.marketId ?? "";
  queryAll<HTMLSelectElement>("[data-position-market],[data-staker-market],[data-settle-market],[data-creator-market]").forEach((select) => {
    if(!select.matches('[data-creator-market]')&&!select.value&&defaultMarket)select.value=defaultMarket;
  });
  const directMarket = query<HTMLInputElement>("[data-direct-vault-market]");
  if (directMarket && !directMarket.value && defaultMarket) directMarket.value = defaultMarket;
  const treasuryMarket = query<HTMLSelectElement>("[data-treasury-market]");
  const defaultTreasuryMarket = foundation.markets.find((market) => market.launchPhase === 1)?.marketId ?? defaultMarket;

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
    (query<HTMLElement>(".staking-page .stake-content") ?? query<HTMLElement>("main") ?? document.body).prepend(panel);
  }
  panel.replaceChildren();
  if (foundation?.marketNextCursor && isRewardsPage()) {
    const more = document.createElement("button");
    more.textContent = "Load More Tokens";
    more.onclick = async () => {
      more.disabled = true;
      try { await appendMarketPage(); if (generation === routeGeneration) await refreshCurrentPage(true); }
      catch (error) { if (generation === routeGeneration) toast(`${errorText(error)}. Reload the page to restart the market list.`, "warning"); more.disabled = false; }
    };
    panel.append(more);
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
          const recoveredTrade=currentPage()==='trade'&&!!result;
          if((tradeAwaitingConfirmation||recoveredTrade)&&result){tradeAwaitingConfirmation=false;tradeTxStatus.update({operationKey:result.approval?'recovered-approval':'recovered-trade',hash:result.receipt.transactionHash,stage:succeeded?'confirmed':'failed'});updateTradeAvailability();}
          if(!recoveredTrade)toast(result?.cancelled ? "Existing transaction was cancelled." : succeeded
            ? result.approval ? "Approval confirmed. The business transaction has not been resubmitted; request a fresh quote." : "Existing transaction succeeded. Review refreshed balances before creating another order."
            : "Existing transaction reverted; no replacement was submitted.", succeeded ? "success" : "warning");
          if(recoveredTrade){if(tradeMarket)completeTradeDisplay(tradeMarket);}
          else if(currentPage()==='staking'){if(rewardPosition)stakeStatsCache.delete(rewardPosition.detail.market.marketId);await refreshRewardPosition();void refreshStakeDirectory(false,true);}
          else{await loadFoundation();await refreshCurrentPage();}
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
      if (tradeMarket) await refreshTradeFields(undefined, true);
      else {
        const marketId = new URL(window.location.href).searchParams.get("marketId")?.trim().toLowerCase() ?? "";
        if (BYTES32_PATTERN.test(marketId)) await loadTradeMarket(marketId);
        else { text("[data-detail-phase]", "Choose a market"); text("[data-detail-phase-note]", "Open a token from Explore to trade."); updateTradeAvailability(); }
      }
      break;
    case "create": renderCreateConfig(); break;
    case "stats": await renderStats(); break;
    case "staking":
    case "rewards": await renderRewards(); break;
    case "docs": setPageStatus("", "success"); break;
  }
  refreshActionAvailability();
  if (foundation?.direct) void refreshDirectDirectory();
}

function invalidateWalletReads(): void {
  clearCreatorDirectory();
  clearCreatorRewardView();
  syncUserActivity();
  invalidateSnapshotReads();
  ++directEscapeLoadGeneration;
  directEscape = null;
  refreshActionAvailability();
}

function invalidateSnapshotReads(preserveTradeDisplay=false): void {
  clearAccountBalances();
  if (currentPage() === "trade") { if(!preserveTradeDisplay)clearTradeMarketState(); }
  else displayPriceWidget?.setToken(null);
  homeRender.invalidate();
  clearHomeMarketView();
  marketsRender.invalidate();
  marketDirectory.reset();
  clearMarketDirectoryView(false);
  statsRender.invalidate();
  clearStatsSnapshotView("Market snapshot unavailable. Waiting for a verified snapshot.");
  // Immutable token identity is keyed by chain, token and quote configuration;
  // a new snapshot or page navigation must not refetch it (bounded to 256 entries).
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
  clearCreatorRewardView();
  const preserveContinuous=continuousReward?.account===wallet?.account&&continuousReward?.marketId===query<HTMLSelectElement>('[data-treasury-market]')?.value;
  treasuryReward = null;
  renderRecentHolderMarkets();
  continuousReward = null;
  if(!preserveContinuous){setContinuousRewardsView(false);queryAll<HTMLElement>('[data-legacy-treasury]').forEach(el=>el.hidden=true);}
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
        invalidateSnapshotReads(currentPage() === 'trade');
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
document.addEventListener("visibilitychange", () => { if (document.hidden) { poller.stop(); pauseAnalytics(); marketsRender.invalidate(); marketDirectory.reset(); clearMarketDirectoryView(false); } else poller.reconnect(); });
  snapshotPoller = poller;
  if (!isStaticPage()) poller.start();
}

function isStaticPage(): boolean {
  const page = currentPage();
  return page === "privacy" || page === "terms" || page === "risks" || page === "docs" || page === "not-found";
}

let disposeFieldValidation: (() => void) | undefined;
function unmountPage(): void {
  resetExplorePages();
  exploreStockPicker?.destroy();exploreStockPicker=undefined;
  window.clearInterval(stakeCountdownTimer);
  window.clearInterval(stakeStatisticsTimer);stakePageListeners?.abort();stakePageListeners=undefined;
  ++stakeStatsGeneration; ++stakeDirectoryGeneration; stakeDirectoryBusy=false;
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
  setTradePageLoading(false);
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
    setPageStatus("Unable To Load Data. Please Refresh.", "error");
    text("[data-rewards-status]", "Unable To Load Data. Please Refresh.");
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
let statsDirectoryReady=false;
let statsDirectoryReadAt=0;
async function refreshDirectDirectory(renderAfter=true):Promise<void>{
 if(currentPage()==="stats"&&statsDirectoryReady&&Date.now()-statsDirectoryReadAt<20*60_000)return;
 if(directDirectoryBusy||!directMarkets||!runtimeConfig.readApi.available||document.hidden||isStaticPage())return;
 directDirectoryBusy=true;
 try{
  const feed=await integrationMarketDirectory(runtimeConfig.readApi.value);
  for(const e of feed.events){const l=e.payload;directMarkets.observe({address:l.address,topics:l.topics,data:l.data,blockNumber:BigInt(e.blockNumber),blockHash:e.blockHash as Hex,transactionHash:l.transactionHash,transactionIndex:Number(BigInt(l.transactionIndex)),logIndex:Number(BigInt(l.logIndex))});}
  if((currentPage()==="home"||currentPage()==="markets"||currentPage()==="stats"||isRewardsPage())&&foundation?.direct){
   const refreshStates=Date.now()-directDirectoryReadAt>10*60_000;
   const previous=new Map(foundation.markets.map(m=>[m.marketId,m]));
   const firstCards:MarketReadModel[]=[];
   const records=await mapConcurrent([...directMarkets.sources.keys()].slice(currentPage()==="home"?-10:0),async id=>{
    const record=previous.has(id)&&((currentPage()==="markets"||currentPage()==="stats")?(!exploreStatistics[id]?.launchPhase||exploreStatistics[id]!.launchPhase===String(previous.get(id)!.launchPhase)):!refreshStates)?previous.get(id)!:await directMarkets!.market(id).then(x=>x.market).catch(()=>null);
    if(record)firstCards.push(record);
    // First usable cards do not wait for every other market to finish reading.
    if(previous.size===0&&firstCards.length===2&&record&&currentPage()==='markets'&&foundation?.direct){
     foundation=Object.freeze({...foundation,markets:[...firstCards]});resetExplorePages();void renderMarkets();
    }
    return record;
   },2);
   if(refreshStates)directDirectoryReadAt=Date.now();
   const markets=records.filter((x):x is MarketReadModel=>x!==null);
   if(currentPage()==="stats"){statsDirectoryReady=markets.length===directMarkets.sources.size;statsDirectoryReadAt=Date.now();}
   if(JSON.stringify(foundation.markets)!==JSON.stringify(markets)){foundation=Object.freeze({...foundation,markets});if(!renderAfter)return;if(currentPage()==="stats")await renderStats();else if(currentPage()==="home")await renderHome();else if(isRewardsPage())populateRewardMarkets();else if(currentPage()==='markets')await renderMarkets();}
  }
 }catch{/* Query history is optional and cannot disable wallet interactions. */}finally{
  directDirectoryBusy=false;
  if(currentPage()==='markets'&&foundation?.markets.length){
   for(const phase of [0,1] as const){
    const empty=query<HTMLElement>(`[data-stage-empty="${phase}"]`);
    if(empty&&!empty.hidden&&empty.textContent==='Loading Tokens…'){
     const filtered=!!query<HTMLInputElement>('[data-market-search]')?.value.trim()||!!query<HTMLSelectElement>('[data-market-asset]')?.value;
     empty.textContent=filtered?'No Matching Tokens':phase===1?'No Bloomed Tokens Yet':'No Growing Tokens Yet';
    }
   }
  }
 }
}
let directDirectoryTimer: ReturnType<typeof setInterval>|undefined;
if(integrationBootstrapPath)directDirectoryTimer=setInterval(()=>{if(!document.hidden)void refreshDirectDirectory();},30_000);
if(import.meta.hot)import.meta.hot.dispose(()=>{if(directDirectoryTimer)clearInterval(directDirectoryTimer);});

const exploreStatisticsTimer=setInterval(()=>{
 if(currentPage()!=='markets'||document.hidden)return;
 void refreshExploreStatistics().then(changed=>{
  if(!changed||currentPage()!=='markets')return;
  for(const phase of [0,1] as const){if(exploreVisiblePage[phase]===1){explorePagers[phase].reset();void renderExploreStage(phase);}}
 });
},20_000);
if(import.meta.hot)import.meta.hot.dispose(()=>clearInterval(exploreStatisticsTimer));

const statsPageTimer=setInterval(()=>{if(currentPage()==="stats"&&!document.hidden){void renderStats();analyticsRefresh.request();}},20*60_000);
if(import.meta.hot)import.meta.hot.dispose(()=>clearInterval(statsPageTimer));
