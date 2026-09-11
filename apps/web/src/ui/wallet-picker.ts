import { createWalletSession } from "./wallet-session.ts";
import { publicMessage } from "./public-copy.ts";
export interface InjectedProvider {
  request(args: Readonly<{ method: string; params?: readonly unknown[] }>): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}
type LegacyProvider = InjectedProvider & { providers?: LegacyProvider[]; isMetaMask?: boolean; isRabby?: boolean; isBinance?: boolean; isCoinbaseWallet?: boolean; isOkxWallet?: boolean; isOKExWallet?: boolean; isTrust?: boolean; isTrustWallet?: boolean; isPhantom?: boolean };
type Discovered = { name: string; rdns: string; provider: InjectedProvider; uuid: string; icon?: string };
const metamaskIcon = new URL("../../assets/wallets/metamask.svg", import.meta.url).href;
const binanceWalletIcon = new URL("../../assets/wallets/binance-wallet.png", import.meta.url).href;
const okxIcon = new URL("../../assets/wallets/okx.svg", import.meta.url).href;
const coinbaseIcon = new URL("../../assets/wallets/coinbase.png", import.meta.url).href;
const trustWalletIcon = new URL("../../assets/wallets/trust-wallet.png", import.meta.url).href;
const phantomIcon = new URL("../../assets/wallets/phantom.svg", import.meta.url).href;
export const COMMON_WALLETS = [
  { name: "MetaMask", rdns: "io.metamask", icon: metamaskIcon, url: "https://metamask.io/" },
  { name: "Binance Wallet", rdns: "com.binance", icon: binanceWalletIcon, url: "https://www.binance.com/en/web3wallet" },
  { name: "OKX Wallet", rdns: "com.okex.wallet", icon: okxIcon, url: "https://web3.okx.com/" },
  { name: "Coinbase Wallet / Base", rdns: "com.coinbase.wallet", icon: coinbaseIcon, url: "https://base.app/" },
  { name: "Trust Wallet", rdns: "com.trustwallet.app", icon: trustWalletIcon, url: "https://trustwallet.com/" },
  { name: "Phantom", rdns: "app.phantom", icon: phantomIcon, url: "https://phantom.com/" },
] as const;

function safeProviderIcon(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 200_000) return undefined;
  return /^data:image\/(?:png|jpeg|webp|svg\+xml)(?:;charset=[^,;]+)?(?:;base64)?,/i.test(value) ? value : undefined;
}

