import "@phosphor-icons/web/regular";
import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
  erc20Abi,
  http,
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
  buildAllocate,
  buildClaimStaker,
  buildCloseAllocation,
  buildDeposit,
  buildDepositAndAllocate,
  buildDirectRageQuit,
  buildRageQuit,
  buildSettleRageQuitRewards,
  buildStockApproval,
  buildWithdraw,
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
  configString,
  errorText,
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

interface InjectedProvider {
  request(args: Readonly<{ method: string; params?: readonly unknown[] }>): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

declare global {
  interface Window { ethereum?: InjectedProvider }
}

type Foundation = Readonly<{
  health: HealthResponse;
  sync: SyncStatus;
  assets: readonly ConfigReadModel[];
  quotes: readonly ConfigReadModel[];
  pons: readonly ConfigReadModel[];
  templates: readonly ConfigReadModel[];
  markets: readonly MarketReadModel[];
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

type PageName = "home" | "markets" | "trade" | "create" | "stats" | "rewards" | "faq" | "privacy" | "terms";

const runtimeConfig = parseV1RuntimeConfig(import.meta.env);
const publicClient = createPublicClient({
  chain: robinhoodChain,
  transport: http(robinhoodChain.rpcUrls.default.http[0]),
});
const readApi = runtimeConfig.readApi.available
  ? new TickerGardenV1Client(runtimeConfig.readApi.value)
  : null;

let foundation: Foundation | null = null;
let foundationError = "";
let wallet: WalletState | null = null;
let busyOperation = "";
const metadataCache = new Map<string, Promise<MarketMetadata>>();

const transactionStageLabels: Record<TransactionUpdate["stage"], string> = {
  preflight: "Checking finalized state",
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
  if (element) element.textContent = value;
}

function iconText(selector: string, iconClass: string, value: string): void {
  const element = query<HTMLElement>(selector);
  if (!element) return;
  const icon = document.createElement("i");
  icon.className = `ph ${iconClass}`;
  icon.setAttribute("aria-hidden", "true");
  const message = document.createElement("span");
  message.textContent = value;
  element.replaceChildren(icon, message);
}

function setDisabled(element: HTMLButtonElement | HTMLInputElement | HTMLSelectElement, disabled: boolean): void {
  element.disabled = disabled;
  element.setAttribute("aria-disabled", String(disabled));
}

function currentPage(): PageName {
  const candidate = document.body.dataset.page;
  return (["home", "markets", "trade", "create", "stats", "rewards", "faq", "privacy", "terms"] as const).includes(candidate as PageName)
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
  node.textContent = message;
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
  target.textContent = message;
  target.dataset.state = tone;
}

function runtimeReasons(): readonly string[] {
  if (foundationError) return [foundationError];
  if (!foundation) return runtimeConfig.reasons.length > 0 ? runtimeConfig.reasons : ["Loading V1 runtime"];
  return foundation.writeReasons;
}

function writeReady(): boolean {
  return Boolean(foundation?.writeReady && wallet && !busyOperation);
}

function treasuryWritesReady(): boolean {
  return writeReady() && runtimeConfig.treasuryWrites.available;
}

function snapshot(sync: SyncStatus): ReconciledSnapshot {
  return { executionSpecId: V1_EXECUTION_SPEC_ID, revision: sync.revision, syncStatus: sync.status };
}

async function readAllConfig(kind: ConfigReadModel["kind"], revision: string): Promise<readonly ConfigReadModel[]> {
  if (!readApi) throw new Error("V1 read API is not configured");
  const items: ConfigReadModel[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 16; page += 1) {
    const response = await readApi.listConfig({ kind, limit: 100, ...(cursor ? { cursor } : {}) });
    assertFinalizedSync(response.sync, revision, `${kind} configuration`);
    items.push(...response.items);
    if (!response.nextCursor) return Object.freeze(items);
    cursor = response.nextCursor;
  }
  throw new Error(`${kind} configuration exceeds the bounded browser load`);
}

async function readAllMarkets(revision: string): Promise<readonly MarketReadModel[]> {
  if (!readApi) throw new Error("V1 read API is not configured");
  const items: MarketReadModel[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 16; page += 1) {
    const response = await readApi.listMarkets({ limit: 100, ...(cursor ? { cursor } : {}) });
    assertFinalizedSync(response.sync, revision, "market directory");
    items.push(...response.items);
    if (!response.nextCursor) return Object.freeze(items);
    cursor = response.nextCursor;
  }
  throw new Error("Market directory exceeds the bounded browser load");
}

async function loadFoundation(): Promise<void> {
  if (!readApi) {
    foundationError = runtimeConfig.readApi.available ? "V1 read API is unavailable" : runtimeConfig.readApi.reasons.join("; ");
    return;
  }
  try {
    const health = await readApi.getHealth();
    if (health.executionSpecId !== V1_EXECUTION_SPEC_ID || health.status !== "read-api" || !health.readApiImplemented) {
      throw new Error("Read API does not advertise this V1 execution contract");
    }
    if (health.custody || health.transactionSubmission) throw new Error("Read API violates the non-custodial read-only boundary");
    assertFinalizedSync(health.sync, undefined, "Read API health");
    const revision = health.sync.revision;
    const [assets, quotes, pons, templates, markets] = await Promise.all([
      readAllConfig("asset", revision),
      readAllConfig("quote", revision),
      readAllConfig("pons", revision),
      readAllConfig("template", revision),
      readAllMarkets(revision),
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
    foundation = Object.freeze({
      health,
      sync: health.sync,
      assets,
      quotes,
      pons,
      templates,
      markets,
      ...(bindings ? { bindings } : {}),
      ...(launchFee !== undefined ? { launchFee } : {}),
      writeReady: health.productRuntimeImplemented && reasons.length === 0,
      writeReasons: Object.freeze(reasons),
    });
    foundationError = "";
  } catch (error) {
    foundation = null;
    foundationError = errorText(error);
  }
}

async function ensureCurrentRevision(expected: string): Promise<string> {
  if (!readApi) throw new V1TransactionError("indexer_unavailable", "The V1 read API is unavailable");
  let current: HealthResponse;
  try {
    current = await readApi.getHealth();
  } catch (error) {
    throw new V1TransactionError("indexer_unavailable", "The V1 read API could not verify the current revision", error);
  }
  try {
    assertFinalizedSync(current.sync, expected, "Read API health");
  } catch (error) {
    throw new V1TransactionError("stale_snapshot", "The finalized snapshot changed; refresh before signing", error);
  }
  if (
    current.executionSpecId !== V1_EXECUTION_SPEC_ID
    || !current.productRuntimeImplemented
    || current.custody
    || current.transactionSubmission
  ) throw new V1TransactionError("stale_snapshot", "The V1 capability contract changed; refresh before signing");
  return current.sync.revision;
}

async function ensureCanonicalAsset(config: ConfigReadModel): Promise<CanonicalAssetBinding> {
  if (!foundation?.bindings) throw new Error("Canonical Factory bindings are unavailable");
  const [rawAsset, minimum] = await Promise.all([
    publicClient.readContract({ abi: v1Abis.OfficialStockRegistryV1, address: foundation.bindings.officialStockRegistry, functionName: "asset", args: [config.id] }),
    publicClient.readContract({ abi: v1Abis.OfficialStockRegistryV1, address: foundation.bindings.officialStockRegistry, functionName: "minimumAllocation", args: [config.id] }),
  ]);
  return assertCanonicalAssetBinding(config, rawAsset, minimum);
}

async function ensureCanonicalMarket(market: MarketReadModel): Promise<void> {
  if (!foundation?.bindings) throw new Error("Canonical Factory bindings are unavailable");
  const [rawMarket, rawRoute] = await Promise.all([
    publicClient.readContract({ abi: v1Abis.MarketRegistryV1, address: foundation.bindings.marketRegistry, functionName: "market", args: [market.marketId] }),
    publicClient.readContract({ abi: v1Abis.MarketRegistryV1, address: foundation.bindings.marketRegistry, functionName: "canonicalRoute", args: [market.marketId] }),
  ]);
  assertCanonicalMarketBinding(market, rawMarket, rawRoute);
}

async function ensureCanonicalLaunch(selected: SelectedLaunchConfig): Promise<void> {
  if (!foundation?.bindings) throw new Error("Canonical Factory bindings are unavailable");
  const [asset, quote, pons, template] = await Promise.all([
    publicClient.readContract({ abi: v1Abis.OfficialStockRegistryV1, address: foundation.bindings.officialStockRegistry, functionName: "asset", args: [selected.asset.assetUid] }),
    publicClient.readContract({ abi: v1Abis.ApprovedQuoteRegistry, address: foundation.bindings.approvedQuoteRegistry, functionName: "quoteConfig", args: [selected.quote.configId] }),
    publicClient.readContract({ abi: v1Abis.PonsBaselineRegistry, address: foundation.bindings.ponsBaselineRegistry, functionName: "baseline", args: [selected.pons.baselineId] }),
    publicClient.readContract({ abi: v1Abis.LaunchTemplateRegistry, address: foundation.bindings.launchTemplateRegistry, functionName: "launchTemplate", args: [selected.template.templateId] }),
  ]);
  assertCanonicalLaunchBindings(selected, { asset, quote, pons, template });
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
    throw new V1TransactionError("unsupported_chain", `wallet must remain on Robinhood Chain ${robinhoodChain.id}`);
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
        const detail = update.error ? `${update.error.code}: ${update.error.message}` : update.hash ? shortHex(update.hash, 9, 7) : "";
        toast(`${transactionStageLabels[update.stage]}${detail ? ` — ${detail}` : ""}`, update.stage === "failed" ? "error" : update.stage === "confirmed" ? "success" : "neutral");
      },
    });
  } finally {
    busyOperation = "";
    refreshActionAvailability();
  }
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
    ["markets", "Markets", "markets.html"],
    ["create", "Create", "create.html"],
    ["stats", "Stats", "stats.html"],
    ["rewards", "Rewards", "rewards.html"],
    ["faq", "FAQ", "faq.html"],
  ];
  const header = required<HTMLElement>("[data-shell-header]");
  const footerLink = (id: PageName, label: string, url: string): string =>
    `<a class="${page === id ? "active" : ""}" ${page === id ? "aria-current=\"page\"" : ""} href="${url}">${label}</a>`;
  header.innerHTML = `
    <a class="brand" href="index.html" aria-label="TickerGarden home">
      <img src="./assets/tickergarden-mark.png" alt=""><img class="wordmark" src="./assets/tickergarden-wordmark-tight.png" alt="TickerGarden">
    </a>
    <nav aria-label="Primary navigation">${nav.map(([id, label, url]) => `<a class="${page === id ? "active" : ""}" ${page === id ? "aria-current=\"page\"" : ""} href="${url}">${label}</a>`).join("")}</nav>
    <button class="wallet" type="button" data-wallet><i class="ph ph-wallet" aria-hidden="true"></i><span>Connect Wallet</span><i class="ph ph-plant" aria-hidden="true"></i></button>
    <button class="menu" type="button" data-menu aria-label="Open navigation" aria-expanded="false"><i class="ph ph-list" aria-hidden="true"></i></button>`;
  required<HTMLElement>("[data-shell-footer]").innerHTML = `
    <div class="footer-intro">
      <a class="brand" href="index.html"><img src="./assets/tickergarden-mark.png" alt=""><img class="wordmark" src="./assets/tickergarden-wordmark-tight.png" alt="TickerGarden"></a>
      <p>Where stock communities meet meme culture—and new onchain possibilities take root.</p>
    </div>
    <nav class="footer-navigation" aria-label="Footer navigation">
      <section><strong>Garden</strong>${footerLink("home", "Home", "index.html")}${footerLink("markets", "Markets", "markets.html")}${footerLink("create", "Create", "create.html")}${footerLink("stats", "Stats", "stats.html")}</section>
      <section><strong>Community</strong>${footerLink("rewards", "Rewards", "rewards.html")}${footerLink("faq", "FAQ", "faq.html")}</section>
      <section><strong>Legal</strong>${footerLink("privacy", "Privacy Policy", "privacy.html")}${footerLink("terms", "Terms of Use", "terms.html")}</section>
    </nav>
    <div class="footer-risk"><strong>Risk notice</strong><p>Wallet-approved blockchain transactions may be irreversible. Ticker Meme tokens can be volatile or lose all value. TickerGarden does not provide investment advice or stock ownership through a Ticker Meme.</p></div>
    <div class="footer-meta"><span>© 2026 TickerGarden · V1</span><span>Pre-launch · Legal review required</span></div>`;

  required<HTMLButtonElement>("[data-wallet]").addEventListener("click", () => {
    if (wallet) disconnectWallet();
    else void connectWallet();
  });
  required<HTMLButtonElement>("[data-menu]").addEventListener("click", (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const open = !header.classList.contains("nav-open");
    header.classList.toggle("nav-open", open);
    button.setAttribute("aria-expanded", String(open));
  });
}

