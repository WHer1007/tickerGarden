import { defineChain } from "viem";

/** A build selects one environment; wallet, RPC and read snapshots share this identity. */
export const ROBINHOOD_PRODUCTION_CHAIN_ID = 4663 as const;

export function selectRobinhoodChain(chainId: string | undefined) {
  if (chainId !== undefined && chainId !== "4663" && chainId !== "46630" && chainId !== "421614") throw new Error("VITE_V1_CHAIN_ID must be 4663, 46630, or 421614");
  const arbitrumSepolia = chainId === "421614";
  const testnet = chainId === "46630" || arbitrumSepolia;
  return defineChain({
    id: arbitrumSepolia ? 421614 : testnet ? 46630 : ROBINHOOD_PRODUCTION_CHAIN_ID,
    name: arbitrumSepolia ? "Arbitrum Sepolia" : testnet ? "Robinhood Chain Testnet" : "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [arbitrumSepolia ? "https://sepolia-rollup.arbitrum.io/rpc" : testnet ? "https://rpc.testnet.chain.robinhood.com" : "https://rpc.mainnet.chain.robinhood.com"] } },
    blockExplorers: { default: { name: arbitrumSepolia ? "Arbiscan" : "Robinhood Chain Explorer", url: arbitrumSepolia ? "https://sepolia.arbiscan.io" : testnet ? "https://explorer.testnet.chain.robinhood.com" : "https://robinhoodchain.blockscout.com" } },
    testnet,
  });
}

export const robinhoodChain = selectRobinhoodChain(import.meta.env?.VITE_V1_CHAIN_ID);
export const ROBINHOOD_CHAIN_ID = robinhoodChain.id;
