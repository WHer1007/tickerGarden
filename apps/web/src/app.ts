import {reportClientError} from './observability.ts';
import {loadCreatorRewards,type CreatorPeriod} from './v1/creatorRewards.ts';
import {createInvalidatedRead} from './ui/invalidated-read.ts';
import {verifyStakeReceipt} from './ui/stake-receipt.ts';
import type {ConversionQuote} from './trade/conversion.ts';
import {loadRewardPageDependencies} from './routing/reward-dependencies.ts';
import { applyPageMetadata } from "./routing/metadata.ts";
import { renderRouteLoading, renderRouteFailure } from "./routing/load-state.ts";
import { publicError } from "./ui/public-error.ts";
import {V1_EXECUTION_SPEC_ID} from './v1/generated/abi-identity.ts';

















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
import { decodeMarketRecord,legacyMarketRecordAbi } from "../../../services/backend-ts/packages/chain/src/market-record.ts";
import { coreMarketRouteAbi,decodeCoreMarketRoute } from '../../../services/backend-ts/packages/chain/src/market-route.ts';
import { DeveloperBuyBalanceCache } from './create/developer-buy.ts';
import { type CreateDraft } from "./create/draft.ts";
import { closeLaunchProgress } from "./create/launch-progress-dialog.ts";
import { launchStateKey,readLaunchState,type LaunchPhase,type LaunchState } from "./create/launch-state.ts";
import { type ListingPackageSnapshot } from "./create/listing-package.ts";
import { metadataOrigin } from "./create/metadata.ts";
import { assetLogoUrl,quoteIconUrl } from './create/quote-icons.ts';
import { destroyQuotePicker } from "./create/quote-picker.ts";
import { stakingAssetForConfig } from './create/staking-assets.ts';
import "./icons/regular.css";
import { loadPageTemplate } from "./routing/pages.ts";
import { createRouter } from "./routing/router.ts";
import type { PageName,Route } from "./routing/routes.ts";
import { mountPageVisuals } from "./routing/visuals.ts";
import { createRenderGeneration } from "./runtime/renderGeneration.ts";
import { assertCanonicalSnapshotContinuation,mapConcurrent } from "./runtime/snapshot.ts";
import { setupDocs,revealDocsHash } from "./ui/docs-search.ts";
import { setupExploreStockPicker } from './ui/explore-stock-picker.ts';
import { reconcileVisibleCards,resolveExploreImageURI } from './v1/exploreUpdates.ts';
import { mountFieldValidation } from './ui/fieldValidation.ts';
import { createGlobalNotice,globalNoticeRegion,type GlobalNoticeTone } from './ui/global-notice.ts';
import { ensureWalletChain } from "./ui/network-support.ts";
import { publicMessage } from "./ui/public-copy.ts";

import { renderShell } from "./ui/shell.ts";
import { bindStakeAmountInput } from './ui/stake-amount-input.ts';
import { stakeErrorMessage } from "./ui/stake-error.ts";
import { stakeLockLabel,stakeProgress,stakeUnlockDisplay } from './ui/stake-progress.ts';
import { tokenAge } from './ui/token-age.ts';
import { createTradeTransactionStatus } from './ui/trade-transaction-status.ts';
import { watchWalletAccount } from './ui/wallet-account-sync.ts';
import { createWalletPicker,type InjectedProvider } from "./ui/wallet-picker.ts";
import { authorizedWalletAccount } from "./ui/wallet-session.ts";
import { loadWalletAccounts } from "./v1/accounts.ts";
import { createAssetPriceStore } from './v1/assetPrices.ts';
import type { mountCandles } from "./v1/candleWidget.ts";
import { createCoalescedRefresh } from "./v1/coalescedRefresh.ts";
import { watchMarketChanges } from './v1/marketChanges.ts';

import { ownsCreatorRewards } from './v1/creatorOwnership.ts';
import { pageDirectExplore } from './v1/directExploreDirectory.ts';
import type { DirectMarkets } from "./v1/directMarkets.ts";
import { directReceipt } from "./v1/directReceipt.ts";
import { mountDisplayPrice } from "./v1/displayPrices.ts";
import { createExplorePager } from './v1/explorePaging.ts';

import {holderSnapshotStatus,remainingSnapshotAssets} from './v1/features/holderSnapshotDisplay.ts';
import type {HolderRound,HolderSnapshotPage,SnapshotIdentity} from './v1/features/holderSnapshots.ts';
import { validateMarketStake } from './v1/features/stake-validation.ts';
import {LEGACY_USER_CLAIM_MODE,USER_CLAIM_MODE,userClaimsAbi} from './v1/features/userClaims.ts';
import { rewardTab } from "./v1/flowUx.ts";
import type { MarketPage,PositionPage,UserActivityPage } from './v1/generated/read-api.ts';
import type { mountGlobalHolders } from "./v1/globalHoldersWidget.ts";
import type { mountGlobalSeries } from "./v1/globalSeriesWidget.ts";
import type { mountGlobalStatistics } from "./v1/globalStatsWidget.ts";
import { graduationProgress } from "./v1/graduationProgress.ts";
import {type HolderMarket} from './v1/holderMarkets.ts';
import type { mountHolders } from "./v1/holderWidget.ts";
import { bootstrapSync,parseIntegrationBootstrap,type IntegrationBootstrap } from "./v1/integrationBootstrap.ts";
import { type LaunchFunding } from "./v1/launchFunding.ts";
import { createMarketDirectory,type DirectoryQuery } from "./v1/marketDirectory.ts";
import { resolveMarketRelease,snapshotReleaseForMarket,type MarketRelease } from "./v1/marketRelease.ts";
import { pendingTransactionPage } from './v1/pending-transaction-page.ts';
import { readPublishedMarket } from './v1/pendingMarket.ts';
import { createSnapshotPoller,SnapshotRefreshSuperseded } from "./v1/snapshotUpdates.ts";

import { firstActiveStakeMarket,stakeAfter,stakeDirectorySource,stakeHistoryEvent,stakeMarketIsOpen,stakePortfolioMode,stakeShare,summarizeDirectStakeAllocations,unstakeConfirmationCopy,validateStakePositions } from './v1/stakingView.ts';
import { statisticsUSD } from "./v1/statisticsValue.ts";
import { displayDecimal } from './v1/tokenDetail.ts';
import type { mountTokenDetail } from './v1/tokenDetailWidget.ts';
import { readDetailMetadata } from './v1/tokenMetadata.ts';
import { createTradeBalanceLoader } from './v1/tradeBalances.ts';
import type { mountTrades } from "./v1/tradeWidget.ts";
import { mountTransactionObservation } from "./v1/transactionObservation.ts";
import { validateUserActivity } from './v1/userActivity.ts';
import type { mountUserActivity } from "./v1/userActivityWidget.ts";

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
type CreateMarketParams,
type SelectedLaunchConfig
} from "./v1/features/launch.ts";

import type { TreasuryClaimProof } from './v1/features/treasury.ts';

import {
ADDRESS_PATTERN,
assertFinalizedSync,
BYTES32_PATTERN,
canonicalAddress,
canonicalBytes32,
foldSortedMerkleProof,
formatTokenAmount,
parseTokenAmount,
parseUint32,
phaseLabel,
errorText as rawErrorText,
shortHex,
tupleBigInt,
tupleField,
tupleNumber,
tupleString,
ZERO_ADDRESS,
type MarketMetadata
} from "./runtime/model.ts";

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
transactionScopeForOperation,
V1TransactionError,
V1TransactionExecutor,
type ContractWriteRequest,
type ReconciledSnapshot,
type TransactionScope,
type TransactionUpdate,
type V1TransactionClients,
} from "./v1/transaction.ts";

let integrationBootstrap: IntegrationBootstrap | null = null;
let directMarkets: DirectMarkets | null = null;
const integrationBootstrapPath = import.meta.env.VITE_INTEGRATION_BOOTSTRAP as string | undefined;
export type Foundation = Readonly<{
  direct?: true;
  displayOnly?: true;
  configScope?: "read"|"full";
  health: HealthResponse;
  sync: SyncStatus;
  assets: readonly ConfigReadModel[];
  quotes: readonly ConfigReadModel[];
  baseline: readonly ConfigReadModel[];
  templates: readonly ConfigReadModel[];
  markets: readonly MarketReadModel[];
  marketNextCursor?: string;
  directoryMarketId?: Hex;
  bindings?: CanonicalRuntimeBindings;
  launchFee?: bigint;
  writeReady: boolean;
  writeReasons: readonly string[];
}>;

export interface WalletState {
  readonly account: Address;
  readonly provider: InjectedProvider;
  readonly executor: V1TransactionExecutor;
}

let routeGeneration = 0;
let readyRouteGeneration = 0;
let pageActionCount = 0;
let pageActionPending = false;
let deferredRoute: string | null = null;
let rewardRefreshTimer = 0;
let disposeVisuals: (() => void) | undefined;
let walletPicker: ReturnType<typeof createWalletPicker> | undefined;
let snapshotPoller: ReturnType<typeof createSnapshotPoller> | undefined;
let recentMarketVersion:string|undefined;
let syncRewardHash: (() => void) | undefined;

async function runPageAction(action: () => Promise<void>): Promise<void> {
  if (walletConnecting) return;
  pageActionCount += 1;
  pageActionPending = true;
  try { await action(); }
  finally {
    pageActionCount = Math.max(0, pageActionCount - 1);
    pageActionPending = pageActionCount > 0;
    if (!pageActionPending && deferredRoute) { const next = deferredRoute; deferredRoute = null; const navigated=router.navigate(next);
      if(!navigated)setTimeout(()=>void restoreLaunchProgress(),1000);
      if(navigated&&launchProgress?.phase==='complete'){localStorage.removeItem(launchStateKey(robinhoodChain.id));launchProgress=null;}
    }
  }
}

const runtimeConfig = parseV1RuntimeConfig(import.meta.env);
const runtimeRpcUrl = import.meta.env.PROD && typeof window !== 'undefined'
  ? new URL('/api/rpc', window.location.origin).toString()
  : import.meta.env.VITE_V1_RPC_URL || robinhoodChain.rpcUrls.default.http[0];
const publicClient = createPublicClient({
  chain: robinhoodChain,
  transport: http(runtimeRpcUrl, { batch: { batchSize: 20, wait: 8 } }),
});
const readApi = runtimeConfig.readApi.available
  ? new TickerGardenV1Client(runtimeConfig.readApi.value)
  : null;
const assetPrices = createAssetPriceStore({ baseUrl: runtimeConfig.readApi.available ? runtimeConfig.readApi.value : null, chainId: robinhoodChain.id });

let userActivityWidget: ReturnType<typeof mountUserActivity> | null = null;
let globalHoldersWidget: ReturnType<typeof mountGlobalHolders> | null = null;
let seriesWidget: ReturnType<typeof mountGlobalSeries> | null = null;
let globalStatsWidgets: ReturnType<typeof mountGlobalStatistics>[] = [];
let tokenDetailWidget: ReturnType<typeof mountTokenDetail> | null = null;
let detailContentAbort: AbortController | null = null;
let detailBalanceAccount:string|undefined;
let detailBalances: {quote?:bigint;meme?:bigint}|null=null;
const detailBalanceLoader=createTradeBalanceLoader({
 read:(asset,account)=>asset===ZERO_ADDRESS?publicClient.getBalance({address:canonicalAddress(account,'Wallet')}):publicClient.readContract({abi:erc20Abi,address:canonicalAddress(asset,'Balance asset'),functionName:'balanceOf',args:[canonicalAddress(account,'Wallet')]}),
 changed:value=>{detailBalances=value;renderDetailBalances();updateTradeAvailability();},
});

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
async function mountPageWidgets(): Promise<void> {
 const own=routeGeneration;
 const modules=await Promise.all([
  query('.trade-live')?import('./v1/tokenDetailWidget.ts'):Promise.resolve(null),
  query('[data-user-activity]')?import('./v1/userActivityWidget.ts'):Promise.resolve(null),
  query('[data-global-holders]')?import('./v1/globalHoldersWidget.ts'):Promise.resolve(null),
  query('[data-global-series]')?import('./v1/globalSeriesWidget.ts'):Promise.resolve(null),
  query('[data-global-statistics]')?import('./v1/globalStatsWidget.ts'):Promise.resolve(null),
  query('[data-market-holders]')?import('./v1/holderWidget.ts'):Promise.resolve(null),
  query('[data-market-trades]')&&!integrationBootstrapPath?import('./v1/tradeWidget.ts'):Promise.resolve(null),
  query('[data-market-trades]')&&integrationBootstrapPath?import('./v1/directTradeWidget.ts'):Promise.resolve(null),
  query('[data-market-candles]')?import('./v1/candleWidget.ts'):Promise.resolve(null)
 ]);
 if(own!==routeGeneration)return;
 const mountTokenDetail=modules[0]?.mountTokenDetail;
 const mountUserActivity=modules[1]?.mountUserActivity;
 const mountGlobalHolders=modules[2]?.mountGlobalHolders;
 const mountGlobalSeries=modules[3]?.mountGlobalSeries;
 const mountGlobalStatistics=modules[4]?.mountGlobalStatistics;
 const mountHolders=modules[5]?.mountHolders;
 const mountTrades=modules[6]?.mountTrades;
 const mountDirectTrades=modules[7]?.mountDirectTrades;
 const mountCandles=modules[8]?.mountCandles;
  const base = runtimeConfig.readApi.available ? runtimeConfig.readApi.value : null;
  const detailRoot=query<HTMLElement>(".trade-live");
  tokenDetailWidget=detailRoot?mountTokenDetail!(detailRoot,base,robinhoodChain.id,robinhoodChain.blockExplorers.default.url):null;
  tokenDetailWidget?.prefetch(new URL(window.location.href).searchParams.get('marketId')?.trim().toLowerCase()??'');
  const activity = query<HTMLElement>("[data-user-activity]");
  userActivityWidget = activity ? mountUserActivity!(activity, base, robinhoodChain.id) : null;
  const holders = query<HTMLElement>("[data-global-holders]");
  globalHoldersWidget = holders ? mountGlobalHolders!(holders, base, robinhoodChain.id, query<HTMLElement>("[data-stat-holders]")) : null;
  const series = query<HTMLElement>("[data-global-series]");
  seriesWidget = series ? mountGlobalSeries!(series, base, robinhoodChain.id, address=>statsAsset(address).label) : null;
  globalStatsWidgets = [];
  queryAll<HTMLElement>("[data-global-statistics]").forEach(element=>{
    const disclosure=element.closest('details');
    if(element.hasAttribute('data-stats-lazy')&&disclosure){let mounted=false;disclosure.addEventListener('toggle',()=>{if(disclosure.open&&!mounted){mounted=true;const widget=mountGlobalStatistics!(element,base,robinhoodChain.id);globalStatsWidgets.push(widget);analyticsWidgets.push({refresh:()=>disclosure.open?widget.refresh():Promise.resolve(),stop:()=>widget.stop()});}});}
    else globalStatsWidgets.push(mountGlobalStatistics!(element,base,robinhoodChain.id));
  });
  analyticsWidgets = [...globalStatsWidgets, globalHoldersWidget, seriesWidget].filter((widget): widget is NonNullable<typeof widget> => widget !== null);
  const holder = query<HTMLElement>("[data-market-holders]");
  holderWidget = holder ? mountHolders!(holder, base, robinhoodChain.id, (page) => {
    text('[data-detail-holders]', page ? `${page.positiveAddressCount.toLocaleString()} addresses` : '-');
    text('[data-detail-supply]', page ? formatTokenAmount(page.totalSupplyRaw, 18) : '-');
  }) : null;
  const trades = query<HTMLElement>("[data-market-trades]");
  tradeHistoryWidget = trades ? (integrationBootstrapPath ? mountDirectTrades!(trades,base) : mountTrades!(trades, base, robinhoodChain.id)) : null;
  const candles = query<HTMLElement>("[data-market-candles]");
  candleWidget = candles ? mountCandles!(candles, base, robinhoodChain.id) : null;
  const prices = query<HTMLElement>("[data-display-price]");
  displayPriceWidget = prices ? mountDisplayPrice(prices, assetPrices, robinhoodChain.id) : null;
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
const activeOperations = new Map<string,TransactionScope>();
function hasActiveOperations(): boolean { return activeOperations.size > 0; }
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
  return (["home", "markets", "trade", "create", "stats", "statsStocks", "rewards", "staking", "docs", "privacy", "terms", "not-found"] as const).includes(candidate as PageName)
    ? candidate as PageName
    : "home";
}

function randomSalt(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

const globalNotice = createGlobalNotice();
function notify(message: string, tone: GlobalNoticeTone = "neutral"): void {
  globalNotice.show(publicMessage(message), tone);
}

function setPageStatus(message: string, tone: "neutral" | "success" | "warning" | "error" = "neutral"): void {
  const target = query<HTMLElement>("[data-page-status]");
  if (!target) return;
  target.textContent = publicMessage(message);
  if(currentPage()==="markets"){const list=query<HTMLElement>("[data-market-list]");if(list)list.dataset.statusActive=String(!!message);}
  target.dataset.state = tone;
  target.parentElement?.querySelector("[data-page-retry]")?.remove();
  if (tone === "error") {
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "page-retry";
    retry.dataset.pageRetry = "";
    retry.textContent = "Try again";
    retry.setAttribute("aria-label", "Reload this page and try again");
    retry.addEventListener("click", () => window.location.reload());
    target.insertAdjacentElement("afterend", retry);
  }
}

async function verifyRecoveredStakeReceipt(result:import('./v1/transaction.ts').ReconciledPendingTransaction,account:Address):Promise<void>{
 if(result.pending.businessType!=='stake')return;
 const {receipt,pending}=result;
 const block=await publicClient.getBlock({blockNumber:receipt.blockNumber});
 if(block.hash!==receipt.blockHash||receipt.from.toLowerCase()!==account.toLowerCase())throw Error('Pending stake receipt identity changed');
 if(receipt.status==='reverted'||result.cancelled)return;
 if(!readApi||!foundation||!pending.marketId)throw Error('Stake market not ready');
 const detail=await readApi.getMarketPageBootstrap({marketId:pending.marketId as Hex});
 await ensureCanonicalMarket(detail.market,true);
 const asset=await ensureCanonicalAsset(findAsset(detail.market.assetUid),verifiedMarketRuntime.get(detail.market.marketId));
 const [target,method,args]=JSON.parse(pending.intent) as [string,string,string[]];
 if(pending.approval){
  if(receipt.to?.toLowerCase()!==asset.stockToken.toLowerCase())throw Error('Approval target mismatch');
  receiptEvent(receipt,asset.stockToken,erc20Abi,'Approval',a=>String(a.owner).toLowerCase()===account.toLowerCase()&&String(a.spender).toLowerCase()===asset.userStockVault.toLowerCase()&&typeof a.value==='bigint'&&a.value>=BigInt(args[1]??'0'));
  return;
 }
 const action=method==='stake'?'stake':method==='unstakeAndWithdraw'?'unstakeAndWithdraw':method==='rageQuit'||method==='rageQuitAllocation'?'rageQuit':null;
 const directExit=method==='rageQuit'&&args.length===2;
 if(!action||args[directExit?1:0]!==pending.marketId||(directExit&&args[0]!==asset.assetUid))throw Error('Unsupported pending stake intent');
 const expectedTarget=directExit?asset.userStockVault:marketRelease(pending.marketId).allocationManager;
 if(target.toLowerCase()!==expectedTarget.toLowerCase())throw Error('Pending stake target mismatch');
 const {default:abi}=await import('./v1/generated/contracts/legacy/UserStockVault.ts');
 verifyStakeReceipt(receipt,{abi,vault:asset.userStockVault,target:expectedTarget,assetUid:asset.assetUid,marketId:pending.marketId as Hex,account,action,...(action==='stake'?{stakeAmount:BigInt(args[1]!)}:{})});
}
let stakeRecoveryRunning=false;
async function recoverPendingStake():Promise<void>{
 if(stakeRecoveryRunning||!wallet||currentPage()!=='staking')return;
 const active=wallet,marketId=query<HTMLSelectElement>('[data-position-market]')?.value;
 stakeRecoveryRunning=true;
 try{
  const results=await active.executor.reconcileSettledPending(active.account,{filter:p=>p.businessType==='stake'&&p.marketId===marketId,verify:result=>verifyRecoveredStakeReceipt(result,active.account)});
  if(wallet!==active||!results.length)return;
  for(const result of results){showTransactionUpdate({operationKey:result.pending.operationKey,hash:result.receipt.transactionHash,stage:result.receipt.status==='success'&&!result.cancelled?(result.approval?'approval_confirmed':'confirmed'):'failed'});}
  await refreshRewardPosition(true);void refreshStakeStatistics(true);refreshActionAvailability();
 }finally{stakeRecoveryRunning=false;}
}

function runtimeReasons(): readonly string[] {
  if (foundationError) return [publicError(new Error(foundationError))];
  if (!foundation) return ["Loading market data"];
  return foundation.writeReasons.length ? ["Market data is still being verified. Please try again shortly."] : [];
}

function isRewardsPage(): boolean { return currentPage() === 'rewards' || currentPage() === 'staking'; }

function writeReady(): boolean {
  return Boolean(foundation?.writeReady && wallet && !walletConnecting);
}

function transactionScopeBusy(scope: TransactionScope): boolean {
  if ([...activeOperations.values()].some(activeScope => activeScope.conflictKey === scope.conflictKey)) return true;
  if (!wallet) return false;
  try { return wallet.executor.pending(wallet.account).some(record => record.conflictKey === scope.conflictKey); }
  catch { return true; }
}

function currentStakeOperationBusy(): boolean {
  const marketId=rewardPosition?.detail.market.marketId;
  return marketId ? transactionScopeBusy({businessType:'stake',marketId,conflictKey:`stake:${marketId}`}) : false;
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
  const response = await api.listMarkets({ includeRecent: true, revision, limit: 100, ...(cursor ? { cursor } : {}) });
  assertFinalizedSync(response.sync, revision, "market directory");
  return response;
}

let foundationGeneration = 0;
let loadingFoundation: Promise<void> | null = null;
let foundationRequestKey='';
async function loadFoundation(): Promise<void> {
  const key=currentPage()==='trade'?`trade:${new URL(location.href).searchParams.get('marketId')}`:currentPage()==='markets'?'explore':'global';
  if (loadingFoundation&&foundationRequestKey===key) return loadingFoundation;
  foundationRequestKey=key;
  const pending = (async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (isStaticPage()||foundationRequestKey!==key) break;
      await loadFoundationAttempt();
      if (foundation || !readApi) break;
    }
  })().finally(() => { if(loadingFoundation===pending)loadingFoundation = null; });
  loadingFoundation=pending;return pending;
}

async function loadFoundationAttempt(): Promise<void> {
  const generation = ++foundationGeneration;
  if (!readApi && !integrationBootstrapPath) { foundationError = "V1 read API is unavailable"; return; }
  try {
    const next = await prepareFoundation(readApi);
    if (generation !== foundationGeneration) return;
    invalidateSnapshotReads(currentPage() === 'trade' && !tradeMarket);
    foundation = next;
    foundationError = "";
  } catch (error) {
    if (generation !== foundationGeneration) return;
    foundation = null;
    foundationError = errorText(error);
    invalidateSnapshotReads(currentPage() === 'trade' && !tradeMarket);
  }
}

async function prepareLocalIntegrationFoundation():Promise<Foundation>{
  if (integrationBootstrapPath) {
    if (!runtimeConfig.contracts.available) throw Error("Integration contracts missing");
    if (!integrationBootstrap) {
      if (!integrationBootstrapPath.startsWith("/integration/") || integrationBootstrapPath.includes("..")) throw Error("Invalid integration configuration path");
      const response=await fetch(integrationBootstrapPath);if(!response.ok)throw Error("Integration deployment file unavailable");
      integrationBootstrap=parseIntegrationBootstrap(await response.json(),robinhoodChain.id,runtimeConfig.contracts.value);
    }
    const b=integrationBootstrap,sync=bootstrapSync(b);
    const {DirectMarkets} = await import('./v1/directMarkets.ts');
    directMarkets ??= new DirectMarkets(
      b,
      (address,abi,functionName,args,blockNumber)=>publicClient.readContract({address,abi,functionName,args,blockNumber}),
      async()=>{const h=await publicClient.getBlock({blockTag:"latest"});return {number:h.number,hash:h.hash};},
      localStorage,
      async()=>{await discoverDirectMarketSources(b.factory);},
    );
    return Object.freeze({direct:true,health:({executionSpecId:V1_EXECUTION_SPEC_ID,status:"read-api",readApiImplemented:true,productRuntimeImplemented:true,custody:false,transactionSubmission:false,sync} as HealthResponse),sync,assets:b.assets,quotes:b.configs.filter(c=>c.kind==="quote"),baseline:b.configs.filter(c=>c.kind==="baseline"),templates:b.configs.filter(c=>c.kind==="template"),markets:foundation?.direct ? foundation.markets : [],bindings:b.bindings,launchFee:BigInt(b.launchFee),writeReady:true,writeReasons:[]});
  }
  throw Error("Integration configuration is unavailable");
}

