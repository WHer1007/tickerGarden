#!/usr/bin/env node
/*
 * Reproducible standard-pool capture for Robinhood Chain Stock Tokens.
 *
 * This intentionally uses the repository's already-installed viem runtime
 * (website-fruit-tree/node_modules/viem) and does not add a dependency.  The
 * capture is pinned to one block: every factory and pool read uses the same
 * block number, so the resulting files can be consumed by
 * build_observed_snapshot.py without mixing chain state.
 */

import {
  createPublicClient,
  decodeFunctionResult,
  defineChain,
  encodeFunctionData,
  http,
} from "../../website-fruit-tree/node_modules/viem/_esm/index.js";

const CHAIN_ID = 4663;
const RPC_DEFAULT = "https://rpc.mainnet.chain.robinhood.com";
const ASSET_API = "https://api.robinhood.com/rhj/assets";
const DEXSCREENER_API = "https://api.dexscreener.com/latest/dex/tokens/";
const MULTICALL3 = "0xca11bde05977b3631167028862be2a173976ca11";
const ZERO = "0x0000000000000000000000000000000000000000";
const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
const QUOTES = [
  ["USDG", USDG],
  ["WETH", WETH],
];
const V2_FACTORY = "0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f";
const V3_FACTORY = "0x1f7d7550b1b028f7571e69a784071f0205fd2efa";
const V3_FEES = [100, 500, 3000, 10000];
const V3_TICK_SPACING = { 100: 1, 500: 10, 3000: 60, 10000: 200 };
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const UID = /^0x[0-9a-fA-F]{64}$/;

const chain = defineChain({
  id: CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_DEFAULT] } },
});

const factoryAbi = [
  {
    type: "function",
    name: "getPair",
    stateMutability: "view",
    inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }],
    outputs: [{ name: "pair", type: "address" }],
  },
  {
    type: "function",
    name: "getPool",
    stateMutability: "view",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "fee", type: "uint24" },
    ],
    outputs: [{ name: "pool", type: "address" }],
  },
];

const poolAbi = [
  { type: "function", name: "fee", stateMutability: "view", inputs: [], outputs: [{ type: "uint24" }] },
  { type: "function", name: "tickSpacing", stateMutability: "view", inputs: [], outputs: [{ type: "int24" }] },
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
];

const usage = `Usage: capture_standard_pools.mjs [options]

Options:
  --block latest|finalized|safe|<number>
                                  Block tag/number to pin (default: finalized)
  --rpc <url>                      JSON-RPC endpoint
  --rpc-mode auto|rpc-batch|multicall
                                  Auto falls back to direct eth_call batches
  --rpc-batch-size <n>             Direct batch size (default: 10)
  --rpc-delay-ms <n>               Delay between direct batches (default: 200)
  --symbols <CSV>                   Capture only these official symbols (smoke/debug)
  --output-dir <path>              Output directory (default: current directory)
  --with-dexscreener               Fetch one DexScreener request per asset
  --request-delay-ms <n>           Delay between third-party requests (default: 250)
  --help                           Show this help

Outputs: official-assets.source.json, factory-calls.json, v3-details.json,
capture-manifest.json, and (with --with-dexscreener) dexscreener.json.
`;

function die(message) {
  throw new Error(message);
}

function address(value, label, allowZero = false) {
  if (typeof value !== "string" || !ADDRESS.test(value)) die(`invalid ${label}: ${value}`);
  const normalized = value.toLowerCase();
  if (!allowZero && normalized === ZERO) die(`zero ${label}`);
  return normalized;
}

function parseArgs(argv) {
  const args = {
    block: "finalized",
    rpc: RPC_DEFAULT,
    rpcMode: "auto",
    rpcBatchSize: 10,
    rpcDelayMs: 200,
    symbols: null,
    outputDir: ".",
    withDexscreener: false,
    requestDelayMs: 250,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      console.log(usage);
      process.exit(0);
    }
    const value = () => {
      if (i + 1 >= argv.length) die(`${arg} needs a value`);
      i += 1;
      return argv[i];
    };
    if (arg === "--block") args.block = value();
    else if (arg === "--rpc") args.rpc = value();
    else if (arg === "--rpc-mode") args.rpcMode = value();
    else if (arg === "--rpc-batch-size") args.rpcBatchSize = Number(value());
    else if (arg === "--rpc-delay-ms") args.rpcDelayMs = Number(value());
    else if (arg === "--symbols") args.symbols = value().split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);
    else if (arg === "--output-dir") args.outputDir = value();
    else if (arg === "--with-dexscreener") args.withDexscreener = true;
    else if (arg === "--request-delay-ms") args.requestDelayMs = Number(value());
    else die(`unknown option: ${arg}`);
  }
  if (!Number.isFinite(args.requestDelayMs) || args.requestDelayMs < 0) die("request delay must be non-negative");
  if (!Number.isInteger(args.rpcBatchSize) || args.rpcBatchSize < 1 || args.rpcBatchSize > 50) die("rpc batch size must be an integer from 1 to 50");
  if (!Number.isFinite(args.rpcDelayMs) || args.rpcDelayMs < 0) die("rpc delay must be non-negative");
  if (!["auto", "rpc-batch", "multicall"].includes(args.rpcMode)) die(`invalid --rpc-mode: ${args.rpcMode}`);
  if (args.symbols && (args.symbols.length === 0 || new Set(args.symbols).size !== args.symbols.length)) die("symbols must be a non-empty, duplicate-free CSV");
  return args;
}

