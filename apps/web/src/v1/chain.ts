import { selectedEvmChain, evmEnvironment } from "./evmContext.ts";
import { defineChain } from "viem";

/** A build selects one environment; wallet, RPC and read snapshots share this identity. */
export const ROBINHOOD_PRODUCTION_CHAIN_ID = 4663 as const;

export function selectRobinhoodChain(chainId: string | undefined) {
  if (chainId === "56") return defineChain({ id: 56, name: "BNB Smart Chain", nativeCurrency: {name: "BNB", symbol: "BNB", decimals: 18}, rpcUrls: {default: {http: ["https://bsc-dataseed.bnbchain.org"]}}, blockExplorers: {default: {name:"BscScan",url:"https://bscscan.com"}}, testnet:false });
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

export const robinhoodChain = selectRobinhoodChain(selectedEvmChain(import.meta.env ?? {}, typeof window === "undefined" ? "" : window.location.search));
export const ROBINHOOD_CHAIN_ID = robinhoodChain.id;

export const evmEnv = evmEnvironment(import.meta.env ?? {}, robinhoodChain.id);
export const nativeSymbol = robinhoodChain.nativeCurrency.symbol;