function renderWallet(): void {
  const button = query<HTMLButtonElement>("[data-wallet]");
  if (!button) return;
  const label = query<HTMLElement>("span", button);
  if (label) label.textContent = wallet ? shortHex(wallet.account) : "Connect Wallet";
  button.dataset.state = wallet ? "connected" : "disconnected";
}

function invalidateWallet(): void {
  wallet?.provider.removeListener?.("accountsChanged", invalidateWallet);
  wallet?.provider.removeListener?.("chainChanged", invalidateWallet);
  wallet = null;
  renderWallet();
  refreshCurrentPage();
  toast("Wallet account or chain changed. Reconnect before signing.", "warning");
}

async function connectWallet(): Promise<void> {
  try {
    const provider = window.ethereum;
    if (!provider) throw new Error("No injected wallet was found");
    let chainId = Number(await provider.request({ method: "eth_chainId" }));
    if (chainId !== robinhoodChain.id) {
      try {
        await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: toHex(robinhoodChain.id) }] });
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? Number((error as { code: unknown }).code) : 0;
        if (code !== 4902) throw error;
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: toHex(robinhoodChain.id),
            chainName: robinhoodChain.name,
            nativeCurrency: robinhoodChain.nativeCurrency,
            rpcUrls: robinhoodChain.rpcUrls.default.http,
            blockExplorerUrls: [robinhoodChain.blockExplorers.default.url],
          }],
        });
      }
      chainId = Number(await provider.request({ method: "eth_chainId" }));
    }
    if (chainId !== robinhoodChain.id) throw new Error(`Wallet must use Robinhood Chain ${robinhoodChain.id}`);
    const rawAccounts = await provider.request({ method: "eth_requestAccounts" });
    const account = canonicalAddress(String(Array.isArray(rawAccounts) ? rawAccounts[0] ?? "" : ""), "Wallet account");
    const walletClient = createWalletClient({ account, chain: robinhoodChain, transport: custom(provider) });
    const executor = new V1TransactionExecutor({
      publicClient: publicClient as unknown as V1TransactionClients["publicClient"],
      walletClient: walletClient as unknown as V1TransactionClients["walletClient"],
    });
    wallet = { account, provider, executor };
    provider.on?.("accountsChanged", invalidateWallet);
    provider.on?.("chainChanged", invalidateWallet);
    renderWallet();
    refreshCurrentPage();
    toast(`Wallet connected — ${shortHex(account)}`, "success");
  } catch (error) {
    toast(`Wallet connection failed — ${errorText(error)}`, "error");
  }
}

function disconnectWallet(): void {
  if (wallet) {
    wallet.provider.removeListener?.("accountsChanged", invalidateWallet);
    wallet.provider.removeListener?.("chainChanged", invalidateWallet);
  }
  wallet = null;
  renderWallet();
  refreshCurrentPage();
  toast("Wallet disconnected locally", "neutral");
}

function refreshActionAvailability(): void {
  queryAll<HTMLButtonElement>("[data-requires-write]").forEach((button) => setDisabled(button, !writeReady()));
  if (currentPage() === "trade") updateTradeAvailability();
  if (currentPage() === "create") updateCreateAvailability();
  if (currentPage() === "rewards") updateRewardsAvailability();
}

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
  const key = market.marketId;
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
    metadataCache.delete(key);
    throw error;
  }
}

async function renderHome(): Promise<void> {
  const rail = query<HTMLElement>("[data-home-markets]");
  if (!rail) return;
  const loading = query<HTMLElement>("[data-home-markets-loading]", rail);
  const empty = query<HTMLElement>("[data-home-markets-empty]", rail);
  const locked = query<HTMLElement>("[data-home-markets-locked]", rail);
  if (!foundation) {
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
    const link = document.createElement("a");
    link.className = "garden-card home-market-card";
    link.dataset.runtimeMarket = market.marketId;
    link.href = `./trade.html?marketId=${encodeURIComponent(market.marketId)}`;
    const heading = document.createElement("h3");
    heading.textContent = metadata ? `${metadata.name} (${metadata.symbol})` : `Market ${shortHex(market.marketId)}`;
    const detail = document.createElement("p");
    detail.textContent = `${phaseLabel(market.launchPhase)} · STOCK ${shortHex(market.assetUid)} · ${metadata?.quoteSymbol ?? shortHex(market.quoteAsset)}`;
    const identity = document.createElement("small");
    identity.textContent = market.marketId;
    link.append(heading, detail, identity);
    rail.append(link);

  }));
}

let marketPhaseFilter = "all";

function setupMarkets(): void {
  queryAll<HTMLButtonElement>("[data-market-filter]").forEach((button) => button.addEventListener("click", () => {
    marketPhaseFilter = button.dataset.marketFilter ?? "all";
    queryAll<HTMLButtonElement>("[data-market-filter]").forEach((item) => item.classList.toggle("active", item === button));
    void renderMarkets();
  }));
  query<HTMLInputElement>("[data-market-search]")?.addEventListener("input", () => { void renderMarkets(); });
  query<HTMLSelectElement>("[data-market-asset]")?.addEventListener("change", () => { void renderMarkets(); });
  query<HTMLSelectElement>("[data-market-sort]")?.addEventListener("change", () => { void renderMarkets(); });
}

function marketMatchesPhase(market: MarketReadModel): boolean {
  if (marketPhaseFilter === "curve") return market.launchPhase === 0 && market.canonicalRoute.curveTradingEnabled;
  if (marketPhaseFilter === "pool") return market.launchPhase === 1 && market.canonicalRoute.poolTradingEnabled;
  return true;
}

async function renderMarkets(): Promise<void> {
  const list = query<HTMLElement>("[data-market-list]");
  if (!list) return;
  const empty = query<HTMLElement>("[data-market-empty]", list);
  const locked = query<HTMLElement>("[data-market-locked]", list);
  const loading = query<HTMLElement>("[data-market-loading]", list);
  list.querySelectorAll("[data-runtime-market]").forEach((item) => item.remove());
  if (!foundation) {
    if (loading) loading.hidden = true;
    if (empty) empty.hidden = true;
    if (locked) { locked.hidden = false; locked.textContent = `Market directory unavailable — ${runtimeReasons().join("; ")}`; }
    setPageStatus("Canonical market records are unavailable.", "error");
    return;
  }
  const assetSelect = required<HTMLSelectElement>("[data-market-asset]");
  if (assetSelect.options.length <= 1) {
    foundation.assets.forEach((asset) => assetSelect.add(new Option(configLabel(asset), asset.id)));
  }
  const search = (query<HTMLInputElement>("[data-market-search]")?.value ?? "").trim().toLowerCase();
  const asset = assetSelect.value;
  const sort = query<HTMLSelectElement>("[data-market-sort]")?.value ?? "recent";
  const enriched = await Promise.all(foundation.markets.map(async (market) => {
    try { return { market, metadata: await marketMetadata(market) }; }
    catch { return { market, metadata: null }; }
  }));
  const filtered = enriched.filter(({ market, metadata }) => {
    const haystack = [market.marketId, market.assetUid, metadata?.name, metadata?.symbol].filter(Boolean).join(" ").toLowerCase();
    return marketMatchesPhase(market) && (!asset || market.assetUid === asset) && (!search || haystack.includes(search));
  });
  filtered.sort((left, right) => {
    if (sort === "name") return (left.metadata?.name ?? left.market.marketId).localeCompare(right.metadata?.name ?? right.market.marketId);
    if (sort === "phase") return left.market.launchPhase - right.market.launchPhase;
    return Number(BigInt(right.market.source.blockNumber) - BigInt(left.market.source.blockNumber));
  });
  if (loading) loading.hidden = true;
  if (locked) locked.hidden = true;
  if (empty) empty.hidden = filtered.length > 0;
  const template = required<HTMLTemplateElement>("[data-market-item-template]", list);
  for (const { market, metadata } of filtered) {
    const fragment = template.content.cloneNode(true) as DocumentFragment;
    const card = required<HTMLAnchorElement>("[data-market-card]", fragment);
    card.dataset.runtimeMarket = market.marketId;
    card.dataset.category = market.launchPhase === 1 ? "pool" : "curve";
    card.href = `./trade.html?marketId=${encodeURIComponent(market.marketId)}`;
    text("[data-market-name]", metadata ? `${metadata.name} (${metadata.symbol})` : `Market ${shortHex(market.marketId)}`, fragment);
    text("[data-market-asset-label]", `STOCK ${shortHex(market.assetUid, 8, 6)}`, fragment);
    text("[data-market-phase]", phaseLabel(market.launchPhase), fragment);
    text("[data-market-id]", shortHex(market.marketId, 8, 6), fragment);
    text("[data-market-quote]", metadata?.quoteSymbol ?? shortHex(market.quoteAsset), fragment);
    text("[data-market-status]", market.canonicalRoute.curveTradingEnabled ? "Curve trade" : market.canonicalRoute.poolTradingEnabled ? "Pool route" : "Transition", fragment);
    list.append(fragment);
  }
  list.setAttribute("aria-busy", "false");
  setPageStatus(`${filtered.length} of ${foundation.markets.length} canonical markets · finalized block ${foundation.sync.blockNumber}`, "success");
  const badge = query<HTMLElement>(".hero-badge span");
  if (badge) badge.textContent = `${foundation.markets.length} records at ${foundation.sync.revision}`;
}

