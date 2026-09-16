import type {PageName} from "../routing/routes.ts";
const required = <T extends Element>(selector: string): T => document.querySelector<T>(selector)!;
const brandMarkUrl = new URL("../../assets/tickergarden-mark-128.webp", import.meta.url).href;
const robinhoodFeatherUrl = new URL("../../assets/robinhood-chain/robinhood-feather-60.webp", import.meta.url).href;
const brandWordmark = `<span class="wordmark" aria-hidden="true"><span>Ticker</span><span>Garden</span></span>`;
export function renderShell(page: PageName, chainName: string): void {
  if (page === "statsStocks") page = "stats";
  const nav: readonly [PageName, string, string][] = [
    ["markets", "Explore", "/explore"],
    ["create", "Create", "/create"],
    ["stats", "Stats", "/stats"],
    ["rewards", "Claim", "/claim"],
    ["staking", "Stake", "/stake"],
    ["docs", "Docs", "/docs"],
  ];
  const header = required<HTMLElement>("[data-shell-header]");
  const footerLink = (id: PageName, label: string, url: string): string =>
    `<a class="${page === id ? "active" : ""}" ${page === id ? "aria-current=\"page\"" : ""} href="${url}">${label}</a>`;
  header.classList.remove("nav-open");
  header.innerHTML = `
    <a class="brand" href="/" aria-label="TickerGarden home">
      <img src="${brandMarkUrl}" alt="">${brandWordmark}
    </a>
    <nav aria-label="Primary navigation">${nav.map(([id, label, url]) => `<a class="${page === id ? "active" : ""}" ${page === id ? "aria-current=\"page\"" : ""} ${(id === "rewards" || id === "staking") ? "data-wallet-only hidden" : ""} href="${url}">${label}</a>`).join("")}</nav>
    <div class="header-actions">
      <button class="wallet" type="button" data-wallet><i class="ph ph-wallet" aria-hidden="true"></i><span>Connect Wallet</span></button>
      <button class="menu" type="button" data-menu aria-label="Open navigation" aria-expanded="false"><i class="ph ph-list" aria-hidden="true"></i></button>
    </div>`;
  required<HTMLElement>("[data-shell-footer]").innerHTML = `
    <div class="footer-intro">
      <a class="brand" href="/" aria-label="TickerGarden home"><img src="${brandMarkUrl}" alt="">${brandWordmark}</a>
      <p>Where stock communities meet onchain culture—and new possibilities take root.</p>
    </div>
    <nav class="footer-navigation" aria-label="Footer navigation">
      <section><strong>Garden</strong>${footerLink("markets", "Explore", "/explore")}${footerLink("create", "Create", "/create")}</section>
      <section><strong>Community</strong><span data-wallet-only hidden>${footerLink("rewards", "Claim", "/claim")}</span>${footerLink("stats", "Stats", "/stats")}${footerLink("docs", "Docs", "/docs")}</section>
      <section><strong>Legal</strong>${footerLink("privacy", "Privacy", "/privacy")}${footerLink("terms", "Terms", "/terms")}${footerLink("risks", "Risk", "/risks")}</section>
    </nav>
    <div class="footer-meta">
      <span>© 2026 TickerGarden</span>
      <div class="footer-meta-links">
        <a class="footer-social-link" href="https://x.com/TickerGarden" target="_blank" rel="noopener noreferrer" aria-label="Visit TickerGarden on X"><i class="ph ph-x-logo" aria-hidden="true"></i><span>X</span></a>
        <span class="chain-tag" title="${chainName}"><img src="${robinhoodFeatherUrl}" width="20" height="20" alt="">Robinhood Chain</span>
      </div>
    </div>`;

}
