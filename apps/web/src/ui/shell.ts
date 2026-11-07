import {bindNetworkSwitcher} from './network-switcher.ts';
import type {PageName} from "../routing/routes.ts";
const required = <T extends Element>(selector: string): T => document.querySelector<T>(selector)!;
const brandMarkUrl = new URL("../../assets/tickergarden-mark-128.webp", import.meta.url).href;
const robinhoodFeatherUrl = new URL("../../assets/robinhood-chain/robinhood-feather-60.webp", import.meta.url).href;
const bnbUrl = new URL('../../assets/networks/bnb.png', import.meta.url).href;
const solanaUrl = new URL('../../assets/networks/solana.png', import.meta.url).href;
const brandWordmark = `<span class="wordmark" aria-hidden="true"><span>Ticker</span><span>Garden</span></span>`;
export function shellMarkup(page: PageName, chainName: string, bscWritesEnabled = false): {header:string;footer:string} {
  const bsc = /BNB|BSC/.test(chainName);
  const activeName = bsc ? 'BNB Chain' : chainName;
  const activeIcon = bsc ? bnbUrl : robinhoodFeatherUrl;
  const href = (url: string) => bsc ? `${url}?chain=bsc` : url;
  if (page === "statsStocks") page = "stats";
  const nav: readonly [PageName, string, string][] = [
    ["markets", "Explore", "/explore"],
    ["create", "Launch", "/create"],
    ["stats", "Stats", "/stats"],
    ["rewards", "Claim", "/claim"],
    ["staking", "Stake", "/stake"],
    ["docs", "Docs", "/docs"],
  ];
  const footerLink = (id: PageName, label: string, url: string): string =>
    `<a class="${page === id ? "active" : ""}" ${page === id ? "aria-current=\"page\"" : ""} href="${href(url)}">${label}</a>`;
  const header = `
    <a class="brand" href="${href("/")}" aria-label="TickerGarden home">
      <img src="${brandMarkUrl}" alt="">${brandWordmark}
    </a>
    <nav aria-label="Primary navigation">${nav.map(([id, label, url]) => `<a class="${page === id ? "active" : ""}" ${page === id ? "aria-current=\"page\"" : ""}  href="${href(url)}">${label}</a>`).join("")}</nav>
    <div class="header-actions">
      <div class="network-switcher">
        <button class="network-trigger" type="button" data-network-trigger aria-label="Switch network, current: ${activeName}" title="${activeName} · Switch network" aria-haspopup="menu" aria-expanded="false" aria-controls="network-menu"><img class="${bsc ? "" : "network-mark-rh"}" src="${activeIcon}" alt="" width="22" height="22"></button>
        <div class="network-panel" id="network-menu" data-network-panel role="menu" aria-label="Network" hidden>
          <p class="network-heading">Network</p>
          <button class="network-option" type="button" role="menuitemradio" aria-checked="${!bsc}" data-network="rh"><img class="network-mark-rh" src="${robinhoodFeatherUrl}" alt="" width="24" height="24"><span>${bsc ? 'Robinhood' : chainName.replace(' Chain', '')}</span>${!bsc ? '<i class="ph ph-check" aria-hidden="true"></i>' : ''}</button>
          <button class="network-option" type="button" role="menuitemradio" aria-checked="${bsc}" data-network="bsc"><img src="${bnbUrl}" alt="" width="24" height="24"><span>BNB Chain</span>${bscWritesEnabled ? '' : '<small>View only</small>'}${bsc ? '<i class="ph ph-check" aria-hidden="true"></i>' : ''}</button>
          <button class="network-option" type="button" role="menuitemradio" aria-checked="false" data-network="solana" disabled><img src="${solanaUrl}" alt="" width="24" height="24"><span>Solana</span><small>Coming soon</small></button>
        </div>
      </div>
      <button class="wallet wallet-icon" type="button" data-wallet aria-label="Connect wallet" title="Connect wallet"><i class="ph ph-wallet" aria-hidden="true"></i><span class="wallet-label">Connect Wallet</span></button>
      <button class="menu" type="button" data-menu aria-label="Open navigation" aria-expanded="false"><i class="ph ph-list" aria-hidden="true"></i></button>
    </div>`;
  const footer = `
    <div class="footer-intro">
      <a class="brand" href="${href("/")}" aria-label="TickerGarden home"><img src="${brandMarkUrl}" alt="">${brandWordmark}</a>
      <p>Where stock communities meet onchain culture—and new possibilities take root.</p>
    </div>
    <nav class="footer-navigation" aria-label="Footer navigation">
      <section><strong>Garden</strong>${footerLink("markets", "Explore", "/explore")}${footerLink("create", "Launch", "/create")}</section>
      <section><strong>Community</strong>${footerLink("rewards", "Claim", "/claim")}${footerLink("stats", "Stats", "/stats")}${footerLink("docs", "Docs", "/docs")}</section>
      <section><strong>Legal</strong>${footerLink("privacy", "Privacy", "/privacy")}${footerLink("terms", "Terms", "/terms")}<a href="/docs#docs-risks">Risk</a></section>
    </nav>
    <div class="footer-meta">
      <span>© 2026 TickerGarden</span>
      <div class="footer-meta-links">
        <a class="footer-social-link" href="https://x.com/Ticker_Garden" target="_blank" rel="noopener noreferrer" aria-label="Visit TickerGarden on X"><i class="ph ph-x-logo" aria-hidden="true"></i><span>X</span></a>
        <span class="chain-tag" title="${chainName}"><img src="${activeIcon}" width="20" height="20" alt="">${activeName}</span>
      </div>
    </div>`;
  return {header,footer};
}

let disposeNetwork: (() => void) | undefined;
export function renderShell(page: PageName, chainName: string, canSwitch: () => boolean = () => true): void {
  disposeNetwork?.();
  const selectedName = new URLSearchParams(location.search).get('chain') === 'bsc' ? 'BNB Chain' : chainName;
  const markup=shellMarkup(page,selectedName,import.meta.env?.VITE_BSC_USER_WRITES==='approved');
  const header=required<HTMLElement>("[data-shell-header]");
  header.classList.remove("nav-open");
  header.innerHTML=markup.header;
  disposeNetwork=bindNetworkSwitcher(header,canSwitch);
  required<HTMLElement>("[data-shell-footer]").innerHTML=markup.footer;
}