async function renderStats(): Promise<void> {
  if (!foundation) {
    setPageStatus(`Statistics unavailable — ${runtimeReasons().join("; ")}`, "error");
    return;
  }
  text("[data-stat-markets]", String(foundation.markets.length));
  const groups = new Map<string, bigint>();
  const phaseCounts = new Map<number, number>();
  foundation.markets.forEach((market) => {
    groups.set(market.quoteAsset, (groups.get(market.quoteAsset) ?? 0n) + BigInt(market.curveProgress.realQuoteReserve));
    phaseCounts.set(market.launchPhase, (phaseCounts.get(market.launchPhase) ?? 0) + 1);
  });
  text("[data-stat-quote-volume]", String(groups.size));
  text("[data-stat-stock-allocation]", "Not exposed");
  text("[data-stat-holders]", "Not exposed");
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
      let symbol = address === ZERO_ADDRESS ? "ETH" : shortHex(address);
      let decimals = 18;
      if (address !== ZERO_ADDRESS) {
        try {
          [symbol, decimals] = await Promise.all([
            publicClient.readContract({ abi: erc20Abi, address: canonicalAddress(address, "Quote token"), functionName: "symbol" }),
            publicClient.readContract({ abi: erc20Abi, address: canonicalAddress(address, "Quote token"), functionName: "decimals" }),
          ]);
        } catch { /* Show canonical address and raw amount if optional metadata fails. */ }
      }
      const row = document.createElement("div");
      row.className = "activity-row";
      const label = document.createElement("span"); label.textContent = symbol;
      const value = document.createElement("strong"); value.textContent = `${formatTokenAmount(amount, decimals)} (${amount} raw)`;
      row.append(label, value);
      quoteList.append(row);
    }
    if (groups.size === 0) {
      const empty = document.createElement("p"); empty.textContent = "No quote-asset records are available yet."; quoteList.append(empty);
    }
  }
  query<HTMLElement>("[data-stats-summary]")?.setAttribute("aria-busy", "false");
  setPageStatus(`Finalized snapshot ${foundation.sync.revision}; no cross-asset currency conversion.`, "success");
}

function setupFaq(): void {
  const search = query<HTMLInputElement>("[data-faq-search]");
  let topic = "all";
  const apply = () => {
    const needle = (search?.value ?? "").trim().toLowerCase();
    queryAll<HTMLDetailsElement>("details").forEach((item) => {
      const topicMatches = topic === "all" || item.dataset.topic === topic;
      item.hidden = !topicMatches || Boolean(needle && !item.textContent?.toLowerCase().includes(needle));
    });
  };
  search?.addEventListener("input", apply);
  queryAll<HTMLButtonElement>("[data-faq-filter]").forEach((button) => button.addEventListener("click", () => {
    topic = button.dataset.faqFilter ?? "all";
    queryAll<HTMLButtonElement>("[data-faq-filter]").forEach((item) => item.classList.toggle("active", item === button));
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

function setupTrade(): void {
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
    queryAll<HTMLButtonElement>("[data-trade-side]").forEach((item) => item.classList.toggle("active", item === button));
    tradeQuote = null;
    renderTradeQuote();
    scheduleTradeQuote();
  }));
  query<HTMLInputElement>("[data-trade-amount]")?.addEventListener("input", scheduleTradeQuote);
  query<HTMLInputElement>("[data-trade-slippage]")?.addEventListener("input", scheduleTradeQuote);
  query<HTMLFormElement>("[data-trade-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitTrade();
  });
  if (marketId) void loadTradeMarket(marketId);
  else updateTradeAvailability();
}

