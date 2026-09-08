import assert from "node:assert/strict";
import { test } from "node:test";
import { ensureWalletChain } from "../src/ui/network-support.ts";
import { selectRobinhoodChain } from "../src/v1/chain.ts";
import type { InjectedProvider } from "../src/ui/wallet-picker.ts";

const chain = selectRobinhoodChain("46630");

test("uses an already selected network without requesting wallet mutations", async () => {
  const methods: string[] = [];
  const provider: InjectedProvider = { async request({ method }) { methods.push(method); return "0xb626"; } };
  await ensureWalletChain(provider, chain);
  assert.deepEqual(methods, ["eth_chainId"]);
});

test("explains, adds and selects a network missing from the wallet", async () => {
  let current = "0x1";
  let firstSwitch = true;
  const methods: string[] = [];
  const messages: string[] = [];
  const provider: InjectedProvider = {
    async request({ method, params }) {
      methods.push(method);
      if (method === "eth_chainId") return current;
      if (method === "wallet_switchEthereumChain") {
        if (firstSwitch) { firstSwitch = false; throw Object.assign(new Error("unknown chain"), { code: 4902 }); }
        current = String((params?.[0] as { chainId: string }).chainId); return null;
      }
      if (method === "wallet_addEthereumChain") {
        const network = params?.[0] as { chainId: string; chainName: string; rpcUrls: string[]; blockExplorerUrls: string[] };
        assert.equal(network.chainId, "0xb626");
        assert.equal(network.chainName, "Robinhood Chain Testnet");
        assert.ok(network.rpcUrls[0]?.startsWith("https://"));
        assert.ok(network.blockExplorerUrls[0]?.startsWith("https://"));
        return null;
      }
      throw new Error(`unexpected ${method}`);
    },
  };
  await ensureWalletChain(provider, chain, message => messages.push(message));
  assert.deepEqual(methods, ["eth_chainId", "wallet_switchEthereumChain", "wallet_addEthereumChain", "eth_chainId", "wallet_switchEthereumChain", "eth_chainId"]);
  assert.ok(messages.some(message => message.includes("not available") && message.includes("Add network")));
  assert.ok(messages.some(message => message.includes("was added")));
});

test("does not add a network when the user rejects an ordinary switch", async () => {
  const methods: string[] = [];
  const rejected = Object.assign(new Error("rejected"), { code: 4001 });
  const provider: InjectedProvider = { async request({ method }) { methods.push(method); if (method === "eth_chainId") return "0x1"; throw rejected; } };
  await assert.rejects(ensureWalletChain(provider, chain), rejected);
  assert.deepEqual(methods, ["eth_chainId", "wallet_switchEthereumChain"]);
});
