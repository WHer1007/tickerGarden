import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  erc20Abi,
  formatEther,
  formatUnits,
  http,
  toHex,
} from "viem";
import { robinhoodChain } from "./v2/chain.ts";
import { v2Abis, V2_EXECUTION_SPEC_ID } from "./v2/generated/abis.ts";
import { TickerGardenV2Client } from "./v2/readApi.ts";
import { parseV2RuntimeConfig } from "./v2/runtimeConfig.ts";
import { V2TransactionError, V2TransactionExecutor } from "./v2/transaction.ts";
import {
  assertCanonicalAssetBinding,
  assertCanonicalFactoryBindings,
  assertCanonicalLaunchBindings,
  assertCanonicalMarketBinding,
} from "./v2/chainBindings.ts";
import {
  buildCreateMarketRequest,
  buildCurveBuyRequest,
  buildCurveSellRequest,
  buildLaunchAndBuyRequests,
  findCanonicalMarketCreated,
  toCurveProgressViewModel,
} from "./v2/features/launch.ts";
import {
  buildAllocate,
  buildClaimRecovery,
  buildClaimStaker,
  buildCloseAllocation,
  buildDecreaseAllocation,
  buildDeposit,
  buildDepositAndAllocate,
  buildFinalizeRecoveryRoot,
  buildForceRelease,
  hasCanonicalRecoveryClaim,
  buildMigrateAllocation,
  buildStockApproval,
  buildVaultView,
  buildWithdraw,
  validateRecoveryRootState,
} from "./v2/features/vault.ts";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const HEX32 = /^0x[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const runtimeConfig = parseV2RuntimeConfig(import.meta.env);
const publicClient = createPublicClient({ chain: robinhoodChain, transport: http(robinhoodChain.rpcUrls.default.http[0]) });
const readApi = runtimeConfig.available ? new TickerGardenV2Client(runtimeConfig.baseUrl) : null;

const transactionStageLabels = {
  preflight: "Checking reconciled state",
  simulating_approval: "Simulating token approval",
  awaiting_approval_signature: "Confirm token approval in your wallet",
  approval_submitted: "Approval submitted",
  approval_confirmed: "Approval confirmed",
  simulating: "Simulating protocol call",
  awaiting_signature: "Confirm protocol call in your wallet",
  submitted: "Transaction submitted",
  pending: "Waiting for a canonical receipt",
  replaced: "Wallet replaced the transaction",
  confirming: "Reconciling fresh onchain state",
  confirmed: "Confirmed from fresh onchain state",
  failed: "Transaction stopped",
};

const launchPhases = ["Curve", "Swept", "Pool created", "Rescued"];
const marketStatuses = ["Active", "Paused", "Retired", "Emergency exit"];
const recoveryStatuses = ["No root", "Pending challenge", "Active", "Cancelled"];

function shortHex(value, left = 6, right = 4) {
  if (!value || value.length <= left + right + 2) return value || "—";
  return `${value.slice(0, left + 2)}…${value.slice(-right)}`;
}

function randomSalt() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

function errorText(error) {
  if (error && typeof error === "object" && "message" in error) return String(error.message);
  return "The operation could not be completed.";
}

function configString(config, key) {
  const value = config?.values?.[key];
  if (typeof value !== "string") throw new Error(`${config?.kind || "config"}.${key} is missing from the reconciled API response`);
  return value;
}

function configNumber(config, key) {
  const value = config?.values?.[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`${config?.kind || "config"}.${key} is invalid`);
  return value;
}

function assertSameRevision(sync, expected, label) {
  if (
    sync.chainId !== robinhoodChain.id
    || sync.status !== "synced"
    || sync.finality !== "finalized"
    || typeof sync.blockNumber !== "string"
    || !/^(0|[1-9][0-9]*)$/.test(sync.blockNumber)
    || typeof sync.blockHash !== "string"
    || !HEX32.test(sync.blockHash)
    || typeof sync.revision !== "string"
    || sync.revision.length === 0
    || sync.revision !== `${sync.blockNumber}:${sync.blockHash}`
    || sync.revision !== expected
  ) throw new Error(`${label} is not the expected finalized Robinhood Chain snapshot`);
}

async function readAllConfig(kind, revision) {
  const items = [];
  let cursor;
  for (let page = 0; page < 16; page += 1) {
    const response = await readApi.listConfig({ kind, limit: 100, ...(cursor ? { cursor } : {}) });
    assertSameRevision(response.sync, revision, `${kind} configuration snapshot`);
    items.push(...response.items);
    if (!response.nextCursor) return items;
    cursor = response.nextCursor;
  }
  throw new Error(`${kind} configuration exceeds the bounded browser load`);
}

async function readAllPositions(account) {
  const items = [];
  let cursor;
  let sync;
  for (let page = 0; page < 16; page += 1) {
    const response = await readApi.listUserPositions({ address: account, limit: 100, ...(cursor ? { cursor } : {}) });
    if (sync) assertSameRevision(response.sync, sync.revision, "position snapshot");
    else {
      assertSameRevision(response.sync, response.sync.revision, "position snapshot");
      sync = response.sync;
    }
    items.push(...response.items);
    if (!response.nextCursor) return { items, sync };
    cursor = response.nextCursor;
  }
  throw new Error("Position list exceeds the bounded browser load");
}

function reconciledSnapshot(sync) {
  return { executionSpecId: V2_EXECUTION_SPEC_ID, revision: sync.revision, syncStatus: sync.status };
}

function parseAmount(value, label) {
  const normalized = value.trim();
  if (!/^[1-9][0-9]*$/.test(normalized)) throw new Error(`${label} must be a positive raw-unit integer`);
  return BigInt(normalized);
}

function parseUint32(value, label) {
  const normalized = value.trim();
  if (!/^[1-9][0-9]*$/.test(normalized)) throw new Error(`${label} must be a positive integer`);
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed > 0xffff_ffff) throw new Error(`${label} exceeds uint32`);
  return parsed;
}

function parseMerkleProof(value) {
  let parsed;
  try { parsed = JSON.parse(value); } catch { throw new Error("Merkle proof must be a JSON array of bytes32 values"); }
  if (!Array.isArray(parsed) || parsed.length > 64 || parsed.some((node) => typeof node !== "string" || !HEX32.test(node))) {
    throw new Error("Merkle proof must contain at most 64 lowercase bytes32 values");
  }
  return parsed;
}

function formatAmount(value, decimals = 18, precision = 6) {
  try {
    const formatted = formatUnits(BigInt(value), decimals);
    const [whole, fraction = ""] = formatted.split(".");
    return fraction ? `${whole}.${fraction.slice(0, precision).replace(/0+$/, "")}`.replace(/\.$/, "") : whole;
  } catch {
    return "—";
  }
}

function tupleField(tuple, name, index) {
  if (tuple && typeof tuple === "object" && name in tuple) return tuple[name];
  return tuple?.[index];
}

function StatusNotice({ notice }) {
  if (!notice) return null;
  return (
    <div className={`notice notice-${notice.tone || "neutral"}`} role="status" aria-live="polite">
      <div>
        <strong>{notice.title}</strong>
        {notice.detail ? <span>{notice.detail}</span> : null}
      </div>
      {notice.hash ? <a href={`${robinhoodChain.blockExplorers.default.url}/tx/${notice.hash}`} target="_blank" rel="noreferrer">View transaction</a> : null}
    </div>
  );
}

