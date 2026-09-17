import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");
const privacy = read("../src/pages/privacy.ts");
const terms = read("../src/pages/terms.ts");
import docs from "../src/pages/docs.ts";
import { resolveRoute } from "../src/routing/routes.ts";
const app = read("../src/ui/shell.ts");
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
  assert.doesNotMatch(privacy, /pre-launch|legal-placeholder|draft|not yet effective|required before launch/i);
  assert.doesNotMatch(terms, /pre-launch|legal-placeholder|draft|not yet effective|required before launch/i);
  assert.match(privacy, /Public blockchain and distributed records/);
  assert.match(terms, /Community tokens and Stock Tokens/);
  assert.match(terms, /Bloomed/);
  assert.match(terms, /emergency exit can forfeit unclaimed rewards/i);
  for (const page of [privacy, terms]) {
    assert.match(page, /Singapore/);
    assert.match(page, /href="mailto:info@tickergarden.com"/);
  }
  assert.match(terms, /not yet undergone an independent external audit/);
  assert.doesNotMatch(privacy, /\bPons\b/i);
  assert.doesNotMatch(terms, /\bPons\b/i);
  assertLocalAnchorsResolve(privacy);
  assertLocalAnchorsResolve(terms);
});

test("shared footer exposes product and legal navigation", () => {
  for (const path of ["/", "/explore", "/create", "/stats", "/claim", "/docs", "/privacy", "/terms"]) assert.match(routes, new RegExp(`\\"${path.replace("/", "\\/")}\\"`));
  assert.match(app, /aria-label="Footer navigation"/);
  assert.ok(app.includes('<a href="/docs#docs-risks">Risk</a>'));
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
  assert.doesNotMatch(app, /data-wallet-only hidden/);
  const headerShell = app.slice(app.indexOf("const header = `"), app.indexOf("const footer = `"));
  const footerShell = app.slice(app.indexOf("const footer = `"), app.indexOf("return {header,footer}"));
  const gardenLinks = footerShell.slice(footerShell.indexOf("<strong>Garden</strong>"), footerShell.indexOf("</section>"));
  const communityLinks = footerShell.slice(footerShell.indexOf("<strong>Community</strong>"), footerShell.indexOf("</section>", footerShell.indexOf("<strong>Community</strong>")));
  assert.doesNotMatch(gardenLinks, /footerLink\("stats"/);
  assert.match(communityLinks, /footerLink\("stats", "Stats", "\/stats"\).*footerLink\("docs", "Docs", "\/docs"\)/);
  assert.doesNotMatch(headerShell, /class="chain-tag"/);
  assert.match(footerShell, /class="chain-tag" title="\$\{chainName\}"/);
  assert.match(footerShell, /robinhoodFeatherUrl/);
  assert.match(footerShell, />Robinhood Chain<\/span>/);
  assert.match(footerShell, /href="https:\/\/x\.com\/TickerGarden" target="_blank" rel="noopener noreferrer"/);
  assert.match(footerShell, /aria-label="Visit TickerGarden on X"/);
});

test("Vite keeps legal pages in the SPA while allowing route chunking", () => {
  assert.match(vite, /appType:\s*['"]spa['"]/);
  assert.doesNotMatch(vite, /input\s*:|resolve\([^\n]+\.html/);
  assert.match(read("../src/app.ts"), /page === "privacy" \|\| page === "terms"/);
});


test("risk disclosure links resolve in Docs and the standalone route is removed", () => {
  for (const path of ["/risks", "/risks.html"]) assert.equal(resolveRoute(new URL(path, "https://tickergarden.com")).page, "not-found");
  assert.doesNotMatch(read("../vercel.json"), /\/risks/);
  assert.doesNotMatch(vite, /risksPage/);
  assert.match(docs.html, /not yet undergone an independent external audit/);
  assert.match(docs.html, /id="docs-risks"/);
  assert.match(app, /href="\/docs#docs-risks"/);
  for (const page of ["create", "trade", "staking"]) {
    const source = read(`../src/pages/${page}.ts`);
    assert.doesNotMatch(source, /action-risk-note|Trade responsibly\.|Read the risks/);
  }
});
