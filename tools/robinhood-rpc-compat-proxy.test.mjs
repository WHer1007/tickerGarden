import assert from "node:assert/strict";
import test from "node:test";

import {
  PinnedBlockMismatchError,
  upstreamJsonRpc,
  normalizePinnedBlock,
  rewritePinnedBlockReferences,
} from "./robinhood-rpc-compat-proxy.mjs";

const pin = normalizePinnedBlock({
  blockNumber: "54574453",
  blockHash: "0x890779a9495c5e825a5c19c70d0de3afd3e4076e7da74387346b30bc79460e22",
});

test("normalizes the exact decimal block pin", () => {
  assert.equal(pin.blockNumberHex, "0x340bd75");
  assert.equal(pin.blockNumber, "54574453");
});

test("rewrites only an exact EIP-1898 block-hash reference", () => {
  const request = {
    jsonrpc: "2.0",
    id: 7,
    method: "eth_getCode",
    params: [
      "0x4e59b44847b379578588920ca78fbf26c0b4956c",
      { blockHash: pin.blockHash.toUpperCase().replace("0X", "0x"), requireCanonical: false },
    ],
  };
  assert.deepEqual(rewritePinnedBlockReferences(request, pin).params, [request.params[0], pin.blockNumberHex]);
  assert.deepEqual(
    rewritePinnedBlockReferences({ ...request, params: [request.params[0], "latest"] }, pin).params,
    [request.params[0], "latest"],
  );
});

test("fails closed for any other block hash", () => {
  assert.throws(
    () =>
      rewritePinnedBlockReferences(
        {
          jsonrpc: "2.0",
          id: 8,
          method: "eth_getStorageAt",
          params: ["0x0000000000000000000000000000000000000001", "0x0", { blockHash: `0x${"11".repeat(32)}` }],
        },
        pin,
      ),
    PinnedBlockMismatchError,
  upstreamJsonRpc,
  );
});

test("fails closed for block-reference extras and write methods", () => {
  assert.throws(
    () =>
      rewritePinnedBlockReferences(
        {
          jsonrpc: "2.0",
          id: 10,
          method: "eth_getCode",
          params: ["0x0000000000000000000000000000000000000001", { blockHash: pin.blockHash, extra: true }],
        },
        pin,
      ),
    PinnedBlockMismatchError,
  upstreamJsonRpc,
  );
  assert.throws(
    () =>
      rewritePinnedBlockReferences(
        { jsonrpc: "2.0", id: 11, method: "eth_sendRawTransaction", params: ["0x00"] },
        pin,
      ),
    /unsupported read-only RPC method/,
  );
});

test("does not rewrite transaction-shaped objects", () => {
  const transaction = { from: "0x0000000000000000000000000000000000000001", blockHash: pin.blockHash };
  const request = { jsonrpc: "2.0", id: 9, method: "eth_call", params: [transaction, "latest"] };
  assert.deepEqual(rewritePinnedBlockReferences(request, pin), request);
});


test("retries transient transport failure with the exact pinned request", async () => {
  const body = {jsonrpc: "2.0", id: 1, method: "eth_getCode", params: ["0x1", pin.blockNumberHex]};
  const requests = [];
  const result = await upstreamJsonRpc("https://test.invalid", body, async (_url, options) => {
    requests.push(options.body);
    if (requests.length === 1) throw new TypeError("fetch failed");
    return {ok: true, json: async () => ({result: "0x1234"})};
  });
  assert.equal(result.result, "0x1234");
  assert.deepEqual(requests, [JSON.stringify(body), JSON.stringify(body)]);
});

test("does not retry or replace missing state and permission failures", async () => {
  let attempts = 0;
  const missing = {error: {code: -32000, message: "metadata is not found"}};
  assert.deepEqual(await upstreamJsonRpc("https://test.invalid", {}, async () => {
    ++attempts; return {ok: true, json: async () => missing};
  }), missing);
  assert.equal(attempts, 1);
  await assert.rejects(upstreamJsonRpc("https://test.invalid", {}, async () => {
    ++attempts; return {ok: false, status: 403};
  }), /HTTP 403/);
  assert.equal(attempts, 2);
});