function isoTimestamp(seconds) {
  return new Date(Number(seconds) * 1000).toISOString();
}

async function fetchJson(url, options = {}, attempts = 8) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: { "user-agent": "TickerGarden-RH-Research/1.0", ...(options.headers ?? {}) },
      });
      if (response.ok) return await response.json();
      const retryable = response.status === 429 || response.status >= 500;
      const retryAfter = Number(response.headers.get("retry-after"));
      const error = new Error(`HTTP ${response.status} for ${url}`);
      error.status = response.status;
      lastError = error;
      if (!retryable || attempt === attempts - 1) throw error;
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(30000, 2 ** attempt * 1000);
      await new Promise((resolve) => setTimeout(resolve, delay));
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(30000, 2 ** attempt * 1000)));
    }
  }
  throw lastError;
}

async function fetchRpcBatch(rpcUrl, payload, attempts = 8) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "TickerGarden-RH-Research/1.0",
        },
        body: JSON.stringify(payload),
      });
      if (response.ok) {
        const body = await response.json();
        if (!Array.isArray(body)) die("JSON-RPC batch response is not an array");
        return body;
      }
      const error = new Error(`HTTP ${response.status} for JSON-RPC batch`);
      error.status = response.status;
      lastError = error;
      if (response.status !== 429 && response.status < 500) throw error;
      const retryAfter = Number(response.headers.get("retry-after"));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(30000, 2 ** attempt * 1000);
      await sleep(delay);
    } catch (error) {
      lastError = error;
      if (error?.status && error.status !== 429 && error.status < 500) throw error;
      if (attempt === attempts - 1) throw error;
      await sleep(Math.min(30000, 2 ** attempt * 1000));
    }
  }
  throw lastError;
}

function blockHex(blockNumber) {
  return `0x${BigInt(blockNumber).toString(16)}`;
}

async function rpcBatchChecked(rpcUrl, contracts, blockNumber, label, batchSize = 10, delayMs = 200) {
  const output = [];
  for (let offset = 0; offset < contracts.length; offset += batchSize) {
    const chunk = contracts.slice(offset, offset + batchSize);
    if (offset > 0 || delayMs > 0) await sleep(delayMs);
    const payload = chunk.map((contract, index) => ({
      jsonrpc: "2.0",
      id: index + 1,
      method: "eth_call",
      params: [
        {
          to: address(contract.address, `${label} target`),
          data: encodeFunctionData({
            abi: contract.abi,
            functionName: contract.functionName,
            args: contract.args,
          }),
        },
        blockHex(blockNumber),
      ],
    }));
    const response = await fetchRpcBatch(rpcUrl, payload);
    if (response.length !== chunk.length) die(`${label} direct batch result count ${response.length} != ${chunk.length}`);
    const byId = new Map();
    for (const item of response) {
      if (!item || !Number.isInteger(item.id) || byId.has(item.id)) die(`${label} direct batch has missing/duplicate id`);
      byId.set(item.id, item);
    }
    for (let index = 0; index < chunk.length; index += 1) {
      const item = byId.get(index + 1);
      if (!item) die(`${label} direct batch omitted id ${index + 1}`);
      if (item.error) die(`${label}[${offset + index}] RPC error: ${JSON.stringify(item.error)}`);
      if (typeof item.result !== "string" || !item.result.startsWith("0x")) die(`${label}[${offset + index}] missing result`);
      try {
        output.push(decodeFunctionResult({
          abi: chunk[index].abi,
          functionName: chunk[index].functionName,
          data: item.result,
        }));
      } catch (error) {
        die(`${label}[${offset + index}] ABI decode error: ${error.message ?? error}`);
      }
    }
  }
  if (output.length !== contracts.length) die(`${label} direct result count ${output.length} != ${contracts.length}`);
  return output;
}

