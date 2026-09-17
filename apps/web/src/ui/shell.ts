import type {PageName} from "../routing/routes.ts";
const required = <T extends Element>(selector: string): T => document.querySelector<T>(selector)!;
const brandMarkUrl = new URL("../../assets/tickergarden-mark-128.webp", import.meta.url).href;
const robinhoodFeatherUrl = new URL("../../assets/robinhood-chain/robinhood-feather-60.webp", import.meta.url).href;
const brandWordmark = `<span class="wordmark" aria-hidden="true"><span>Ticker</span><span>Garden</span></span>`;
export function shellMarkup(page: PageName, chainName: string): {header:string;footer:string} {
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
    `<a class="${page === id ? "active" : ""}" ${page === id ? "aria-current=\"page\"" : ""} href="${url}">${label}</a>`;
  const header = `
    <a class="brand" href="/" aria-label="TickerGarden home">
      <img src="${brandMarkUrl}" alt="">${brandWordmark}
    </a>
    <nav aria-label="Primary navigation">${nav.map(([id, label, url]) => `<a class="${page === id ? "active" : ""}" ${page === id ? "aria-current=\"page\"" : ""}  href="${url}">${label}</a>`).join("")}</nav>
    <div class="header-actions">
      <button class="wallet" type="button" data-wallet><i class="ph ph-wallet" aria-hidden="true"></i><span>Connect Wallet</span></button>
      <button class="menu" type="button" data-menu aria-label="Open navigation" aria-expanded="false"><i class="ph ph-list" aria-hidden="true"></i></button>
    </div>`;
  const footer = `
    <div class="footer-intro">
      <a class="brand" href="/" aria-label="TickerGarden home"><img src="${brandMarkUrl}" alt="">${brandWordmark}</a>
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
        <a class="footer-social-link" href="https://x.com/TickerGarden" target="_blank" rel="noopener noreferrer" aria-label="Visit TickerGarden on X"><i class="ph ph-x-logo" aria-hidden="true"></i><span>X</span></a>
        <span class="chain-tag" title="${chainName}"><img src="${robinhoodFeatherUrl}" width="20" height="20" alt="">Robinhood Chain</span>
      </div>
    </div>`;
  return {header,footer};
}

export function renderShell(page: PageName, chainName: string): void {
  const markup=shellMarkup(page,chainName);
  const header=required<HTMLElement>("[data-shell-header]");
  header.classList.remove("nav-open");
  header.innerHTML=markup.header;
  required<HTMLElement>("[data-shell-footer]").innerHTML=markup.footer;
}
