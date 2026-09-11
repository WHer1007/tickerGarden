import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");
const privacy = read("../src/pages/privacy.ts");
const terms = read("../src/pages/terms.ts");
const risks = read("../src/pages/risks.ts");
const app = read("../src/app.ts");
const vite = read("../vite.config.js");
const routes = read("../src/routing/routes.ts");
const styles = read("../subpages.css");

function assertLocalAnchorsResolve(page: string): void {
  const ids = new Set(Array.from(page.matchAll(/\sid="([^"]+)"/g), (match) => match[1]));
  const anchors = Array.from(page.matchAll(/href="#([^"]+)"/g), (match) => match[1]);
  assert.ok(anchors.length > 0);
  for (const anchor of anchors) assert.ok(ids.has(anchor), `missing #${anchor}`);
}

test("privacy and terms pages expose complete legal-page structure", () => {
  assert.match(privacy, /Privacy Policy/);
  assert.match(terms, /Terms of Use/);
  assert.match(risks, /Risk information/);
  assert.match(privacy, /Pre-launch legal draft/);
  assert.match(terms, /Pre-launch legal draft/);
  assert.match(privacy, /Public blockchain and distributed records/);
  assert.match(terms, /Ticker Meme and STOCK relationship/);
  assert.match(terms, /UserStockVault/);
  assert.match(terms, /Bloomed/);
  assert.match(terms, /rageQuit/);
  assert.doesNotMatch(privacy, /\bPons\b/i);
  assert.doesNotMatch(terms, /\bPons\b/i);
  assertLocalAnchorsResolve(privacy);
  assertLocalAnchorsResolve(terms);
  assertLocalAnchorsResolve(risks);
  assert.match(risks, /irreversible/);
  assert.match(risks, /stock ownership/);
  assert.match(risks, /Smart contracts/);
  assert.match(risks, /afford to lose/);
});

test("shared footer exposes product and legal navigation", () => {
  for (const path of ["/", "/explore", "/create", "/stats", "/claim", "/docs", "/privacy", "/terms", "/risks"]) assert.match(routes, new RegExp(`\\"${path.replace("/", "\\/")}\\"`));
  assert.match(app, /aria-label="Footer navigation"/);
  assert.match(app, /<strong>Legal<\/strong>\$\{footerLink\("privacy", "Privacy", "\/privacy"\)\}\$\{footerLink\("terms", "Terms", "\/terms"\)\}\$\{footerLink\("risks", "Risk", "\/risks"\)\}/);
  assert.match(styles, /\.footer-navigation\{[^}]*grid-template-columns:repeat\(3,minmax\(96px,max-content\)\)[^}]*column-gap:24px[^}]*width:max-content[^}]*padding-top:8px[^}]*justify-self:end/);
});

test("shared navigation exposes Explore and keeps Home out of the primary links", () => {
  const primaryNavigation = app.slice(app.indexOf("const nav:"), app.indexOf("const header"));
  assert.match(primaryNavigation, /\["markets", "Explore", "\/explore"\]/);
  assert.doesNotMatch(primaryNavigation, /\["home"/);
  assert.match(app, /footerLink\("markets", "Explore", "\/explore"\)/);
  assert.doesNotMatch(app, /footerLink\("home", "Home", "\/"\)/);
  assert.match(app, /\["rewards", "Claim", "\/claim"\]/);
  assert.match(app, /\["docs", "Docs", "\/docs"\]/);
  assert.match(app, /data-wallet-only hidden/);
  const headerShell = app.slice(app.indexOf("header.innerHTML"), app.indexOf("required<HTMLElement>(\"[data-shell-footer]\")"));
  const footerShell = app.slice(app.indexOf("required<HTMLElement>(\"[data-shell-footer]\")"), app.indexOf("walletPicker ??="));
  const gardenLinks = footerShell.slice(footerShell.indexOf("<strong>Garden</strong>"), footerShell.indexOf("</section>"));
  const communityLinks = footerShell.slice(footerShell.indexOf("<strong>Community</strong>"), footerShell.indexOf("</section>", footerShell.indexOf("<strong>Community</strong>")));
  assert.doesNotMatch(gardenLinks, /footerLink\("stats"/);
  assert.match(communityLinks, /footerLink\("stats", "Stats", "\/stats"\).*footerLink\("docs", "Docs", "\/docs"\)/);
  assert.doesNotMatch(headerShell, /class="chain-tag"/);
  assert.match(footerShell, /class="chain-tag" title="\$\{robinhoodChain\.name\}"/);
  assert.match(footerShell, /<\/i>Robinhood Chain<\/span>/);
});

test("Vite keeps legal pages in the SPA while allowing route chunking", () => {
  assert.match(vite, /appType:\s*['"]spa['"]/);
  assert.doesNotMatch(vite, /input\s*:|resolve\([^\n]+\.html/);
  assert.match(app, /page === "privacy" \|\| page === "terms"/);
});