function officialAssets(payload) {
  if (!payload || !Array.isArray(payload.assets)) die("official API response has no assets array");
  if (payload.assets.length === 0) die("official directory returned no assets");
  const seenSymbols = new Set();
  const seenTokens = new Set();
  const assets = payload.assets.map((raw) => {
    const symbol = raw.tokenSymbol;
    if (typeof symbol !== "string" || seenSymbols.has(symbol)) die(`duplicate/invalid tokenSymbol: ${symbol}`);
    seenSymbols.add(symbol);
    if (typeof raw.id !== "string" || !UID.test(raw.id)) die(`invalid asset id for ${symbol}`);
    const deployments = (raw.deployments ?? []).filter((deployment) => Number(deployment.chainId) === CHAIN_ID);
    if (deployments.length !== 1) die(`${symbol} does not have exactly one chain ${CHAIN_ID} deployment`);
    const token = address(deployments[0].contractAddress, `${symbol} contract`);
    if (seenTokens.has(token)) die(`duplicate token address: ${token}`);
    seenTokens.add(token);
    if (raw.tokenDecimals !== 18) die(`${symbol} has non-18 tokenDecimals: ${raw.tokenDecimals}`);
    return {
      assetUid: raw.id.toLowerCase(),
      symbol,
      name: raw.tokenName,
      isin: raw.isin ?? null,
      stockToken: token,
      chainId: CHAIN_ID,
      decimals: raw.tokenDecimals,
      officialStatus: raw.status,
      currentMultiplier: raw.currentMultiplier ?? null,
      pendingMultiplier: raw.pendingMultiplier ?? null,
      pendingMultiplierEffectiveTime: raw.pendingMultiplierEffectiveTime ?? null,
      logoUrl: raw.logoUrl ?? null,
      tradingCapabilities: raw.tradingCapabilities ?? null,
    };
  });
  assets.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return assets;
}

function blockArgument(block) {
  if (block === "latest" || block === "finalized" || block === "safe") return { blockTag: block };
  if (!/^\d+$/.test(block)) die(`invalid --block: ${block}`);
  return { blockNumber: BigInt(block) };
}

async function readBlock(client, block) {
  const value = await client.getBlock(blockArgument(block));
  if (!value.hash || value.number === null) die("selected block has no hash/number");
  return {
    number: Number(value.number),
    hash: value.hash.toLowerCase(),
    timestamp: isoTimestamp(value.timestamp),
    timestampUnix: Number(value.timestamp),
  };
}

function queryKey(query) {
  return [query.token, query.quote, query.kind, query.fee ?? null].join(":");
}

async function multicallChecked(client, contracts, blockNumber, label, rpcUrl, modeState) {
  if (modeState.useDirect || modeState.requested === "rpc-batch") {
    return rpcBatchChecked(rpcUrl, contracts, blockNumber, label, modeState.batchSize, modeState.delayMs);
  }
  try {
    const results = await client.multicall({
      contracts,
      multicallAddress: MULTICALL3,
      allowFailure: true,
      blockNumber: BigInt(blockNumber),
    });
    if (!Array.isArray(results) || results.length !== contracts.length) {
      throw new Error(`multicall result count ${results?.length} != ${contracts.length}`);
    }
    for (let i = 0; i < results.length; i += 1) {
      if (results[i].status !== "success") throw new Error(`multicall[${i}] RPC/contract error: ${String(results[i].error ?? "unknown")}`);
    }
    return results.map((item) => item.result);
  } catch (error) {
    if (modeState.requested !== "auto") throw error;
    modeState.useDirect = true;
    console.warn(`${label}: Multicall3 failed; falling back to direct JSON-RPC eth_call batches: ${error.message ?? error}`);
    return rpcBatchChecked(rpcUrl, contracts, blockNumber, label, modeState.batchSize, modeState.delayMs);
  }
}

