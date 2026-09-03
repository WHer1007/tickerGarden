import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { defineChain, type Chain, type Transport } from "viem";

export const ROBINHOOD_CHAIN_ID = 4663 as const;

export const robinhoodChain = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.mainnet.chain.robinhood.com"] },
  },
  blockExplorers: {
    default: { name: "Robinhood Chain Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
});

export function createTickerGardenWagmiConfig(options: {
  readonly transport?: Transport;
  readonly chain?: Chain;
} = {}) {
  const chain = options.chain ?? robinhoodChain;
  return createConfig({
    chains: [chain],
    connectors: [injected({ shimDisconnect: true })],
    transports: { [chain.id]: options.transport ?? http(chain.rpcUrls.default.http[0]) },
    multiInjectedProviderDiscovery: false,
  });
}
