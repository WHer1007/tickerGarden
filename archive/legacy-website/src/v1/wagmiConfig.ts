import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import type { Chain, Transport } from "viem";
import { robinhoodChain } from "./chain.ts";

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