async function captureFactories(client, assets, block, blockTagRequested, rpcUrl, modeState) {
  const queries = [];
  for (const asset of assets) {
    for (const [quote, quoteToken] of QUOTES) {
      queries.push({ kind: "v2", symbol: asset.symbol, token: asset.stockToken, quote, quoteToken, fee: null, address: V2_FACTORY, functionName: "getPair", args: [asset.stockToken, quoteToken] });
      for (const fee of V3_FEES) {
        queries.push({ kind: "v3", symbol: asset.symbol, token: asset.stockToken, quote, quoteToken, fee, address: V3_FACTORY, functionName: "getPool", args: [asset.stockToken, quoteToken, fee] });
      }
    }
  }
  const keys = new Set(queries.map(queryKey));
  if (keys.size !== queries.length || queries.length !== assets.length * 10) die(`factory query duplicate/count failure: ${queries.length}/${keys.size}`);
  const calls = [];
  const chunkSize = 160;
  for (let offset = 0; offset < queries.length; offset += chunkSize) {
    const chunk = queries.slice(offset, offset + chunkSize);
    const results = await multicallChecked(client, chunk.map((query) => ({ address: query.address, abi: factoryAbi, functionName: query.functionName, args: query.args })), block.number, `factory chunk ${offset}`, rpcUrl, modeState);
    for (let i = 0; i < chunk.length; i += 1) {
      const query = chunk[i];
      const result = address(results[i], `${query.symbol} ${query.kind} result`, true);
      calls.push({ kind: query.kind, symbol: query.symbol, token: query.token, quote: query.quote, quoteToken: query.quoteToken, fee: query.fee, address: query.address, functionName: query.functionName, result });
    }
  }
  const returnedKeys = new Set(calls.map(queryKey));
  if (calls.length !== queries.length || returnedKeys.size !== queries.length) die(`factory result duplicate/count failure: ${calls.length}/${returnedKeys.size}`);
  return { block: block.number, blockHash: block.hash, blockTimestamp: block.timestamp, blockTagRequested, calls };
}

