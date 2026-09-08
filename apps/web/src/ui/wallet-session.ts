import type { InjectedProvider } from "./wallet-picker.ts";

const KEY = "tickergarden.wallet-provider";

/** Persist provider choice only; accounts and chain must come from the live wallet. */
export function createWalletSession(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">, restore: (provider: InjectedProvider, current: () => boolean) => Promise<void>) {
  let selected: string | null = null;
  try { selected = storage.getItem(KEY); } catch { /* Storage can be disabled. */ }
  let generation = 0;
  const attempted = new Set<InjectedProvider>();
  return {
    cancelRestore() { generation++; selected = null; },
    remember(rdns: string) {
      generation++; selected = rdns;
      try { storage.setItem(KEY, rdns); } catch { /* Connection still works without persistence. */ }
    },
    forget() {
      generation++; selected = null;
      try { storage.removeItem(KEY); } catch { /* Best effort when storage is disabled. */ }
    },
    async discovered(rdns: string, provider: InjectedProvider) {
      if (rdns !== selected || attempted.has(provider)) return;
      attempted.add(provider);
      const version = generation;
      try { await restore(provider, () => generation === version && selected === rdns); }
      catch { /* Locked, unavailable, or revoked wallets remain disconnected. */ }
    },
  };
}

export async function authorizedWalletAccount(provider: InjectedProvider, chainId: number): Promise<string | null> {
  const [chain, accounts] = await Promise.all([
    provider.request({ method: "eth_chainId" }),
    provider.request({ method: "eth_accounts" }),
  ]);
  if (Number(chain) !== chainId || !Array.isArray(accounts)) return null;
  return typeof accounts[0] === "string" && /^0x[0-9a-fA-F]{40}$/.test(accounts[0]) ? accounts[0] : null;
}
