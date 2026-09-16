import type { InjectedProvider } from "./wallet-picker.ts";

type WalletChain = Readonly<{
  id: number;
  name: string;
  nativeCurrency: Readonly<{ name: string; symbol: string; decimals: number }>;
  rpcUrls: Readonly<{ default: Readonly<{ http: readonly string[] }> }>;
  blockExplorers: Readonly<{ default: Readonly<{ url: string }> }>;
}>;

function errorCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const record = error as Record<string, unknown>;
  if ("code" in record && Number.isFinite(Number(record.code))) return Number(record.code);
  for (const key of ["cause", "data"] as const) {
    if (key in record) {
      const nested = errorCode(record[key]);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

function numericChainId(value: unknown): number {
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error("Wallet returned an invalid network identifier");
  return parsed;
}

export async function ensureWalletChain(provider: InjectedProvider, chain: WalletChain, report: (message: string) => void = () => {}): Promise<void> {
  const chainId = `0x${chain.id.toString(16)}`;
  if (numericChainId(await provider.request({ method: "eth_chainId" })) === chain.id) return;
  report(`Switch to ${chain.name} in your wallet…`);
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (error) {
    if (errorCode(error) !== 4902) throw error;
    report(`${chain.name} is not available in this wallet. Approve “Add network” to continue.`);
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId, chainName: chain.name, nativeCurrency: chain.nativeCurrency, rpcUrls: chain.rpcUrls.default.http, blockExplorerUrls: [chain.blockExplorers.default.url] }],
    });
    if (numericChainId(await provider.request({ method: "eth_chainId" })) !== chain.id) {
      report(`${chain.name} was added. Approve the network switch to continue.`);
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
    }
  }
  if (numericChainId(await provider.request({ method: "eth_chainId" })) !== chain.id) throw new Error(`Wallet must use ${chain.name} (${chain.id})`);
}