async function captureV3Details(client, factoryCapture, assets, block, rpcUrl, modeState) {
  const byToken = new Map(assets.map((asset) => [asset.stockToken, asset]));
  const pools = factoryCapture.calls.filter((call) => call.kind === "v3" && call.result !== ZERO);
  const seen = new Set();
  for (const pool of pools) {
    const asset = byToken.get(pool.token);
    if (!asset) die(`V3 result is not an official token: ${pool.token}`);
    const key = queryKey(pool);
    if (seen.has(key)) die(`duplicate V3 detail query: ${key}`);
    seen.add(key);
  }
  const details = [];
  const chunkSize = 120;
  for (let offset = 0; offset < pools.length; offset += chunkSize) {
    const chunk = pools.slice(offset, offset + chunkSize);
    const contracts = [];
    for (const pool of chunk) {
      for (const functionName of ["fee", "tickSpacing", "token0", "token1"]) contracts.push({ address: pool.result, abi: poolAbi, functionName });
    }
    const results = await multicallChecked(client, contracts, block.number, `V3 detail chunk ${offset}`, rpcUrl, modeState);
    for (let i = 0; i < chunk.length; i += 1) {
      const pool = chunk[i];
      const values = results.slice(i * 4, i * 4 + 4);
      const fee = Number(values[0]);
      const tickSpacing = Number(values[1]);
      const token0 = address(values[2], `${pool.symbol} token0`);
      const token1 = address(values[3], `${pool.symbol} token1`);
      if (fee !== pool.fee || tickSpacing !== V3_TICK_SPACING[pool.fee] || new Set([token0, token1]).size !== 2 || !new Set([token0, token1]).has(pool.token) || !new Set([token0, token1]).has(pool.quoteToken)) {
        die(`V3 pool detail mismatch for ${pool.symbol}/${pool.quote}/${pool.fee}/${pool.result}: got fee=${fee}, tickSpacing=${tickSpacing}, token0=${token0}, token1=${token1}; expected token=${pool.token}, quote=${pool.quoteToken}`);
      }
      details.push({ token: pool.token, symbol: pool.symbol, quote: pool.quote, fee: pool.fee, result: pool.result, detail: { fee, tickSpacing, token0, token1 } });
    }
  }
  if (details.length !== pools.length || new Set(details.map(queryKey)).size !== pools.length) die(`V3 detail count failure: ${details.length}/${pools.length}`);
  return { block: block.number, blockHash: block.hash, blockTimestamp: block.timestamp, pools: details };
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function captureDexscreener(assets, delayMs) {
  const records = [];
  for (const asset of assets) {
    if (records.length > 0) await sleep(delayMs);
    try {
      const payload = await fetchJson(`${DEXSCREENER_API}${asset.stockToken}`);
      if (!payload || !Array.isArray(payload.pairs)) die("response has no pairs array");
      records.push({ symbol: asset.symbol, address: asset.stockToken, status: "OK", pairs: payload.pairs });
    } catch (error) {
      records.push({ symbol: asset.symbol, address: asset.stockToken, status: `ERROR_HTTP_${error.status ?? "NETWORK"}`, error: String(error.message ?? error), pairs: [] });
    }
  }
  if (records.length !== assets.length || new Set(records.map((record) => record.symbol)).size !== assets.length) die("DexScreener result count/duplicate failure");
  return records;
}

async function writeJson(path, value) {
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(new URL(".", `file://${path}`).pathname, { recursive: true }).catch(() => {});
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { resolve } = await import("node:path");
  const { mkdir, writeFile } = await import("node:fs/promises");
  const outputDir = resolve(args.outputDir);
  await mkdir(outputDir, { recursive: true });
  const client = createPublicClient({ chain, transport: http(args.rpc) });
  const modeState = {
    requested: args.rpcMode,
    useDirect: args.rpcMode === "rpc-batch",
    batchSize: args.rpcBatchSize,
    delayMs: args.rpcDelayMs,
  };
  const actualChainId = await client.getChainId();
  if (actualChainId !== CHAIN_ID) die(`RPC chain id ${actualChainId} != ${CHAIN_ID}`);
  const officialResponse = await fetchJson(ASSET_API);
  const directoryAssets = officialAssets(officialResponse);
  const requestedSymbols = args.symbols ? new Set(args.symbols) : null;
  const assets = requestedSymbols
    ? directoryAssets.filter((asset) => requestedSymbols.has(asset.symbol))
    : directoryAssets;
  if (requestedSymbols) {
    const selectedSymbols = new Set(assets.map((asset) => asset.symbol));
    const missing = args.symbols.filter((symbol) => !selectedSymbols.has(symbol));
    if (missing.length > 0) die(`unknown official symbol(s): ${missing.join(", ")}`);
  }
  const block = await readBlock(client, args.block);
  const factoryCapture = await captureFactories(client, assets, block, args.block, args.rpc, modeState);
  const v3Capture = await captureV3Details(client, factoryCapture, assets, block, args.rpc, modeState);
  const files = ["official-assets.source.json", "factory-calls.json", "v3-details.json"];
  await writeFile(`${outputDir}/official-assets.source.json`, `${JSON.stringify(officialResponse, null, 2)}\n`, "utf8");
  await writeJson(`${outputDir}/factory-calls.json`, factoryCapture);
  await writeJson(`${outputDir}/v3-details.json`, v3Capture);
  if (args.withDexscreener) {
    const dex = await captureDexscreener(assets, args.requestDelayMs);
    await writeJson(`${outputDir}/dexscreener.json`, { capturedAt: new Date().toISOString(), records: dex });
    files.push("dexscreener.json");
  }
  const manifest = {
    schemaVersion: 1,
    kind: "ROBINHOOD_CHAIN_STANDARD_POOL_CAPTURE",
    capturedAt: new Date().toISOString(),
    chain: { name: "Robinhood Chain", chainId: CHAIN_ID, rpc: args.rpc, officialAssetApi: ASSET_API },
    observationBlock: block,
    officialAssetDirectoryCount: directoryAssets.length,
    officialAssetCount: assets.length,
    capturedAssetCount: assets.length,
    capturedSymbols: assets.map((asset) => asset.symbol),
    captureScope: requestedSymbols ? "SELECTED_OFFICIAL_SYMBOLS_SMOKE_OR_DEBUG" : "ALL_OFFICIAL_ASSETS",
    factoryQueryCount: factoryCapture.calls.length,
    factoryQueryExpected: assets.length * 10,
    v3PoolDetailCount: v3Capture.pools.length,
    rpcModeRequested: args.rpcMode,
    rpcModeUsed: modeState.useDirect ? "rpc-batch" : "multicall3",
    rpcBatchSize: args.rpcBatchSize,
    rpcDelayMs: args.rpcDelayMs,
    multicall3: MULTICALL3,
    deployments: { uniswapV2Factory: V2_FACTORY, uniswapV3Factory: V3_FACTORY, USDG, WETH },
    scope: { v2: { quotes: ["USDG", "WETH"], method: "getPair" }, v3: { quotes: ["USDG", "WETH"], fees: V3_FEES, tickSpacing: V3_TICK_SPACING, method: "getPool" }, dexscreener: args.withDexscreener ? "third-party, errors retained" : "not requested" },
    files,
  };
  await writeJson(`${outputDir}/capture-manifest.json`, manifest);
  console.log(JSON.stringify({ outputDir, observationBlock: block, officialAssetCount: assets.length, factoryQueryCount: factoryCapture.calls.length, v3PoolDetailCount: v3Capture.pools.length, dexscreener: args.withDexscreener }, null, 2));
}

main().catch((error) => {
  console.error(`capture failed: ${error?.stack ?? error}`);
  process.exitCode = 1;
});