async function loadTradeMarket(explicit?: string): Promise<void> {
  const generation = ++tradeLoadGeneration;
  tradeQuoteGeneration += 1;
  window.clearTimeout(tradeQuoteTimer);
  const raw = explicit ?? query<HTMLInputElement>("[data-market-id]")?.value ?? "";
  let marketId: Hex;
  try { marketId = canonicalBytes32(raw.trim().toLowerCase(), "marketId"); }
  catch (error) { setPageStatus(errorText(error), "error"); return; }
  if (!foundation || !readApi) {
    setPageStatus(`Market data unavailable — ${runtimeReasons().join("; ")}`, "error");
    return;
  }
  setPageStatus("Loading the finalized market record and verifying its Registry binding…");
  tradeQuote = null;
  try {
    const response = await readApi.getMarket({ marketId });
    if (generation !== tradeLoadGeneration) return;
    if (response.market.marketId !== marketId) throw new Error("Read API returned a different market identity");
    assertFinalizedSync(response.sync, foundation.sync.revision, "market detail");
    if (foundation.bindings) await ensureCanonicalMarket(response.market);
    const view = toCurveProgressViewModel(response);
    const metadata = await marketMetadata(response.market);
    if (generation !== tradeLoadGeneration) return;
    tradeMarket = response;
    tradeMetadata = metadata;
    const idInput = query<HTMLInputElement>("[data-market-id]");
    if (idInput) idInput.value = marketId;
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("marketId", marketId);
    window.history.replaceState({}, "", nextUrl);
    text("[data-trade-market-name]", `${metadata.name} (${metadata.symbol})`);
    text("[data-trade-stock]", shortHex(response.market.assetUid, 9, 7));
    text("[data-trade-quote]", `${metadata.quoteSymbol} · ${shortHex(response.market.quoteAsset)}`);
    text("[data-trade-phase]", phaseLabel(response.market.launchPhase));
    text("[data-trade-summary-id]", marketId);
    text("[data-trade-market-note]", `Real Quote reserve ${formatTokenAmount(view.realQuoteReserve, metadata.quoteDecimals)} ${metadata.quoteSymbol}; sellable Meme ${formatTokenAmount(view.sellableTokens, 18)} ${metadata.symbol}.`);
    const route = response.market.canonicalRoute;
    text("[data-trade-route-status]", route.curveTradingEnabled
      ? `Curve route verified at ${shortHex(response.market.curve, 9, 7)}. Quotes expire after 30 seconds.`
      : route.poolTradingEnabled
        ? `Canonical Pool route exists (${shortHex(response.market.poolId)}), but V4 swaps remain unavailable until a pinned quoter and builder are implemented.`
        : `No user trading route is enabled during ${phaseLabel(response.market.launchPhase)}.`);
    setPageStatus(`Market verified at finalized snapshot ${response.sync.revision}`, foundation.writeReady ? "success" : "warning");
    renderTradeQuote();
    updateTradeAvailability();
  } catch (error) {
    if (generation !== tradeLoadGeneration) return;
    tradeMarket = null;
    tradeMetadata = null;
    setPageStatus(`Market load failed — ${errorText(error)}`, "error");
    text("[data-trade-route-status]", "The route could not be verified; trading remains locked.");
    updateTradeAvailability();
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
  const market = tradeMarket;
  const metadata = tradeMetadata;
  const activeWallet = wallet;
  const side = tradeSide;
  if (!market.market.canonicalRoute.curveTradingEnabled || market.market.launchPhase !== 0) {
    text("[data-trade-status]", "This market is no longer tradable through its Curve.");
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
    if (side === "buy") {
      const [tokensOut, quoteSpent, refund] = await publicClient.readContract({
        abi: v1Abis.PonsCompatibleCurve,
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
        abi: v1Abis.PonsCompatibleCurve,
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
  const inputAsset = query<HTMLElement>("[data-trade-input-asset]");
  const outputAsset = query<HTMLElement>("[data-trade-output-asset]");
  if (inputAsset) inputAsset.textContent = tradeSide === "buy" ? tradeMetadata?.quoteSymbol ?? "Quote" : tradeMetadata?.symbol ?? "Meme";
  if (outputAsset) outputAsset.textContent = tradeSide === "buy" ? tradeMetadata?.symbol ?? "Meme" : tradeMetadata?.quoteSymbol ?? "Quote";
  const submit = query<HTMLButtonElement>("[data-trade-submit]");
  if (submit) {
    submit.className = `action-button ${tradeSide}`;
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
  text("[data-trade-rate]", `${tradeQuote.input} raw in → ${tradeQuote.output} raw out`);
  text("[data-trade-fee]", tradeQuote.fee === null ? "Included in Curve quote" : `${formatTokenAmount(tradeQuote.fee, tradeMetadata.quoteDecimals)} ${tradeMetadata.quoteSymbol}`);
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
  const spender = canonicalAddress(market.market.curve, "Curve");
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
  setDisabled(submit, !writeReady() || !quoteFresh);
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
          receiptEvent(receipt, curve, v1Abis.PonsCompatibleCurve, "CurveBuy", (args) =>
            String(args.buyer).toLowerCase() === account
            && String(args.recipient).toLowerCase() === account
            && typeof args.quoteIn === "bigint"
            && args.quoteIn > 0n
            && args.quoteIn <= quote.input
            && typeof args.tokensOut === "bigint"
            && args.tokensOut >= quote.minimum,
          );
        } else {
          receiptEvent(receipt, curve, v1Abis.PonsCompatibleCurve, "CurveSell", (args) =>
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
    const amountInput = query<HTMLInputElement>("[data-trade-amount]");
    if (amountInput) amountInput.value = "";
    tradeQuote = null;
    renderTradeQuote();
    toast("Trade confirmed from its canonical Curve event", "success");
    window.setTimeout(() => { if (tradeMarket) void loadTradeMarket(tradeMarket.market.marketId); }, 1_500);
  } catch (error) {
    toast(`Trade stopped — ${errorText(error)}`, "error");
  }
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

let launchSalt = randomSalt();
let launchPreview: LaunchPreview | null = null;
let launchPreviewGeneration = 0;
let launchPreviewTimer = 0;

function populateSelect(select: HTMLSelectElement, items: readonly ConfigReadModel[], placeholder: string): void {
  const prior = select.value;
  select.replaceChildren(new Option(placeholder, ""));
  select.options[0]!.disabled = true;
  items.forEach((item) => select.add(new Option(configLabel(item), item.id)));
  if (items.some((item) => item.id === prior)) select.value = prior;
  else if (items[0]) select.value = items[0].id;
}

function setupCreate(): void {
  const form = query<HTMLFormElement>("[data-create-form]");
  if (!form) return;
  form.addEventListener("input", () => {
    const symbol = query<HTMLInputElement>("[name=symbol]", form);
    if (symbol) symbol.value = symbol.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
    renderCreateIdentity();
    scheduleLaunchPreview();
  });
  form.addEventListener("change", (event) => {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    if (target.name === "quoteAssetConfigId") alignPonsToQuote();
    updateLaunchMode();
    renderCreateIdentity();
    scheduleLaunchPreview();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitLaunch();
  });
  renderCreateIdentity();
}

function renderCreateConfig(): void {
  const form = query<HTMLFormElement>("[data-create-form]");
  if (!form) return;
  if (!foundation) {
    text("[data-create-config-status]", `Configuration unavailable — ${runtimeReasons().join("; ")}`);
    updateCreateAvailability();
    return;
  }
  populateSelect(required<HTMLSelectElement>("[name=assetUid]", form), foundation.assets.filter((item) => item.status === 1), "Select an active STOCK asset");
  populateSelect(required<HTMLSelectElement>("[name=quoteAssetConfigId]", form), foundation.quotes.filter((item) => item.status === 1), "Select an active Quote config");
  populateSelect(required<HTMLSelectElement>("[name=ponsBaselineId]", form), foundation.pons.filter((item) => item.status === 1), "Select an active Pons baseline");
  populateSelect(required<HTMLSelectElement>("[name=launchTemplateId]", form), foundation.templates.filter((item) => item.status === 1), "Select an active launch template");
  alignPonsToQuote();
  const beneficiary = required<HTMLInputElement>("[name=beneficiary]", form);
  if (!beneficiary.value && wallet) beneficiary.value = wallet.account;
  text("[data-create-config-status]", foundation.writeReady
    ? `Loaded one finalized registry snapshot at ${foundation.sync.revision}. Every selection is checked on-chain before signature.`
    : `Read-only configuration loaded; signing locked — ${foundation.writeReasons.join("; ")}`);
  updateLaunchMode();
  renderCreateIdentity();
  scheduleLaunchPreview();
}

function alignPonsToQuote(): void {
  if (!foundation) return;
  const quoteId = query<HTMLSelectElement>("[name=quoteAssetConfigId]")?.value;
  const ponsSelect = query<HTMLSelectElement>("[name=ponsBaselineId]");
  const quote = foundation.quotes.find((item) => item.id === quoteId);
  if (!quote || !ponsSelect) return;
  try {
    const baselineId = configString(quote, "ponsBaselineId").toLowerCase();
    if ([...ponsSelect.options].some((option) => option.value === baselineId)) ponsSelect.value = baselineId;
  } catch { /* The launch validator reports the missing field. */ }
}

function updateLaunchMode(): void {
  const mode = query<HTMLSelectElement>("[name=launchMode]")?.value ?? "create";
  const amount = query<HTMLInputElement>("[name=firstBuyAmount]");
  const slippage = query<HTMLInputElement>("[name=slippageBps]");
  const enabled = mode === "create-buy";
  if (amount) { amount.disabled = !enabled; amount.required = enabled; }
  if (slippage) { slippage.disabled = !enabled; slippage.required = enabled; }
}

function renderCreateIdentity(): void {
  const name = query<HTMLInputElement>("[name=name]")?.value.trim() ?? "";
  const symbol = query<HTMLInputElement>("[name=symbol]")?.value.trim() ?? "";
  text("[data-token-name]", name || "Awaiting market name");
  text("[data-token-symbol]", symbol || "—");
  text("[data-preview-asset]", shortHex(query<HTMLSelectElement>("[name=assetUid]")?.value));
  text("[data-preview-quote]", shortHex(query<HTMLSelectElement>("[name=quoteAssetConfigId]")?.value));
  text("[data-preview-mode]", query<HTMLSelectElement>("[name=launchMode]")?.value === "create-buy" ? "Create + first buy" : "Create only");
  text("[data-preview-market-id]", launchPreview?.marketId ?? "Derived after validation");
}

function selectedLaunchConfig(): SelectedLaunchConfig {
  if (!foundation || !wallet) throw new Error("Connect a wallet and load the V1 registries");
  const form = required<HTMLFormElement>("[data-create-form]");
  const assetUid = required<HTMLSelectElement>("[name=assetUid]", form).value;
  const quoteId = required<HTMLSelectElement>("[name=quoteAssetConfigId]", form).value;
  const ponsId = required<HTMLSelectElement>("[name=ponsBaselineId]", form).value;
  const templateId = required<HTMLSelectElement>("[name=launchTemplateId]", form).value;
  const asset = foundation.assets.find((item) => item.id === assetUid);
  const quote = foundation.quotes.find((item) => item.id === quoteId);
  const pons = foundation.pons.find((item) => item.id === ponsId);
  const template = foundation.templates.find((item) => item.id === templateId);
  if (!asset || !quote || !pons || !template) throw new Error("Choose one active option from every registry");
  const beneficiary = canonicalAddress(required<HTMLInputElement>("[name=beneficiary]", form).value.trim(), "Creator beneficiary");
  const name = required<HTMLInputElement>("[name=name]", form).value.trim();
  const symbol = required<HTMLInputElement>("[name=symbol]", form).value.trim();
  const metadataURI = required<HTMLInputElement>("[name=metadataURI]", form).value.trim();
  if (!name || name.length > 64) throw new Error("Meme name must contain 1–64 characters");
  if (!/^[A-Z0-9]{1,16}$/.test(symbol)) throw new Error("Symbol must contain 1–16 uppercase letters or digits");
  if (!metadataURI || metadataURI.length > 512 || !(metadataURI.startsWith("ipfs://") || /^https:\/\//.test(metadataURI))) {
    throw new Error("Metadata URI must be an ipfs:// or https:// URI of at most 512 characters");
  }
  return Object.freeze({
    asset: { assetUid: asset.id, status: asset.status },
    quote: {
      configId: quote.id,
      economicsHash: canonicalBytes32(configString(quote, "economicsHash"), "Quote economicsHash"),
      quoteAsset: canonicalAddress(configString(quote, "quoteAsset"), "Quote asset", true),
      ponsBaselineId: canonicalBytes32(configString(quote, "ponsBaselineId"), "Quote Pons baseline"),
      status: quote.status,
    },
    pons: { baselineId: pons.id, status: pons.status },
    template: { templateId: template.id, status: template.status },
    creatorRevenueBeneficiary: beneficiary,
    name,
    symbol,
    metadataURI,
    salt: launchSalt,
  });
}

async function previewLaunch(walletContext?: WalletState): Promise<LaunchPreview> {
  const activeWallet = walletContext ?? wallet;
  if (!foundation?.writeReady || !runtimeConfig.contracts.available || !activeWallet || wallet !== activeWallet) throw new Error(runtimeReasons().join("; ") || "Connect a wallet first");
  await verifyLiveWalletContext(activeWallet);
  const selected = selectedLaunchConfig();
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
    gauge: canonicalAddress(predicted[3], "Predicted Gauge"),
    launchLocker: canonicalAddress(predicted[4], "Predicted LaunchLocker"),
  });
}

function scheduleLaunchPreview(): void {
  window.clearTimeout(launchPreviewTimer);
  const generation = ++launchPreviewGeneration;
  launchPreview = null;
  updateCreateAvailability();
  launchPreviewTimer = window.setTimeout(() => { void refreshLaunchPreview(generation); }, 350);
}

async function refreshLaunchPreview(generation: number): Promise<void> {
  try {
    const preview = await previewLaunch();
    if (generation !== launchPreviewGeneration) return;
    launchPreview = preview;
    text("[data-create-preview]", `Predicted market ${preview.marketId}; Meme ${shortHex(preview.memeToken)}, Curve ${shortHex(preview.curve)}, Gauge ${shortHex(preview.gauge)}. Launch fee ${foundation?.launchFee ?? 0n} raw native units.`);
    renderCreateIdentity();
    updateCreateAvailability();
  } catch (error) {
    if (generation !== launchPreviewGeneration) return;
    launchPreview = null;
    text("[data-create-preview]", `Preview locked — ${errorText(error)}`);
    updateCreateAvailability();
  }
}

function updateCreateAvailability(): void {
  const button = query<HTMLButtonElement>("[data-create-submit]");
  const form = query<HTMLFormElement>("[data-create-form]");
  if (!button || !form) return;
  setDisabled(button, !writeReady() || !launchPreview || !form.checkValidity());
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
  await executeTransaction({
    operationKey: `approval:${token}:${spender}:${amount}:${sync.revision}`,
    sync,
    request: requiredApproval,
    walletContext: activeWallet,
    verifyChain,
    confirm: async (receipt) => {
      const allowance = await publicClient.readContract({ abi: erc20Abi, address: token, functionName: "allowance", args: [activeWallet.account, spender], blockNumber: receipt.blockNumber });
      if (allowance < amount) throw new Error("Fresh allowance is below the requested amount");
      return allowance;
    },
  });
}

async function submitLaunch(): Promise<void> {
  try {
    if (!foundation?.writeReady || !runtimeConfig.contracts.available || !wallet || foundation.launchFee === undefined) {
      throw new Error(runtimeReasons().join("; ") || "Connect a wallet first");
    }
    const activeWallet = wallet;
    const contracts = runtimeConfig.contracts.value;
    const preview = await previewLaunch(activeWallet);
    launchPreview = preview;
    const verifyChain = () => ensureCanonicalLaunch(preview.selected);
    const previewEconomics = async () => preview.params.expectedEconomics;
    const mode = required<HTMLSelectElement>("[name=launchMode]").value;
    let request: ContractWriteRequest;
    let expectedSpent: bigint | null = null;
    let expectedMinimum: bigint | null = null;
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
      const slippageBps = parseSlippageBps(required<HTMLInputElement>("[name=slippageBps]").value);
      const probe = await buildLaunchAndBuyRequests({
        router: foundation.bindings!.launchRouter,
        launchFee: foundation.launchFee,
        quoteIn,
        minTokensOut: 1n,
        recipient: preview.creator,
        config: preview.selected,
        previewMarketEconomics: previewEconomics,
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
      if (tokensOut <= 0n || refund > quoteIn) throw new Error("Launch simulation returned an invalid first-buy result");
      expectedSpent = quoteIn - refund;
      expectedMinimum = minimumAfterSlippage(tokensOut, slippageBps);
      const built = await buildLaunchAndBuyRequests({
        router: foundation.bindings!.launchRouter,
        launchFee: foundation.launchFee,
        quoteIn,
        minTokensOut: expectedMinimum,
        recipient: preview.creator,
        config: preview.selected,
        previewMarketEconomics: previewEconomics,
      });
      request = built.request;
    }
    const created = await executeTransaction({
      operationKey: `launch:${mode}:${preview.marketId}:${foundation.sync.revision}`,
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
          receiptEvent(receipt, result.curve, v1Abis.PonsCompatibleCurve, "CurveBuy", (args) =>
            String(args.buyer).toLowerCase() === foundation!.bindings!.launchRouter
            && String(args.recipient).toLowerCase() === preview.creator
            && args.quoteIn === expectedSpent
            && typeof args.tokensOut === "bigint"
            && expectedMinimum !== null
            && args.tokensOut >= expectedMinimum,
          );
        }
        const [code, quoteAsset] = await Promise.all([
          publicClient.getCode({ address: result.curve }),
          publicClient.readContract({ abi: v1Abis.PonsCompatibleCurve, address: result.curve, functionName: "quoteAsset" }),
        ]);
        if (!code || code === "0x" || quoteAsset.toLowerCase() !== preview.selected.quote.quoteAsset) throw new Error("Fresh Curve deployment does not match the selected Quote");
        return result;
      },
    });
    launchSalt = randomSalt();
    launchPreview = null;
    toast(`Market created and verified — ${shortHex(created.marketId, 9, 7)}`, "success");
    window.location.assign(`./trade.html?marketId=${encodeURIComponent(created.marketId)}`);
  } catch (error) {
    toast(`Launch stopped — ${errorText(error)}`, "error");
    scheduleLaunchPreview();
  }
}

type RewardPositionState = Readonly<{
  detail: MarketDetailResponse;
  metadata: MarketMetadata;
  assetConfig: ConfigReadModel;
  asset: CanonicalAssetBinding;
  free: bigint;
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
  feeAsset: Address;
  liability: bigint;
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
  windowStart: bigint;
  windowEnd: bigint;
  serviceFeeAsset: Address;
  serviceFeeAmount: bigint;
  serviceFeeAllowance: bigint | null;
  serviceCreditAsset: Address;
  serviceCreditAmount: bigint;
  holderBalance: bigint;
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
let directEscape: DirectEscapeState | null = null;
let rewardLoadGeneration = 0;
let creatorLoadGeneration = 0;
let treasuryLoadGeneration = 0;
let directEscapeLoadGeneration = 0;
let directEscapeRefreshTimer = 0;

const treasuryStatusLabels = ["Not requested", "Root requested", "Root under review", "Claiming", "Rolled over"] as const;

function setupRewards(): void {
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
    if (focus) next.focus();
    window.history.replaceState({}, "", `#${id}`);
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectTab(tab));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const nextIndex = event.key === "Home" ? 0
        : event.key === "End" ? tabs.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      const next = tabs[nextIndex];
      if (next) selectTab(next, true);
    });
  });
  const requestedTab = window.location.hash.slice(1);
  const initial = tabs.find((tab) => tab.dataset.rewardsTab === requestedTab) ?? tabs[0];
  if (initial) selectTab(initial);

  queryAll<HTMLSelectElement>("[data-position-market],[data-settle-market]").forEach((select) => {
    select.addEventListener("change", () => {
      const position = query<HTMLSelectElement>("[data-position-market]");
      if (select.matches("[data-position-market]")) syncRewardMarketSelections(select.value, "position");
      else if (position && select.value) {
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
    syncRewardMarketSelections(marketId, "creator");
    const market = foundation?.markets.find((entry) => entry.marketId === marketId);
    const feeAsset = query<HTMLInputElement>("[data-creator-fee-asset]");
    if (market && feeAsset) feeAsset.value = market.quoteAsset;
    void refreshCreatorReward();
  });
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
    button.addEventListener("click", () => { void runRewardAction(button); });
  });
  const settleUser = query<HTMLInputElement>("[data-settle-user]");
  settleUser?.addEventListener("input", updateRewardsAvailability);
  query<HTMLInputElement>("[data-creator-new-beneficiary]")?.addEventListener("input", updateRewardsAvailability);
}

function rewardMarketOptionLabel(market: MarketReadModel): string {
  return `${shortHex(market.marketId, 8, 6)} · ${phaseLabel(market.launchPhase)} · STOCK ${shortHex(market.assetUid)}`;
}

function populateRewardMarkets(): void {
  if (!foundation) return;
  const selects = queryAll<HTMLSelectElement>("[data-position-market],[data-settle-market],[data-creator-market],[data-treasury-market]");
  selects.forEach((select) => {
    const prior = select.value;
    const placeholder = select.matches("[data-direct-vault-market],[data-settle-market]") ? "Use selected market" : "Select a configured market";
    select.replaceChildren(new Option(placeholder, ""));
    foundation!.markets.forEach((market) => select.add(new Option(rewardMarketOptionLabel(market), market.marketId)));
    if (foundation!.markets.some((market) => market.marketId === prior)) select.value = prior;
  });
  void Promise.all(foundation.markets.map(async (market) => {
    try {
      const metadata = await marketMetadata(market);
      selects.forEach((select) => {
        const option = [...select.options].find((item) => item.value === market.marketId);
        if (option) option.textContent = `${metadata.symbol} · ${phaseLabel(market.launchPhase)} · ${shortHex(market.marketId)}`;
      });
    } catch {
      // Canonical market identity remains selectable if optional token metadata fails.
    }
  }));
}

function syncRewardMarketSelections(marketId: string, source: "position" | "creator" | "treasury"): void {
  if (!marketId) return;
  if (source === "position") {
    queryAll<HTMLSelectElement>("[data-settle-market]").forEach((select) => { select.value = marketId; });
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
  const detail = await readApi.getMarket({ marketId: market.marketId });
  assertFinalizedSync(detail.sync, foundation.sync.revision, "reward market detail");
  if (detail.market.marketId !== market.marketId) throw new Error("Read API returned a different reward market");
  await ensureCanonicalMarket(detail.market);
  return detail;
}

async function readRewardPositionState(detail: MarketDetailResponse): Promise<RewardPositionState> {
  if (!wallet) throw new Error("Connect a wallet to load your position");
  const assetConfig = findAsset(detail.market.assetUid);
  const asset = await ensureCanonicalAsset(assetConfig);
  const account = wallet.account;
  const [free, allocated, rawPosition, settlementPrincipal, block] = await Promise.all([
    publicClient.readContract({ abi: v1Abis.UserStockVault, address: asset.userStockVault, functionName: "freeBalanceOf", args: [asset.assetUid, account] }),
    publicClient.readContract({ abi: v1Abis.UserStockVault, address: asset.userStockVault, functionName: "allocation", args: [asset.assetUid, account, detail.market.marketId] }),
    publicClient.readContract({ abi: v1Abis.MemeStockGauge, address: canonicalAddress(detail.market.gauge, "Gauge"), functionName: "positionOf", args: [account] }),
    publicClient.readContract({ abi: v1Abis.UserStockVault, address: asset.userStockVault, functionName: "rageQuitSettlementPrincipal", args: [asset.assetUid, account, detail.market.marketId] }),
    publicClient.getBlock({ blockTag: "latest" }),
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

function renderRewardPosition(state: RewardPositionState): void {
  const stock = (amount: bigint) => `${formatTokenAmount(amount, state.asset.tokenDecimals)} (${amount} raw)`;
  const unlock = state.unlockAt === 0n ? "not set" : new Date(Number(state.unlockAt) * 1_000).toLocaleString();
  const settlement = state.settlementPrincipal > 0n
    ? ` Reward cleanup pending for ${stock(state.settlementPrincipal)}; principal has already been returned.`
    : "";
  iconText("[data-position-summary]", "ph-check-circle", `Free ${stock(state.free)} · allocated ${stock(state.allocated)} (active ${stock(state.active)}, pending ${stock(state.pending)}) · minimum non-zero position ${stock(state.asset.minimumAllocation)} · normal unlock ${unlock}.${settlement}`);
  text("[data-staker-claimable=quote]", `${formatTokenAmount(state.quoteClaimable, state.metadata.quoteDecimals)} ${state.metadata.quoteSymbol}`);
  text("[data-staker-claimable=meme]", `${formatTokenAmount(state.memeClaimable, 18)} ${state.metadata.symbol}`);
  text("[data-rewards-total]", `${formatTokenAmount(state.quoteClaimable, state.metadata.quoteDecimals)} ${state.metadata.quoteSymbol} · ${formatTokenAmount(state.memeClaimable, 18)} ${state.metadata.symbol}`);
  iconText("[data-staker-status]", "ph-check-circle", `Live claimables for ${state.metadata.symbol} at ${foundation?.sync.revision}. Assets are displayed separately and are not converted into a fabricated total.`);
  const directAsset = query<HTMLInputElement>("[data-direct-vault-asset]");
  if (directAsset) { directAsset.value = state.asset.assetUid; directAsset.readOnly = true; }
  const settleUser = query<HTMLInputElement>("[data-settle-user]");
  if (settleUser && !settleUser.value && wallet) settleUser.value = wallet.account;
}

async function refreshRewardPosition(): Promise<void> {
  const generation = ++rewardLoadGeneration;
  rewardPosition = null;
  text("[data-staker-claimable=quote]", "Locked — verified position required");
  text("[data-staker-claimable=meme]", "Locked — verified position required");
  text("[data-rewards-total]", "—");
  updateRewardsAvailability();
  if (!foundation || !wallet) {
    const reason = !foundation ? runtimeReasons().join("; ") : "connect a wallet";
    iconText("[data-position-summary]", "ph-lock-key", `Position unavailable — ${reason}.`);
    text("[data-rewards-status]", `Rewards locked — ${reason}.`);
    return;
  }
  const select = query<HTMLSelectElement>("[data-position-market]");
  if (!select?.value) {
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
    text("[data-rewards-status]", `Position verified for ${shortHex(wallet.account)} at ${foundation.sync.revision}.`);
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
  if (!input.value) input.value = market.quoteAsset;
  return canonicalAddress(input.value.trim(), "Creator fee asset", true);
}

async function refreshCreatorReward(): Promise<void> {
  const generation = ++creatorLoadGeneration;
  creatorReward = null;
  text("[data-creator-beneficiary]", "—");
  text("[data-creator-current-beneficiary]", "—");
  text("[data-creator-market-summary]", "—");
  text("[data-creator-epoch-summary]", "—");
  text("[data-creator-status-summary]", "Locked");
  updateRewardsAvailability();
  if (!foundation || !wallet || !runtimeConfig.contracts.available) {
    text("[data-creator-status]", `Locked — ${runtimeReasons().join("; ") || "connect a wallet"}`);
    return;
  }
  const select = query<HTMLSelectElement>("[data-creator-market]");
  if (!select?.value) return;
  try {
    const market = selectedRewardMarket("[data-creator-market]");
    await getRewardMarketDetail(market);
    const registry = runtimeConfig.contracts.value.creatorRevenueRegistryAddress;
    const currentEpoch = await publicClient.readContract({ abi: v1Abis.CreatorRevenueRegistry, address: registry, functionName: "currentCreatorEpoch", args: [market.marketId] });
    if (currentEpoch <= 0) throw new Error("Creator revenue has not been initialized for this market");
    const epochInput = required<HTMLInputElement>("[data-creator-epoch]");
    if (!epochInput.value) epochInput.value = String(currentEpoch);
    const epoch = parseUint32(epochInput.value, "Creator epoch");
    if (epoch > currentEpoch) throw new Error("Creator epoch is newer than the on-chain current epoch");
    const feeAsset = configuredCreatorFeeAsset(market);
    const [beneficiary, currentBeneficiary, liability] = await Promise.all([
      publicClient.readContract({ abi: v1Abis.CreatorRevenueRegistry, address: registry, functionName: "creatorBeneficiaryAt", args: [market.marketId, epoch] }),
      publicClient.readContract({ abi: v1Abis.CreatorRevenueRegistry, address: registry, functionName: "creatorBeneficiaryAt", args: [market.marketId, currentEpoch] }),
      publicClient.readContract({ abi: v1Abis.ProtocolFeeVault, address: foundation.bindings!.protocolFeeVault, functionName: "creatorLiability", args: [market.marketId, epoch, feeAsset] }),
    ]);
    const canonicalBeneficiary = canonicalAddress(beneficiary, "Creator beneficiary");
    const canonicalCurrentBeneficiary = canonicalAddress(currentBeneficiary, "Current creator beneficiary");
    if (generation !== creatorLoadGeneration) return;
    creatorReward = Object.freeze({ marketId: market.marketId, epoch, beneficiary: canonicalBeneficiary, currentEpoch, currentBeneficiary: canonicalCurrentBeneficiary, feeAsset, liability });
    text("[data-creator-beneficiary]", canonicalBeneficiary);
    text("[data-creator-current-beneficiary]", canonicalCurrentBeneficiary);
    text("[data-creator-market-summary]", shortHex(market.marketId, 9, 7));
    text("[data-creator-epoch-summary]", String(epoch));
    text("[data-creator-status]", `Liability ${liability} raw units in ${shortHex(feeAsset)}; claims pay the recorded beneficiary.`);
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
  const distributor = runtimeConfig.contracts.available ? runtimeConfig.contracts.value.treasuryDistributorAddress : ZERO_ADDRESS;
  if (
    proof.distributor !== distributor
    || proof.merkleRoot !== state.merkleRoot
    || proof.datasetHash !== state.datasetHash
  ) throw new Error("Proof commitments do not match the live Treasury epoch");
  const leaf = await publicClient.readContract({
    abi: v1Abis.TreasuryDistributorV1,
    address: distributor,
    functionName: "claimLeaf",
    args: [proof.marketId, proof.epochId, proof.leafIndex, proof.account, proof.twab, proof.amount],
  });
  if (foldSortedMerkleProof(canonicalBytes32(leaf, "Treasury leaf"), proof.proof) !== state.merkleRoot) {
    throw new Error("Proof does not reconstruct the live Treasury Merkle Root");
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
  const epoch = parseUint32(input.value, "Treasury epoch");
  if (epoch > current) throw new Error("Treasury epoch cannot be newer than the current epoch");
  return epoch;
}

async function refreshTreasuryReward(resetEpoch: boolean): Promise<void> {
  const generation = ++treasuryLoadGeneration;
  treasuryReward = null;
  clearTreasuryProof();
  text("[data-treasury-status]", "Locked");
  text("[data-treasury-epoch-id]", "—");
  text("[data-treasury-root]", "—");
  text("[data-treasury-fee]", "Locked — live configuration required");
  text("[data-treasury-fee-asset]", "Locked — live configuration required");
  text("[data-treasury-fee-allowance]", "Locked — live allowance required");
  text("[data-treasury-service-credit]", "Locked — live credit required");
  text("[data-treasury-claimable]", "Locked — finalized Root required");
  text("[data-treasury-proof]", "No verified proof loaded");
  updateRewardsAvailability();
  if (!foundation || !wallet || !runtimeConfig.contracts.available) {
    text("[data-treasury-status-note]", `Treasury locked — ${runtimeReasons().join("; ") || "connect a wallet"}.`);
    return;
  }
  const select = query<HTMLSelectElement>("[data-treasury-market]");
  if (!select?.value) return;
  try {
    const detail = await getRewardMarketDetail(selectedRewardMarket("[data-treasury-market]"));
    if (detail.market.launchPhase !== 1) throw new Error("Treasury activates only after the canonical Pool is created");
    const distributor = runtimeConfig.contracts.value.treasuryDistributorAddress;
    const rawTreasuryMarket = await publicClient.readContract({ abi: v1Abis.TreasuryDistributorV1, address: distributor, functionName: "market", args: [detail.market.marketId] });
    const memeToken = canonicalAddress(tupleString(rawTreasuryMarket, "memeToken", 0), "Treasury Meme token");
    const quoteToken = canonicalAddress(tupleString(rawTreasuryMarket, "quoteToken", 1), "Treasury Quote token", true);
    const activatedAt = tupleBigInt(rawTreasuryMarket, "activatedAt", 3);
    if (memeToken !== detail.market.memeToken || quoteToken !== detail.market.quoteAsset || activatedAt <= 0n) {
      throw new Error("Treasury registration or activation does not match the canonical market");
    }
    const currentEpochId = await publicClient.readContract({ abi: v1Abis.TreasuryDistributorV1, address: distributor, functionName: "currentEpochId", args: [detail.market.marketId] });
    const epochId = populateTreasuryEpochs(currentEpochId, resetEpoch);
    const [rawEpoch, epochQuoteAmount, rawWindow, rawFee, holderBalance, accountClaimed, block] = await Promise.all([
      publicClient.readContract({ abi: v1Abis.TreasuryDistributorV1, address: distributor, functionName: "epoch", args: [detail.market.marketId, epochId] }),
      publicClient.readContract({ abi: v1Abis.TreasuryDistributorV1, address: distributor, functionName: "epochQuoteAmount", args: [detail.market.marketId, epochId] }),
      publicClient.readContract({ abi: v1Abis.TreasuryDistributorV1, address: distributor, functionName: "epochWindow", args: [detail.market.marketId, epochId] }),
      publicClient.readContract({ abi: v1Abis.TreasuryDistributorV1, address: distributor, functionName: "rootServiceFee" }),
      publicClient.readContract({ abi: erc20Abi, address: memeToken, functionName: "balanceOf", args: [wallet.account] }),
      publicClient.readContract({ abi: v1Abis.TreasuryDistributorV1, address: distributor, functionName: "accountClaimed", args: [detail.market.marketId, epochId, wallet.account] }),
      publicClient.getBlock({ blockTag: "latest" }),
    ]);
    const status = tupleNumber(rawEpoch, "status", 6);
    if (status < 0 || status >= treasuryStatusLabels.length) throw new Error("Treasury returned an unknown epoch status");
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
      requester: canonicalAddress(tupleString(rawEpoch, "requester", 7), "Treasury Root requester", true),
      merkleRoot: canonicalBytes32(tupleString(rawEpoch, "merkleRoot", 11), "Treasury Merkle Root", true),
      datasetHash: canonicalBytes32(tupleString(rawEpoch, "datasetHash", 12), "Treasury dataset hash", true),
      quoteAmount: tupleBigInt(rawEpoch, "quoteAmount", 13),
      claimedAmount: tupleBigInt(rawEpoch, "claimedAmount", 14),
      epochQuoteAmount,
      windowStart: tupleBigInt(rawWindow, "output0", 0),
      windowEnd: tupleBigInt(rawWindow, "output1", 1),
      serviceFeeAsset,
      serviceFeeAmount,
      serviceFeeAllowance,
      serviceCreditAsset,
      serviceCreditAmount,
      holderBalance,
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
      ? " Treasury holder writes are release-approved."
      : ` Read-only: ${runtimeConfig.treasuryWrites.reasons.join("; ")}.`;
    text("[data-treasury-status-note]", `Epoch Quote ${formatTokenAmount(base.epochQuoteAmount, metadata.quoteDecimals)} ${metadata.quoteSymbol}; ${base.claimedAmount} of ${base.quoteAmount} raw allocated amount claimed. Current holder balance ${formatTokenAmount(base.holderBalance, 18)} ${metadata.symbol}.${releaseGate}`);
    renderTreasuryProof(proof, metadata);
    updateRewardsAvailability();
  } catch (error) {
    if (generation !== treasuryLoadGeneration) return;
    text("[data-treasury-status]", "Locked");
    text("[data-treasury-status-note]", `Treasury locked — ${errorText(error)}`);
    text("[data-treasury-proof]", "No verified proof loaded");
    updateRewardsAvailability();
  }
}

function rewardActionButton(action: string, route?: string): HTMLButtonElement | null {
  const selector = route ? `[data-reward-action="${action}"][data-reward-route="${route}"]` : `[data-reward-action="${action}"]`;
  return query<HTMLButtonElement>(selector);
}

function updateRewardsAvailability(): void {
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
  if (rewardPosition) {
    const normalClaimReady = rewardPosition.allocated === 0n || (rewardPosition.unlockAt > 0n && rewardPosition.now >= rewardPosition.unlockAt);
    setDisabled(rewardActionButton("depositStock")!, rewardPosition.asset.status !== 1);
    setDisabled(rewardActionButton("withdrawFreeStock")!, rewardPosition.free <= 0n);
    const allocationOpen = rewardPosition.asset.status === 1 && rewardPosition.detail.market.launchPhase === 1 && rewardPosition.settlementPrincipal === 0n;
    setDisabled(rewardActionButton("allocate")!, !allocationOpen);
    setDisabled(rewardActionButton("depositAndAllocate")!, !allocationOpen);
    setDisabled(rewardActionButton("closeAllocation")!, rewardPosition.allocated <= 0n || rewardPosition.detail.market.launchPhase !== 1 || rewardPosition.unlockAt === 0n || rewardPosition.now < rewardPosition.unlockAt);
    setDisabled(rewardActionButton("rageQuit", "allocation-manager")!, rewardPosition.allocated <= 0n);
    queryAll<HTMLButtonElement>("[data-reward-action=claimStaker]").forEach((button) => {
      const amount = button.dataset.rewardAsset === "meme" ? rewardPosition!.memeClaimable : rewardPosition!.quoteClaimable;
      setDisabled(button, amount <= 0n || !normalClaimReady || rewardPosition!.settlementPrincipal > 0n);
    });
    const settleUser = query<HTMLInputElement>("[data-settle-user]")?.value.trim().toLowerCase() ?? "";
    const settle = rewardActionButton("settleRageQuitRewards");
    if (settle) setDisabled(settle, !ADDRESS_PATTERN.test(settleUser));
  }
  if (creatorReward) {
    const claim = rewardActionButton("claimCreator");
    if (claim) setDisabled(claim, creatorReward.liability <= 0n);
    const next = query<HTMLInputElement>("[data-creator-new-beneficiary]")?.value.trim().toLowerCase() ?? "";
    const transfer = rewardActionButton("transferCreatorRevenueBeneficiary");
    if (transfer) setDisabled(transfer, wallet?.account !== creatorReward.currentBeneficiary || !ADDRESS_PATTERN.test(next) || next === ZERO_ADDRESS || next === creatorReward.currentBeneficiary);
  }
  if (treasuryReward && treasuryWritesReady()) {
    const state = treasuryReward;
    const request = rewardActionButton("requestRoot");
    if (request) setDisabled(request, state.status !== 0 || state.epochId >= state.currentEpochId || state.epochQuoteAmount <= 0n || state.holderBalance <= 0n);
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
  const verifyChain = async () => { await ensureCanonicalMarket(state.detail.market); await ensureCanonicalAsset(state.assetConfig); };
  const form = button.closest<HTMLFormElement>("form");
  const amountFrom = (name: string, label: string) => parseTokenAmount(required<HTMLInputElement>(`[name=${name}]`, form ?? document).value, state.asset.tokenDecimals, label);
  let request: ContractWriteRequest;
  let approval: ContractWriteRequest | undefined;
  let confirm: (receipt: TransactionReceipt) => Promise<unknown>;
  if (action === "depositStock") {
    const amount = amountFrom("amount", "Deposit amount");
    const before = state.free;
    request = buildDeposit(state.asset.userStockVault, state.asset.assetUid, amount);
    approval = await allowanceApproval(buildStockApproval(state.asset.stockToken, state.asset.userStockVault, amount), state.asset.stockToken, state.asset.userStockVault, amount, account);
    confirm = async (receipt) => {
      receiptEvent(receipt, state.asset.userStockVault, v1Abis.UserStockVault, "StockDeposited", (args) => args.assetUid === state.asset.assetUid && String(args.user).toLowerCase() === account && args.amount === amount);
      const after = await freshPositionValue(state, "free", account, receipt.blockNumber);
      if (after !== before + amount) throw new Error("Fresh Vault balance does not reflect the exact deposit");
      return after;
    };
  } else if (action === "withdrawFreeStock") {
    const amount = amountFrom("amount", "Withdrawal amount");
    if (amount > state.free) throw new Error("Withdrawal exceeds free Vault balance");
    const before = state.free;
    request = buildWithdraw(state.asset.userStockVault, state.asset.assetUid, amount);
    confirm = async (receipt) => {
      receiptEvent(receipt, state.asset.userStockVault, v1Abis.UserStockVault, "StockWithdrawn", (args) => args.assetUid === state.asset.assetUid && String(args.user).toLowerCase() === account && args.amount === amount);
      const after = await freshPositionValue(state, "free", account, receipt.blockNumber);
      if (after + amount !== before) throw new Error("Fresh Vault balance does not reflect the exact withdrawal");
      return after;
    };
  } else if (action === "allocate") {
    const amount = amountFrom("amount", "Allocation amount");
    if (amount > state.free) throw new Error("Allocation exceeds free Vault balance");
    if (state.allocated + amount < state.asset.minimumAllocation) throw new Error("Resulting position is below the configured minimumAllocation");
    request = buildAllocate(foundation.bindings!.allocationManager, marketId, amount);
    confirm = async (receipt) => {
      receiptEvent(receipt, state.asset.userStockVault, v1Abis.UserStockVault, "AllocationLocked", (args) => args.assetUid === state.asset.assetUid && String(args.user).toLowerCase() === account && args.marketId === marketId && args.amount === amount);
      const after = await freshPositionValue(state, "allocated", account, receipt.blockNumber);
      if (after !== state.allocated + amount) throw new Error("Fresh Vault allocation is not the requested amount");
      return after;
    };
  } else if (action === "depositAndAllocate") {
    const deposit = amountFrom("depositAmount", "Deposit amount");
    const allocation = amountFrom("allocationAmount", "Allocation amount");
    if (allocation > state.free + deposit) throw new Error("Allocation exceeds free balance plus the new deposit");
    if (state.allocated + allocation < state.asset.minimumAllocation) throw new Error("Resulting position is below the configured minimumAllocation");
    request = buildDepositAndAllocate(foundation.bindings!.allocationManager, marketId, deposit, allocation);
    approval = await allowanceApproval(buildStockApproval(state.asset.stockToken, state.asset.userStockVault, deposit), state.asset.stockToken, state.asset.userStockVault, deposit, account);
    confirm = async (receipt) => {
      receiptEvent(receipt, state.asset.userStockVault, v1Abis.UserStockVault, "StockDeposited", (args) => args.assetUid === state.asset.assetUid && String(args.user).toLowerCase() === account && args.amount === deposit);
      receiptEvent(receipt, state.asset.userStockVault, v1Abis.UserStockVault, "AllocationLocked", (args) => args.assetUid === state.asset.assetUid && String(args.user).toLowerCase() === account && args.marketId === marketId && args.amount === allocation);
      const [free, allocated] = await Promise.all([
        freshPositionValue(state, "free", account, receipt.blockNumber),
        freshPositionValue(state, "allocated", account, receipt.blockNumber),
      ]);
      if (free !== state.free + deposit - allocation || allocated !== state.allocated + allocation) throw new Error("Fresh Vault ledgers do not reflect deposit-and-allocate exactly");
      return allocated;
    };
  } else if (action === "closeAllocation") {
    if (state.allocated <= 0n) throw new Error("There is no allocation to close");
    request = buildCloseAllocation(foundation.bindings!.allocationManager, marketId);
    confirm = async (receipt) => {
      receiptEvent(receipt, state.asset.userStockVault, v1Abis.UserStockVault, "AllocationReleased", (args) => args.assetUid === state.asset.assetUid && String(args.user).toLowerCase() === account && args.marketId === marketId && args.amount === state.allocated);
      const after = await freshPositionValue(state, "allocated", account, receipt.blockNumber);
      if (after !== 0n) throw new Error("Fresh Vault allocation is not zero after close");
      return after;
    };
  } else if (action === "rageQuit") {
    if (state.allocated <= 0n) throw new Error("There is no principal to escape");
    const walletBalanceBefore = await publicClient.readContract({ abi: erc20Abi, address: state.asset.stockToken, functionName: "balanceOf", args: [account] });
    request = buildRageQuit(foundation.bindings!.allocationManager, marketId);
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
  toast(action === "rageQuit" ? "Principal returned immediately; reward cleanup state refreshed" : "Position action confirmed from canonical Vault state", "success");
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
    request: buildSettleRageQuitRewards(foundation.bindings!.allocationManager, marketId, user),
    walletContext: activeWallet,
    verifyChain: () => ensureCanonicalMarket(state.detail.market),
    confirm: async (receipt) => {
      receiptEvent(receipt, foundation!.bindings!.allocationManager, v1Abis.AllocationManager, "RageQuitRewardSettlementFinalized", (args) => String(args.user).toLowerCase() === user && args.marketId === marketId && args.principal === principal);
      const after = await publicClient.readContract({ abi: v1Abis.UserStockVault, address: state.asset.userStockVault, functionName: "rageQuitSettlementPrincipal", args: [state.asset.assetUid, user, marketId], blockNumber: receipt.blockNumber });
      if (after !== 0n) throw new Error("Deferred settlement tombstone remains after settlement");
      return after;
    },
  });
  toast("Forfeited rewards settled; principal was not transferred twice", "success");
  await refreshRewardPosition();
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
    request: buildClaimStaker(foundation.bindings!.protocolFeeVault, state.detail.market.marketId, asset),
    walletContext: activeWallet,
    verifyChain: () => ensureCanonicalMarket(state.detail.market),
    confirm: async (receipt) => {
      receiptEvent(receipt, foundation!.bindings!.protocolFeeVault, v1Abis.ProtocolFeeVault, "FeeClaimed", (args) => Number(args.beneficiaryType) === 1 && String(args.beneficiary).toLowerCase() === account && args.marketId === state.detail.market.marketId && String(args.feeAsset).toLowerCase() === asset && args.amount === before);
      const position = await publicClient.readContract({ abi: v1Abis.MemeStockGauge, address: canonicalAddress(state.detail.market.gauge, "Gauge"), functionName: "positionOf", args: [account], blockNumber: receipt.blockNumber });
      const after = tupleBigInt(position, meme ? "memeClaimable" : "quoteClaimable", meme ? 5 : 4);
      if (after !== 0n) throw new Error("Fresh Gauge claimable is not zero after claim");
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
  const state = creatorReward;
  const creatorRegistry = runtimeConfig.contracts.value.creatorRevenueRegistryAddress;
  await ensureCanonicalMarket(selectedRewardMarket("[data-creator-market]"));
  if (action === "claimCreator") {
    if (state.liability <= 0n) throw new Error("The selected creator liability is zero");
    await executeTransaction({
      operationKey: `reward:creator-claim:${state.marketId}:${state.epoch}:${state.feeAsset}:${foundation.sync.revision}`,
      sync: foundation.sync,
      request: buildClaimCreator({ feeVault: foundation.bindings!.protocolFeeVault, marketId: state.marketId, epoch: state.epoch, asset: state.feeAsset }),
      walletContext: activeWallet,
      verifyChain: () => ensureCanonicalMarket(selectedRewardMarket("[data-creator-market]")),
      confirm: async (receipt) => {
        return receiptEvent(receipt, foundation!.bindings!.protocolFeeVault, v1Abis.ProtocolFeeVault, "FeeClaimed", (args) => Number(args.beneficiaryType) === 0 && String(args.beneficiary).toLowerCase() === state.beneficiary && args.marketId === state.marketId && Number(args.beneficiaryEpoch) === state.epoch && String(args.feeAsset).toLowerCase() === state.feeAsset && args.amount === state.liability);
      },
    });
    toast("Creator revenue paid to the recorded beneficiary", "success");
  } else {
    if (activeWallet.account !== state.currentBeneficiary) throw new Error("Only the current beneficiary can transfer future revenue");
    const next = canonicalAddress(required<HTMLInputElement>("[data-creator-new-beneficiary]").value.trim(), "New beneficiary");
    if (next === state.currentBeneficiary) throw new Error("New beneficiary must differ from the current beneficiary");
    await executeTransaction({
      operationKey: `reward:creator-transfer:${state.marketId}:${state.epoch}:${next}:${foundation.sync.revision}`,
      sync: foundation.sync,
      request: buildTransferCreatorBeneficiary({ registry: creatorRegistry, marketId: state.marketId, nextBeneficiary: next }),
      walletContext: activeWallet,
      verifyChain: () => ensureCanonicalMarket(selectedRewardMarket("[data-creator-market]")),
      confirm: async (receipt) => {
        receiptEvent(receipt, creatorRegistry, v1Abis.CreatorRevenueRegistry, "CreatorRevenueBeneficiaryUpdated", (args) => args.marketId === state.marketId && Number(args.oldEpoch) === state.currentEpoch && String(args.oldBeneficiary).toLowerCase() === state.currentBeneficiary && String(args.newBeneficiary).toLowerCase() === next);
        const epoch = await publicClient.readContract({ abi: v1Abis.CreatorRevenueRegistry, address: creatorRegistry, functionName: "currentCreatorEpoch", args: [state.marketId], blockNumber: receipt.blockNumber });
        const beneficiary = await publicClient.readContract({ abi: v1Abis.CreatorRevenueRegistry, address: creatorRegistry, functionName: "creatorBeneficiaryAt", args: [state.marketId, epoch], blockNumber: receipt.blockNumber });
        if (epoch !== state.currentEpoch + 1 || beneficiary.toLowerCase() !== next) throw new Error("Fresh creator epoch does not match the transfer");
        return epoch;
      },
    });
    const input = query<HTMLInputElement>("[data-creator-new-beneficiary]");
    if (input) input.value = "";
    const epochInput = query<HTMLInputElement>("[data-creator-epoch]");
    if (epochInput) epochInput.value = String(state.currentEpoch + 1);
    toast("Future creator revenue beneficiary transferred", "success");
  }
  await refreshCreatorReward();
}

async function ensureTreasuryActionState(state: TreasuryRewardState, action: string, account: Address): Promise<void> {
  if (!runtimeConfig.contracts.available || !runtimeConfig.treasuryWrites.available) {
    throw new Error(runtimeConfig.treasuryWrites.available ? "Treasury contracts are not configured" : runtimeConfig.treasuryWrites.reasons.join("; "));
  }
  const distributor = runtimeConfig.contracts.value.treasuryDistributorAddress;
  if (action === "withdrawServiceCredit") {
    const amount = await publicClient.readContract({ abi: v1Abis.TreasuryDistributorV1, address: distributor, functionName: "serviceCredit", args: [state.serviceCreditAsset, account] });
    if (amount !== state.serviceCreditAmount || amount <= 0n) throw new Error("Treasury service credit changed; refresh before signing");
    return;
  }
  await ensureCanonicalMarket(state.detail.market);
  const [rawMarket, rawEpoch] = await Promise.all([
    publicClient.readContract({ abi: v1Abis.TreasuryDistributorV1, address: distributor, functionName: "market", args: [state.detail.market.marketId] }),
    publicClient.readContract({ abi: v1Abis.TreasuryDistributorV1, address: distributor, functionName: "epoch", args: [state.detail.market.marketId, state.epochId] }),
  ]);
  if (
    canonicalAddress(tupleString(rawMarket, "memeToken", 0), "Treasury Meme token") !== state.detail.market.memeToken
    || canonicalAddress(tupleString(rawMarket, "quoteToken", 1), "Treasury Quote token", true) !== state.detail.market.quoteAsset
    || tupleBigInt(rawMarket, "activatedAt", 3) <= 0n
  ) throw new Error("Treasury market binding changed; refresh before signing");
  if (tupleNumber(rawEpoch, "status", 6) !== state.status) throw new Error("Treasury epoch status changed; refresh before signing");
  if (action === "requestRoot") {
    const [rawFee, quoteAmount] = await Promise.all([
      publicClient.readContract({ abi: v1Abis.TreasuryDistributorV1, address: distributor, functionName: "rootServiceFee" }),
      publicClient.readContract({ abi: v1Abis.TreasuryDistributorV1, address: distributor, functionName: "epochQuoteAmount", args: [state.detail.market.marketId, state.epochId] }),
    ]);
    if (
      canonicalAddress(tupleString(rawFee, "asset", 0), "Root service fee asset", true) !== state.serviceFeeAsset
      || tupleBigInt(rawFee, "amount", 1) !== state.serviceFeeAmount
      || quoteAmount !== state.epochQuoteAmount
    ) throw new Error("Treasury fee or epoch funding changed; refresh before approving or signing");
  }
  if (["claim", "finalizeRoot"].includes(action) && (
    canonicalBytes32(tupleString(rawEpoch, "merkleRoot", 11), "Treasury Merkle Root", true) !== state.merkleRoot
    || canonicalBytes32(tupleString(rawEpoch, "datasetHash", 12), "Treasury dataset hash", true) !== state.datasetHash
    || tupleNumber(rawEpoch, "leafCount", 5) !== state.leafCount
  )) throw new Error("Treasury Root commitment changed; refresh before signing");
  if (action === "rolloverExpiredEpoch" && (
    tupleBigInt(rawEpoch, "quoteAmount", 13) !== state.quoteAmount
    || tupleBigInt(rawEpoch, "claimedAmount", 14) !== state.claimedAmount
  )) throw new Error("Treasury epoch balance changed; refresh before signing");
}

async function executeTreasuryAction(action: string): Promise<void> {
  if (!foundation || !wallet || !treasuryReward || !runtimeConfig.contracts.available) throw new Error("Load a verified Treasury epoch first");
  if (!runtimeConfig.treasuryWrites.available) throw new Error(runtimeConfig.treasuryWrites.reasons.join("; "));
  const activeWallet = wallet;
  const account = activeWallet.account;
  await verifyLiveWalletContext(activeWallet);
  const state = treasuryReward;
  const distributor = runtimeConfig.contracts.value.treasuryDistributorAddress;
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
    if (!state.proof) throw new Error("No locally verified Treasury proof is loaded");
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
    throw new Error("This Treasury action is not exposed to holders");
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
        if (creditAfter !== 0n) throw new Error("Treasury service credit is not zero at the receipt block");
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
        if (!state.proof || String(args.account).toLowerCase() !== account || args.leafIndex !== state.proof.leafIndex || args.twab !== state.proof.twab || args.amount !== state.proof.amount) throw new Error("Treasury claim event differs from the verified leaf");
        const claimed = await publicClient.readContract({ abi: v1Abis.TreasuryDistributorV1, address: distributor, functionName: "accountClaimed", args: [marketId, state.epochId, account], blockNumber: receipt.blockNumber });
        if (!claimed) throw new Error("Fresh Treasury account claim flag is false");
      }
      if (action === "finalizeRoot" && (args.merkleRoot !== state.merkleRoot || typeof args.claimUntil !== "bigint" || args.claimUntil <= state.now)) {
        throw new Error("Finalized Root event differs from the verified commitment");
      }
      if (action === "expireRootRequest" && String(args.requester).toLowerCase() !== state.requester) {
        throw new Error("Expired Root request event differs from the recorded requester");
      }
      if (action === "rolloverExpiredEpoch" && (
        Number(args.toEpochId) <= state.epochId
        || args.amount !== state.quoteAmount - state.claimedAmount
      )) throw new Error("Treasury rollover event differs from the expired epoch remainder");
      const freshEpoch = await publicClient.readContract({ abi: v1Abis.TreasuryDistributorV1, address: distributor, functionName: "epoch", args: [marketId, state.epochId], blockNumber: receipt.blockNumber });
      const expectedStatus = action === "requestRoot" ? 1 : action === "expireRootRequest" ? 0 : action === "rolloverExpiredEpoch" ? 4 : 3;
      if (tupleNumber(freshEpoch, "status", 6) !== expectedStatus) throw new Error("Treasury receipt-block state does not match the confirmed action");
      if (action === "finalizeRoot" && tupleBigInt(freshEpoch, "claimUntil", 3) !== args.claimUntil) {
        throw new Error("Treasury receipt-block claim window differs from the finalized event");
      }
      return args;
    },
  });
  toast(`Treasury ${action} confirmed from its canonical event`, "success");
  await refreshTreasuryReward(false);
}

async function runRewardAction(button: HTMLButtonElement): Promise<void> {
  const action = button.dataset.rewardAction ?? "";
  try {
    const form = button.closest<HTMLFormElement>("form");
    if (form && !form.reportValidity()) {
      toast("Complete the highlighted Rewards fields before continuing", "error");
      return;
    }
    if (["fundQuote", "burnMeme"].includes(action)) throw new Error("Protocol integration actions are not exposed to users");
    if (action === "directVaultRageQuit") {
      await executeDirectVaultRageQuit();
    } else if (["depositStock", "withdrawFreeStock", "allocate", "depositAndAllocate", "closeAllocation", "rageQuit"].includes(action)) {
      await executePositionAction(action, button);
    } else if (action === "settleRageQuitRewards") {
      await executeSettlement();
    } else if (action === "claimStaker") {
      await executeStakerClaim(button);
    } else if (["claimCreator", "transferCreatorRevenueBeneficiary"].includes(action)) {
      await executeCreatorAction(action);
    } else if (["requestRoot", "claim", "finalizeRoot", "expireRootRequest", "rolloverExpiredEpoch", "withdrawServiceCredit"].includes(action)) {
      await executeTreasuryAction(action);
    } else {
      throw new Error("Unknown Rewards action");
    }
  } catch (error) {
    toast(`Rewards action stopped — ${errorText(error)}`, "error");
    updateRewardsAvailability();
  }
}

async function renderRewards(): Promise<void> {
  populateRewardMarkets();
  if (!foundation) {
    text("[data-rewards-status]", `Rewards unavailable — ${runtimeReasons().join("; ")}`);
    await refreshDirectEscape();
    updateRewardsAvailability();
    return;
  }
  text("[data-rewards-status]", wallet
    ? `Wallet connected. Choose a canonical market; every action is simulated and receipt-verified at ${foundation.sync.revision}.`
    : `Finalized V1 data loaded at ${foundation.sync.revision}; connect a wallet to inspect account state.`);
  if (!wallet) {
    await refreshDirectEscape();
    updateRewardsAvailability();
    return;
  }
  const defaultMarket = foundation.markets[0]?.marketId ?? "";
  queryAll<HTMLSelectElement>("[data-position-market],[data-settle-market],[data-creator-market]").forEach((select) => {
    if (!select.value && defaultMarket) select.value = defaultMarket;
  });
  const directMarket = query<HTMLInputElement>("[data-direct-vault-market]");
  if (directMarket && !directMarket.value && defaultMarket) directMarket.value = defaultMarket;
  const treasuryMarket = query<HTMLSelectElement>("[data-treasury-market]");
  const defaultTreasuryMarket = foundation.markets.find((market) => market.launchPhase === 1)?.marketId ?? defaultMarket;
  if (treasuryMarket && !treasuryMarket.value && defaultTreasuryMarket) treasuryMarket.value = defaultTreasuryMarket;
  const settleUser = query<HTMLInputElement>("[data-settle-user]");
  if (settleUser && !settleUser.value) settleUser.value = wallet.account;
  await Promise.allSettled([refreshRewardPosition(), refreshCreatorReward(), refreshTreasuryReward(true), refreshDirectEscape()]);
  updateRewardsAvailability();
}

async function refreshCurrentPage(): Promise<void> {
  renderWallet();
  switch (currentPage()) {
    case "home": await renderHome(); break;
    case "markets": await renderMarkets(); break;
    case "trade":
      if (tradeMarket) await loadTradeMarket(tradeMarket.market.marketId);
      else {
        const marketId = query<HTMLInputElement>("[data-market-id]")?.value.trim().toLowerCase() ?? "";
        if (BYTES32_PATTERN.test(marketId)) await loadTradeMarket(marketId);
        else updateTradeAvailability();
      }
      break;
    case "create": renderCreateConfig(); break;
    case "stats": await renderStats(); break;
    case "rewards": await renderRewards(); break;
    case "faq": setPageStatus("FAQ loaded. Runtime-dependent actions are documented as fail-closed.", "success"); break;
  }
  refreshActionAvailability();
}

async function start(): Promise<void> {
  setupShell();
  renderWallet();
  const page = currentPage();
  switch (page) {
    case "markets": setupMarkets(); break;
    case "trade": setupTrade(); break;
    case "create": setupCreate(); break;
    case "rewards": setupRewards(); break;
    case "faq": setupFaq(); break;
  }
  if (page === "privacy" || page === "terms") {
    refreshActionAvailability();
    return;
  }
  await loadFoundation();
  await refreshCurrentPage();
}

void start().catch((error) => {
  foundationError = errorText(error);
  setPageStatus(`Runtime initialization failed — ${foundationError}`, "error");
  text("[data-rewards-status]", `Runtime initialization failed — ${foundationError}`);
  refreshActionAvailability();
});