export function createWalletPicker(actions: { connect(provider: InjectedProvider, report: (message: string) => void): Promise<void>; restore(provider: InjectedProvider, current: () => boolean): Promise<void>; disconnect(): void; account(): string | null }) {
  // Accessing localStorage itself may throw in privacy-restricted contexts.
  let storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  try { storage = window.localStorage; } catch { storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }; }
  const session = createWalletSession(storage, async (provider, current) => {
    await actions.restore(provider, current);
    // A silent restore may resolve without connecting (for example while the
    // wallet is locked or exposes no accounts). Treat that as a failed
    // attempt so a later provider announce can retry it.
    if (current() && !actions.account()) throw new Error("Wallet account is not available");
  });
  const discovered: Discovered[] = [];
  let pending = false;
  const dialog = document.createElement("dialog");
  dialog.className = "wallet-dialog";
  dialog.setAttribute("aria-labelledby", "wallet-dialog-title");
  dialog.innerHTML = `<div class="wallet-dialog-head"><span class="wallet-dialog-kicker">YOUR GARDEN STARTS HERE</span><button type="button" class="wallet-close" aria-label="Close wallet chooser">×</button></div>
    <h2 id="wallet-dialog-title">Connect a wallet</h2>
    <div class="wallet-current" hidden><div class="wallet-current-address"><span data-wallet-address></span><button type="button" class="wallet-copy" data-wallet-copy aria-label="Copy Wallet Address" title="Copy Wallet Address"><i class="ph ph-copy" aria-hidden="true"></i></button></div><button type="button" data-wallet-disconnect>Disconnect</button></div>
    <div class="wallet-options"></div><p class="wallet-picker-status" role="status" aria-live="polite"></p>
    <p class="wallet-dialog-foot">Use an installed browser wallet or open this site in your wallet’s browser. Connecting does not submit a transaction.</p>`;
  document.body.append(dialog);
  const list = dialog.querySelector<HTMLElement>(".wallet-options")!;
  const status = dialog.querySelector<HTMLElement>(".wallet-picker-status")!;
  dialog.querySelector(".wallet-close")!.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
  dialog.querySelector("[data-wallet-disconnect]")!.addEventListener("click", () => { if (!pending) { actions.disconnect(); dialog.close(); } });

  dialog.querySelector<HTMLButtonElement>('[data-wallet-copy]')!.addEventListener('click',async(event)=>{
    const account=actions.account();if(!account)return;
    const button=event.currentTarget as HTMLButtonElement;button.disabled=true;
    try{
      await navigator.clipboard.writeText(account);
      button.querySelector('i')?.classList.replace('ph-copy','ph-check');
      status.textContent='Wallet Address Copied';
      button.title='Address Copied';button.setAttribute('aria-label','Address Copied');
      window.setTimeout(()=>{button.querySelector('i')?.classList.replace('ph-check','ph-copy');button.title='Copy Wallet Address';button.setAttribute('aria-label','Copy Wallet Address');button.disabled=false;},1800);
    }catch{status.textContent='Unable To Copy Address';button.disabled=false;}
  });

  function addWallet(entry: Discovered) {
    if (entry.rdns === "io.rabby") return;
    const existing = discovered.some((item) => item.provider === entry.provider || item.uuid === entry.uuid);
    if (existing) {
      // Providers may announce again after unlocking or switching chains.
      // Re-run the guarded restore attempt without duplicating the row.
      void session.discovered(entry.rdns, entry.provider);
      return;
    }
    discovered.push(entry);
    void session.discovered(entry.rdns, entry.provider);
    if (dialog.open && !pending) render();
  }
  window.addEventListener("eip6963:announceProvider", (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (!detail || typeof detail !== "object" || typeof detail.provider?.request !== "function" || typeof detail.info?.name !== "string" || typeof detail.info?.uuid !== "string" || typeof detail.info?.rdns !== "string") return;
    addWallet({ name: detail.info.name.slice(0, 80), uuid: detail.info.uuid, rdns: detail.info.rdns, provider: detail.provider, icon: safeProviderIcon(detail.info.icon) });
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  function legacyWallets() {
    const ethereum = (window as Window & { ethereum?: LegacyProvider }).ethereum;
    if (!ethereum) return;
    for (const provider of ethereum.providers?.length ? ethereum.providers : [ethereum]) {
      if (provider.isRabby) continue;
      if (discovered.some((item) => item.provider === provider) || typeof provider.request !== "function") continue;
      // More specific flags precede MetaMask compatibility flags.
      const rdns = provider.isBinance ? "com.binance" : provider.isOkxWallet || provider.isOKExWallet ? "com.okex.wallet" : provider.isCoinbaseWallet ? "com.coinbase.wallet" : provider.isTrust || provider.isTrustWallet ? "com.trustwallet.app" : provider.isPhantom ? "app.phantom" : provider.isMetaMask ? "io.metamask" : "browser.wallet";
      addWallet({ name: COMMON_WALLETS.find((item) => item.rdns === rdns)?.name ?? "Browser wallet", rdns, provider, uuid: `legacy-${discovered.length}` });
    }
  }
  async function select(entry: Discovered) {
    if (pending) return;
    session.cancelRestore();
    pending = true;
    list.querySelectorAll<HTMLButtonElement>("button").forEach((button) => { button.disabled = true; });
    status.textContent = `Continue in ${entry.name}…`;
    try {
      await actions.connect(entry.provider, message => { status.textContent = message; });
      session.remember(entry.rdns);
      dialog.close();
    } catch (error) {
      status.textContent = publicMessage(error instanceof Error ? error.message : "Connection was not completed. Try again.");
    } finally {
      pending = false;
      render();
    }
  }
  function render() {
    const focused = (document.activeElement as HTMLElement | null)?.dataset.walletChoice;
    list.replaceChildren();
    const rows = [...discovered.map((entry) => ({ entry, common: COMMON_WALLETS.find((item) => item.rdns === entry.rdns) })),
      ...COMMON_WALLETS.filter((common) => !discovered.some((entry) => entry.rdns === common.rdns)).map((common) => ({ entry: undefined, common }))];
    rows.forEach(({ entry, common }) => {
      const row = document.createElement(entry ? "button" : "a");
      row.className = "wallet-option";
      row.dataset.walletChoice = entry?.uuid ?? common!.rdns;
      if (row instanceof HTMLButtonElement) { row.type = "button"; row.disabled = pending; row.addEventListener("click", () => { void select(entry!); }); }
      else { row.href = common!.url; row.target = "_blank"; row.rel = "noopener noreferrer"; }
      const icon = document.createElement("span"); icon.className = "wallet-option-icon"; icon.setAttribute("aria-hidden", "true");
      const image = document.createElement("img"); image.src = common?.icon ?? entry?.icon ?? ""; image.alt = "";
      const fallbackMark = (common?.name ?? entry!.name).slice(0, 1).toUpperCase();
      image.addEventListener("error", () => { icon.replaceChildren(); icon.textContent = fallbackMark; icon.classList.add("is-fallback"); }, { once: true });
      icon.append(image);
      const name = document.createElement("strong"); name.textContent = common?.name ?? entry!.name;
      const state = document.createElement("span"); state.className = "wallet-option-state"; state.textContent = entry ? "Detected" : "Get wallet ↗";
      row.append(icon, name, state); list.append(row);
      if (focused === row.dataset.walletChoice) row.focus();
    });
    const account = actions.account();
    const current = dialog.querySelector<HTMLElement>(".wallet-current")!;
    current.hidden = !account;
    current.querySelector("[data-wallet-address]")!.textContent = account ? `${account.slice(0, 12)}…${account.slice(-8)}` : "";
    current.querySelector<HTMLElement>("[data-wallet-address]")!.title=account??"";
    (current.querySelector("[data-wallet-disconnect]") as HTMLButtonElement).disabled = pending;
  }
  // Extensions may inject after the application has mounted.
  window.addEventListener("ethereum#initialized", legacyWallets);
  window.addEventListener("load", legacyWallets, { once: true });
  legacyWallets();
  return {
    forget() { session.forget(); },
    refresh() { if(dialog.open) render(); },
    open() {
      status.textContent = pending ? "Continue in your wallet…" : "";
      window.dispatchEvent(new Event("eip6963:requestProvider"));
      legacyWallets(); render();
      if (!dialog.open) dialog.showModal();
    },
  };
}