async function prepareFoundation(api: TickerGardenV1Client | null, expectedSync?: SyncStatus, reuseConfigs=false): Promise<Foundation> {
  if (integrationBootstrapPath) return prepareLocalIntegrationFoundation();
  if (!api) throw Error("V1 read API is unavailable");
  if((currentPage()==='markets'||currentPage()==='staking'||currentPage()==='rewards')&&!expectedSync){
    if(!runtimeConfig.readApi.available)throw Error('V1 read API is unavailable');
    const response=await fetch(new URL('/v1/explore/bootstrap',runtimeConfig.readApi.value),{signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw Error('Explore bootstrap unavailable');
    const page=await response.json() as {displayOnly?:boolean;configs?:ConfigReadModel[];sync?:SyncStatus};
    if(page.displayOnly!==true||!Array.isArray(page.configs)||page.sync?.chainId!==robinhoodChain.id)throw Error('Invalid Explore bootstrap');
    return Object.freeze({displayOnly:true,configScope:'read',health:{executionSpecId:V1_EXECUTION_SPEC_ID,status:'read-api',readApiImplemented:true,productRuntimeImplemented:true,custody:false,transactionSubmission:false,sync:page.sync} as HealthResponse,sync:page.sync,assets:page.configs.filter(c=>c.kind==='asset'),quotes:page.configs.filter(c=>c.kind==='quote'),baseline:[],templates:[],markets:[],writeReady:runtimeConfig.contracts.available,writeReasons:[]});
  }
  if(currentPage()==="trade"&&!expectedSync){
    const marketId=new URL(window.location.href).searchParams.get('marketId')?.toLowerCase();
    if(marketId&&BYTES32_PATTERN.test(marketId)){
      const page=await api.getMarketPageBootstrap({marketId:marketId as Hex});
      if(page.displayOnly!==true||page.sync.chainId!==robinhoodChain.id||page.market.marketId!==marketId||!page.market.identity)throw Error('Invalid market page');
      const configs=page.configs;
      return Object.freeze({displayOnly:true,configScope:'full',health:{executionSpecId:V1_EXECUTION_SPEC_ID,status:'read-api',readApiImplemented:true,productRuntimeImplemented:true,custody:false,transactionSubmission:false,sync:page.sync} as HealthResponse,sync:page.sync,assets:configs.filter(c=>c.kind==='asset'),quotes:configs.filter(c=>c.kind==='quote'),baseline:configs.filter(c=>c.kind==='baseline'),templates:configs.filter(c=>c.kind==='template'),markets:[page.market],directoryMarketId:marketId as Hex,writeReady:runtimeConfig.contracts.available,writeReasons:[]});
    }
  }
  if(currentPage()==='trade'&&!expectedSync)throw Error('Choose a market from Explore.');
  let health = await api.getHealth();
  if (health.executionSpecId !== V1_EXECUTION_SPEC_ID || health.status !== "read-api" || !health.readApiImplemented) {
    throw new Error("Read API does not advertise this V1 execution contract");
  }
  if (health.custody || health.transactionSubmission) throw new Error("Read API violates the non-custodial read-only boundary");
  assertFinalizedSync(health.sync, undefined, "Read API health");
  if (expectedSync) { assertFinalizedSync(expectedSync); health = { ...health, sync: expectedSync }; }
  const revision = health.sync.revision;
  const requestedMarket = currentPage() === "trade" ? new URL(window.location.href).searchParams.get("marketId")?.trim().toLowerCase() : undefined;
  const directoryMarketId = requestedMarket && BYTES32_PATTERN.test(requestedMarket) ? requestedMarket as Hex : undefined;
  const configScope=["markets","stats","statsStocks"].includes(currentPage())?"read":"full";
  const [assets, quotes, baseline, templates, marketPage] = await Promise.all([
    reuseConfigs&&foundation?Promise.resolve(foundation.assets):readAllConfig("asset", revision, api),
    reuseConfigs&&foundation?Promise.resolve(foundation.quotes):readAllConfig("quote", revision, api),
    configScope==="read"?Promise.resolve([]):reuseConfigs&&foundation?.configScope==="full"?Promise.resolve(foundation.baseline):readAllConfig("baseline", revision, api),
    configScope==="read" ? Promise.resolve([]) : reuseConfigs&&foundation?.configScope==="full"?Promise.resolve(foundation.templates):readAllConfig("template", revision, api),
    directoryMarketId
      ? readPublishedMarket(()=>api.getMarket({marketId:directoryMarketId,revision,includeRecent:true}),directoryMarketId,revision)
        .then(detail=>({items:detail?[detail.market]:[],nextCursor:undefined}))
      : ["markets","create","stats","statsStocks"].includes(currentPage()) ? Promise.resolve({items:[] as MarketReadModel[],nextCursor:undefined}) : readMarketPage(revision, undefined, api),
  ]);

  const reasons: string[] = [];
  if (!health.productRuntimeImplemented) reasons.push("Read API reports that the V1 product runtime is incomplete");
  if (!runtimeConfig.contracts.available) reasons.push(...runtimeConfig.contracts.reasons);
  return Object.freeze({
    configScope,
    health,
    sync: health.sync,
    assets,
    quotes,
    baseline,
    templates,
    markets: marketPage.items,
    ...(directoryMarketId ? {directoryMarketId} : {}),
    ...(marketPage.nextCursor ? { marketNextCursor: marketPage.nextCursor } : {}),

    writeReady: health.productRuntimeImplemented && reasons.length === 0,
    writeReasons: Object.freeze(reasons),
  });
}

// Only called while preparing a wallet action; browsing never probes RPC.
async function verifyTransactionFoundation(): Promise<void> {
const {default: v1Abis_TickerGardenFactoryV1} = await import('./v1/generated/contracts/legacy/TickerGardenFactoryV1.ts');
const {default: v1Abis_TreasuryDistributorV1} = await import('./v1/generated/contracts/legacy/TreasuryDistributorV1.ts');

  if (!foundation) throw new Error('Read API foundation unavailable');
  const current = foundation;
  const reasons: string[] = [];
  let bindings: CanonicalRuntimeBindings | undefined;
  let launchFee: bigint | undefined;
  if (!runtimeConfig.contracts.available) {
    reasons.push(...runtimeConfig.contracts.reasons);
  } else {
    const configured = runtimeConfig.contracts.value;
    try {
      const [rawBindings, rawLaunchFee, treasury, creatorRegistry] = await Promise.all([
        publicClient.readContract({ abi: v1Abis_TickerGardenFactoryV1, address: configured.factoryAddress, functionName: "runtimeBindings" }),
        publicClient.readContract({ abi: v1Abis_TickerGardenFactoryV1, address: configured.factoryAddress, functionName: "launchFee" }),
        readHolderDistributor(configured.factoryAddress),
        publicClient.readContract({ abi: v1Abis_TickerGardenFactoryV1, address: configured.factoryAddress, functionName: "creatorRevenueRegistry" }),
      ]);
      bindings = assertCanonicalFactoryBindings(rawBindings, {
        launchRouter: configured.launchRouterAddress,
        allocationManager: configured.allocationManagerAddress,
        protocolFeeVault: configured.protocolFeeVaultAddress,
      });
      if (treasury.toLowerCase() !== configured.treasuryDistributorAddress) throw new Error("Configured TreasuryDistributor is not the Factory binding");
      if (creatorRegistry.toLowerCase() !== configured.creatorRevenueRegistryAddress) throw new Error("Configured CreatorRevenueRegistry is not the Factory binding");
      const treasuryRegistry = await publicClient.readContract({
        abi: v1Abis_TreasuryDistributorV1,
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
  if (reasons.length || !bindings || launchFee === undefined) throw new Error(reasons.join('; ') || 'Transaction bindings unavailable');
  if (foundation !== current) throw new Error('Snapshot changed during transaction preparation');
  foundation = Object.freeze({...current, bindings, launchFee});
}

async function ensureCurrentRevision(expected: string): Promise<string> {
  // Direct operations validate the relevant current contracts before simulation;
  // analytics revisions never authorize these transactions.
  if(foundation?.direct && integrationBootstrap) return expected;
  if(currentPage()==='trade'||currentPage()==='staking'||currentPage()==='rewards'){
    const match=/^(0|[1-9][0-9]*):(0x[0-9a-f]{64})$/.exec(expected);
    if(!match)throw new V1TransactionError('stale_snapshot','Refresh the trade quote before signing.');
    const [chain,block]=await Promise.all([publicClient.getChainId(),publicClient.getBlock({blockNumber:BigInt(match[1]! )})]);
    if(chain!==robinhoodChain.id||block.hash!==match[2])throw new V1TransactionError('stale_snapshot','The trade quote changed. Review a new quote before signing.');
    return expected;
  }
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
    window.setTimeout(() => { if (!hasActiveOperations()) void refreshCurrentPage(); }, 0);
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
const {default: v1Abis_OfficialStockRegistryV1} = await import('./v1/generated/contracts/legacy/OfficialStockRegistryV1.ts');

  if (!bindings) throw new Error("Canonical Factory bindings are unavailable");
  const [rawAsset, minimum] = await Promise.all([
    publicClient.readContract({ abi: v1Abis_OfficialStockRegistryV1, address: bindings.officialStockRegistry, functionName: "asset", args: [config.id] }),
    publicClient.readContract({ abi: v1Abis_OfficialStockRegistryV1, address: bindings.officialStockRegistry, functionName: "minimumAllocation", args: [config.id] }),
  ]);
  return assertCanonicalAssetBinding(config, rawAsset, minimum);
}

const verifiedMarketRuntime = new Map<string, ReturnType<typeof assertCanonicalFactoryBindings>>();
const verifiedMarketReleases = new Map<string, MarketRelease>();
async function readWalletMarket(address: Address, marketId: Hex, blockNumber?: bigint) {
  const result=await publicClient.call({to:address,data:encodeFunctionData({abi:legacyMarketRecordAbi,functionName:'market',args:[marketId]}),...(blockNumber===undefined?{}:{blockNumber})});
  if(!result.data)throw Error('Market record unavailable');return decodeMarketRecord(result.data);
}

export type VerifiedMarketFeeConfig = Readonly<{ burnMemeFees: boolean; stakingEnabled: boolean; creatorFeesToHolders: boolean; creatorTaxBps: number; creatorRevenueBeneficiaryAtCreation: Address }>;
const verifiedMarketFeeConfigs = new Map<string, VerifiedMarketFeeConfig>();
function marketRelease(id: string): MarketRelease {
  const value = verifiedMarketReleases.get(id);
  if (!value) throw new Error("Market release has not been verified");
  return value;
}
const stakeMarketIdentityChecks=new Set<string>();
async function ensureCanonicalMarket(market: MarketReadModel,displayRead=false): Promise<void> {
 const identity=JSON.stringify([robinhoodChain.id,runtimeConfig.releaseCatalog,market.marketId,market.memeToken,market.assetUid,market.gauge,market.quoteAsset,market.curve,market.launchPhase,market.burnMemeFees,market.tickerGardenBaselineId,market.quoteAssetConfigId,market.sourceVersion,market.poolId,market.poolKey,market.canonicalRoute]);
 if(displayRead&&stakeMarketIdentityChecks.has(identity)&&verifiedMarketRuntime.has(market.marketId)&&verifiedMarketReleases.has(market.marketId))return;
const {default: v1Abis_TickerMemeTokenV1} = await import('./v1/generated/contracts/legacy/TickerMemeTokenV1.ts');
const {default: v1Abis_MarketRegistryV1} = await import('./v1/generated/contracts/legacy/MarketRegistryV1.ts');
const {default: v1Abis_TreasuryDistributorV1} = await import('./v1/generated/contracts/legacy/TreasuryDistributorV1.ts');
const {default: v1Abis_TickerGardenMemeHook} = await import('./v1/generated/contracts/legacy/TickerGardenMemeHook.ts');
const {default: v1Abis_TickerGardenFactoryV1} = await import('./v1/generated/contracts/legacy/TickerGardenFactoryV1.ts');

  if (!foundation?.bindings) await verifyTransactionFoundation();
  if (!foundation?.bindings || !runtimeConfig.contracts.available) throw new Error("Canonical Factory bindings are unavailable");
  const c = runtimeConfig.contracts.value;
  const token = canonicalAddress(market.memeToken, "Market token");
  const [factory, distributor] = await Promise.all([
    publicClient.readContract({ abi: v1Abis_TickerMemeTokenV1, address: token, functionName: "factory" }),
    readHolderDistributor(token),
  ]);
  const catalog = [...runtimeConfig.releaseCatalog];
  if (factory.toLowerCase() === c.factoryAddress && !catalog.some(r => r.chainId === robinhoodChain.id && r.factory.toLowerCase() === c.factoryAddress)) {
    const record = await readWalletMarket(foundation.bindings.marketRegistry, market.marketId);
    const hook = canonicalAddress(tupleString(tupleField(record, "config", 0), "graduatedHook", 13), "Market hook");
    catalog.push({releaseId: "configured-current", chainId: robinhoodChain.id, factory: c.factoryAddress,
      marketRegistry: foundation.bindings.marketRegistry, hook, feeVault: c.protocolFeeVaultAddress,
      creatorRegistry: c.creatorRevenueRegistryAddress, holderDistributor: c.treasuryDistributorAddress,
      launchRouter: c.launchRouterAddress, allocationManager: c.allocationManagerAddress});
  }
  const release = resolveMarketRelease(catalog, { chainId: robinhoodChain.id, token: { factory } }).release;
  if (distributor.toLowerCase() !== release.holderDistributor) throw new Error("Token reward distributor does not match release");
  const [rawMarket, rawRoute, registryFactory, distributorRegistry, hookVault] = await Promise.all([
    readWalletMarket(release.marketRegistry, market.marketId),
    publicClient.call({to:release.marketRegistry,data:encodeFunctionData({abi:coreMarketRouteAbi,functionName:"canonicalRoute",args:[market.marketId]})}).then(result=>decodeCoreMarketRoute(result.data??"0x")),
    publicClient.readContract({ abi: v1Abis_MarketRegistryV1, address: release.marketRegistry, functionName: "factory" }),
    publicClient.readContract({ abi: v1Abis_TreasuryDistributorV1, address: release.holderDistributor, functionName: "marketRegistry" }),
    publicClient.readContract({ abi: v1Abis_TickerGardenMemeHook, address: release.hook, functionName: "protocolFeeVault" }),
  ]);
  resolveMarketRelease(catalog, { chainId: robinhoodChain.id, token: {factory, hook: canonicalAddress(tupleString(tupleField(rawMarket, "config", 0), "graduatedHook", 13), "Market hook")},
    marketRegistry: {factory: registryFactory}, distributor: {marketRegistry: distributorRegistry}, hook: {feeVault: hookVault} });
  const [runtime, creator, holders] = await Promise.all([
    publicClient.readContract({abi: v1Abis_TickerGardenFactoryV1, address: release.factory, functionName: "runtimeBindings"}),
    publicClient.readContract({abi: v1Abis_TickerGardenFactoryV1, address: release.factory, functionName: "creatorRevenueRegistry"}),
    readHolderDistributor(release.factory),
  ]);
  const bindings = assertCanonicalFactoryBindings(runtime, {launchRouter: release.launchRouter, allocationManager: release.allocationManager, protocolFeeVault: release.feeVault});
  if (bindings.marketRegistry !== release.marketRegistry || creator.toLowerCase() !== release.creatorRegistry || holders.toLowerCase() !== release.holderDistributor) throw new Error("Factory runtime does not match market release");
  assertCanonicalMarketBinding(market, rawMarket, rawRoute);
  if ((market.burnMemeFees ?? false) !== rawMarket.config.burnMemeFees) throw Error("Market token fee burn setting differs from the displayed setting");
  verifiedMarketFeeConfigs.set(market.marketId, {
    burnMemeFees: rawMarket.config.burnMemeFees,
    stakingEnabled: rawMarket.config.stakingEnabled,
    creatorFeesToHolders: rawMarket.config.creatorFeesToHolders,
    creatorTaxBps: rawMarket.config.creatorTaxBps,
    creatorRevenueBeneficiaryAtCreation: canonicalAddress(rawMarket.config.creatorRevenueBeneficiaryAtCreation, "Creator beneficiary"),
  });
  verifiedMarketRuntime.set(market.marketId, bindings);
  verifiedMarketReleases.set(market.marketId, release);
  stakeMarketIdentityChecks.add(identity);
}

async function ensureCanonicalLaunch(selected: SelectedLaunchConfig): Promise<void> {
const {default: v1Abis_OfficialStockRegistryV1} = await import('./v1/generated/contracts/legacy/OfficialStockRegistryV1.ts');
const {default: v1Abis_ApprovedQuoteRegistry} = await import('./v1/generated/contracts/legacy/ApprovedQuoteRegistry.ts');
const {default: v1Abis_TickerGardenBaselineRegistry} = await import('./v1/generated/contracts/legacy/TickerGardenBaselineRegistry.ts');
const {default: v1Abis_LaunchTemplateRegistry} = await import('./v1/generated/contracts/legacy/LaunchTemplateRegistry.ts');

  await verifyTransactionFoundation();
  if (!foundation?.bindings) throw new Error("Canonical Factory bindings are unavailable");
  const [asset, quote, baseline, template] = await Promise.all([
    selected.stakingEnabled !== false ? publicClient.readContract({ abi: v1Abis_OfficialStockRegistryV1, address: foundation.bindings.officialStockRegistry, functionName: "asset", args: [selected.asset!.assetUid] }) : Promise.resolve(null),
    publicClient.readContract({ abi: v1Abis_ApprovedQuoteRegistry, address: foundation.bindings.approvedQuoteRegistry, functionName: "quoteConfig", args: [selected.quote.configId] }),
    publicClient.readContract({ abi: v1Abis_TickerGardenBaselineRegistry, address: foundation.bindings.tickerGardenBaselineRegistry, functionName: "baseline", args: [selected.baseline.baselineId] }),
    publicClient.readContract({ abi: v1Abis_LaunchTemplateRegistry, address: foundation.bindings.launchTemplateRegistry, functionName: "launchTemplate", args: [selected.template.templateId] }),
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
  scope?: TransactionScope;
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
  activeOperations.set(input.operationKey,input.scope??transactionScopeForOperation(input.operationKey));
  refreshActionAvailability();
  try {
    return await activeWallet.executor.execute({
      operationKey: input.operationKey,
      ...(input.scope ? { scope: input.scope } : {}),
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
      },
    });
  } finally {
    activeOperations.delete(input.operationKey);
    renderRecoveryControls();
    refreshActionAvailability();
  }
}

function confirmFlowAction(message: string, options:{title?:string;confirmLabel?:string;content?:HTMLElement;className?:string}={}): Promise<boolean> {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog'); dialog.className = 'flow-confirm';
    dialog.setAttribute('aria-label', options.title ?? 'Confirm action');
    const heading = document.createElement('h2'); heading.textContent = options.title ?? 'Confirm action';
    const description = options.content ?? document.createElement('p');
    if (!options.content) { description.textContent = message; description.style.whiteSpace='pre-line'; }
    else dialog.classList.add(options.className ?? 'launch-confirm');
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

function unstakeConfirmationContent(state:RewardPositionState):HTMLElement {
  const copy=unstakeConfirmationCopy({
    principal:formatTokenAmount(state.allocated,state.asset.tokenDecimals),
    assetSymbol:stockSymbol(state.assetConfig),
    marketSymbol:state.metadata.symbol,
  });
  const content=document.createElement('div');content.className='unstake-confirm-content';
  const intro=document.createElement('p');intro.className='unstake-confirm-intro';intro.textContent=copy.intro;
  const effects=document.createElement('ul');effects.className='unstake-confirm-effects';
  const icons=['ph-wallet','ph-chart-line-down','ph-gift'];
  copy.effects.forEach((effect,index)=>{const item=document.createElement('li');const icon=document.createElement('i');icon.className=`ph ${icons[index]}`;icon.setAttribute('aria-hidden','true');const label=document.createElement('span');label.textContent=effect;item.append(icon,label);effects.append(item);});
  const note=document.createElement('p');note.className='unstake-confirm-note';note.textContent=copy.note;
  content.append(intro,effects,note);return content;
}

const tradeTxStatus=createTradeTransactionStatus(robinhoodChain.blockExplorers.default.url);
let tradeSubmitting=false;
let tradeSubmittingMarketId:string|undefined;
let tradeSubmittingLabel='Preparing…';
let tradeAwaitingConfirmation=false;
let stakeSubmitting=false;
let stakeSubmittingLabel='Preparing Stake…';
const transactionUpdates=new Map<string,TransactionUpdate>();
const transactionUpdateDismissals=new Map<string,ReturnType<typeof setTimeout>>();
function dismissTransactionUpdate(operationKey:string):void{
  const timer=transactionUpdateDismissals.get(operationKey);if(timer)clearTimeout(timer);
  transactionUpdateDismissals.delete(operationKey);transactionUpdates.delete(operationKey);renderTransactionUpdates();
}
function renderTransactionUpdates():void{
  let panel=query<HTMLElement>('[data-transaction-progress]');
  const page=currentPage();
  const visible=[...transactionUpdates.values()].filter(update=>{
    const scope=transactionScopeForOperation(update.operationKey);
    return pendingTransactionPage(update.operationKey)===page&&scope.businessType!=='trade'&&page!=='create';
  }).slice(-4);
  if(!visible.length){panel?.remove();return;}
  const noticeRegion=globalNoticeRegion();
  if(!panel){panel=document.createElement('section');panel.dataset.transactionProgress='';panel.className='transaction-progress-list';panel.setAttribute('aria-label','Transaction updates');}
  if(panel.parentElement!==noticeRegion)noticeRegion.append(panel);
  panel.replaceChildren();
  for(const update of visible){
    const row=document.createElement('article');row.className='status-notice transaction-progress-item';row.dataset.operationKey=update.operationKey;row.dataset.state=update.stage;row.setAttribute('role','status');row.setAttribute('aria-live',update.stage==='failed'?'assertive':'polite');
    const icon=document.createElement('i');icon.className=`ph ${update.stage==='confirmed'?'ph-check-circle':update.stage==='failed'?'ph-warning-circle':['submitted','pending','replaced','confirming','approval_submitted'].includes(update.stage)?'ph-spinner-gap trade-tx-spinner':'ph-info'}`;icon.setAttribute('aria-hidden','true');
    const content=document.createElement('div');content.className='transaction-progress-item__content';
    const status=document.createElement('strong');status.textContent=transactionStageLabels[update.stage];
    const note=document.createElement('span');note.textContent=update.error?publicError(update.error,'transaction'):update.replacementReason?`Replacement: ${update.replacementReason}.`:update.stage==='confirmed'?'Balances are refreshing.':update.hash?'Waiting for confirmation.':'Review the request in your wallet.';
    content.append(status,note);
    if(update.hash){const link=document.createElement('a');link.href=`${robinhoodChain.blockExplorers.default.url}/tx/${update.hash}`;link.target='_blank';link.rel='noopener noreferrer';link.textContent='View transaction';content.append(link);}
    const close=document.createElement('button');close.type='button';close.className='status-notice__close';close.setAttribute('aria-label','Dismiss transaction update');close.innerHTML='<i class="ph ph-x" aria-hidden="true"></i>';close.onclick=()=>dismissTransactionUpdate(update.operationKey);
    row.append(icon,content,close);
    panel.append(row);
  }
}
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
  transactionUpdates.delete(update.operationKey);transactionUpdates.set(update.operationKey,update);
  const previousTimer=transactionUpdateDismissals.get(update.operationKey);if(previousTimer)clearTimeout(previousTimer);
  transactionUpdateDismissals.delete(update.operationKey);
  if(['confirmed','failed'].includes(update.stage))transactionUpdateDismissals.set(update.operationKey,setTimeout(()=>dismissTransactionUpdate(update.operationKey),30_000));
  renderTransactionUpdates();
  const scope=transactionScopeForOperation(update.operationKey);
  if(stakeSubmitting&&scope.businessType==='stake'&&scope.marketId===rewardPosition?.detail.market.marketId){
    const progress=stakeProgress(update.stage);stakeSubmittingLabel=progress.label;
    renderStakeSubmit();return;
  }
  if(currentPage()==='staking'&&pendingTransactionPage(update.operationKey)==='staking')return;
  if(scope.businessType==='trade'&&scope.marketId===tradeMarket?.market.marketId){
    tradeSubmittingLabel=['awaiting_signature','awaiting_approval_signature'].includes(update.stage)?'Confirm In Wallet…':['submitted','pending','replaced','approval_submitted'].includes(update.stage)?'Confirming…':update.stage==='confirmed'?'Confirmed':'Processing…';
    if(update.hash&&['submitted','pending','replaced','approval_submitted'].includes(update.stage))tradeAwaitingConfirmation=true;
    if(['confirmed','failed'].includes(update.stage))tradeAwaitingConfirmation=false;
    tradeTxStatus.update(update,tradeMetadata?{side:tradeSide,symbol:tradeMetadata.symbol,inputSymbol:tradeSide==='buy'?tradeMetadata.quoteSymbol:tradeMetadata.symbol}:undefined);updateTradeAvailability();return;
  }
  if (launchProgress) return;
}

function receiptEvent(
  receipt: Pick<TransactionReceipt, "logs">,
  address: Address,
  abi: readonly unknown[],
  eventName: string,
  predicate: (args: Record<string, unknown>) => boolean,
): Record<string, unknown> {
  const expectedAddress=address.toLowerCase();
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== expectedAddress) continue;
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
  renderShell(currentPage(), robinhoodChain.name);
  const header = required<HTMLElement>("[data-shell-header]");
  walletPicker ??= createWalletPicker({ connect: connectWallet, restore: restoreWallet, disconnect: disconnectWallet, account: () => wallet?.account ?? null });
  required<HTMLButtonElement>("[data-wallet]").addEventListener("click", () => {
    if (hasActiveOperations()) { notify("Wait for the current transaction before changing wallets.", "warning"); return; }
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
  notify("Wallet account or chain changed. Reconnect before signing.", "warning");
}

function installWallet(provider: InjectedProvider, account: Address): void {
  const walletClient = createWalletClient({ account, chain: robinhoodChain, transport: custom(provider) });
  const executor = new V1TransactionExecutor({
    publicClient: (integrationBootstrapPath ? {...publicClient,waitForTransactionReceipt: ({hash}: {hash: Hex})=>directReceipt(hash=>publicClient.getTransactionReceipt({hash}),hash)} : publicClient) as unknown as V1TransactionClients["publicClient"],
    walletClient: walletClient as unknown as V1TransactionClients["walletClient"],
  });
  stopWalletAccountSync?.();stopWalletAccountSync=undefined;
  wallet = { account, provider, executor };
  const installed = wallet;
  invalidateWalletReads();
  stopWalletAccountSync=watchWalletAccount(provider,robinhoodChain.id,{
    invalidate(){wallet=null;stopTransactionObservation?.();invalidateWalletReads();renderWallet();},
    update(account){installWallet(provider,canonicalAddress(account,'Wallet account'));},
    disconnect:invalidateWallet,
  });
  renderWallet();
  refreshCurrentPage();
  void (async()=>{
    try {
      const settled=await installed.executor.reconcileSettledPending(installed.account,{verify:result=>verifyRecoveredStakeReceipt(result,installed.account)});
      if(!settled.length||wallet!==installed)return;
      if(settled.some(r=>r.pending.businessType==='trade')){const {reconcileConversionJournal}=await import('./trade/conversion.ts');reconcileConversionJournal(localStorage,installed.account,settled);}
      if(wallet!==installed)return;
      settled.forEach(result=>{
        directMarkets?.receipt(result.receipt);
        showTransactionUpdate({operationKey:result.pending.operationKey,hash:result.receipt.transactionHash,stage:result.receipt.status==='success'&&!result.cancelled?'confirmed':'failed'});
      });
      await refreshCurrentPage(true);
    } catch { /* A failed receipt probe keeps the journal lock for explicit recovery. */ }
  })();
}

async function restoreWallet(provider: InjectedProvider, current: () => boolean): Promise<void> {
  const raw = await authorizedWalletAccount(provider, robinhoodChain.id);
  if (!raw || !current() || wallet || walletConnecting || hasActiveOperations()) return;
  installWallet(provider, canonicalAddress(raw, "Wallet account"));
}

async function connectWallet(provider: InjectedProvider, reportStatus: (message: string) => void = () => {}): Promise<void> {
  if (walletConnecting || hasActiveOperations()) throw new Error("Finish the current wallet operation first.");
  walletConnecting = true;
  refreshActionAvailability();
  try {
    await ensureWalletChain(provider, robinhoodChain, reportStatus);
    const rawAccounts = await provider.request({ method: "eth_requestAccounts" });
    const account = canonicalAddress(String(Array.isArray(rawAccounts) ? rawAccounts[0] ?? "" : ""), "Wallet account");
    installWallet(provider, account);
    notify(`Wallet connected — ${shortHex(account)}`, "success");
  } catch (error) {
    notify(publicError(error), "error");
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
  notify("Wallet disconnected locally", "neutral");
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
    if (!market.identity) throw new Error('Finalized token identity is not available');
    const {name, symbol, metadataURI, deployedAt} = market.identity;
    if (market.quoteAsset === ZERO_ADDRESS) return Object.freeze({ name, symbol, metadataURI, deployedAt, quoteSymbol: "ETH", quoteDecimals: 18 });
    const quoteAsset = canonicalAddress(market.quoteAsset, "Quote token");
    if (quoteConfig.values.quoteAsset !== quoteAsset) throw new Error("Quote asset drifted from the finalized configuration");
    const quoteSymbol = quoteConfig.values.symbol;
    const quoteDecimals = quoteConfig.values.quoteDecimals;
    if (typeof quoteSymbol !== "string" || !/^[A-Z0-9][A-Z0-9._-]{0,15}$/.test(quoteSymbol)) throw new Error("Quote symbol is unavailable");
    if (typeof quoteDecimals !== "number" || !Number.isInteger(quoteDecimals)) throw new Error("Quote decimals are unavailable");
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
    locked.textContent = "Markets are temporarily unavailable. We’ll keep trying in the background.";
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
 return new TickerGardenV1Client(runtimeConfig.readApi.value,(input,init)=>fetch(input,{...init,signal})).listMarkets({...params,includeRecent:true});
});
const exploreCreatedAt=new Map<string,string>();
export type ExploreStat={marketId:string;memeToken?:string;quoteAsset?:string;sourceVersion?:number;sourceBlockNumber?:string;sourceBlockHash?:string;metrics?:MarketReadModel['metrics'];lastBuy?:MarketReadModel['lastBuy'];market?:MarketReadModel;observedAt:number;launchPhase?:string};
let exploreStatistics:Record<string,ExploreStat>={};
let exploreStatisticsAt=0;
let exploreStatisticsKey="";
let explorePendingListRefresh=false;
const exploreVisibleRows:{0:readonly MarketReadModel[];1:readonly MarketReadModel[]}={0:[],1:[]};
let exploreEvents:EventSource|undefined,exploreEventRefreshTimer:number|undefined;
const exploreDirtyIds=new Set<string>(),exploreDirtyRegions=new Set<string>();
let exploreStatisticsRequest:Promise<boolean>|null=null;
const explorePendingDirtyIds=new Set<string>();let explorePendingFullRefresh=false;
let exploreStatisticsFailed=false;
const exploreVisiblePage:{0:number;1:number}={0:1,1:1};
const exploreFrozenRows=new Map<string,MarketReadModel[]>();
async function refreshExploreStatistics():Promise<boolean>{return refreshExploreCards();}
async function refreshExploreCards(dirtyIds?:readonly string[]):Promise<boolean>{
 if(!foundation||!runtimeConfig.readApi.available)return false;
 if(exploreStatisticsRequest){if(dirtyIds)for(const id of dirtyIds)explorePendingDirtyIds.add(id);else explorePendingFullRefresh=true;return exploreStatisticsRequest;}
 const visible=[...new Set([...exploreVisibleRows[0],...exploreVisibleRows[1]].map(m=>m.marketId))].sort();
 const markets=dirtyIds?visible.filter(id=>dirtyIds.includes(id)):visible;
 if(markets.length===0)return false;
 const requestKey=markets.join(","),visibleKey=visible.join(','),pageGeneration=`${explorePageGeneration[0]}:${explorePageGeneration[1]}`;
 const statisticsBase=runtimeConfig.readApi.value;
 exploreStatisticsRequest=(async()=>{
  const returned:MarketReadModel[]=[];
  for(let i=0;i<Math.max(markets.length,1);i+=100){
   const url=new URL('/v1/explore/cards',statisticsBase);url.searchParams.set('markets',markets.slice(i,i+100).join(','));
   const response=await fetch(url,{signal:AbortSignal.timeout(15_000)});if(!response.ok)throw Error('Statistics unavailable');
   const data=await response.json() as {chainId?:number;displayOnly?:boolean;items?:MarketReadModel[]};if(data.chainId!==robinhoodChain.id||data.displayOnly!==true||!Array.isArray(data.items))throw Error('Invalid Explore cards response');
   returned.push(...data.items);
  }
  const currentVisible=[...new Set([...exploreVisibleRows[0],...exploreVisibleRows[1]].map(m=>m.marketId))].sort().join(',');
  if(currentPage()!=='markets')return false;
  const reconciled=reconcileVisibleCards({visibleIdsAtRequest:visible,visibleIdsNow:currentVisible.split(',').filter(Boolean),generationAtRequest:pageGeneration,generationNow:`${explorePageGeneration[0]}:${explorePageGeneration[1]}`,requestedIds:markets,returned,previous:exploreStatistics,full:!dirtyIds,toStat:market=>({marketId:market.marketId,memeToken:market.memeToken,quoteAsset:market.quoteAsset,sourceVersion:market.sourceVersion,metrics:market.metrics,lastBuy:market.lastBuy,market,observedAt:Date.now()/1000,launchPhase:String(market.launchPhase)})});
  if(!reconciled)return false;
  const merged=reconciled.stats;
  for(const id of reconciled.missing){for(const phase of [0,1] as const){if(!exploreVisibleRows[phase].some(m=>m.marketId===id))continue;exploreVisibleRows[phase]=exploreVisibleRows[phase].filter(m=>m.marketId!==id);explorePagers[phase].removeMarkets(new Set([id]));text(`[data-stage-count="${phase}"]`,String(exploreVisibleRows[phase].length));}query<HTMLElement>(`[data-runtime-market="${id}"]`)?.remove();}
  const ranking=(items:Record<string,ExploreStat>)=>JSON.stringify(Object.keys(items).sort().map(id=>[id,items[id]!.metrics,items[id]!.observedAt,items[id]!.sourceVersion,items[id]!.lastBuy]));
  exploreStatisticsFailed=false;
  const changed=ranking(merged)!==ranking(exploreStatistics);exploreStatistics=merged;exploreStatisticsAt=Date.now();exploreStatisticsKey=requestKey;return changed;
 })().catch(()=>{exploreStatisticsFailed=true;return false;}).finally(()=>{exploreStatisticsRequest=null;const visibleNow=[...new Set([...exploreVisibleRows[0],...exploreVisibleRows[1]].map(m=>m.marketId))].sort().join(',');if(explorePendingDirtyIds.size||explorePendingFullRefresh){const pending=[...explorePendingDirtyIds];explorePendingDirtyIds.clear();const full=explorePendingFullRefresh;explorePendingFullRefresh=false;if(currentPage()==='markets')void refreshExploreCards(full?undefined:pending).then(()=>applyExploreStatistics(full?undefined:pending));}else if(currentPage()==='markets'&&visibleNow!==visibleKey)void refreshExploreStatistics().then(()=>applyExploreStatistics());if(explorePendingListRefresh){explorePendingListRefresh=false;if(currentPage()==='markets')void refreshExploreRankings(true);}});
 return exploreStatisticsRequest;
}

class ExploreResponseError extends Error { readonly status?:number; constructor(message:string,status?:number){super(message);this.status=status;} }
async function fetchExplorePage(params:DirectoryQuery,cursor:string|undefined,limit:number,signal:AbortSignal){
 if(!foundation)throw Error('Market Directory Unavailable');
 const {revision:_,...unversioned}=params;
 let page:MarketPage;
 if(foundation.direct){
  await refreshDirectDirectory(false);
  if(signal.aborted||!foundation?.direct)throw Error('Market Directory Unavailable');
  page={...pageDirectExplore(foundation.markets,unversioned,cursor,limit),sync:foundation.sync};
 }else{
  if(!runtimeConfig.readApi.available)throw Error('Market Directory Unavailable');
  const url=new URL('/v1/explore',runtimeConfig.readApi.value);url.searchParams.set('launchPhase',String(params.launchPhase));url.searchParams.set('sort',String(params.sort??'createdAt_desc'));url.searchParams.set('limit',String(limit));if(params.search)url.searchParams.set('search',params.search);if(params.assetUid)url.searchParams.set('assetUid',params.assetUid);if(cursor)url.searchParams.set('cursor',cursor);
  const response=await fetch(url,{signal});if(!response.ok)throw new ExploreResponseError('Explore page unavailable',response.status);page=await response.json();
 }
 try{
  if(!foundation.direct&&(page.sync?.chainId!==robinhoodChain.id||typeof page.sync?.revision!=='string'))throw Error('Invalid Explore sync head');
  if(!Array.isArray(page.items)||page.items.some(m=>m.launchPhase!==params.launchPhase))throw Error('Unexpected Market Stage');
 }catch{throw new ExploreResponseError('Market response failed verification');}
 return page;
}
function marketBloomProgress(market:MarketReadModel):number|null {
 const target=foundation?.quotes.find(config=>config.id===market.quoteAssetConfigId)?.values.graduationThreshold;
 const raised=market.curveProgress.realQuoteReserve;
 return typeof target==='string'&&/^[0-9]+$/.test(target)&&/^[0-9]+$/.test(raised)
  ? graduationProgress(BigInt(raised),BigInt(target)) : null;
}
function applyExploreStatistics(dirtyIds?:readonly string[]):void {
 reconcileExploreStages(dirtyIds);
 for(const market of [...exploreVisibleRows[0],...exploreVisibleRows[1]]){
  if(dirtyIds&&!dirtyIds.includes(market.marketId))continue;
  const stat=exploreStatistics[market.marketId];
  const card=query<HTMLElement>(`[data-runtime-market="${market.marketId}"]`);if(!card)continue;
  const valid=stat&&stat.memeToken===market.memeToken&&stat.quoteAsset===market.quoteAsset&&stat.sourceVersion===market.sourceVersion&&stat.launchPhase===String(market.launchPhase);
  const freshness=query<HTMLElement>('[data-market-freshness]',card);
  if(freshness){freshness.hidden=!exploreStatisticsFailed&&Boolean(valid);freshness.textContent=exploreStatisticsFailed?'Updates delayed':valid?'':'Updating…';}
  if(!valid)continue;
  text('[data-market-cap]',formatMarketUSD(stat.metrics?.marketCapUsd,true,2),card);
  text('[data-market-volume]',formatMarketUSD(stat.metrics?.volume24hUsd),card);
  const latest=stat.market??market;if(latest.launchPhase===0){const progress=marketBloomProgress(latest),area=query<HTMLElement>('[data-market-progress]',card),bar=area?.querySelector<HTMLProgressElement>('progress');if(bar){bar.value=progress??0;bar.hidden=progress===null;}text('[data-market-progress-label]',progress===null?'-':`${progress.toFixed(2)}%`,area??undefined);if(area)area.title=progress===null?'Bloom Progress Pending':`${progress.toFixed(2)}% To Bloom`;}
  const cap=query<HTMLElement>('[data-market-cap]',card);if(cap)cap.title=`USD estimate · Updated ${new Date(stat.observedAt*1000).toLocaleString()}`;
 }
}
export type ExploreRanking=import('./v1/generated/read-api.ts').MarketPage['ranking'];
const exploreRankings:{0:ExploreRanking;1:ExploreRanking}={0:undefined,1:undefined};
let exploreRecentHead='',exploreLiveGeneration=0,exploreLiveRequest:AbortController|null=null,exploreLastCapCheck=0;
function exploreQuery(phase:0|1):DirectoryQuery{
 const selected=query<HTMLElement>('[data-growing-sort][aria-pressed="true"]')?.dataset.growingSort;
 const stock=query<HTMLSelectElement>('[data-market-asset]')?.value,search=query<HTMLInputElement>('[data-market-search]')?.value.trim();
 return {revision:foundation!.sync.revision,launchPhase:phase,sort:phase===1?'marketCapUsd_desc':(selected??'createdAt_desc') as DirectoryQuery['sort'],...(search?{search}:{}),...(stock?{assetUid:canonicalBytes32(stock,'Stock')}: {})};
}
async function refreshExploreRankings(forceFirstPages=false):Promise<void>{
 if(!foundation||foundation.direct||currentPage()!=='markets')return;
 if(exploreLiveRequest){if(forceFirstPages)explorePendingListRefresh=true;return;}
 const capDue=Date.now()-exploreLastCapCheck>=30_000;
 const phases=([0,1] as const).filter(phase=>forceFirstPages?exploreVisiblePage[phase]===1:exploreQuery(phase).sort==='recentBuy_desc'||(capDue&&exploreQuery(phase).sort==='marketCapUsd_desc'&&exploreVisiblePage[phase]===1));
 if(!phases.length)return;
 if(capDue)exploreLastCapCheck=Date.now();
 const controller=new AbortController(),generation=exploreLiveGeneration;exploreLiveRequest=controller;
 const timeout=setTimeout(()=>controller.abort(),8000);
 try{for(const phase of phases){
  const params=exploreQuery(phase),key=JSON.stringify({...params,revision:undefined});
  const page=await fetchExplorePage(params,undefined,phase===0?40:10,controller.signal);
  if(controller.signal.aborted||generation!==exploreLiveGeneration||currentPage()!=='markets'||key!==JSON.stringify({...exploreQuery(phase),revision:undefined}))continue;
  const head=JSON.stringify(page.items.map(m=>[m.marketId,m.lastBuy]));
  const recent=params.sort==='recentBuy_desc';
  const visibleHead=JSON.stringify(exploreVisibleRows[phase].map(m=>[m.marketId,m.lastBuy]));
  const changed=recent?head!==visibleHead:page.ranking?.version!==exploreRankings[phase]?.version||page.ranking?.stale!==exploreRankings[phase]?.stale||page.items.map(m=>m.marketId).join(',')!==exploreVisibleRows[phase].map(m=>m.marketId).join(',');
  if(!changed){if(recent)exploreRecentHead=head;continue;}
  const grid=query<HTMLElement>(`[data-stage-grid="${phase}"]`);
  const interacting=!!grid?.matches(':hover')||!!grid?.contains(document.activeElement)||grid?.getAttribute('aria-busy')==='true';
  if(exploreVisiblePage[phase]>1||interacting){if(recent&&head!==exploreRecentHead){const button=query<HTMLButtonElement>('[data-new-buys]');if(button)button.hidden=false;}continue;}
  if(explorePagers[phase].adoptFirstPage(params,page)){if(recent){exploreRecentHead=head;const button=query<HTMLButtonElement>('[data-new-buys]');if(button)button.hidden=true;}await renderExploreStage(phase);}
 }}catch{/* Existing rows and timestamps remain visible until the next successful read. */}
 finally{clearTimeout(timeout);if(exploreLiveRequest===controller)exploreLiveRequest=null;if(explorePendingListRefresh){explorePendingListRefresh=false;if(currentPage()==='markets')void refreshExploreRankings(true);}}
}
function reconcileExploreStages(dirtyIds?:readonly string[]):void{
 for(const phase of [0,1] as const){
  const removed=new Set(exploreVisibleRows[phase].filter(m=>{if(dirtyIds&&!dirtyIds.includes(m.marketId))return false;const stat=exploreStatistics[m.marketId];return stat&&stat.memeToken===m.memeToken&&stat.quoteAsset===m.quoteAsset&&['0','1'].includes(stat.launchPhase??'')&&stat.launchPhase!==String(phase);}).map(m=>m.marketId));
  if(!removed.size)continue;explorePagers[phase].removeMarkets(removed);exploreVisibleRows[phase]=exploreVisibleRows[phase].filter(m=>!removed.has(m.marketId));
  for(const id of removed)query<HTMLElement>(`[data-runtime-market="${id}"]`)?.remove();
  text(`[data-stage-count="${phase}"]`,String(exploreVisibleRows[phase].length));exploreLastCapCheck=0;
 }
}
let explorePagers={0:createExplorePager<MarketReadModel>(40,fetchExplorePage),1:createExplorePager<MarketReadModel>(10,fetchExplorePage)};
const explorePageGeneration={0:0,1:0};
const exploreRenderedPages={0:"",1:""};
function resetExplorePages(){exploreLiveGeneration++;exploreLiveRequest?.abort();exploreLiveRequest=null;exploreRecentHead="";exploreRankings[0]=undefined;exploreRankings[1]=undefined;exploreFrozenRows.clear();explorePagers[0].reset();explorePagers[1].reset();explorePageGeneration[0]++;explorePageGeneration[1]++;}
function clearMarketDirectoryView(resetPages=true):void {
 exploreRenderedPages[0]="";exploreRenderedPages[1]="";
 if(resetPages)resetExplorePages();
 exploreVisibleRows[0]=[];exploreVisibleRows[1]=[];
 const list=query<HTMLElement>("[data-market-list]");if(!list)return;
 list.querySelectorAll("[data-runtime-market]").forEach(item=>item.remove());
 list.setAttribute("aria-busy","false");
 for(const selector of ["[data-market-loading]","[data-market-empty]"]){const item=query<HTMLElement>(selector,list);if(item)item.hidden=true;}
 const locked=query<HTMLElement>("[data-market-locked]",list);if(locked){locked.hidden=true;locked.textContent="Markets are temporarily unavailable. We’ll keep trying in the background.";}
 const more=query<HTMLButtonElement>("[data-market-query-more]");if(more)more.hidden=true;
 const badge=query<HTMLElement>(".hero-badge span");if(badge)badge.textContent="Waiting for current market data";
}
function pauseExploreView():void {
 // Public cards remain a labelled last-successful snapshot; transaction state
 // is still invalidated separately while the backend is unavailable.
 for(const phase of [0,1] as const){explorePagers[phase].pause();explorePageGeneration[phase]++;}
 const list=query<HTMLElement>('[data-market-list]');if(!list)return;
 list.setAttribute('aria-busy','false');
 list.querySelectorAll<HTMLElement>('[data-stage-grid]').forEach(grid=>grid.setAttribute('aria-busy','false'));
 list.querySelectorAll<HTMLButtonElement>('[data-stage-prev],[data-stage-next],[data-stage-page] button').forEach(button=>button.disabled=true);
 const hasCards=!!list.querySelector('[data-runtime-market]');
 if(!hasCards)clearMarketDirectoryView(false);
 setPageStatus(hasCards?'Market updates unavailable. Showing the last loaded list. Reconnecting…':'Markets are temporarily unavailable. Reconnecting…','warning');
}
let marketPhaseFilter = "bloomed";

async function loadMarketStockSymbols(): Promise<void> {
  if (!runtimeConfig.readApi.available) return;
  try {
    await assetPrices.refresh(); const response = assetPrices.snapshot();
    const next = new Map<string, string>();
    for (const reference of Object.values(response.prices)) next.set(reference.token, reference.symbol);
    marketStockSymbols = next;
    if (currentPage() === "markets") void renderMarkets();
  } catch { /* The address-based STOCK catalog remains usable without display metadata. */ }
}

export type ExploreIdentity={name:string;symbol:string;metadataURI:string;deployedAt:string};
let exploreStockPicker:ReturnType<typeof setupExploreStockPicker>|undefined;
let exploreDirectorySnapshot:readonly MarketReadModel[]|undefined;
const exploreIdentities=new Map<string,ExploreIdentity>();
const exploreIdentityRequests=new Map<string,Promise<ExploreIdentity>>();
function exploreIdentity(market:MarketReadModel):Promise<ExploreIdentity>{
 if(market.identity)return Promise.resolve(market.identity);
 return Promise.reject(new Error('Finalized token identity is not available'));
}

const exploreQueryCache=new Map<string,typeof explorePagers>();
function exploreQueryKey(){const p=new URL(location.href).searchParams;return JSON.stringify([p.get('search')??'',p.get('stock')??'',p.get('sort')??'createdAt_desc']);}
function saveExploreQuery(){
 const u=new URL(location.href),search=query<HTMLInputElement>('[data-market-search]')?.value.trim()??'',stock=query<HTMLSelectElement>('[data-market-asset]')?.value??'',sort=query<HTMLElement>('[data-growing-sort][aria-pressed="true"]')?.dataset.growingSort??'createdAt_desc';
 for(const [key,value]of [['search',search],['stock',stock],['sort',sort==='createdAt_desc'?'':sort]] as const){if(value)u.searchParams.set(key,value);else u.searchParams.delete(key);}
 router.replaceLocation(u.href);
}
function selectExploreCache(){
 const key=exploreQueryKey(),cached=exploreQueryCache.get(key);
 explorePagers[0].pause();explorePagers[1].pause();explorePageGeneration[0]++;explorePageGeneration[1]++;
 if(cached)explorePagers=cached;
 else {explorePagers={0:createExplorePager<MarketReadModel>(40,fetchExplorePage),1:createExplorePager<MarketReadModel>(10,fetchExplorePage)};exploreQueryCache.set(key,explorePagers);if(exploreQueryCache.size>8){const oldest=exploreQueryCache.keys().next().value!;const evicted=exploreQueryCache.get(oldest)!;evicted[0].pause();evicted[1].pause();exploreQueryCache.delete(oldest);}}
}
function setupMarkets(): void {
 const params=new URL(location.href).searchParams;
 const input=query<HTMLInputElement>('[data-market-search]');if(input)input.value=params.get('search')??'';
 const requestedSort=params.get('sort');const selected=['createdAt_desc','createdAt_asc','marketCapUsd_desc','recentBuy_desc'].includes(requestedSort??'')?requestedSort:'createdAt_desc';
 queryAll<HTMLButtonElement>('[data-growing-sort]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.growingSort===selected)));
 selectExploreCache();

  query<HTMLButtonElement>('[data-new-buys]')?.addEventListener('click',()=>{explorePagers[0].reset();exploreVisiblePage[0]=1;exploreRecentHead='';const button=query<HTMLButtonElement>('[data-new-buys]');if(button)button.hidden=true;void renderExploreStage(0);});
  let searchTimer:number|undefined;
  for(const selector of ['[data-market-search]','[data-market-stock-search]'])query<HTMLInputElement>(selector)?.addEventListener('input',()=>{window.clearTimeout(searchTimer);searchTimer=window.setTimeout(()=>{if(currentPage()==='markets'){saveExploreQuery();selectExploreCache();void renderMarkets();}},250);});
  query<HTMLButtonElement>('[data-market-reset]')?.addEventListener('click',()=>{
    window.clearTimeout(searchTimer);
    for(const selector of ['[data-market-search]','[data-market-stock-search]','[data-market-asset]']){const input=query<HTMLInputElement|HTMLSelectElement>(selector);if(input)input.value='';}
    queryAll<HTMLButtonElement>('[data-growing-sort]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.growingSort==='createdAt_desc')));
    saveExploreQuery();selectExploreCache();void renderMarkets();
  });
  query<HTMLSelectElement>("[data-market-asset]")?.addEventListener("change", () => {saveExploreQuery();selectExploreCache();void renderMarkets(); });
  queryAll<HTMLButtonElement>('[data-growing-sort]').forEach(button=>button.addEventListener('click',()=>{
   if(button.getAttribute('aria-pressed')==='true')return;
   queryAll<HTMLButtonElement>('[data-growing-sort]').forEach(option=>option.setAttribute('aria-pressed',String(option===button)));
   saveExploreQuery();selectExploreCache();void renderExploreStage(0);
  }));
  for(const phase of [0,1] as const){query<HTMLButtonElement>(`[data-stage-prev="${phase}"]`)?.addEventListener('click',()=>{void renderExploreStage(phase,'previous');});query<HTMLButtonElement>(`[data-stage-next="${phase}"]`)?.addEventListener('click',()=>{void renderExploreStage(phase,'next');});}
  void loadMarketStockSymbols();
}

async function renderMarkets(phases:readonly (0|1)[]=[1,0]):Promise<void>{
 // Updated bootstrap rows may change without a revision in direct builds.
 // Refresh only the first page; later cursor pages retain their publication.
 if(foundation?.direct&&exploreDirectorySnapshot!==foundation.markets){
  exploreDirectorySnapshot=foundation.markets;
  for(const phase of [0,1] as const)if(exploreVisiblePage[phase]===1)explorePagers[phase].refreshFirstPage();
 }

 const list=query<HTMLElement>('[data-market-list]');if(!list)return;
 if(!foundation){if(foundationError)pauseExploreView();else setPageStatus('Loading markets…');return;}
 const select=required<HTMLSelectElement>('[data-market-asset]');
 const options=[{value:'',symbol:'All Stocks',name:'',logo:undefined as string|undefined},...foundation.assets.map(asset=>({value:asset.id,symbol:stockSymbol(asset),name:stakingAssetForConfig(robinhoodChain.id,asset)?.name??stockToken(asset)??'',logo:stockLogo(asset)}))];
 if(exploreStockPicker)exploreStockPicker.update(options);else {
 exploreStockPicker=setupExploreStockPicker(select,options);
 const stock=new URL(location.href).searchParams.get('stock');if(stock&&options.some(o=>o.value===stock)){select.value=stock;exploreStockPicker.update(options);}
 }
 const search=query<HTMLInputElement>('[data-market-search]')?.value.trim()??'';
 const reset=query<HTMLButtonElement>('[data-market-reset]');if(reset)reset.hidden=!search&&!select.value;
 for(const key of ['loading','empty','locked']){const node=query<HTMLElement>(`[data-market-${key}]`);if(node)node.hidden=true;}
 setPageStatus('');
 await Promise.all(phases.map(phase=>renderExploreStage(phase,'current',false)));
 void refreshExploreStatistics().then(()=>{if(currentPage()==='markets')applyExploreStatistics();});

}
function syncExploreStatus():void {
 const grids=queryAll<HTMLElement>('[data-stage-grid]');
 const states=grids.map(grid=>grid.dataset.loadState??'loading');
 const hasCards=grids.some(grid=>!!grid.querySelector('[data-runtime-market]'));
 if(states.includes('loading')){setPageStatus(hasCards?'Updating markets…':'Loading markets…');return;}
 if(states.includes('error')){
  setPageStatus(hasCards?'Some markets could not be updated. Showing the last loaded list.':'Markets could not be loaded. Try again.','warning');
  const target=query<HTMLElement>('[data-page-status]');
  const retry=document.createElement('button');retry.type='button';retry.className='secondary-button';retry.dataset.pageRetry='';retry.textContent='Try again';
  retry.onclick=()=>{for(const phase of [0,1] as const)if(query<HTMLElement>(`[data-stage-grid="${phase}"]`)?.dataset.loadState==='error')void renderExploreStage(phase);};
  target?.insertAdjacentElement('afterend',retry);return;
 }
 const filtered=!!query<HTMLInputElement>('[data-market-search]')?.value.trim()||!!query<HTMLSelectElement>('[data-market-asset]')?.value;
 setPageStatus(hasCards?'':filtered?'No matching tokens. Try another search or clear your filters.':'No tokens yet. New markets will appear here.');
}
async function renderExploreStage(phase:0|1,direction:'current'|'next'|'previous'|number='current',refreshMetrics=true):Promise<void>{
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
 empty?.querySelector('[data-stage-retry]')?.remove();
 if(previous)previous.disabled=true;if(next)next.disabled=true;grid.setAttribute('aria-busy','true');grid.dataset.loadState='loading';syncExploreStatus();
 try{
  const page=await explorePagers[phase].load(params,direction);
  if(!page||generation!==explorePageGeneration[phase]||!grid.isConnected)return;
  exploreVisiblePage[phase]=page.page;
  exploreRankings[phase]=page.ranking;
  if(phase===0){const button=query<HTMLButtonElement>('[data-new-buys]');if(sort!=='recentBuy_desc'&&button)button.hidden=true;if(sort==='recentBuy_desc'&&page.page===1)exploreRecentHead=JSON.stringify(page.items.map(m=>[m.marketId,m.lastBuy]));}
  if(page.recovered)setPageStatus('The market list has updated. Showing the first page.');
  const filtered=page.items;grid.dataset.loadState=filtered.length?'ready':'empty';
  exploreVisibleRows[phase]=filtered;
  const renderedKey=JSON.stringify(page);
  if(exploreRenderedPages[phase]===renderedKey&&grid.querySelector('[data-runtime-market]')){
   if(empty)empty.hidden=true;
   applyExploreStatistics();
   queryAll<HTMLButtonElement>(`[data-stage-page="${phase}"] button`).forEach(button=>button.disabled=false);
   if(previous)previous.disabled=!page.hasPrevious;if(next)next.disabled=!page.hasNext;return;
  }
  grid.querySelectorAll('[data-runtime-market]').forEach(node=>node.remove());
  text(`[data-stage-count="${phase}"]`,String(filtered.length));
  if(empty){empty.hidden=filtered.length>0;empty.textContent=directDirectoryBusy&&current.direct?'Loading markets…':search||asset?'No matching tokens':phase===1?'No Bloomed tokens yet':'No Growing tokens yet';}
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
      const image=document.createElement('img');image.alt='';image.loading=grid.querySelectorAll('[data-runtime-market]').length<4?'eager':'lazy';image.decoding='async';
      const fallback=new URL('../assets/token-placeholder.svg',import.meta.url).href;
      const imageArea=required<HTMLElement>('.explore-card-image',fragment);
      const loading=required<HTMLElement>('[data-market-image-loading]',fragment);
      const finish=()=>{loading.hidden=true;imageArea.setAttribute('aria-busy','false');};
      image.onload=finish;
      image.onerror=()=>{if(image.src!==fallback){image.src=fallback;}else{finish();}};
      const showImage=(url:string)=>{image.src=url;if(image.complete&&image.naturalWidth>0)finish();};
      if(market.content)showImage(resolveExploreImageURI(market.content.imageURI,import.meta.env.VITE_IPFS_GATEWAY)??fallback);
      mark.append(image);
      void exploreIdentity(market).then(async identity=>{
        if(!card.isConnected)return;
        text('[data-market-name]',identity.name,card);text('[data-market-symbol]',`$${identity.symbol}`,card);
        cardLink.setAttribute('aria-label',`View ${identity.name}`);
        const age=query<HTMLTimeElement>('[data-market-age]',card);if(age){age.textContent=tokenAge(identity.deployedAt);const at=new Date(Number(identity.deployedAt)*1000);if(Number.isFinite(at.getTime())){age.dateTime=at.toISOString();age.title=at.toLocaleString();}}
        const detail=market.content?null:await readDetailMetadata(identity.metadataURI,launchMetadataOrigin,AbortSignal.timeout(8000),import.meta.env.VITE_IPFS_GATEWAY);
        if(card.isConnected&&!market.content)showImage(detail?.image||fallback);
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
      const progress = marketBloomProgress(market);
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
  exploreRenderedPages[phase]=renderedKey;
  if(refreshMetrics)void refreshExploreStatistics().then(()=>{if(currentPage()==='markets')applyExploreStatistics();});
 }catch(error){if(generation===explorePageGeneration[phase]){grid.dataset.loadState='error';if(empty){empty.hidden=false;empty.textContent=(error instanceof ExploreResponseError?'Market data could not be verified.':'We couldn’t load these markets.')+(grid.querySelector('[data-runtime-market]')?' Showing the last loaded list.':'');const retry=document.createElement('button');retry.type='button';retry.dataset.stageRetry=String(phase);retry.textContent='Try again';retry.setAttribute('aria-label',`Try loading ${phase===1?'Bloomed':'Growing'} markets again`);retry.onclick=()=>{void renderExploreStage(phase,direction);};empty.append(retry);}if(previous)previous.disabled=wasPreviousDisabled;if(next)next.disabled=wasNextDisabled;}}
 finally{if(generation===explorePageGeneration[phase]){grid.setAttribute('aria-busy','false');syncExploreStatus();}}
}

function statsAsset(address:string):{label:string;icon?:string}{return statsController?.statsAsset(address)??{label:shortHex(address)};}
function clearStatsSnapshotView(message:string):void{statsController?.clearStatsSnapshotView(message);}
function setupStats():void{statsController?.setupStats();}
function applyStatsSnapshot():void{statsController?.applyStatsSnapshot();}
function renderStats(force=false):Promise<void>{return statsController?.renderStats(force)??Promise.resolve();}

export type TradeQuote = Readonly<{
  conversion?: ConversionQuote;
  side: "buy" | "sell";
  marketId: Hex;
  input: bigint;
  output: bigint;
  spent: bigint | null;
  refund: bigint | null;
  fee: bigint | null;
  impactBps?: bigint;
  impactEstimated?: boolean;
  poolProtocolPips?: number;
  feeInMeme?: boolean;
  feeEstimated?: boolean;
  minimum: bigint;
  revision: string;
  expiresAtMs: number;
  transactionDeadline?: bigint;
}>;

let tradeMarket: MarketDetailResponse | null = null;
let tradeMetadata: MarketMetadata | null = null;
const tradeTokenLogoFallback = new URL('../assets/token-placeholder.svg',import.meta.url).href;
let tradeMemeLogoUrl = tradeTokenLogoFallback;
let tradeMarketVerified = false;
let tradeSide: "buy" | "sell" = "buy";
let tradeQuote: TradeQuote | null = null;
export type CurvePricing={marketId:string;blockNumber:bigint;timestamp:bigint;quoteReserve:bigint;tokenReserve:bigint;baseBps:bigint;taxBps:bigint;at:number};
let curvePricing:CurvePricing|null=null;
let curvePricingPending: {marketId:string;promise:Promise<CurvePricing>}|null=null;


const poolQuoteBindings=new Map<string,Promise<{manager:Address;taxBps:number}>>();


let tradeLoadGeneration = 0;
let tradeQuoteGeneration = 0;
let tradeQuoteTimer = 0;
let tradeQuoteExpiryTimer = 0;
let tradePhaseTimer = 0;
let tradePhaseLoading = false;

function setupTrade(): void { if(!tradeController)return; return tradeController!.setupTrade(); }

const overviewLoads=new Map<string,number>();


let tradeStakeAccount:Address|undefined;
let tradeStakeGeneration=0;
const tradeStakeTotals=new Map<string,{at:number;value:bigint}>();
const tradeStakeTotalRequests=new Map<string,Promise<bigint>>();
async function refreshTradeStake():Promise<void>{ await ensureTradeController(); return tradeController!.refreshTradeStake(); }





function clearTradeMarketState(): void { if(!tradeController)return; return tradeController!.clearTradeMarketState(); }




function renderDetailBalances():void{ if(!tradeController)return; return tradeController!.renderDetailBalances(); }
async function loadDetailBalances(preserve=true):Promise<void>{ await ensureTradeController(); return tradeController!.loadDetailBalances(preserve); }
function retryMissingDetailBalances():void{ if(!tradeController)return; return tradeController!.retryMissingDetailBalances(); }
window.addEventListener('online',retryMissingDetailBalances);
document.addEventListener('visibilitychange',retryMissingDetailBalances);

let tradeLoadingTimeout:ReturnType<typeof setTimeout>|undefined;
function setTradePageLoading(loading:boolean):void{ if(!tradeController)return; return tradeController!.setTradePageLoading(loading); }
async function loadTradeMarket(explicit?: string): Promise<void> { await ensureTradeController(); return tradeController!.loadTradeMarket(explicit); }





let tradeAutoRefreshPending=false;
async function refreshTradeQuote():Promise<void>{ await ensureTradeController(); return tradeController!.refreshTradeQuote(); }
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){window.clearTimeout(tradeQuoteExpiryTimer);return;}
  if(currentPage()==='trade'&&tradeQuote){
    window.clearTimeout(tradeQuoteExpiryTimer);
    tradeQuoteExpiryTimer=window.setTimeout(()=>{void refreshTradeQuote();},Math.max(0,tradeQuote.expiresAtMs-Date.now()));
  }
});













function updateTradeAvailability(): void { if(!tradeController)return; return tradeController!.updateTradeAvailability(); }

let recentTradeLoading=false;
let recentTradeLoadedAt=0;
const poolTradeCursors=new Map<string,bigint>();



let tradeFieldsGeneration=0;
async function refreshTradeFields(fresh?:MarketDetailResponse,background=false):Promise<void>{ await ensureTradeController(); return tradeController!.refreshTradeFields(fresh,background); }
function completeTradeDisplay(market:MarketDetailResponse):void{ if(!tradeController)return; return tradeController!.completeTradeDisplay(market); }





export type LaunchPreview = Readonly<{
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
function drawLaunchProgress():void{ if(!createController)return; return createController!.drawLaunchProgress(); }
function updateLaunchProgress(phase:LaunchPhase,detail:string):void{ if(!createController)return; return createController!.updateLaunchProgress(phase,detail); }



async function restoreLaunchProgress():Promise<void>{ if(!createController){try{if(!localStorage.getItem(launchStateKey(robinhoodChain.id)))return;}catch{/* The controller renders the existing recovery error. */}} await ensureCreateController(); return createController!.restoreLaunchProgress(); }
window.addEventListener('storage',event=>{
 if(event.key!==launchStateKey(robinhoodChain.id)||launchSubmitting)return;
 if(event.newValue){try{
  const completed=readLaunchState({getItem:()=>event.newValue},robinhoodChain.id);
  if(completed?.phase==='complete'&&completed.expected){launchProgress=completed;void ensureCreateController().then(()=>drawLaunchProgress());return;}
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

function renderDeveloperBuyBalance(): void { if(!createController)return; return createController!.renderDeveloperBuyBalance(); }






function populateSelect(select: HTMLSelectElement, items: readonly ConfigReadModel[], placeholder: string): void {
  const prior = select.value;
  select.replaceChildren(new Option(placeholder, ""));
  select.options[0]!.disabled = true;
  items.forEach((item) => select.add(new Option(configLabel(item), item.id)));
  if (items.some((item) => item.id === prior)) select.value = prior;
  else if (items[0]) select.value = items[0].id;
}




let pendingCreateDraft: CreateDraft | null = null;
let draftImageMissing = false;



function setupCreate(): void { if(!createController)return; return createController!.setupCreate(); }



function renderCreateConfig(): void { if(!createController)return; return createController!.renderCreateConfig(); }

















function updateCreateAvailability(): void { if(!createController)return; return createController!.updateCreateAvailability(); }

// RH public replay: 8m fails while 16m succeeds for the complete atomic launch.
const CONSERVATIVE_LAUNCH_GAS = robinhoodChain.id === 46630 ? 16_000_000n : 3_000_000n;







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
  scope?: TransactionScope,
): Promise<void> {
  if (wallet !== activeWallet) throw new Error("Wallet changed before approval");
  const requiredApproval = await allowanceApproval(approval, token, spender, amount, activeWallet.account);
  if (!requiredApproval) return;
  if(launchSubmitting)updateLaunchProgress("approval","Approve the paired asset in your wallet. This is not the token launch.");
  const operationKey=scope?.marketId&&scope.conflictKey===`trade:${scope.marketId}`
    ? `pool-approval:${scope.marketId}:${token}:${spender}:${amount}:${sync.revision}`
    : scope?.marketId&&scope.conflictKey===`launch:${scope.marketId}`
      ? `launch:approval:${scope.marketId}:${token}:${spender}:${amount}:${sync.revision}`
      : `approval:${token}:${spender}:${amount}:${sync.revision}`;
  await executeTransaction({
    operationKey,
    ...(scope ? { scope } : {}),
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




export type RewardPositionState = Readonly<{
  observedBlock: bigint;
  observedBlockHash: Hex;
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

export type CreatorRewardState = Readonly<{
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
  pendingQuote?:bigint;
  memeAsset: Address;
  now: bigint;
}>;

export type TreasuryRewardState = Readonly<{
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

export type DirectEscapeState = Readonly<{
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
let snapshotReward: Readonly<{page:HolderSnapshotPage; market:MarketReadModel; metadata:MarketMetadata}> | null = null;
const snapshotReceiptClaims = new Map<string,{mask:number;block:bigint}>();
function snapshotReceiptKey(id:SnapshotIdentity,round:bigint):string {return `${id.chainId}:${id.distributor.toLowerCase()}:${id.marketId}:${id.account.toLowerCase()}:${round}`;}
let snapshotRewardRequest: AbortController | null = null;
let snapshotRewardStatus = "";
let continuousReward: Readonly<{ marketId: Hex; mode: Hex; quote: Address; account: Address; claimable: bigint; memeClaimable: bigint }> | null = null;
let directEscape: DirectEscapeState | null = null;
let rewardLoadGeneration = 0;
let creatorLoadGeneration = 0;
let treasuryLoadGeneration = 0;
let directEscapeLoadGeneration = 0;
let directEscapeRefreshTimer = 0;

const treasuryStatusLabels = ["Not scheduled", "Preparing rewards", "Confirming rewards", "Ready to claim", "Moved to the next period"] as const;

const rewardMarketLabels = new Map<string, { label: string; search: string; symbol?:string }>();

// Display values survive transport failures; market events invalidate only this selection.
export type StakeStats = {title:string;description:string;quoteSymbol:string;phase:string;volume:string;fees:string;total:string;totalRaw:bigint|null;status:string};
const stakeStatsCache = new Map<string,{at:number;data:StakeStats}>();
const stakeStatsRequests = createInvalidatedRead<string,StakeStats>();
let stakeStatsGeneration = 0;
let stakePageListeners:AbortController|undefined;
let stakeStatisticsWatcher:{stop():void}|undefined;
let stakeStatisticsWatchMarket='';
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
function stockLogo(config:ConfigReadModel):string|undefined {const asset=stakingAssetForConfig(robinhoodChain.id,config);return asset?(assetLogoUrl(asset.logo)??asset.logoUrl??quoteIconUrl(stockSymbol(config))):quoteIconUrl(stockSymbol(config));}
async function refreshStakeStatistics(force=false):Promise<void>{
const {explorerStakeStatistics} = await import('./v1/stakeStatistics.ts');

  if(currentPage()!=='staking'||document.hidden)return;
  const generation=++stakeStatsGeneration;
  const id=query<HTMLSelectElement>('[data-position-market]')?.value;
  const market=foundation?.markets.find(m=>m.marketId===id);
  const watchChanged=stakeStatisticsWatchMarket!==(market?.marketId??'');
  if(stakeStatisticsWatchMarket!==(market?.marketId??'')){
    stakeStatisticsWatcher?.stop();stakeStatisticsWatcher=undefined;stakeStatisticsWatchMarket=market?.marketId??'';
    if(market&&runtimeConfig.readApi.available)stakeStatisticsWatcher=watchMarketChanges(runtimeConfig.readApi.value,market.marketId,async regions=>{if(regions.some(region=>['staking','statistics','fees','market'].includes(region))){if(regions.includes('market')&&readApi){try{const page=await readApi.getMarketPageBootstrap({marketId:market.marketId});if(foundation&&page.sync.chainId===robinhoodChain.id&&page.market.marketId===market.marketId)foundation=Object.freeze({...foundation,markets:foundation.markets.map(m=>m.marketId===market.marketId?page.market:m)});}catch{/* Existing public data remains usable. */}}await refreshStakeStatistics(true);if(rewardPosition&&rewardPosition.detail.market.marketId===market.marketId)void loadStakeRewardHistory(rewardPosition,true);if(regions.includes('staking'))void refreshRewardPosition(true);}});
  }
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
    stakeText('[data-stake-stats-status]',market?'Loading market activity…':'Select a market to view activity.');
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
    const previous=stakeStatsCache.get(market.marketId)?.data;
    const data:StakeStats={title:metadata.symbol,description:metadata.name,quoteSymbol:metadata.quoteSymbol,phase:phaseLabel(market.launchPhase),volume:previous?.volume??'-',fees:previous?.fees??'-',total:previous?.total??'-',totalRaw:previous?.totalRaw??null,status:'Market activity is unavailable. Your position is still available.'};
    const results=await Promise.allSettled([
      (async()=>{
        if(!runtimeConfig.readApi.available)throw Error('Analytics unavailable');
        if(!runtimeConfig.contracts.available)throw Error('Market configuration unavailable');
        return explorerStakeStatistics({chainId:robinhoodChain.id,apiBase:runtimeConfig.readApi.value,market,decimals:metadata.quoteDecimals,feeVault:runtimeConfig.contracts.value.protocolFeeVaultAddress},true);
      })()
    ]);
    const analytics=results[0];
    if(analytics.status==='fulfilled'){
      const stats=analytics.value;
      data.volume=stats.volume!==''?`${displayDecimal(stats.volume)} ${metadata.quoteSymbol}`:'-';
      if(stats.fees)data.fees=stats.fees.size?[...stats.fees].map(([asset,amount])=>{
        if(asset!==market.quoteAsset.toLowerCase()&&asset!==market.memeToken.toLowerCase())throw Error('Unexpected fee asset');
        return `${formatTokenAmount(amount,asset===market.quoteAsset.toLowerCase()?metadata.quoteDecimals:18)} ${asset===market.quoteAsset.toLowerCase()?metadata.quoteSymbol:metadata.symbol}`;
      }).join('\n'):`0 ${metadata.quoteSymbol}`;
      else data.fees='-';
      data.status='Market activity updates when confirmed data changes.';
    }
    // Prefer the confirmed display total from this statistics response. The
    // foundation value remains a DB-backed fallback for older API responses.
    const totalRaw=analytics.status==='fulfilled'
      ? analytics.value.totalStakedRaw===undefined?market.display?.totalStakedRaw:analytics.value.totalStakedRaw
      : previous?.totalRaw?.toString();
    if(analytics.status==='fulfilled'&&analytics.value.totalStakedRaw===null){data.total='-';data.totalRaw=null;}
    if(config&&typeof totalRaw==='string'&&/^(0|[1-9][0-9]*)$/.test(totalRaw)){
      const decimals=Number(config.values.tokenDecimals);
      if(Number.isInteger(decimals)&&decimals>=0&&decimals<=18){const total=BigInt(totalRaw);data.total=`${formatTokenAmount(total,decimals)} ${stockSymbol(config)}`;data.totalRaw=total;}
    }
    return data;
  };
  try{
    let cached=stakeStatsCache.get(market.marketId);
    if(force||watchChanged||!cached){
      cached={at:Date.now(),data:await stakeStatsRequests.read(market.marketId,load,{invalidate:force})};stakeStatsCache.set(market.marketId,cached);
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
  }catch{if(generation===stakeStatsGeneration)stakeText('[data-stake-stats-status]','Market activity is unavailable. Try again.');}
}

export type StakeDirectoryRow={marketId:string;assetUid:string;label:string;active:boolean};
let stakeDirectoryAccount='';
let stakeDirectoryAt=0;
let stakeDirectoryGeneration=0;
let stakeDirectoryBusy=false;
let stakeDirectPortfolioVerified=false;
let stakeDirectoryFailed=false;
let stakeMarketOpened=false;
let stakePositionsPage:PositionPage|undefined;
let stakeActivityPage:UserActivityPage|undefined;
const stakePositionIds=new Set<string>();
const stakeDirectoryRows=new Map<string,StakeDirectoryRow>();
const stakeMarketIcons=new Map<string,string>();
const stakeMarketIconRequests=new Set<string>();
function renderStakePortfolioEmpty():void{
  const empty=query<HTMLElement>('[data-stake-portfolio-empty]');if(!empty)return;
  const marketOpen=stakeMarketIsOpen(!!query<HTMLSelectElement>('[data-position-market]')?.value,stakeMarketOpened);
  const hasActive=[...stakeDirectoryRows.values()].some(row=>row.active);
  const verified=(!!stakePositionsPage&&!stakePositionsPage.nextCursor)||(!!foundation?.direct&&stakeDirectPortfolioVerified);
  const mode=stakePortfolioMode({walletConnected:!!wallet,busy:stakeDirectoryBusy,verified,failed:stakeDirectoryFailed,hasActive,marketOpen});
  const show=mode!=='content';
  const stakePage=query<HTMLElement>(".staking-page");if(stakePage)stakePage.dataset.walletConnected=String(!!wallet);
  empty.dataset.state=mode;empty.hidden=!show;empty.toggleAttribute('aria-busy',mode==='checking');
  query<HTMLElement>('.staking-page .market-card')?.toggleAttribute('hidden',show);
  query<HTMLElement>('.staking-page .position-card')?.toggleAttribute('hidden',show);
  const copy={
    connect:{eyebrow:'Your staking portfolio',title:'Connect your wallet',body:'Connect your wallet to view your stakes and available rewards.',icon:'ph-wallet',action:'Connect wallet'},
    checking:{eyebrow:'Your staking portfolio',title:'Checking your stakes…',body:'Reading your current staking positions.',icon:'ph-circle-notch',action:''},
    unavailable:{eyebrow:'Your staking portfolio',title:'Unable to load your stakes',body:'Your staking positions could not be verified. Try again.',icon:'ph-warning-circle',action:'Try again'},
    empty:{eyebrow:'Your staking portfolio',title:'No active stakes yet',body:'Choose a market and stake its paired Stock asset to start earning a share of trading fees.',icon:'ph-plant',action:'Find a market'},
    content:{eyebrow:'',title:'',body:'',icon:'ph-plant',action:''},
  }[mode];
  stakeText('[data-stake-empty-eyebrow]',copy.eyebrow);stakeText('[data-stake-empty-title]',copy.title);stakeText('[data-stake-empty-copy]',copy.body);
  const icon=query<HTMLElement>('[data-stake-empty-icon]');if(icon)icon.className=`ph ${copy.icon}`;
  const steps=query<HTMLElement>('[data-stake-empty-steps]');if(steps)steps.hidden=mode!=='empty';
  const action=query<HTMLButtonElement>('[data-stake-empty-action]');if(action){action.hidden=!copy.action;const label=action.querySelector('span');if(label)label.textContent=copy.action;const actionIcon=action.querySelector('i');if(actionIcon)actionIcon.className=`ph ${mode==='connect'?'ph-wallet':mode==='unavailable'?'ph-arrow-clockwise':'ph-magnifying-glass'}`;}
}
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
function focusFirstActiveStakeMarket():boolean{
  if(currentPage()!=='staking'||!wallet)return false;
  const select=query<HTMLSelectElement>('[data-position-market]');
  if(!select)return false;
  const marketId=firstActiveStakeMarket([...stakeDirectoryRows.values()],select.value);
  if(!marketId)return false;
  if(![...select.options].some(option=>option.value===marketId)){
    router.navigate(`/stake?marketId=${encodeURIComponent(marketId)}#positions`);
    return true;
  }
  select.value=marketId;
  select.dispatchEvent(new Event('change'));
  return true;
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
  const signature=JSON.stringify({account:stakeDirectoryAccount,busy:stakeDirectoryBusy,positionCursor:stakePositionsPage?.nextCursor,activityCursor:stakeActivityPage?.nextCursor,selected:query<HTMLSelectElement>('[data-position-market]')?.value,rows:[...stakeDirectoryRows.values()].map(row=>[row.marketId,row.assetUid,row.active,rewardMarketLabels.get(row.marketId)?.symbol,stakeMarketIcons.get(row.marketId)])});
  if(target.dataset.rendered===signature){renderStakePortfolioEmpty();return;}
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
      stakeMarketOpened=true;
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
  renderStakePortfolioEmpty();
}
async function refreshStakeDirectory(more=false,force=false):Promise<void>{
  if(currentPage()!=='staking')return;
  const account=wallet?.account.toLowerCase()??'';
  if(account!==stakeDirectoryAccount){
    const previousAccount=stakeDirectoryAccount;
    stakeDirectoryAccount=account;stakeDirectoryRows.clear();stakePositionIds.clear();stakePositionsPage=undefined;stakeActivityPage=undefined;stakeDirectoryAt=0;stakeDirectoryBusy=false;stakeDirectPortfolioVerified=false;stakeDirectoryFailed=false;stakeMarketOpened=new URLSearchParams(location.search).get('action')==='add';++stakeDirectoryGeneration;
    if(previousAccount){const select=query<HTMLSelectElement>('[data-position-market]');if(select){select.value='';syncRewardMarketSelections('', 'position');}}
  }
  renderStakeDirectory();
  focusFirstActiveStakeMarket();
  if(!account){stakeText('[data-stake-history-status]','');return;}
  if(stakeDirectoryBusy||(!more&&!force&&Date.now()-stakeDirectoryAt<600000))return;
  const directorySource=stakeDirectorySource({direct:!!foundation?.direct,readApiAvailable:runtimeConfig.readApi.available});
  if(directorySource==='direct'){
    stakeDirectoryBusy=true;stakeDirectoryFailed=false;const generation=++stakeDirectoryGeneration;renderStakeDirectory();
    stakeText('[data-stake-history-status]','Checking local positions…');
    try{
      await refreshDirectDirectory(false);
      if(!foundation?.bindings)await verifyTransactionFoundation();
      const current=foundation;
      const bindings=current?.bindings;
      if(!current||!bindings)throw Error('Canonical staking bindings are unavailable');
      const blockNumber=await publicClient.getBlockNumber();
      const canonicalAssets=new Map<string,Promise<CanonicalAssetBinding>>();
      const assetFor=(assetUid:string)=>{
        let pending=canonicalAssets.get(assetUid);
        if(!pending){pending=ensureCanonicalAsset(findAsset(assetUid),bindings);canonicalAssets.set(assetUid,pending);}
        return pending;
      };
      const rows=await mapConcurrent(current.markets.filter(market=>market.gauge!==ZERO_ADDRESS),async market=>{
const {default: v1Abis_UserStockVault} = await import('./v1/generated/contracts/legacy/UserStockVault.ts');

        try{
          // Vault allocation is the canonical principal ledger. Portfolio discovery
          // must not depend on optional metadata, wallet balances, or reward previews.
          const asset=await assetFor(market.assetUid);
          const allocated=await publicClient.readContract({blockNumber,abi:v1Abis_UserStockVault,address:asset.userStockVault,functionName:'allocation',args:[asset.assetUid,account as Address,market.marketId]});
          return {marketId:market.marketId,assetUid:market.assetUid,allocated};
        }
        catch{return null;}
      },4);
      if(generation!==stakeDirectoryGeneration||wallet?.account.toLowerCase()!==account||currentPage()!=='staking')return;
      const summary=summarizeDirectStakeAllocations(rows);
      stakeDirectoryRows.clear();
      for(const row of summary.active)stakeDirectoryRows.set(row.marketId,{marketId:row.marketId,assetUid:row.assetUid,label:'Staked · live position',active:true});
      stakeDirectPortfolioVerified=summary.verified;
      stakeDirectoryFailed=!summary.verified;
      stakeDirectoryAt=Date.now();
      stakeText('[data-stake-history-status]',stakeDirectPortfolioVerified?'Local positions checked.':'Some local positions could not be verified.');
    }catch{if(generation===stakeDirectoryGeneration){stakeDirectPortfolioVerified=false;stakeDirectoryFailed=true;stakeDirectoryAt=Date.now();}}
    finally{if(generation===stakeDirectoryGeneration){stakeDirectoryBusy=false;renderStakeDirectory();focusFirstActiveStakeMarket();}}
    return;
  }
  if(directorySource==='unavailable'||!runtimeConfig.readApi.available){stakeDirectoryFailed=true;stakeText('[data-stake-history-status]','Recorded history unavailable. You can select a market directly.');renderStakeDirectory();return;}
  stakeDirectoryBusy=true;stakeDirectoryFailed=false;const generation=++stakeDirectoryGeneration;renderStakeDirectory();
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
      for(const p of page.items){const active=BigInt(p.allocated)>0n;stakePositionIds.add(p.marketId);stakeDirectoryRows.set(p.marketId,{marketId:p.marketId,assetUid:p.assetUid,label:active ? 'Staked · indexed position' : 'No active stake · indexed position',active});}
      stakePositionsPage=page;
    }catch{errors.push('Positions unavailable');}}else if(positions.status==='rejected')errors.push('Positions unavailable');
    const activity=results[1];
    if(activity.status==='fulfilled'&&activity.value){try{
      const page=validateUserActivity(activity.value,robinhoodChain.id,account,100,more ? stakeActivityPage : undefined);
      for(const event of page.items){const row=stakeHistoryEvent(event,account);if(row&&!stakeDirectoryRows.has(row.marketId))stakeDirectoryRows.set(row.marketId,{...row,label:row.exited?'Exited · recorded history':'Staked before · recorded history',active:false});}
      stakeActivityPage=page;
    }catch{errors.push('History unavailable');}}else if(activity.status==='rejected')errors.push('History unavailable');
    stakeDirectoryAt=Date.now();
    const coverage=stakeActivityPage ? `Recorded blocks ${stakeActivityPage.indexedFrom}–${stakeActivityPage.sourceBlockNumber}.` : 'Historical coverage unavailable.';
    stakeText('[data-stake-history-status]',[...errors,coverage,(stakeActivityPage?.nextCursor||stakePositionsPage?.nextCursor)?'More records available below.':''].filter(Boolean).join(' '));
    if(rewardPosition)recordLiveStake(rewardPosition);
    stakeDirectoryFailed=errors.length>0&&!stakePositionsPage;
  }catch{if(generation===stakeDirectoryGeneration)stakeDirectoryFailed=true;}
  finally{if(generation===stakeDirectoryGeneration){stakeDirectoryBusy=false;renderStakeDirectory();focusFirstActiveStakeMarket();}}
}
function recordLiveStake(_state:RewardPositionState):void{
  // Live transaction-preparation state must not replace the database directory.
}

function updateStakeSearchIdentity(id:string):void {
  const row=query<HTMLElement>(`[data-stake-search-market="${id}"]`);if(!row)return;
  const symbol=rewardMarketLabels.get(id)?.symbol;
  const label=row.querySelector<HTMLElement>('[data-search-symbol]');if(label&&symbol)label.textContent=symbol;
  const image=row.querySelector<HTMLImageElement>('[data-search-token-icon]');const url=stakeMarketIcons.get(id);
  if(image&&url&&image.getAttribute('src')!==url)image.src=url;
}
const stakeSearchDirectory=createMarketDirectory(async(params,signal)=>{
 if(!runtimeConfig.readApi.available)throw Error('Market search is unavailable');
 const url=new URL('/v1/explore',runtimeConfig.readApi.value);
 for(const [name,value]of Object.entries(params))if(name!=='revision'&&value!==undefined)url.searchParams.set(name,String(value));
 const response=await fetch(url,{signal});if(!response.ok)throw Error('Market search unavailable');
 return response.json();
},30,{displayChainId:robinhoodChain.id});
let stakeSearchPage:import('./v1/generated/read-api.ts').MarketPage|null=null;
let stakeSearchKey='';
let stakeSearchTimer:ReturnType<typeof setTimeout>|undefined;
let stakeSearchGeneration=0;
async function searchStakeDirectory(append=false):Promise<void>{
 const input=query<HTMLInputElement>('[data-position-search]'),results=query<HTMLElement>('[data-stake-search-results]');
 if(!foundation||foundation.direct||!input||!results||results.hidden)return;
 const current=foundation,search=input.value.trim().toLowerCase(),key=JSON.stringify([current.sync.revision,search]),own=++stakeSearchGeneration;
 if(!append&&key===stakeSearchKey&&stakeSearchPage){filterStakeMarkets();return;}
 if(!append){stakeSearchPage=null;stakeSearchKey='';results.textContent='Searching…';}
 try{
  const page=await stakeSearchDirectory.load({revision:current.sync.revision,stakingEnabled:true,sort:'createdAt_desc',...(search?{search}: {})},append);
  if(!page||own!==stakeSearchGeneration||!input.isConnected||currentPage()!=='staking'||input.value.trim().toLowerCase()!==search||foundation?.sync.revision!==current.sync.revision)return;
  if(page.items.some(m=>m.gauge===ZERO_ADDRESS))throw Error('Invalid staking results');
  stakeSearchKey=key;stakeSearchPage=page;
  foundation=Object.freeze({...foundation,markets:[...new Map([...foundation.markets,...page.items].map(m=>[m.marketId,m])).values()]});
  filterStakeMarkets();
 }catch{if(own===stakeSearchGeneration&&results.isConnected){results.textContent='Unable to search markets. ';const retry=document.createElement('button');retry.type='button';retry.textContent='Try again';retry.onclick=()=>void searchStakeDirectory(append);results.append(retry);}}
}
function filterStakeMarkets(): void {
  const select = query<HTMLSelectElement>("[data-position-market]");
  if (!select || !foundation) return;
  const search = query<HTMLInputElement>("[data-position-search]")?.value.trim().toLowerCase() ?? "";
  const previous = select.value;
  const remote=!foundation.direct;
  const source=remote?(stakeSearchKey===JSON.stringify([foundation.sync.revision,search])?stakeSearchPage?.items??[]:[]):foundation.markets;
  const matches = source.filter((market) => market.gauge !== ZERO_ADDRESS && (remote||
    `${rewardMarketLabels.get(market.marketId)?.search ?? ""} ${market.memeToken} ${market.marketId} ${market.assetUid} ${foundation?.assets.find(asset=>asset.id===market.assetUid)?stockSymbol(foundation.assets.find(asset=>asset.id===market.assetUid)!):''}`.toLowerCase().includes(search)));
  const results=query<HTMLElement>('[data-stake-search-results]');
  if(results){
    results.replaceChildren();
    const input=query<HTMLInputElement>('[data-position-search]');
    for(const market of (remote?matches:matches.slice(0,30))){
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
      button.onclick=()=>{stakeMarketOpened=true;if(![...select.options].some(o=>o.value===market.marketId))select.add(new Option(rewardMarketOptionLabel(market),market.marketId));select.value=market.marketId;select.dispatchEvent(new Event('change'));if(input){input.value='';input.setAttribute('aria-expanded','false');input.focus();}results.hidden=true;};
      results.append(button);
    }
    if(!matches.length){const empty=document.createElement('p');empty.textContent=remote&&!stakeSearchPage?'Search markets by name, symbol or address':'No matching markets';results.append(empty);}
    if(remote&&stakeSearchPage?.nextCursor){const more=document.createElement('button');more.type='button';more.textContent='Load more markets';more.onclick=()=>{more.disabled=true;void searchStakeDirectory(true);};results.append(more);}
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
    ? `Expected unlock: ${new Date(Date.now() + 24 * 3600_000).toLocaleString('en-US', {year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false})}`
    : 'Expected unlock: —');
  const after=rewardPosition ? stakeAfter(rewardPosition.allocated,validStakeAmount()) : null;
  stakeText('[data-stake-modal-after]',after===null ? '-' : `${formatTokenAmount(after,rewardPosition!.asset.tokenDecimals)} ${stockSymbol(rewardPosition!.assetConfig)}`);
  const amountField=query<HTMLInputElement>('#stake-amount');
  if(amountField){amountField.disabled=!rewardPosition||currentStakeOperationBusy()||stakeSubmitting;amountField.setCustomValidity('');amountField.removeAttribute('aria-invalid');}
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
      try{const parsed=parseTokenAmount(field.value,state.asset.tokenDecimals,'Amount');amountError=parsed>state.walletBalance?`Insufficient ${symbol}`:state.allocated+parsed<state.asset.minimumAllocation?`Minimum total stake: ${formatTokenAmount(state.asset.minimumAllocation,state.asset.tokenDecimals)} ${symbol}`:'Amount is too large.';}
      catch{amountError=/^0+(?:\.0*)?$/.test(field.value.trim())?'Enter an amount greater than zero.':'Enter a valid amount.';}
    }
  }
  if(field){field.setCustomValidity(amountError);if(amountError)field.setAttribute('aria-invalid','true');}
  query<HTMLElement>('[data-stake-preview]')?.classList.toggle('is-error',!!amountError);
  const open = state.asset.status === 1 && state.detail.market.launchPhase === 1 && state.settlementPrincipal === 0n;
  text("[data-stake-preview]", amountError || (!open
    ? state.detail.market.launchPhase!==1?"Staking Opens After Blooming":"Staking Is Unavailable"
    : amount === null ? `Minimum total stake: ${formatTokenAmount(state.asset.minimumAllocation,state.asset.tokenDecimals)} ${stockSymbol(state.assetConfig)}` : ""));
}

function setupRewards(): void {
  window.clearInterval(stakeCountdownTimer);
  if(currentPage()==='staking')stakeCountdownTimer=window.setInterval(renderStakeCountdown,1000);
  query<HTMLButtonElement>('[data-stake-token-details]')?.addEventListener('click',()=>{
    const id=query<HTMLSelectElement>('[data-position-market]')?.value;
    if(id&&foundation?.markets.some(m=>m.marketId===id))router.navigate(`/trade?marketId=${encodeURIComponent(id)}`);
  });
  query<HTMLButtonElement>('[data-stake-empty-action]')?.addEventListener('click',()=>{
    const mode=query<HTMLElement>('[data-stake-portfolio-empty]')?.dataset.state;
    if(mode==='connect'){query<HTMLButtonElement>('[data-wallet]')?.click();return;}
    if(mode==='unavailable'){void refreshStakeDirectory(false,true);return;}
    const search=query<HTMLInputElement>('[data-position-search]');
    search?.focus();search?.dispatchEvent(new Event('input',{bubbles:true}));
  });
  if(currentPage()==='staking'){
    stakePageListeners=new AbortController();
    document.addEventListener('visibilitychange',()=>{if(!document.hidden){void refreshActiveReward();void refreshStakeDirectory();}},{signal:stakePageListeners.signal});
  }
  const dialog=query<HTMLDialogElement>('[data-stake-dialog]');
  query<HTMLButtonElement>('[data-open-stake]')?.addEventListener('click',()=>{if(!wallet){query<HTMLButtonElement>('[data-wallet]')?.click();return;}if(!rewardPosition)return;updateStakePreview();updateRewardsAvailability();dialog?.showModal();});
  queryAll<HTMLButtonElement>('[data-close-stake]').forEach(button=>button.addEventListener('click',()=>{if(!currentStakeOperationBusy()&&!stakeSubmitting)dialog?.close();}));
  dialog?.addEventListener('cancel',event=>{if(currentStakeOperationBusy()||stakeSubmitting)event.preventDefault();});
  query<HTMLButtonElement>('[data-stake-max]')?.addEventListener('click',()=>{const field=query<HTMLInputElement>('#stake-amount');if(field&&rewardPosition){field.value=formatUnits(rewardPosition.walletBalance,rewardPosition.asset.tokenDecimals);field.dispatchEvent(new Event('input',{bubbles:true}));}});
  query<HTMLButtonElement>('[data-stake-history-more]')?.addEventListener('click',()=>void refreshStakeDirectory(true));
  const marketSearch=query<HTMLInputElement>('[data-position-search]');
  const searchResults=query<HTMLElement>('[data-stake-search-results]');
  const openSearch=()=>{if(searchResults)searchResults.hidden=false;filterStakeMarkets();marketSearch?.setAttribute('aria-expanded','true');clearTimeout(stakeSearchTimer);stakeSearchGeneration++;stakeSearchTimer=setTimeout(()=>void searchStakeDirectory(),250);};
  const closeSearch=()=>{if(searchResults)searchResults.hidden=true;marketSearch?.setAttribute('aria-expanded','false');};
  marketSearch?.addEventListener('input',searchResults?openSearch:filterStakeMarkets);
  if(searchResults){
    marketSearch?.addEventListener('focus',openSearch);
    marketSearch?.addEventListener('keydown',event=>{if(event.key==='Escape')closeSearch();if(event.key==='ArrowDown'){event.preventDefault();openSearch();searchResults.querySelector<HTMLButtonElement>('button')?.focus();}if(event.key==='Enter'){event.preventDefault();searchResults.querySelector<HTMLButtonElement>('button')?.click();}});
    searchResults.addEventListener('keydown',event=>{const buttons=[...searchResults.querySelectorAll<HTMLButtonElement>('button')],index=buttons.indexOf(document.activeElement as HTMLButtonElement);if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();buttons[(index+(event.key==='ArrowDown'?1:buttons.length-1))%buttons.length]?.focus();}if(event.key==='Escape'){marketSearch?.focus();closeSearch();}});
    query<HTMLElement>('.stake-market-search')?.addEventListener('focusout',event=>{if(!event.currentTarget||!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node|null))closeSearch();});
  }
  query<HTMLButtonElement>('[data-creator-more]')?.addEventListener('click',event=>{(event.currentTarget as HTMLButtonElement).disabled=true;void refreshCreatorDirectory(true);});
  query<HTMLButtonElement>('[data-creator-older]')?.addEventListener('click',()=>{void refreshCreatorReward(true);});
  query<HTMLButtonElement>('[data-copy-beneficiary]')?.addEventListener('click', async () => {
    if (!creatorReward) return;
    try { await navigator.clipboard.writeText(creatorReward.beneficiary); notify('Recipient address copied', 'success'); }
    catch { notify('Unable to copy. Select the recipient address instead.', 'warning'); }
  });
  queryAll<HTMLButtonElement>("[data-rewards-connect]").forEach(button=>button.addEventListener("click", () => query<HTMLButtonElement>("[data-wallet]")?.click()));
  query<HTMLDetailsElement>("[data-emergency-recovery]")?.addEventListener("toggle", event => { if ((event.currentTarget as HTMLDetailsElement).open) void refreshDirectEscape(); });
  const stakeAmountField=query<HTMLInputElement>('#stake-amount');
  if(stakeAmountField)bindStakeAmountInput(stakeAmountField,()=>rewardPosition?.asset.tokenDecimals??18,()=>{updateStakePreview();updateRewardsAvailability();});
  stakeAmountField?.addEventListener('invalid',event=>{
    event.preventDefault();
    text('[data-stake-preview]',stakeAmountField.validity.valueMissing?'Enter an amount greater than zero.':stakeAmountField.validationMessage||'Enter a valid amount.');
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
    if (isRewardsPage() && document.visibilityState === "visible" && wallet && foundation) {
      void refreshActiveReward();
      void recoverPendingStake().catch(()=>{});
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
      renderStakeDirectory();
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
    creatorEpochChoices.clear();const epoch = query<HTMLSelectElement>("[data-creator-epoch]"); if (epoch) epoch.value = "";
    syncRewardMarketSelections(marketId, "creator");
    const market = foundation?.markets.find((entry) => entry.marketId === marketId);
    const feeAsset = query<HTMLInputElement>("[data-creator-fee-asset]");
    if (market && feeAsset) feeAsset.value = market.quoteAsset;
    void refreshCreatorReward();
  });
  query<HTMLButtonElement>("[data-creator-current]")?.addEventListener("click", () => { const epoch = query<HTMLSelectElement>("[data-creator-epoch]"); if (epoch) epoch.value = ""; void refreshCreatorReward(); });
  query<HTMLSelectElement>("[data-creator-epoch]")?.addEventListener("change", () => { clearCreatorRewardView(); void refreshCreatorReward(); });
  query<HTMLInputElement>("[data-creator-fee-asset]")?.addEventListener("change", () => { void refreshCreatorReward(); });
  query<HTMLSelectElement>('[data-snapshot-round]')?.addEventListener('change', renderSnapshotRound);
  query<HTMLButtonElement>('[data-snapshot-more]')?.addEventListener('click', () => {
    const state=snapshotReward;
    if(state?.page.nextCursor&&!snapshotRewardRequest) void loadSnapshotReward(state.market,state.page.identity.distributor,treasuryLoadGeneration,state);
  });
  const holderSearch=query<HTMLInputElement>('[data-holder-search]');
  const holderResults=query<HTMLElement>('[data-holder-search-results]');
  let holderSearchTimer:number|undefined;
  holderSearch?.addEventListener('input',()=>{window.clearTimeout(holderSearchTimer);holderSearchRequest?.abort();holderSearchTimer=window.setTimeout(()=>{void renderHolderSearch();},300);});
  holderSearch?.addEventListener('focus',()=>{void renderHolderSearch();});
  holderSearch?.addEventListener('keydown',event=>{
    if(event.key==='Escape'){holderResults?.setAttribute('hidden','');holderSearch.setAttribute('aria-expanded','false');}
    if(event.key==='ArrowDown'){event.preventDefault();holderResults?.querySelector<HTMLButtonElement>('button')?.focus();}
  });
  query<HTMLElement>('.holder-token-search')?.addEventListener('focusout',event=>{if(!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node|null)){holderResults?.setAttribute('hidden','');holderSearch?.setAttribute('aria-expanded','false');}});
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
}

function rewardMarketOptionLabel(market: MarketReadModel): string {
  if(currentPage()==='rewards')return `${rewardMarketLabels.get(market.marketId)?.symbol??'Token'} · ${market.memeToken}`;
  return `${shortHex(market.marketId, 8, 6)} · ${phaseLabel(market.launchPhase)} · ${market.gauge === ZERO_ADDRESS ? "No stock staking" : `STOCK ${shortHex(market.assetUid)}`}`;
}

const holderHistoryCache=new Map<string,{at:number,claimed:bigint}>();
async function loadHolderRewardHistory(marketId:Hex,account:Address,block:bigint,quote:Address,decimals:number,symbol:string,amount:bigint):Promise<void>{
const {DUAL_HOLDER_MODE} = await import('./v1/features/userClaims.ts');

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
   const items=data.items.filter((x:any)=>/^0x[0-9a-f]{64}$/.test(x.marketId)&&/^0x[0-9a-f]{40}$/.test(x.memeToken)&&typeof x.name==='string'&&typeof x.symbol==='string');walletHolderCandidates.set(key,{at:Date.now(),items});
   if(wallet?.account.toLowerCase()===account){
    renderRecentHolderMarkets();
    const select=query<HTMLSelectElement>('[data-treasury-market]'),input=query<HTMLInputElement>('[data-holder-search]'),results=query<HTMLElement>('[data-holder-search-results]');
    if(!select?.value&&items[0]&&input&&results)void selectHolderSearchResult(items[0],input,results);
   }
  }).catch(()=>{walletHolderCandidates.set(key,{at:Date.now(),items:saved?.items??[]});}).finally(()=>walletHolderPending.delete(key));
 }
 const candidates=[...new Map([...recentHolderMarkets(),...(saved?.items??[])].map(x=>[x.marketId,x])).values()];
 for(const item of candidates){const button=document.createElement('button');button.type='button';button.textContent=item.symbol;button.title='Rewards Remain Claimable After Selling';button.addEventListener('click',()=>{const input=query<HTMLInputElement>('[data-holder-search]'),results=query<HTMLElement>('[data-holder-search-results]');if(input&&results)void selectHolderSearchResult(item,input,results);});area.append(button);}
}

let holderSearchRequest:AbortController|undefined;
async function renderHolderSearch():Promise<void>{
const {searchHolderMarkets} = await import('./v1/holderMarkets.ts');

 const input=query<HTMLInputElement>('[data-holder-search]');const results=query<HTMLElement>('[data-holder-search-results]');
 if(!input||!results||!runtimeConfig.readApi.available)return;
 holderSearchRequest?.abort();const request=new AbortController();holderSearchRequest=request;
 results.hidden=false;input.setAttribute('aria-expanded','true');results.textContent='Searching…';
 try{
  const items=await searchHolderMarkets(runtimeConfig.readApi.value,robinhoodChain.id,input.value,request.signal);
  if(request.signal.aborted||!results.isConnected)return;
  results.replaceChildren();
  if(!items.length){results.textContent='No tokens found';return;}
  for(const item of items){
   const button=document.createElement('button');button.type='button';button.setAttribute('role','option');
   const label=document.createElement('span');label.textContent=`${item.symbol} · ${item.name}`;
   const address=document.createElement('small');address.textContent=shortHex(item.memeToken);address.title=item.memeToken;
   button.append(label,address);button.addEventListener('click',()=>{void selectHolderSearchResult(item,input,results);});results.append(button);
  }
 }catch(error){if(!request.signal.aborted&&results.isConnected)results.textContent='Unable to search tokens. Try again.';}
}
async function selectHolderSearchResult(item:HolderMarket,input:HTMLInputElement,results:HTMLElement):Promise<void>{
 const generation=routeGeneration;
 try{
  if(!foundation||!readApi)return;
  results.textContent='Loading token…';
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
  input.value=item.symbol;results.replaceChildren();results.hidden=true;input.setAttribute('aria-expanded','false');
  const epoch=query<HTMLInputElement>('[data-treasury-epoch]');if(epoch)epoch.value='';
  rememberHolderMarket(item);
  await refreshTreasuryReward(true);
 }catch(error){if(routeGeneration===generation)results.textContent='Unable to load token. Try again.';}
}
const creatorMarketIds=new Set<string>();
let creatorDirectoryAccount='';
let creatorDirectoryAt=0;
let creatorDirectoryRequest:AbortController|undefined;
let creatorDirectoryError='';
let creatorDirectoryCursor:string|null=null;
let creatorDirectoryEvents:EventSource|undefined,creatorDirectoryEventTimer:ReturnType<typeof setTimeout>|undefined;
function watchCreatorDirectory(account:string):void{
 if(creatorDirectoryEvents||!runtimeConfig.readApi.available||typeof EventSource==='undefined')return;
 creatorDirectoryEvents=new EventSource(new URL('/v1/explore/events',runtimeConfig.readApi.value));
 const refresh=()=>{if(wallet?.account.toLowerCase()!==account||currentPage()!=='rewards'||document.hidden)return;clearTimeout(creatorDirectoryEventTimer);creatorDirectoryEventTimer=setTimeout(()=>{creatorDirectoryAt=0;void refreshCreatorDirectory();},150);};
 creatorDirectoryEvents.addEventListener('ready',refresh);
 creatorDirectoryEvents.addEventListener('change',event=>{try{const data=JSON.parse((event as MessageEvent).data);if(Array.isArray(data.creatorAccounts)&&data.creatorAccounts.includes(account))refresh();}catch{/* Invalidations carry no reward data. */}});
}

function clearCreatorDirectory():void {
  creatorDirectoryEvents?.close();creatorDirectoryEvents=undefined;clearTimeout(creatorDirectoryEventTimer);
  creatorDirectoryRequest?.abort();creatorDirectoryRequest=undefined;
  creatorDirectoryAccount='';creatorDirectoryAt=0;creatorDirectoryError='';creatorDirectoryCursor=null;creatorMarketIds.clear();
  const select=query<HTMLSelectElement>('[data-creator-market]');if(select){select.replaceChildren(new Option('Select a token',''));select.disabled=true;}
}
async function refreshCreatorDirectory(more=false):Promise<void>{
const {loadCreatorMarketPage} = await import('./v1/creatorMarkets.ts');

  if(currentPage()!=='rewards'||!wallet||!foundation||(!foundation.direct&&!runtimeConfig.readApi.available))return;
  const account=wallet.account.toLowerCase();
  if(!more&&creatorDirectoryAccount===account&&Date.now()-creatorDirectoryAt<30000)return;
  if(more&&!creatorDirectoryCursor)return;
  if(creatorDirectoryRequest&&creatorDirectoryAccount===account)return;
  if(creatorDirectoryAccount!==account)clearCreatorDirectory();creatorDirectoryAccount=account;watchCreatorDirectory(account);
  const request=new AbortController();creatorDirectoryRequest=request;const timer=setTimeout(()=>request.abort(),20000);
  try{
    if(foundation.direct){
      await refreshDirectDirectory(false);
      const current=foundation;
      if(!current||!current.direct)throw Error('Local market directory unavailable');
      const registry=runtimeConfig.contracts.available?runtimeConfig.contracts.value.creatorRevenueRegistryAddress:null;
      if(!registry)throw Error('Creator registry unavailable');
      await mapConcurrent(current.markets,async market=>{
const {default: v1Abis_CreatorRevenueRegistry} = await import('./v1/generated/contracts/legacy/CreatorRevenueRegistry.ts');

        const epoch=await publicClient.readContract({abi:v1Abis_CreatorRevenueRegistry,address:registry,functionName:'currentCreatorEpoch',args:[market.marketId]});
        if(epoch<=0)return;
        const beneficiary=await publicClient.readContract({abi:v1Abis_CreatorRevenueRegistry,address:registry,functionName:'creatorBeneficiaryAt',args:[market.marketId,epoch]});
        if(String(beneficiary).toLowerCase()===account)creatorMarketIds.add(market.marketId);
      },4);
      creatorDirectoryAt=Date.now();
      return;
    }
    if(!runtimeConfig.readApi.available)throw Error('Creator directory unavailable');
    const page=await loadCreatorMarketPage(runtimeConfig.readApi.value,robinhoodChain.id,account,request.signal,more?creatorDirectoryCursor??undefined:undefined,more?creatorMarketIds:[]);
    if(request.signal.aborted||wallet?.account.toLowerCase()!==account||currentPage()!=='rewards'||!foundation)return;
    const current:Foundation=foundation,baseUrl=runtimeConfig.readApi.value;
    const loaded=page.items.flatMap(row=>{const market=row.market??current.markets.find(m=>m.marketId===row.marketId);return market&&market.marketId===row.marketId&&market.memeToken.toLowerCase()===row.memeToken.toLowerCase()?[market]:[];});
    if(request.signal.aborted||wallet?.account.toLowerCase()!==account||currentPage()!=='rewards'||foundation?.sync.revision!==current.sync.revision)return;
    foundation=Object.freeze({...foundation,markets:[...new Map([...foundation.markets,...loaded].map(m=>[m.marketId,m])).values()]});
    if(!more){const selected=creatorReward&&ownsCreatorRewards(account,creatorReward.beneficiary)?creatorReward.marketId:null;creatorMarketIds.clear();if(selected)creatorMarketIds.add(selected);}
    for(const market of loaded)creatorMarketIds.add(market.marketId);
    creatorDirectoryError='';
    creatorDirectoryCursor=page.nextCursor;
    creatorDirectoryAt=Date.now();
  }catch(error){if(creatorDirectoryRequest===request&&wallet?.account.toLowerCase()===account&&currentPage()==='rewards'){creatorDirectoryError=request.signal.aborted?'Loading your tokens took too long. Try again.':'Unable to load your tokens. Try again.';creatorDirectoryAt=0;}}
  finally{clearTimeout(timer);if(creatorDirectoryRequest===request){creatorDirectoryRequest=undefined;populateRewardMarkets();const moreButton=query<HTMLButtonElement>('[data-creator-more]');if(moreButton){moreButton.hidden=!creatorDirectoryCursor;moreButton.disabled=false;}}}
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
      markets.forEach(m=>{const option=new Option(rewardMarketOptionLabel(m),m.marketId);option.title=m.memeToken;select.add(option);});
      select.disabled=!markets.length;
      const requested=new URLSearchParams(location.search).get('marketId');
      select.value=markets.some(m=>m.marketId===prior)?prior:markets.some(m=>m.marketId===requested)?requested!:markets[0]?.marketId??'';
      return;
    }
    const placeholder = select.matches("[data-direct-vault-market],[data-settle-market]") ? "Use selected market" : currentPage() === "rewards" ? "Select a token" : "Select a configured market";
    select.replaceChildren(new Option(placeholder, ""));
    foundation!.markets.filter((market) => !select.matches("[data-position-market],[data-staker-market],[data-settle-market]") || market.gauge !== ZERO_ADDRESS).forEach((market) => {const option=new Option(rewardMarketOptionLabel(market),market.marketId);if(currentPage()==='rewards')option.title=market.memeToken;select.add(option);});
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
        if (option) {
          option.textContent = currentPage()==='rewards' ? `${metadata.symbol} · ${market.memeToken}` : `${metadata.symbol} · ${phaseLabel(market.launchPhase)} · ${shortHex(market.marketId)}`;
          if(currentPage()==='rewards')option.title=market.memeToken;
        }
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
const {default: v1Abis_TickerGardenFactoryV1} = await import('./v1/generated/contracts/legacy/TickerGardenFactoryV1.ts');
const {default: v1Abis_OfficialStockRegistryV1} = await import('./v1/generated/contracts/legacy/OfficialStockRegistryV1.ts');
const {default: v1Abis_UserStockVault} = await import('./v1/generated/contracts/legacy/UserStockVault.ts');

  if (!runtimeConfig.rageQuitFactory.available) {
    throw new Error(runtimeConfig.rageQuitFactory.reasons.join("; "));
  }
  const factory = runtimeConfig.rageQuitFactory.value;
  const [factoryCode, rawBindings] = await Promise.all([
    publicClient.getCode({ address: factory }),
    publicClient.readContract({ abi: v1Abis_TickerGardenFactoryV1, address: factory, functionName: "runtimeBindings" }),
  ]);
  if (!factoryCode || factoryCode === "0x") throw new Error("Configured Factory has no runtime code");
  const bindings = decodeCanonicalFactoryBindings(rawBindings);
  const [rawMarket, factoryDependencyCodes] = await Promise.all([
    readWalletMarket(bindings.marketRegistry,marketId),
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
    abi: v1Abis_OfficialStockRegistryV1,
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
    publicClient.readContract({ abi: v1Abis_UserStockVault, address: vault, functionName: "vaultIdentity" }),
    publicClient.readContract({ abi: v1Abis_OfficialStockRegistryV1, address: bindings.officialStockRegistry, functionName: "vaultSchemaId", args: [vault] }),
    publicClient.readContract({ abi: v1Abis_UserStockVault, address: vault, functionName: "allocation", args: [assetUid, account, marketId] }),
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
    abi: v1Abis_OfficialStockRegistryV1,
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
    text("[data-direct-vault-status]", publicError(error,'transaction'));
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
  if (!foundation || (!readApi && !foundation.direct)) throw new Error("Market data is unavailable");
  const detail = foundation.direct
    ? await (directMarkets?.market(market.marketId) ?? Promise.reject(new Error("Local market data is unavailable")))
    : currentPage()==='staking'?{market,sync:foundation.sync}:await readApi!.getMarket({ marketId: market.marketId, revision: foundation.sync.revision });
  if (!foundation.direct&&currentPage()!=='staking') assertFinalizedSync(detail.sync, foundation.sync.revision, "reward market detail");
  if (detail.market.marketId !== market.marketId) throw new Error("Read API returned a different reward market");
  await ensureCanonicalMarket(detail.market,currentPage()==='staking');
  return detail;
}

// Claim mode is immutable for each verified release vault; share the probe across reward panels.
const rewardModes = new Map<Address, Promise<Hex>>();
function usesUserClaims(feeVault: Address, blockNumber?: bigint): Promise<Hex> {
  const known = rewardModes.get(feeVault);
  if (known) return known;
  const pending = publicClient.readContract({abi:userClaimsAbi,address:feeVault,functionName:'userClaimMode',blockNumber})
    .then(mode => { if (mode !== USER_CLAIM_MODE && mode !== LEGACY_USER_CLAIM_MODE) throw Error('Unsupported Reward Claim Mode'); return mode as Hex; });
  rewardModes.set(feeVault, pending);
  void pending.catch(() => rewardModes.delete(feeVault));
  return pending;
}
async function readHolderDistributor(address: Address): Promise<Address> {
  return publicClient.readContract({address,abi:[{type:'function',name:'holderRewardsDistributor',stateMutability:'view',inputs:[],outputs:[{type:'address'}]}],functionName:'holderRewardsDistributor'});
}

async function readRewardPositionState(detail: MarketDetailResponse): Promise<RewardPositionState> {
const {default: v1Abis_UserStockVault} = await import('./v1/generated/contracts/legacy/UserStockVault.ts');

const {default: v1Abis_MemeStockGauge} = await import('./v1/generated/contracts/legacy/MemeStockGauge.ts');

  if (!wallet) throw new Error("Connect a wallet to load your position");
  if (detail.market.gauge === ZERO_ADDRESS) throw new Error("Stock staking is not enabled for this market");
  const positionWallet=wallet;
  const account=positionWallet.account;
  const assetConfig = findAsset(detail.market.assetUid);
  const asset = await ensureCanonicalAsset(assetConfig, verifiedMarketRuntime.get(detail.market.marketId));
  const block = await publicClient.getBlock({ blockTag: "latest" });
  const blockNumber = block.number;
  const [free, allocated, rawPosition, settlementPrincipal, walletBalance] = await Promise.all([
    publicClient.readContract({ blockNumber, abi: v1Abis_UserStockVault, address: asset.userStockVault, functionName: "freeBalanceOf", args: [asset.assetUid, account] }),
    publicClient.readContract({ blockNumber, abi: v1Abis_UserStockVault, address: asset.userStockVault, functionName: "allocation", args: [asset.assetUid, account, detail.market.marketId] }),
    publicClient.readContract({ blockNumber, abi: v1Abis_MemeStockGauge, address: canonicalAddress(detail.market.gauge, "Gauge"), functionName: "positionOf", args: [account] }),
    publicClient.readContract({ blockNumber, abi: v1Abis_UserStockVault, address: asset.userStockVault, functionName: "rageQuitSettlementPrincipal", args: [asset.assetUid, account, detail.market.marketId] }),
    publicClient.readContract({ blockNumber, abi: erc20Abi, address: asset.stockToken, functionName: "balanceOf", args: [account] }),
  ]);
  if(wallet!==positionWallet)throw Error("Wallet changed while reading the position");
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
    observedBlockHash: block.hash,
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
const stakeRewardHistoryCache=new Map<string,{claimed:string;earned:string}>();
const stakeRewardHistoryReads=createInvalidatedRead<string,import('./v1/generated/read-api.ts').StakeRewardSummary>();
async function loadStakeRewardHistory(state:Pick<RewardPositionState,'detail'|'metadata'>,force=false):Promise<void>{
 if(!wallet||!runtimeConfig.readApi.available||currentPage()!=='staking')return;
 const account=wallet.account.toLowerCase(),marketId=state.detail.market.marketId,key=`${robinhoodChain.id}:${marketId}:${account}`;
 const current=()=>currentPage()==='staking'&&wallet?.account.toLowerCase()===account&&query<HTMLSelectElement>('[data-position-market]')?.value===marketId;
 const cached=stakeRewardHistoryCache.get(key);
 if(cached&&current()){text('[data-staker-earned]',cached.earned);text('[data-staker-claimed]',cached.claimed);}
 try{
  const base=runtimeConfig.readApi.value;
  const result=await stakeRewardHistoryReads.read(key,()=>new TickerGardenV1Client(base,(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(8000)})).getStakerRewardSummary({marketId,account:account as Address}),{invalidate:force});
  if(result.chainId!==robinhoodChain.id||result.displayOnly!==true||result.marketId!==marketId||result.account!==account)throw Error('Reward summary mismatch');
  const quote=state.detail.market.quoteAsset.toLowerCase(),meme=state.detail.market.memeToken.toLowerCase();
  const label=(amounts:Record<string,string>)=>{
   for(const [asset,value]of Object.entries(amounts))if(![quote,meme].includes(asset)||typeof value!=='string'||!/^\d+$/.test(value))throw Error('Invalid reward amount');
   const q=BigInt(amounts[quote]??'0'),m=BigInt(amounts[meme]??'0');
   return [q>0n||m===0n?`${formatTokenAmount(q,state.metadata.quoteDecimals)} ${state.metadata.quoteSymbol}`:'',m>0n?`${formatTokenAmount(m,18)} ${state.metadata.symbol}`:''].filter(Boolean).join('\n');
  };
  const value={claimed:label(result.claimed),earned:label(result.earned)};stakeRewardHistoryCache.set(key,value);
  if(stakeRewardHistoryCache.size>100)stakeRewardHistoryCache.delete(stakeRewardHistoryCache.keys().next().value!);
  if(current()){text('[data-staker-claimed]',value.claimed);text('[data-staker-earned]',value.earned);}
 }catch{/* Keep the last published values. Wallet funds are read independently. */}
}
function renderRewardPosition(state: RewardPositionState): void {
  // Remove the legacy absolute unlock date if this view survived a hot update.
  query<HTMLElement>('[data-stake-unlock-at]')?.remove();
  renderStakeShare();
  const unit=stockSymbol(state.assetConfig);
  stakeAssetAmount('[data-stake-wallet]',formatTokenAmount(state.walletBalance,state.asset.tokenDecimals),state.assetConfig);
  stakeText('[data-stake-modal-wallet]',`${formatTokenAmount(state.walletBalance,state.asset.tokenDecimals)} ${unit}`);
  stakeAssetAmount('[data-stake-allocated]',formatTokenAmount(state.allocated,state.asset.tokenDecimals),state.assetConfig);
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
  updateStakePreview();
  const claimableNow=state.settlementPrincipal===0n&&(state.allocated===0n||(state.unlockAt>0n&&state.now>=state.unlockAt));
  text('[data-staker-locked-note]',!claimableNow&&state.quoteClaimable>0n&&state.settlementPrincipal===0n?`${formatTokenAmount(state.quoteClaimable,state.metadata.quoteDecimals)} ${state.metadata.quoteSymbol} Locked`: '');
  text("[data-staker-claimable=quote]", `${formatTokenAmount(claimableNow?state.quoteClaimable:0n, state.metadata.quoteDecimals)} ${state.metadata.quoteSymbol}`);
  text("[data-staker-claimable=meme]", `${formatTokenAmount(state.memeClaimable, 18)} ${state.metadata.symbol}${state.detail.market.burnMemeFees ? " · pending burn" : ""}`);
  text("[data-rewards-total]", `${formatTokenAmount(state.quoteClaimable, state.metadata.quoteDecimals)} ${state.metadata.quoteSymbol} · ${formatTokenAmount(state.memeClaimable, 18)} ${state.metadata.symbol}`);
  iconText("[data-staker-status]", "ph-check-circle", state.detail.market.burnMemeFees ? `Claim ${state.metadata.quoteSymbol}; earned ${state.metadata.symbol} fees are permanently burned on any claim.` : `Rewards for ${state.metadata.symbol}. Claim the original ${state.metadata.quoteSymbol} and ${state.metadata.symbol} assets.`);
  text("[data-ragequit-estimate]", `Principal: ${stock(state.allocated)} STOCK. Estimated unclaimed rewards forfeited to the platform: ${formatTokenAmount(state.quoteClaimable, state.metadata.quoteDecimals)} ${state.metadata.quoteSymbol} + ${formatTokenAmount(state.memeClaimable, 18)} ${state.metadata.symbol}. Final reward amounts may change before execution.`);
  const directAsset = query<HTMLInputElement>("[data-direct-vault-asset]");
  if (directAsset) { directAsset.value = state.asset.assetUid; directAsset.readOnly = true; }
  const settleUser = query<HTMLInputElement>("[data-settle-user]");
  if (settleUser && !settleUser.value && wallet) settleUser.value = wallet.account;
}

let stakeCountdownTimer=0;
let stakeClockReadAt=0;
let stakeUnlockProbeKey='';
let stakeUnlockProbeAt=0;
function renderStakeCountdown():void {
 const target=query<HTMLElement>('[data-stake-unlock]');if(!target)return;
 target.removeAttribute('data-state');
 target.classList.remove('stake-unlock-is-ready');
 const state=rewardPosition;
 if(!state||!wallet||rewardPositionOwner!==wallet.account||state.detail.market.marketId!==query<HTMLSelectElement>('[data-position-market]')?.value){stakeText('[data-stake-unlock]','-');return;}
 const elapsed=BigInt(Math.max(0,Math.floor((performance.now()-stakeClockReadAt)/1000)));
 const {label,needsVerification}=stakeUnlockDisplay(state.allocated,state.now,state.unlockAt,elapsed);
 if(needsVerification){
  stakeText('[data-stake-unlock]','Checking unlock…');
  const key=`${wallet.account}:${state.detail.market.marketId}:${state.observedBlock}`;
  if(key!==stakeUnlockProbeKey||Date.now()-stakeUnlockProbeAt>=30000){stakeUnlockProbeKey=key;stakeUnlockProbeAt=Date.now();void refreshRewardPosition(true);}
  return;
 }
 target.classList.toggle('stake-unlock-is-ready',label==='Ready to unstake');
 if(label==='Ready to unstake'){
  const badge=document.createElement('span');badge.className='stake-unlock-ready';
  badge.textContent=label;target.replaceChildren(badge);return;
 }
 const locked=/^Locked · (.+) remaining$/.exec(label);
 if(!locked){stakeText('[data-stake-unlock]',label);return;}
 let value=target.querySelector<HTMLElement>('[data-stake-countdown]');
 if(!value){const prefix=document.createElement('small');prefix.className='stake-unlock-caption';prefix.textContent='Locked ·';value=document.createElement('span');value.dataset.stakeCountdown='';const suffix=document.createElement('small');suffix.className='stake-unlock-suffix';suffix.textContent='remaining';target.replaceChildren(prefix,value,suffix);}
 if(value.textContent!==locked[1])value.textContent=locked[1]!;
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
  for(const key of ['wallet','allocated','unlock','modal-wallet','modal-current'])stakeText(`[data-stake-${key}]`,'-');
  rewardPosition = null;
  renderStakeShare();
  updateStakePreview();
  text("[data-ragequit-estimate]", "Load a verified position to see principal and estimated forfeited rewards.");
  text("[data-staker-claimable=quote]", "-");
  text("[data-staker-claimable=meme]", "-");
  text("[data-staker-earned]", "-");text("[data-staker-claimed]", "-");text("[data-staker-locked-note]", "");
  text("[data-rewards-total]", "-");
  text("[data-staker-conversion-status]", "Load a position to view original reward assets.");
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
    if(!samePosition)text("[data-rewards-status]", "Loading your balances…");
    const market = selectedRewardMarket("[data-position-market]");
    const summaryAccount=wallet.account,summarySync=foundation.sync;
    void marketMetadata(market).then(metadata=>{
      if(generation===rewardLoadGeneration&&wallet?.account===summaryAccount)void loadStakeRewardHistory({detail:{market,sync:summarySync},metadata});
    }).catch(()=>{});
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
    text("[data-rewards-status]", `Balances updated for ${shortHex(wallet.account)} at ${new Date().toLocaleTimeString()}.`);
    updateRewardsAvailability();
  } catch (error) {
    if (generation !== rewardLoadGeneration) return;
    iconText("[data-position-summary]", "ph-warning", publicError(error));
    text("[data-rewards-status]", publicError(error));
    updateRewardsAvailability();
  }
}

function clearCreatorRewardView():void {
  creatorReward = null;
  text("[data-creator-receive-asset]", "-");
  text("[data-creator-status]", "");
  text("[data-creator-beneficiary]", "-");
  text("[data-creator-pending-beneficiary]", "-");
  text("[data-creator-current-beneficiary]", "-");
  text("[data-creator-market-summary]", "-");
  text("[data-creator-epoch-summary]", "-");
  text("[data-creator-status-summary]", "Choose a market");
  text("[data-creator-quote-asset]", "-");
  text("[data-creator-pending-meme]", "-");
  text("[data-creator-conversion-status]", "Load creator rewards to view original assets.");
  const claim=rewardActionButton('claimCreator');if(claim)setDisabled(claim,true);
  const copy=query<HTMLButtonElement>('[data-copy-beneficiary]');if(copy)copy.disabled=true;
}
const creatorEpochChoices=new Set<number>();
const creatorPeriods=new Map<number,CreatorPeriod>();
let creatorPeriodsOwner='',creatorPeriodsCursor:string|null=null;
let creatorRewardWatcher:{stop():void}|undefined,creatorRewardWatchKey='';
let creatorRewardRequest:AbortController|undefined;
let creatorClaimPreparing=false;
async function refreshCreatorReward(more=false):Promise<void>{
 if(!foundation||!wallet||!runtimeConfig.readApi.available||creatorClaimPreparing)return;
 const select=query<HTMLSelectElement>('[data-creator-market]'),epochInput=query<HTMLSelectElement>('[data-creator-epoch]');
 if(!select?.value||!epochInput||creatorDirectoryAccount!==wallet.account.toLowerCase()||!creatorMarketIds.has(select.value))return;
 if(more&&!creatorPeriodsCursor)return;
 const marketId=select.value as Hex,activeWallet=wallet,owner=`${marketId}:${activeWallet.account}`,generation=++creatorLoadGeneration;
 if(creatorPeriodsOwner!==owner){clearCreatorRewardView();creatorPeriods.clear();creatorEpochChoices.clear();creatorPeriodsCursor=null;creatorPeriodsOwner=owner;epochInput.replaceChildren();}
 if(more&&!creatorPeriodsCursor)return;
 creatorRewardRequest?.abort();const request=new AbortController();creatorRewardRequest=request;const timeout=setTimeout(()=>request.abort(),10000);
 const valid=()=>generation===creatorLoadGeneration&&wallet===activeWallet&&currentPage()==='rewards'&&select.isConnected&&select.value===marketId;
 const older=query<HTMLButtonElement>('[data-creator-older]');if(older)older.disabled=true;
 try{
  const selected=Number(epochInput.value)||undefined;
  const page=await loadCreatorRewards(runtimeConfig.readApi.value,robinhoodChain.id,marketId,activeWallet.account,{signal:request.signal,...(more?{cursor:creatorPeriodsCursor!}:selected?{epoch:selected}:{})});
  if(!valid())return;
  if(creatorReward&&page.currentEpoch!==creatorReward.currentEpoch){creatorPeriods.clear();creatorEpochChoices.clear();epochInput.replaceChildren();creatorReward=null;void refreshCreatorReward();return;}
  for(const row of page.periods){creatorPeriods.set(row.epoch,row);creatorEpochChoices.add(row.epoch);}
  if(!more&&selected&&!page.periods.length){creatorPeriods.delete(selected);creatorEpochChoices.delete(selected);}
  if(more||!selected)creatorPeriodsCursor=page.nextCursor;
  epochInput.replaceChildren(...[...creatorEpochChoices].sort((a,b)=>b-a).map(e=>new Option(`Distribution ${e}`,String(e))));
  if(selected&&creatorEpochChoices.has(selected))epochInput.value=String(selected);
  epochInput.disabled=!creatorEpochChoices.size;if(older)older.hidden=!creatorPeriodsCursor;
  foundation=Object.freeze({...foundation,markets:[...foundation.markets.filter(m=>m.marketId!==marketId),page.market]});
  if(creatorRewardWatchKey!==owner){creatorRewardWatcher?.stop();creatorRewardWatchKey=owner;creatorRewardWatcher=watchMarketChanges(runtimeConfig.readApi.value,marketId,async regions=>{if(regions.some(r=>['fees','market','statistics'].includes(r))&&!rewardChoicePending&&wallet===activeWallet){creatorDirectoryAt=0;void refreshCreatorReward();}});}
  const row=creatorPeriods.get(Number(epochInput.value));
  if(!row){clearCreatorRewardView();text('[data-creator-status]','No creator rewards for this wallet.');return;}
  const metadata=await marketMetadata(page.market);if(!valid())return;
  creatorReward=Object.freeze({marketId,epoch:row.epoch,beneficiary:row.beneficiary,currentEpoch:page.currentEpoch,currentBeneficiary:page.currentBeneficiary??ZERO_ADDRESS,pendingBeneficiary:page.pendingBeneficiary,feeAsset:page.market.quoteAsset,liability:BigInt(row.quote.remaining),memeLiability:BigInt(row.meme.remaining),memeAsset:page.market.memeToken,creatorFeesToHolders:page.market.creatorFeesToHolders===true,pendingQuote:row.epoch===page.currentEpoch?BigInt(page.pendingQuote):0n,now:0n});
  text('[data-creator-quote-asset]',`${formatTokenAmount(creatorReward.liability,metadata.quoteDecimals)} ${metadata.quoteSymbol}`);
  text('[data-creator-pending-meme]',`${formatTokenAmount(creatorReward.memeLiability,18)} ${metadata.symbol}${page.market.burnMemeFees?' · pending burn':''}`);
  text('[data-creator-receive-asset]',`${metadata.quoteSymbol} ｜ ${metadata.symbol}`);text('[data-creator-beneficiary]',shortHex(row.beneficiary));
  text('[data-creator-status]',creatorReward.pendingQuote!>0n?'More rewards are ready to prepare when you claim.':'');
  updateRewardsAvailability();
 }catch{if(valid()){text('[data-creator-status]','Rewards could not be refreshed. Please try again.');updateRewardsAvailability();}}
 finally{clearTimeout(timeout);if(valid()&&older)older.disabled=false;}
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
const {default: v1Abis_TreasuryDistributorV1} = await import('./v1/generated/contracts/legacy/TreasuryDistributorV1.ts');

  const {fetchTreasuryClaimProof} = await import('./v1/features/treasury.ts');
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
    abi: v1Abis_TreasuryDistributorV1,
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

function selectedSnapshotRound(): HolderRound | undefined {
  const value=query<HTMLSelectElement>('[data-snapshot-round]')?.value;
  return snapshotReward?.page.rounds.find(round=>String(round.round)===value);
}
function renderSnapshotRound(): void {
  const state=snapshotReward, round=selectedSnapshotRound();
  const assets=round?remainingSnapshotAssets(round):0;
  text('[data-snapshot-quote]',state?`${formatTokenAmount(round&&(assets&1)?round.quoteAmount:0n,state.metadata.quoteDecimals)} ${state.metadata.quoteSymbol}`:'—');
  text('[data-snapshot-meme]',state?`${formatTokenAmount(round&&(assets&2)?round.memeAmount:0n,18)} ${state.metadata.symbol}`:'—');
  text('[data-snapshot-assets]',state&&round?[...(assets&1?[state.metadata.quoteSymbol]:[]),...(assets&2?[state.metadata.symbol]:[])].join(' ｜ ')||'Claimed':'—');
  const recipient=query<HTMLElement>('[data-snapshot-recipient]');
  if(recipient){recipient.textContent=state?state.page.identity.account:'—';recipient.title=state?state.page.identity.account:'';}
  if(state){const status=holderSnapshotStatus(state.page.status,round,runtimeConfig.snapshotHolderWrites.available);const partial=!state.page.complete?`Some rewards are temporarily unavailable${state.page.unavailableRounds.length?` (rounds ${state.page.unavailableRounds.join(', ')})`:''}. Refresh to try again.`:'';snapshotRewardStatus=[!round&&!state.page.complete?'':status.message,partial].filter(Boolean).join(' ');text('[data-snapshot-status]',snapshotRewardStatus);query<HTMLElement>('[data-snapshot-status]')?.setAttribute('data-tone',status.tone);}
  updateRewardsAvailability();
}
async function loadSnapshotReward(market:MarketReadModel,distributor:Address,generation:number,prior:typeof snapshotReward=null):Promise<void> {
const {fetchHolderSnapshotsPage,mergeHolderSnapshotPages} = await import('./v1/features/holderSnapshots.ts');

  const panel=query<HTMLElement>('[data-snapshot-rewards]');
  if(!panel||!wallet)return;
  setContinuousRewardsView(false);
  query<HTMLElement>('[data-legacy-treasury]')?.setAttribute('hidden','');
  panel.hidden=false;
  text("[data-holder-reward-summary]","Claim rewards earned from eligible token holdings.");
  const account=wallet.account, request=new AbortController();
  snapshotRewardRequest?.abort();snapshotRewardRequest=request;
  const timeout=setTimeout(()=>request.abort(),10000);
  let loadError='';
  const current=()=>generation===treasuryLoadGeneration&&snapshotRewardRequest===request&&wallet?.account===account&&currentPage()==='rewards'&&query<HTMLSelectElement>('[data-treasury-market]')?.value===market.marketId;
  snapshotRewardStatus='Loading rewards…';text('[data-snapshot-status]',snapshotRewardStatus);query<HTMLElement>('[data-snapshot-status]')?.setAttribute('data-tone','loading');updateRewardsAvailability();
  try {
    if(!runtimeConfig.readApi.available)throw Error('Snapshot rewards are unavailable. Try again later.');
    const identity:SnapshotIdentity={chainId:robinhoodChain.id,distributor,marketId:market.marketId,account,quote:market.quoteAsset,meme:market.memeToken,burnMemeFees:market.burnMemeFees};
    const [{page,recoveredCursor},metadata]=await Promise.all([fetchHolderSnapshotsPage(runtimeConfig.readApi.value,identity,request.signal,prior?.page.nextCursor??undefined),marketMetadata(market)]);
    if(!current())return;
    const restarted=recoveredCursor||Boolean(prior&&prior.page.publicationRevision!==page.publicationRevision);
    if(prior&&!restarted&&(page.nextCursor===prior.page.nextCursor||page.rounds.some(r=>prior.page.rounds.some(old=>old.round===r.round))))throw Error('Snapshot page is inconsistent. Refresh rewards to try again.');
    const loaded=page.rounds.map(round=>{
      const key=snapshotReceiptKey(identity,round.round),receipt=snapshotReceiptClaims.get(key);
      if(!receipt)return round;
      if(page.sourceBlock>=receipt.block){snapshotReceiptClaims.delete(key);return round;}
      return {...round,claimedAssets:round.claimedAssets|receipt.mask};
    });
    const merged=mergeHolderSnapshotPages(prior&&!restarted?prior.page:null,{...page,rounds:loaded});
    const rounds=merged.rounds;
    snapshotReward={page:merged,market,metadata};
    const select=query<HTMLSelectElement>('[data-snapshot-round]')!, selected=select.value;
    select.replaceChildren();
    for(const r of rounds){const option=document.createElement('option');option.value=String(r.round);option.textContent=`Distribution ${r.round}${remainingSnapshotAssets(r)===0?' · Claimed':''}`;select.append(option);}
    select.disabled=rounds.length===0;
    if(rounds.some(r=>String(r.round)===selected))select.value=selected;
    else if(rounds.some(r=>remainingSnapshotAssets(r)>0))select.value=String(rounds.find(r=>remainingSnapshotAssets(r)>0)!.round);
    if(!rounds.length)select.add(new Option('No rewards available',''));
    const roundField=query<HTMLElement>('[data-holder-round-field]');if(roundField)roundField.hidden=rounds.length<=1;
    const more=query<HTMLButtonElement>('[data-snapshot-more]');if(more){more.hidden=page.nextCursor===null;more.textContent='View older rounds';}
  } catch(error) {
    if(!current())return;
    if(prior){
      snapshotReward=prior;loadError='Older rounds could not be loaded. Try again.';
      const more=query<HTMLButtonElement>('[data-snapshot-more]');if(more){more.hidden=false;more.textContent='Retry older rounds';}
    }else{
    snapshotReward=null;
    snapshotRewardStatus=request.signal.aborted?'Rewards took too long to load. Reload the page to try again.':publicError(error,'rewards');
    query<HTMLElement>('[data-snapshot-status]')?.setAttribute('data-tone','error');
    const select=query<HTMLSelectElement>('[data-snapshot-round]');if(select)select.disabled=true;
    const roundField=query<HTMLElement>('[data-holder-round-field]');if(roundField)roundField.hidden=true;
    const more=query<HTMLButtonElement>('[data-snapshot-more]');if(more)more.hidden=true;
    }
  } finally {
    clearTimeout(timeout);
    if(current()){snapshotRewardRequest=null;text('[data-snapshot-status]',snapshotRewardStatus);renderSnapshotRound();if(loadError){text('[data-snapshot-status]',loadError);query<HTMLElement>('[data-snapshot-status]')?.setAttribute('data-tone','error');}}
  }
}
async function executeSnapshotClaim():Promise<void> {
const {default: currentV4Abis_HolderRewardsDistributorV1} = await import('./v1/generated/contracts/current/HolderRewardsDistributorV1.ts');
const {rewardClaimDialog} = await import('./ui/reward-claim-dialog.ts');
const {buildSnapshotClaim} = await import('./v1/features/holderSnapshots.ts');
const {WALLET_SNAPSHOT_MODE} = await import('./v1/features/holderSnapshots.ts');

  if(!foundation||!wallet||!snapshotReward||rewardChoicePending||!runtimeConfig.snapshotHolderWrites.available)throw Error('Load a published reward round first');
  const state=snapshotReward,round=selectedSnapshotRound(),activeWallet=wallet;
  if(state.page.identity.account.toLowerCase()!==activeWallet.account.toLowerCase())throw Error("Wallet changed. Reload the page before claiming.");
  if(!round||remainingSnapshotAssets(round)===0)throw Error('No unclaimed assets in this round');
  rewardChoicePending=true;updateRewardsAvailability();
  try {
    const available=remainingSnapshotAssets(round) as 1|2|3;
    await import('./ui/reward-claim-dialog.css');
    const assets=await rewardClaimDialog({quote:state.metadata.quoteSymbol,meme:state.metadata.symbol},available);
    if(!assets){rewardChoiceCancelled=true;return;}
    const id=state.page.identity;
    const verify=async()=>{
      if(snapshotReward!==state||selectedSnapshotRound()!==round||wallet!==activeWallet)throw Error('Wallet or reward selection changed. Review the round again.');
      await verifyLiveWalletContext(activeWallet);
      await ensureCanonicalMarket(state.market);
      if(marketRelease(id.marketId).holderDistributor.toLowerCase()!==id.distributor.toLowerCase())throw Error('Reward distributor binding changed');
      const [mode,live,claimed]=await Promise.all([
        publicClient.readContract({abi:currentV4Abis_HolderRewardsDistributorV1,address:id.distributor,functionName:'rewardMode'}),
        publicClient.readContract({abi:currentV4Abis_HolderRewardsDistributorV1,address:id.distributor,functionName:'roundState',args:[id.marketId,round.round]}),
        publicClient.readContract({abi:currentV4Abis_HolderRewardsDistributorV1,address:id.distributor,functionName:'claimedAssets',args:[id.marketId,round.round,id.account]}),
      ]);
      if(mode!==WALLET_SNAPSHOT_MODE||live.root!==round.root||live.snapshotBlock!==round.snapshotBlock||(Number(claimed)&assets)!==0
        ||(assets&1&&live.quoteRemaining<round.quoteAmount)||(assets&2&&live.memeRemaining<round.memeAmount))throw Error('Reward state changed. Refresh this round before claiming.');
    };
    await verify();
    await executeTransaction({operationKey:`reward:snapshot:${id.marketId}:${round.round}:${id.account}:${assets}`,sync:foundation!.sync,walletContext:activeWallet,
      request:buildSnapshotClaim(id,round,assets),verifyChain:verify,
      confirm:async receipt=>{const event=receiptEvent(receipt,id.distributor,currentV4Abis_HolderRewardsDistributorV1,'HolderSnapshotClaimed',args=>args.marketId===id.marketId&&args.round===round.round&&String(args.account).toLowerCase()===id.account.toLowerCase()&&Number(args.assets)===assets
        &&args.quotePaid===(assets&1?round.quoteAmount:0n)&&args.memePaid===(assets&2?round.memeAmount:0n));
        const key=snapshotReceiptKey(id,round.round);
        snapshotReceiptClaims.set(key,{mask:(snapshotReceiptClaims.get(key)?.mask??0)|assets,block:receipt.blockNumber});
        if(snapshotReceiptClaims.size>128)snapshotReceiptClaims.delete(snapshotReceiptClaims.keys().next().value!);
        return event;},
    });
    // Receipt confirmation prevents a delayed DB response from offering the same assets twice.
    if(snapshotReward===state){snapshotReward={...state,page:{...state.page,rounds:state.page.rounds.map(r=>r.round===round.round?{...r,claimedAssets:r.claimedAssets|assets}:r)}};renderSnapshotRound();}
    rewardClaimOutcomeMessage='Rewards claimed';
  } finally {rewardChoicePending=false;updateRewardsAvailability();}
}

async function refreshTreasuryReward(resetEpoch: boolean): Promise<void> {
const {default: v1Abis_TreasuryDistributorV1} = await import('./v1/generated/contracts/legacy/TreasuryDistributorV1.ts');

const {default: v1Abis_ProtocolFeeVault} = await import('./v1/generated/contracts/legacy/ProtocolFeeVault.ts');
const {default: v1Abis_TickerGardenCurve} = await import('./v1/generated/contracts/legacy/TickerGardenCurve.ts');
const {HOLDER_REWARDS_DISTRIBUTOR_V1_ABI: continuousRewardsAbi} = await import('./v1/features/continuousRewards.ts');
const {isContinuousHolderRewardMode} = await import('./v1/features/continuousRewards.ts');
const {DUAL_HOLDER_MODE} = await import('./v1/features/userClaims.ts');

  const generation = ++treasuryLoadGeneration;
  const preserveContinuous=continuousReward?.account===wallet?.account&&continuousReward?.marketId===query<HTMLSelectElement>('[data-treasury-market]')?.value;
  treasuryReward = null;
  renderRecentHolderMarkets();
  continuousReward = null;
  snapshotReward = null; snapshotRewardRequest?.abort(); snapshotRewardRequest=null; snapshotRewardStatus="";
  query<HTMLElement>("[data-snapshot-rewards]")?.setAttribute("hidden", "");
  if(!preserveContinuous){setContinuousRewardsView(false);queryAll<HTMLElement>('[data-legacy-treasury]').forEach(el=>el.hidden=true);}
  clearTreasuryProof();
  text("[data-treasury-status]", wallet?"Select a token":"Connect wallet");
  text("[data-treasury-epoch-id]", "-");
  text("[data-treasury-root]", "-");
  text("[data-treasury-fee]", "Not available yet");
  text("[data-treasury-fee-asset]", "Not available yet");
  text("[data-treasury-fee-allowance]", "Approval not checked");
  text("[data-treasury-service-credit]", "Not available yet");
  text("[data-treasury-claimable]", "-");
  text("[data-treasury-proof]", "Reward eligibility has not been checked yet.");
  updateRewardsAvailability();
  if (!foundation || !wallet || !runtimeConfig.contracts.available) {
    text("[data-treasury-status-note]", wallet?"Unable to load rewards. Try again.":"");
    return;
  }
  const select = query<HTMLSelectElement>("[data-treasury-market]");
  if (!select?.value) return;
  try {
    const selected = selectedRewardMarket("[data-treasury-market]");
    const snapshotRelease = snapshotReleaseForMarket(runtimeConfig.releaseCatalog,robinhoodChain.id,selected.canonicalRoute.hook);
    if (snapshotRelease) {
      await loadSnapshotReward(selected, snapshotRelease.holderDistributor, generation);
      return;
    }
    const detail = await getRewardMarketDetail(selected);

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
        publicClient.readContract({ blockNumber: block.number, abi: v1Abis_ProtocolFeeVault, address: marketRelease(detail.market.marketId).feeVault, functionName: "holderLiability", args: [marketId, 1, detail.market.quoteAsset] }),
        publicClient.readContract({ blockNumber: block.number, abi: v1Abis_ProtocolFeeVault, address: marketRelease(detail.market.marketId).feeVault, functionName: "holderLiability", args: [marketId, 1, detail.market.memeToken] }),
        marketMetadata(detail.market),
        publicClient.readContract({blockNumber: block.number, abi: continuousRewardsAbi, address: distributor, functionName: "releaseState", args: [marketId]}),
        publicClient.readContract({blockNumber: block.number, abi: continuousRewardsAbi, address: distributor, functionName: "lastFundingAt", args: [marketId]}),
        publicClient.readContract({blockNumber: block.number, abi: v1Abis_TickerGardenCurve, address: detail.market.curve, functionName: "accruedCurveFees"}),
        publicClient.readContract({blockNumber: block.number, abi: v1Abis_TickerGardenCurve, address: detail.market.curve, functionName: "accruedCreatorTax"}),
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
    const rawTreasuryMarket = await publicClient.readContract({ abi: v1Abis_TreasuryDistributorV1, address: distributor, functionName: "market", args: [detail.market.marketId] });
    if (generation !== treasuryLoadGeneration) return;
    const memeToken = canonicalAddress(tupleString(rawTreasuryMarket, "memeToken", 0), "holder fee-sharing created token");
    const quoteToken = canonicalAddress(tupleString(rawTreasuryMarket, "quoteToken", 1), "holder fee-sharing Quote token", true);
    const activatedAt = tupleBigInt(rawTreasuryMarket, "activatedAt", 3);
    if (memeToken !== detail.market.memeToken || quoteToken !== detail.market.quoteAsset || activatedAt <= 0n) {
      throw new Error("Holder fee-sharing registration or activation does not match the canonical market");
    }
    const currentEpochId = await publicClient.readContract({ abi: v1Abis_TreasuryDistributorV1, address: distributor, functionName: "currentEpochId", args: [detail.market.marketId] });
    const epochId = populateTreasuryEpochs(currentEpochId, resetEpoch);
    const [rawEpoch, epochQuoteAmount, rawWindow, rawFee, holderBalance, accountClaimed, block, finalityDelay, publicationWindow, pendingHolderQuote, pendingHolderMeme] = await Promise.all([
      publicClient.readContract({ abi: v1Abis_TreasuryDistributorV1, address: distributor, functionName: "epoch", args: [detail.market.marketId, epochId] }),
      publicClient.readContract({ abi: v1Abis_TreasuryDistributorV1, address: distributor, functionName: "epochQuoteAmount", args: [detail.market.marketId, epochId] }),
      publicClient.readContract({ abi: v1Abis_TreasuryDistributorV1, address: distributor, functionName: "epochWindow", args: [detail.market.marketId, epochId] }),
      publicClient.readContract({ abi: v1Abis_TreasuryDistributorV1, address: distributor, functionName: "rootServiceFee" }),
      publicClient.readContract({ abi: erc20Abi, address: memeToken, functionName: "balanceOf", args: [wallet.account] }),
      publicClient.readContract({ abi: v1Abis_TreasuryDistributorV1, address: distributor, functionName: "accountClaimed", args: [detail.market.marketId, epochId, wallet.account] }),
      publicClient.getBlock({ blockTag: "latest" }),
      publicClient.readContract({ abi: parseAbi(["function finalityDelaySeconds() view returns (uint32)"]), address: distributor, functionName: "finalityDelaySeconds" }),
      publicClient.readContract({ abi: parseAbi(["function rootPublicationWindow() view returns (uint32)"]), address: distributor, functionName: "rootPublicationWindow" }),
      publicClient.readContract({ abi: v1Abis_ProtocolFeeVault, address: marketRelease(detail.market.marketId).feeVault, functionName: "holderLiability", args: [detail.market.marketId, epochId, quoteToken] }),
      publicClient.readContract({ abi: v1Abis_ProtocolFeeVault, address: marketRelease(detail.market.marketId).feeVault, functionName: "holderLiability", args: [detail.market.marketId, epochId, memeToken] }),
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
      publicClient.readContract({ abi: v1Abis_TreasuryDistributorV1, address: distributor, functionName: "serviceCredit", args: [serviceCreditAsset, wallet.account] }),
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
    let proofStatus = runtimeConfig.treasuryProofApi.available ? "No rewards found for this wallet in this period." : "Reward eligibility cannot be checked right now. Try again shortly.";
    try {
      proof = await verifiedTreasuryProof(base);
      if (proof) proofStatus = "Your reward eligibility has been verified.";
      else if (accountClaimed) proofStatus = "This wallet has already claimed rewards for this period.";
      else if (status !== 3) proofStatus = "Rewards will be available after this period is confirmed.";
    } catch (error) {
      proofStatus = "Reward eligibility could not be checked. Try again shortly.";
    }
    if (generation !== treasuryLoadGeneration) return;
    treasuryReward = Object.freeze({ ...base, proof });
    text("[data-treasury-status]", treasuryStatusLabels[status] ?? "Reward status pending");
    text("[data-treasury-epoch-id]", `${epochId} · ${new Date(Number(base.windowStart) * 1_000).toLocaleDateString()} – ${new Date(Number(base.windowEnd) * 1_000).toLocaleDateString()}`);
    text("[data-treasury-fee-asset]", base.serviceFeeAsset === ZERO_ADDRESS ? "Native ETH" : base.serviceFeeAsset);
    text("[data-treasury-claimable]", proof ? `${formatTokenAmount(proof.amount, metadata.quoteDecimals)} ${metadata.quoteSymbol}` : accountClaimed ? "Already claimed" : "-");
    text("[data-treasury-proof]", proofStatus);
    const claimNotice = runtimeConfig.treasuryWrites.available ? "" : " Claims are temporarily paused. Please check again later.";
    text("[data-treasury-status-note]", `This period: ${formatTokenAmount(base.epochQuoteAmount, metadata.quoteDecimals)} ${metadata.quoteSymbol} in rewards. Claimed: ${formatTokenAmount(base.claimedAmount, metadata.quoteDecimals)} of ${formatTokenAmount(base.quoteAmount, metadata.quoteDecimals)} ${metadata.quoteSymbol}.${claimNotice}`);
    renderTreasuryProof(proof, metadata);
    updateRewardsAvailability();
  } catch (error) {
    if (generation !== treasuryLoadGeneration) return;
    text("[data-treasury-status]", wallet?"Rewards could not be loaded":"Connect wallet");
    text("[data-treasury-status-note]", "Rewards could not be loaded. Please try again shortly.");
    text("[data-treasury-proof]", "Reward eligibility has not been checked yet.");
    updateRewardsAvailability();
  }
}

function rewardActionButton(action: string, route?: string): HTMLButtonElement | null {
  const selector = route ? `[data-reward-action="${action}"][data-reward-route="${route}"]` : `[data-reward-action="${action}"]`;
  return query<HTMLButtonElement>(selector);
}

function setContinuousRewardsView(enabled: boolean): void {
  text("[data-holder-reward-summary]",enabled?"Rewards become available over time. Rewards already earned remain claimable after selling.":"Select a token to view its reward distribution.");
  queryAll<HTMLElement>("[data-legacy-treasury]").forEach((el) => { el.hidden = enabled; });
  queryAll<HTMLElement>("[data-continuous-treasury]").forEach((el) => { el.hidden = !enabled; });
}

function updateRewardsAvailability(): void {
  renderStakeSubmit();
  const stakeBusy=currentStakeOperationBusy();
  const stakeInput=query<HTMLInputElement>('#stake-amount');if(stakeInput)stakeInput.disabled=!rewardPosition||stakeBusy||stakeSubmitting;
  const max=query<HTMLButtonElement>('[data-stake-max]');if(max)max.disabled=!rewardPosition||stakeBusy||stakeSubmitting;
  const open=query<HTMLButtonElement>('[data-open-stake]');if(open){open.disabled=stakeBusy||stakeSubmitting||!!wallet&&!rewardPosition;open.innerHTML=wallet?'<i class="ph ph-plus" aria-hidden="true"></i> Add Stake':'<i class="ph ph-wallet" aria-hidden="true"></i> Connect Wallet';}
  queryAll<HTMLButtonElement>('[data-close-stake]').forEach(button=>{button.disabled=stakeBusy||stakeSubmitting;});
  const copy = query<HTMLButtonElement>("[data-copy-beneficiary]"); if (copy) copy.disabled = !creatorReward;
  queryAll<HTMLButtonElement>("[data-rewards-connect]").forEach(button=>button.hidden=!!wallet);
  const claimPage=query<HTMLElement>(".claim-page");if(claimPage)claimPage.dataset.walletConnected=String(!!wallet);
  if(!wallet)queryAll<HTMLElement>("[data-legacy-treasury],[data-continuous-treasury],[data-snapshot-rewards]").forEach(panel=>panel.hidden=true);
  const prerequisite = !wallet ? 'Connect your wallet.' : !foundation?.writeReady ? 'Transactions are unavailable until the market connection is restored.' : '';
  if(creatorDirectoryError)text('[data-creator-status]',creatorDirectoryError);
  text('[data-holder-action-help]', prerequisite || (snapshotRewardStatus ? '' : continuousReward ? continuousReward.claimable > 0n ? '' : 'No rewards available yet.' : treasuryReward ? treasuryReward.accountClaimed ? 'You have already claimed this reward cycle.' : treasuryReward.status === 3 && treasuryReward.proof ? treasuryReward.now > treasuryReward.claimUntil ? 'This reward cycle has expired.' : 'Your verified reward is ready to claim.' : 'Rewards will be available after this cycle closes and its distribution is ready. See cycle status below.' : ''));

  queryAll<HTMLButtonElement>("[data-reward-action]").forEach((button) => {setDisabled(button, true);if(currentPage()==='rewards')button.hidden=!wallet;});
  const direct = rewardActionButton("directVaultRageQuit");
  if (direct) {
    setDisabled(
      direct,
      !wallet
        || (directEscape ? transactionScopeBusy({businessType:'stake',marketId:directEscape.marketId,conflictKey:`stake:${directEscape.marketId}`}) : false)
        || !runtimeConfig.rageQuitFactory.available
        || !directEscape
        || directEscape.allocated <= 0n
        || directEscape.marketId !== (query<HTMLInputElement>("[data-direct-vault-market]")?.value.trim().toLowerCase() ?? ""),
    );
  }
  if (!writeReady()||stakeSubmitting||rewardChoicePending||creatorClaimPreparing) return;
  if (snapshotReward && wallet?.account.toLowerCase() === snapshotReward.page.identity.account.toLowerCase()) {
    const round = selectedSnapshotRound();
    const button = rewardActionButton('claimSnapshot');
    if (button) setDisabled(button, !runtimeConfig.snapshotHolderWrites.available || !round || remainingSnapshotAssets(round) === 0 || Boolean(snapshotRewardRequest));
  }
  if (continuousReward && writeReady() && runtimeConfig.continuousHolderModes.includes(continuousReward.mode) && wallet?.account === continuousReward.account) {
    const claim = rewardActionButton("claimContinuous");
    if (claim) setDisabled(claim, continuousReward.claimable <= 0n && continuousReward.memeClaimable <= 0n);
  }
  if (rewardPosition) {
    const normalClaimReady = rewardPosition.allocated === 0n || (rewardPosition.unlockAt > 0n && rewardPosition.now >= rewardPosition.unlockAt);
    const allocationOpen = rewardPosition.asset.status === 1 && rewardPosition.detail.market.launchPhase === 1 && rewardPosition.settlementPrincipal === 0n;
    setDisabled(rewardActionButton("stake")!, stakeBusy || !allocationOpen || !validStakeAmount());
    setDisabled(rewardActionButton("unstakeAndWithdraw")!, stakeBusy || rewardPosition.allocated <= 0n || rewardPosition.detail.market.launchPhase !== 1 || rewardPosition.unlockAt === 0n || rewardPosition.now < rewardPosition.unlockAt);
    const rageQuit=rewardActionButton("rageQuit", "allocation-manager");if(rageQuit)setDisabled(rageQuit,stakeBusy||rewardPosition.allocated<=0n);
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
    if (claim) setDisabled(claim, !ownsCreatorRewards(wallet?.account,creatorReward.beneficiary)||(creatorReward.liability <= 0n && creatorReward.memeLiability <= 0n && (creatorReward.pendingQuote??0n)<=0n));

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
const {default: v1Abis_UserStockVault} = await import('./v1/generated/contracts/legacy/UserStockVault.ts');

  const functionName = name === "free" ? "freeBalanceOf" : name === "allocated" ? "allocation" : "rageQuitSettlementPrincipal";
  const args = name === "free"
    ? [state.asset.assetUid, account] as const
    : [state.asset.assetUid, account, state.detail.market.marketId] as const;
  return publicClient.readContract({
    abi: v1Abis_UserStockVault,
    address: state.asset.userStockVault,
    functionName,
    args,
    ...(blockNumber === undefined ? {} : { blockNumber }),
  } as never) as Promise<bigint>;
}

async function executePositionAction(action: string, button: HTMLButtonElement): Promise<void> {
  const actions = await import('./v1/features/vault.ts').catch(() => null);
  if (!actions) { notify('Could not load this action. Please try again.', 'warning'); return; }
  const {buildStake,buildStockApproval,buildUnstakeAndWithdraw,buildRageQuit} = actions;
  if (!foundation || !wallet || !rewardPosition) throw new Error("Load a verified wallet position first");
  const activeWallet = wallet;
  const account = activeWallet.account;
  await verifyLiveWalletContext(activeWallet);
  const requestedMarket=rewardPosition.detail.market.marketId;
  const state=await readRewardPositionState(await getRewardMarketDetail(rewardPosition.detail.market));
  if(wallet!==activeWallet||query<HTMLSelectElement>('[data-position-market]')?.value!==requestedMarket)throw Error('Wallet or market changed; review your stake again');
  const marketId = state.detail.market.marketId;
  const verifyChain = async () => { await ensureCanonicalMarket(state.detail.market); await ensureCanonicalAsset(state.assetConfig, verifiedMarketRuntime.get(state.detail.market.marketId)); };
  const form = button.closest<HTMLFormElement>("form");
  const amountFrom = (name: string, label: string) => parseTokenAmount(required<HTMLInputElement>(`[name=${name}]`, form ?? document).value, state.asset.tokenDecimals, label);
  let request: ContractWriteRequest;
  let approval: ContractWriteRequest | undefined;
  let stakeAmount:bigint|undefined;
  if (action === "stake") {
    const amount = amountFrom("amount", "Stake amount");
    stakeAmount=amount;
    validateMarketStake(amount, state.walletBalance, state.allocated, state.asset.minimumAllocation);
    request = buildStake(marketRelease(marketId).allocationManager, marketId, amount);
    approval = await allowanceApproval(buildStockApproval(state.asset.stockToken, state.asset.userStockVault, amount), state.asset.stockToken, state.asset.userStockVault, amount, account);

  } else if (action === "unstakeAndWithdraw") {
    if (state.allocated <= 0n) throw new Error("There is no stake to withdraw");
    request = buildUnstakeAndWithdraw(marketRelease(marketId).allocationManager, marketId);

  } else if (action === "rageQuit") {
    if (state.allocated <= 0n) throw new Error("There is no principal to escape");
    request = buildRageQuit(marketRelease(marketId).allocationManager, marketId);

  } else {
    throw new Error("Unknown position action");
  }
  await executeTransaction({
    operationKey: `reward:${action}:${marketId}:${account}:${foundation.sync.revision}`,
    sync: {...foundation.sync,status:"synced",revision:`${state.observedBlock}:${state.observedBlockHash}`,blockNumber:String(state.observedBlock),blockHash:state.observedBlockHash},
    request,
    ...(approval ? { approval } : {}),
    walletContext: activeWallet,
    verifyChain,
    confirm:async receipt=>{
      const {default:abi}=await import('./v1/generated/contracts/legacy/UserStockVault.ts');
      const block=await publicClient.getBlock({blockNumber:receipt.blockNumber});
      if(block.hash!==receipt.blockHash)throw Error('Stake receipt block changed');
      return verifyStakeReceipt(receipt,{abi,vault:state.asset.userStockVault,assetUid:state.asset.assetUid,marketId,account,target:request.address,action:action as 'stake'|'unstakeAndWithdraw'|'rageQuit',...(stakeAmount===undefined?{}:{stakeAmount})});
    },
  });

  stakeStatsCache.delete(marketId);
  stakeDirectoryAt=0;
  if(action!=="stake")notify(action === "rageQuit" ? "Principal returned immediately; reward cleanup state refreshed" : "Position Updated", "success");
  tradeStakeTotals.clear();
  await refreshRewardPosition();
  if(action==='stake'){
    const input=query<HTMLInputElement>('#stake-amount');if(input)input.value='';
    updateStakePreview();query<HTMLDialogElement>('[data-stake-dialog]')?.close();
  }
}

async function executeDirectVaultRageQuit(): Promise<void> {
  const actions = await import('./v1/features/vault.ts').catch(() => null);
  if (!actions) { notify('Could not load this action. Please try again.', 'warning'); return; }
  const {buildDirectRageQuit} = actions;
  if (!wallet) throw new Error("Connect a wallet first");
  const activeWallet = wallet;
  const marketId = canonicalBytes32(
    required<HTMLInputElement>("[data-direct-vault-market]").value.trim().toLowerCase(),
    "Direct escape marketId",
  );
  const state = await readDirectEscapeState(marketId, activeWallet.account);
  if (state.allocated <= 0n) throw new Error("There is no allocated principal to escape");

  const operationKey = `reward:direct-vault-rage-quit:${marketId}:${activeWallet.account}:${state.allocated}`;
  activeOperations.set(operationKey,{businessType:'stake',marketId,conflictKey:`stake:${marketId}`});
  refreshActionAvailability();
  try {
    await activeWallet.executor.execute({
      operationKey,
      scope:{businessType:'stake',marketId,conflictKey:`stake:${marketId}`},
      expectedAccount: activeWallet.account,
      snapshot: { executionSpecId: V1_EXECUTION_SPEC_ID, revision: state.revision, syncStatus: "synced" },
      request: buildDirectRageQuit(state.vault, state.assetUid, state.marketId),
      confirmations: 1,
      verifyWalletContext: () => verifyLiveWalletContext(activeWallet),
      currentRevision: async () => (await readDirectEscapeState(state.marketId, activeWallet.account)).revision,
      confirm: async (receipt) => {
const {default: v1Abis_UserStockVault} = await import('./v1/generated/contracts/legacy/UserStockVault.ts');

        const block=await publicClient.getBlock({blockNumber:receipt.blockNumber});
        if(block.hash!==receipt.blockHash)throw Error('Exit receipt block changed');
        return verifyStakeReceipt(receipt,{abi:v1Abis_UserStockVault,vault:state.vault,target:state.vault,assetUid:state.assetUid,marketId:state.marketId,account:activeWallet.account,action:'rageQuit'});
      },
      onUpdate: showTransactionUpdate,
    });
    notify("Full allocated STOCK principal returned through the independent Vault escape", "success");
  } finally {
    activeOperations.delete(operationKey);
    refreshActionAvailability();
  }
  await refreshDirectEscape();
  tradeStakeTotals.clear();
  await refreshRewardPosition();
}

async function executeSettlement(): Promise<void> {
const {default: v1Abis_UserStockVault} = await import('./v1/generated/contracts/legacy/UserStockVault.ts');

const {default: v1Abis_AllocationManager} = await import('./v1/generated/contracts/legacy/AllocationManager.ts');

  const actions = await import('./v1/features/vault.ts').catch(() => null);
  if (!actions) { notify('Could not load this action. Please try again.', 'warning'); return; }
  const {buildSettleRageQuitRewards} = actions;
  if (!foundation || !wallet || !rewardPosition) throw new Error("Load a verified market first");
  const activeWallet = wallet;
  const state = rewardPosition;
  await verifyLiveWalletContext(activeWallet);
  const marketId = canonicalBytes32(required<HTMLSelectElement>("[data-settle-market]").value, "Settlement market");
  if (marketId !== state.detail.market.marketId) throw new Error("Settlement market differs from the verified position market");
  const user = canonicalAddress(required<HTMLInputElement>("[data-settle-user]").value.trim(), "Position owner");
  const principal = await publicClient.readContract({ abi: v1Abis_UserStockVault, address: state.asset.userStockVault, functionName: "rageQuitSettlementPrincipal", args: [state.asset.assetUid, user, marketId] });
  if (principal <= 0n) throw new Error("No deferred rage-quit reward settlement exists for this account");
  await executeTransaction({
    operationKey: `reward:settle:${marketId}:${user}:${foundation.sync.revision}`,
    sync: foundation.sync,
    request: buildSettleRageQuitRewards(marketRelease(marketId).allocationManager, marketId, user),
    walletContext: activeWallet,
    verifyChain: () => ensureCanonicalMarket(state.detail.market),
    confirm: async (receipt) => {
const {default: v1Abis_UserStockVault} = await import('./v1/generated/contracts/legacy/UserStockVault.ts');

      receiptEvent(receipt, marketRelease(marketId).allocationManager, v1Abis_AllocationManager, "RageQuitRewardSettlementFinalized", (args) => String(args.user).toLowerCase() === user && args.marketId === marketId && args.principal === principal);
      const after = await publicClient.readContract({ abi: v1Abis_UserStockVault, address: state.asset.userStockVault, functionName: "rageQuitSettlementPrincipal", args: [state.asset.assetUid, user, marketId], blockNumber: receipt.blockNumber });
      if (after !== 0n) throw new Error("Deferred settlement tombstone remains after settlement");
      return after;
    },
  });
  notify("Forfeited rewards settled; principal was not transferred twice", "success");
  tradeStakeTotals.clear();
  await refreshRewardPosition();
}

let rewardClaimOutcomeMessage='';
let rewardChoicePending=false;
let rewardChoiceCancelled=false;
async function executeUserClaim(market: Parameters<typeof marketMetadata>[0],role: 0|1|2,epoch=0,claimBalances?:readonly bigint[]): Promise<void> {
const {default: currentV4Abis_ProtocolFeeVault} = await import('./v1/generated/contracts/current/ProtocolFeeVault.ts');
const {rewardClaimDialog} = await import('./ui/reward-claim-dialog.ts');
const {rawUserClaimRequest} = await import('./v1/features/userClaims.ts');
const {userClaimOutcome} = await import('./v1/features/userClaims.ts');

  if(rewardChoicePending)throw Error('A Claim Is Already In Progress');
  rewardChoicePending=true;
  rewardClaimOutcomeMessage='';
  queryAll<HTMLButtonElement>('[data-reward-action^=claim]').forEach(button=>{button.disabled=true;button.setAttribute('aria-busy','true');});
  try {
  if(!foundation||!wallet)throw Error('Connect Wallet');
  const activeWallet=wallet, feeVault=marketRelease(market.marketId).feeVault;
  const claimMode=await usesUserClaims(feeVault);
  const metadata=await marketMetadata(market);
  const balances=claimBalances??(role===0?[creatorReward?.liability??0n,creatorReward?.memeLiability??0n]:role===1?[rewardPosition?.quoteClaimable??0n,rewardPosition?.memeClaimable??0n]:[continuousReward?.claimable??0n,continuousReward?.memeClaimable??0n]);
  const burn=market.burnMemeFees===true;
  if(balances.every(amount=>amount===0n))throw Error("No rewards available to claim");
  await import('./ui/reward-claim-dialog.css');
  const choice=await rewardClaimDialog({quote:metadata.quoteSymbol,meme:metadata.symbol}, (burn ? (balances[0]! > 0n ? 1 : 2) : ((balances[0]! > 0n ? 1 : 0) | (balances[1]! > 0n ? 2 : 0))) as 1|2|3, burn);
  if(!choice){rewardChoiceCancelled=true;return;}
  await verifyLiveWalletContext(activeWallet);
  const claimBlock=await publicClient.getBlock({blockTag:'latest'});
  const claimSync=claimBlock?{...foundation.sync,status:'synced' as const,revision:`${claimBlock.number}:${claimBlock.hash}`,blockNumber:String(claimBlock.number),blockHash:claimBlock.hash}:foundation.sync;
  const claimRequest=rawUserClaimRequest(claimMode,feeVault,market.marketId,role,epoch,choice);
  const outcome=await executeTransaction({
    operationKey:`reward:user-claim:${market.marketId}:${role}:${epoch}:${activeWallet.account}:${claimSync.revision}`,
    sync:claimSync,walletContext:activeWallet,
    request:createContractWriteRequest(claimRequest),
    verifyChain:()=>ensureCanonicalMarket(market),
    confirm:async receipt=>{
      const paid=receiptEvent(receipt,feeVault,claimRequest.abi,'UserRewardsClaimed',args=>args.marketId===market.marketId&&String(args.user).toLowerCase()===activeWallet.account&&Number(args.role)===role&&Number(args.creatorEpoch)===epoch);
      let memeBurned=0n;
      for(const log of receipt.logs)if(log.address.toLowerCase()===feeVault.toLowerCase()){
        try{const e=decodeEventLog({abi:currentV4Abis_ProtocolFeeVault,data:log.data,topics:log.topics});
          if(e.eventName==='MemeFeesBurned'&&e.args.marketId===market.marketId&&e.args.beneficiary.toLowerCase()===activeWallet.account&&Number(e.args.role)===role&&Number(e.args.creatorEpoch)===epoch&&e.args.token.toLowerCase()===market.memeToken.toLowerCase())memeBurned+=e.args.amount;
        }catch{/* Other vault events have unrelated shapes. */}
      }
      if(burn&&paid.memePaid!==0n)throw Error('Burn-mode claim unexpectedly paid the created token');
      if(!burn&&memeBurned!==0n)throw Error('Unexpected created-token reward burn');
      return {...paid,quotePaid:paid.quotePaid,memeBurned};
    },
  });
  tradeStakeTotals.clear();
  rewardClaimOutcomeMessage=outcome.memeBurned>0n ? `${outcome.quotePaid && outcome.quotePaid!==0n ? "Quote claimed. " : ""}${formatTokenAmount(outcome.memeBurned,18)} ${metadata.symbol} permanently burned.` : userClaimOutcome(outcome);
  await refreshActiveReward();
  } finally { rewardChoicePending=false;queryAll<HTMLButtonElement>('[data-reward-action^=claim]').forEach(button=>button.removeAttribute('aria-busy'));updateRewardsAvailability(); }
}

async function executeStakerClaim(): Promise<void> {
  if (!foundation || !wallet || !rewardPosition) throw new Error("Load A Reward Position First");
  await executeUserClaim(rewardPosition.detail.market, 1);
  await refreshRewardPosition();
}

async function executeCreatorAction(action:string):Promise<void>{
 if(action!=='claimCreator')throw Error('This action is not available.');
 if(creatorClaimPreparing||rewardChoicePending)throw Error('A claim is already in progress.');
 creatorClaimPreparing=true;updateRewardsAvailability();
 try{
 if(!foundation||!wallet||!creatorReward||!runtimeConfig.contracts.available)throw Error('Load your rewards first.');
 const activeWallet=wallet,state=creatorReward,market=selectedRewardMarket('[data-creator-market]');
 if(market.marketId!==state.marketId)throw Error('Select your token again.');
 await verifyLiveWalletContext(activeWallet);await ensureCanonicalMarket(market);
 const release=marketRelease(market.marketId);
 const {default:registryAbi}=await import('./v1/generated/contracts/current/CreatorRevenueRegistry.ts');
 const {default:vaultAbi}=await import('./v1/generated/contracts/current/ProtocolFeeVault.ts');
 const {default:curveAbi}=await import('./v1/generated/contracts/current/TickerGardenCurve.ts');
 let block=await publicClient.getBlock({blockTag:'latest'});
 const [owner,currentEpoch]=await Promise.all([
  publicClient.readContract({abi:registryAbi,address:release.creatorRegistry,functionName:'creatorBeneficiaryAt',args:[market.marketId,state.epoch],blockNumber:block.number}),
  publicClient.readContract({abi:registryAbi,address:release.creatorRegistry,functionName:'currentCreatorEpoch',args:[market.marketId],blockNumber:block.number})]);
 if(!ownsCreatorRewards(activeWallet.account,owner))throw Error('No Creator Rewards For This Wallet');
 const raw=await readWalletMarket(release.marketRegistry,market.marketId);
 if(Number(raw.runtime.launchPhase)===0&&state.epoch===currentEpoch){
  const curve=raw.config.curve;
  const pending=await publicClient.readContract({abi:curveAbi,address:curve,functionName:'accruedCurveFees',blockNumber:block.number});
  if(pending>0n){
   text('[data-creator-status]','Preparing your rewards…');
   await executeTransaction({operationKey:`reward:creator-sweep:${market.marketId}:${activeWallet.account}:${block.number}:${block.hash}`,walletContext:activeWallet,
    sync:{...foundation.sync,status:'synced',revision:`${block.number}:${block.hash}`,blockNumber:String(block.number),blockHash:block.hash},
    request:createContractWriteRequest({abi:curveAbi,address:curve,functionName:'sweepCurveFees',args:[]}),verifyChain:()=>ensureCanonicalMarket(market),
    // A concurrent permissionless sweep makes this a valid zero-amount no-op.
    confirm:async receipt=>{if(receipt.status!=='success')throw Error('Rewards could not be prepared. Please try again.');return true;}});
   block=await publicClient.getBlock({blockTag:'latest'});
  }
 }
 await verifyLiveWalletContext(activeWallet);
 const [quote,meme]=await Promise.all([
  publicClient.readContract({abi:vaultAbi,address:release.feeVault,functionName:'creatorLiability',args:[market.marketId,state.epoch,market.quoteAsset],blockNumber:block.number}),
  publicClient.readContract({abi:vaultAbi,address:release.feeVault,functionName:'creatorLiability',args:[market.marketId,state.epoch,market.memeToken],blockNumber:block.number})]);
 await executeUserClaim(market,0,state.epoch,[quote,meme]);
 void refreshCreatorReward();
 }finally{creatorClaimPreparing=false;updateRewardsAvailability();void refreshCreatorReward();}
}

async function ensureTreasuryActionState(state: TreasuryRewardState, action: string, account: Address): Promise<void> {
const {default: v1Abis_TreasuryDistributorV1} = await import('./v1/generated/contracts/legacy/TreasuryDistributorV1.ts');

  if (!runtimeConfig.contracts.available || !runtimeConfig.treasuryWrites.available) {
    throw new Error("Holder claims are temporarily unavailable. Please try again later.");
  }
  const distributor = marketRelease(state.detail.market.marketId).holderDistributor;
  if (action === "withdrawServiceCredit") {
    const amount = await publicClient.readContract({ abi: v1Abis_TreasuryDistributorV1, address: distributor, functionName: "serviceCredit", args: [state.serviceCreditAsset, account] });
    if (amount !== state.serviceCreditAmount || amount <= 0n) throw new Error("Holder fee-sharing service credit changed; refresh before signing");
    return;
  }
  await ensureCanonicalMarket(state.detail.market);
  const [rawMarket, rawEpoch] = await Promise.all([
    publicClient.readContract({ abi: v1Abis_TreasuryDistributorV1, address: distributor, functionName: "market", args: [state.detail.market.marketId] }),
    publicClient.readContract({ abi: v1Abis_TreasuryDistributorV1, address: distributor, functionName: "epoch", args: [state.detail.market.marketId, state.epochId] }),
  ]);
  if (
    canonicalAddress(tupleString(rawMarket, "memeToken", 0), "holder fee-sharing created token") !== state.detail.market.memeToken
    || canonicalAddress(tupleString(rawMarket, "quoteToken", 1), "holder fee-sharing Quote token", true) !== state.detail.market.quoteAsset
    || tupleBigInt(rawMarket, "activatedAt", 3) <= 0n
  ) throw new Error("Holder fee-sharing market binding changed; refresh before signing");
  if (tupleNumber(rawEpoch, "status", 6) !== state.status) throw new Error("Holder fee-sharing epoch status changed; refresh before signing");
  if (action === "requestRoot") {
    const [rawFee, quoteAmount] = await Promise.all([
      publicClient.readContract({ abi: v1Abis_TreasuryDistributorV1, address: distributor, functionName: "rootServiceFee" }),
      publicClient.readContract({ abi: v1Abis_TreasuryDistributorV1, address: distributor, functionName: "epochQuoteAmount", args: [state.detail.market.marketId, state.epochId] }),
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
const {DUAL_HOLDER_MODE} = await import('./v1/features/userClaims.ts');

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
  const actions = await import('./v1/features/treasury.ts').catch(() => null);
  if (!actions) { notify('Could not load this action. Please try again.', 'warning'); return; }
  const {buildRequestRoot,buildTreasuryClaim,buildFinalizeRoot,buildExpireRoot,buildRolloverEpoch,buildWithdrawServiceCredit} = actions;
  if (!foundation || !wallet || !treasuryReward || !runtimeConfig.contracts.available) throw new Error("Load a verified holder fee-sharing epoch first");
  if (!runtimeConfig.treasuryWrites.available) throw new Error("Holder claims are temporarily paused. Please check again later.");
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
    if (state.holderBalance <= 0n) throw new Error("The connected wallet does not currently hold this token");
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
const {default: v1Abis_TreasuryDistributorV1} = await import('./v1/generated/contracts/legacy/TreasuryDistributorV1.ts');

      if (action === "withdrawServiceCredit") {
        const event = receiptEvent(receipt, distributor, v1Abis_TreasuryDistributorV1, eventName, (eventArgs) =>
          String(eventArgs.asset).toLowerCase() === state.serviceCreditAsset
          && String(eventArgs.beneficiary).toLowerCase() === account
          && eventArgs.amount === state.serviceCreditAmount,
        );
        const creditAfter = await publicClient.readContract({ abi: v1Abis_TreasuryDistributorV1, address: distributor, functionName: "serviceCredit", args: [state.serviceCreditAsset, account], blockNumber: receipt.blockNumber });
        if (creditAfter !== 0n) throw new Error("Holder fee-sharing service credit is not zero at the receipt block");
        if (serviceAssetBalanceBefore !== null) {
          const balanceAfter = await publicClient.readContract({ abi: erc20Abi, address: state.serviceCreditAsset, functionName: "balanceOf", args: [account], blockNumber: receipt.blockNumber });
          if (balanceAfter !== serviceAssetBalanceBefore + state.serviceCreditAmount) throw new Error("ERC-20 service credit was not paid exactly");
        }
        return event;
      }
      const args = receiptEvent(receipt, distributor, v1Abis_TreasuryDistributorV1, eventName, (eventArgs) => eventArgs.marketId === marketId && Number(eventArgs.epochId ?? eventArgs.fromEpochId) === state.epochId);
      if (action === "requestRoot" && (
        String(args.requester).toLowerCase() !== account
        || args.quoteAmount !== state.epochQuoteAmount
        || String(args.serviceFeeAsset).toLowerCase() !== state.serviceFeeAsset
        || args.serviceFeeAmount !== state.serviceFeeAmount
      )) throw new Error("Root request event differs from the verified holder, funding, or service fee");
      if (action === "claim") {
        if (!state.proof || String(args.account).toLowerCase() !== account || args.leafIndex !== state.proof.leafIndex || args.twab !== state.proof.twab || args.amount !== state.proof.amount) throw new Error("Holder fee-sharing claim event differs from the verified leaf");
        const claimed = await publicClient.readContract({ abi: v1Abis_TreasuryDistributorV1, address: distributor, functionName: "accountClaimed", args: [marketId, state.epochId, account], blockNumber: receipt.blockNumber });
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
        receiptEvent(receipt, distributor, v1Abis_TreasuryDistributorV1, "EpochRemainderRolledOver", (event) =>
          event.marketId === marketId && Number(event.fromEpochId) === state.epochId && Number(event.toEpochId) > state.epochId && event.amount === state.quoteAmount);
      }
      const freshEpoch = await publicClient.readContract({ abi: v1Abis_TreasuryDistributorV1, address: distributor, functionName: "epoch", args: [marketId, state.epochId], blockNumber: receipt.blockNumber });
      const expectedStatus = action === "requestRoot" ? 1 : action === "expireRootRequest" ? 0 : action === "rolloverExpiredEpoch" || (action === "finalizeRoot" && state.leafCount === 0) ? 4 : 3;
      if (tupleNumber(freshEpoch, "status", 6) !== expectedStatus) throw new Error("Holder fee-sharing receipt-block state does not match the confirmed action");
      if (action === "finalizeRoot" && tupleBigInt(freshEpoch, "claimUntil", 3) !== args.claimUntil) {
        throw new Error("Holder fee-sharing receipt-block claim window differs from the finalized event");
      }
      return args;
    },
  });
  notify(`Holder fee-sharing ${action} confirmed from its canonical event`, "success");
  await refreshTreasuryReward(false);
}

async function runRewardAction(button: HTMLButtonElement): Promise<void> {
  const action = button.dataset.rewardAction ?? "";
  if (['rageQuit','directVaultRageQuit'].includes(action) && !await confirmFlowAction('Return all principal immediately? All unclaimed rewards in this position will be permanently forfeited to the platform.')) return;

  if(action==='stake'){
    if(stakeSubmitting)return;
    const form=button.closest<HTMLFormElement>('form');if(form&&!form.reportValidity())return;
    stakeSubmitting=true;stakeSubmittingLabel='Preparing Stake…';
    updateRewardsAvailability();
  }else{rewardChoiceCancelled=false;}
  try {
    if(action==='stake'&&rewardPosition&&rewardPosition.allocated>0n){
      if(!await confirmFlowAction('Adding stake restarts the 24-hour lock for your entire position and reward claims.',{title:'Confirm Stake',confirmLabel:'Stake'}))return;
    }
    if(action==='unstakeAndWithdraw'){
      if(!rewardPosition)throw Error('Load a reward position first');
      if(!await confirmFlowAction('',{title:'Unstake all?',confirmLabel:'Unstake all',content:unstakeConfirmationContent(rewardPosition),className:'unstake-confirm'}))return;
    }
    const form = button.closest<HTMLFormElement>("form");
    if (form && !form.reportValidity()) {
      notify("Complete the highlighted Rewards fields before continuing", "error");
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

    } else if (action === "claimCreator") {
      await executeCreatorAction(action);
    } else if (action === "claimSnapshot") {
      await executeSnapshotClaim();
    } else if (action === "claimContinuous") {
      await executeContinuousHolderClaim();
    } else if (["requestRoot", "claim", "finalizeRoot", "expireRootRequest", "rolloverExpiredEpoch", "withdrawServiceCredit"].includes(action)) {
      await executeTreasuryAction(action);
    } else {
      throw new Error("Unknown Rewards action");
    }
    if(action!=='stake'&&!rewardChoiceCancelled&&rewardClaimOutcomeMessage)notify(rewardClaimOutcomeMessage,'success');
    rewardClaimOutcomeMessage='';
    rewardChoiceCancelled=false;
  } catch (error) {
    reportClientError(error,{flow:action==='stake'?'stake':'claim',step:action});
    if(action==='stake'){
      const marketId=rewardPosition?.detail.market.marketId??query<HTMLSelectElement>('[data-position-market]')?.value;
      const pending=!!wallet&&wallet.executor.pending(wallet.account).some(p=>p.businessType==='stake'&&p.marketId===marketId);
      const message=stakeErrorMessage(error,pending);
      if(pending)void recoverPendingStake().catch(()=>{});
      notify(message,'error');
    }else{
      notify(publicError(error,'transaction'),'error');
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
  if (rewardChoicePending || creatorClaimPreparing || document.hidden || !isRewardsPage()) return;
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
  if(currentPage()==='staking'&&new URLSearchParams(window.location.search).get('action')==='add')stakeMarketOpened=true;
  if(currentPage()==='rewards')await refreshCreatorDirectory();
  if(pageGeneration!==routeGeneration)return;
  if (rewardTab(window.location.hash) === "positions") void refreshAccountBalances();
  const requestedMarket = new URLSearchParams(window.location.search).get("marketId")?.toLowerCase();
  if (foundation && (readApi || (foundation.direct && directMarkets)) && requestedMarket && !rewardDeepLinkApplied) {
    try {
      const marketId = canonicalBytes32(requestedMarket, "Linked marketId");
      if (!foundation.markets.some((market) => market.marketId === marketId)) {
        const current = foundation;
        const detail = current.direct && directMarkets ? await directMarkets.market(marketId) : currentPage()==='staking'?await readApi!.getMarketPageBootstrap({marketId}):await readApi!.getMarket({ marketId, revision: current.sync.revision });
        if (!current.direct&&currentPage()!=='staking') assertFinalizedSync(detail.sync, current.sync.revision, "linked staking market");
        if (pageGeneration !== routeGeneration) return;
        if (foundation !== current || detail.market.marketId !== marketId) throw new Error("Linked market snapshot changed");
        if(currentPage()!=='staking')await ensureCanonicalMarket(detail.market);
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
      text("[data-rewards-status]", publicError(error));
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
  const requestedDefaultMarket = foundation.markets.find((market) => market.marketId === requestedMarket)?.marketId ?? "";
  const defaultMarket = currentPage()==='staking'
    ? requestedDefaultMarket
    : requestedDefaultMarket || foundation.markets.find((market) => market.launchPhase === 1)?.marketId || foundation.markets[0]?.marketId || "";
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
  let pageControls = query<HTMLElement>("[data-runtime-recovery]");
  if (foundation?.marketNextCursor && isRewardsPage()) {
    if (!pageControls) {
      pageControls = document.createElement("div");
      pageControls.dataset.runtimeRecovery = "";
      pageControls.className = "runtime-recovery market-pagination-controls";
      (query<HTMLElement>(".staking-page .stake-content") ?? query<HTMLElement>("main") ?? document.body).prepend(pageControls);
    }
    pageControls.replaceChildren();
    const more = document.createElement("button");
    more.textContent = "Load More Tokens";
    more.onclick = async () => {
      more.disabled = true;
      try { await appendMarketPage(); if (generation === routeGeneration) await refreshCurrentPage(true); }
      catch (error) { if (generation === routeGeneration) notify(publicError(error), "warning"); more.disabled = false; }
    };
    pageControls.append(more);
  } else pageControls?.remove();

  let recoveryPanel = query<HTMLElement>("[data-transaction-recovery]");
  if (wallet) {
    const active = wallet;
    let pending: ReturnType<typeof active.executor.pending> = [];
    try { pending = active.executor.pending(active.account); }
    catch { /* Invalid legacy recovery data must not leak into unrelated product pages. */ }
    const visible=pending.filter(record=>!launchProgress&&pendingTransactionPage(record.operationKey)===currentPage());
    for(const record of visible){
      transactionUpdates.delete(record.operationKey);
      const timer=transactionUpdateDismissals.get(record.operationKey);if(timer)clearTimeout(timer);
      transactionUpdateDismissals.delete(record.operationKey);
    }
    renderTransactionUpdates();
    if(visible.length&&!recoveryPanel){recoveryPanel=document.createElement('section');recoveryPanel.dataset.transactionRecovery='';recoveryPanel.className='transaction-recovery-list';recoveryPanel.setAttribute('aria-label','Pending transactions');globalNoticeRegion().append(recoveryPanel);}
    recoveryPanel?.replaceChildren();
    const observers:(()=>void)[]=[];
    for(const record of visible){
      const row=document.createElement('section');row.className='status-notice transaction-recovery-item';row.dataset.operationKey=record.operationKey;row.setAttribute('role','status');row.setAttribute('aria-live','polite');
      const icon=document.createElement('i');icon.className='ph ph-spinner-gap trade-tx-spinner';icon.setAttribute('aria-hidden','true');
      const content=document.createElement('div');content.className='transaction-recovery-item__content';
      const description = document.createElement("span");
      const replacement=record.stage==='replaced'?record.cancelled?'Cancellation replacement is confirming.':'Replacement transaction is confirming.':'';
      description.textContent = replacement||`${record.approval ? 'Token approval' : 'Transaction'} is still confirming.`;
      const explorer = document.createElement('a'); explorer.textContent = 'View transaction'; explorer.href = `${robinhoodChain.blockExplorers.default.url}/tx/${record.hash}`; explorer.target = '_blank'; explorer.rel = 'noopener noreferrer';
      const recover = document.createElement("button");
      recover.textContent = "Check existing transaction";
      recover.onclick = () => { void runPageAction(async () => {
        recover.disabled = true;
        try {
          const result = await active.executor.reconcilePending(active.account,record.operationKey);
          const succeeded = result?.receipt.status === "success" && !result.cancelled;
          const recoveredTrade=currentPage()==='trade'&&!!result;
          if((tradeAwaitingConfirmation||recoveredTrade)&&result){tradeAwaitingConfirmation=false;tradeTxStatus.update({operationKey:result.approval?'recovered-approval':'recovered-trade',hash:result.receipt.transactionHash,stage:succeeded?'confirmed':'failed'});updateTradeAvailability();}
          if(!recoveredTrade)notify(result?.cancelled ? "Existing transaction was cancelled." : succeeded
            ? result.approval ? "Approval confirmed. The business transaction has not been resubmitted; request a fresh quote." : "Existing transaction succeeded. Review refreshed balances before creating another order."
            : "Existing transaction reverted; no replacement was submitted.", succeeded ? "success" : "warning");
          if(recoveredTrade){
            // A recovered conversion/approval is only the first leg; keep its funded resume state.
            if(succeeded&&!result!.approval&&record.businessType==='trade'&&!record.operationKey.startsWith('trade:conversion:')){if(tradeMarket)completeTradeDisplay(tradeMarket);}
            else await refreshTradeFields(undefined,false);
          }
          else if(currentPage()==='staking'){if(rewardPosition)stakeStatsCache.delete(rewardPosition.detail.market.marketId);await refreshRewardPosition();void refreshStakeDirectory(false,true);}
          else{await loadFoundation();await refreshCurrentPage();}
        } catch (error) { notify(publicError(error,'transaction'), "warning"); recover.disabled = false; }
      }); };
      const actions=document.createElement('div');actions.className='transaction-recovery-item__actions';actions.append(explorer,recover);
      content.append(description,actions);row.append(icon,content);recoveryPanel?.append(row);
      if (runtimeConfig.readApi.available) {
        observers.push(mountTransactionObservation(content, runtimeConfig.readApi.value, robinhoodChain.id, record.hash));
      }
    }
    if(visible.length&&pending.some(record=>record.nonce!==undefined)){
      const ordered=[...pending].filter((record):record is typeof record & {nonce:number}=>record.nonce!==undefined).sort((a,b)=>a.nonce-b.nonce);
      const visibleKeys=new Set(visible.map(record=>record.operationKey));
      if(ordered.length>1&&ordered.slice(1).some(record=>visibleKeys.has(record.operationKey)&&record.nonce>ordered[0]!.nonce)){const hint=document.createElement('small');hint.className='transaction-recovery-nonce';hint.textContent='This transaction may remain queued until the earlier wallet nonce confirms.';recoveryPanel?.append(hint);}
    }
    if(observers.length)stopTransactionObservation=()=>observers.forEach(stop=>stop());
    if(!visible.length)recoveryPanel?.remove();
  } else recoveryPanel?.remove();
}

async function refreshCurrentPage(preserveSnapshot = false): Promise<void> {
  const generation = routeGeneration;
  if (isStaticPage()) { renderWallet(); return; }
  if (["stats","statsStocks"].includes(currentPage())) { await renderStats(); return; }
  if (integrationBootstrapPath && !foundation) await loadFoundation();
  if (!integrationBootstrapPath && readApi && !preserveSnapshot && currentPage()!=="trade" && currentPage()!=="markets") {
    try {
      const health = await readApi.getHealth();
      if (generation !== routeGeneration) return;
      if (!foundation || health.sync.revision !== foundation.sync.revision) await loadFoundation();
    } catch (error) {
      if (generation !== routeGeneration) return;
      foundation = null; foundationError = errorText(error); invalidateSnapshotReads();
    }
  }
  if(currentPage()==='markets'&&!foundation)await loadFoundation();
  if (generation !== routeGeneration) return;
  renderWallet();
  renderRecoveryControls();
  renderTransactionUpdates();
  switch (currentPage()) {
    case "home": await renderHome(); break;
    case "markets": await renderMarkets(); break;
    case "trade":
      await loadTradeMarket();
      break;
    case "create": renderCreateConfig(); break;
    case "statsStocks":
    case "stats": await renderStats(); break;
    case "staking":
    case "rewards": await renderRewards(); break;
    case "docs": setPageStatus("", "success"); break;
  }
  refreshActionAvailability();
  if (foundation?.direct && currentPage() !== 'markets') void refreshDirectDirectory();
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

function invalidateSnapshotReads(preserveTradeDisplay=false,preserveExploreDisplay=currentPage() === "markets"): void {
  clearAccountBalances();
  if (currentPage() === "trade") { if(!preserveTradeDisplay)clearTradeMarketState(); }
  else displayPriceWidget?.setToken(null);
  homeRender.invalidate();
  clearHomeMarketView();
  marketsRender.invalidate();
  if(!preserveExploreDisplay){marketDirectory.reset();clearMarketDirectoryView(false);}
  else if(!foundation)pauseExploreView();
  statsRender.invalidate();
  clearStatsSnapshotView("Stats are temporarily unavailable.");
  // Immutable token identity is keyed by chain, token and quote configuration;
  // a new snapshot or page navigation must not refetch it (bounded to 256 entries).
  if(!preserveTradeDisplay){
    verifiedMarketReleases.clear();
    verifiedMarketRuntime.clear();
    tradeMarketVerified=false;
    ++tradeLoadGeneration;
    ++tradeQuoteGeneration;
    tradeQuote=null;
    window.clearTimeout(tradeQuoteTimer);
    window.clearTimeout(tradeQuoteExpiryTimer);
  }
  ++launchPreviewGeneration;
  ++rewardLoadGeneration;
  ++creatorLoadGeneration;
  ++treasuryLoadGeneration;
  launchPreview = null;
  rewardPosition = null;
  clearCreatorRewardView();
  const preserveContinuous=continuousReward?.account===wallet?.account&&continuousReward?.marketId===query<HTMLSelectElement>('[data-treasury-market]')?.value;
  treasuryReward = null;
  renderRecentHolderMarkets();
  continuousReward = null;
  snapshotReward = null; snapshotRewardRequest?.abort(); snapshotRewardRequest=null; snapshotRewardStatus="";
  query<HTMLElement>("[data-snapshot-rewards]")?.setAttribute("hidden", "");
  if(!preserveContinuous){setContinuousRewardsView(false);queryAll<HTMLElement>('[data-legacy-treasury]').forEach(el=>el.hidden=true);}
  window.clearTimeout(launchPreviewTimer);
}

function startSnapshotUpdates(): void {
  if (integrationBootstrapPath || !runtimeConfig.readApi.available || snapshotPoller) return;
  const baseUrl = runtimeConfig.readApi.value;
  const poller = createSnapshotPoller({
    chainId: robinhoodChain.id,
    canPoll: () => readyRouteGeneration === routeGeneration && !isStaticPage() && currentPage()!=='trade' && currentPage()!=='markets' && currentPage()!=='staking' && currentPage()!=='rewards' && !['stats','statsStocks'].includes(currentPage()) && !walletConnecting && !loadingFoundation && !document.hidden,
    fetchUpdate: (since, signal) => new TickerGardenV1Client(baseUrl, (input, init) => fetch(input, { ...init, signal })).getSnapshotUpdates(since && foundation ? { since } : {}),
    prepare: async (update, signal) => {
      if(currentPage()==='trade'||currentPage()==='markets'||currentPage()==='staking'||currentPage()==='rewards')throw new SnapshotRefreshSuperseded('This page uses its own display stream');
      const route=routeGeneration;
      const generation = ++foundationGeneration;
      const activeWallet = wallet;
      const api = new TickerGardenV1Client(baseUrl, (input, init) => fetch(input, { ...init, signal }));
      const next = await prepareFoundation(api, update.sync, update.mode!=='reset'&&!update.invalidated.includes('configs'));
      return () => {
        if (route!==routeGeneration||currentPage()==='trade'||currentPage()==='markets'||currentPage()==='staking'||currentPage()==='rewards'||generation !== foundationGeneration || activeWallet !== wallet) throw new SnapshotRefreshSuperseded("Snapshot refresh superseded");
        invalidateSnapshotReads(currentPage() === 'trade',currentPage() === 'markets');
        const recentChanged=update.recentVersion!==undefined&&update.recentVersion!==recentMarketVersion;
        recentMarketVersion=update.recentVersion;
        if(recentChanged&&currentPage()==='markets'&&exploreVisiblePage[0]===1&&!['marketCapUsd_desc','recentBuy_desc'].includes(query<HTMLElement>('[data-growing-sort][aria-pressed="true"]')?.dataset.growingSort??''))explorePagers[0].refreshFirstPage();
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
      if(currentPage()==='markets'||currentPage()==='staking'||currentPage()==='rewards')return;
      ++foundationGeneration;
      if(currentPage()==="trade"&&tradeMarket)return;
      foundation = null;
      foundationError = errorText(error);
      pauseAnalytics();
      invalidateSnapshotReads();
      refreshActionAvailability();
      if(currentPage()!=="markets")setPageStatus("Live data is syncing. Reconnecting…", "warning");
    },
  });
  window.addEventListener("online", () => poller.reconnect());
  window.addEventListener("offline", () => {
    poller.stop();
    if(currentPage()==='markets'||currentPage()==='staking'||currentPage()==='rewards')return;
    ++foundationGeneration;
    foundation = null;
    foundationError = "Network unavailable";
    pauseAnalytics();
    invalidateSnapshotReads();
    refreshActionAvailability();
  });
window.addEventListener("pagehide", () => poller.stop());
  window.addEventListener("pageshow", event => { if (event.persisted) poller.reconnect(); });
document.addEventListener("visibilitychange", () => { if (document.hidden) { poller.stop(); pauseAnalytics(); if(currentPage()==='markets')closeExploreEvents(); } else {poller.reconnect();if(currentPage()==='markets'&&!foundation?.direct)openExploreEvents();} });
  snapshotPoller = poller;
  if (!isStaticPage()) poller.start();
}

function isStaticPage(): boolean {
  const page = currentPage();
  return page === "privacy" || page === "terms" || page === "docs" || page === "not-found";
}

let disposeDocs: (() => void) | undefined;
let disposeFieldValidation: (() => void) | undefined;
function unmountPage(): void {
  disposeDocs?.();disposeDocs=undefined;
  statsController?.dispose();

  explorePagers[0].pause();explorePagers[1].pause();explorePageGeneration[0]++;explorePageGeneration[1]++;
  exploreLiveGeneration++;exploreLiveRequest?.abort();exploreLiveRequest=null;
  closeExploreEvents();
  clearCreatorDirectory();++creatorLoadGeneration;
  exploreStockPicker?.destroy();exploreStockPicker=undefined;
  window.clearInterval(stakeCountdownTimer);
  creatorRewardRequest?.abort();creatorRewardWatcher?.stop();creatorRewardWatcher=undefined;creatorRewardWatchKey='';
  stakeStatisticsWatcher?.stop();stakeStatisticsWatcher=undefined;stakeStatisticsWatchMarket='';stakeStatsRequests.clear();stakeRewardHistoryReads.clear();stakePageListeners?.abort();stakePageListeners=undefined;
  clearTimeout(stakeSearchTimer);stakeSearchGeneration++;stakeSearchDirectory.reset();stakeSearchPage=null;stakeSearchKey='';
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
  invalidateSnapshotReads(false,false);
  ++directEscapeLoadGeneration; directEscape = null;
  ++launchImageGeneration; launchImageReading = false; launchImage = undefined;
  preparedMetadataURI = ""; preparedMetadataKey = "";
  launchSalt = randomSalt();
  tradeMarket = null; tradeMetadata = null; tradeMarketVerified = false; tradeSide = "buy";
  marketPhaseFilter = "bloomed"; rewardDeepLinkApplied = false; stakeMarketOpened = false; syncRewardHash = undefined;
  userActivityWidget = null; globalHoldersWidget = null; seriesWidget = null;
  globalStatsWidgets = []; analyticsWidgets = [];
  setTradePageLoading(false);
  detailBalanceLoader.clear();detailBalanceAccount=undefined;
  tokenDetailWidget?.stop();tokenDetailWidget=null;detailContentAbort?.abort();detailContentAbort=null;
  holderWidget = null; tradeHistoryWidget = null; candleWidget = null; displayPriceWidget = null;
}

function mountRoute(route: Route): Promise<void> {
  const generation = ++routeGeneration;
  readyRouteGeneration = 0;
  unmountPage();
  document.body.dataset.page = route.page;
  const outlet = required<HTMLElement>("[data-route-outlet]");
  setupShell();
  renderWallet();
  if(outlet.dataset.prerendered!==route.page)renderRouteLoading(outlet);
  delete outlet.dataset.prerendered;
  return (async () => {
    await Promise.all([route.page==='rewards'||route.page==='staking'?loadRewardPageDependencies(route.page):Promise.resolve(),['stats','statsStocks'].includes(route.page)?ensureStatsController():Promise.resolve(),route.page==='create'?ensureCreateController():Promise.resolve(),route.page==='trade'?ensureTradeController():Promise.resolve()]);
    if(generation!==routeGeneration)return;
    const page = await loadPageTemplate(route.page);
    if (generation !== routeGeneration) return;
    applyPageMetadata(route.page, undefined, route.pathname + window.location.search);
    outlet.innerHTML = page.html;
    const main = outlet.querySelector<HTMLElement>("main");
    if (main) {
      main.id = "main-content";
      main.tabIndex = -1;
      if (generation > 1) main.focus({ preventScroll: true });
    }
    await mountPageWidgets();
    if(generation!==routeGeneration)return;
    disposeFieldValidation=mountFieldValidation(outlet,field=>{
      if(field.matches('[data-reward-amount]'))return rewardPosition?.asset.tokenDecimals;
      if(field.matches('[data-trade-amount]'))return Number(field.dataset.paymentDecimals??(tradeSide==='sell'?18:tradeMetadata?.quoteDecimals));
      if(field.name==='firstBuyAmount'){const id=query<HTMLSelectElement>('[name=quoteAssetConfigId]')?.value;return Number(foundation?.quotes.find(q=>q.id===id)?.values.quoteDecimals??18);}
      return undefined;
    });
    disposeVisuals = mountPageVisuals(outlet);
    switch (route.page) {
      case "markets": setupMarkets(); break;
      case "trade": setupTrade(); break;
      case "create": setupCreate(); break;
      case "statsStocks":
      case "stats": setupStats(); break;
      case "staking":
      case "rewards": setupRewards(); break;
      case "docs": disposeDocs=setupDocs(); break;
    }
    if (isStaticPage()) { assetPrices.pause(); refreshActionAvailability(); return; }
    if (["stats","statsStocks"].includes(route.page)) { assetPrices.pause(); await renderStats(); if(generation===routeGeneration)readyRouteGeneration=generation; return; }
    assetPrices.start();
    const needsFoundation = route.page==='markets' || route.page==='trade' || !foundation || foundation.displayOnly || (foundation.configScope==="read"&&!["markets","stats","statsStocks"].includes(route.page)) || !!foundation.directoryMarketId;
    if (needsFoundation) await loadFoundation();
    if (generation !== routeGeneration) return;
    // A navigation may have joined an in-flight detail-only bootstrap.
    if (foundation?.directoryMarketId && route.page !== "trade") await loadFoundation();
    if (generation !== routeGeneration) return;
    await refreshCurrentPage(needsFoundation);
    if (generation === routeGeneration) {
      readyRouteGeneration = generation;
      if(route.page==='markets'&&!foundation?.direct)openExploreEvents();
      if (foundation&&!foundation.displayOnly&&route.page!=='markets') snapshotPoller?.adoptRevision(foundation.sync.revision);
    }
  })().catch(error => {
    if (generation !== routeGeneration) return;
    foundationError = errorText(error);
    renderRouteFailure(outlet, () => window.location.reload());
    refreshActionAvailability();
  });
}

// Lazy controllers borrow the live application state. Getters/setters deliberately
// preserve one wallet, request generation and transaction state across route changes.
// Controller imports of this module must remain type-only.
export const controllerContext = {
  get loadFoundation(){return loadFoundation;},
  get CONSERVATIVE_LAUNCH_GAS(){return CONSERVATIVE_LAUNCH_GAS;},
  get allowanceApproval(){return allowanceApproval;},
  get assetPrices(){return assetPrices;},
  get candleWidget(){return candleWidget;},
  set candleWidget(value: typeof candleWidget){candleWidget=value;},
  get confirmFlowAction(){return confirmFlowAction;},
  get creatorDirectoryAt(){return creatorDirectoryAt;},
  set creatorDirectoryAt(value: typeof creatorDirectoryAt){creatorDirectoryAt=value;},
  get currentPage(){return currentPage;},
  get curvePricing(){return curvePricing;},
  set curvePricing(value: typeof curvePricing){curvePricing=value;},
  get curvePricingPending(){return curvePricingPending;},
  set curvePricingPending(value: typeof curvePricingPending){curvePricingPending=value;},
  get detailBalanceAccount(){return detailBalanceAccount;},
  set detailBalanceAccount(value: typeof detailBalanceAccount){detailBalanceAccount=value;},
  get detailBalanceLoader(){return detailBalanceLoader;},
  get detailBalances(){return detailBalances;},
  set detailBalances(value: typeof detailBalances){detailBalances=value;},
  get detailContentAbort(){return detailContentAbort;},
  set detailContentAbort(value: typeof detailContentAbort){detailContentAbort=value;},
  get developerBuyBalances(){return developerBuyBalances;},
  get directMarkets(){return directMarkets;},
  set directMarkets(value: typeof directMarkets){directMarkets=value;},
  get displayPriceWidget(){return displayPriceWidget;},
  set displayPriceWidget(value: typeof displayPriceWidget){displayPriceWidget=value;},
  get draftImageMissing(){return draftImageMissing;},
  set draftImageMissing(value: typeof draftImageMissing){draftImageMissing=value;},
  get ensureCanonicalLaunch(){return ensureCanonicalLaunch;},
  get ensureCanonicalMarket(){return ensureCanonicalMarket;},
  get ensureCurrentRevision(){return ensureCurrentRevision;},
  get ensureStandaloneApproval(){return ensureStandaloneApproval;},
  get errorText(){return errorText;},
  get executeTransaction(){return executeTransaction;},
  get findAsset(){return findAsset;},
  get foundation(){return foundation;},
  set foundation(value: typeof foundation){foundation=value;},
  get holderWidget(){return holderWidget;},
  set holderWidget(value: typeof holderWidget){holderWidget=value;},
  get iconText(){return iconText;},
  get latestListing(){return latestListing;},
  set latestListing(value: typeof latestListing){latestListing=value;},
  get launchFunding(){return launchFunding;},
  set launchFunding(value: typeof launchFunding){launchFunding=value;},
  get launchImage(){return launchImage;},
  set launchImage(value: typeof launchImage){launchImage=value;},
  get launchImageGeneration(){return launchImageGeneration;},
  set launchImageGeneration(value: typeof launchImageGeneration){launchImageGeneration=value;},
  get launchImageReading(){return launchImageReading;},
  set launchImageReading(value: typeof launchImageReading){launchImageReading=value;},
  get launchMetadataOrigin(){return launchMetadataOrigin;},
  get launchPreview(){return launchPreview;},
  set launchPreview(value: typeof launchPreview){launchPreview=value;},
  get launchPreviewGeneration(){return launchPreviewGeneration;},
  set launchPreviewGeneration(value: typeof launchPreviewGeneration){launchPreviewGeneration=value;},
  get launchPreviewTimer(){return launchPreviewTimer;},
  set launchPreviewTimer(value: typeof launchPreviewTimer){launchPreviewTimer=value;},
  get launchProgress(){return launchProgress;},
  set launchProgress(value: typeof launchProgress){launchProgress=value;},
  get launchRecoveryBusy(){return launchRecoveryBusy;},
  set launchRecoveryBusy(value: typeof launchRecoveryBusy){launchRecoveryBusy=value;},
  get launchRecoveryTimer(){return launchRecoveryTimer;},
  set launchRecoveryTimer(value: typeof launchRecoveryTimer){launchRecoveryTimer=value;},
  get launchSalt(){return launchSalt;},
  set launchSalt(value: typeof launchSalt){launchSalt=value;},
  get launchSubmitting(){return launchSubmitting;},
  set launchSubmitting(value: typeof launchSubmitting){launchSubmitting=value;},
  get marketBloomProgress(){return marketBloomProgress;},
  get marketMetadata(){return marketMetadata;},
  get marketRelease(){return marketRelease;},
  get notify(){return notify;},
  get overviewLoads(){return overviewLoads;},
  get pendingCreateDraft(){return pendingCreateDraft;},
  set pendingCreateDraft(value: typeof pendingCreateDraft){pendingCreateDraft=value;},
  get poolQuoteBindings(){return poolQuoteBindings;},
  get populateSelect(){return populateSelect;},
  get preparedMetadata(){return preparedMetadata;},
  set preparedMetadata(value: typeof preparedMetadata){preparedMetadata=value;},
  get preparedMetadataKey(){return preparedMetadataKey;},
  set preparedMetadataKey(value: typeof preparedMetadataKey){preparedMetadataKey=value;},
  get preparedMetadataURI(){return preparedMetadataURI;},
  set preparedMetadataURI(value: typeof preparedMetadataURI){preparedMetadataURI=value;},
  get publicClient(){return publicClient;},
  get query(){return query;},
  get queryAll(){return queryAll;},
  get randomSalt(){return randomSalt;},
  get readApi(){return readApi;},
  get readWalletMarket(){return readWalletMarket;},
  get receiptEvent(){return receiptEvent;},
  get required(){return required;},
  get routeGeneration(){return routeGeneration;},
  set routeGeneration(value: typeof routeGeneration){routeGeneration=value;},
  get router(){return router;},
  get runPageAction(){return runPageAction;},
  get runtimeConfig(){return runtimeConfig;},
  get runtimeReasons(){return runtimeReasons;},
  get setDisabled(){return setDisabled;},
  get setPageStatus(){return setPageStatus;},
  get simulationTuple(){return simulationTuple;},
  get snapshotPoller(){return snapshotPoller;},
  set snapshotPoller(value: typeof snapshotPoller){snapshotPoller=value;},
  get stockLogo(){return stockLogo;},
  get stockSymbol(){return stockSymbol;},
  get stockToken(){return stockToken;},
  get text(){return text;},
  get tokenDetailWidget(){return tokenDetailWidget;},
  set tokenDetailWidget(value: typeof tokenDetailWidget){tokenDetailWidget=value;},
  get tradeAutoRefreshPending(){return tradeAutoRefreshPending;},
  set tradeAutoRefreshPending(value: typeof tradeAutoRefreshPending){tradeAutoRefreshPending=value;},
  get tradeFieldsGeneration(){return tradeFieldsGeneration;},
  set tradeFieldsGeneration(value: typeof tradeFieldsGeneration){tradeFieldsGeneration=value;},
  get tradeHistoryWidget(){return tradeHistoryWidget;},
  set tradeHistoryWidget(value: typeof tradeHistoryWidget){tradeHistoryWidget=value;},
  get tradeLoadGeneration(){return tradeLoadGeneration;},
  set tradeLoadGeneration(value: typeof tradeLoadGeneration){tradeLoadGeneration=value;},
  get tradeLoadingTimeout(){return tradeLoadingTimeout;},
  set tradeLoadingTimeout(value: typeof tradeLoadingTimeout){tradeLoadingTimeout=value;},
  get tradeMarket(){return tradeMarket;},
  set tradeMarket(value: typeof tradeMarket){tradeMarket=value;},
  get tradeMarketVerified(){return tradeMarketVerified;},
  set tradeMarketVerified(value: typeof tradeMarketVerified){tradeMarketVerified=value;},
  get tradeMemeLogoUrl(){return tradeMemeLogoUrl;},
  set tradeMemeLogoUrl(value: typeof tradeMemeLogoUrl){tradeMemeLogoUrl=value;},
  get tradeMetadata(){return tradeMetadata;},
  set tradeMetadata(value: typeof tradeMetadata){tradeMetadata=value;},
  get tradePhaseLoading(){return tradePhaseLoading;},
  set tradePhaseLoading(value: typeof tradePhaseLoading){tradePhaseLoading=value;},
  get tradePhaseTimer(){return tradePhaseTimer;},
  set tradePhaseTimer(value: typeof tradePhaseTimer){tradePhaseTimer=value;},
  get tradeQuote(){return tradeQuote;},
  set tradeQuote(value: typeof tradeQuote){tradeQuote=value;},
  get tradeQuoteExpiryTimer(){return tradeQuoteExpiryTimer;},
  set tradeQuoteExpiryTimer(value: typeof tradeQuoteExpiryTimer){tradeQuoteExpiryTimer=value;},
  get tradeQuoteGeneration(){return tradeQuoteGeneration;},
  set tradeQuoteGeneration(value: typeof tradeQuoteGeneration){tradeQuoteGeneration=value;},
  get tradeQuoteTimer(){return tradeQuoteTimer;},
  set tradeQuoteTimer(value: typeof tradeQuoteTimer){tradeQuoteTimer=value;},
  get tradeSide(){return tradeSide;},
  set tradeSide(value: typeof tradeSide){tradeSide=value;},
  get tradeStakeAccount(){return tradeStakeAccount;},
  set tradeStakeAccount(value: typeof tradeStakeAccount){tradeStakeAccount=value;},
  get tradeStakeGeneration(){return tradeStakeGeneration;},
  set tradeStakeGeneration(value: typeof tradeStakeGeneration){tradeStakeGeneration=value;},
  get tradeSubmitting(){return tradeSubmitting;},
  set tradeSubmitting(value: typeof tradeSubmitting){tradeSubmitting=value;},
  get tradeSubmittingLabel(){return tradeSubmittingLabel;},
  set tradeSubmittingLabel(value: typeof tradeSubmittingLabel){tradeSubmittingLabel=value;},
  get tradeSubmittingMarketId(){return tradeSubmittingMarketId;},
  set tradeSubmittingMarketId(value: typeof tradeSubmittingMarketId){tradeSubmittingMarketId=value;},
  get tradeTokenLogoFallback(){return tradeTokenLogoFallback;},
  get transactionScopeBusy(){return transactionScopeBusy;},
  get verifiedMarketReleases(){return verifiedMarketReleases;},
  get verifiedMarketRuntime(){return verifiedMarketRuntime;},
  get verifyLiveWalletContext(){return verifyLiveWalletContext;},
  get verifyTransactionFoundation(){return verifyTransactionFoundation;},
  get wallet(){return wallet;},
  set wallet(value: typeof wallet){wallet=value;},
  get walletConnecting(){return walletConnecting;},
  set walletConnecting(value: typeof walletConnecting){walletConnecting=value;},
  get writeReady(){return writeReady;},
};
export type ControllerContext = typeof controllerContext;

type TradeController = ReturnType<typeof import('./controllers/trade.ts').createTradeController>;
let tradeController: TradeController | undefined;
let tradeControllerRequest: Promise<void>|undefined;
function ensureTradeController():Promise<void>{
 if(tradeController)return Promise.resolve();
 return tradeControllerRequest??=import('./controllers/trade.ts').then(module=>{tradeController=module.createTradeController(controllerContext);}).finally(()=>{tradeControllerRequest=undefined;});
}
type CreateController = ReturnType<typeof import('./controllers/create.ts').createCreateController>;
let createController: CreateController | undefined;
let statsController: ReturnType<typeof import('./controllers/stats.ts').createStatsController>|undefined;
let statsControllerRequest:Promise<void>|undefined;
const statsContext={
get text(){return text;},
get query(){return query;},
get currentPage(){return currentPage;},
get formatMarketUSD(){return formatMarketUSD;},
get runtimeConfig(){return runtimeConfig;},
};
export type StatsContext=typeof statsContext;
function ensureStatsController():Promise<void>{
 if(statsController)return Promise.resolve();
 return statsControllerRequest??=import('./controllers/stats.ts').then(module=>{statsController=module.createStatsController(statsContext);}).finally(()=>{statsControllerRequest=undefined;});
}
let createControllerRequest: Promise<void>|undefined;
function ensureCreateController():Promise<void>{
 if(createController)return Promise.resolve();
 return createControllerRequest??=import('./controllers/create.ts').then(module=>{createController=module.createCreateController(controllerContext);}).finally(()=>{createControllerRequest=undefined;});
}
const router = createRouter({
  render: mountRoute,
  canNavigate: () => !walletConnecting && !launchSubmitting,
  blocked: () => notify("Finish the current wallet operation before leaving this page.", "warning"),
  hashChanged: () => { if (isRewardsPage()) syncRewardHash?.();if(currentPage()==="docs")revealDocsHash(); },
});
router.start();
let assetPriceFingerprint = '';
const unsubscribeAssetPrices = assetPrices.subscribe(snapshot => {
  const fingerprint = JSON.stringify(snapshot); if (fingerprint === assetPriceFingerprint) return; assetPriceFingerprint = fingerprint;
  marketStockSymbols = new Map(Object.values(snapshot.prices).map(price => [price.token, price.symbol]));
  if (tradeMarket) tokenDetailWidget?.setOverview({ usd: assetPrices.midpointUsd(tradeMarket.market.quoteAsset) ?? undefined });
});
void restoreLaunchProgress();
startSnapshotUpdates();
if (import.meta.hot) import.meta.hot.dispose(() => { if(launchRecoveryTimer)clearTimeout(launchRecoveryTimer);closeLaunchProgress();unsubscribeAssetPrices();assetPrices.stop();router.stop(); unmountPage(); });

let directDirectoryBusy=false;
let directDirectoryRequest:Promise<void>|null=null;
let directDirectoryReadAt=0;
async function discoverDirectMarketSources(factory:Address):Promise<void>{
 if(!directMarkets)return;
 const head=await publicClient.getBlockNumber();
 const logs=await publicClient.getLogs({address:factory,fromBlock:0n,toBlock:head});
 for(const log of logs){
  if(log.blockNumber===null||!log.blockHash||!log.transactionHash||log.transactionIndex===null||log.logIndex===null)continue;
  directMarkets.observe({address:log.address,topics:log.topics,data:log.data,blockNumber:log.blockNumber,blockHash:log.blockHash,transactionHash:log.transactionHash,transactionIndex:log.transactionIndex,logIndex:log.logIndex});
 }
}
async function loadLocalIntegrationMarketDirectory():Promise<MarketReadModel[]>{
 if(!directMarkets||!foundation?.direct)return [];
 await discoverDirectMarketSources(directMarkets.deployment.factory);
 const previous=new Map(foundation.markets.map(m=>[m.marketId,m]));
 const records=await mapConcurrent([...directMarkets.sources.keys()],async id=>previous.get(id)??await directMarkets!.market(id).then(x=>x.market).catch(()=>null),4);
 return records.filter((x):x is MarketReadModel=>x!==null);
}
async function refreshDirectDirectory(_renderAfter=true):Promise<void>{
 if(!foundation?.direct||document.hidden||isStaticPage())return;
 if(directDirectoryRequest)return directDirectoryRequest;
 const current=foundation;
 directDirectoryBusy=true;
 const request=(async()=>{
  const markets=await loadLocalIntegrationMarketDirectory();
  if(foundation!==current)return;
  if(JSON.stringify(current.markets)!==JSON.stringify(markets)){
   foundation=Object.freeze({...current,markets});
   if(currentPage()==='staking')stakeDirectPortfolioVerified=false;
   if(_renderAfter){if(['stats','statsStocks'].includes(currentPage()))await renderStats();else if(currentPage()==='home')await renderHome();else if(isRewardsPage()){populateRewardMarkets();if(currentPage()==='staking')void refreshStakeDirectory(false,true);}else if(currentPage()==='markets')await renderMarkets();}
  }
 })();
 directDirectoryRequest=request;
 try{await request;}finally{if(directDirectoryRequest===request)directDirectoryRequest=null;directDirectoryBusy=false;}
}

let directDirectoryTimer: ReturnType<typeof setInterval>|undefined;
if(integrationBootstrapPath)directDirectoryTimer=setInterval(()=>{if(!document.hidden)void refreshDirectDirectory();},30_000);
if(import.meta.hot)import.meta.hot.dispose(()=>{if(directDirectoryTimer)clearInterval(directDirectoryTimer);});

function openExploreEvents():void{
 if(exploreEvents||!runtimeConfig.readApi.available||typeof EventSource==='undefined')return;
 exploreEvents=new EventSource(new URL('/v1/explore/events',runtimeConfig.readApi.value));
 const recover=()=>{exploreStatisticsAt=0;void refreshExploreStatistics().then(()=>applyExploreStatistics());void refreshExploreRankings(true);};
 exploreEvents.addEventListener('ready',()=>{if(currentPage()==='markets')recover();});
 exploreEvents.addEventListener('change',event=>{
  if(currentPage()!=='markets')return;
  let data:{marketId?:string;regions?:string[]};try{data=JSON.parse((event as MessageEvent).data);}catch{return;}
  if(data.marketId&&!/^0x[0-9a-f]{64}$/.test(data.marketId))return;
  if(data.marketId)exploreDirtyIds.add(data.marketId);for(const region of data.regions??[])exploreDirtyRegions.add(region);
  if(exploreEventRefreshTimer)return;
  exploreEventRefreshTimer=window.setTimeout(()=>{
   if(currentPage()!=='markets')return;
   const dirty=[...exploreDirtyIds],regions=new Set(exploreDirtyRegions);exploreDirtyIds.clear();exploreDirtyRegions.clear();exploreEventRefreshTimer=undefined;
   exploreStatisticsAt=0;
   void refreshExploreCards(dirty.length?dirty:undefined).then(()=>applyExploreStatistics(dirty.length?dirty:undefined));
   const listRelevant=regions.has('market')||regions.has('trades');
   if(listRelevant)void refreshExploreRankings(true);
  },150);
 });
}
function closeExploreEvents():void{window.clearTimeout(exploreEventRefreshTimer);exploreEventRefreshTimer=undefined;exploreDirtyIds.clear();exploreDirtyRegions.clear();exploreEvents?.close();exploreEvents=undefined;}
const exploreStatisticsTimer=setInterval(()=>{
 if(currentPage()!=='markets'||document.hidden)return;
 exploreStatisticsAt=0;void refreshExploreStatistics().then(()=>applyExploreStatistics());void refreshExploreRankings(true);
},60_000);
if(import.meta.hot)import.meta.hot.dispose(()=>clearInterval(exploreStatisticsTimer));
