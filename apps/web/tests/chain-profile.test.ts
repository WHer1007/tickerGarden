import assert from "node:assert/strict";
import { test } from "node:test";
import { selectRobinhoodChain } from "../src/v1/chain.ts";

test("defaults to the Robinhood Chain mainnet profile", () => {
  const chain = selectRobinhoodChain(undefined);

  assert.equal(chain.id, 4663);
  assert.equal(chain.name, "Robinhood Chain");
  assert.equal(chain.testnet, false);
  assert.deepEqual(chain.rpcUrls.default.http, ["https://rpc.mainnet.chain.robinhood.com"]);
  assert.equal(chain.blockExplorers.default.url, "https://robinhoodchain.blockscout.com");
});

test("keeps the Robinhood Chain testnet id, RPC, and explorer aligned", () => {
  const chain = selectRobinhoodChain("46630");

  assert.equal(chain.id, 46630);
  assert.equal(chain.name, "Robinhood Chain Testnet");
  assert.equal(chain.testnet, true);
  assert.deepEqual(chain.rpcUrls.default.http, ["https://rpc.testnet.chain.robinhood.com"]);
  assert.equal(chain.blockExplorers.default.url, "https://explorer.testnet.chain.robinhood.com");
});

test("supports the explicit Arbitrum Sepolia test profile", () => {
  const chain = selectRobinhoodChain("421614");

  assert.equal(chain.id, 421614);
  assert.equal(chain.name, "Arbitrum Sepolia");
  assert.equal(chain.testnet, true);
  assert.deepEqual(chain.rpcUrls.default.http, ["https://sepolia-rollup.arbitrum.io/rpc"]);
  assert.equal(chain.blockExplorers.default.url, "https://sepolia.arbiscan.io");
});

test("rejects unknown Robinhood Chain ids", () => {
  for (const chainId of ["1", "466", "466300", "", "mainnet"]) {
    assert.throws(
      () => selectRobinhoodChain(chainId),
      /VITE_V1_CHAIN_ID must be 4663, 46630, or 421614/,
      `expected ${JSON.stringify(chainId)} to be rejected`,
    );
  }
});
