import http from "node:http";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const QUANTITY_PATTERN = /^(?:0x[0-9a-fA-F]+|[0-9]+)$/;
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const MAX_BATCH_SIZE = 100;
const READ_ONLY_METHODS = new Set([
  "anvil_nodeInfo",
  "eth_blockNumber",
  "eth_call",
  "eth_chainId",
  "eth_feeHistory",
  "eth_gasPrice",
  "eth_getBalance",
  "eth_getBlockByHash",
  "eth_getBlockByNumber",
  "eth_getBlockReceipts",
  "eth_getBlockTransactionCountByHash",
  "eth_getBlockTransactionCountByNumber",
  "eth_getCode",
  "eth_getProof",
  "eth_getStorageAt",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_maxPriorityFeePerGas",
  "net_version",
  "web3_clientVersion",
]);
const BLOCK_PARAMETER_INDEX = new Map([
  ["eth_call", 1],
  ["eth_getBalance", 1],
  ["eth_getCode", 1],
  ["eth_getProof", 2],
  ["eth_getStorageAt", 2],
  ["eth_getTransactionCount", 1],
]);

export class PinnedBlockMismatchError extends Error {}

export function normalizePinnedBlock({ blockNumber, blockHash }) {
  if (typeof blockNumber !== "string" || !QUANTITY_PATTERN.test(blockNumber)) {
    throw new Error("pinned block number must be a decimal or 0x-prefixed quantity string");
  }
  if (typeof blockHash !== "string" || !HASH_PATTERN.test(blockHash)) {
    throw new Error("pinned block hash must be a 32-byte 0x-prefixed hash");
  }
  const parsedBlockNumber = BigInt(blockNumber);
  if (parsedBlockNumber <= 0n) throw new Error("pinned block number must be positive");
  return {
    blockNumber: parsedBlockNumber.toString(10),
    blockNumberHex: `0x${parsedBlockNumber.toString(16)}`,
    blockHash: blockHash.toLowerCase(),
  };
}

function isObject(value) {
  return value !== null && !Array.isArray(value) && typeof value === "object";
}

function isBlockHashReference(value) {
  if (!isObject(value)) return false;
  const keys = Object.keys(value);
  return (
    Object.hasOwn(value, "blockHash") &&
    keys.every((key) => key === "blockHash" || key === "requireCanonical")
  );
}

export function rewritePinnedBlockReferences(request, pin) {
  if (!isObject(request)) throw new Error("JSON-RPC request must be an object");
  if (request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    throw new Error("JSON-RPC 2.0 method is required");
  }
  if (!READ_ONLY_METHODS.has(request.method)) {
    throw new Error(`unsupported read-only RPC method: ${request.method}`);
  }
  if (request.params !== undefined && !Array.isArray(request.params)) {
    throw new Error("JSON-RPC params must be an array");
  }
  const params = [...(request.params ?? [])];
  const blockIndex = BLOCK_PARAMETER_INDEX.get(request.method);
  if (blockIndex === undefined || !isObject(params[blockIndex])) return { ...request, params };

  const blockReference = params[blockIndex];
  if (!isBlockHashReference(blockReference)) {
    throw new PinnedBlockMismatchError("RPC block reference contains unsupported fields");
  }
  if (
    typeof blockReference.blockHash !== "string" ||
    blockReference.blockHash.toLowerCase() !== pin.blockHash
  ) {
    throw new PinnedBlockMismatchError("RPC request attempted to read an unpinned block hash");
  }
  if (
    Object.hasOwn(blockReference, "requireCanonical") &&
    typeof blockReference.requireCanonical !== "boolean"
  ) {
    throw new PinnedBlockMismatchError("requireCanonical must be boolean");
  }
  params[blockIndex] = pin.blockNumberHex;
  return { ...request, params };
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

export async function upstreamJsonRpc(upstreamUrl, body, fetcher = fetch) {
  // Retry transport failures only. Keep the exact request and pinned block; never
  // replace missing historical state with latest or an invented empty account.
  for (let attempt = 0; attempt < 3; ++attempt) {
    let response;
    try {
      response = await fetcher(upstreamUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8_000),
      });
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
      continue;
    }
    if (!response.ok) {
      if (![429, 502, 503, 504].includes(response.status) || attempt === 2) {
        throw new Error(`upstream RPC returned HTTP ${response.status}`);
      }
      await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
      continue;
    }
    return response.json(); // JSON-RPC state errors are returned unchanged, without retry.
  }
}