function Metric({ label, value, detail }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

function App() {
  const [section, setSection] = useState("launch");
  const [foundation, setFoundation] = useState({ status: runtimeConfig.available ? "loading" : "locked" });
  const [wallet, setWallet] = useState(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  const [launchForm, setLaunchForm] = useState({
    assetUid: "", quoteId: "", templateId: "", beneficiary: "", name: "", symbol: "", metadataURI: "", salt: "",
    mode: "launch-buy", quoteIn: "", minTokensOut: "",
  });
  const [marketIdInput, setMarketIdInput] = useState("");
  const [marketState, setMarketState] = useState({ status: "idle" });
  const [tradeSide, setTradeSide] = useState("buy");
  const [tradeAmount, setTradeAmount] = useState("");
  const [tradeQuote, setTradeQuote] = useState(null);

  const [positionState, setPositionState] = useState({ status: "idle", items: [], markets: new Map() });
  const [selectedPositionId, setSelectedPositionId] = useState("");
  const [depositAssetUid, setDepositAssetUid] = useState("");
  const [vaultForm, setVaultForm] = useState({ amount: "", allocation: "", targetMarketId: "" });
  const [recoveryForm, setRecoveryForm] = useState({ marketId: "", epoch: "", assetKind: "quote", amount: "", proof: "[]" });
  const [recoveryState, setRecoveryState] = useState({ status: "idle" });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const loadFoundation = useCallback(async () => {
    if (!runtimeConfig.available || !readApi) return;
    setFoundation({ status: "loading" });
    try {
      const health = await readApi.getHealth();
      if (health.executionSpecId !== V2_EXECUTION_SPEC_ID) throw new Error("Read API execution spec does not match this build");
      if (health.status !== "read-api" || !health.readApiImplemented || !health.productRuntimeImplemented || health.transactionSubmission || health.custody) {
        throw new Error("V2 product runtime is incomplete or the Read API capability contract is unsafe");
      }
      const revision = health.sync.revision;
      assertSameRevision(health.sync, revision, "Read API health");
      const [assets, quotes, pons, templates, marketsPage, rawBindings, launchFee] = await Promise.all([
        readAllConfig("asset", revision),
        readAllConfig("quote", revision),
        readAllConfig("pons", revision),
        readAllConfig("template", revision),
        readApi.listMarkets({ limit: 100 }),
        publicClient.readContract({ abi: v2Abis.TickerGardenFactoryV2, address: runtimeConfig.factoryAddress, functionName: "runtimeBindings" }),
        publicClient.readContract({ abi: v2Abis.TickerGardenFactoryV2, address: runtimeConfig.factoryAddress, functionName: "launchFee" }),
      ]);
      assertSameRevision(marketsPage.sync, revision, "market snapshot");
      const bindings = assertCanonicalFactoryBindings(rawBindings, {
        launchRouter: runtimeConfig.launchRouterAddress,
        allocationManager: runtimeConfig.allocationManagerAddress,
        protocolFeeVault: runtimeConfig.protocolFeeVaultAddress,
      });
      const codeAddresses = [...new Set([runtimeConfig.factoryAddress, ...Object.values(bindings)])];
      const codes = await Promise.all(codeAddresses.map((address) => publicClient.getCode({ address })));
      if (codes.some((code) => !code || code === "0x")) throw new Error("One or more configured V2 contracts have no runtime code");
      setFoundation({ status: "ready", health, sync: health.sync, assets, quotes, pons, templates, markets: marketsPage.items, launchFee, bindings });
    } catch (error) {
      setFoundation({ status: "error", error: errorText(error) });
    }
  }, []);

  useEffect(() => { void loadFoundation(); }, [loadFoundation]);

  const activeAssets = useMemo(() => foundation.status === "ready" ? foundation.assets.filter((item) => item.status === 1) : [], [foundation]);
  const activeQuotes = useMemo(() => foundation.status === "ready" ? foundation.quotes.filter((item) => item.status === 1) : [], [foundation]);
  const activeTemplates = useMemo(() => foundation.status === "ready" ? foundation.templates.filter((item) => item.status === 1) : [], [foundation]);

  useEffect(() => {
    if (foundation.status !== "ready") return;
    setLaunchForm((current) => ({
      ...current,
      assetUid: current.assetUid || activeAssets[0]?.id || "",
      quoteId: current.quoteId || activeQuotes[0]?.id || "",
      templateId: current.templateId || activeTemplates[0]?.id || "",
      salt: current.salt || randomSalt(),
    }));
    setDepositAssetUid((current) => current || activeAssets[0]?.id || "");
  }, [foundation, activeAssets, activeQuotes, activeTemplates]);

  useEffect(() => {
    if (!wallet?.provider) return undefined;
    const invalidate = () => {
      setWallet(null);
      setPositionState({ status: "idle", items: [], markets: new Map() });
      setNotice({ tone: "warning", title: "Wallet connection changed", detail: "Reconnect before preparing another transaction." });
    };
    wallet.provider.on?.("accountsChanged", invalidate);
    wallet.provider.on?.("chainChanged", invalidate);
    return () => {
      wallet.provider.removeListener?.("accountsChanged", invalidate);
      wallet.provider.removeListener?.("chainChanged", invalidate);
    };
  }, [wallet]);

  const connectWallet = async () => {
    setNotice(null);
    try {
      const provider = window.ethereum;
      if (!provider?.request) throw new Error("No injected wallet was found in this browser");
      let chainId = Number(await provider.request({ method: "eth_chainId" }));
      if (chainId !== robinhoodChain.id) {
        try {
          await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: toHex(robinhoodChain.id) }] });
        } catch (error) {
          if (error?.code !== 4902) throw error;
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: toHex(robinhoodChain.id), chainName: robinhoodChain.name,
              nativeCurrency: robinhoodChain.nativeCurrency,
              rpcUrls: robinhoodChain.rpcUrls.default.http,
              blockExplorerUrls: [robinhoodChain.blockExplorers.default.url],
            }],
          });
        }
        chainId = Number(await provider.request({ method: "eth_chainId" }));
      }
      if (chainId !== robinhoodChain.id) throw new Error(`Wallet must be on Robinhood Chain ${robinhoodChain.id}`);
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      const account = String(accounts?.[0] || "").toLowerCase();
      if (!ADDRESS.test(account) || account === ZERO_ADDRESS) throw new Error("Wallet returned an invalid account");
      const walletClient = createWalletClient({ account, chain: robinhoodChain, transport: custom(provider) });
      const executor = new V2TransactionExecutor({ publicClient, walletClient });
      setWallet({ account, provider, walletClient, executor });
      setLaunchForm((current) => ({ ...current, beneficiary: current.beneficiary || account }));
      setNotice({ tone: "success", title: "Wallet connected", detail: shortHex(account) });
    } catch (error) {
      setNotice({ tone: "error", title: "Wallet connection failed", detail: errorText(error) });
    }
  };

  const disconnectWallet = () => {
    setWallet(null);
    setPositionState({ status: "idle", items: [], markets: new Map() });
    setNotice({ tone: "neutral", title: "Wallet disconnected locally" });
  };

  const assertReady = () => {
    if (!runtimeConfig.available || !readApi || foundation.status !== "ready") throw new Error("Canonical runtime configuration and a finalized read snapshot are required");
    if (!wallet) throw new Error("Connect a Robinhood Chain wallet first");
  };

  const ensureRevision = async (expected) => {
    let current;
    try {
      current = await readApi.getHealth();
    } catch (error) {
      throw new V2TransactionError("indexer_unavailable", "The Read API could not verify the current finalized revision", error);
    }
    if (current.sync.status === "lagging") throw new V2TransactionError("indexer_lagging", "The Indexer is lagging; refresh before signing");
    if (current.sync.status === "unavailable") throw new V2TransactionError("indexer_unavailable", "The Indexer is unavailable; refresh before signing");
    if (
      current.executionSpecId !== V2_EXECUTION_SPEC_ID
      || current.status !== "read-api"
      || !current.readApiImplemented
      || !current.productRuntimeImplemented
      || current.transactionSubmission
      || current.custody
      || current.sync.chainId !== robinhoodChain.id
      || current.sync.revision !== expected
      || current.sync.status !== "synced"
      || current.sync.finality !== "finalized"
    ) {
      throw new V2TransactionError("stale_snapshot", "The reconciled snapshot changed. Refresh before signing.");
    }
    try {
      assertSameRevision(current.sync, expected, "Read API health");
    } catch (error) {
      throw new V2TransactionError("stale_snapshot", "The Read API revision is not a canonical finalized snapshot", error);
    }
    return current.sync.revision;
  };

  const ensureCanonicalAsset = async (asset) => {
    if (foundation.status !== "ready") throw new Error("Canonical Factory bindings are unavailable");
    const raw = await publicClient.readContract({
      abi: v2Abis.OfficialStockRegistryV2,
      address: foundation.bindings.officialStockRegistry,
      functionName: "asset",
      args: [asset.id],
    });
    return assertCanonicalAssetBinding(asset, raw);
  };

  const ensureCanonicalMarket = async (market, expectedMarketId = market.marketId) => {
    if (foundation.status !== "ready") throw new Error("Canonical Factory bindings are unavailable");
    if (market.marketId !== expectedMarketId) throw new Error("Read API returned a different market identity than requested");
    const [rawMarket, rawRoute] = await Promise.all([
      publicClient.readContract({ abi: v2Abis.MarketRegistryV2, address: foundation.bindings.marketRegistry, functionName: "market", args: [market.marketId] }),
      publicClient.readContract({ abi: v2Abis.MarketRegistryV2, address: foundation.bindings.marketRegistry, functionName: "canonicalRoute", args: [market.marketId] }),
    ]);
    assertCanonicalMarketBinding(market, rawMarket, rawRoute);
  };

  const ensureCanonicalLaunch = async (selected) => {
    if (foundation.status !== "ready") throw new Error("Canonical Factory bindings are unavailable");
    const [asset, quote, pons, template] = await Promise.all([
      publicClient.readContract({ abi: v2Abis.OfficialStockRegistryV2, address: foundation.bindings.officialStockRegistry, functionName: "asset", args: [selected.asset.assetUid] }),
      publicClient.readContract({ abi: v2Abis.ApprovedQuoteRegistry, address: foundation.bindings.approvedQuoteRegistry, functionName: "quoteConfig", args: [selected.quote.configId] }),
      publicClient.readContract({ abi: v2Abis.PonsBaselineRegistry, address: foundation.bindings.ponsBaselineRegistry, functionName: "baseline", args: [selected.pons.baselineId] }),
      publicClient.readContract({ abi: v2Abis.LaunchTemplateRegistry, address: foundation.bindings.launchTemplateRegistry, functionName: "launchTemplate", args: [selected.template.templateId] }),
    ]);
    assertCanonicalLaunchBindings(selected, { asset, quote, pons, template });
  };

  const execute = async ({ operationKey, sync, request, approval, quoteExpiresAtMs, verifyChain, confirm }) => {
    assertReady();
    setBusy(operationKey);
    setNotice({ tone: "neutral", title: "Preparing transaction", detail: "No signature is requested before simulation succeeds." });
    try {
      const result = await wallet.executor.execute({
        operationKey,
        expectedAccount: wallet.account,
        snapshot: reconciledSnapshot(sync),
        request,
        ...(approval ? { approval } : {}),
        ...(quoteExpiresAtMs ? { quoteExpiresAtMs } : {}),
        confirmations: 1,
        currentRevision: async () => {
          const revision = await ensureRevision(sync.revision);
          if (verifyChain) await verifyChain();
          return revision;
        },
        confirm,
        onUpdate: (update) => setNotice({
          tone: update.stage === "failed" ? "error" : update.stage === "confirmed" ? "success" : "neutral",
          title: transactionStageLabels[update.stage] || update.stage,
          detail: update.error ? `${update.error.code}: ${update.error.message}` : undefined,
          hash: update.hash,
        }),
      });
      return result;
    } finally {
      setBusy("");
    }
  };

  const allowanceApproval = async (approval, token, spender, amount) => {
    if (!approval) return undefined;
    const allowance = await publicClient.readContract({ abi: erc20Abi, address: token, functionName: "allowance", args: [wallet.account, spender] });
    return allowance >= amount ? undefined : approval;
  };

  const selectedLaunchConfig = () => {
    const asset = foundation.assets.find((item) => item.id === launchForm.assetUid);
    const quote = foundation.quotes.find((item) => item.id === launchForm.quoteId);
    const template = foundation.templates.find((item) => item.id === launchForm.templateId);
    if (!asset || !quote || !template) throw new Error("Select an active asset, Quote and launch template");
    const baselineId = configString(quote, "ponsBaselineId").toLowerCase();
    const pons = foundation.pons.find((item) => item.id === baselineId);
    if (!pons) throw new Error("The Quote's canonical Pons baseline is not available");
    const beneficiary = (launchForm.beneficiary || wallet.account).toLowerCase();
    if (!launchForm.name.trim() || launchForm.name.length > 64) throw new Error("Name is required and must be at most 64 characters");
    if (!launchForm.symbol.trim() || launchForm.symbol.length > 16) throw new Error("Symbol is required and must be at most 16 characters");
    if (!launchForm.metadataURI.trim() || launchForm.metadataURI.length > 512) throw new Error("Metadata URI is required and must be at most 512 characters");
    return {
      asset: { assetUid: asset.id, status: asset.status },
      quote: {
        configId: quote.id,
        economicsHash: configString(quote, "economicsHash").toLowerCase(),
        quoteAsset: configString(quote, "quoteAsset").toLowerCase(),
        ponsBaselineId: baselineId,
        status: quote.status,
      },
      pons: { baselineId: pons.id, status: pons.status },
      template: { templateId: template.id, status: template.status },
      creatorRevenueBeneficiary: beneficiary,
      name: launchForm.name.trim(), symbol: launchForm.symbol.trim(), metadataURI: launchForm.metadataURI.trim(),
      salt: launchForm.salt.toLowerCase(),
    };
  };

  const handleLaunch = async (event) => {
    event.preventDefault();
    try {
      assertReady();
      await ensureRevision(foundation.sync.revision);
      const config = selectedLaunchConfig();
      const verifyChain = () => ensureCanonicalLaunch(config);
      await verifyChain();
      const previewMarketEconomics = (draft) => publicClient.readContract({
        abi: v2Abis.TickerGardenFactoryV2,
        address: runtimeConfig.factoryAddress,
        functionName: "previewMarketEconomics",
        args: [draft],
        account: wallet.account,
      });
      let built;
      let approval;
      if (launchForm.mode === "create") {
        built = await buildCreateMarketRequest({ factory: runtimeConfig.factoryAddress, launchFee: foundation.launchFee, config, previewMarketEconomics });
      } else {
        const quoteIn = parseAmount(launchForm.quoteIn, "First buy Quote");
        const minTokensOut = parseAmount(launchForm.minTokensOut, "Minimum Meme output");
        built = await buildLaunchAndBuyRequests({
          router: foundation.bindings.launchRouter, launchFee: foundation.launchFee, quoteIn, minTokensOut,
          recipient: wallet.account, config, previewMarketEconomics,
        });
        approval = await allowanceApproval(built.approval, config.quote.quoteAsset, foundation.bindings.launchRouter, quoteIn);
      }
      const created = await execute({
        operationKey: `launch:${launchForm.mode}:${config.salt}`,
        sync: foundation.sync,
        request: built.request,
        approval,
        quoteExpiresAtMs: Date.now() + 90_000,
        verifyChain,
        confirm: async (receipt) => {
          const result = findCanonicalMarketCreated(receipt, runtimeConfig.factoryAddress, {
            params: built.params,
            quoteAsset: config.quote.quoteAsset,
          });
          const [code, quoteAsset] = await Promise.all([
            publicClient.getCode({ address: result.curve }),
            publicClient.readContract({ abi: v2Abis.PonsCompatibleCurve, address: result.curve, functionName: "quoteAsset" }),
          ]);
          if (!code || code === "0x" || quoteAsset.toLowerCase() !== config.quote.quoteAsset) throw new Error("Fresh Curve deployment does not match the selected Quote");
          return result;
        },
      });
      setMarketIdInput(created.marketId);
      setLaunchForm((current) => ({ ...current, salt: randomSalt(), quoteIn: "", minTokensOut: "" }));
      setNotice({ tone: "success", title: "Market created and verified onchain", detail: shortHex(created.marketId) });
      window.setTimeout(() => { void loadFoundation(); }, 1500);
    } catch (error) {
      setNotice({ tone: "error", title: "Launch stopped", detail: errorText(error) });
    }
  };

  const loadMarket = async (requested = marketIdInput) => {
    if (!readApi) return;
    const marketId = requested.trim().toLowerCase();
    if (!HEX32.test(marketId)) {
      setMarketState({ status: "error", error: "Enter a lowercase canonical market ID" });
      return;
    }
    setMarketState({ status: "loading" });
    setTradeQuote(null);
    try {
      if (foundation.status !== "ready") throw new Error("Canonical Factory bindings are unavailable");
      const response = await readApi.getMarket({ marketId });
      assertSameRevision(response.sync, foundation.sync.revision, "market snapshot");
      await ensureCanonicalMarket(response.market, marketId);
      const view = toCurveProgressViewModel(response);
      const quoteDecimals = view.quoteAssetKind === "native" ? 18 : Number(await publicClient.readContract({ abi: erc20Abi, address: view.quoteAsset, functionName: "decimals" }));
      if (!Number.isInteger(quoteDecimals) || quoteDecimals < 6 || quoteDecimals > 18) throw new Error("Quote token returned decimals outside the approved 6-18 domain");
      setMarketState({ status: "ready", response, view, quoteDecimals });
      setMarketIdInput(marketId);
    } catch (error) {
      setMarketState({ status: "error", error: errorText(error) });
    }
  };

  const loadRecovery = async () => {
    setRecoveryState({ status: "loading" });
    try {
      if (!runtimeConfig.available || !readApi || foundation.status !== "ready") throw new Error("The complete V2 runtime gate is not open");
      const marketId = recoveryForm.marketId.trim().toLowerCase();
      if (!HEX32.test(marketId)) throw new Error("Enter a lowercase canonical market ID");
      const epoch = parseUint32(recoveryForm.epoch, "Recovery epoch");
      const assetKind = recoveryForm.assetKind;
      const response = await readApi.getMarket({ marketId });
      assertSameRevision(response.sync, foundation.sync.revision, "Recovery market snapshot");
      await ensureCanonicalMarket(response.market, marketId);
      toCurveProgressViewModel(response);
      if (response.market.marketStatus !== 3) throw new Error("Recovery roots are available only for an Emergency market");
      const feeAsset = (assetKind === "quote" ? response.market.quoteAsset : response.market.memeToken).toLowerCase();
      const [rawRoot, cap, rawSnapshot, latestBlock] = await Promise.all([
        publicClient.readContract({ abi: v2Abis.ProtocolFeeVault, address: foundation.bindings.protocolFeeVault, functionName: "recoveryRoot", args: [marketId, epoch, feeAsset] }),
        publicClient.readContract({ abi: v2Abis.ProtocolFeeVault, address: foundation.bindings.protocolFeeVault, functionName: "recoveryCap", args: [marketId, epoch, feeAsset] }),
        publicClient.readContract({ abi: v2Abis.ProtocolFeeVault, address: foundation.bindings.protocolFeeVault, functionName: "recoverySnapshot", args: [marketId, epoch] }),
        publicClient.getBlock({ blockTag: "latest" }),
      ]);
      const view = {
        root: String(tupleField(rawRoot, "root", 0)).toLowerCase(),
        declaredTotal: BigInt(tupleField(rawRoot, "declaredTotal", 1)),
        claimedTotal: BigInt(tupleField(rawRoot, "claimedTotal", 2)),
        proposedAt: BigInt(tupleField(rawRoot, "proposedAt", 3)),
        finalizableAt: BigInt(tupleField(rawRoot, "finalizableAt", 4)),
        proposalNonce: Number(tupleField(rawRoot, "proposalNonce", 5)),
        status: Number(tupleField(rawRoot, "status", 6)),
      };
      const snapshotBlock = BigInt(tupleField(rawSnapshot, "snapshotBlock", 0));
      const stateHash = String(tupleField(rawSnapshot, "stateHash", 1)).toLowerCase();
      validateRecoveryRootState(view, cap, snapshotBlock, stateHash, BigInt(response.sync.blockNumber));
      setRecoveryState({ status: "ready", marketId, epoch, assetKind, feeAsset, sync: response.sync, market: response.market, view, cap, snapshotBlock, stateHash, chainTimestamp: latestBlock.timestamp });
    } catch (error) {
      setRecoveryState({ status: "error", error: errorText(error) });
    }
  };

  const executeRecovery = async (action) => {
    try {
      assertReady();
      if (recoveryState.status !== "ready") throw new Error("Load a canonical recovery root first");
      const marketId = recoveryForm.marketId.trim().toLowerCase();
      const epoch = parseUint32(recoveryForm.epoch, "Recovery epoch");
      if (marketId !== recoveryState.marketId || epoch !== recoveryState.epoch || recoveryForm.assetKind !== recoveryState.assetKind) throw new Error("Recovery inputs changed; reload the root before signing");
      const verifyChain = () => ensureCanonicalMarket(recoveryState.market);
      await verifyChain();
      let request;
      let confirm;
      let operationKey;
      if (action === "finalize") {
        if (recoveryState.view.status !== 1) throw new Error("The root is not pending");
        const latestBlock = await publicClient.getBlock({ blockTag: "latest" });
        if (latestBlock.timestamp < recoveryState.view.finalizableAt) throw new Error("The root challenge period is still open at the latest chain timestamp");
        request = buildFinalizeRecoveryRoot(foundation.bindings.protocolFeeVault, marketId, epoch, recoveryState.feeAsset, recoveryState.view.proposalNonce);
        operationKey = `recovery:finalize:${marketId}:${epoch}:${recoveryState.feeAsset}:${recoveryState.view.proposalNonce}`;
        confirm = async () => {
          const current = await publicClient.readContract({ abi: v2Abis.ProtocolFeeVault, address: foundation.bindings.protocolFeeVault, functionName: "recoveryRoot", args: [marketId, epoch, recoveryState.feeAsset] });
          if (Number(tupleField(current, "status", 6)) !== 2 || Number(tupleField(current, "proposalNonce", 5)) !== recoveryState.view.proposalNonce) throw new Error("Fresh Recovery root is not active");
          return current;
        };
      } else if (action === "claim") {
        if (recoveryState.view.status !== 2) throw new Error("Only a finalized ACTIVE recovery root can be claimed");
        const amount = parseAmount(recoveryForm.amount, "Recovery amount");
        const proof = parseMerkleProof(recoveryForm.proof);
        request = buildClaimRecovery(foundation.bindings.protocolFeeVault, marketId, epoch, recoveryState.feeAsset, amount, proof);
        operationKey = `recovery:claim:${marketId}:${epoch}:${recoveryState.feeAsset}:${wallet.account}`;
        confirm = async (receipt) => {
          if (!hasCanonicalRecoveryClaim(receipt, foundation.bindings.protocolFeeVault, { marketId, epoch, feeAsset: recoveryState.feeAsset, user: wallet.account, amount })) throw new Error("The receipt did not contain the exact RecoveryClaimed event");
          const current = await publicClient.readContract({ abi: v2Abis.ProtocolFeeVault, address: foundation.bindings.protocolFeeVault, functionName: "recoveryRoot", args: [marketId, epoch, recoveryState.feeAsset] });
          const claimed = BigInt(tupleField(current, "claimedTotal", 2));
          if (claimed < recoveryState.view.claimedTotal + amount || claimed > recoveryState.view.declaredTotal) throw new Error("Fresh Recovery claimed total is inconsistent");
          return current;
        };
      } else {
        throw new Error("Unknown Recovery action");
      }
      await execute({ operationKey, sync: recoveryState.sync, request, verifyChain, confirm });
      setNotice({ tone: "success", title: action === "claim" ? "Recovery claim verified onchain" : "Recovery root finalized onchain" });
      window.setTimeout(() => { void loadRecovery(); }, 1200);
    } catch (error) {
      setNotice({ tone: "error", title: "Recovery action stopped", detail: errorText(error) });
    }
  };

  const quoteCurveTrade = async () => {
    try {
      assertReady();
      if (marketState.status !== "ready") throw new Error("Load an active Curve market first");
      await ensureRevision(marketState.response.sync.revision);
      await ensureCanonicalMarket(marketState.response.market);
      const amount = parseAmount(tradeAmount, tradeSide === "buy" ? "Quote input" : "Meme input");
      let quote;
      if (tradeSide === "buy") {
        const [tokensOut, quoteSpent, refund] = await publicClient.readContract({
          abi: v2Abis.PonsCompatibleCurve, address: marketState.view.curve, functionName: "quoteBuy",
          args: [amount, wallet.account], account: wallet.account,
        });
        if (tokensOut <= 0n) throw new Error("Curve quote returned zero Meme output");
        quote = { side: "buy", amount, output: tokensOut, spent: quoteSpent, refund, fee: null, minimum: tokensOut * 99n / 100n || 1n };
      } else {
        const [quoteOut, fee] = await publicClient.readContract({
          abi: v2Abis.PonsCompatibleCurve, address: marketState.view.curve, functionName: "quoteSell", args: [amount], account: wallet.account,
        });
        if (quoteOut <= 0n) throw new Error("Curve quote returned zero Quote output");
        quote = { side: "sell", amount, output: quoteOut, spent: null, refund: null, fee, minimum: quoteOut * 99n / 100n || 1n };
      }
      setTradeQuote({ ...quote, marketId: marketState.view.marketId, revision: marketState.response.sync.revision, expiresAt: Date.now() + 30_000 });
    } catch (error) {
      setNotice({ tone: "error", title: "Quote unavailable", detail: errorText(error) });
    }
  };

  const executeCurveTrade = async () => {
    try {
      assertReady();
      if (marketState.status !== "ready" || !tradeQuote) throw new Error("Request a fresh Curve quote first");
      if (tradeQuote.expiresAt <= Date.now() || tradeQuote.marketId !== marketState.view.marketId || tradeQuote.side !== tradeSide) throw new Error("Curve quote expired or no longer matches this trade");
      const verifyChain = () => ensureCanonicalMarket(marketState.response.market);
      await verifyChain();
      let built;
      if (tradeSide === "buy") {
        built = buildCurveBuyRequest({ marketResponse: marketState.response, quoteIn: tradeQuote.amount, minTokensOut: tradeQuote.minimum, recipient: wallet.account });
      } else {
        built = buildCurveSellRequest({ marketResponse: marketState.response, tokensIn: tradeQuote.amount, minQuoteOut: tradeQuote.minimum, recipient: wallet.account });
      }
      const token = tradeSide === "buy" ? built.view.quoteAsset : built.view.memeToken;
      const approval = await allowanceApproval(built.approval, token, built.view.curve, tradeQuote.amount);
      const [before, sweepNonceBefore] = await Promise.all([
        publicClient.readContract({ abi: v2Abis.PonsCompatibleCurve, address: built.view.curve, functionName: "realQuoteReserve" }),
        publicClient.readContract({ abi: v2Abis.PonsCompatibleCurve, address: built.view.curve, functionName: "sweepNonce" }),
      ]);
      await execute({
        operationKey: `curve:${tradeSide}:${built.view.marketId}:${tradeQuote.amount}:${tradeQuote.revision}`,
        sync: marketState.response.sync,
        request: built.request,
        approval,
        quoteExpiresAtMs: tradeQuote.expiresAt,
        verifyChain,
        confirm: async () => {
          const [current, sweepNonceAfter] = await Promise.all([
            publicClient.readContract({ abi: v2Abis.PonsCompatibleCurve, address: built.view.curve, functionName: "realQuoteReserve" }),
            publicClient.readContract({ abi: v2Abis.PonsCompatibleCurve, address: built.view.curve, functionName: "sweepNonce" }),
          ]);
          if (current === before && sweepNonceAfter === sweepNonceBefore) throw new Error("Fresh Curve state did not reflect the confirmed trade");
          return current;
        },
      });
      setTradeAmount("");
      setTradeQuote(null);
      setNotice({ tone: "success", title: "Curve trade confirmed from live reserves" });
      window.setTimeout(() => { void loadMarket(built.view.marketId); }, 1500);
    } catch (error) {
      setNotice({ tone: "error", title: "Curve trade stopped", detail: errorText(error) });
    }
  };

  const refreshPositions = useCallback(async () => {
    if (!wallet || !readApi || foundation.status !== "ready") return;
    setPositionState({ status: "loading", items: [], markets: new Map() });
    try {
      const result = await readAllPositions(wallet.account);
      if (!result.sync || result.sync.status !== "synced" || result.sync.finality !== "finalized") throw new Error("Finalized position data is unavailable");
      const marketIds = [...new Set(result.items.map((position) => position.marketId))];
      const details = await Promise.all(marketIds.map(async (marketId) => {
        const detail = await readApi.getMarket({ marketId });
        if (detail.market.marketId !== marketId) throw new Error("Read API returned a different position market identity than requested");
        return detail;
      }));
      details.forEach((detail) => assertSameRevision(detail.sync, result.sync.revision, "position market snapshot"));
      await Promise.all(details.map((detail) => ensureCanonicalMarket(detail.market)));
      const markets = new Map(details.map((detail) => [detail.market.marketId, detail.market]));
      setPositionState({ status: "ready", items: result.items, markets, sync: result.sync });
      setSelectedPositionId((current) => current && result.items.some((item) => item.marketId === current) ? current : result.items[0]?.marketId || "");
    } catch (error) {
      setPositionState({ status: "error", error: errorText(error), items: [], markets: new Map() });
    }
  }, [wallet, foundation]);

  useEffect(() => { if (wallet && foundation.status === "ready") void refreshPositions(); }, [wallet, foundation.status, refreshPositions]);

  const selectedPosition = positionState.status === "ready" ? positionState.items.find((item) => item.marketId === selectedPositionId) : null;
  const selectedPositionMarket = selectedPosition ? positionState.markets.get(selectedPosition.marketId) : null;
  const selectedAsset = selectedPosition && foundation.status === "ready" ? foundation.assets.find((item) => item.id === selectedPosition.assetUid) : null;
  let vaultView = null;
  let vaultViewError = "";
  if (selectedPosition && selectedPositionMarket && selectedAsset && positionState.sync) {
    try {
      vaultView = buildVaultView(
        selectedPositionMarket,
        selectedPosition,
        reconciledSnapshot(positionState.sync),
        {
          status: selectedAsset.status,
          tokenDecimals: configNumber(selectedAsset, "tokenDecimals"),
          stockToken: configString(selectedAsset, "stockToken").toLowerCase(),
          userStockVault: configString(selectedAsset, "userStockVault").toLowerCase(),
        },
        BigInt(now),
      );
    } catch (error) {
      vaultViewError = errorText(error);
    }
  }

  const runVaultAction = async (action) => {
    try {
      assertReady();
      const amount = vaultForm.amount ? parseAmount(vaultForm.amount, "Amount") : null;
      const sync = positionState.sync || foundation.sync;
      let request;
      let approval;
      let confirm;
      let key;
      let verifyChain;

      if (action === "deposit") {
        const asset = foundation.assets.find((item) => item.id === depositAssetUid);
        if (!asset || asset.status !== 1 || !amount) throw new Error("Select an active STOCK asset and enter an amount");
        verifyChain = () => ensureCanonicalAsset(asset);
        const canonicalAsset = await verifyChain();
        const stockToken = canonicalAsset.stockToken;
        const vault = canonicalAsset.userStockVault;
        const before = await publicClient.readContract({ abi: v2Abis.UserStockVault, address: vault, functionName: "freeBalanceOf", args: [canonicalAsset.assetUid, wallet.account] });
        request = buildDeposit(vault, canonicalAsset.assetUid, amount);
        approval = await allowanceApproval(buildStockApproval(stockToken, vault, amount), stockToken, vault, amount);
        confirm = async () => {
          const after = await publicClient.readContract({ abi: v2Abis.UserStockVault, address: vault, functionName: "freeBalanceOf", args: [canonicalAsset.assetUid, wallet.account] });
          if (after !== before + amount) throw new Error("Fresh Vault balance does not match the deposit");
          return after;
        };
        key = `vault:deposit:${asset.id}:${amount}:${sync.revision}`;
      } else {
        if (!selectedPosition || !selectedPositionMarket || !selectedAsset || !positionState.sync || !vaultView) throw new Error("Select a valid reconciled position");
        const marketId = selectedPosition.marketId;
        verifyChain = async () => {
          const [assetBinding] = await Promise.all([
            ensureCanonicalAsset(selectedAsset),
            ensureCanonicalMarket(selectedPositionMarket),
          ]);
          return assetBinding;
        };
        const canonicalAsset = await verifyChain();
        const vault = canonicalAsset.userStockVault;
        const stockToken = canonicalAsset.stockToken;
        const before = await publicClient.readContract({ abi: v2Abis.UserStockVault, address: vault, functionName: "allocation", args: [canonicalAsset.assetUid, wallet.account, marketId] });
        key = `vault:${action}:${marketId}:${amount || 0n}:${positionState.sync.revision}`;

        if (action === "withdraw") {
          if (!amount || amount > vaultView.free) throw new Error("Withdrawal exceeds the displayed free STOCK balance");
          const freeBefore = await publicClient.readContract({ abi: v2Abis.UserStockVault, address: vault, functionName: "freeBalanceOf", args: [canonicalAsset.assetUid, wallet.account] });
          request = buildWithdraw(vault, canonicalAsset.assetUid, amount);
          confirm = async () => {
            const after = await publicClient.readContract({ abi: v2Abis.UserStockVault, address: vault, functionName: "freeBalanceOf", args: [canonicalAsset.assetUid, wallet.account] });
            if (after !== freeBefore - amount) throw new Error("Fresh Vault balance does not match the withdrawal");
            return after;
          };
        } else if (action === "allocate") {
          if (!amount || !vaultView.allocationOpen) throw new Error("Allocation is closed or the amount is invalid");
          if (before + amount < vaultView.minimumAllocationStock) throw new Error("Resulting allocation would not exceed 0.5 STOCK");
          request = buildAllocate(foundation.bindings.allocationManager, marketId, amount);
          confirm = async () => {
            const after = await publicClient.readContract({ abi: v2Abis.UserStockVault, address: vault, functionName: "allocation", args: [canonicalAsset.assetUid, wallet.account, marketId] });
            if (after !== before + amount) throw new Error("Fresh allocation does not match the increase");
            return after;
          };
        } else if (action === "decrease") {
          if (!amount || !vaultView.canDecrease || amount > before) throw new Error("Position is locked or the decrease exceeds its allocation");
          if (before - amount !== 0n && before - amount < vaultView.minimumAllocationStock) throw new Error("Remaining allocation would not exceed 0.5 STOCK");
          request = buildDecreaseAllocation(foundation.bindings.allocationManager, marketId, amount);
          confirm = async () => {
            const after = await publicClient.readContract({ abi: v2Abis.UserStockVault, address: vault, functionName: "allocation", args: [canonicalAsset.assetUid, wallet.account, marketId] });
            if (after !== before - amount) throw new Error("Fresh allocation does not match the decrease");
            return after;
          };
        } else if (action === "close") {
          if (!vaultView.canClose) throw new Error("Position cannot be closed before its normal unlock boundary");
          request = buildCloseAllocation(foundation.bindings.allocationManager, marketId);
          confirm = async () => {
            const after = await publicClient.readContract({ abi: v2Abis.UserStockVault, address: vault, functionName: "allocation", args: [canonicalAsset.assetUid, wallet.account, marketId] });
            if (after !== 0n) throw new Error("Fresh allocation is not closed");
            return after;
          };
        } else if (action === "deposit-allocate") {
          const deposit = amount;
          const allocation = parseAmount(vaultForm.allocation, "Allocation amount");
          if (!deposit || !vaultView.allocationOpen) throw new Error("Deposit-and-allocate is closed or invalid");
          if (before + allocation < vaultView.minimumAllocationStock) throw new Error("Resulting allocation would not exceed 0.5 STOCK");
          request = buildDepositAndAllocate(foundation.bindings.allocationManager, marketId, deposit, allocation);
          approval = await allowanceApproval(buildStockApproval(stockToken, vault, deposit), stockToken, vault, deposit);
          confirm = async () => {
            const after = await publicClient.readContract({ abi: v2Abis.UserStockVault, address: vault, functionName: "allocation", args: [canonicalAsset.assetUid, wallet.account, marketId] });
            if (after !== before + allocation) throw new Error("Fresh allocation does not match deposit-and-allocate");
            return after;
          };
          key = `vault:${action}:${marketId}:${deposit}:${allocation}:${positionState.sync.revision}`;
        } else if (action === "migrate") {
          if (!amount || !vaultView.canMigrate) throw new Error("Position cannot migrate before its unlock boundary");
          const target = vaultForm.targetMarketId.trim().toLowerCase();
          if (!HEX32.test(target) || target === marketId) throw new Error("Enter a different canonical target market ID");
          const targetResponse = await readApi.getMarket({ marketId: target });
          assertSameRevision(targetResponse.sync, positionState.sync.revision, "migration target snapshot");
          if (targetResponse.market.marketId !== target) throw new Error("Read API returned a different migration target identity than requested");
          if (targetResponse.market.assetUid !== selectedPosition.assetUid) throw new Error("Allocation migration must stay within the same STOCK asset");
          await ensureCanonicalMarket(targetResponse.market);
          const verifySourceAndTarget = verifyChain;
          verifyChain = async () => {
            await Promise.all([verifySourceAndTarget(), ensureCanonicalMarket(targetResponse.market)]);
          };
          const targetBefore = await publicClient.readContract({ abi: v2Abis.UserStockVault, address: vault, functionName: "allocation", args: [canonicalAsset.assetUid, wallet.account, target] });
          if (amount > before) throw new Error("Migration exceeds the source allocation");
          if (before - amount !== 0n && before - amount < vaultView.minimumAllocationStock) throw new Error("Remaining source allocation would not exceed 0.5 STOCK");
          if (targetBefore + amount < vaultView.minimumAllocationStock) throw new Error("Target allocation would not exceed 0.5 STOCK");
          request = buildMigrateAllocation(foundation.bindings.allocationManager, marketId, target, amount);
          confirm = async () => {
            const [sourceAfter, targetAfter] = await Promise.all([
              publicClient.readContract({ abi: v2Abis.UserStockVault, address: vault, functionName: "allocation", args: [canonicalAsset.assetUid, wallet.account, marketId] }),
              publicClient.readContract({ abi: v2Abis.UserStockVault, address: vault, functionName: "allocation", args: [canonicalAsset.assetUid, wallet.account, target] }),
            ]);
            if (sourceAfter !== before - amount || targetAfter !== targetBefore + amount) throw new Error("Fresh Vault allocations do not match the migration");
            return targetAfter;
          };
        } else if (action === "force-release") {
          if (!vaultView.canForceRelease) throw new Error("Force release is only available in Emergency exit");
          request = buildForceRelease(vault, canonicalAsset.assetUid, marketId);
          confirm = async () => {
            const after = await publicClient.readContract({ abi: v2Abis.UserStockVault, address: vault, functionName: "allocation", args: [canonicalAsset.assetUid, wallet.account, marketId] });
            if (after !== 0n) throw new Error("Fresh Vault state did not release the allocation");
            return after;
          };
        } else if (action === "claim-quote" || action === "claim-meme") {
          const claimQuote = action === "claim-quote";
          const feeAsset = claimQuote ? selectedPositionMarket.quoteAsset : selectedPositionMarket.memeToken;
          const gaugeBefore = await publicClient.readContract({ abi: v2Abis.MemeStockGauge, address: selectedPositionMarket.gauge, functionName: "positionOf", args: [wallet.account] });
          const claimableBefore = BigInt(tupleField(gaugeBefore, claimQuote ? "quoteClaimable" : "memeClaimable", claimQuote ? 4 : 5));
          if (claimableBefore <= 0n) throw new Error(`No ${claimQuote ? "Quote" : "Meme"} fees are claimable onchain`);
          request = buildClaimStaker(foundation.bindings.protocolFeeVault, marketId, feeAsset);
          confirm = async () => {
            const gaugeAfter = await publicClient.readContract({ abi: v2Abis.MemeStockGauge, address: selectedPositionMarket.gauge, functionName: "positionOf", args: [wallet.account] });
            const claimableAfter = BigInt(tupleField(gaugeAfter, claimQuote ? "quoteClaimable" : "memeClaimable", claimQuote ? 4 : 5));
            if (claimableAfter >= claimableBefore) throw new Error("Fresh Gauge claimable balance did not decrease");
            return claimableAfter;
          };
        } else {
          throw new Error("Unknown Vault action");
        }
      }

      await execute({ operationKey: key, sync, request, approval, verifyChain, confirm });
      setVaultForm({ amount: "", allocation: "", targetMarketId: "" });
      setNotice({ tone: "success", title: "Vault action confirmed from fresh onchain state" });
      window.setTimeout(() => { void refreshPositions(); }, 1200);
    } catch (error) {
      setNotice({ tone: "error", title: "Vault action stopped", detail: errorText(error) });
    }
  };

  const runtimeReady = runtimeConfig.available && foundation.status === "ready";
  const actionDisabled = !runtimeReady || !wallet || Boolean(busy);
  const recoverySelectionMatches = recoveryState.status === "ready"
    && recoveryForm.marketId.trim().toLowerCase() === recoveryState.marketId
    && recoveryForm.epoch.trim() === String(recoveryState.epoch)
    && recoveryForm.assetKind === recoveryState.assetKind;

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="TickerGarden home"><img src="/assets/tickergarden-mark.png" alt="" /><span>TickerGarden</span></a>
        <div className="topbar-actions">
          <div className={`network-state state-${runtimeReady ? "ready" : "warning"}`} role="status"><span className="state-dot" aria-hidden="true" />Robinhood Chain · {runtimeReady ? "finalized API + live RPC" : "locked"}</div>
          {wallet ? <button className="wallet-button" type="button" onClick={disconnectWallet}>{shortHex(wallet.account)}</button> : <button className="wallet-button" type="button" onClick={connectWallet}>Connect wallet</button>}
        </div>
      </header>

      <section className="workspace-heading" aria-labelledby="page-title">
        <div><p className="eyebrow">V2 product console · V2-EXEC-3</p><h1 id="page-title">Every action starts<br /><em>from visible state.</em></h1></div>
        <aside className="gate-card">
          <span className="gate-label">Runtime gate</span>
          <strong>{runtimeReady ? "LOCAL PRODUCT FLOW READY" : foundation.status === "loading" ? "CHECKING CANONICAL RUNTIME" : "TRANSACTIONS LOCKED"}</strong>
          <p>{runtimeReady ? `Finalized API block ${foundation.sync.blockNumber} · live quotes and transaction preflight use current RPC state · revision ${shortHex(foundation.sync.blockHash)}` : foundation.status === "error" ? foundation.error : "Deployment addresses and a reconciled read API are required. No placeholder address is accepted."}</p>
          <button className="text-button" type="button" onClick={loadFoundation} disabled={!runtimeConfig.available || foundation.status === "loading"}>Refresh chain facts</button>
        </aside>
      </section>

      {!runtimeConfig.available ? (
        <section className="config-lock" role="alert"><strong>Runtime configuration is incomplete.</strong><p>This build remains safe and read-only until every required value is supplied.</p><ul>{runtimeConfig.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></section>
      ) : null}
      <StatusNotice notice={notice} />

      <nav className="surface-tabs" aria-label="V2 product areas">
        <button type="button" className={section === "launch" ? "active" : ""} onClick={() => setSection("launch")}>Launch & Curve</button>
        <button type="button" className={section === "vault" ? "active" : ""} onClick={() => setSection("vault")}>Vault & earnings</button>
        <button type="button" className={section === "recovery" ? "active" : ""} onClick={() => setSection("recovery")}>Emergency recovery</button>
        <button type="button" className={section === "pool" ? "active" : ""} onClick={() => setSection("pool")}>Graduated pool</button>
      </nav>

      {section === "launch" ? (
        <section className="product-layout">
          <article className="panel panel-form">
            <div className="panel-heading"><div><p className="eyebrow">Create market</p><h2>Launch from approved inputs.</h2></div><span className="pill">Factory preview bound</span></div>
            <form onSubmit={handleLaunch}>
              <div className="form-grid">
                <label><span>Official STOCK</span><select value={launchForm.assetUid} onChange={(e) => setLaunchForm({ ...launchForm, assetUid: e.target.value })} disabled={!runtimeReady}>{activeAssets.map((asset) => <option value={asset.id} key={asset.id}>{shortHex(asset.id)} · {shortHex(asset.values.stockToken)}</option>)}</select></label>
                <label><span>Actual Quote</span><select value={launchForm.quoteId} onChange={(e) => setLaunchForm({ ...launchForm, quoteId: e.target.value })} disabled={!runtimeReady}>{activeQuotes.map((quote) => <option value={quote.id} key={quote.id}>{quote.values.quoteAsset === ZERO_ADDRESS ? "Native ETH" : shortHex(quote.values.quoteAsset)} · {shortHex(quote.id)}</option>)}</select></label>
                <label><span>Launch template</span><select value={launchForm.templateId} onChange={(e) => setLaunchForm({ ...launchForm, templateId: e.target.value })} disabled={!runtimeReady}>{activeTemplates.map((template) => <option value={template.id} key={template.id}>{shortHex(template.id)}</option>)}</select></label>
                <label><span>Creator revenue beneficiary</span><input value={launchForm.beneficiary} onChange={(e) => setLaunchForm({ ...launchForm, beneficiary: e.target.value })} placeholder={wallet?.account || "0x…"} /></label>
                <label><span>Meme name</span><input value={launchForm.name} maxLength={64} onChange={(e) => setLaunchForm({ ...launchForm, name: e.target.value })} placeholder="Garden Market" /></label>
                <label><span>Symbol</span><input value={launchForm.symbol} maxLength={16} onChange={(e) => setLaunchForm({ ...launchForm, symbol: e.target.value })} placeholder="GDN" /></label>
                <label className="wide"><span>Metadata URI</span><input value={launchForm.metadataURI} maxLength={512} onChange={(e) => setLaunchForm({ ...launchForm, metadataURI: e.target.value })} placeholder="ipfs://…" /></label>
                <label className="wide"><span>Identity salt</span><div className="input-action"><input value={launchForm.salt} onChange={(e) => setLaunchForm({ ...launchForm, salt: e.target.value })} /><button type="button" className="secondary" onClick={() => setLaunchForm({ ...launchForm, salt: randomSalt() })}>Regenerate</button></div></label>
              </div>
              <fieldset className="mode-switch"><legend>Launch path</legend><label><input type="radio" name="launchMode" value="launch-buy" checked={launchForm.mode === "launch-buy"} onChange={(e) => setLaunchForm({ ...launchForm, mode: e.target.value })} /> Create + first buy</label><label><input type="radio" name="launchMode" value="create" checked={launchForm.mode === "create"} onChange={(e) => setLaunchForm({ ...launchForm, mode: e.target.value })} /> Create only</label></fieldset>
              {launchForm.mode === "launch-buy" ? <div className="form-grid compact"><label><span>First-buy Quote · raw units</span><input inputMode="numeric" value={launchForm.quoteIn} onChange={(e) => setLaunchForm({ ...launchForm, quoteIn: e.target.value })} placeholder="10000000000000000" /></label><label><span>Minimum Meme output · raw units</span><input inputMode="numeric" value={launchForm.minTokensOut} onChange={(e) => setLaunchForm({ ...launchForm, minTokensOut: e.target.value })} placeholder="Set from an independent quote" /></label></div> : null}
              <div className="action-row"><div><span>Onchain launch fee</span><strong>{foundation.status === "ready" ? `${formatEther(foundation.launchFee)} ETH` : "—"}</strong></div><button type="submit" disabled={actionDisabled}>{busy.startsWith("launch:") ? "Launching…" : launchForm.mode === "create" ? "Simulate & create" : "Simulate & launch"}</button></div>
            </form>
            <p className="risk-copy">Expected economics is never editable: the page submits a zero draft, reads the Factory preview, and binds that exact hash. A first buy may partially fill near graduation and refund unused Quote.</p>
          </article>

          <article className="panel">
            <div className="panel-heading"><div><p className="eyebrow">Curve console</p><h2>Quote live reserves before signing.</h2></div><span className="pill">30s quote</span></div>
            <label><span>Canonical market ID</span><div className="input-action"><input value={marketIdInput} onChange={(e) => setMarketIdInput(e.target.value)} list="market-options" placeholder="0x…" /><button type="button" className="secondary" onClick={() => loadMarket()} disabled={!runtimeConfig.available || marketState.status === "loading"}>Load</button></div></label>
            <datalist id="market-options">{foundation.status === "ready" ? foundation.markets.map((market) => <option value={market.marketId} key={market.marketId} />) : null}</datalist>
            {marketState.status === "error" ? <p className="inline-error">{marketState.error}</p> : null}
            {marketState.status === "ready" ? <>
              <div className="metric-grid">
                <Metric label="Real Quote reserve" value={formatAmount(marketState.view.realQuoteReserve, marketState.quoteDecimals)} detail={`${marketState.view.realQuoteReserve} raw`} />
                <Metric label="Sellable Meme" value={formatAmount(marketState.view.sellableTokens, 18)} detail={`${marketState.view.sellableTokens} raw`} />
                <Metric label="Reserved Meme" value={formatAmount(marketState.view.reservedTokens, 18)} detail={`${marketState.view.reservedTokens} raw`} />
                <Metric label="Accrued Curve fee" value={formatAmount(marketState.view.accruedCurveFees, marketState.quoteDecimals)} detail={`${marketState.view.accruedCurveFees} raw`} />
              </div>
              <div className="market-line"><span>{launchPhases[marketState.view.launchPhase] || `Phase ${marketState.view.launchPhase}`}</span><span>{marketStatuses[marketState.view.marketStatus] || `Status ${marketState.view.marketStatus}`}</span><span>{marketState.view.quoteAssetKind === "native" ? "Native ETH Quote" : shortHex(marketState.view.quoteAsset)}</span></div>
              <fieldset className="mode-switch"><legend>Trade side</legend><label><input type="radio" name="tradeSide" value="buy" checked={tradeSide === "buy"} onChange={(e) => { setTradeSide(e.target.value); setTradeQuote(null); }} /> Buy Meme</label><label><input type="radio" name="tradeSide" value="sell" checked={tradeSide === "sell"} onChange={(e) => { setTradeSide(e.target.value); setTradeQuote(null); }} /> Sell Meme</label></fieldset>
              <label><span>{tradeSide === "buy" ? "Quote input" : "Meme input"} · raw units</span><input inputMode="numeric" value={tradeAmount} onChange={(e) => { setTradeAmount(e.target.value); setTradeQuote(null); }} placeholder="Enter raw units" /></label>
              <div className="split-actions"><button type="button" className="secondary" onClick={quoteCurveTrade} disabled={actionDisabled || !marketState.view.curveTradingEnabled}>Read onchain quote</button><button type="button" onClick={executeCurveTrade} disabled={actionDisabled || !tradeQuote}>{busy.startsWith("curve:") ? "Trading…" : "Simulate & trade"}</button></div>
              {tradeQuote ? <div className="quote-card"><span>{tradeSide === "buy" ? "Meme output" : "Quote output"}: <strong>{tradeQuote.output.toString()} raw</strong></span><span>Minimum at 1% tolerance: <strong>{tradeQuote.minimum.toString()} raw</strong></span>{tradeQuote.refund !== null ? <span>Possible refund: <strong>{tradeQuote.refund.toString()} raw Quote</strong></span> : null}{tradeQuote.fee !== null ? <span>Curve fee: <strong>{tradeQuote.fee.toString()} raw Quote</strong></span> : null}</div> : null}
            </> : <div className="empty-state"><strong>Load a market to inspect its canonical Curve.</strong><span>Trading remains disabled for paused, swept, graduated, rescued or Emergency markets.</span></div>}
          </article>
        </section>
      ) : null}

      {section === "vault" ? (
        <section className="product-layout vault-layout">
          <article className="panel">
            <div className="panel-heading"><div><p className="eyebrow">STOCK custody</p><h2>Principal stays visible.</h2></div><button type="button" className="secondary" onClick={refreshPositions} disabled={!wallet || !runtimeReady || positionState.status === "loading"}>Refresh positions</button></div>
            <div className="deposit-strip">
              <label><span>Official STOCK Vault</span><select value={depositAssetUid} onChange={(e) => setDepositAssetUid(e.target.value)} disabled={!runtimeReady}>{activeAssets.map((asset) => <option value={asset.id} key={asset.id}>{shortHex(asset.id)} · {shortHex(asset.values.stockToken)}</option>)}</select></label>
              <label><span>Deposit amount · raw units</span><input inputMode="numeric" value={vaultForm.amount} onChange={(e) => setVaultForm({ ...vaultForm, amount: e.target.value })} placeholder="Raw STOCK units" /></label>
              <button type="button" onClick={() => runVaultAction("deposit")} disabled={actionDisabled}>Approve & deposit</button>
            </div>
            <p className="risk-copy">The STOCK approval targets the canonical versioned multi-asset Vault. Protocol actions never approve the AllocationManager to custody principal.</p>
          </article>

          <article className="panel panel-wide">
            <div className="panel-heading"><div><p className="eyebrow">Allocation & earnings</p><h2>Free, pending and active are separate.</h2></div><span className="pill">30s pending · 24h lock</span></div>
            {!wallet ? <div className="empty-state"><strong>Connect a wallet to load reconciled positions.</strong><span>No position balance is inferred from local or cached form data.</span></div> : positionState.status === "loading" ? <div className="empty-state">Loading finalized positions…</div> : positionState.status === "error" ? <p className="inline-error">{positionState.error}</p> : positionState.items.length === 0 ? <div className="empty-state"><strong>No indexed market positions.</strong><span>You can still deposit into an official STOCK Vault above.</span></div> : <>
              <label><span>Market allocation</span><select value={selectedPositionId} onChange={(e) => setSelectedPositionId(e.target.value)}>{positionState.items.map((position) => <option value={position.marketId} key={`${position.assetUid}:${position.marketId}`}>{shortHex(position.marketId)} · {shortHex(position.assetUid)}</option>)}</select></label>
              {vaultViewError ? <p className="inline-error">{vaultViewError}</p> : null}
              {vaultView ? <>
                <div className="metric-grid vault-metrics">
                  <Metric label="Free STOCK" value={formatAmount(vaultView.free, configNumber(selectedAsset, "tokenDecimals"))} detail={`${vaultView.free} raw`} />
                  <Metric label="Allocated" value={formatAmount(vaultView.allocated, configNumber(selectedAsset, "tokenDecimals"))} detail={`${vaultView.allocated} raw`} />
                  <Metric label="Pending" value={formatAmount(vaultView.pending, configNumber(selectedAsset, "tokenDecimals"))} detail={selectedPosition.activationAt ? `activates ${new Date(Number(selectedPosition.activationAt) * 1000).toLocaleString()}` : "none"} />
                  <Metric label="Active" value={formatAmount(vaultView.active, configNumber(selectedAsset, "tokenDecimals"))} detail={selectedPosition.unlockAt ? `${Math.max(0, Number(selectedPosition.unlockAt) - now)}s to unlock` : "not locked"} />
                  <Metric label="Quote claimable" value={vaultView.quoteClaimable.toString()} detail={`asset ${shortHex(selectedPositionMarket.quoteAsset)}`} />
                  <Metric label="Meme claimable" value={vaultView.memeClaimable.toString()} detail={`asset ${shortHex(selectedPositionMarket.memeToken)}`} />
                </div>
                <div className="threshold-card"><span>Strict non-zero position threshold</span><strong>&gt; 0.5 STOCK · minimum {vaultView.minimumAllocationStock.toString()} raw units</strong><small>New and resulting allocations are checked by the contract using this asset's frozen decimals.</small></div>
                <div className="form-grid compact">
                  <label><span>Primary amount · raw units</span><input inputMode="numeric" value={vaultForm.amount} onChange={(e) => setVaultForm({ ...vaultForm, amount: e.target.value })} placeholder="Deposit / withdraw / allocate" /></label>
                  <label><span>Allocation amount · raw units</span><input inputMode="numeric" value={vaultForm.allocation} onChange={(e) => setVaultForm({ ...vaultForm, allocation: e.target.value })} placeholder="For deposit + allocate" /></label>
                  <label className="wide"><span>Migration target market ID</span><input value={vaultForm.targetMarketId} onChange={(e) => setVaultForm({ ...vaultForm, targetMarketId: e.target.value })} placeholder="Same STOCK asset, different Meme market" /></label>
                </div>
                <div className="action-cluster">
                  <button type="button" onClick={() => runVaultAction("allocate")} disabled={actionDisabled || !vaultView.allocationOpen}>Allocate / increase</button>
                  <button type="button" onClick={() => runVaultAction("deposit-allocate")} disabled={actionDisabled || !vaultView.allocationOpen}>Deposit + allocate</button>
                  <button type="button" className="secondary" onClick={() => runVaultAction("withdraw")} disabled={actionDisabled || vaultView.free === 0n}>Withdraw free</button>
                  <button type="button" className="secondary" onClick={() => runVaultAction("decrease")} disabled={actionDisabled || !vaultView.canDecrease}>Decrease</button>
                  <button type="button" className="secondary" onClick={() => runVaultAction("close")} disabled={actionDisabled || !vaultView.canClose}>Close allocation</button>
                  <button type="button" className="secondary" onClick={() => runVaultAction("migrate")} disabled={actionDisabled || !vaultView.canMigrate}>Migrate</button>
                  <button type="button" className="secondary" onClick={() => runVaultAction("claim-quote")} disabled={actionDisabled || vaultView.quoteClaimable === 0n}>Claim Quote fees</button>
                  <button type="button" className="secondary" onClick={() => runVaultAction("claim-meme")} disabled={actionDisabled || vaultView.memeClaimable === 0n}>Claim Meme fees</button>
                  <button type="button" className="danger" onClick={() => runVaultAction("force-release")} disabled={actionDisabled || !vaultView.canForceRelease}>Emergency force release</button>
                </div>
                <p className="risk-copy">Protocol fees are claimable in two separate assets; this is not block-by-block mining or token emission. Paused and retired markets preserve mature exits. Emergency force release returns only the connected user's principal and does not depend on the Gauge.</p>
              </> : null}
            </>}
          </article>
        </section>
      ) : null}

      {section === "recovery" ? (
        <section className="product-layout single-column">
          <article className="panel">
            <div className="panel-heading"><div><p className="eyebrow">Emergency recovery</p><h2>Principal first. Merkle claims only after finalization.</h2></div><span className="pill pill-warning">48h challenge</span></div>
            <div className="form-grid">
              <label><span>Emergency market ID</span><input value={recoveryForm.marketId} onChange={(event) => { setRecoveryForm({ ...recoveryForm, marketId: event.target.value }); setRecoveryState({ status: "idle" }); }} placeholder="0x…" /></label>
              <label><span>Recovery epoch</span><input inputMode="numeric" value={recoveryForm.epoch} onChange={(event) => { setRecoveryForm({ ...recoveryForm, epoch: event.target.value }); setRecoveryState({ status: "idle" }); }} placeholder="1" /></label>
              <label><span>Fee asset</span><select value={recoveryForm.assetKind} onChange={(event) => { setRecoveryForm({ ...recoveryForm, assetKind: event.target.value }); setRecoveryState({ status: "idle" }); }}><option value="quote">Quote asset</option><option value="meme">Meme asset</option></select></label>
              <label><span>Claim amount · raw units</span><input inputMode="numeric" value={recoveryForm.amount} onChange={(event) => setRecoveryForm({ ...recoveryForm, amount: event.target.value })} placeholder="Exact leaf amount" /></label>
              <label className="wide"><span>Merkle proof · JSON bytes32[]</span><textarea rows="4" value={recoveryForm.proof} onChange={(event) => setRecoveryForm({ ...recoveryForm, proof: event.target.value })} spellCheck="false" /></label>
            </div>
            <div className="split-actions"><button type="button" className="secondary" onClick={loadRecovery} disabled={!runtimeReady || recoveryState.status === "loading"}>{recoveryState.status === "loading" ? "Reading…" : "Read onchain root"}</button></div>
            {recoveryState.status === "error" ? <p className="inline-error">{recoveryState.error}</p> : null}
            {recoveryState.status === "ready" ? <>
              <div className="metric-grid">
                <Metric label="Root status" value={recoveryStatuses[recoveryState.view.status] || `Status ${recoveryState.view.status}`} detail={`nonce ${recoveryState.view.proposalNonce}`} />
                <Metric label="Frozen cap" value={recoveryState.cap.toString()} detail={`${recoveryState.feeAsset === ZERO_ADDRESS ? "Native ETH" : shortHex(recoveryState.feeAsset)}`} />
                <Metric label="Declared / claimed" value={`${recoveryState.view.declaredTotal} / ${recoveryState.view.claimedTotal}`} detail="raw asset units" />
                <Metric label="Snapshot" value={recoveryState.snapshotBlock.toString()} detail={shortHex(recoveryState.stateHash)} />
              </div>
              <div className="threshold-card"><span>Root commitment</span><strong>{shortHex(recoveryState.view.root, 12, 10)}</strong><small>{recoveryState.view.status === 1 ? `${Number(recoveryState.view.finalizableAt > recoveryState.chainTimestamp ? recoveryState.view.finalizableAt - recoveryState.chainTimestamp : 0n)}s remained at the sampled chain block; finalize rechecks the latest chain timestamp.` : recoveryState.view.status === 2 ? "ACTIVE and immutable; your proof still binds chain, vault, spec, market, epoch, asset, user and amount." : "This root cannot be used for a claim."}</small></div>
              <div className="split-actions"><button type="button" className="secondary" onClick={() => executeRecovery("finalize")} disabled={actionDisabled || !recoverySelectionMatches || recoveryState.view.status !== 1}>Simulate & finalize</button><button type="button" onClick={() => executeRecovery("claim")} disabled={actionDisabled || !recoverySelectionMatches || recoveryState.view.status !== 2}>Simulate & claim</button></div>
            </> : <div className="empty-state"><strong>Read the exact root before using a proof.</strong><span>A proposed or cancelled root is never claimable. Emergency STOCK principal release remains a separate direct Vault action and never waits for this root.</span></div>}
            <p className="risk-copy">Recovery allocations are governance and audit inputs, not balances invented by the Indexer. Verify the published leaf and proof independently. Region, eligibility and financial-risk language remains subject to the explicit legal release gate.</p>
          </article>
        </section>
      ) : null}

      {section === "pool" ? (
        <section className="product-layout single-column">
          <article className="panel">
            <div className="panel-heading"><div><p className="eyebrow">Graduated pool</p><h2>Canonical route facts, without a premature swap surface.</h2></div><span className="pill pill-warning">Fork evidence required</span></div>
            {marketState.status === "ready" && marketState.response.market.poolKey ? <>
              <div className="metric-grid"><Metric label="Pool ID" value={shortHex(marketState.response.market.poolId)} /><Metric label="Router" value={shortHex(marketState.response.market.canonicalRoute.router)} /><Metric label="Quoter" value={shortHex(marketState.response.market.canonicalRoute.quoter)} /><Metric label="Hook" value={shortHex(marketState.response.market.canonicalRoute.hook)} /></div>
              <div className="pool-key"><code>{JSON.stringify(marketState.response.market.poolKey, null, 2)}</code></div>
            </> : <div className="empty-state"><strong>No canonical PoolCreated market is loaded.</strong><span>Load a market in Launch & Curve first. Pool writes remain disabled until the pinned v4 fork evidence is complete.</span></div>}
            <p className="risk-copy">Only the canonical PoolKey and Hook fee source count toward STOCK staker fees. The protocol's 1% swap fee splits 20% to pool fee growth and 80% to non-LP accounting; this page makes no claim about any single LP address's share.</p>
          </article>
        </section>
      ) : null}

      <section className="truth-strip" aria-label="Protocol guarantees"><span>Factory-previewed economics</span><span>Simulation before every signature</span><span>Finalized source revisions</span><span>Quote and Meme fees separated</span></section>
      <footer className="footer"><span>Execution spec V2-EXEC-3 · readiness IMPLEMENTATION_ALLOWED</span><span>Pool swaps, Recovery claims and production publishing remain closed until their explicit gates are satisfied.</span></footer>
    </main>
  );
}

export default App;