export async function verifyPinnedUpstream({ upstreamUrl, expectedChainId, pin }) {
  const requests = [
    { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] },
    { jsonrpc: "2.0", id: 2, method: "eth_getBlockByNumber", params: [pin.blockNumberHex, false] },
  ];
  const responses = await upstreamJsonRpc(upstreamUrl, requests);
  if (!Array.isArray(responses)) throw new Error("upstream RPC batch response is invalid");
  const byId = new Map(responses.map((response) => [response.id, response]));
  const actualChainId = byId.get(1)?.result;
  const block = byId.get(2)?.result;
  if (BigInt(actualChainId ?? -1) !== BigInt(expectedChainId)) {
    throw new Error(`upstream chain ID mismatch: expected ${expectedChainId}`);
  }
  if (
    block?.number?.toLowerCase() !== pin.blockNumberHex.toLowerCase() ||
    block?.hash?.toLowerCase() !== pin.blockHash
  ) {
    throw new Error("upstream pinned block number/hash mismatch");
  }
  return { chainId: String(BigInt(actualChainId)), blockNumber: pin.blockNumber, blockHash: pin.blockHash };
}

export async function createPinnedRpcProxy({ upstreamUrl, expectedChainId, blockNumber, blockHash }) {
  if (typeof upstreamUrl !== "string" || upstreamUrl.trim() === "") {
    throw new Error("ROBINHOOD_RPC_URL is required");
  }
  const pin = normalizePinnedBlock({ blockNumber, blockHash });
  await verifyPinnedUpstream({ upstreamUrl, expectedChainId, pin });

  const server = http.createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.method !== "POST") {
      response.statusCode = 405;
      response.end(JSON.stringify(jsonRpcError(null, -32600, "JSON-RPC POST required")));
      return;
    }

    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) throw new Error("RPC request body exceeds 10 MiB");
        chunks.push(chunk);
      }
      const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const batch = Array.isArray(parsed) ? parsed : [parsed];
      if (batch.length === 0 || batch.length > MAX_BATCH_SIZE) {
        throw new Error(`RPC batch must contain 1-${MAX_BATCH_SIZE} requests`);
      }
      const forwarded = [];
      const responsesByIndex = new Map();
      const forwardedIndexes = new Map();
      for (const [index, entry] of batch.entries()) {
        const isNotification = isObject(entry) && !Object.hasOwn(entry, "id");
        try {
          const rewritten = rewritePinnedBlockReferences(entry, pin);
          if (isNotification) continue;
          forwardedIndexes.set(String(rewritten.id), index);
          forwarded.push(rewritten);
        } catch (error) {
          if (isNotification) continue;
          const code = error instanceof PinnedBlockMismatchError ? -32042 : -32600;
          responsesByIndex.set(index, jsonRpcError(entry?.id, code, error instanceof Error ? error.message : String(error)));
        }
      }
      const upstreamResponses = forwarded.length === 0 ? [] : await upstreamJsonRpc(upstreamUrl, forwarded);
      for (const upstreamResponse of Array.isArray(upstreamResponses) ? upstreamResponses : [upstreamResponses]) {
        const index = forwardedIndexes.get(String(upstreamResponse.id));
        if (index !== undefined) responsesByIndex.set(index, upstreamResponse);
      }
      const combined = [...responsesByIndex.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, rpcResponse]) => rpcResponse);
      if (combined.length === 0) {
        response.statusCode = 204;
        response.end();
      } else {
        response.end(JSON.stringify(Array.isArray(parsed) ? combined : combined[0]));
      }
    } catch (error) {
      response.statusCode = error instanceof SyntaxError ? 400 : 502;
      response.end(
        JSON.stringify(
          jsonRpcError(null, error instanceof SyntaxError ? -32700 : -32043, error instanceof Error ? error.message : String(error)),
        ),
      );
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("failed to bind RPC proxy");
  return {
    url: `http://127.0.0.1:${address.port}`,
    pin,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

async function main() {
  const proxy = await createPinnedRpcProxy({
    upstreamUrl: process.env.ROBINHOOD_RPC_URL?.trim(),
    expectedChainId: process.env.ROBINHOOD_FORK_CHAIN_ID ?? "4663",
    blockNumber: process.env.ROBINHOOD_FORK_BLOCK_NUMBER,
    blockHash: process.env.ROBINHOOD_FORK_BLOCK_HASH,
  });
  process.stdout.write(
    `${JSON.stringify({ state: "READY", url: proxy.url, chainId: process.env.ROBINHOOD_FORK_CHAIN_ID ?? "4663", blockNumber: proxy.pin.blockNumber, blockHash: proxy.pin.blockHash })}\n`,
  );
  const shutdown = async () => {
    await proxy.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
